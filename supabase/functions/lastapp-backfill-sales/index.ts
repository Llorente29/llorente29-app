// supabase/functions/lastapp-backfill-sales/index.ts
// Backfill de ventas historicas desde Last.app hacia sale (+ sale_line via motor).
// ============================================================================
// CANÓNICO (20/06): la frontera escribe la venta CRUDA (source, raw_products,
// external_brand_text, external_location_text, canal, local, totales) y DELEGA el
// casado en reprocess_sale — el MISMO motor agnóstico que usa el webhook en vivo:
//   reprocess_sale → resolve_sale_brand_from_map (marca por external_brand_map)
//                  → adapt_lastapp_order (líneas por menu_item.external_id=matrícula)
//                  → compute_sale_line_cost + compute_sale_line_consumption.
//
// CAMBIO vs versión vieja: ya NO se resuelven líneas aquí (se eliminó
// resolve_lastapp_line) ni se marcan 'manual'. El backfill NO inserta sale_line:
// las arma adapt_lastapp_order con map_source 'pos'/'unmapped' (normales,
// RE-CASABLES). 'manual' se reserva para correcciones humanas reales; una línea
// 'manual' es inmune al recast — justo lo que NO queremos en un backfill.
//
// Idempotente por external_ref = bill.id.
// ============================================================================

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
    .from("external_integration").select("token_secret_name")
    .eq("account_id", accountId).eq("external_org_id", orgId).eq("source", "lastapp").single();
  if (integErr || !integ) return jsonResponse({ error: "Integration not found" }, 404);
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return jsonResponse({ error: `Secret ${integ.token_secret_name} not set` }, 500);

  // Local Folvy desde el mapa agnóstico (source='lastapp').
  const { data: locMap } = await sb
    .from("external_location_map").select("location_id")
    .eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_location_id", lastLocId).maybeSingle();
  const folvyLocationId = locMap?.location_id ?? null;

  // channel_id por slug (cache simple por slug → id).
  const channelIdBySlug = new Map<string, string | null>();
  async function resolveChannelId(slug: string | null): Promise<string | null> {
    if (!slug) return null;
    if (channelIdBySlug.has(slug)) return channelIdBySlug.get(slug) ?? null;
    const { data } = await sb.from("sales_channel").select("id")
      .eq("account_id", accountId).eq("slug", slug).maybeSingle();
    const id = data?.id ?? null;
    channelIdBySlug.set(slug, id);
    return id;
  }

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
        // Marca/local CRUDOS para resolve_sale_brand_from_map (best-effort: la API
        // de bills puede no traer locationBrandId; si falta, los no-combo casan por
        // matrícula igualmente y resolve_sale_brand_from_map aplica su respaldo).
        const externalBrandText = bill?.locationBrandId ?? bill?.brandId ?? null;

        if (dryRun) { stats.sales_written++; stats.lines_written += products.length; continue; }

        const channelId = await resolveChannelId(slug);

        const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
          account_id: accountId, source: "lastapp", external_ref: billId,
          external_channel_text: payType, channel_id: channelId,
          external_brand_text: externalBrandText, external_location_text: lastLocId,
          location_id: folvyLocationId,
          sold_at: bill.creationTime ?? bill.finalizingTime,
          total: typeof bill.total === "number" ? bill.total / 100 : 0,
          delivery_cost: typeof bill.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
          discount_amount: typeof bill.discountTotal === "number" ? bill.discountTotal / 100 : null,
          raw_products: JSON.stringify(products), is_active: true,
        }).select("id").single();
        if (saleErr || !saleRow) { stats.errors.push(`sale insert ${billId}: ${saleErr?.message}`); continue; }

        // Casado canónico: el motor arma las líneas, resuelve marca, costea y consume.
        const { error: rpErr } = await sb.rpc("reprocess_sale", { p_sale_id: saleRow.id });
        if (rpErr) {
          stats.errors.push(`reprocess ${billId}: ${rpErr.message}`);
          await sb.from("sale").delete().eq("id", saleRow.id); // no dejar venta huérfana
          continue;
        }

        // Stats de líneas resultantes (producto).
        const { data: lns } = await sb.from("sale_line")
          .select("menu_item_id, line_type").eq("sale_id", saleRow.id);
        const prod = (lns ?? []).filter((l: any) => (l.line_type ?? "product") === "product");
        stats.lines_written += prod.length;
        stats.lines_unresolved += prod.filter((l: any) => !l.menu_item_id).length;
        stats.sales_written++;
      }
      day = nextDay(day);
    }
    return jsonResponse({ ok: true, dry_run: dryRun, ...stats });
  } catch (e) {
    return jsonResponse({ error: String(e), partial: stats }, 500);
  }
});
