// hubrise-callback-ensure — AUTO-SANADOR del callback de HubRise (MULTI-CONEXIÓN).
// ============================================================================
// HubRise borra el callback de una conexión tras 6 entregas fallidas: si pasa,
// dejamos de recibir pedidos EN SILENCIO. Comprueba y re-registra el callback
// de una conexión (o de todas) si falta o apunta mal. Idempotente.
//
// UTILIDAD MANUAL/BAJO DEMANDA -- NUNCA EN CRON (corregido 15/08/2026, Fase 3:
// el comentario original de este fichero decia "Este cron..." pero NUNCA se
// programo -- confirmado en 2.6 revisando los 48 cron.job, ninguno la
// referencia). Es la condicion del pre-audit de Antoine (punto 2, 29/07:
// "eliminar el polling GET /callback cada 5 min", cron.unschedule(21)) -- ver
// folvy_mapa_sistema.md, regla permanente. NO programar esta funcion en un
// cron. Se invoca: a mano, o desde el boton "Verificar callback ahora" del
// tablero de operacion (Fase 3, A.1) con { integration_id } para acotar a
// UNA conexion; sin body barre todas (uso manual ocasional, sigue vivo por
// compatibilidad).
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
// Cada conexión tocada guarda su resultado en callback_status/callback_checked_at
// (Fase 3, A.1) -- 'ok' si noop/reregistered, 'unknown' si token_401/error
// (nunca 'missing' aquí: eso lo declara la desconexión, no un intento fallido
// de verificar).
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

interface WorkItem {
  id: string | null; // null = token del Secret global (compatibilidad, sin fila que actualizar)
  token: string;
  label: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // { integration_id } (boton "Verificar callback ahora" del tablero, Fase 3
  // A.1) acota a UNA conexion; sin body, barre todas (uso manual ocasional).
  let integrationId: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.integration_id === "string") integrationId = body.integration_id;
  } catch {
    // sin body / no-JSON -> comportamiento de siempre (barrido completo)
  }

  let work: WorkItem[];
  if (integrationId) {
    const { data: row, error: rowErr } = await sb
      .from("external_integration")
      .select("id, external_location_id, connection_name, access_token")
      .eq("id", integrationId)
      .eq("source", "hubrise")
      .maybeSingle();
    if (rowErr) return json({ ok: false, error: `lectura conexion: ${rowErr.message}` }, 500);
    if (!row || !row.access_token) {
      return json({ ok: false, error: "conexion no encontrada o sin token" }, 404);
    }
    work = [{
      id: row.id as string,
      token: row.access_token as string,
      label: `${(row.external_location_id as string | null) ?? "?"} / ${(row.connection_name as string | null) ?? "?"}`,
    }];
  } else {
    // Conexiones a vigilar: las de external_integration; si no hay ninguna, el Secret
    // global (compatibilidad). Cada entrada lleva una etiqueta legible (sin exponer token).
    const conns = await listActiveHubriseConnections(sb);
    work = conns.map((c) => ({
      id: c.id,
      token: c.accessToken,
      label: `${c.externalLocationId ?? "?"} / ${c.connectionName ?? "?"}`,
    }));
    if (work.length === 0 && ENV_TOKEN) {
      work = [{ id: null, token: ENV_TOKEN, label: "env-global" }];
    }
    if (work.length === 0) {
      return json({ ok: false, error: "sin conexiones HubRise (external_integration vacío y sin Secret)" }, 500);
    }
  }

  // De-duplicar por token (varias marcas de un local comparten el token del local).
  const seen = new Set<string>();
  const uniq: WorkItem[] = [];
  for (const w of work) {
    if (seen.has(w.token)) continue;
    seen.add(w.token);
    uniq.push(w);
  }

  const nowIso = new Date().toISOString();
  const results: Array<{ label: string; outcome: EnsureOutcome; status?: number }> = [];
  const dead: string[] = [];
  for (const w of uniq) {
    const r = await ensureForToken(w.token);
    results.push({ label: w.label, outcome: r.outcome, status: r.status });
    if (r.outcome === "token_401") dead.push(w.label);

    if (w.id) {
      const { error: cbErr } = await sb
        .from("external_integration")
        .update({
          callback_status: r.outcome === "noop" || r.outcome === "reregistered" ? "ok" : "unknown",
          callback_checked_at: nowIso,
        })
        .eq("id", w.id);
      if (cbErr) console.error(`callback-ensure: no se pudo guardar callback_status de ${w.id}: ${cbErr.message}`);
    }
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
