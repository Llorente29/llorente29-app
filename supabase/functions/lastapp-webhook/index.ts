// supabase/functions/lastapp-webhook/index.ts
//
// FRONTERA de ingesta de Last.app (principio de frontera única).
// ============================================================================
// Escucha `tab:closed` (cuenta cerrada = venta definitiva). Su trabajo es de
// FRONTERA, no de motor:
//   1) valida el token de Last.app (autorización en la entrada)
//   2) resuelve la CABECERA de la venta (marca, canal, local, economía) e inserta
//      la `sale` cruda (con raw_products embebido)
//   3) DELEGA la construcción de las líneas al MOTOR: adapt_lastapp_order(sale)
//      descompone raw_products en la jerarquía canónica (product/modifier/combo_item),
//      y compute_sale_line_cost calcula el coste de cada línea producto.
//
// La frontera NO casa líneas ni escribe sale_line. Eso es trabajo del adaptador
// (única forma de poblar líneas, compartida con el backfill). Añadir otro TPV =
// otra frontera (su webhook + su token) + su adaptador; el motor no se toca.
//
// El motor (adapt_lastapp_order, compute_sale_line_cost) es MOTOR PURO sin guard
// de usuario: confía en que esta frontera ya autorizó (token validado). Por eso
// se invoca con service_role sin problema (migración 20260608T2800).
//
// Idempotencia: external_ref = bill.id (no duplica). El adaptador es idempotente
// por venta (borra y reconstruye sus líneas, respeta 'manual'/ignored/delisted).
//
// SEGURIDAD: Last NO firma; manda un `authorization` fijo. Validamos contra
// LASTAPP_WEBHOOK_TOKEN. Sin token válido -> 401.
//
// DEPLOY: SIEMPRE con --no-verify-jwt (webhook externo; sin el flag el gateway
// corta con 401 antes de ejecutar y la ingesta falla en silencio).

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Normalización (idéntica al adaptador y al catálogo) ──
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

function channelSlug(paymentType: string | null | undefined): string | null {
  if (!paymentType) return null;
  const t = paymentType.toLowerCase();
  if (t.includes("glovo")) return "glovo";
  if (t.includes("uber")) return "uber";
  if (t.includes("justeat") || t.includes("just_eat") || t.includes("just eat")) return "justeat";
  if (t.includes("shop") || t.includes("local") || t.includes("onsite")) return "shop";
  return null;
}

function mapServiceType(pickupType: string | null | undefined): string | null {
  if (!pickupType) return null;
  const t = pickupType.toLowerCase();
  if (t === "delivery") return "platform_delivery";
  if (t === "owndelivery") return "own_delivery";
  if (t === "pickup" || t === "takeaway") return "pickup";
  return null;
}

// ── Tipos mínimos del payload ──
interface LastProduct {
  name?: string;
  quantity?: number;
  price?: number;
  catalogProductId?: string | null;
  organizationProductId?: string | null;
}
interface LastPayment { type?: string | null }
interface LastBill {
  id?: string; total?: number; deliveryFee?: number; discountTotal?: number;
  tax?: number; taxableBase?: number; creationTime?: string; finalizingTime?: string;
  deleted?: boolean; payments?: LastPayment[];
}
interface LastTab {
  id?: string; locationId?: string; source?: string; pickupType?: string | null;
  closeTime?: string; creationTime?: string; products?: LastProduct[]; bills?: LastBill[];
}

// ── Caché mínima: SOLO lo que la frontera necesita para la CABECERA de la venta ──
// (marca del ticket, canal, local). La resolución de LÍNEAS ya NO es de la frontera.
interface HeaderCaches {
  catalogByCatProd: Map<string, { lastapp_brand_name: string | null }>;
  brandByName: Map<string, string>;
  channelBySlug: Map<string, string>;
  folvyLocationId: string | null;
}

