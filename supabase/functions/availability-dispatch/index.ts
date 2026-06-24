// supabase/functions/availability-dispatch/index.ts
//
// DESPACHADOR DE DISPONIBILIDAD (86) · disparado por net.http_post desde las RPC
// set_product_availability / _by_token. VÍA ÚNICA: el front nunca llama aquí.
// ============================================================================
// v3 (24/06): + LEG HUBRISE (PATCH inventario, sku_ref = matrícula, por
// conexión×local) + lee location_id/available_until + LOG HONESTO de los huecos
// (otter/desconocido) en vez de skip silencioso. El camino de Last queda IGUAL.
//
// Entra por net.http_post con header x-availability-dispatch-secret (sin JWT).
// Deploy CON --no-verify-jwt: la frontera la valida el SECRET (es DB-triggered).
//
// Cuerpo: { account_id, matriculas:[...], external_location_ids:[...],
//           location_id, available_until, enable, reason }
//
// Matriz por integrador:
//   - lastapp : PUT /catalogs/{cat}/products/{prod} {enable} (Bearer + locationID). REAL.
//   - hubrise : PATCH /catalogs/{cat}/location/inventory  (X-Access-Token).        REAL.
//               agotar → {sku_ref, stock:"0", expires_at?}; reactivar → {sku_ref, stock:null}.
//   - otter   : disponibilidad de item. Hueco declarado (se LOGUEA, no se silencia).
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";
// = el mismo base que usa hubrise-order-status. Si allí difiere, alinear este.
const HUBRISE_BASE = "https://api.hubrise.com/v1";

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
    location_id?: string | null;
    available_until?: string | null;
    enable?: boolean;
    reason?: string;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const accountId = body.account_id;
  const matriculas = Array.isArray(body.matriculas) ? body.matriculas.filter(Boolean) : [];
  const externalLocationIds = Array.isArray(body.external_location_ids)
    ? body.external_location_ids.filter(Boolean)
    : [];
  const locationId = body.location_id ?? null;
  const availableUntil = body.available_until ?? null;
  const enable = body.enable === true;
  if (!accountId || matriculas.length === 0) {
    return json({ ok: false, error: "account_id y matriculas requeridos" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const results = { last: { pushed: 0, ok: 0, failed: 0, skipped: 0 },
                    hubrise: { pushed: 0, ok: 0, failed: 0, skipped: 0 } };

  // ========================= LEG LASTAPP (REAL) =============================
  {
    let query = sb
      .from("external_catalog_product")
      .select("source, external_org_id, external_catalog_id, catalog_product_id, organization_product_id, external_location_id")
      .eq("account_id", accountId)
      .eq("source", "lastapp")
      .in("organization_product_id", matriculas);
    if (externalLocationIds.length > 0) {
      query = query.in("external_location_id", externalLocationIds);
    }
    const { data: targets } = await query;

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

    for (const t of targets ?? []) {
      const token = await lastTokenForOrg(t.external_org_id as string);
      if (!token || !t.external_location_id || !t.external_catalog_id || !t.catalog_product_id) {
        results.last.skipped++;
        await logLast(sb, accountId, t, enable, false, null, "sin token/location/catalog");
        continue;
      }
      results.last.pushed++;
      const r = await putLastEnable(
        token,
        t.external_location_id as string,
        t.external_catalog_id as string,
        t.catalog_product_id as string,
        enable,
      );
      if (r.ok) {
        results.last.ok++;
        await sb.from("external_catalog_product")
          .update({ is_enabled: enable, updated_at: new Date().toISOString() })
          .eq("account_id", accountId)
          .eq("source", "lastapp")
          .eq("catalog_product_id", t.catalog_product_id as string);
      } else {
        results.last.failed++;
      }
      await logLast(sb, accountId, t, enable, r.ok, r.status ?? null, r.ok ? null : (r.reason ?? null));
    }
  }

  // ========================= LEG HUBRISE (REAL) ============================
  // sku_ref = matrícula (decisión A: Folvy publica el catálogo y elige los ref).
  // PATCH solo afecta a refs que existen en cada catálogo → se auto-filtra por marca.
  {
    // 1) conexiones HubRise activas de la cuenta, acotadas al local si viene
    let hrExtLocs: string[] | null = null; // null = todos los locales (descatalogar)
    if (locationId) {
      const { data: maps } = await sb.from("external_location_map")
        .select("external_location_id")
        .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true)
        .eq("location_id", locationId);
      hrExtLocs = (maps ?? []).map((m) => m.external_location_id as string).filter(Boolean);
    }

    let connQ = sb.from("external_integration")
      .select("id, access_token, external_catalog_id, external_location_id, connection_name, push_status_enabled")
      .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true);
    if (hrExtLocs !== null) {
      if (hrExtLocs.length === 0) connQ = null as never; // local sin conexión HubRise → nada
      else connQ = connQ.in("external_location_id", hrExtLocs);
    }

    const conns = connQ ? (await connQ).data ?? [] : [];

    // entradas de inventario: agotar = stock "0" (+expires_at); reactivar = stock null
    const entries = matriculas.map((m) =>
      enable
        ? { sku_ref: m, stock: null }
        : { sku_ref: m, stock: "0", ...(availableUntil ? { expires_at: availableUntil } : {}) }
    );

    for (const c of conns) {
      if (c.push_status_enabled === false) {
        results.hubrise.skipped++;
        await logHubrise(sb, accountId, c, enable, false, null, "push_status_enabled=false");
        continue;
      }
      if (!c.access_token || !c.external_catalog_id) {
        results.hubrise.skipped++;
        await logHubrise(sb, accountId, c, enable, false, null, "sin access_token/catalog");
        continue;
      }
      results.hubrise.pushed++;
      const r = await patchHubriseInventory(c.access_token as string, c.external_catalog_id as string, entries);
      if (r.ok) results.hubrise.ok++; else results.hubrise.failed++;
      await logHubrise(sb, accountId, c, enable, r.ok, r.status ?? null,
        r.ok ? `ok · ${matriculas.length} sku` : (r.reason ?? null));
    }
  }

  // ===================== huecos declarados (otter/otros) ===================
  // No empujamos, pero LO REGISTRAMOS (antes era skip silencioso).
  // (Se detecta si hubo filas espejo de otros integradores para estas matrículas.)
  {
    const { data: others } = await sb.from("external_catalog_product")
      .select("source, external_org_id, external_catalog_id, organization_product_id")
      .eq("account_id", accountId)
      .neq("source", "lastapp")
      .neq("source", "hubrise")
      .in("organization_product_id", matriculas)
      .limit(50);
    for (const o of others ?? []) {
      await logLast(sb, accountId, o, enable, false, null, `no empujado: integrador '${o.source}' sin leg`);
    }
  }

  return json({ ok: true, enable, location_id: locationId, ...results }, 200);
});

