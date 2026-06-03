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
    `Origen: vigilante de ingesta (Folvy)`;

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
