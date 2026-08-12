// supabase/functions/last-catalog-sync/index.ts
//
// ENCARGO `last-catalog-sync` v2 (SOLO LECTURA sobre Last.app; NO escribe en
// Last; NO toca HubRise). Puebla `external_catalog_product` — el espejo de
// disponibilidad que YA EXISTÍA (no se crea tabla nueva) — con sellos de
// antigüedad: disabled_since / missing_since / last_synced_at.
//
// RUTA CONFIRMADA (12/08, ver lastapp-set-price/index.ts, en producción
// desde julio):
//   GET /catalogs/{catalogId}   headers: Authorization: Bearer, locationID
//   -> categories[].products[] con: id, name, price, enabled,
//      organizationProductId, type…
// No hay lista paginada de productos por local: se recorren CATÁLOGOS. Una
// marca puede tener VARIOS catálogos por local (carta base + canal) — se
// recorren TODOS o el espejo dice "disponible" cuando en Glovo está caído.
//
// UPSERT ONLY. NUNCA se borra una fila: lastapp-webhook lee esta tabla en
// cada pedido (catalogByCatProd) para resolver la marca del ticket. Un
// producto que desaparece del catálogo se marca con missing_since, nunca
// se elimina — borrar rompería la ingesta de pedidos en vivo.
//
// Sellos (lo que da valor al informe, no solo el estado actual):
//   disabled_since: sella en la transición enabled true->false. Mientras
//                   siga false NO se toca (es la antigüedad del agotado).
//   missing_since : sella (solo si estaba null) en las filas del local NO
//                   vistas en esta pasada. Se limpia a null si reaparece.
//   last_synced_at: se refresca SIEMPRE en cada producto visto — es lo que
//                   vigila el watchdog de espejo rancio.
//
// Auth de entrada dual + patrón de token: igual que lastapp-catalog-import.
// Deploy: --no-verify-jwt (lo invoca un cron con secreto interno).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Local (no ../_shared/cors.ts): el bundler de deploy no resuelve imports
// fuera de la carpeta de la función.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LASTAPP_BASE = "https://api.last.app/v2";

// ── Ritmo (límite Last: 15 req/s) ──
const MIN_INTERVAL_MS = 80; // ~12.5 req/s
const MAX_RETRIES_429 = 5;
let lastCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

interface FolvyClaims {
  is_platform_admin?: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeFolvyClaims(jwt: string): FolvyClaims {
  try {
    const payload = jwt.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json);
    return (parsed.folvy ?? {}) as FolvyClaims;
  } catch {
    return {};
  }
}

async function lastFetchRaw(
  path: string,
  token: string,
  headers: Record<string, string>,
): Promise<{ status: number; ok: boolean; body: any; bodyText: string | null }> {
  let attempt = 0;
  while (true) {
    await throttle();
    try {
      const res = await fetch(`${LASTAPP_BASE}${path}`, {
        headers: { "Authorization": `Bearer ${token}`, ...headers },
      });
      if (res.status === 429 && attempt < MAX_RETRIES_429) {
        attempt++;
        await res.text().catch(() => {});
        await sleep(300 * attempt);
        continue;
      }
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // no era JSON
      }
      return { status: res.status, ok: res.ok, body, bodyText: body === null ? text.slice(0, 300) : null };
    } catch (e) {
      return { status: 0, ok: false, body: null, bodyText: String(e) };
    }
  }
}

async function lastGet(path: string, token: string, headers: Record<string, string>): Promise<any> {
  const r = await lastFetchRaw(path, token, headers);
  if (!r.ok) throw new Error(`Last.app ${path} -> ${r.status} ${r.bodyText ?? ""}`);
  return r.body;
}

function extractList(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  for (const key of ["value", "items", "data", "products", "results"]) {
    if (Array.isArray(json[key])) return json[key];
  }
  return [];
}

