// supabase/functions/last-catalog-sync/index.ts
//
// ENCARGO `last-catalog-sync` (SOLO LECTURA sobre Last.app; NO escribe en
// Last; NO toca HubRise). Puebla `last_product_mirror`: espejo de
// disponibilidad (enabled/agotado) por PRODUCTO × LOCAL en Last.
//
// Dos modos, mismo endpoint:
//   mode=probe -> descubre la ruta REST de disponibilidad por local (no se
//                 conoce todavía; ver CONFIRMED_ROUTE más abajo). Solo lectura,
//                 no escribe en Folvy.
//   mode=sync  -> usa la ruta ya CONFIRMADA para volcar el catálogo de un
//                 local (o de toda la organización) a last_product_mirror.
//                 Si CONFIRMED_ROUTE es null, devuelve error explícito: no
//                 hay volcado sin ruta confirmada (nada de suponer la ruta).
//
// Patrón de auth/token calcado de lastapp-catalog-import / lastapp-sync-catalog:
//   - Auth de entrada dual: x-internal-key (LASTAPP_INTERNAL_KEY) o JWT con
//     claim folvy.is_platform_admin.
//   - Token de Last: external_integration.token_secret_name por
//     (account_id, source='lastapp', external_org_id) -> Deno.env.get(nombre).
//     Nunca hardcodear el secreto.
//   - Throttle a ~12.5 req/s + reintento ante 429 (límite real de Last: 15/s).
//
// Multi-tenant: TODAS las consultas/escrituras van filtradas por account_id.
// external_org_id se pasa SIEMPRE explícito (sin él, Last responde por la
// organización por defecto y da una foto falsa del negocio propio).
//
// Deploy: --no-verify-jwt (lo invocará un cron con secreto interno).

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

// ═══════════════════════ Descubrimiento de la ruta (§3) ═══════════════════
//
// FIJAR AQUÍ la ruta una vez `mode=probe` la confirme contra producción
// (ver §3.5 del encargo). Mientras sea null, `mode=sync` devuelve error
// explícito en vez de suponer una ruta.
const CONFIRMED_ROUTE: string | null = null;

type ProbeCandidate = {
  key: string;
  label: string;
  request: (locationExtId: string, limit: number, offset: number) => {
    path: string;
    headers: Record<string, string>;
  };
};

const PROBE_CANDIDATES: ProbeCandidate[] = [
  {
    key: "locations_products",
    label: "/locations/{locationId}/products",
    request: (locId, limit, offset) => ({
      path: `/locations/${locId}/products?limit=${limit}&offset=${offset}`,
      headers: { "LocationID": locId },
    }),
  },
  {
    key: "locations_catalog_products",
    label: "/locations/{locationId}/catalog/products",
    request: (locId, limit, offset) => ({
      path: `/locations/${locId}/catalog/products?limit=${limit}&offset=${offset}`,
      headers: { "LocationID": locId },
    }),
  },
  {
    key: "products_query_locationId",
    label: "/products?locationId={locationId}",
    request: (locId, limit, offset) => ({
      path: `/products?locationId=${locId}&limit=${limit}&offset=${offset}`,
      headers: { "LocationID": locId },
    }),
  },
  {
    key: "locations_availability",
    label: "/locations/{locationId}/availability",
    request: (locId, limit, offset) => ({
      path: `/locations/${locId}/availability?limit=${limit}&offset=${offset}`,
      headers: { "LocationID": locId },
    }),
  },
];

// ── Llamada cruda a Last: NUNCA lanza, devuelve status/ok/body para que el
//    probe pueda registrar rutas que fallan sin abortar las siguientes. ──
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

// Llamada que SÍ lanza (para pasos que deben abortar si fallan, p.ej. /locations).
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
function extractTotal(json: any): number | null {
  if (!json || typeof json !== "object") return null;
  for (const key of ["totalCount", "total", "count"]) {
    if (typeof json[key] === "number") return json[key];
  }
  return null;
}

// ═══════════════════════ Token de la integración (§2) ═════════════════════
async function resolveIntegration(
  sb: SupabaseClient,
  accountId: string,
  orgId: string,
): Promise<{ token: string; ownershipType: string | null } | { error: string }> {
  const { data: integ, error } = await sb
    .from("external_integration")
    .select("token_secret_name, ownership_type")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_org_id", orgId)
    .maybeSingle();
  if (error) return { error: `external_integration: ${error.message}` };
  if (!integ) return { error: "Integration not found for that account_id/external_org_id" };
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return { error: `Secret ${integ.token_secret_name} not set` };
  return { token, ownershipType: integ.ownership_type ?? null };
}

