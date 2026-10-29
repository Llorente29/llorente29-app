// clockout-reminder: el aviso de olvido de fichaje de salida por WhatsApp, y
// el correo de los avisos a la empresa. La despierta el cron
// clockout-reminder-drain cada 10 min.
//
// L1a · PR 3 (28/10/2026):
//   1. Detecta (enqueue_clockout_reminders, en hora de Madrid: una entrada
//      abierta con su turno acabado hace más del margen, o 12 h sin turno).
//   2. Manda lo que deja la cola (aviso_olvido_cola), que antes vuelve a
//      mirar que la entrada sigue abierta y que es hora (08:00–22:00 o la
//      franja de la empresa). Con la plantilla nueva, el mensaje lleva tres
//      respuestas de un toque (las recibe whatsapp-webhook). Si la plantilla
//      nueva no está puesta (WHATSAPP_PLANTILLA_OLVIDO), se manda la de antes
//      (recordatorio_fichaje_salida, con el enlace al portal): el aviso nunca
//      se queda sin salir por un paso pendiente en Meta.
//   3. Manda por correo los avisos a la empresa (aviso_empresa): fuera del
//      radio y «los avisos no salen», a los administradores y a los
//      encargados del local.
//
// DESCONEXIÓN DIGITAL: el aviso llega al EMPLEADO y por definición cae al
// acabar su jornada. Es legal porque lo ha consentido
// (employees.forgot_clockout_reminder) y puede renunciar desde su portal; y
// nunca sale de noche: fuera de la franja, solo lo ve en su portal.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { correoAviso, mensajePlantilla, telefonoMeta } from "../_shared/avisoOlvido.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "es";
const GRAPH_VER = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const PLANTILLA_CON_TURNO = Deno.env.get("WHATSAPP_PLANTILLA_OLVIDO") ?? "";
const PLANTILLA_SIN_TURNO = Deno.env.get("WHATSAPP_PLANTILLA_OLVIDO_SIN_TURNO") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_URL = Deno.env.get("VITE_APP_URL") ?? "https://app.folvy.app";
const SYNTHETIC_EMAIL_DOMAIN = "empleado.folvy.app";
const PLANTILLA_ANTIGUA = "recordatorio_fichaje_salida";
const FROM = "Folvy <no-reply@folvy.app>";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