async function resolveToken(sb: SupabaseClient, accountId: string, orgId: string): Promise<{ token: string } | { error: string }> {
  const { data: integ, error } = await sb
    .from("external_integration")
    .select("token_secret_name")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_org_id", orgId)
    .maybeSingle();
  if (error) return { error: `external_integration: ${error.message}` };
  if (!integ) return { error: "Integration not found for that account_id/external_org_id" };
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return { error: `Secret ${integ.token_secret_name} not set` };
  return { token };
}

// ── Recorre brands[].catalogs (puede anidar por canal) y devuelve un mapa
//    catalogId -> {brand, channel} de MEJOR ESFUERZO (no autoritativo: ver
//    nota en resolveLocationCatalogs). "todos los catálogos, no solo
//    default" — una marca puede tener varios (carta base + canal). ──
function collectBrandChannelByCatalog(brands: any[]): Map<string, { brand: string; channel: string }> {
  const out = new Map<string, { brand: string; channel: string }>();
  for (const b of brands ?? []) {
    const brandName: string = b?.name ?? "";
    const cats = b?.catalogs ?? {};
    const walk = (v: any, channel: string) => {
      if (typeof v === "string" && v) {
        if (!out.has(v)) out.set(v, { brand: brandName, channel });
      } else if (v && typeof v === "object") {
        for (const vv of Object.values(v)) walk(vv, channel);
      }
    };
    for (const [chKey, v] of Object.entries(cats)) walk(v, chKey);
  }
  return out;
}

// Infiere el canal a partir del nombre del catálogo (fallback cuando el walk
// de brands[] no lo mapea — mismo heurístico que lastapp-sync-catalog).
function channelFromName(name: string | null | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (n.includes("glovo")) return "glovo";
  if (n.includes("uber")) return "uber";
  if (n.includes("just")) return "justeat";
  if (n.includes("deliveroo")) return "deliveroo";
  return "unknown";
}

// ── Lista AUTORITATIVA de catálogos de un local: GET /catalogs?locationId=.
//    El walk de brands[].catalogs (vía /locations/{id}) NO es exhaustivo por
//    sí solo — verificado en vivo el 12/08 contra Foodint Carabanchel: el
//    walk encontró 8 catálogos (208 productos) cuando la medición a mano
//    (y /catalogs?locationId=) dan la carta completa. Mismo patrón que
//    lastapp-sync-catalog: /catalogs?locationId= manda; brands[].catalogs
//    solo aporta la etiqueta de marca/canal cuando la tiene. ──
async function resolveLocationCatalogs(
  token: string,
  locationExtId: string,
): Promise<{ catalogMap: Map<string, { brand: string; channel: string }>; debug: any }> {
  const [catsResp, detail] = await Promise.all([
    lastGet(`/catalogs?locationId=${locationExtId}`, token, { "LocationID": locationExtId }),
    lastGet(`/locations/${locationExtId}`, token, { "LocationID": locationExtId }),
  ]);
  const brandChannelByCatalog = collectBrandChannelByCatalog(Array.isArray(detail?.brands) ? detail.brands : []);

  const rawList = extractList(catsResp);
  const catalogMap = new Map<string, { brand: string; channel: string }>();
  const deletedCount = rawList.filter((c) => c?.deleted === true).length;
  for (const c of rawList) {
    if (!c?.id || c?.deleted === true) continue;
    const mapped = brandChannelByCatalog.get(c.id);
    catalogMap.set(String(c.id), mapped ?? { brand: c.name ?? "", channel: channelFromName(c.name) });
  }
  // Diagnóstico temporal (12/08): comprobar si /catalogs?locationId= viene
  // paginado (metadatos de totalCount/total/count por encima del array
  // devuelto) o si el array crudo ya trae menos de lo esperado.
  const debug = {
    catsResp_is_array: Array.isArray(catsResp),
    catsResp_keys: catsResp && typeof catsResp === "object" && !Array.isArray(catsResp) ? Object.keys(catsResp) : null,
    raw_list_length: rawList.length,
    deleted_count: deletedCount,
    total_hint: (catsResp && typeof catsResp === "object" && !Array.isArray(catsResp))
      ? (catsResp.totalCount ?? catsResp.total ?? catsResp.count ?? null)
      : null,
    brands_count: Array.isArray(detail?.brands) ? detail.brands.length : 0,
  };
  return { catalogMap, debug };
}