// ═══════════════════════ mode=probe (§3) ═══════════════════════════════════
async function runProbe(token: string, locationExtId: string) {
  const probes: any[] = [];
  let confirmed: string | null = null;

  for (const c of PROBE_CANDIDATES) {
    const { path, headers } = c.request(locationExtId, 1, 0);
    const r = await lastFetchRaw(path, token, headers);
    const list = extractList(r.body);
    const first = list[0] ?? null;
    const hasEnabled = !!first && typeof first === "object" && "enabled" in first;
    probes.push({
      key: c.key,
      route: c.label,
      path,
      status: r.status,
      ok: r.ok,
      sample_keys: first ? Object.keys(first) : [],
      has_enabled_field: hasEnabled,
      total_hint: extractTotal(r.body),
      error: r.ok ? null : r.bodyText,
    });
    if (!confirmed && r.ok && hasEnabled) confirmed = c.key;
  }

  return {
    confirmed,
    probes,
    next_step: confirmed
      ? `Ruta confirmada: "${confirmed}". Fija CONFIRMED_ROUTE = "${confirmed}" en el código y redeploy antes de usar mode=sync.`
      : "Ninguna ruta candidata respondió 200 con campo `enabled`. No suponer la ruta: añadir más candidatas o inspeccionar manualmente.",
  };
}

