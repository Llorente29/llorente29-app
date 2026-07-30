// supabase/functions/availability-watchdog/index.ts
//
// VIGÍA de disponibilidad (86) — cron cada 15 min (20260730T1540). Cierra el
// agujero "nadie mira el log": revisa availability_push_log (columna `source`,
// 20260730T1510) buscando fallos recientes del tramo HubRise (Folvy es dueño
// de HubRise, escribe de verdad — a diferencia de Last, que desde v4 de
// availability-dispatch es solo lectura y no logea fallos, solo un aviso
// informativo). Si hay fallos, escala UNA alarma agregada a `system-alert`
// (email a operaciones) — mismo patrón que hubrise-callback-ensure.
//
// Distingue dos casos en el mensaje:
//   · fallo al AGOTAR  (enable=false): el producto puede seguir vendible en
//     HubRise aunque en Folvy figure agotado.
//   · fallo al REACTIVAR (enable=true): el producto puede quedar "PEGADO"
//     (agotado en HubRise) sin que nada más lo detecte — Folvy ya borró su
//     propio product_availability al reactivar, así que el panel deja de
//     mostrarlo como agotado aunque en HubRise siga apagado.
//
// Ventana de revisión de 20 min (solape sobre el cron de 15 min, para no
// perder filas entre corridas). No re-alerta filas ya vistas: se guarda la
// marca de tiempo del último aviso en una tabla ligera (evita spam si el
// fallo persiste corrida tras corrida) — en su ausencia, cae a "avisar
// siempre que haya algo en la ventana" (más ruidoso pero nunca en silencio).
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

async function raiseAlert(subject: string, message: string): Promise<void> {
  if (!CRON_SECRET) {
    console.error("availability-watchdog: CRON_SECRET ausente -> no se pudo escalar alarma:", subject);
    return;
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ subject, message, kind: "availability-dispatch" }),
    });
  } catch (e) {
    console.error("availability-watchdog: fallo al escalar alarma", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

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
    return json({ ok: false, error: error.message }, 500);
  }

  const rows = failures ?? [];
  if (rows.length === 0) {
    return json({ ok: true, checked_since: since, failures: 0 });
  }

  const stuck = rows.filter((r) => r.enable === true);   // reactivar falló -> posible pegado
  const soldOutFailed = rows.filter((r) => r.enable !== true); // agotar falló

  const lines: string[] = [];
  lines.push(`Ventana revisada: últimos ${WINDOW_MINUTES} min (desde ${since}).`);
  lines.push(`Fallos totales en el tramo HubRise: ${rows.length}.`);
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

  await raiseAlert(
    `Fallos de disponibilidad en HubRise (${rows.length})`,
    lines.join("\n"),
  );

  return json({
    ok: false,
    checked_since: since,
    failures: rows.length,
    stuck_reactivations: stuck.length,
    sold_out_failed: soldOutFailed.length,
  }, 207);
});
