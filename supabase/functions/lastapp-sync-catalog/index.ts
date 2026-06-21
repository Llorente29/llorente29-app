// supabase/functions/lastapp-sync-catalog/index.ts
// Sincroniza los catálogos de Last.app de una organización hacia
// external_catalog_product (source='lastapp'; cache catalogProductId -> organizationProductId).
// Entrada (POST JSON): { account_id, lastapp_organization_id, dry_run? }
// Auth: platform admin (JWT folvy.is_platform_admin) o x-internal-key.
//
// MODELO POR UBICACIÓN (clave para el 86): en Last un MISMO catálogo (mismo id) puede
// servir a VARIAS ubicaciones a la vez (cedidas Cloudtown: un catálogo Glovo/Uber por
// marca, compartido por los 3 locales). El estado enable/disable de cada producto es
// POR UBICACIÓN. Por eso el espejo guarda una fila por (catálogo × ubicación): el mismo
// catalog_product_id existe N veces, una por external_location_id. Sin esto, el 86 no
// puede apagar por local (apagaría el catálogo entero o el local equivocado).
// Constraint única: (account_id, source, catalog_product_id, external_location_id).
//
// DESCUBRIMIENTO: GET /catalogs?locationId={loc} da la lista COMPLETA por ubicación; se
// cruza con b.catalogs del walk de /locations/{id} para el canal. Un catálogo que
// aparece en varias ubicaciones se registra para CADA una (no "primera vez gana").
//
// RATE LIMIT: Last limita a 15 req/s por token y entidad. lastGet aplica throttle
// (~12 req/s) + reintento con backoff ante 429, para no perder catálogos.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

// --- Control de ritmo (límite Last: 15 req/s) ---
const MIN_INTERVAL_MS = 80;   // ~12.5 req/s
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
  full_name?: string;
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

