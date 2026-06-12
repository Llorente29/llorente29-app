// supabase/functions/lastapp-webhook/index.ts
//
// FRONTERA de ingesta de Last.app (principio de frontera única).
// ============================================================================
// Escucha `tab:closed` (cuenta cerrada = venta definitiva). Resuelve la CABECERA
// de la venta (marca/canal/local), inserta la `sale` cruda y DELEGA las líneas al
// MOTOR (adapt_lastapp_order + compute_sale_line_cost + compute_sale_line_consumption).
//
// RESOLUCIÓN DE MARCA (corregido 12/06):
//   1) PRIMARIO  -> external_brand_map por (locationId + locationBrandId) del TICKET.
//                   Id estable, SIEMPRE presente en el ticket, NO depende del catálogo.
//   2) RESPALDO  -> por producto -> catálogo -> nombre de marca (método viejo).
//                   Frágil: falla si el producto del ticket no está en el catálogo
//                   cargado. Antes era el ÚNICO método, lo que dejaba ventas sin
//                   marca aunque el ticket trajera el locationBrandId y el mapa
//                   tuviera la traducción. Ahora es solo respaldo.
//
// Además, el insert guarda SIEMPRE external_brand_text / external_location_text /
// raw_tab (raw event store en tiempo real), de modo que recasar por mapa
// (resolve_sale_brand_from_map / reprocess_sale) es posible sin depender de
// backfills posteriores.
//
// La frontera NO casa líneas ni escribe sale_line. Eso es trabajo del adaptador.
// Añadir otro TPV = otra frontera (su webhook + token) + su adaptador; motor intacto.
//
// Idempotencia: external_ref = bill.id. El adaptador es idempotente por venta.
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
  id?: string; locationId?: string; locationBrandId?: string | null; // ⟵ CAMBIO: marca del ticket
  source?: string; pickupType?: string | null;
  closeTime?: string; creationTime?: string; products?: LastProduct[]; bills?: LastBill[];
}

// ── Caché mínima: SOLO lo que la frontera necesita para la CABECERA de la venta ──
interface HeaderCaches {
  catalogByCatProd: Map<string, { lastapp_brand_name: string | null }>;
  brandByName: Map<string, string>;
  brandByExternalId: Map<string, string>;   // ⟵ CAMBIO: mapa estable "locId|brandId" -> brand_id
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

  // ⟵ CAMBIO: external_brand_map = FUENTE PRIMARIA de marca.
  // Clave compuesta "external_location_id|external_brand_id" -> brand_id.
  // Solo source=lastapp, no ignoradas, con brand_id resuelto.
  const brandMap = await loadAllPaged(sb, "external_brand_map",
    "external_location_id, external_brand_id, brand_id, is_ignored, source", "account_id", accountId);
  const brandByExternalId = new Map<string, string>();
  for (const m of brandMap) {
    if (m.source !== "lastapp") continue;
    if (m.is_ignored === true) continue;
    if (!m.brand_id) continue;
    const key = `${m.external_location_id}|${m.external_brand_id}`;
    brandByExternalId.set(key, m.brand_id as string);
  }

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

  return { catalogByCatProd, brandByName, brandByExternalId, channelBySlug, folvyLocationId };
}

// ⟵ CAMBIO: resolución de marca en DOS PASOS.
//   1) PRIMARIO: por locationId+locationBrandId del TICKET vía external_brand_map.
//      Estable, siempre presente, no depende del catálogo.
//   2) RESPALDO: por producto -> catálogo -> nombre (método viejo, solo si falla 1).
function resolveSaleBrand(
  tab: LastTab, products: LastProduct[], caches: HeaderCaches,
): string | null {
  // 1) PRIMARIO
  const extLoc = tab.locationId ?? null;
  const extBrand = tab.locationBrandId ?? null;
  if (extLoc && extBrand) {
    const fromMap = caches.brandByExternalId.get(`${extLoc}|${extBrand}`);
    if (fromMap) return fromMap;
  }
  // 2) RESPALDO
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
  const saleBrandId = resolveSaleBrand(tab, products, caches); // ⟵ CAMBIO: pasa tab (id del ticket)

  // 1) Insertar la SALE (cabecera + economía + raw_products + raw_tab). SIN líneas.
  const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
    account_id: accountId,
    source: "lastapp",
    external_ref: String(billId),
    external_channel_text: payType,
    channel_id: channelId,
    brand_id: saleBrandId,
    location_id: caches.folvyLocationId,
    external_brand_text: tab.locationBrandId ?? null,   // ⟵ CAMBIO: id crudo de marca del ticket
    external_location_text: tab.locationId ?? null,     // ⟵ CAMBIO: id crudo de local del ticket
    sold_at: bill.creationTime ?? bill.finalizingTime ?? tab.closeTime ?? new Date().toISOString(),
    total: typeof bill.total === "number" ? bill.total / 100 : 0,
    delivery_cost: typeof bill.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
    discount_amount: typeof bill.discountTotal === "number" ? bill.discountTotal / 100 : null,
    tax: typeof bill.tax === "number" ? bill.tax / 100 : null,
    taxable_base: typeof bill.taxableBase === "number" ? bill.taxableBase / 100 : null,
    service_type: mapServiceType(tab.pickupType),
    raw_products: JSON.stringify(products),
    raw_tab: JSON.stringify(tab),                       // ⟵ CAMBIO: raw event store en tiempo real
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

  // 4) Descontar el CONSUMO TEÓRICO de cada línea PRODUCTO (ventas × escandallo).
  //    SIEMPRE después del coste (solo descuenta si la línea tiene computed_cost).
  //    Motor puro e idempotente. RESILIENTE: si una línea falla, log y sigue; NUNCA
  //    tumba la ingesta (la venta y su coste ya están dentro; el consumo es
  //    recuperable con el botón "Recalcular consumo").
  if (!plErr) {
    for (const l of prodLines ?? []) {
      const { error: kErr } = await sb.rpc("compute_sale_line_consumption", { p_sale_line_id: (l as { id: string }).id });
      if (kErr) console.error(`compute_sale_line_consumption ${(l as { id: string }).id}: ${kErr.message}`);
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
