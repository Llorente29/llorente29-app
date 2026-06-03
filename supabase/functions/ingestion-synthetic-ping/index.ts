// supabase/functions/ingestion-synthetic-ping/index.ts
//
// CAPA 2 (ping sintético) + CAPA 3 (check-in a watchdog externo) del vigilante
// de ingesta. Lo invoca pg_cron cada ~10 min.
//
// Qué hace, en orden:
//   1. Gating por CRON_SECRET (cabecera x-cron-secret). Sin él -> 401.
//   2. POST con token al lastapp-webhook (reproduce una llamada legítima de Last).
//   3. Éxito = HTTP 200 Y body.ok === true. Eso prueba que el gateway dejó pasar
//      Y que nuestro código corrió (el 401 del gateway NO devuelve ok:true).
//   4. Escribe el resultado en ingestion_monitor_state (por cuenta).
//   5. Si falla y NO está en cooldown -> dispara email vía system-alert.
//   6. Check-in a Healthchecks.io SOLO si todo el monitor corrió (Capa 3): si
//      este function deja de ejecutarse (cron muerto / Supabase caído), el
//      check-in deja de llegar y Healthchecks avisa = guardián del guardián.
//
// El fallo del 03/06 (gateway 401 por verify_jwt) lo habría cazado el paso 3:
// el ping habría recibido el 401 del gateway, no ok:true -> alarma en 10 min.
//
// Se despliega con --no-verify-jwt (lo invoca el cron internamente; la seguridad
// la hace CRON_SECRET).
//
// Variables de entorno (secrets):
//   CRON_SECRET            -- compartido cron <-> functions internas
//   LASTAPP_WEBHOOK_TOKEN  -- token que valida el lastapp-webhook (ya existe)
//   SUPABASE_URL           -- inyectada por la plataforma
//   SUPABASE_SERVICE_ROLE_KEY -- inyectada por la plataforma (escribe state, salta RLS)
//   HEALTHCHECKS_PING_URL  -- URL de check-in de Capa 3 (se setea al montar Capa 3)
//
// Parámetros opcionales (query):
//   ?simulate=fail  -- fuerza el camino de fallo (para probar la alarma sin
//                      tocar el webhook real). Requiere el CRON_SECRET igual.

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

// Cuenta vigilada. Hoy Llorente29 es el único cliente activo; cuando haya más,
// el cron pasará el account_id o se iterará sobre ingestion_monitor_config.enabled.
// El ping en sí es por-endpoint (un webhook), no por-cuenta: validamos la tubería.
const LASTAPP_WEBHOOK_PATH = "/functions/v1/lastapp-webhook";

interface PingResult {
  ok: boolean;
  httpStatus: number | null;
  bodyOk: boolean | null;
  detail: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (status: number, payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // --- 1. Gating ---
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || got !== cronSecret) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const url = new URL(req.url);
  const simulateFail = url.searchParams.get("simulate") === "fail";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookToken = Deno.env.get("LASTAPP_WEBHOOK_TOKEN") ?? "";
  const healthcheckUrl = Deno.env.get("HEALTHCHECKS_PING_URL") ?? "";

  const sb = createClient(supabaseUrl, serviceKey);

  // --- 2 + 3. Ping al webhook ---
  let result: PingResult;
  if (simulateFail) {
    result = { ok: false, httpStatus: 0, bodyOk: false, detail: "simulated_failure" };
  } else {
    result = await pingWebhook(supabaseUrl + LASTAPP_WEBHOOK_PATH, webhookToken);
  }

