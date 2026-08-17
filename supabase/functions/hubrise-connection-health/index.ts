// hubrise-connection-health — VIGÍA de salud de token, POR CONEXIÓN Y DE LA ESCRITORA.
// ============================================================================
// ENCARGO CODE — módulo de conexión HubRise, FASE 1.3 + Fase 3 punto 3 (15/08).
//
// Trampa que neutraliza: un token revocado hoy solo se manifiesta como 401
// silenciosos en hubrise-catalog-publish/availability-dispatch/etc. — nadie
// se entera hasta que un pedido o un 86 se pierde. El escritor estuvo caído
// del 29/07 al 06/08 sin que nadie lo supiera (ver ENCARGO). Este cron hace
// un ping barato y de solo-lectura a CADA conexión activa de
// external_integration (source='hubrise') Y a cada fila de
// hubrise_writer_connection (la escritora, antes sin salud verificada — solo
// "conectada desde X"), y escribe el resultado en token_status/token_checked_at
// de la tabla correspondiente.
//
// REGLA PERMANENTE (15/08/2026, Fase 3 — no re-litigar, ver folvy_mapa_sistema.md):
// NINGÚN cron sondea GET /callback. Es la condición del pre-audit de Antoine
// (punto 2, 29/07: "eliminar el polling GET /callback cada 5 min",
// cron.unschedule(21)). Esta misma función lo violó sin querer desde su
// creación (F1.3): pingueaba GET /callback cada 30 min -- distinta cadencia,
// mismo endpoint sondeado en bucle, misma objeción de Antoine. Corregido: el
// ping de salud usa GET /location (conexiones de location) / GET /account
// (escritora) -- endpoints "quien soy" escalados por el propio token, sin
// relación con el callback. El estado del callback (¿está registrado el
// correcto?) se vigila por EVENTOS (conectar/reconectar/desconectar,
// recuperación de token invalid->ok -- ver más abajo, y bajo demanda desde
// el tablero) -- nunca en bucle. Ver _shared/hubriseCallback.ts y el tablero
// de operación (Fase 3, A.1).
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
import { ensureHubriseCallback } from "../_shared/hubriseCallback.ts";

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
// endpoint es SIEMPRE uno de los "quien soy" escalados por el propio token
// (/location para conexiones de location, /account para la escritora) --
// nunca /callback (ver regla permanente arriba). Verificado en vivo
// (15/08/2026): ambos devuelven 200 con token vivo y 401 con token
// revocado/caducado, igual que /callback, sin ser el endpoint que Antoine
// pidió dejar de sondear.
async function pingToken(endpoint: string, token: string): Promise<PingOutcome> {
  try {
    const resp = await fetch(`${API_BASE}${endpoint}`, {
      headers: { "X-Access-Token": token },
    });
    if (resp.status === 401) return "invalid";
    if (resp.ok) return "ok";
    console.error(`hubrise-connection-health: HTTP ${resp.status} en ${endpoint} (no 401, no 2xx) — estado conservado`);
    return "unknown";
  } catch (e) {
    console.error(`hubrise-connection-health: ping error en ${endpoint}`, e);
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

interface WriterRow {
  account_id: string;
  hubrise_account_id: string | null;
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
  const nowIso = new Date().toISOString();
  const results: Array<{ label: string; outcome: PingOutcome }> = [];
  const newlyInvalid: string[] = [];

  for (const c of conns) {
    const label = `${c.external_location_id ?? "?"} / ${c.connection_name ?? "?"}`;
    const outcome = await pingToken("/location", c.access_token as string);
    results.push({ label, outcome });

    if (outcome === "unknown") continue; // señal ambigua: no se toca el estado previo

    const { error: updErr } = await sb
      .from("external_integration")
      .update({ token_status: outcome, token_checked_at: nowIso })
      .eq("id", c.id);
    if (updErr) console.error(`hubrise-connection-health: update ${c.id} falló: ${updErr.message}`);

    if (outcome === "invalid" && c.token_status !== "invalid") newlyInvalid.push(`location ${label}`);

    // Momento con causa natural (Fase 3, A.1 -- no es bucle): un token que
    // ESTABA invalido y AHORA responde ok merece reconfirmar su callback una
    // vez -- pudo perderse o cambiar mientras el token estaba muerto, y hasta
    // el proximo evento (reconectar/desconectar/boton manual) nadie mas lo
    // comprobaria. Una transicion de valor real, no vigilancia periodica.
    if (outcome === "ok" && c.token_status === "invalid") {
      const cb = await ensureHubriseCallback(c.access_token as string);
      const { error: cbErr } = await sb
        .from("external_integration")
        .update({
          callback_status: cb.outcome === "noop" || cb.outcome === "registered" ? "ok" : "unknown",
          callback_checked_at: nowIso,
        })
        .eq("id", c.id);
      if (cbErr) console.error(`hubrise-connection-health: callback_status tras recuperar ${c.id}: ${cbErr.message}`);
    }
  }

  // Escritora (cuenta) -- misma vigía, mismo endpoint "quien soy" (GET
  // /account en vez de /location), token en Vault vía RPC
  // hubrise_writer_token_read (mismo patrón que resolveWriterToken en
  // _shared/hubriseToken.ts). Fase 3, punto 3: la escritora gana salud real,
  // hasta hoy solo se sabía "conectada desde X" sin verificación viva.
  const { data: writersData, error: writersErr } = await sb
    .from("hubrise_writer_connection")
    .select("account_id, hubrise_account_id, token_status");
  if (writersErr) {
    console.error(`hubrise-connection-health: lectura hubrise_writer_connection: ${writersErr.message}`);
  }
  const writers = (writersData ?? []) as WriterRow[];

  for (const w of writers) {
    const label = `${w.hubrise_account_id ?? "?"} / cuenta ${w.account_id}`;
    const { data: token, error: tokenErr } = await sb.rpc("hubrise_writer_token_read", {
      p_account_id: w.account_id,
    });
    if (tokenErr || typeof token !== "string" || token.length === 0) {
      if (tokenErr) console.error(`hubrise-connection-health: token escritor ${w.account_id}: ${tokenErr.message}`);
      results.push({ label: `escritora ${label}`, outcome: "unknown" });
      continue;
    }

    const outcome = await pingToken("/account", token);
    results.push({ label: `escritora ${label}`, outcome });

    if (outcome === "unknown") continue;

    const { error: updErr } = await sb
      .from("hubrise_writer_connection")
      .update({ token_status: outcome, token_checked_at: nowIso })
      .eq("account_id", w.account_id);
    if (updErr) console.error(`hubrise-connection-health: update escritora ${w.account_id} falló: ${updErr.message}`);

    if (outcome === "invalid" && w.token_status !== "invalid") newlyInvalid.push(`escritora ${label}`);
  }

  if (conns.length === 0 && writers.length === 0) {
    return json({ ok: true, checked: 0, note: "sin conexiones HubRise activas con token" });
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
    checked: conns.length + writers.length,
    ok_count: results.filter((r) => r.outcome === "ok").length,
    invalid_count: results.filter((r) => r.outcome === "invalid").length,
    unknown_count: results.filter((r) => r.outcome === "unknown").length,
    newly_invalid: newlyInvalid.length,
    results,
  });
});