// ═══════════════════════ mode=sync (§4) ═══════════════════════════════════
async function fetchAllLocationProducts(token: string, locationExtId: string): Promise<any[]> {
  const candidate = PROBE_CANDIDATES.find((c) => c.key === CONFIRMED_ROUTE);
  if (!candidate) {
    throw new Error(`CONFIRMED_ROUTE "${CONFIRMED_ROUTE}" no reconocida en PROBE_CANDIDATES`);
  }
  const PAGE = 50;
  let offset = 0;
  const out: any[] = [];
  while (true) {
    const { path, headers } = candidate.request(locationExtId, PAGE, offset);
    const r = await lastFetchRaw(path, token, headers);
    if (!r.ok) {
      throw new Error(`${candidate.label} @ ${locationExtId} offset=${offset} -> ${r.status} ${r.bodyText ?? ""}`);
    }
    const rows = extractList(r.body);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

type ExistingRow = {
  external_product_id: string;
  enabled: boolean;
  disabled_since: string | null;
  missing_since: string | null;
  first_seen_at: string;
};

async function syncLocation(
  sb: SupabaseClient,
  accountId: string,
  orgId: string,
  ownershipType: string | null,
  token: string,
  locationExtId: string,
  dryRun: boolean,
  nowIso: string,
): Promise<any> {
  const products = await fetchAllLocationProducts(token, locationExtId);

  // Folvy location_id (si el local está mapeado; nullable si no).
  const { data: locMap } = await sb
    .from("external_location_map")
    .select("location_id")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_location_id", locationExtId)
    .maybeSingle();
  const folvyLocationId = locMap?.location_id ?? null;

  // Estado previo del espejo para este local (para disabled_since/missing_since).
  const { data: existingRows, error: exErr } = await sb
    .from("last_product_mirror")
    .select("external_product_id, enabled, disabled_since, missing_since, first_seen_at")
    .eq("account_id", accountId)
    .eq("external_location_id", locationExtId);
  if (exErr) throw new Error(`select last_product_mirror: ${exErr.message}`);
  const existingByExtId = new Map<string, ExistingRow>();
  for (const r of existingRows ?? []) existingByExtId.set(r.external_product_id as string, r as ExistingRow);

  // Cruce con menu_item (in_folvy / menu_item_id / brand_id), en un solo select.
  const productIds = [...new Set(products.map((p) => String(p.id ?? p.productId ?? p.external_id ?? "")).filter(Boolean))];
  const menuItemByExtId = new Map<string, { id: string; brand_id: string | null }>();
  if (productIds.length > 0) {
    const { data: items, error: miErr } = await sb
      .from("menu_item")
      .select("id, brand_id, external_id")
      .eq("account_id", accountId)
      .eq("external_source", "lastapp")
      .is("archived_at", null)
      .in("external_id", productIds);
    if (miErr) throw new Error(`select menu_item: ${miErr.message}`);
    for (const it of items ?? []) menuItemByExtId.set(it.external_id as string, { id: it.id as string, brand_id: it.brand_id as string | null });
  }

  const seenIds = new Set<string>();
  const rows: any[] = [];
  const stats = { seen: 0, new: 0, disabled_now: 0, reappeared: 0, still_disabled: 0, in_folvy: 0 };

  for (const p of products) {
    const extId = String(p.id ?? p.productId ?? p.external_id ?? "");
    if (!extId) continue;
    seenIds.add(extId);
    stats.seen++;

    const enabled = p.enabled !== false;
    const name = typeof p.name === "string" ? p.name : null;
    const priceCents = typeof p.price === "number" ? p.price : (typeof p.priceCents === "number" ? p.priceCents : null);
    const mi = menuItemByExtId.get(extId) ?? null;
    const inFolvy = mi !== null;
    if (inFolvy) stats.in_folvy++;

    const prev = existingByExtId.get(extId);
    let disabledSince: string | null;
    let firstSeenAt: string;
    if (!prev) {
      stats.new++;
      disabledSince = enabled ? null : nowIso;
      firstSeenAt = nowIso;
    } else {
      firstSeenAt = prev.first_seen_at;
      if (prev.enabled && !enabled) {
        stats.disabled_now++;
        disabledSince = nowIso;
      } else if (!prev.enabled && enabled) {
        stats.reappeared++;
        disabledSince = null;
      } else {
        if (!enabled) stats.still_disabled++;
        disabledSince = prev.disabled_since;
      }
    }

    rows.push({
      account_id: accountId,
      location_id: folvyLocationId,
      external_org_id: orgId,
      external_location_id: locationExtId,
      external_product_id: extId,
      last_name: name,
      last_price_cents: priceCents,
      enabled,
      menu_item_id: mi?.id ?? null,
      brand_id: mi?.brand_id ?? null,
      ownership_type: ownershipType,
      in_folvy: inFolvy,
      first_seen_at: firstSeenAt,
      last_seen_at: nowIso,
      disabled_since: disabledSince,
      missing_since: null,
    });
  }

  const missingIds = [...existingByExtId.keys()].filter((id) => !seenIds.has(id));
  const newlyMissingIds = missingIds.filter((id) => !existingByExtId.get(id)!.missing_since);
  const reappearedFromMissing = [...seenIds].filter((id) => existingByExtId.has(id) && existingByExtId.get(id)!.missing_since);

  if (!dryRun) {
    if (rows.length > 0) {
      const { error: upErr } = await sb
        .from("last_product_mirror")
        .upsert(rows, { onConflict: "account_id,external_location_id,external_product_id" });
      if (upErr) throw new Error(`upsert last_product_mirror: ${upErr.message}`);
    }
    if (newlyMissingIds.length > 0) {
      const { error: missErr } = await sb
        .from("last_product_mirror")
        .update({ missing_since: nowIso })
        .eq("account_id", accountId)
        .eq("external_location_id", locationExtId)
        .in("external_product_id", newlyMissingIds);
      if (missErr) throw new Error(`update missing_since: ${missErr.message}`);
    }
  }

  return {
    external_location_id: locationExtId,
    folvy_location_id: folvyLocationId,
    ok: true,
    ...stats,
    missing_now: newlyMissingIds.length,
    still_missing: missingIds.length - newlyMissingIds.length,
    reappeared_from_missing: reappearedFromMissing.length,
  };
}

// ═══════════════════════ Handler ═══════════════════════════════════════════
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

  const mode = body.mode;
  const accountId = body.account_id;
  const orgId = body.external_org_id;
  if (mode !== "probe" && mode !== "sync") {
    return jsonResponse({ error: 'mode debe ser "probe" o "sync"' }, 400);
  }
  if (!accountId || !orgId) {
    return jsonResponse({ error: "account_id y external_org_id requeridos" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  const integ = await resolveIntegration(sb, accountId, orgId);
  if ("error" in integ) return jsonResponse({ error: integ.error }, 404);

  if (mode === "probe") {
    const locationId = body.location_id;
    if (!locationId) return jsonResponse({ error: "location_id requerido en mode=probe" }, 400);
    try {
      const result = await runProbe(integ.token, String(locationId));
      return jsonResponse({ ok: true, mode: "probe", account_id: accountId, external_org_id: orgId, location_id: locationId, ...result });
    } catch (e) {
      return jsonResponse({ ok: false, mode: "probe", error: String(e) }, 500);
    }
  }

  // mode === "sync"
  if (!CONFIRMED_ROUTE) {
    return jsonResponse({
      ok: false,
      mode: "sync",
      error: "CONFIRMED_ROUTE no está fijada todavía. Ejecuta mode=probe contra un local real, confirma la ruta y fíjala en el código antes de sincronizar.",
    }, 409);
  }

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
      return jsonResponse({ ok: false, mode: "sync", error: `listando locations de la org: ${String(e)}` }, 500);
    }
  }

  const byLocation: any[] = [];
  const failed: any[] = [];
  for (const locId of locationIds) {
    try {
      const r = await syncLocation(sb, accountId, orgId, integ.ownershipType, integ.token, locId, dryRun, nowIso);
      byLocation.push(r);
    } catch (e) {
      failed.push({ external_location_id: locId, error: String(e) });
    }
  }

  const totals = byLocation.reduce(
    (acc, r) => {
      acc.seen += r.seen;
      acc.new += r.new;
      acc.disabled_now += r.disabled_now;
      acc.reappeared += r.reappeared;
      acc.missing_now += r.missing_now;
      acc.in_folvy += r.in_folvy;
      return acc;
    },
    { seen: 0, new: 0, disabled_now: 0, reappeared: 0, missing_now: 0, in_folvy: 0 },
  );

  return jsonResponse({
    ok: failed.length === 0,
    mode: "sync",
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
