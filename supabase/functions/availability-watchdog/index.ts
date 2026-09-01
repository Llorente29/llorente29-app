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
// (C) brand.closure_mode (Fase B, Cap. B) — cierres de marca OLVIDADOS: sin
//     resume_at (indefinido) hace más de 24h, o con resume_at ya vencido pero
//     closure_mode aún 'paused'. Ver checkStaleBrandClosures.
//
// Ventana de revisión de 20 min para (A)/(B) (solape sobre el cron de 15 min,
// para no perder filas entre corridas). (C) no usa ventana: es estado actual,
// no eventos recientes. No dedupea entre corridas (deuda menor, mismo
// criterio que el original: más ruidoso que perder un fallo en silencio).
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

/**
 * Escala una alarma.
 *
 * CON `debounceKind` va por la COLA (`_queue_system_alert`), que es lo que
 * hacen los demás vigías y lo que da el dedupe. SIN él sigue el camino directo
 * de antes, para no cambiar de golpe el comportamiento de los otros dos avisos
 * de este fichero, que no son estados permanentes.
 *
 * El 01/09 este vigía era el ÚNICO que se saltaba la cola, y por eso mandaba
 * 96 correos al día por una marca cerrada a propósito.
 *
 * La cola la vacía el cron `system-alert-queue-drain`, cada minuto — verificado
 * antes de mover nada aquí: pasar a una cola que nadie drena no habría sido
 * arreglar el ruido, habría sido apagar el aviso.
 */
