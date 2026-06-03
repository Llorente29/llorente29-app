// supabase/functions/lastapp-webhook/index.ts
// FASE 2: receptor de webhooks de Last.app que INGIERE ventas.
//
// Escucha el evento `tab:closed` (cuenta cerrada = venta definitiva). El payload
// trae la tab completa con products[] (organizationProductId, name, quantity,
// price) y bills[] (id, total, payments[].type) EMBEBIDOS, así que NO llamamos a
// la API de Last: resolvemos en memoria e insertamos sale + sale_line.
//
// Captura económica del bill: total, deliveryFee (envío al cliente), discountTotal
// (promos), tax y taxableBase (IVA y base imponible) + service_type del pickupType.
//
// La lógica de resolución (vía organizationProductId / catalogProductId / nombre,
// con desambiguación por marca) y la inserción idempotente (external_ref = bill.id,
// rollback manual de la sale si fallan sus líneas, céntimos/100) se PORTAN tal cual
// desde scripts/backfill-sales.mjs — misma verdad, no se reimplementa.
//
// map_source refleja el METODO de resolución de la línea (no el canal):
//   'pos'      -> resuelta por ID determinista (organizationProductId / catálogo)
//   'fuzzy'    -> resuelta por nombre
//   'unmapped' -> no resuelta
// (valores permitidos por el CHECK sale_line_map_source_valid:
//  unmapped, manual, ai, fuzzy, pos).
//
// Otros eventos (bill:created, bill:deleted, etc.) se siguen registrando en
// lastapp_webhook_log (compatibilidad con la Fase 1) y se responde 200.
//
// SEGURIDAD: Last NO firma los webhooks (x-last-signature llega null) y manda un
// header `authorization` fijo. Validamos ese token contra el secret
// LASTAPP_WEBHOOK_TOKEN antes de procesar. Sin token válido -> 401.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Helpers de normalización / canal (idénticos al backfill) ──
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

// Mapea el `pickupType` que envía Last (cabecera del tab) al service_type de Folvy.
// 'delivery'    = reparto de plataforma (Glovo/Uber con su flota)  -> 'platform_delivery'
// 'ownDelivery' = reparto propio (lo reparte el partner)           -> 'own_delivery'
// 'pickup'/'takeaway' = recogida en tienda                         -> 'pickup'
// Cualquier otro valor o ausencia -> null (no se inventa el reparto).
function mapServiceType(pickupType: string | null | undefined): string | null {
  if (!pickupType) return null;
  const t = pickupType.toLowerCase();
  if (t === "delivery") return "platform_delivery";
  if (t === "owndelivery") return "own_delivery";
  if (t === "pickup" || t === "takeaway") return "pickup";
  return null;
}

// ── Tipos mínimos del payload tab:closed que usamos ──
interface LastProduct {
  name?: string;
  quantity?: number;
  price?: number;
  catalogProductId?: string | null;
  organizationProductId?: string | null;
}
interface LastPayment { type?: string | null }
interface LastBill {
  id?: string;
  total?: number;
  deliveryFee?: number;
  discountTotal?: number;
  tax?: number;          // IVA del pedido (céntimos) — Last.app
  taxableBase?: number;  // Base imponible (céntimos) — Last.app
  creationTime?: string;
  finalizingTime?: string;
  deleted?: boolean;
  payments?: LastPayment[];
}
interface LastTab {
  id?: string;
  locationId?: string;
  source?: string;
  pickupType?: string | null;
  closeTime?: string;
  creationTime?: string;
  products?: LastProduct[];
  bills?: LastBill[];
}

