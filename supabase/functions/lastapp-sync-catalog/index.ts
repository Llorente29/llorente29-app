// supabase/functions/lastapp-sync-catalog/index.ts
// Sincroniza los catálogos de Last.app de una organización hacia
// external_catalog_product (source='lastapp'; cache catalogProductId -> organizationProductId).
// Patrón de arranque calcado de map-products (auth dual, service-role).
// Entrada (POST JSON): { account_id, lastapp_organization_id, dry_run? }
// Auth: platform admin (JWT folvy.is_platform_admin) o x-internal-key.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

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

// Llama a la API de Last con el header de entidad correcto.
async function lastGet(
  path: string,
  token: string,
  entityHeader: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(`${LASTAPP_BASE}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      ...entityHeader,
    },
  });
  if (!res.ok) {
    throw new Error(`Last.app ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
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

  // --- Auth dual (igual que map-products) ---
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

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey,
  );

  // --- Resolver la integración y el nombre del secret del token ---
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
  const stats = { catalogs_seen: 0, products_upserted: 0, errors: [] as string[] };

  try {
    // 1) Locations de la organización
    const locResp: any = await lastGet(
      `/locations?organizationId=${orgId}`,
      token,
      orgHeader,
    );
    const locations: any[] = locResp?.value ?? locResp ?? [];

    // 2) Recolectar catálogos únicos a través de las brands de cada location
    const catalogIds = new Set<string>();
    const catalogBrand: Record<string, string> = {};
    const catalogLocation: Record<string, string> = {};
    const catalogChannel: Record<string, string> = {};

    for (const loc of locations) {
      const locDetail: any = await lastGet(
        `/locations/${loc.id}`,
        token,
        { "LocationID": loc.id },
      );
      const brands: any[] = locDetail?.brands ?? [];
      for (const b of brands) {
        const cats = b?.catalogs ?? {};
        const collect = (v: any, channel: string) => {
          if (typeof v === "string" && v) {
            catalogIds.add(v);
            if (!catalogBrand[v]) catalogBrand[v] = b.name ?? "";
            if (!catalogLocation[v]) catalogLocation[v] = loc.id;
            if (!catalogChannel[v]) catalogChannel[v] = channel;
          } else if (v && typeof v === "object") {
            for (const vv of Object.values(v)) collect(vv, channel);
          }
        };
        for (const [chKey, v] of Object.entries(cats)) collect(v, chKey);
      }
    }

    // 3) Por cada catálogo único, traer productos y upsertear
    for (const catId of catalogIds) {
      stats.catalogs_seen++;
      let catalog: any;
      try {
        catalog = await lastGet(`/catalogs/${catId}`, token, { "locationID": catalogLocation[catId] });
      } catch (e) {
        stats.errors.push(`catalog ${catId}: ${String(e)}`);
        continue;
      }
      const prods = extractProducts(catalog);
      if (prods.length === 0) continue;

      const rows = prods.map((p) => ({
        account_id: accountId,
        source: "lastapp",
        external_org_id: orgId,
        catalog_product_id: p.catalogProductId,
        organization_product_id: p.organizationProductId,
        external_catalog_id: catId,
        // Header locationID del catálogo: necesario para el empuje del 86
        // (PUT /catalogs/{catalogId}/products/{productId}). Lo conocemos del walk de
        // locations; persistirlo evita re-recorrer /locations en cada push.
        external_location_id: catalogLocation[catId] ?? null,
        external_brand_name: catalogBrand[catId] ?? null,
        external_channel: catalogChannel[catId] ?? null,
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
          .upsert(rows, { onConflict: "account_id,source,catalog_product_id" });
        if (upErr) {
          stats.errors.push(`upsert catalog ${catId}: ${upErr.message}`);
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