type ExistingRow = {
  catalog_product_id: string;
  is_enabled: boolean | null;
  disabled_since: string | null;
  disabled_since_known: boolean | null;
  missing_since: string | null;
  last_synced_at: string | null;
};

// ── Colapsa las filas de catálogo agotadas por organization_product_id (el
//    MISMO producto puede tener varias filas: una por catálogo/canal — carta
//    base y Glovo, p.ej.) y cruza con menu_item para saber cuántas de ellas
//    están EN Folvy. Un producto agotado en un solo catálogo (solo en Glovo,
//    p.ej.) SIGUE contando como agotado — es agotado POR CANAL, no un error;
//    se conserva el detalle de en qué canales está caído (channels_disabled),
//    lo usará la pantalla ("en Glovo" vs "en toda la carta"). Combos u otros
//    productos sin organizationProductId quedan fuera de este colapso (deuda
//    conocida, no resuelta aquí). ──
async function summarizeDisabledProducts(
  sb: SupabaseClient,
  accountId: string,
  rows: any[],
): Promise<any> {
  const catalogRowsDisabled = rows.filter((r) => r.is_enabled === false).length;

  const byProduct = new Map<string, {
    product_name: string | null;
    brand_name: string | null;
    channels_disabled: Set<string>;
    catalog_rows: number;
    rows_disabled: number;
  }>();
  for (const r of rows) {
    const orgProdId = r.organization_product_id as string | null;
    if (!orgProdId) continue;
    let g = byProduct.get(orgProdId);
    if (!g) {
      g = { product_name: null, brand_name: null, channels_disabled: new Set(), catalog_rows: 0, rows_disabled: 0 };
      byProduct.set(orgProdId, g);
    }
    g.catalog_rows++;
    if (r.is_enabled === false) {
      g.rows_disabled++;
      g.product_name = g.product_name ?? r.product_name;
      g.brand_name = g.brand_name ?? r.external_brand_name;
      if (r.external_channel) g.channels_disabled.add(r.external_channel);
    }
  }

  const disabledOrgProdIds = [...byProduct.entries()].filter(([, g]) => g.rows_disabled > 0).map(([id]) => id);

  const inFolvySet = new Set<string>();
  if (disabledOrgProdIds.length > 0) {
    const { data: items, error } = await sb
      .from("menu_item")
      .select("external_id")
      .eq("account_id", accountId)
      .eq("external_source", "lastapp")
      .is("archived_at", null)
      .in("external_id", disabledOrgProdIds);
    if (error) throw new Error(`select menu_item (summary): ${error.message}`);
    for (const it of items ?? []) inFolvySet.add(it.external_id as string);
  }

  const productsInFolvy = disabledOrgProdIds
    .filter((id) => inFolvySet.has(id))
    .map((id) => {
      const g = byProduct.get(id)!;
      return {
        organization_product_id: id,
        product_name: g.product_name,
        brand_name: g.brand_name,
        catalog_rows: g.catalog_rows,
        rows_disabled: g.rows_disabled,
        fully_disabled: g.rows_disabled === g.catalog_rows,
        channels_disabled: [...g.channels_disabled],
      };
    });

  return {
    catalog_rows_disabled: catalogRowsDisabled,
    distinct_products_disabled: disabledOrgProdIds.length,
    distinct_products_disabled_in_folvy: productsInFolvy.length,
    products_in_folvy: productsInFolvy,
  };
}

