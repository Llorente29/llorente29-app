// supabase/functions/availability-watchdog/index.ts
//
// VIGÍA de HubRise — cron cada 15 min (20260730T1540). Cierra el agujero
// "nadie mira el log": revisa DOS tablas de log de empuje a HubRise y escala
// alarma agregada a `system-alert` (email a operaciones) — mismo patrón que
// hubrise-callback-ensure.
//
// (A) availability_push_log (columna `source`, 20260730T1510) — Fase 0, 86 por
//     producto. Solo el tramo HubRise (Folvy es dueño, escribe de verdad; Last
//     es solo lectura desde v4 de availability-dispatch y no logea fallos).
//     Distingue fallo al AGOTAR vs fallo al REACTIVAR (posible "pegado").
//
// (B) location_status_log (20260730T1610) — Fase A, Cap. C (cerrar/reabrir
//     local) y Cap. D (horario semanal). Un fallo aquí dice: Folvy cree que el
//     local está en un estado (cerrado / con tal horario) que HubRise nunca
//     confirmó -> estado incoherente entre Folvy y la plataforma.
//
// Ventana de revisión de 20 min (solape sobre el cron de 15 min, para no
// perder filas entre corridas). No dedupea entre corridas (deuda menor,
// mismo criterio que el original: más ruidoso que perder un fallo en silencio).
//
// Deploy: --no-verify-jwt (inocua; sin params externos, solo lee y alerta).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const WINDOW_MINUTES = 20;

function json(o: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function raiseAlert(subject: string, message: string, kind: string): Promise<void> {
  if (!CRON_SECRET) {
    console.error("availability-watchdog: CRON_SECRET ausente -> no se pudo escalar alarma:", subject);
    return;
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ subject, message, kind }),
    });
  } catch (e) {
    console.error("availability-watchdog: fallo al escalar alarma", e);
  }
}

// (A) 86 por producto — tramo HubRise de availability_push_log.
async function checkAvailabilityPushLog(
  sb: ReturnType<typeof createClient>, since: string,
): Promise<{ failures: number; stuck: number; soldOutFailed: number }> {
  const { data: failures, error } = await sb
    .from("availability_push_log")
    .select("account_id, enable, error, created_at")
    .eq("source", "hubrise")
    .eq("ok", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("availability-watchdog: error consultando availability_push_log", error);
    return { failures: 0, stuck: 0, soldOutFailed: 0 };
  }

  const rows = failures ?? [];
  if (rows.length === 0) return { failures: 0, stuck: 0, soldOutFailed: 0 };

  const stuck = rows.filter((r) => r.enable === true);
  const soldOutFailed = rows.filter((r) => r.enable !== true);

  const lines: string[] = [];
  lines.push(`Ventana revisada: últimos ${WINDOW_MINUTES} min (desde ${since}).`);
  lines.push(`Fallos totales en el tramo HubRise (86 por producto): ${rows.length}.`);
  if (stuck.length > 0) {
    lines.push("");
    lines.push(`⚠️ REACTIVAR falló ${stuck.length} vez/veces — posible producto PEGADO en HubRise (Folvy ya lo da por disponible):`);
    for (const r of stuck.slice(0, 10)) {
      lines.push(`  - ${r.created_at} · cuenta ${r.account_id} · ${r.error ?? "(sin detalle)"}`);
    }
  }
  if (soldOutFailed.length > 0) {
    lines.push("");
    lines.push(`AGOTAR falló ${soldOutFailed.length} vez/veces — el producto puede seguir vendible en HubRise aunque Folvy lo marque agotado:`);
    for (const r of soldOutFailed.slice(0, 10)) {
      lines.push(`  - ${r.created_at} · cuenta ${r.account_id} · ${r.error ?? "(sin detalle)"}`);
    }
  }

  await raiseAlert(`Fallos de disponibilidad en HubRise (${rows.length})`, lines.join("\n"), "availability-dispatch");
  return { failures: rows.length, stuck: stuck.length, soldOutFailed: soldOutFailed.length };
}

// (B) Cap. C/D — location_status_log (cerrar/reabrir local, horario semanal).
async function checkLocationStatusLog(
  sb: ReturnType<typeof createClient>, since: string,
): Promise<{ failures: number }> {
  const { data: failures, error } = await sb
    .from("location_status_log")
    .select("account_id, location_id, kind, mode, surface, error, created_at")
    .eq("ok", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("availability-watchdog: error consultando location_status_log", error);
    return { failures: 0 };
  }

  const rows = failures ?? [];
  if (rows.length === 0) return { failures: 0 };

  const lines: string[] = [];
  lines.push(`Ventana revisada: últimos ${WINDOW_MINUTES} min (desde ${since}).`);
  lines.push(`Fallos totales empujando estado/horario de local a HubRise: ${rows.length}.`);
  lines.push("Folvy puede estar mostrando un estado (cerrado/horario) que HubRise nunca confirmó -> local en estado INCOHERENTE.");
  lines.push("");
  for (const r of rows.slice(0, 15)) {
    const detail = r.kind === "order_acceptance" ? `mode=${r.mode ?? "?"}` : "horario semanal";
    lines.push(`  - ${r.created_at} · cuenta ${r.account_id} · local ${r.location_id} · ${r.kind} (${detail}) · ${r.surface} · ${r.error ?? "(sin detalle)"}`);
  }

  await raiseAlert(`Fallos de estado/horario de local en HubRise (${rows.length})`, lines.join("\n"), "location-status-dispatch");
  return { failures: rows.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const [availability, locationStatus] = await Promise.all([
    checkAvailabilityPushLog(sb, since),
    checkLocationStatusLog(sb, since),
  ]);

  const ok = availability.failures === 0 && locationStatus.failures === 0;
  return json({
    ok,
    checked_since: since,
    availability_push_log: availability,
    location_status_log: locationStatus,
  }, ok ? 200 : 207);
});
