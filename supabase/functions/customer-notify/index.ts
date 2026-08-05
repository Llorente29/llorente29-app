// customer-notify: drena customer_notification 'pending' y las envía por Meta WhatsApp Cloud API.
// Idempotente por fila; marca sent/failed; reintenta hasta 3.
// COPIA SOMBRA (debug): las primeras N reales se reenvían a un número de control (auto-apaga al llegar a N).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "es";
const GRAPH_VER = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const NOTIFY_SECRET = Deno.env.get("CUSTOMER_NOTIFY_SECRET") ?? "";
// Copia sombra: por defecto al móvil de Julio, 3 reales. Se puede desactivar con LIMIT=0.
const SHADOW_TO = Deno.env.get("CUSTOMER_NOTIFY_SHADOW_TO") ?? "34695043886";
const SHADOW_LIMIT = Number(Deno.env.get("CUSTOMER_NOTIFY_SHADOW_LIMIT") ?? "3");

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

async function sendTemplate(to: string, name: string, langCode: string, params: string[]) {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name, language: { code: langCode }, components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] },
    }),
  });
  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data };
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
  let q = sb.from("customer_notification").select("*").eq("channel", "whatsapp").eq("status", "pending").lt("attempts", 3).limit(25);
  if (onlyId) q = sb.from("customer_notification").select("*").eq("id", onlyId).limit(1);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: unknown[] = [];
  for (const n of rows ?? []) {
    const nowIso = new Date().toISOString();
    try {
      const p = (n.payload ?? {}) as Record<string, unknown>;
      const params = [String(p.customer_name ?? "Hola"), String(p.brand ?? "tu pedido"), String(p.track_url ?? "")];
      const r = await sendTemplate(String(n.to_phone), n.template ?? "pedido_en_camino", n.lang || WA_LANG, params);
      const wamid = (r.data as any)?.messages?.[0]?.id;
      if (r.ok && wamid) {
        await sb.from("customer_notification").update({ status: "sent", provider_message_id: wamid, sent_at: nowIso, updated_at: nowIso, error: null }).eq("id", n.id);
        results.push({ id: n.id, ok: true, wamid });
        // Copia sombra de las primeras N reales (no de las pruebas, no si el destino ya es el número de control).
        if (SHADOW_LIMIT > 0 && n.event === "pedido_en_camino" && String(n.to_phone) !== SHADOW_TO) {
          const { count } = await sb.from("customer_notification").select("id", { count: "exact", head: true }).eq("shadow_copied", true);
          if ((count ?? 0) < SHADOW_LIMIT) {
            const sr = await sendTemplate(SHADOW_TO, n.template ?? "pedido_en_camino", n.lang || WA_LANG, params);
            if (sr.ok) await sb.from("customer_notification").update({ shadow_copied: true }).eq("id", n.id);
          }
        }
      } else {
        const attempts = (n.attempts ?? 0) + 1;
        await sb.from("customer_notification").update({ status: attempts >= 3 ? "failed" : "pending", attempts, error: JSON.stringify((r.data as any)?.error ?? r.data), updated_at: nowIso }).eq("id", n.id);
        results.push({ id: n.id, ok: false, error: (r.data as any)?.error ?? r.data });
      }
    } catch (e) {
      const attempts = (n.attempts ?? 0) + 1;
      await sb.from("customer_notification").update({ status: attempts >= 3 ? "failed" : "pending", attempts, error: String(e), updated_at: nowIso }).eq("id", n.id);
      results.push({ id: n.id, ok: false, error: String(e) });
    }
  }
  return json({ processed: results.length, results });
});