async function loadAllPaged(
  sb: SupabaseClient, table: string, select: string, eqColumn: string, eqValue: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from(table).select(select)
      .eq(eqColumn, eqValue).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function loadHeaderCaches(sb: SupabaseClient, accountId: string, lastLocationId: string): Promise<HeaderCaches> {
  const catalog = await loadAllPaged(sb, "lastapp_catalog_product",
    "catalog_product_id, lastapp_brand_name", "account_id", accountId);
  const catalogByCatProd = new Map<string, { lastapp_brand_name: string | null }>();
  for (const r of catalog) {
    if (r.catalog_product_id) {
      catalogByCatProd.set(r.catalog_product_id as string, {
        lastapp_brand_name: (r.lastapp_brand_name as string | null) ?? null,
      });
    }
  }

  const brands = await loadAllPaged(sb, "brand", "id, name, is_active", "account_id", accountId);
  const brandByName = new Map<string, string>();
  for (const b of brands) {
    if (b.is_active === false) continue;
    if (b.name && (b.name as string).trim().toUpperCase() === "FOODINT") continue;
    const k = normalize(b.name as string);
    if (k && !brandByName.has(k)) brandByName.set(k, b.id as string);
  }
  const dirtyBurgerId = brandByName.get(normalize("Dirty Burger"));
  if (dirtyBurgerId) brandByName.set(normalize("Dirty Burgers"), dirtyBurgerId);

  const channels = await loadAllPaged(sb, "sales_channel", "id, slug, is_active", "account_id", accountId);
  const channelBySlug = new Map<string, string>();
  for (const c of channels) {
    if (c.is_active === false) continue;
    if (c.slug) channelBySlug.set((c.slug as string).toLowerCase(), c.id as string);
  }

  const { data: locMap, error: locErr } = await sb.from("lastapp_location_map")
    .select("location_id").eq("account_id", accountId)
    .eq("lastapp_location_id", lastLocationId).maybeSingle();
  if (locErr) throw new Error(`lastapp_location_map: ${locErr.message}`);
  const folvyLocationId = (locMap?.location_id as string | undefined) ?? null;

  return { catalogByCatProd, brandByName, channelBySlug, folvyLocationId };
}

// Marca del TICKET: la del primer producto cuyo catalogProductId resuelve a una marca.
// (El catalogProductId es único por marca; un ticket es de una sola marca.) El adaptador
// usará esta brand_id para resolver el menu_item de cada producto.
function resolveSaleBrand(products: LastProduct[], caches: HeaderCaches): string | null {
  for (const p of products) {
    if (!p.catalogProductId) continue;
    const cat = caches.catalogByCatProd.get(p.catalogProductId);
    if (!cat) continue;
    const brandId = caches.brandByName.get(normalize(cat.lastapp_brand_name));
    if (brandId) return brandId;
  }
  return null;
}

// ── Ingesta de un bill: inserta la sale y DELEGA las líneas al adaptador ──
async function ingestBill(
  sb: SupabaseClient, accountId: string, bill: LastBill, tab: LastTab, caches: HeaderCaches,
): Promise<{ written: boolean; reason?: string; lines?: number }> {
  const billId = bill.id;
  if (!billId) return { written: false, reason: "no bill id" };
  if (bill.deleted === true) return { written: false, reason: "bill deleted" };

  // Idempotencia.
  const { data: exists, error: exErr } = await sb.from("sale").select("id")
    .eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_ref", String(billId)).limit(1).maybeSingle();
  if (exErr) throw new Error(`exists check ${billId}: ${exErr.message}`);
  if (exists) return { written: false, reason: "already exists" };

  const payType = bill.payments?.[0]?.type ?? tab.source ?? null;
  const slug = channelSlug(payType);
  const channelId = slug ? (caches.channelBySlug.get(slug) ?? null) : null;
  const products = Array.isArray(tab.products) ? tab.products : [];
  const saleBrandId = resolveSaleBrand(products, caches);

  // 1) Insertar la SALE (cabecera + economía + raw_products). SIN líneas.
  const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
    account_id: accountId,
    source: "lastapp",
    external_ref: String(billId),
    external_channel_text: payType,
    channel_id: channelId,
    brand_id: saleBrandId,
    location_id: caches.folvyLocationId,
    sold_at: bill.creationTime ?? bill.finalizingTime ?? tab.closeTime ?? new Date().toISOString(),
    total: typeof bill.total === "number" ? bill.total / 100 : 0,
    delivery_cost: typeof bill.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
    discount_amount: typeof bill.discountTotal === "number" ? bill.discountTotal / 100 : null,
    tax: typeof bill.tax === "number" ? bill.tax / 100 : null,
    taxable_base: typeof bill.taxableBase === "number" ? bill.taxableBase / 100 : null,
    service_type: mapServiceType(tab.pickupType),
    raw_products: JSON.stringify(products),
    is_active: true,
  }).select("id").single();
  if (saleErr || !saleRow) throw new Error(`sale insert ${billId}: ${saleErr?.message ?? "unknown"}`);

  // 2) DELEGAR al MOTOR: el adaptador descompone raw_products en la jerarquía canónica.
  const { error: adaptErr } = await sb.rpc("adapt_lastapp_order", { p_sale_id: saleRow.id });
  if (adaptErr) {
    // Rollback de la sale: si no podemos poblar líneas, no dejamos una venta huérfana.
    await sb.from("sale").delete().eq("id", saleRow.id);
    throw new Error(`adapt_lastapp_order ${billId}: ${adaptErr.message}`);
  }

  // 3) Calcular el coste de cada línea PRODUCTO (el coste se agrega en el padre).
  const { data: prodLines, error: plErr } = await sb.from("sale_line")
    .select("id").eq("sale_id", saleRow.id).eq("line_type", "product");
  if (plErr) {
    console.error(`coste: no pude listar líneas product de ${billId}: ${plErr.message}`);
  } else {
    for (const l of prodLines ?? []) {
      const { error: cErr } = await sb.rpc("compute_sale_line_cost", { p_sale_line_id: (l as { id: string }).id });
      if (cErr) console.error(`compute_sale_line_cost ${(l as { id: string }).id}: ${cErr.message}`);
    }
  }

  return { written: true, lines: (prodLines ?? []).length };
}

