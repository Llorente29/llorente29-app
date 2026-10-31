// supabase/functions/conta-recordatorios/index.ts
//
// PC01 · Entrega 4 · LOS RECORDATORIOS DE COBRO, que se mandan solos.
//
// Dos maneras de llamarla:
//   · EL CRON (cabecera x-cron-secret = CRON_SECRET, sin sesión): lo despierta
//     conta_recordatorios_despertar a las 9 de Madrid si hay algo. Pide lo que
//     toca (conta_recordatorios_por_mandar) y, uno a uno, lo manda y lo apunta
//     (conta_recordatorio_apuntar), también lo que NO sale y por qué: el
//     cliente sin correo, el freno cerrado, el proveedor. Cada paso se intenta
//     una vez; lo dice el historial de la factura.
//   · UNA PRUEBA (con la sesión de un administrador o encargado): { factura,
//     para } manda el recordatorio de esa factura a ese correo, con «[Prueba]»
//     en el asunto, y no lo apunta como recordatorio. Es el primer envío real:
//     a un correo de prueba de Julio, con su sí.
//
// Sale de sumied.com con el nombre y la marca de la empresa, las respuestas van
// a su correo y lleva el PDF de la factura si lo tiene (_shared/cobroCorreos.ts).
// Si la empresa cobra con tarjeta (y Bizum), lleva el enlace de pago
// (conta_enlace_pago_para): pagar.html, y de ahí a la página de pago de Stripe.
// EL FRENO: «recordatorio_cobro» está cerrado hasta que Julio lo abra en
// CORREO_MARCA_ABIERTOS; cerrado, no se manda nada.
//
// verify_jwt = false (config.toml): el cron llama sin sesión; la prueba se
// comprueba aquí (getUser y el permiso en conta_recordatorio_prueba_datos).

import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { MARCAS } from "../_shared/marcas.ts";
import { cerrojoMarca } from "../send-email/marca.ts";
import { correoValido, remitenteFactura } from "../_shared/facturaVentaCorreo.ts";
import { nombreFacturaPdf } from "../_shared/facturaVentaPdf.ts";
import { PLANTILLA_RECORDATORIO, correoRecordatorio } from "../_shared/cobroCorreos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "conta-documentos";
/** Desde dónde se paga (la página pagar.html de la app de Sumied). */
const ENLACES = "https://app.sumied.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Datos {
  factura: string; cuenta: string; empresa_id: string; empresa: string; empresa_correo: string | null;
  numero: string; fecha: string; vence: string; total: number; pendiente: number; cliente: string;
  para: string | null; pdf: string | null; hoy: string; dia?: number; toca?: string; sin?: string | null;
}

type Envio = { ok: true; id: string | null } | { ok: false; motivo: "proveedor" | "configuracion"; texto: string };

/** La marca de cada empresa (color y logo firmado), una vez por empresa. */
function marcas(srv: SupabaseClient) {
  const hechas = new Map<string, Promise<{ color: string | null; logo: string | null }>>();
  return (empresa: string) => {
    if (!hechas.has(empresa)) {
      hechas.set(empresa, (async () => {
        const { data } = await srv.from("company").select("color, logo_path").eq("id", empresa).maybeSingle();
        let logo: string | null = null;
        if (data?.logo_path) {
          const { data: f } = await srv.storage.from("company-logos").createSignedUrl(data.logo_path, 60 * 60 * 24 * 90);
          logo = f?.signedUrl ?? null;
        }
        return { color: data?.color ?? null, logo };
      })());
    }
    return hechas.get(empresa)!;
  };
}