  // --- 4. Persistir estado (a nivel cuenta Llorente29 si existe config; si no, no rompe) ---
  // Resolvemos la(s) cuenta(s) con monitor enabled y actualizamos su state.
  const nowIso = new Date().toISOString();
  let alerted = false;
  try {
    const { data: configs } = await sb
      .from("ingestion_monitor_config")
      .select("account_id, alert_cooldown_minutes")
      .eq("enabled", true);

    for (const cfg of configs ?? []) {
      // upsert del estado del ping
      await sb.from("ingestion_monitor_state").upsert({
        account_id: cfg.account_id,
        last_synthetic_ping_at: nowIso,
        last_synthetic_ping_ok: result.ok,
        updated_at: nowIso,
      }, { onConflict: "account_id" });

      // --- 5. Alarma si falla y fuera de cooldown ---
      if (!result.ok) {
        const { data: state } = await sb
          .from("ingestion_monitor_state")
          .select("last_alert_sent_at, last_alert_kind")
          .eq("account_id", cfg.account_id)
          .maybeSingle();

        const cooldownMin = cfg.alert_cooldown_minutes ?? 180;
        const lastAlert = state?.last_alert_sent_at ? new Date(state.last_alert_sent_at).getTime() : 0;
        const inCooldown =
          state?.last_alert_kind === "synthetic_ping" &&
          (Date.now() - lastAlert) < cooldownMin * 60_000;

        if (!inCooldown) {
          await sendAlert(supabaseUrl, cronSecret, result);
          await sb.from("ingestion_monitor_state").update({
            last_alert_sent_at: nowIso,
            last_alert_kind: "synthetic_ping",
            updated_at: nowIso,
          }).eq("account_id", cfg.account_id);
          alerted = true;
        }
      }
    }
  } catch (e) {
    // Si la persistencia falla, intentamos avisar igualmente (el ping es lo crítico).
    if (!result.ok) {
      await sendAlert(supabaseUrl, cronSecret, result);
      alerted = true;
    }
    return json(200, { ok: result.ok, alerted, persisted: false, detail: String(e) });
  }

  // --- 6. Check-in Capa 3 (solo si el monitor llegó hasta aquí) ---
  // Se hace SIEMPRE que el monitor corra (ping ok o no): Healthchecks vigila que
  // el MONITOR esté vivo, no la salud del webhook (de eso avisa el email).
  let checkinOk: boolean | null = null;
  if (healthcheckUrl) {
    try {
      const hc = await fetch(healthcheckUrl, { method: "GET" });
      checkinOk = hc.ok;
    } catch {
      checkinOk = false;
    }
  }

  return json(200, {
    ok: result.ok,
    pingStatus: result.httpStatus,
    bodyOk: result.bodyOk,
    alerted,
    checkin: checkinOk,
    simulated: simulateFail,
  });
});

// Reproduce una llamada legítima de Last: mismo header `authorization`, body no-op.
async function pingWebhook(webhookUrl: string, token: string): Promise<PingResult> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "authorization": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "synthetic-ping" }),
    });
    let bodyOk: boolean | null = null;
    let detail: string | null = null;
    try {
      const data = await res.json();
      bodyOk = data?.ok === true;
    } catch {
      detail = "non_json_response";
    }
    // Éxito real = 200 Y body.ok true (el 401 del gateway no trae ok:true)
    const ok = res.status === 200 && bodyOk === true;
    if (!ok && !detail) detail = `status=${res.status} bodyOk=${bodyOk}`;
    return { ok, httpStatus: res.status, bodyOk, detail };
  } catch (e) {
    return { ok: false, httpStatus: null, bodyOk: null, detail: String(e) };
  }
}

// Dispara el email vía system-alert (canal de alarma dedicado ya validado).
async function sendAlert(supabaseUrl: string, cronSecret: string, result: PingResult): Promise<void> {
  const subject = "Webhook de ingesta CAÍDO";
  const message =
    `El ping sintético al webhook de Last.app ha fallado.\n\n` +
    `HTTP status: ${result.httpStatus}\n` +
    `body.ok: ${result.bodyOk}\n` +
    `Detalle: ${result.detail}\n\n` +
    `Esto significa que las ventas pueden NO estar entrando. Revisar el webhook ` +
    `(¿deploy sin --no-verify-jwt? ¿token? ¿Last dejó de enviar?).`;
  try {
    await fetch(supabaseUrl + "/functions/v1/system-alert", {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subject, message, kind: "synthetic_ping" }),
    });
  } catch {
    // best-effort: si el canal de alarma también está caído, no hay más que hacer aquí.
  }
}