// ── Entrada HTTP (la frontera) ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  // AUTORIZACIÓN EN LA FRONTERA: token fijo de Last.app.
  const expected = Deno.env.get("LASTAPP_WEBHOOK_TOKEN") ?? "";
  const got = headers["authorization"] ?? "";
  if (expected && got !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown> | null = null;
  let rawText = "";
  try {
    rawText = await req.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = { _unparsed: rawText };
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const eventType = (payload?.type as string | undefined) ?? null;
  let note = "fase1-receptor";
  let processedOk = false;
  let processError: string | null = null;

  if (eventType === "tab:closed") {
    note = "frontera-tab-closed";
    try {
      const tab = (payload?.data ?? {}) as LastTab;
      const lastLocationId = tab.locationId ?? null;
      if (!lastLocationId) throw new Error("tab:closed sin locationId");

      const { data: locRow, error: locErr } = await sb.from("lastapp_location_map")
        .select("account_id").eq("lastapp_location_id", lastLocationId).maybeSingle();
      if (locErr) throw new Error(`lastapp_location_map: ${locErr.message}`);
      const accountId = (locRow?.account_id as string | undefined) ?? null;
      if (!accountId) throw new Error(`location ${lastLocationId} no mapeada a ninguna cuenta`);

      const caches = await loadHeaderCaches(sb, accountId, lastLocationId);
      const bills = Array.isArray(tab.bills) ? tab.bills : [];
      for (const bill of bills) {
        await ingestBill(sb, accountId, bill, tab, caches);
      }
      processedOk = true;
    } catch (e) {
      processError = e instanceof Error ? e.message : String(e);
      console.error("tab:closed ingest error", processError);
    }
  }

  // Log SIEMPRE (auditoría).
  try {
    await sb.from("lastapp_webhook_log").insert({ headers, payload, note, processed: processedOk });
  } catch (e) {
    console.error("log insert error", e);
  }

  // 200 SIEMPRE (Last considera entregado; reprocesamos desde el log si algo falló).
  return new Response(JSON.stringify({ ok: true, event: eventType, processed: processedOk, error: processError }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