async function mandar(srv: SupabaseClient, marca: { color: string | null; logo: string | null }, d: Datos, para: string, prueba: boolean): Promise<Envio> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return { ok: false, motivo: "configuracion", texto: "el servicio de correo no está configurado" };
  const adjuntos: { filename: string; content: string }[] = [];
  if (d.pdf) {
    const { data: pdf } = await srv.storage.from(BUCKET).download(d.pdf);
    if (pdf) adjuntos.push({ filename: nombreFacturaPdf(d.numero), content: base64(new Uint8Array(await pdf.arrayBuffer())) });
  }
  // El enlace de pago (tarjeta y, si está activo, Bizum), si la empresa cobra así.
  let enlacePago: string | null = null, conBizum = false;
  const { data: token } = await srv.rpc("conta_enlace_pago_para", { p_invoice: d.factura });
  if (typeof token === "string" && /^[0-9a-f]{64}$/.test(token)) {
    enlacePago = `${ENLACES}/pagar.html?t=${token}`;
    const { data: pago } = await srv.rpc("conta_enlace_pago_datos", { p_token: token });
    conBizum = (pago as { bizum?: string } | null)?.bizum === "activo";
  }
  const c = correoRecordatorio({
    empresa: d.empresa, color: marca.color, logo: marca.logo, cliente: d.cliente || "cliente", numero: d.numero, fecha: d.fecha,
    vence: d.vence, hoy: d.hoy, total: Number(d.total), pendiente: Number(d.pendiente), enlacePago, conBizum, conPdf: adjuntos.length > 0,
  });
  const responder = correoValido(d.empresa_correo);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: remitenteFactura(d.empresa), to: [para], subject: prueba ? `[Prueba] ${c.asunto}` : c.asunto, html: c.html, text: c.texto,
      ...(responder ? { reply_to: responder } : {}), ...(adjuntos.length ? { attachments: adjuntos } : {}),
    }),
  });
  const cuerpo = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) {
    console.error(`conta-recordatorios · ${d.factura} · Resend ${res.status}`);
    return { ok: false, motivo: "proveedor", texto: `el proveedor de correo lo ha rechazado (${cuerpo.message ?? `HTTP ${res.status}`})` };
  }
  return { ok: true, id: cuerpo.id ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const marcaDe = marcas(srv);
  const abiertos = Deno.env.get("CORREO_MARCA_ABIERTOS");
  // DM1 · PR 2a · La puerta: la empresa de una cuenta de demo no manda recordatorios de verdad.
  const enLaDemo = async (empresaId: string): Promise<boolean> => {
    const { data } = await srv.from("company").select("account_id").eq("id", empresaId).maybeSingle();
    return !(await cuentaPuedeSalir(srv, (data as { account_id?: string } | null)?.account_id ?? null));
  };

  // ── El cron ────────────────────────────────────────────────────────────
  const secreto = Deno.env.get("CRON_SECRET") ?? "";
  const dado = req.headers.get("x-cron-secret") ?? "";
  if (dado) {
    if (!secreto || dado !== secreto) return json({ error: "secreto" }, 401);
    const { data: filas, error } = await srv.rpc("conta_recordatorios_por_mandar", { p_hoy: null, p_limite: 200 });
    if (error) return json({ error: error.message }, 500);
    const cuenta = { mandados: 0, sin_correo: 0, cerrados: 0, fallidos: 0, ya: 0 };
    for (const d of (filas ?? []) as Datos[]) {
      let enviado = false, motivo: string | null = null, texto: string, correoId: string | null = null;
      if (d.sin === "sin_correo" || !d.para) {
        motivo = "sin_correo";
        texto = `No se ha mandado el recordatorio de la ${d.numero}: el cliente no tiene correo. Ponlo en la factura y saldrá el siguiente.`;
      } else if (!cerrojoMarca(MARCAS.sumied, PLANTILLA_RECORDATORIO, d.para, abiertos).abierto) {
        motivo = "cerrado";
        texto = `No se ha mandado el recordatorio de la ${d.numero} a ${d.para}: los recordatorios aún están cerrados (los abre Julio).`;
      } else if (await enLaDemo(d.empresa_id)) {
        enviado = true;
        texto = `Recordatorio mandado a ${d.para}. ${EN_LA_DEMO}`;
      } else {
        const r = await mandar(srv, await marcaDe(d.empresa_id), d, d.para, false);
        if (r.ok) { enviado = true; correoId = r.id; texto = `Recordatorio mandado a ${d.para}.`; }
        else { motivo = r.motivo; texto = `No se ha mandado el recordatorio de la ${d.numero} a ${d.para}: ${r.texto}.`; }
      }
      const { data: nuevo } = await srv.rpc("conta_recordatorio_apuntar", {
        p_invoice: d.factura, p_dia: d.dia, p_toca: d.toca, p_enviado: enviado, p_para: d.para, p_motivo: motivo, p_texto: texto, p_correo_id: correoId,
      });
      if (nuevo !== true) cuenta.ya++;
      else if (enviado) cuenta.mandados++;
      else if (motivo === "sin_correo") cuenta.sin_correo++;
      else if (motivo === "cerrado") cuenta.cerrados++;
      else cuenta.fallidos++;
    }
    console.log(JSON.stringify({ funcion: "conta-recordatorios", ...cuenta }));
    return json({ ok: true, ...cuenta });
  }

  // ── Una prueba, con la sesión de quien pulsa ───────────────────────────
  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);
  let factura = "", para: string | null = null;
  try {
    const b = await req.json() as { factura?: unknown; para?: unknown };
    factura = typeof b.factura === "string" ? b.factura : "";
    para = correoValido(b.para);
  } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(factura)) return json({ error: "falta la factura" }, 400);
  if (!para) return json({ enviado: false, texto: "No se ha mandado la prueba: ese correo no vale." }, 400);
  const { data: d, error: e } = await sb.rpc("conta_recordatorio_prueba_datos", { p_invoice: factura });
  if (e) return json({ enviado: false, texto: `No se ha mandado la prueba: ${e.message}` }, e.code === "42501" ? 403 : 400);
  const datos = d as Datos;
  if (await enLaDemo(datos.empresa_id)) {
    return json({ enviado: true, demo: true, texto: `Prueba mandada a ${para}: el recordatorio de la ${datos.numero}. ${EN_LA_DEMO}` });
  }
  if (!cerrojoMarca(MARCAS.sumied, PLANTILLA_RECORDATORIO, para, abiertos).abierto) {
    return json({ enviado: false, texto: `No se ha mandado la prueba a ${para}: los recordatorios aún están cerrados para ese correo (los abre Julio).` });
  }
  const r = await mandar(srv, await marcaDe(datos.empresa_id), datos, para, true);
  if (!r.ok) return json({ enviado: false, texto: `No se ha mandado la prueba a ${para}: ${r.texto}.` });
  return json({ enviado: true, texto: `Prueba mandada a ${para}: el recordatorio de la ${datos.numero}, tal como lo recibiría el cliente.` });
});