// Llama a la API de Last. Throttle antes de cada llamada + reintento ante 429.
async function lastGet(
  path: string,
  token: string,
  entityHeader: Record<string, string>,
): Promise<unknown> {
  let attempt = 0;
  while (true) {
    await throttle();
    const res = await fetch(`${LASTAPP_BASE}${path}`, {
      headers: { "Authorization": `Bearer ${token}`, ...entityHeader },
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < MAX_RETRIES_429) {
      attempt++;
      await res.text().catch(() => {});
      await sleep(300 * attempt);
      continue;
    }
    throw new Error(`Last.app ${path} -> ${res.status} ${await res.text()}`);
  }
}

// Infiere el canal a partir del nombre del catálogo (fallback cuando b.catalogs no lo mapea).
function channelFromName(name: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (n.includes("glovo")) return "glovo";
  if (n.includes("uber")) return "uber";
  if (n.includes("just")) return "justeat";
  if (n.includes("deliveroo")) return "deliveroo";
  return "unknown";
}

// Extrae productos planos de un catálogo (recorre categories/products + combos).
function extractProducts(catalog: any): Array<{
  catalogProductId: string;
  organizationProductId: string | null;
  name: string;
  price: number | null;
  type: string;
  enabled: boolean | null;
}> {
  const out: any[] = [];
  const cats = catalog?.categories ?? [];
  for (const c of cats) {
    for (const p of (c?.products ?? [])) {
      out.push({
        catalogProductId: p.id,
        organizationProductId: p.organizationProductId ?? p.organizationComboId ?? null,
        name: p.name ?? null,
        price: typeof p.price === "number" ? p.price : null,
        type: p.type ?? "PRODUCT",
        enabled: p.enabled ?? null,
      });
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // --- Auth dual ---
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret = Deno.env.get("LASTAPP_INTERNAL_KEY") ?? "";
  const internalKey = req.headers.get("x-internal-key");
  const isInternal = internalSecret !== "" && internalKey === internalSecret;

  if (!isInternal) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const claims = decodeFolvyClaims(authHeader.slice(7));
    if (claims.is_platform_admin !== true) {
      return jsonResponse({ error: "Forbidden: platform admin required" }, 403);
    }
  }

  // --- Body ---
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const accountId = body.account_id;
  const orgId = body.lastapp_organization_id;
  const dryRun = body.dry_run === true;
  if (!accountId || !orgId) {
    return jsonResponse({ error: "account_id and lastapp_organization_id required" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // --- Resolver token de la integración ---
  const { data: integ, error: integErr } = await sb
    .from("external_integration")
    .select("token_secret_name")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_org_id", orgId)
    .single();
  if (integErr || !integ) {
    return jsonResponse({ error: "Integration not found for that account/org" }, 404);
  }
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) {
    return jsonResponse({ error: `Secret ${integ.token_secret_name} not set` }, 500);
  }

  const orgHeader = { "OrganizationID": orgId };
  const stats = {
    locations_seen: 0,
    catalog_location_pairs: 0,  // (catálogo × ubicación) a sincronizar
    distinct_catalogs: 0,       // catálogos distintos (un fetch por catálogo)
    products_upserted: 0,
    channels: {} as Record<string, number>,
    errors: [] as string[],
  };

  try {
    // 1) Locations de la organización
    const locResp: any = await lastGet(`/locations?organizationId=${orgId}`, token, orgHeader);
    const locations: any[] = locResp?.value ?? locResp ?? [];

    // 2) Por cada location: lista COMPLETA de catálogos (GET /catalogs?locationId) cruzada
    //    con b.catalogs (canal/marca). Se registra cada catálogo PARA CADA ubicación donde
    //    aparece (un catálogo compartido genera N pares catálogo×ubicación).
    type Pair = { catId: string; location: string; brand: string; channel: string; name: string | null };
    const pairs: Pair[] = [];
    const pairKey = new Set<string>();  // dedupe catId|location

    for (const loc of locations) {
      stats.locations_seen++;

      // (a) walk de brands -> mapa catalogId -> {brand, channel} donde Last lo dé
      const brandChannel: Record<string, { brand: string; channel: string }> = {};
      try {
        const locDetail: any = await lastGet(`/locations/${loc.id}`, token, { "LocationID": loc.id });
        const brands: any[] = locDetail?.brands ?? [];
        for (const b of brands) {
          const cats = b?.catalogs ?? {};
          const collect = (v: any, channel: string) => {
            if (typeof v === "string" && v) {
              if (!brandChannel[v]) brandChannel[v] = { brand: b.name ?? "", channel };
            } else if (v && typeof v === "object") {
              for (const vv of Object.values(v)) collect(vv, channel);
            }
          };
          for (const [chKey, v] of Object.entries(cats)) collect(v, chKey);
        }
      } catch (e) {
        stats.errors.push(`location ${loc.id} detail: ${String(e)}`);
      }

      // (b) lista completa de catálogos de la ubicación
      try {
        const catsResp: any = await lastGet(`/catalogs?locationId=${loc.id}`, token, { "LocationID": loc.id });
        const list: any[] = catsResp?.value ?? catsResp ?? [];
        for (const c of list) {
          if (!c?.id || c?.deleted === true) continue;
          const k = `${c.id}|${loc.id}`;
          if (pairKey.has(k)) continue;
          pairKey.add(k);
          const mapped = brandChannel[c.id];
          pairs.push({
            catId: c.id,
            location: loc.id,
            brand: mapped?.brand ?? (c.name ?? ""),
            channel: mapped?.channel ?? channelFromName(c.name),
            name: c.name ?? null,
          });
        }
      } catch (e) {
        stats.errors.push(`location ${loc.id} catalogs: ${String(e)}`);
      }
    }

    stats.catalog_location_pairs = pairs.length;

    // 3) Traer productos de cada catálogo UNA vez (cache), y upsertear una fila por
    //    (producto × ubicación). El mismo catálogo servido a N ubicaciones produce N
    //    filas por producto, cada una con su external_location_id -> el 86 apaga por local.
    const productCache: Record<string, ReturnType<typeof extractProducts>> = {};

    for (const pair of pairs) {
      stats.channels[pair.channel] = (stats.channels[pair.channel] ?? 0) + 1;

      // fetch del catálogo (cache por catId; el contenido del catálogo no cambia por ubicación)
      let prods = productCache[pair.catId];
      if (!prods) {
        try {
          const catalog: any = await lastGet(`/catalogs/${pair.catId}`, token, { "locationID": pair.location });
          prods = extractProducts(catalog);
          productCache[pair.catId] = prods;
          stats.distinct_catalogs++;
        } catch (e) {
          stats.errors.push(`catalog ${pair.catId}: ${String(e)}`);
          continue;
        }
      }
      if (prods.length === 0) continue;

      const rows = prods.map((p) => ({
        account_id: accountId,
        source: "lastapp",
        external_org_id: orgId,
        catalog_product_id: p.catalogProductId,
        organization_product_id: p.organizationProductId,
        external_catalog_id: pair.catId,
        external_location_id: pair.location,
        external_brand_name: pair.brand,
        external_channel: pair.channel,
        product_name: p.name,
        price_cents: p.price,
        product_type: p.type,
        is_enabled: p.enabled,
        seen_in_catalog_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      if (!dryRun) {
        const { error: upErr } = await sb
          .from("external_catalog_product")
          .upsert(rows, { onConflict: "account_id,source,catalog_product_id,external_location_id" });
        if (upErr) {
          stats.errors.push(`upsert catalog ${pair.catId} @ ${pair.location}: ${upErr.message}`);
          continue;
        }
      }
      stats.products_upserted += rows.length;
    }

    return jsonResponse({ ok: true, dry_run: dryRun, ...stats });
  } catch (e) {
    return jsonResponse({ error: String(e), partial: stats }, 500);
  }
});
