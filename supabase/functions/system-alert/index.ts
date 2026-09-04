// supabase/functions/system-alert/index.ts
//
// Canal de alarma de SISTEMA (NO correo de clientes). Lo usan los vigilantes de
// ingesta (ping sintético, y en el futuro la Capa 1 de frescura) para avisar a
// operaciones por email cuando algo falla en la tubería de datos.
//
// Separado a propósito de `send-email` (correo transaccional de clientes/plataforma):
// distinto remitente conceptual, distinto destino, distinta criticidad.
//
// SEGURIDAD: protegido por un secreto compartido `CRON_SECRET` en la cabecera
// `x-cron-secret`. Sin él -> 401. Se despliega con --no-verify-jwt (lo invoca el
// cron internamente vía pg_net; el gateway no debe exigir JWT).
//
// Variables de entorno (secrets de Supabase):
//   RESEND_API_KEY   -- ya existe (correo transaccional)
//   SYSTEM_ALERT_TO  -- destino de las alarmas de operaciones (email)
//   CRON_SECRET      -- secreto compartido cron <-> functions internas
//
// Cuerpo esperado (JSON): { "subject": string, "message": string, "kind"?: string }

import { corsHeaders } from "../_shared/cors.ts";

interface AlertBody {
  subject?: string;
  message?: string;
  kind?: string;
}

const FROM = "Folvy Alertas <no-reply@folvy.app>";
const REPLY_TO = "jgcolon@idasal.com";

// Origen visible en el pie del correo — derivado de `kind`, nunca fijo.
// Antes decía "vigilante de ingesta (Folvy)" en TODOS los avisos, incluidos
// los del vigía de salud de BBDD (kind='db-health*'), que es un sistema
// distinto — en una alerta real de madrugada ese pie manda a mirar donde no
// es. Lista cerrada de kinds conocidos (11/08); el fallback nunca afirma un
// origen que no se puede verificar, muestra el kind crudo en su lugar.
function originFor(kind: string): string {
  if (kind.startsWith("db-health")) return "vigía de salud de BBDD (Folvy)";
  if (kind === "synthetic_ping") return "vigilante de ingesta — ping sintético (Folvy)";
  if (kind === "catcher-delivery") return "Catcher — entregas de pedidos (Folvy)";
  if (kind === "hubrise-callback") return "HubRise — callback de disponibilidad (Folvy)";
  if (kind === "hubrise-connection-health") return "HubRise — salud de token por conexión (Folvy)";
  if (kind === "hubrise-revoke-pending") return "HubRise — revocación de token pendiente (Folvy)";
  if (kind === "availability-dispatch" || kind === "location-status-dispatch" || kind === "brand-closure") {
    return "vigía de disponibilidad HubRise (Folvy)";
  }
  // B61 (04/09). El pie decía «kind sin mapear» en 6 de los 8 tipos que de
  // verdad se usan — 80 de los 89 avisos encolados, incluidos los 34 de
  // ingesta_silencio. Un aviso que se ve a medio hacer se acaba ignorando, y
  // entonces el vigía deja de servir aunque funcione.
  if (kind === "edge_drift") return "vigía de deriva de Edge Functions (Folvy)";
  if (kind === "ingesta_silencio") return "vigía de silencio de ingesta (Folvy)";
  if (kind === "venta_producto_sin_casar") return "vigía de ventas sin casar (Folvy)";
  if (kind === "kds_device_silencio") return "vigía de tablets mudas (Folvy)";
  if (kind === "kds_device_desfasado") return "vigía de bundle desfasado en tablet (Folvy)";
  if (kind === "autoinventario") return "autoinventario — cola de conteos (Folvy)";
  if (kind === "cost_sweep") return "barrido nocturno de costes de línea (Folvy)";
  // El fallback se queda: nunca afirma un origen que no se puede verificar.
  // Que salga es la señal de que hay un vigía nuevo sin dar de alta aquí.
  return `Folvy — kind sin mapear: "${kind}"`;
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

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  // --- Gating por secreto compartido ---
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || got !== cronSecret) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let body: AlertBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const subject = (body.subject ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!subject || !message) {
    return json(400, { ok: false, error: "subject_and_message_required" });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const to = Deno.env.get("SYSTEM_ALERT_TO") ?? "";
  if (!resendKey || !to) {
    return json(500, { ok: false, error: "missing_config" });
  }

  const kind = (body.kind ?? "system").trim();
  const prefixedSubject = `[Folvy · alerta] ${subject}`;
  const text =
    `${message}\n\n` +
    `— — —\n` +
    `Tipo: ${kind}\n` +
    `Enviado: ${new Date().toISOString()}\n` +
    `Origen: ${originFor(kind)}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject: prefixedSubject,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json(502, { ok: false, error: "resend_failed", status: res.status, detail });
    }

    const data = await res.json();
    return json(200, { ok: true, id: data?.id ?? null });
  } catch (e) {
    return json(502, { ok: false, error: "resend_exception", detail: String(e) });
  }
});