// ── LAST: PUT enable ────────────────────────────────────────────────────────
async function putLastEnable(
  token: string, locId: string, catalogId: string, productId: string, enable: boolean,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    const res = await fetch(`${LASTAPP_BASE}/catalogs/${catalogId}/products/${productId}`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${token}`, "locationID": locId, "Content-Type": "application/json" },
      body: JSON.stringify({ enable }),
    });
    if (!res.ok) return { ok: false, status: res.status, reason: (await res.text()).slice(0, 200) };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── HUBRISE: PATCH inventory ─────────────────────────────────────────────────
async function patchHubriseInventory(
  accessToken: string, catalogId: string, entries: unknown[],
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    const res = await fetch(`${HUBRISE_BASE}/catalogs/${catalogId}/location/inventory`, {
      method: "PATCH",
      headers: { "X-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });
    if (!res.ok) return { ok: false, status: res.status, reason: (await res.text()).slice(0, 200) };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── log (best-effort) ───────────────────────────────────────────────────────
async function logLast(
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

// HubRise loguea por CONEXIÓN (no por fila espejo, que no existe). El catálogo
// va en el texto porque availability_push_log no tiene columnas de texto para
// HubRise (deuda menor: añadir source/detail si se quiere filtrar por integrador).
async function logHubrise(
  sb: ReturnType<typeof createClient>, accountId: string, c: Record<string, unknown>,
  enable: boolean, ok: boolean, http_status: number | null, detail: string | null,
): Promise<void> {
  try {
    await sb.from("availability_push_log").insert({
      account_id: accountId,
      external_org_id: c.id ?? null,               // uuid de la fila external_integration
      external_catalog_id: null,
      catalog_product_id: null,
      organization_product_id: null,
      enable, ok, http_status,
      error: `hubrise · ${c.connection_name ?? "?"} · cat ${c.external_catalog_id ?? "?"}${detail ? " · " + detail : ""}`,
    });
  } catch { /* best-effort */ }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
