// training-notify: drena training_notice 'queued' y las envía por Meta WhatsApp
// Cloud API. Calcado de customer-notify (misma tubería probada, mismos secrets).
//
// DESCONEXIÓN DIGITAL (núcleo legal): un aviso solo se envía si el empleado está
// FICHADO EN ENTRADA ahora mismo (training_is_clocked_in). Si no lo está, se
// deja en 'queued' y el cron lo reintenta cada minuto — llegará en cuanto fiche.
//
// El magic link se genera FRESCO en cada envío (no se guarda en la cola): más
// seguro (no reposa una credencial en BBDD) y siempre válido.
//
// Idempotente por fila; marca sent/failed; reintenta hasta 3.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "es";
const GRAPH_VER = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const NOTIFY_SECRET = Deno.env.get("CUSTOMER_NOTIFY_SECRET") ?? "";
const APP_URL = Deno.env.get("VITE_APP_URL") ?? "https://app.folvy.app";
const SYNTHETIC_EMAIL_DOMAIN = "empleado.folvy.app";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

// Normaliza a E.164 sin '+': quita espacios/guiones, antepone 34 si no hay prefijo.
function normPhone(raw: string): string {
  let p = (raw ?? "").replace(/[\s\-()]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (!p.startsWith("34") && p.length === 9) p = "34" + p;
  return p;
}

// Envía el template de formación. Body: {{1}} nombre, {{2}} gancho, {{3}} minutos.
// Botón URL dinámico: componente 'button' con el sufijo del token_hash.
async function sendTemplate(to: string, name: string, langCode: string, params: string[], buttonUrlSuffix: string) {
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
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonUrlSuffix }] },
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

Deno.serve(async (req) => {
  if (NOTIFY_SECRET) {
    if (req.headers.get("x-notify-secret") !== NOTIFY_SECRET) return json({ error: "forbidden" }, 403);
  }
  if (!WA_TOKEN || !WA_PHONE_ID) return json({ error: "faltan secretos WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID" }, 500);

  let bodyIn: Record<string, unknown> = {};
  try { bodyIn = await req.json(); } catch (_) { /* sin body */ }
  const onlyId = (bodyIn?.id as string) ?? null;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  let q = sb.from("training_notice").select("*")
    .eq("channel", "whatsapp").eq("status", "queued").lt("attempts", 3).limit(25);
  if (onlyId) q = sb.from("training_notice").select("*").eq("id", onlyId).limit(1);

  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: unknown[] = [];
  for (const n of rows ?? []) {
    const nowIso = new Date().toISOString();
    try {
      // 1) DESCONEXIÓN DIGITAL: ¿está fichado en entrada AHORA?
      const { data: clocked, error: clkErr } = await sb.rpc("training_is_clocked_in", { p_employee_id: n.employee_id });
      if (clkErr) throw new Error("training_is_clocked_in: " + clkErr.message);
      if (clocked !== true) {
        // No está trabajando -> se queda en cola, se reintenta en el próximo drenaje.
        results.push({ id: n.id, skipped: "no_fichado" });
        continue;
      }

      // 2) Teléfono
      const toPhone = normPhone(String(n.to_phone ?? ""));
      if (!toPhone) {
        await sb.from("training_notice").update({ status: "skipped", skip_reason: "sin_telefono", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, skipped: "sin_telefono" });
        continue;
      }

      // 3) Username del empleado para el magic link
      const { data: emp } = await sb.from("employees").select("username").eq("id", n.employee_id).maybeSingle();
      if (!emp?.username) {
        await sb.from("training_notice").update({ status: "skipped", skip_reason: "sin_username", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, skipped: "sin_username" });
        continue;
      }

      // 4) Magic link fresco -> token_hash -> sufijo de la URL del botón
      const tokenHash = await magicTokenHashFor(sb, emp.username);
      if (!tokenHash) {
        const attempts = (n.attempts ?? 0) + 1;
        await sb.from("training_notice").update({ status: attempts >= 3 ? "failed" : "queued", attempts, error: "magic_link_failed", updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, ok: false, error: "magic_link_failed" });
        continue;
      }
      // El template tiene URL base https://app.folvy.app/acceso?token_hash={{1}}&type=magiclink
      // (el &type=magiclink va FIJO en la URL base del template, editado en Meta).
      // El parámetro dinámico del botón es SOLO el tokenHash — sin '&', para que
      // Meta no lo escape (opción A, robusta). El trabajador aterriza en /acceso,
      // el portal enruta por rol y ve sus cursos pendientes destacados en el home.
      const buttonSuffix = tokenHash;

      // 5) Params del cuerpo
      const p = (n.payload ?? {}) as Record<string, unknown>;
      const params = [String(p.nombre ?? "Hola"), String(p.gancho ?? ""), String(p.minutos ?? "10")];

      // 6) Enviar
      const r = await sendTemplate(toPhone, n.template ?? "formacion_curso_disponible", n.lang || WA_LANG, params, buttonSuffix);
      const wamid = (r.data as any)?.messages?.[0]?.id;

      if (r.ok && wamid) {
        await sb.from("training_notice").update({
          status: "sent", provider_message_id: wamid, sent_at: nowIso, updated_at: nowIso, error: null,
        }).eq("id", n.id);
        results.push({ id: n.id, ok: true, wamid });
      } else {
        const attempts = (n.attempts ?? 0) + 1;
        await sb.from("training_notice").update({
          status: attempts >= 3 ? "failed" : "queued", attempts,
          error: JSON.stringify((r.data as any)?.error ?? r.data), updated_at: nowIso,
        }).eq("id", n.id);
        results.push({ id: n.id, ok: false, error: (r.data as any)?.error ?? r.data });
      }
    } catch (e) {
      const attempts = (n.attempts ?? 0) + 1;
      await sb.from("training_notice").update({
        status: attempts >= 3 ? "failed" : "queued", attempts, error: String(e), updated_at: nowIso,
      }).eq("id", n.id);
      results.push({ id: n.id, ok: false, error: String(e) });
    }
  }
  return json({ processed: results.length, results });
});
