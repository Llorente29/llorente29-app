// hubrise-callback-ensure — AUTO-SANADOR del callback de HubRise (MULTI-CONEXIÓN).
// ============================================================================
// HubRise borra el callback de una conexión tras 6 entregas fallidas: si pasa,
// dejamos de recibir pedidos EN SILENCIO. Este cron comprueba y re-registra el
// callback de CADA conexión HubRise activa si falta o apunta mal. Idempotente.
//
// UNIFICADO (2026-07): antes usaba un único HUBRISE_ACCESS_TOKEN de entorno y solo
// protegía UNA conexión. Ahora itera todas las conexiones de external_integration
// (source=hubrise, activas, con token), de-duplicando por token (el token de HubRise
// es por conexión cliente×location). El Secret global queda como fallback solo si la
// tabla no tiene ninguna fila (compatibilidad durante la migración).
//
// VIGILANCIA: si el token de una conexión da 401 (caducado/revocado — el incidente
// del 22/07), se escala UNA alarma agregada a `system-alert` (email a operaciones)
// para re-autorizar OAuth. No se re-registra a ciegas con un token muerto.
//
// Deploy: --no-verify-jwt (inocua; solo repone NUESTRO callback -> NUESTRO webhook).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { listActiveHubriseConnections } from "../_shared/hubriseToken.ts";
import { ensureHubriseCallback } from "../_shared/hubriseCallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENV_TOKEN = Deno.env.get("HUBRISE_ACCESS_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function json(o: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type EnsureOutcome = "noop" | "reregistered" | "token_401" | "error";

// Asegura el callback para UN token. No lanza: devuelve el resultado.
// Delega en el helper compartido (_shared/hubriseCallback.ts, 2.6 -- 15/08/2026)
// para que este barrido manual/opcional y el flujo de conexion sincrono
// (hubrise-oauth-callback) compartan una sola logica del shape deseado.
async function ensureForToken(token: string): Promise<{ outcome: EnsureOutcome; status?: number }> {
  const r = await ensureHubriseCallback(token);
  if (r.outcome === "registered") {
    console.error("callback-ensure: CALLBACK AUSENTE -> re-registrado automáticamente");
    return { outcome: "reregistered", status: r.status };
  }
  return { outcome: r.outcome, status: r.status };
}

// Escala una alarma de sistema (email a operaciones). No bloquea si falta config.
async function raiseAlert(subject: string, message: string): Promise<void> {
  if (!CRON_SECRET) {
    console.error("callback-ensure: CRON_SECRET ausente -> no se pudo escalar alarma:", subject);
    return;
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ subject, message, kind: "hubrise-callback" }),
    });
  } catch (e) {
    console.error("callback-ensure: fallo al escalar alarma", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Conexiones a vigilar: las de external_integration; si no hay ninguna, el Secret
  // global (compatibilidad). Cada entrada lleva una etiqueta legible (sin exponer token).
  const conns = await listActiveHubriseConnections(sb);
  let work = conns.map((c) => ({
    token: c.accessToken,
    label: `${c.externalLocationId ?? "?"} / ${c.connectionName ?? "?"}`,
  }));
  if (work.length === 0 && ENV_TOKEN) {
    work = [{ token: ENV_TOKEN, label: "env-global" }];
  }
  if (work.length === 0) {
    return json({ ok: false, error: "sin conexiones HubRise (external_integration vacío y sin Secret)" }, 500);
  }

  // De-duplicar por token (varias marcas de un local comparten el token del local).
  const seen = new Set<string>();
  const uniq: Array<{ token: string; label: string }> = [];
  for (const w of work) {
    if (seen.has(w.token)) continue;
    seen.add(w.token);
    uniq.push(w);
  }

  const results: Array<{ label: string; outcome: EnsureOutcome; status?: number }> = [];
  const dead: string[] = [];
  for (const w of uniq) {
    const r = await ensureForToken(w.token);
    results.push({ label: w.label, outcome: r.outcome, status: r.status });
    if (r.outcome === "token_401") dead.push(w.label);
  }

  // Alarma agregada si algún token está muerto (401): hay que re-autorizar OAuth.
  if (dead.length > 0) {
    await raiseAlert(
      "Token HubRise caducado (401)",
      `El callback NO puede garantizarse en ${dead.length} conexión(es) por token 401. ` +
      `Re-autoriza OAuth (oob) y actualiza external_integration.access_token.\n\n` +
      `Conexiones afectadas:\n- ${dead.join("\n- ")}`,
    );
  }

  const reregistered = results.filter((r) => r.outcome === "reregistered").length;
  const errors = results.filter((r) => r.outcome === "error").length;
  const ok = dead.length === 0 && errors === 0;

  return json({
    ok,
    checked: uniq.length,
    reregistered,
    token_401: dead.length,
    errors,
    results,
  }, ok ? 200 : 207);
});