// ── Caches en memoria (mismas tablas que loadCaches del backfill) ──
interface Caches {
  catalogByCatProd: Map<string, { organization_product_id: string; lastapp_brand_name: string | null }>;
  recipeByOrgProd: Map<string, string>;
  menuItemsByChannelRecipe: Map<string, { menu_item_id: string; brand_id: string }[]>;
  menuItemsByChannelName: Map<string, { menu_item_id: string; brand_id: string }[]>;
  channelBySlug: Map<string, string>;
  brandByName: Map<string, string>;
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

async function loadCaches(sb: SupabaseClient, accountId: string, lastLocationId: string): Promise<Caches> {
  const catalog = await loadAllPaged(sb, "lastapp_catalog_product",
    "catalog_product_id, organization_product_id, lastapp_brand_name", "account_id", accountId);
  const catalogByCatProd = new Map<string, { organization_product_id: string; lastapp_brand_name: string | null }>();
  for (const r of catalog) {
    if (r.catalog_product_id) {
      catalogByCatProd.set(r.catalog_product_id as string, {
        organization_product_id: r.organization_product_id as string,
        lastapp_brand_name: (r.lastapp_brand_name as string | null) ?? null,
      });
    }
  }

  const productMap = await loadAllPaged(sb, "lastapp_product_map",
    "organization_product_id, recipe_item_id", "account_id", accountId);
  const recipeByOrgProd = new Map<string, string>();
  for (const r of productMap) {
    if (r.organization_product_id && r.recipe_item_id) {
      recipeByOrgProd.set(r.organization_product_id as string, r.recipe_item_id as string);
    }
  }

  const menuItems = await loadAllPaged(sb, "menu_item",
    "id, brand_id, channel_id, recipe_item_id, name, archived_at", "account_id", accountId);
  const menuItemsByChannelRecipe = new Map<string, { menu_item_id: string; brand_id: string }[]>();
  const menuItemsByChannelName = new Map<string, { menu_item_id: string; brand_id: string }[]>();
  for (const m of menuItems) {
    if (m.archived_at) continue;
    if (!m.brand_id || !m.channel_id) continue;
    if (m.recipe_item_id) {
      const k = `${m.channel_id}|${m.recipe_item_id}`;
      if (!menuItemsByChannelRecipe.has(k)) menuItemsByChannelRecipe.set(k, []);
      menuItemsByChannelRecipe.get(k)!.push({ menu_item_id: m.id as string, brand_id: m.brand_id as string });
    }
    const nk = normalize(m.name as string);
    if (nk) {
      const k = `${m.channel_id}|${nk}`;
      if (!menuItemsByChannelName.has(k)) menuItemsByChannelName.set(k, []);
      menuItemsByChannelName.get(k)!.push({ menu_item_id: m.id as string, brand_id: m.brand_id as string });
    }
  }

  const channels = await loadAllPaged(sb, "sales_channel", "id, slug, is_active", "account_id", accountId);
  const channelBySlug = new Map<string, string>();
  for (const c of channels) {
    if (c.is_active === false) continue;
    if (c.slug) channelBySlug.set((c.slug as string).toLowerCase(), c.id as string);
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

  const { data: locMap, error: locErr } = await sb.from("lastapp_location_map")
    .select("location_id").eq("account_id", accountId)
    .eq("lastapp_location_id", lastLocationId).maybeSingle();
  if (locErr) throw new Error(`lastapp_location_map: ${locErr.message}`);
  const folvyLocationId = (locMap?.location_id as string | undefined) ?? null;

  return {
    catalogByCatProd, recipeByOrgProd, menuItemsByChannelRecipe,
    menuItemsByChannelName, channelBySlug, brandByName, folvyLocationId,
  };
}

// ── Resolución de una línea (lógica del backfill + atajo por organizationProductId) ──
interface ResolveResult { menuItemId: string | null; brandId: string | null; via: string | null }

function resolveLine(product: LastProduct, channelId: string | null, caches: Caches): ResolveResult {
  if (!channelId) return { menuItemId: null, brandId: null, via: null };

  const catEntry = product.catalogProductId
    ? caches.catalogByCatProd.get(product.catalogProductId) ?? null
    : null;

  // --- Vía 1: por ID. El webhook trae organizationProductId DIRECTO (atajo);
  //     si no, caemos al catalogProductId -> organization_product_id como el backfill. ---
  const orgProdId = product.organizationProductId ?? catEntry?.organization_product_id ?? null;
  if (orgProdId) {
    const recipeId = caches.recipeByOrgProd.get(orgProdId);
    if (recipeId) {
      const candidates = caches.menuItemsByChannelRecipe.get(`${channelId}|${recipeId}`);
      if (candidates && candidates.length === 1) {
        return { menuItemId: candidates[0].menu_item_id, brandId: candidates[0].brand_id, via: "id" };
      }
      if (candidates && candidates.length > 1) {
        const brandIdFromName = caches.brandByName.get(normalize(catEntry?.lastapp_brand_name));
        const match = brandIdFromName ? candidates.find((c) => c.brand_id === brandIdFromName) : null;
        if (match) return { menuItemId: match.menu_item_id, brandId: match.brand_id, via: "id" };
      }
    }
  }

  // --- Vía 2: fallback por nombre ---
  const nameKey = normalize(product.name ?? "");
  if (!nameKey) return { menuItemId: null, brandId: null, via: null };
  const nameCands = caches.menuItemsByChannelName.get(`${channelId}|${nameKey}`);
  if (!nameCands || nameCands.length === 0) return { menuItemId: null, brandId: null, via: null };
  if (nameCands.length === 1) {
    return { menuItemId: nameCands[0].menu_item_id, brandId: nameCands[0].brand_id, via: "name" };
  }
  const brandIdFromName = catEntry ? caches.brandByName.get(normalize(catEntry.lastapp_brand_name)) : null;
  const match = brandIdFromName ? nameCands.find((c) => c.brand_id === brandIdFromName) : null;
  if (match) return { menuItemId: match.menu_item_id, brandId: match.brand_id, via: "name" };
  return { menuItemId: null, brandId: null, via: null };
}

// map_source válido según la vía de resolución (CHECK: unmapped|manual|ai|fuzzy|pos).
//   'id'   -> 'pos'   (match determinista por TPV)
//   'name' -> 'fuzzy' (match por nombre)
//   null   -> 'unmapped'
function mapSourceFromVia(via: string | null): "pos" | "fuzzy" | "unmapped" {
  if (via === "id") return "pos";
  if (via === "name") return "fuzzy";
  return "unmapped";
}

// ── Inserción idempotente de un bill como sale + sale_line ──
async function ingestBill(
  sb: SupabaseClient, accountId: string, bill: LastBill, tab: LastTab, caches: Caches,
): Promise<{ written: boolean; reason?: string }> {
  const billId = bill.id;
  if (!billId) return { written: false, reason: "no bill id" };
  if (bill.deleted === true) return { written: false, reason: "bill deleted" };

  // Idempotencia: misma clave que el backfill (external_ref = bill.id) -> nunca duplica.
  const { data: exists, error: exErr } = await sb.from("sale").select("id")
    .eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_ref", String(billId)).limit(1).maybeSingle();
  if (exErr) throw new Error(`exists check ${billId}: ${exErr.message}`);
  if (exists) return { written: false, reason: "already exists" };

  // Canal: por payments[].type del bill (igual que el backfill). El producto de
  // la tab vive en tab.products[]; el bill referencia el mismo conjunto.
  const payType = bill.payments?.[0]?.type ?? tab.source ?? null;
  const slug = channelSlug(payType);
  const channelId = slug ? (caches.channelBySlug.get(slug) ?? null) : null;
  const products = Array.isArray(tab.products) ? tab.products : [];

  const resolvedLines: Record<string, unknown>[] = [];
  let saleBrandId: string | null = null;
  for (const p of products) {
    const r = resolveLine(p, channelId, caches);
    if (r.brandId && !saleBrandId) saleBrandId = r.brandId;
    resolvedLines.push({
      raw_text: p.name ?? "",
      product_name: p.name ?? "",
      quantity: typeof p.quantity === "number" ? p.quantity : 1,
      unit_price: typeof p.price === "number" ? p.price / 100 : null,
      menu_item_id: r.menuItemId,
      map_source: mapSourceFromVia(r.via),
      map_needs_review: r.menuItemId ? false : true,
    });
  }

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

  if (resolvedLines.length > 0) {
    const lineRows = resolvedLines.map((l) => ({ ...l, account_id: accountId, sale_id: saleRow.id }));
    const { error: lineErr } = await sb.from("sale_line").insert(lineRows);
    if (lineErr) {
      const { error: delErr } = await sb.from("sale").delete().eq("id", saleRow.id);
      const note = delErr ? ` (rollback falló: ${delErr.message})` : "";
      throw new Error(`sale_line insert ${billId}: ${lineErr.message}${note}`);
    }
  }
  return { written: true };
}

// ── Entrada HTTP ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  // SEGURIDAD: validar el token fijo que manda Last en `authorization`.
  // Si LASTAPP_WEBHOOK_TOKEN no está configurado, NO bloqueamos (modo
  // compatibilidad), pero lo dejamos avisado en el log.
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

  // Solo tab:closed ingiere ventas. El resto se registra (compat Fase 1).
  if (eventType === "tab:closed") {
    note = "fase2-tab-closed";
    try {
      const tab = (payload?.data ?? {}) as LastTab;
      const lastLocationId = tab.locationId ?? null;
      if (!lastLocationId) throw new Error("tab:closed sin locationId");

      // account_id de la cuenta dueña de esta last-location (vía mapa).
      const { data: locRow, error: locErr } = await sb.from("lastapp_location_map")
        .select("account_id").eq("lastapp_location_id", lastLocationId).maybeSingle();
      if (locErr) throw new Error(`lastapp_location_map: ${locErr.message}`);
      const accountId = (locRow?.account_id as string | undefined) ?? null;
      if (!accountId) throw new Error(`location ${lastLocationId} no mapeada a ninguna cuenta`);

      const caches = await loadCaches(sb, accountId, lastLocationId);
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

  // Log SIEMPRE (auditoría): payload crudo + resultado del procesado.
  try {
    await sb.from("lastapp_webhook_log").insert({
      headers,
      payload,
      note,
      processed: processedOk,
    });
  } catch (e) {
    console.error("log insert error", e);
  }

  // Responder 200 SIEMPRE para que Last considere el evento entregado, incluso
  // si nuestro procesado falló (lo reintentaremos desde el log, no que Last
  // reenvíe en bucle). Si quisiéramos que Last reintente, devolveríamos 5xx.
  return new Response(JSON.stringify({ ok: true, event: eventType, processed: processedOk, error: processError }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
