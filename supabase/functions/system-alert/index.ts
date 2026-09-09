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
// ── LA PLANTILLA ÚNICA (09/09, paso 4 del estándar de alertas) ────────────
// El asunto y el pie se COMPONEN aquí, desde campos, con una sola plantilla.
// Ningún vigía vuelve a escribir su propio «[Negocio · Local]»: lo pone esto,
// igual para todos, o no lo pone nadie. Así el estándar se cumple por
// construcción y no vigía a vigía.
//
// Los campos los resuelve el drenaje (`system_alert_queue_drain`), que es quien
// tiene las tablas para convertir `account_id`/`location_id`/`brand_id` en
// nombres. Aquí sólo se pinta.
//
// Cuerpo esperado (JSON):
//   { subject, message, kind?, severity?, negocio?, local?, marca?,
//     alerta_id?, creado_at? }
//
// LOS CAMPOS NUEVOS SON OPCIONALES A PROPÓSITO: la reserva de
// `_shared/alerta.ts` —el POST directo para cuando la base no está— sólo puede
// mandar subject/message/kind. Si esto exigiera los campos, el único aviso que
// importa de verdad (la base caída) sería el único que no saldría.

import { corsHeaders } from "../_shared/cors.ts";
import { componerCorreo } from "../_shared/plantillaAlerta.ts";

// El remitente y el «responder a» se quedan aquí, en la frontera: son del
// canal de correo, no de la plantilla.
const FROM = "Folvy Alertas <no-reply@folvy.app>";
const REPLY_TO = "jgcolon@idasal.com";

interface AlertBody {
  subject?: string;
  message?: string;
  kind?: string;
  severity?: string | null;
  negocio?: string | null;
  local?: string | null;
  marca?: string | null;
  alerta_id?: number | null;
  creado_at?: string | null;
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

  const { asunto, text, html } = componerCorreo({
    subject, message,
    kind: body.kind,
    severity: body.severity,
    negocio: body.negocio,
    local: body.local,
    marca: body.marca,
    alerta_id: body.alerta_id,
    creado_at: body.creado_at,
  });

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
        subject: asunto,
        text,
        html,
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
