// clockout-reminder: drena clockout_reminder_log 'queued' y envía el recordatorio
// de olvido de fichaje de salida por Meta WhatsApp Cloud API.
// Calcado de training-notify (misma tubería probada, mismos secrets).
//
// DESCONEXIÓN DIGITAL: este aviso llega al EMPLEADO y puede caer fuera de su
// jornada (por definición: olvidó salir). Es legal porque el empleado ha
// consentido recibirlo (employees.forgot_clockout_reminder = true) y puede
// renunciar desde su portal. La detección (enqueue_clockout_reminders) ya
// respeta el opt-out; aquí solo enviamos lo encolado.
//
// El magic link se genera fresco en cada envío. Idempotente por fila.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "es";
const GRAPH_VER = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const SYNTHETIC_EMAIL_DOMAIN = "empleado.folvy.app";
const TEMPLATE = "recordatorio_fichaje_salida";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

function normPhone(raw: string): string {
  let p = (raw ?? "").replace(/[\s\-()]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (!p.startsWith("34") && p.length === 9) p = "34" + p;
  return p;
}

// {{1}} nombre, {{2}} hora teórica de salida. Botón URL: token_hash del empleado.
async function sendTemplate(to: string, name: string, langCode: string, params: string[], buttonSuffix: string) {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: langCode },
        components: [
          { type: "body", parameters: params.map((t) => ({ type: "text", text: t })) },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonSuffix }] },
        ],
      },
    }),
  });
  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data };
}

// deno-lint-ignore no-explicit-any
async function magicTokenHashFor(admin: any, username: string): Promise<string | null> {
  const email = `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) return null;
  return data.properties.hashed_token as string;
}

Deno.serve(async (_req) => {
  if (!WA_TOKEN || !WA_PHONE_ID) return json({ error: "faltan secretos WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID" }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Primero, detectar y encolar nuevos olvidos.
  try { await sb.rpc("enqueue_clockout_reminders"); } catch (_) { /* seguimos con lo que haya */ }

  const { data: rows, error } = await sb
    .from("clockout_reminder_log")
    .select("*")
    .eq("status", "queued")
    .lt("attempts", 3)
    .limit(25);
  if (error) return json({ error: error.message }, 500);

  const results: unknown[] = [];
  for (const n of rows ?? []) {
    const nowIso = new Date().toISOString();
    try {
      const toPhone = normPhone(String(n.to_phone ?? ""));
      if (!toPhone) {
        await sb.from("clockout_reminder_log").update({ status: "skipped", skip_reason: "sin_telefono", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, skipped: "sin_telefono" });
        continue;
      }

      // Datos del empleado: username (magic link) + nombre + hora teórica de salida.
      const { data: emp } = await sb.from("employees").select("username, name").eq("id", n.employee_id).maybeSingle();
      if (!emp?.username) {
        await sb.from("clockout_reminder_log").update({ status: "skipped", skip_reason: "sin_username", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, skipped: "sin_username" });
        continue;
      }

      const tokenHash = await magicTokenHashFor(sb, emp.username);
      if (!tokenHash) {
        const attempts = (n.attempts ?? 0) + 1;
        await sb.from("clockout_reminder_log").update({ status: attempts >= 3 ? "failed" : "queued", attempts, error: "magic_link_failed", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, ok: false, error: "magic_link_failed" });
        continue;
      }

      const firstName = String(emp.name ?? "").trim().split(" ")[0] || "Hola";
      // {{2}} hora teórica de salida (guardada al encolar). Fallback genérico.
      const endTime = String(n.scheduled_end ?? "").trim() || "tu hora de salida";
      const params = [firstName, endTime];

      const r = await sendTemplate(toPhone, TEMPLATE, WA_LANG, params, tokenHash);
      const wamid = (r.data as any)?.messages?.[0]?.id;

      if (r.ok && wamid) {
        await sb.from("clockout_reminder_log").update({ status: "sent", provider_message_id: wamid, sent_at: nowIso, updated_at: nowIso, error: null }).eq("id", n.id);
        results.push({ id: n.id, ok: true, wamid });
      } else {
        const attempts = (n.attempts ?? 0) + 1;
        await sb.from("clockout_reminder_log").update({ status: attempts >= 3 ? "failed" : "queued", attempts, error: JSON.stringify((r.data as any)?.error ?? r.data), updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, ok: false, error: (r.data as any)?.error ?? r.data });
      }
    } catch (e) {
      const attempts = (n.attempts ?? 0) + 1;
      await sb.from("clockout_reminder_log").update({ status: attempts >= 3 ? "failed" : "queued", attempts, error: String(e), updated_at: nowIso }).eq("id", n.id);
      results.push({ id: n.id, ok: false, error: String(e) });
    }
  }
  return json({ processed: results.length, results });
});