async function raiseAlert(
  subject: string,
  message: string,
  kind: string,
  debounceKind?: string,
  debounceWindow = "24 hours",
): Promise<void> {
  if (debounceKind) {
    try {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { error } = await sb.rpc("_queue_system_alert", {
        p_kind: kind,
        p_subject: subject,
        p_message: message,
        p_debounce_kind: debounceKind,
        p_debounce_window: debounceWindow,
      });
      if (error) {
        console.error("availability-watchdog: fallo al encolar alarma", error);
      }
    } catch (e) {
      console.error("availability-watchdog: fallo al encolar alarma", e);
    }
    return;
  }

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

/** Clave de dedupe con la fecha dentro, como el resto de la casa
 *  (`venta_sin_casar_..._20260901`): una por cierre y por día natural. */
function claveDelDia(prefijo: string, id: string): string {
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefijo}_${id}_${hoy}`;
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

// (C) Cap. B — cierres de marca OLVIDADOS.
//
// ── TRES ARREGLOS DEL 01/09, y los tres salen del mismo sitio: Julio recibía
//    96 correos al día por UNA marca cerrada a propósito. Uno por corrida, 96
//    corridas al día. Un aviso que llega 96 veces ya no lo lee nadie, que es
//    exactamente el fallo que el vigía venía a evitar.
//
// 1. LEÍA LA TABLA VIEJA. Consultaba `brand.closure_mode/closure_set_at`,
//    pero el estado real vive en `brand_closure` (por LOCAL, desde el 29/08).
//    Medido: Meraki Pita decía 29/08 10:13 en la columna vieja y 01/09 06:33
//    en la fila real — 34 h de desfase. Ahora lee brand_closure, que es la
//    única verdad del cierre (decisión de Julio, 01/09).
//
// 2. NO DECÍA EL LOCAL. Daba marca y cuenta. Con dos locales eso obliga a ir
//    a mirar cuál es. Ahora va el local en cada línea.
//
// 3. SE SALTABA LA COLA. Llamaba a `system-alert` directo, sin pasar por
//    `_queue_system_alert`, así que era el ÚNICO vigía sin dedupe. El
//    «SIN dedupe a propósito» del comentario viejo es defendible para un fallo
//    de EMPUJE, que se resuelve solo; para un ESTADO PERMANENTE es spam.
//    Ahora: un cierre DECLARADO a propósito (deliberate_at) no avisa NUNCA, y
//    uno sin declarar avisa UNA VEZ AL DÍA, con debounce_kind por cierre —
//    para que un cierre nuevo en otro local avise ya, sin quedar tapado por el
//    debounce de otro.
const INDEFINITE_CLOSURE_ALERT_HOURS = 24;
const CLOSURE_DEBOUNCE_HOURS = 24;

interface CierreVivo {
  id: string;
  resume_at: string | null;
  set_at: string | null;
  reason: string | null;
  deliberate_at: string | null;
  brand: { name: string } | null;
  locations: { name: string } | null;
}

async function checkStaleBrandClosures(
  sb: ReturnType<typeof createClient>,
): Promise<{ indefinite: number; expired: number; deliberate: number }> {
  // brand_closure es la única verdad del cierre, y trae el LOCAL.
  const { data: closed, error } = await sb
    .from("brand_closure")
    .select("id, resume_at, set_at, reason, deliberate_at, brand(name), locations(name)")
    .limit(200);

  if (error) {
    console.error("availability-watchdog: error consultando brand_closure", error);
    return { indefinite: 0, expired: 0, deliberate: 0 };
  }

  const rows = (closed ?? []) as unknown as CierreVivo[];
  if (rows.length === 0) return { indefinite: 0, expired: 0, deliberate: 0 };

  const now = Date.now();
  const indefiniteCutoff = now - INDEFINITE_CLOSURE_ALERT_HOURS * 60 * 60 * 1000;

  // DECLARADO A PROPÓSITO -> no avisa NUNCA. No se cuenta como olvido porque no
  // lo es: alguien dijo con su nombre que esa marca está cerrada a propósito.
  const deliberados = rows.filter((c) => c.deliberate_at !== null);

  const indefinite = rows.filter((c) =>
    c.deliberate_at === null && !c.resume_at && c.set_at &&
    new Date(c.set_at).getTime() < indefiniteCutoff);

  // Los VENCIDOS no miran deliberate_at: una fecha que ya pasó es un descuido
  // la declare quien la declare.
  const expired = rows.filter((c) =>
    !!c.resume_at && new Date(c.resume_at).getTime() < now);

  const nombre = (c: CierreVivo) =>
    `${c.brand?.name ?? "(marca sin nombre)"} · ${c.locations?.name ?? "(local desconocido)"}`;

  // UN AVISO POR CIERRE, con su propia clave de dedupe. Así un cierre nuevo en
  // otro local avisa en cuanto aparece, en vez de quedar tapado por la ventana
  // de otro que no tiene nada que ver con él.
  for (const c of indefinite) {
    await raiseAlert(
      `Marca cerrada sin fecha: ${nombre(c)}`,
      `${nombre(c)} lleva cerrada desde ${c.set_at} sin fecha de reapertura ` +
      `(más de ${INDEFINITE_CLOSURE_ALERT_HOURS}h). Sin expires_at NO se reabre sola en HubRise.\n` +
      `Motivo: ${c.reason ?? "(sin motivo)"}\n\n` +
      `Si es a propósito, márcalo con «Es a propósito» en la tarjeta del cierre ` +
      `y este aviso deja de llegar.`,
      "brand-closure",
      claveDelDia("brand_closure_indefinido", c.id),
    );
  }

  for (const c of expired) {
    await raiseAlert(
      `Cierre vencido sin reabrir: ${nombre(c)}`,
      `${nombre(c)} debía reabrir el ${c.resume_at} y sigue cerrada en Folvy. ` +
      `HubRise ya la reabrió sola (expires_at): es limpieza de Folvy, no fallo de plataforma.`,
      "brand-closure",
      claveDelDia("brand_closure_vencido", c.id),
    );
  }

  return { indefinite: indefinite.length, expired: expired.length, deliberate: deliberados.length };
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

  const [availability, locationStatus, staleBrandClosures] = await Promise.all([
    checkAvailabilityPushLog(sb, since),
    checkLocationStatusLog(sb, since),
    checkStaleBrandClosures(sb),
  ]);

  const ok = availability.failures === 0 && locationStatus.failures === 0
    && staleBrandClosures.indefinite === 0 && staleBrandClosures.expired === 0;
  return json({
    ok,
    checked_since: since,
    availability_push_log: availability,
    location_status_log: locationStatus,
    brand_closures: staleBrandClosures,
  }, ok ? 200 : 207);
});