async function enviar(to: string, template: Record<string, unknown>) {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// deno-lint-ignore no-explicit-any
async function magicTokenHashFor(admin: any, username: string): Promise<string | null> {
  const email = `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) return null;
  return data.properties.hashed_token as string;
}

// deno-lint-ignore no-explicit-any
async function mandarAvisos(sb: any) {
  const results: unknown[] = [];
  const { data: rows, error } = await sb.rpc("aviso_olvido_cola", { p_limite: 25 });
  if (error) return { error: error.message, results };

  for (const n of rows ?? []) {
    const nowIso = new Date().toISOString();
    const fallo = async (motivo: string) => {
      const attempts = (n.attempts ?? 0) + 1;
      await sb.from("clockout_reminder_log").update({ status: attempts >= 3 ? "failed" : "queued", attempts, error: motivo, updated_at: nowIso }).eq("id", n.id);
      results.push({ id: n.id, ok: false, error: motivo });
    };
    try {
      const to = telefonoMeta(n.to_phone);
      if (!to) {
        await sb.from("clockout_reminder_log").update({ status: "skipped", canal: "portal", skip_reason: "sin_telefono", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, skipped: "sin_telefono" });
        continue;
      }
      let template = mensajePlantilla(
        { id: n.id, nombre: n.nombre, localNombre: n.local_nombre, finHora: n.fin_hora, entradaHora: n.entrada_hora, conTurno: !!n.con_turno },
        { conTurno: PLANTILLA_CON_TURNO, sinTurno: PLANTILLA_SIN_TURNO },
        WA_LANG,
      );
      if (!template) {
        // La de antes: un enlace al portal en el botón.
        if (!n.username) {
          await sb.from("clockout_reminder_log").update({ status: "skipped", canal: "portal", skip_reason: "sin_username", updated_at: nowIso }).eq("id", n.id);
          results.push({ id: n.id, skipped: "sin_username" });
          continue;
        }
        const tokenHash = await magicTokenHashFor(sb, n.username);
        if (!tokenHash) { await fallo("magic_link_failed"); continue; }
        template = {
          name: PLANTILLA_ANTIGUA,
          language: { code: WA_LANG },
          components: [
            { type: "body", parameters: [n.nombre, n.fin_hora || "tu hora de salida"].map((t: string) => ({ type: "text", text: t })) },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: tokenHash }] },
          ],
        };
      }
      const r = await enviar(to, template);
      // deno-lint-ignore no-explicit-any
      const wamid = (r.data as any)?.messages?.[0]?.id;
      if (r.ok && wamid) {
        await sb.from("clockout_reminder_log").update({ status: "sent", provider_message_id: wamid, sent_at: nowIso, updated_at: nowIso, error: null }).eq("id", n.id);
        results.push({ id: n.id, ok: true });
      } else {
        // deno-lint-ignore no-explicit-any
        await fallo(JSON.stringify((r.data as any)?.error ?? r.data ?? { status: r.status }));
      }
    } catch (e) {
      await fallo(String(e));
    }
  }
  return { results };
}

// deno-lint-ignore no-explicit-any
async function mandarCorreos(sb: any) {
  const { data: avisos, error } = await sb.rpc("avisos_empresa_por_enviar", { p_limite: 20 });
  if (error) return { error: error.message };
  let enviados = 0;
  for (const a of avisos ?? []) {
    const nowIso = new Date().toISOString();
    const para: string[] = a.destinatarios ?? [];
    if (para.length === 0) {
      await sb.from("aviso_empresa").update({ correo_estado: "sin_destinatarios", correo_a: 0, correo_at: nowIso }).eq("id", a.id);
      continue;
    }
    if (!RESEND_KEY) {
      await sb.from("aviso_empresa").update({ correo_estado: "sin_clave", correo_a: 0, correo_at: nowIso, correo_error: "Falta RESEND_API_KEY" }).eq("id", a.id);
      continue;
    }
    const c = correoAviso(a.titulo, a.texto, `${APP_URL}/personal`);
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: para, subject: c.asunto, html: c.html, text: c.texto }),
      });
      if (r.ok) {
        enviados++;
        await sb.from("aviso_empresa").update({ correo_estado: "enviado", correo_a: para.length, correo_at: nowIso, correo_error: null }).eq("id", a.id);
      } else {
        const t = await r.text().catch(() => "");
        await sb.from("aviso_empresa").update({ correo_estado: "fallo", correo_a: para.length, correo_at: nowIso, correo_error: `HTTP ${r.status} ${t.slice(0, 300)}` }).eq("id", a.id);
      }
    } catch (e) {
      await sb.from("aviso_empresa").update({ correo_estado: "fallo", correo_at: nowIso, correo_error: String(e).slice(0, 300) }).eq("id", a.id);
    }
  }
  return { enviados };
}

Deno.serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1. Detectar. Si falla, lo dice el vigía (vigia_avisos_olvido también detecta).
  const det = await sb.rpc("enqueue_clockout_reminders");

  // 2. Los avisos. Sin la llave de WhatsApp no sale ninguno: se queda en cola,
  //    y el vigía avisa a la empresa a los 30 min.
  const avisos = WA_TOKEN && WA_PHONE_ID ? await mandarAvisos(sb) : { error: "faltan WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID" };

  // 3. Los correos a la empresa.
  const correos = await mandarCorreos(sb);

  return json({ detectados: det.data ?? null, detectar_error: det.error?.message ?? null, avisos, correos });
});
