// whatsapp-webhook: lo que Meta manda del WhatsApp de Folvy. L1a · PR 3
// (28/10/2026).
//
//   GET  — la comprobación de Meta al dar de alta la URL: devuelve
//          hub.challenge si hub.verify_token es WHATSAPP_VERIFY_TOKEN.
//   POST — SIEMPRE se comprueba la firma de Meta (X-Hub-Signature-256, HMAC
//          con WHATSAPP_APP_SECRET sobre el cuerpo tal cual llega). Si no
//          viene, o no cuadra, o falta el secreto: se rechaza (401) y queda
//          apuntado en whatsapp_entrada, sin guardar el cuerpo. Solo con la
//          firma buena se lee:
//            · un botón del aviso de olvido → responder_aviso_olvido_whatsapp
//              (crea la petición para el encargado; nunca el fichaje) y se le
//              contesta con un texto (con «Otra hora», el enlace al portal);
//            · un estado (entregado, leído, fallido) → whatsapp_estado.
//
// verify_jwt = false (supabase/config.toml): quien llama es Meta, sin JWT. Su
// frontera es la firma.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { finTelefono, firmaDeMeta, leerCarga, leerWebhook, telefonoMeta, textoRespuesta } from "../_shared/avisoOlvido.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const APP_SECRET_PREV = Deno.env.get("WHATSAPP_APP_SECRET_PREV") ?? "";
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH_VER = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const APP_URL = Deno.env.get("VITE_APP_URL") ?? "https://app.folvy.app";
const SYNTHETIC_EMAIL_DOMAIN = "empleado.folvy.app";
const MAX_BYTES = 256 * 1024;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

function iguales(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// deno-lint-ignore no-explicit-any
async function apuntar(fila: Record<string, any>) {
  const { error } = await sb.from("whatsapp_entrada").insert(fila);
  if (error) console.error("whatsapp_entrada", error.message);
}

async function contestar(to: string, texto: string) {
  if (!WA_TOKEN || !WA_PHONE_ID || !to) return;
  await fetch(`https://graph.facebook.com/${GRAPH_VER}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto } }),
  }).catch((e) => console.error("contestar", String(e)));
}

async function enlacePortal(avisoId: string): Promise<string | null> {
  const { data: l } = await sb.from("clockout_reminder_log").select("employee_id").eq("id", avisoId).maybeSingle();
  if (!l?.employee_id) return null;
  const { data: e } = await sb.from("employees").select("username").eq("id", l.employee_id).maybeSingle();
  if (!e?.username) return `${APP_URL}/acceso`;
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: `${e.username}@${SYNTHETIC_EMAIL_DOMAIN}` });
  const h = data?.properties?.hashed_token;
  return error || !h ? `${APP_URL}/acceso` : `${APP_URL}/acceso?token_hash=${encodeURIComponent(h)}&type=magiclink`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && iguales(url.searchParams.get("hub.verify_token") ?? "", VERIFY_TOKEN);
    if (!ok) {
      await apuntar({ aceptado: false, motivo: VERIFY_TOKEN ? "verificacion_mala" : "sin_verify_token", tipo: "verificacion" });
      return new Response("forbidden", { status: 403 });
    }
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const bruto = new Uint8Array(await req.arrayBuffer());
  if (bruto.byteLength > MAX_BYTES) {
    await apuntar({ aceptado: false, motivo: "demasiado_grande", bytes: bruto.byteLength });
    return new Response("too large", { status: 413 });
  }
  const firma = await firmaDeMeta(bruto, req.headers.get("x-hub-signature-256"), APP_SECRET, APP_SECRET_PREV);
  if (firma !== "valida") {
    // No viene de Meta (o no se puede saber): fuera, y apuntado. Nada del cuerpo se guarda.
    await apuntar({ aceptado: false, motivo: firma, bytes: bruto.byteLength });
    return new Response("unauthorized", { status: 401 });
  }

  // deno-lint-ignore no-explicit-any
  let cuerpo: any;
  try {
    cuerpo = JSON.parse(new TextDecoder().decode(bruto));
  } catch {
    await apuntar({ aceptado: false, motivo: "json_malo", bytes: bruto.byteLength });
    return new Response("bad request", { status: 400 });
  }

  for (const e of leerWebhook(cuerpo)) {
    try {
      if (e.tipo === "estado") {
        const { data: hay } = await sb.rpc("whatsapp_estado", { p_wamid: e.wamid, p_estado: e.estado, p_at: e.at ?? new Date().toISOString(), p_error: e.error });
        await apuntar({ aceptado: true, tipo: "estado", wamid: e.wamid, resultado: hay ? e.estado : `${e.estado}_sin_aviso`, datos: { estado: e.estado, error: e.error }, bytes: bruto.byteLength });
        continue;
      }
      if (e.tipo === "boton") {
        const c = leerCarga(e.carga);
        if (!c) {
          await apuntar({ aceptado: true, tipo: "boton", wamid: e.wamid, telefono_fin: finTelefono(e.de), resultado: "boton_desconocido", datos: { texto: e.texto.slice(0, 60) } });
          continue;
        }
        const { data: r, error } = await sb.rpc("responder_aviso_olvido_whatsapp", {
          p_log_id: c.avisoId, p_respuesta: c.respuesta, p_telefono: e.de, p_contexto_wamid: e.contexto,
        });
        const resultado = error ? `error: ${error.message}` : String(r?.resultado ?? "");
        await apuntar({ aceptado: true, tipo: "boton", wamid: e.wamid, telefono_fin: finTelefono(e.de), aviso_id: c.avisoId, resultado, datos: { respuesta: c.respuesta } });
        if (!error && r?.texto && r.resultado !== "otro_telefono" && r.resultado !== "otro_mensaje") {
          const enlace = r.resultado === "pide_hora" ? await enlacePortal(c.avisoId) : null;
          await contestar(telefonoMeta(e.de), textoRespuesta(String(r.texto), enlace));
        }
        continue;
      }
      await apuntar({ aceptado: true, tipo: e.tipo, wamid: e.wamid, telefono_fin: finTelefono(e.de), resultado: "ignorado" });
    } catch (err) {
      await apuntar({ aceptado: true, tipo: e.tipo, wamid: "wamid" in e ? e.wamid : null, resultado: `error: ${String(err).slice(0, 200)}` });
    }
  }
  // A Meta siempre 200 con la firma buena: si no, lo reintenta durante días.
  return new Response("ok", { status: 200 });
});
