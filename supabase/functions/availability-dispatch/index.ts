// supabase/functions/availability-dispatch/index.ts
//
// DESPACHADOR DE DISPONIBILIDAD (86) · disparado por net.http_post desde la RPC
// set_product_availability cuando se agota/reactiva un producto. VÍA ÚNICA: el
// front nunca llama aquí; lo hace la BBDD (igual que order-advance).
// ============================================================================
// v2 (21/06): empuje ACOTADO POR LOCAL. El cuerpo trae external_location_ids
// (las N location de Last del local agotado; 1→N propia Foodint + cedida
// Cloudtown). Si viene vacío → todos los locales (caso descatalogar).
//
// Entra por net.http_post con header x-availability-dispatch-secret (sin JWT).
// Deploy CON --no-verify-jwt: la frontera la valida el SECRET (es DB-triggered).
//
// Cuerpo: { account_id, matriculas:[...], external_location_ids:[...], enable, reason }
//
// Matriz por integrador:
//   - lastapp : PUT /catalogs/{catalogId}/products/{productId} {enable}
//               (Bearer + header locationID). Binario. REAL.
//   - hubrise : inventario stock:0 + expires_at. Hueco declarado.
//   - otter   : disponibilidad de item. Hueco declarado.
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = req.headers.get("x-availability-dispatch-secret") ?? "";
  const expected = Deno.env.get("AVAILABILITY_DISPATCH_SECRET") ?? "";
  if (!expected || secret !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: {
    account_id?: string;
    matriculas?: string[];
    external_location_ids?: string[];
    enable?: boolean;
    reason?: string;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const accountId = body.account_id;
  const matriculas = Array.isArray(body.matriculas) ? body.matriculas.filter(Boolean) : [];
  const externalLocationIds = Array.isArray(body.external_location_ids)
    ? body.external_location_ids.filter(Boolean)
    : [];
  const enable = body.enable === true;
  if (!accountId || matriculas.length === 0) {
    return json({ ok: false, error: "account_id y matriculas requeridos" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // filas-espejo (catálogos por canal) de esas matrículas, ACOTADAS al local si viene
  let query = sb
    .from("external_catalog_product")
    .select("source, external_org_id, external_catalog_id, catalog_product_id, organization_product_id, external_location_id")
    .eq("account_id", accountId)
    .in("organization_product_id", matriculas);
  if (externalLocationIds.length > 0) {
    query = query.in("external_location_id", externalLocationIds);
  }
  const { data: targets, error: tErr } = await query;

  if (tErr) return json({ ok: false, error: tErr.message }, 500);
  if (!targets || targets.length === 0) {
    return json({ ok: true, enable, pushed: 0, reason: "sin catálogos espejo para esas matrículas/local" }, 200);
  }

  const results = { pushed: 0, ok: 0, failed: 0, skipped: 0 };
  const tokenCache: Record<string, string | null> = {};

  async function lastTokenForOrg(orgId: string): Promise<string | null> {
    if (orgId in tokenCache) return tokenCache[orgId];
    const { data: integ } = await sb.from("external_integration")
      .select("token_secret_name, is_active")
      .eq("account_id", accountId).eq("source", "lastapp").eq("external_org_id", orgId)
      .eq("is_active", true).maybeSingle();
    const tok = integ?.token_secret_name ? (Deno.env.get(integ.token_secret_name) ?? null) : null;
    tokenCache[orgId] = tok;
    return tok;
  }

  for (const t of targets) {
    // ===================== case lastapp (REAL) =====================
    if (t.source === "lastapp") {
      const token = await lastTokenForOrg(t.external_org_id as string);
      if (!token || !t.external_location_id || !t.external_catalog_id || !t.catalog_product_id) {
        results.skipped++;
        await logRow(sb, accountId, t, enable, false, null, "sin token/location/catalog");
        continue;
      }
      results.pushed++;
      const r = await putLastEnable(
        token,
        t.external_location_id as string,
        t.external_catalog_id as string,
        t.catalog_product_id as string,
        enable,
      );
      if (r.ok) {
        results.ok++;
        await sb.from("external_catalog_product")
          .update({ is_enabled: enable, updated_at: new Date().toISOString() })
          .eq("account_id", accountId)
          .eq("source", "lastapp")
          .eq("catalog_product_id", t.catalog_product_id as string);
      } else {
        results.failed++;
      }
      await logRow(sb, accountId, t, enable, r.ok, r.status ?? null, r.ok ? null : (r.reason ?? null));
      continue;
    }

    // ===================== case hubrise (HUECO DECLARADO) =====================
    if (t.source === "hubrise") {
      // TODO leg HubRise: PUT inventory stock:0 + expires_at (= available_until) por SKU.
      results.skipped++;
      continue;
    }

    // ===================== case otter (HUECO DECLARADO) =====================
    if (t.source === "otter") {
      // TODO leg Otter: disponibilidad de item vía Menus Manager.
      results.skipped++;
      continue;
    }

    results.skipped++;
  }

  return json({ ok: true, enable, ...results }, 200);
});

async function putLastEnable(
  token: string, locId: string, catalogId: string, productId: string, enable: boolean,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    const res = await fetch(`${LASTAPP_BASE}/catalogs/${catalogId}/products/${productId}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "locationID": locId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enable }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, status: res.status, reason: txt.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function logRow(
  sb: ReturnType<typeof createClient>, accountId: string, t: Record<string, unknown>,
  enable: boolean, ok: boolean, http_status: number | null, error: string | null,
): Promise<void> {
  try {
    await sb.from("availability_push_log").insert({
      account_id: accountId,
      external_org_id: t.external_org_id ?? null,
      external_catalog_id: t.external_catalog_id ?? null,
      catalog_product_id: t.catalog_product_id ?? null,
      organization_product_id: t.organization_product_id ?? null,
      enable, ok, http_status, error,
    });
  } catch { /* best-effort */ }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
