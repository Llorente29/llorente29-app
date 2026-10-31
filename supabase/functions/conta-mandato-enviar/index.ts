// supabase/functions/conta-mandato-enviar/index.ts
//
// PC01 · Entrega 4 · «Enviarle el mandato para firmar» SALE DESDE SUMIED (antes
// se abría en el correo de quien lo preparaba). Lo llama el diálogo del
// mandato de Ventas › Cobros, justo después de conta_mandato_preparar, con la
// sesión de quien pulsa.
//
//   · el mandato se lee con la clave de servicio (conta_mandato no se lee
//     desde fuera), pero solo si quien llama es administrador o encargado de
//     su cuenta; tiene que estar por firmar y sin caducar;
//   · el enlace lleva a la app de la marca desde la que se prepara
//     (app.sumied.com, app.folvy.app…) o, si no es ninguna, a app.sumied.com;
//   · sale de sumied.com con el nombre y la marca de la empresa, y las
//     respuestas van al correo de la empresa (_shared/cobroCorreos.ts);
//   · EL FRENO: «mandato_sepa» está cerrado hasta que Julio lo abra en
//     CORREO_MARCA_ABIERTOS. El primer envío real, solo a su correo de prueba
//     («mandato_sepa:<correo>») y con su sí. Cerrado, no se manda nada y lo
//     dice: el enlace se puede copiar y mandar a mano.
//   · Salido, lo apunta (conta_mandato_enviado, con la sesión de quien llama).
//
// Contesta siempre 200 con { enviado, texto } en palabras (regla 8), salvo
// sesión (401), permiso (403) o datos que faltan (400).
//
// verify_jwt = true (config.toml): sin sesión no hay nada que hacer.

import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { MARCAS } from "../_shared/marcas.ts";
import { cerrojoMarca } from "../send-email/marca.ts";
import { correoValido, remitenteFactura } from "../_shared/facturaVentaCorreo.ts";
import { PLANTILLA_MANDATO, correoMandato, origenFirma } from "../_shared/cobroCorreos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOMINIOS = Object.values(MARCAS).flatMap((m) => m.dominios);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let id = "", para: string | null = null, origen: unknown = null;
  try {
    const b = await req.json() as { mandato?: unknown; para?: unknown; origen?: unknown };
    id = typeof b.mandato === "string" ? b.mandato : "";
    para = correoValido(b.para);
    origen = b.origen;
  } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "falta el mandato" }, 400);
  if (!para) return json({ enviado: false, texto: "No se ha mandado: ese correo no vale." }, 400);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data: m } = await srv.from("conta_mandato")
    .select("id, account_id, company_id, party_id, ref, token, status, expires_at").eq("id", id).maybeSingle();
  if (!m) return json({ enviado: false, texto: "No se ha mandado: ese mandato no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: m.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta manda mandatos." }, 403);
  if (m.status !== "por_firmar") return json({ enviado: false, texto: `No se ha mandado el mandato ${m.ref}: ya está ${m.status === "firmado" ? "firmado" : "anulado"}.` });
  if (Date.parse(m.expires_at) < Date.now()) return json({ enviado: false, texto: `No se ha mandado el mandato ${m.ref}: su enlace ha caducado. Prepara otro.` });

  // DM1 · PR 2a · La puerta: una cuenta de demo no manda correos. Queda como enviado, y lo dice.
  if (!(await cuentaPuedeSalir(srv, m.account_id))) {
    await sb.rpc("conta_mandato_enviado", { p_mandato: id, p_correo: para });
    return json({ enviado: true, demo: true, texto: `Enviado el mandato ${m.ref} a ${para}. ${EN_LA_DEMO}` });
  }

  // El freno, antes de tocar nada más.
  const cerrojo = cerrojoMarca(MARCAS.sumied, PLANTILLA_MANDATO, para, Deno.env.get("CORREO_MARCA_ABIERTOS"));
  if (!cerrojo.abierto) {
    return json({ enviado: false, texto: `No se ha mandado el mandato ${m.ref} a ${para}: los correos de mandatos aún están cerrados (los abre Julio). Copia el enlace y mándaselo tú.` });
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ enviado: false, texto: "No se ha mandado: el servicio de correo no está configurado. Copia el enlace y mándaselo tú." });

  const [{ data: emp }, { data: cli }] = await Promise.all([
    srv.from("company").select("legal_name, trade_name, email, color, logo_path").eq("id", m.company_id).maybeSingle(),
    srv.from("party").select("name").eq("id", m.party_id).maybeSingle(),
  ]);
  const empresa = String(emp?.trade_name || emp?.legal_name || "");
  let logo: string | null = null;
  if (emp?.logo_path) {
    const { data: f } = await srv.storage.from("company-logos").createSignedUrl(emp.logo_path, 60 * 60 * 24 * 90);
    logo = f?.signedUrl ?? null;
  }
  const enlace = `${origenFirma(origen, DOMINIOS)}/mandato.html?t=${m.token}`;
  const c = correoMandato({ empresa, color: emp?.color ?? null, logo, cliente: String(cli?.name ?? "cliente"), ref: m.ref, enlace, caduca: String(m.expires_at).slice(0, 10) });
  const responder = correoValido(emp?.email);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: remitenteFactura(empresa), to: [para], subject: c.asunto, html: c.html, text: c.texto, ...(responder ? { reply_to: responder } : {}) }),
  });
  const cuerpo = await res.json().catch(() => ({})) as { message?: string };
  if (!res.ok) {
    console.error(`conta-mandato-enviar · ${id} · Resend ${res.status}`);
    return json({ enviado: false, texto: `No se ha mandado el mandato ${m.ref} a ${para}: el proveedor de correo lo ha rechazado (${cuerpo.message ?? `HTTP ${res.status}`}). Copia el enlace y mándaselo tú.` });
  }
  await sb.rpc("conta_mandato_enviado", { p_mandato: id, p_correo: para });
  return json({ enviado: true, texto: `Enviado el mandato ${m.ref} a ${para}. Cuando lo firme, su ficha queda domiciliada con su IBAN.` });
});
