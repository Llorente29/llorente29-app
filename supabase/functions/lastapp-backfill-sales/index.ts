// supabase/functions/lastapp-backfill-sales/index.ts
// Backfill de ventas historicas desde Last.app hacia sale/sale_line.
// Pagina GET /bills por ventanas de 1 dia (limit 100, sin cursor en la API),
// pide el detalle de cada bill y escribe cabecera + lineas, resolviendo cada
// linea via la funcion SQL resolve_lastapp_line (compartida con el webhook).
// Idempotente por external_ref = bill.id.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

function channelSlug(paymentType: string | null | undefined): string | null {
  if (!paymentType) return null;
  const t = paymentType.toLowerCase();
  if (t.includes("glovo")) return "glovo";
  if (t.includes("uber")) return "uber";
  if (t.includes("justeat") || t.includes("just_eat") || t.includes("just eat")) return "justeat";
  if (t.includes("shop") || t.includes("local") || t.includes("onsite")) return "shop";
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function lastGet(path: string, token: string, locId: string): Promise<any> {
  const res = await fetch(`${LASTAPP_BASE}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "locationID": locId },
  });
  if (!res.ok) throw new Error(`Last.app ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function nextDay(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const internalSecret = Deno.env.get("LASTAPP_INTERNAL_KEY") ?? "";
  if (internalSecret === "" || req.headers.get("x-internal-key") !== internalSecret) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const accountId = body.account_id;
  const orgId = body.lastapp_organization_id;
  const lastLocId = body.lastapp_location_id;
  const startDate = body.start_date;
  const endDate = body.end_date;
  const dryRun = body.dry_run === true;
  if (!accountId || !orgId || !lastLocId || !startDate || !endDate) {
    return jsonResponse({ error: "account_id, lastapp_organization_id, lastapp_location_id, start_date, end_date required" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: integ, error: integErr } = await sb
    .from("lastapp_integration").select("token_secret_name")
    .eq("account_id", accountId).eq("lastapp_organization_id", orgId).single();
  if (integErr || !integ) return jsonResponse({ error: "Integration not found" }, 404);
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return jsonResponse({ error: `Secret ${integ.token_secret_name} not set` }, 500);

  const { data: locMap } = await sb
    .from("lastapp_location_map").select("location_id")
    .eq("account_id", accountId).eq("lastapp_location_id", lastLocId).single();
  const folvyLocationId = locMap?.location_id ?? null;

  const stats = {
    days: 0, bills_seen: 0, sales_written: 0, sales_skipped: 0,
    lines_written: 0, lines_unresolved: 0, day_overflows: [] as string[],
    errors: [] as string[],
  };

  try {
    let day = startDate;
    while (day <= endDate) {
      stats.days++;
      const from = `${day} 00:00:00`;
      const to = `${day} 23:59:59`;
      let bills: any[];
      try {
        bills = await lastGet(
          `/bills?locationId=${lastLocId}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&limit=100`,
          token, lastLocId,
        );
      } catch (e) {
        stats.errors.push(`day ${day} list: ${String(e)}`);
        day = nextDay(day); continue;
      }
      if (Array.isArray(bills) && bills.length >= 100) stats.day_overflows.push(day);

      for (const bh of (bills ?? [])) {
        stats.bills_seen++;
        const billId = bh.id;
        if (!billId) continue;

        if (!dryRun) {
          const { data: exists } = await sb.from("sale").select("id")
            .eq("account_id", accountId).eq("source", "lastapp")
            .eq("external_ref", billId).limit(1).maybeSingle();
          if (exists) { stats.sales_skipped++; continue; }
        }

        let bill: any;
        try { bill = await lastGet(`/bills/${billId}`, token, lastLocId); }
        catch (e) { stats.errors.push(`bill ${billId}: ${String(e)}`); continue; }

        const payType = bill?.payments?.[0]?.type ?? null;
        const slug = channelSlug(payType);
        const products: any[] = bill?.products ?? [];

        const resolvedLines: any[] = [];
        let saleBrandId: string | null = null;
        for (const p of products) {
          let menuItemId: string | null = null;
          if (p.catalogProductId && slug) {
            const { data: rr } = await sb.rpc("resolve_lastapp_line", {
              p_account_id: accountId,
              p_catalog_product_id: p.catalogProductId,
              p_channel_slug: slug,
            });
            const row = Array.isArray(rr) ? rr[0] : rr;
            menuItemId = row?.menu_item_id ?? null;
          }
          if (menuItemId && !saleBrandId) {
            const { data: mi } = await sb.from("menu_item").select("brand_id").eq("id", menuItemId).maybeSingle();
            saleBrandId = mi?.brand_id ?? null;
          }
          resolvedLines.push({
            raw_text: p.name ?? "", product_name: p.name ?? "",
            quantity: p.quantity ?? 1,
            unit_price: typeof p.price === "number" ? p.price / 100 : null,
            menu_item_id: menuItemId,
            map_source: menuItemId ? "manual" : "unmapped",
            map_needs_review: menuItemId ? false : true,
          });
          if (!menuItemId) stats.lines_unresolved++;
        }

        const channelId = slug
          ? (await sb.from("sales_channel").select("id").eq("account_id", accountId).eq("slug", slug).maybeSingle()).data?.id ?? null
          : null;

        if (dryRun) { stats.sales_written++; stats.lines_written += resolvedLines.length; continue; }

        const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
          account_id: accountId, source: "lastapp", external_ref: billId,
          external_channel_text: payType, channel_id: channelId, brand_id: saleBrandId,
          location_id: folvyLocationId,
          sold_at: bill.creationTime ?? bill.finalizingTime,
          total: typeof bill.total === "number" ? bill.total / 100 : 0,
          delivery_cost: typeof bill.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
          discount_amount: typeof bill.discountTotal === "number" ? bill.discountTotal / 100 : null,
          raw_products: JSON.stringify(products), is_active: true,
        }).select("id").single();
        if (saleErr || !saleRow) { stats.errors.push(`sale insert ${billId}: ${saleErr?.message}`); continue; }

        const lineRows = resolvedLines.map((l) => ({ ...l, account_id: accountId, sale_id: saleRow.id }));
        if (lineRows.length > 0) {
          const { error: lineErr } = await sb.from("sale_line").insert(lineRows);
          if (lineErr) {
            // Evitar venta huerfana: borrar la sale si fallan sus lineas
            stats.errors.push(`lines ${billId}: ${lineErr.message}`);
            await sb.from("sale").delete().eq("id", saleRow.id);
            continue;
          }
          stats.lines_written += lineRows.length;
        }
        stats.sales_written++;
      }
      day = nextDay(day);
    }
    return jsonResponse({ ok: true, dry_run: dryRun, ...stats });
  } catch (e) {
    return jsonResponse({ error: String(e), partial: stats }, 500);
  }
});
