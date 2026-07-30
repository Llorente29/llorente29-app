// supabase/functions/hubrise-location-dispatch/index.ts
//
// DESPACHADOR DE LOCAL (Fase A) · PATCH /locations/:id a HubRise. Disparado
// por net.http_post desde set_location_status(_by_token) (Cap. C: cerrar/
// reabrir) y push_location_opening_hours (Cap. D: horario semanal). VÍA
// ÚNICA: el front nunca llama aquí ni a HubRise directamente.
// ============================================================================
// GENÉRICO A PROPÓSITO: no sabe de order_acceptance ni de opening_hours — solo
// recibe un `patch_body` ya construido por la RPC (que sí conoce el dominio) y
// lo envía tal cual. Las dos capacidades comparten el MISMO endpoint HubRise
// (PATCH /locations/:id), así que comparten despachador + registro.
//
// TOKEN: bridge (external_integration, source=hubrise, por conexión×local,
// scope location[orders.write] según Antoine) vía resolveHubriseToken — el
// MISMO tipo de token que usa hubrise-order-status. NO el token escritor de
// catálogo/inventario (resolveWriterToken: account[all_catalogs.write,
// inventory.write], sin scope de location — no sirve aquí).
//
// Entra por net.http_post con header x-location-status-dispatch-secret (sin
// JWT). Deploy CON --no-verify-jwt: la frontera la valida el SECRET.
//
// Cuerpo: { log_id, account_id, external_location_id, patch_body }
//
// HubRise gated en Antoine: este PATCH se construye y se verifica el salto
// (HTTP 200), pero NO se activa contra escaparate hasta el go-live.
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";
import { resolveHubriseToken } from "../_shared/hubriseToken.ts";

const HUBRISE_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = req.headers.get("x-location-status-dispatch-secret") ?? "";
  const expected = Deno.env.get("LOCATION_STATUS_DISPATCH_SECRET") ?? "";
  if (!expected || secret !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: {
    log_id?: string;
    account_id?: string;
    external_location_id?: string | null;
    patch_body?: Record<string, unknown>;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const logId = body.log_id;
  const accountId = body.account_id;
  const externalLocationId = body.external_location_id ?? null;
  const patchBody = body.patch_body;

  if (!logId || !accountId || !patchBody) {
    return json({ ok: false, error: "log_id, account_id y patch_body requeridos" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // La RPC ya resuelve esto, pero si por lo que sea llega null (local sin
  // conexión HubRise), no hay nada que empujar: no es un fallo.
  if (!externalLocationId) {
    await resolveLog(sb, logId, { ok: true, error: "Sin external_location_id: nada que empujar" });
    return json({ ok: true, skipped: true });
  }

  const token = await resolveHubriseToken(sb, { accountId, externalLocationId });
  if (!token) {
    await resolveLog(sb, logId, { ok: false, error: "Sin token de conexión HubRise (bridge) para este local" });
    return json({ ok: false, error: "sin token" }, 200);
  }

  const url = `${HUBRISE_BASE}/locations/${encodeURIComponent(externalLocationId)}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "PATCH",
      headers: { "X-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
  } catch (e) {
    await resolveLog(sb, logId, { ok: false, error: `red HubRise: ${e instanceof Error ? e.message : String(e)}` });
    return json({ ok: false, error: "red" }, 200);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    await resolveLog(sb, logId, { ok: false, http_status: resp.status, error: text.slice(0, 500) || `HTTP ${resp.status}` });
    return json({ ok: false, status: resp.status }, 200);
  }

  await resolveLog(sb, logId, { ok: true, http_status: resp.status });
  return json({ ok: true, status: resp.status }, 200);
});

async function resolveLog(
  sb: ReturnType<typeof createClient>, logId: string,
  fields: { ok: boolean; http_status?: number; error?: string },
): Promise<void> {
  try {
    await sb.from("location_status_log").update({
      ok: fields.ok,
      http_status: fields.http_status ?? null,
      error: fields.error ?? null,
      resolved_at: new Date().toISOString(),
    }).eq("id", logId);
  } catch { /* best-effort */ }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