async function syncLocation(
  sb: SupabaseClient,
  accountId: string,
  orgId: string,
  token: string,
  locationExtId: string,
  dryRun: boolean,
  nowIso: string,
): Promise<any> {
  const { catalogMap, debug: catalogDebug } = await resolveLocationCatalogs(token, locationExtId);

  // Estado previo del local (TODOS los catálogos), para sellos y para
  // detectar qué ha dejado de verse en esta pasada.
  const { data: existingRows, error: exErr } = await sb
    .from("external_catalog_product")
    .select("catalog_product_id, is_enabled, disabled_since, disabled_since_known, missing_since, last_synced_at")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_location_id", locationExtId);
  if (exErr) throw new Error(`select external_catalog_product: ${exErr.message}`);
  const existingByCatProd = new Map<string, ExistingRow>();
  for (const r of existingRows ?? []) existingByCatProd.set(r.catalog_product_id as string, r as ExistingRow);

  const seenIds = new Set<string>();
  const rows: any[] = [];
  const catalogFailures: any[] = [];
  const stats = {
    catalogs_seen: 0, catalogs_failed: 0, seen: 0, new: 0,
    disabled_now: 0, reappeared: 0, still_disabled: 0,
    first_sync_disabled_unknown: 0, // primer barrido de la fila, agotado sin fecha conocida (§0)
  };

  for (const [catId, info] of catalogMap) {
    try {
      const catalog = await lastGet(`/catalogs/${catId}`, token, { "locationID": locationExtId });
      stats.catalogs_seen++;
      const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
      for (const cat of categories) {
        const products = Array.isArray(cat?.products) ? cat.products : [];
        for (const p of products) {
          const catProdId = p?.id ? String(p.id) : "";
          if (!catProdId) continue;
          seenIds.add(catProdId);
          stats.seen++;

          const enabled = p.enabled !== false;
          const prev = existingByCatProd.get(catProdId);
          // §0 (ENCARGO pantalla-agotados-last): el PRIMER barrido de una
          // fila (nunca tocada por last-catalog-sync, last_synced_at null)
          // NO puede saber desde cuándo lleva agotado un producto que ya
          // viene enabled=false — sellar now() sería una fecha inventada
          // ("agotado desde hoy" para algo caído hace semanas). Se declara
          // desconocido en vez de rellenarlo con un valor plausible.
          const isFirstSync = !prev || prev.last_synced_at === null;
          let disabledSince: string | null;
          let disabledSinceKnown: boolean;
          if (isFirstSync) {
            if (!prev) stats.new++;
            if (enabled) {
              disabledSince = null;
              disabledSinceKnown = true;
            } else {
              disabledSince = null;
              disabledSinceKnown = false;
              stats.first_sync_disabled_unknown++;
            }
          } else if (prev!.is_enabled !== false && !enabled) {
            stats.disabled_now++;
            disabledSince = nowIso;
            disabledSinceKnown = true;
          } else if (prev!.is_enabled === false && enabled) {
            stats.reappeared++;
            disabledSince = null;
            disabledSinceKnown = true;
          } else {
            if (!enabled) stats.still_disabled++;
            disabledSince = prev!.disabled_since;
            disabledSinceKnown = prev!.disabled_since_known ?? true;
          }

          rows.push({
            account_id: accountId,
            source: "lastapp",
            external_org_id: orgId,
            external_location_id: locationExtId,
            external_catalog_id: catId,
            external_brand_name: info.brand || null,
            external_channel: info.channel || null,
            catalog_product_id: catProdId,
            organization_product_id: p.organizationProductId ? String(p.organizationProductId) : null,
            product_name: typeof p.name === "string" ? p.name : null,
            price_cents: typeof p.price === "number" ? p.price : null,
            product_type: typeof p.type === "string" ? p.type : "PRODUCT",
            is_enabled: enabled,
            seen_in_catalog_at: nowIso,
            last_synced_at: nowIso,
            updated_at: nowIso,
            disabled_since: disabledSince,
            disabled_since_known: disabledSinceKnown,
            missing_since: null,
          });
        }
      }
    } catch (e) {
      stats.catalogs_failed++;
      catalogFailures.push({ external_catalog_id: catId, brand: info.brand, error: String(e) });
    }
  }

  const missingIds = [...existingByCatProd.keys()].filter((id) => !seenIds.has(id));
  const newlyMissingIds = missingIds.filter((id) => !existingByCatProd.get(id)!.missing_since);
  const reappearedFromMissing = [...seenIds].filter((id) => existingByCatProd.has(id) && !!existingByCatProd.get(id)!.missing_since);

  const disabledProductsSummary = await summarizeDisabledProducts(sb, accountId, rows);

  if (!dryRun) {
    if (rows.length > 0) {
      const { error: upErr } = await sb
        .from("external_catalog_product")
        .upsert(rows, { onConflict: "account_id,source,catalog_product_id,external_location_id" });
      if (upErr) throw new Error(`upsert external_catalog_product: ${upErr.message}`);
    }
    if (newlyMissingIds.length > 0) {
      const { error: missErr } = await sb
        .from("external_catalog_product")
        .update({ missing_since: nowIso })
        .eq("account_id", accountId)
        .eq("source", "lastapp")
        .eq("external_location_id", locationExtId)
        .in("catalog_product_id", newlyMissingIds);
      if (missErr) throw new Error(`update missing_since: ${missErr.message}`);
    }
  }

  return {
    external_location_id: locationExtId,
    catalogs_found: catalogMap.size,
    catalog_failures: catalogFailures,
    _debug_catalog_discovery: catalogDebug,
    disabled_products_summary: disabledProductsSummary,
    ...stats,
    missing_now: newlyMissingIds.length,
    still_missing: missingIds.length - newlyMissingIds.length,
    reappeared_from_missing: reappearedFromMissing.length,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // ── Auth dual (idéntica a lastapp-catalog-import) ──
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret = Deno.env.get("LASTAPP_INTERNAL_KEY") ?? "";
  const internalKey = req.headers.get("x-internal-key");
  const isInternal = internalSecret !== "" && internalKey === internalSecret;
  if (!isInternal) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const claims = decodeFolvyClaims(authHeader.slice(7));
    if (claims.is_platform_admin !== true) {
      return jsonResponse({ error: "Forbidden: platform admin required" }, 403);
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const accountId = body.account_id;
  const orgId = body.external_org_id;
  if (!accountId || !orgId) {
    return jsonResponse({ error: "account_id y external_org_id requeridos" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  const integ = await resolveToken(sb, accountId, orgId);
  if ("error" in integ) return jsonResponse({ error: integ.error }, 404);

  const dryRun = body.dry_run === true;
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();

  let locationIds: string[];
  if (body.location_id) {
    locationIds = [String(body.location_id)];
  } else {
    try {
      const locResp = await lastGet(`/locations?organizationId=${orgId}`, integ.token, { "organizationID": orgId });
      const locations: any[] = extractList(locResp);
      locationIds = locations.filter((l) => l?.id && l?.deleted !== true).map((l) => String(l.id));
    } catch (e) {
      return jsonResponse({ ok: false, error: `listando locations de la org: ${String(e)}` }, 500);
    }
  }

  const byLocation: any[] = [];
  const failed: any[] = [];
  for (const locId of locationIds) {
    try {
      const r = await syncLocation(sb, accountId, orgId, integ.token, locId, dryRun, nowIso);
      byLocation.push(r);
    } catch (e) {
      failed.push({ external_location_id: locId, error: String(e) });
    }
  }

  const totals = byLocation.reduce(
    (acc, r) => {
      acc.catalogs_found += r.catalogs_found;
      acc.catalogs_failed += r.catalogs_failed;
      acc.seen += r.seen;
      acc.new += r.new;
      acc.disabled_now += r.disabled_now;
      acc.reappeared += r.reappeared;
      acc.missing_now += r.missing_now;
      acc.first_sync_disabled_unknown += r.first_sync_disabled_unknown;
      return acc;
    },
    { catalogs_found: 0, catalogs_failed: 0, seen: 0, new: 0, disabled_now: 0, reappeared: 0, missing_now: 0, first_sync_disabled_unknown: 0 },
  );

  return jsonResponse({
    ok: failed.length === 0,
    dry_run: dryRun,
    account_id: accountId,
    external_org_id: orgId,
    locations_requested: locationIds.length,
    locations_ok: byLocation.length,
    locations_failed: failed,
    totals,
    by_location: byLocation,
    duration_ms: Date.now() - startedAt,
  });
});
