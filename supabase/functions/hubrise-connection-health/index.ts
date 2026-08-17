// hubrise-connection-health — VIGÍA de salud de token, POR CONEXIÓN.
// ============================================================================
// ENCARGO CODE — módulo de conexión HubRise, FASE 1.3.
//
// Trampa que neutraliza: un token revocado hoy solo se manifiesta como 401
// silenciosos en hubrise-catalog-publish/availability-dispatch/etc. — nadie
// se entera hasta que un pedido o un 86 se pierde. El escritor estuvo caído
// del 29/07 al 06/08 sin que nadie lo supiera (ver ENCARGO). Este cron hace
// un ping barato y de solo-lectura (GET /callback, el mismo que ya usa
// hubrise-callback-ensure) a CADA conexión activa de external_integration
// (source='hubrise') y escribe el resultado en token_status/token_checked_at.
//
// Semántica de escritura (nunca miente por un fallo transitorio):
//   - 2xx  -> token_status='ok'
//   - 401  -> token_status='invalid' (token caducado/revocado, confirmado)
//   - cualquier otra cosa (red, 5xx, timeout) -> NO se toca el estado; el
//     último estado confiable se conserva hasta el próximo ping que sí
//     resuelva con una señal clara.
//
// ALARMA: cuando una conexión PASA A invalid (no estaba ya en invalid antes
// de este ping) se agrega a una alarma única `system-alert` (kind=
// 'hubrise-connection-health') — igual que hace hubrise-callback-ensure con
// sus 401, pero aquí queda registrado en BBDD (no solo en el correo) para
// que la pantalla de estado (Fase 3) lo pueda leer.
//
// Deploy: --no-verify-jwt (lo invoca pg_cron vía pg_net; el gateway no debe
// exigir JWT). Cron cada 30 min — ver
// 20260815T1910_hubrise_connection_health_cron.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function json(o: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PingOutcome = "ok" | "invalid" | "unknown";

// Ping barato y de solo-lectura: NO registra ni modifica nada en HubRise.
async function pingToken(token: string): Promise<PingOutcome> {
  try {
    const resp = await fetch(`${API_BASE}/callback`, {
      headers: { "X-Access-Token": token },
    });
    if (resp.status === 401) return "invalid";
    if (resp.ok) return "ok";
    console.error(`hubrise-connection-health: HTTP ${resp.status} (no 401, no 2xx) — estado conservado`);
    return "unknown";
  } catch (e) {
    console.error("hubrise-connection-health: ping error", e);
    return "unknown";
  }
}

async function raiseAlert(subject: string, message: string): Promise<void> {
  if (!CRON_SECRET) {
    console.error("hubrise-connection-health: CRON_SECRET ausente -> no se pudo escalar alarma:", subject);
    return;
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ subject, message, kind: "hubrise-connection-health" }),
    });
  } catch (e) {
    console.error("hubrise-connection-health: fallo al escalar alarma", e);
  }
}

interface ConnRow {
  id: string;
  connection_name: string | null;
  external_location_id: string | null;
  access_token: string | null;
  token_status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("external_integration")
    .select("id, connection_name, external_location_id, access_token, token_status")
    .eq("source", "hubrise")
    .eq("is_active", true)
    .not("access_token", "is", null);
  if (error) return json({ ok: false, error: `lectura external_integration: ${error.message}` }, 500);

  const conns = (data ?? []) as ConnRow[];
  if (conns.length === 0) return json({ ok: true, checked: 0, note: "sin conexiones HubRise activas con token" });

  const nowIso = new Date().toISOString();
  const results: Array<{ label: string; outcome: PingOutcome }> = [];
  const newlyInvalid: string[] = [];

  for (const c of conns) {
    const label = `${c.external_location_id ?? "?"} / ${c.connection_name ?? "?"}`;
    const outcome = await pingToken(c.access_token as string);
    results.push({ label, outcome });

    if (outcome === "unknown") continue; // señal ambigua: no se toca el estado previo

    const { error: updErr } = await sb
      .from("external_integration")
      .update({ token_status: outcome, token_checked_at: nowIso })
      .eq("id", c.id);
    if (updErr) console.error(`hubrise-connection-health: update ${c.id} falló: ${updErr.message}`);

    if (outcome === "invalid" && c.token_status !== "invalid") newlyInvalid.push(label);
  }

  if (newlyInvalid.length > 0) {
    await raiseAlert(
      "Token HubRise inválido (401)",
      `${newlyInvalid.length} conexión(es) HubRise han pasado a token_status='invalid' en el último ping. ` +
      `Re-autoriza la conexión desde el módulo de integraciones.\n\n` +
      `Conexiones afectadas:\n- ${newlyInvalid.join("\n- ")}`,
    );
  }

  return json({
    ok: true,
    checked: conns.length,
    ok_count: results.filter((r) => r.outcome === "ok").length,
    invalid_count: results.filter((r) => r.outcome === "invalid").length,
    unknown_count: results.filter((r) => r.outcome === "unknown").length,
    newly_invalid: newlyInvalid.length,
    results,
  });
});
