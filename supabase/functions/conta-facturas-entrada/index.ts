// supabase/functions/conta-facturas-entrada/index.ts
//
// D01 · Tarea 4 · EL CORREO DE FACTURAS DE CADA EMPRESA: el webhook de Resend
// (evento email.received) para facturas-<empresa>@entrada.folvy.app.
//
// Lo que decide está en _shared/facturasEntrada.ts (probado en
// tests/conta/d01/facturasEntrada.test.ts); la base, en la 0220 (probada en
// staging como lo llama esta función). Aquí solo se pone el mundo:
//   · la firma de svix con RESEND_FACTURAS_WEBHOOK_SECRET (el secreto de ESTE
//     webhook; las nóminas tienen el suyo y no se tocan);
//   · los adjuntos, por la API de Resend (RESEND_API_KEY);
//   · el fichero, al bucket receipt-uploads de la cuenta;
//   · la lectura, con ocr-albaran en modo «factura» (llamada interna);
//   · la base, con la clave de servicio (las funciones de la 0220 son solo suyas).
//
// D01 · Liquidaciones (T2, 15/10): la misma función recibe lo que llega a
// liquidaciones-<empresa>@entrada.folvy.app. La base dice la clase de cada
// dirección y _shared/facturasEntrada.ts enruta: un resumen de pagos de Uber
// Eats va a conta_liquidacion_registrar (la 0100 de las liquidaciones). El
// cuerpo del correo se pide a Resend (el webhook no lo trae).
//
// D01 · Facturas de los proveedores (16/10): la confirmación del reenvío se
// apunta también con su enlace (pide el cuerpo), y un remitente que la base
// sabe que no manda facturas (conta_entrada_remitente) no se lee como factura.
//
// V02 · LA PUERTA (25/10): también recibe lo que llega a la dirección única de
// cada empresa (<empresa>@entrada.folvy.app; entrada.sumied.com cuando se dé
// de alta). _shared/facturasEntrada.ts lo lleva a su sitio; aquí, el mundo de
// tres cosas más: el almacén conta-entrada para lo que no es PDF ni foto, el
// «qué es» de cada llegada (conta_entrada_tipo, de la base) y las nóminas, por
// el mismo camino que payroll-inbound (employee-documents y payroll-extract en
// modo interno).
//
// Mientras Julio no dé de alta el dominio entrada.folvy.app en Resend, aquí no
// llega nada; y aunque llegara, las direcciones nacen apagadas.
//
// verify_jwt = false (config.toml): es un webhook externo; la seguridad la da
// la firma de svix, como en payroll-inbound.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { corsHeaders } from "../_shared/cors.ts";
import { comprobarFirma, recibirCorreo, releerCorreos, resumenReleidos, type AdjuntoResend, type ClaseDireccion, type CorreoResend, type PuertoEntrada, type QueEs, type Sobre } from "../_shared/facturasEntrada.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const SECRETO = Deno.env.get("RESEND_FACTURAS_WEBHOOK_SECRET") ?? "";
const BUCKET = "receipt-uploads";
const BUCKET_NOMINAS = "employee-documents"; // el de payroll-inbound

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// El puerto de la entrada: la base, Resend y el almacén (lo usan el aviso de Resend y «Volver a leer»).
// deno-lint-ignore no-explicit-any
function puertoDe(sb: any): PuertoEntrada {
  const rpc = async <T>(f: string, a: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(f, a);
    if (error) throw new Error(`${f}: ${error.message}`);
    return data as T;
  };
  return {
    destino: async (lp, dom) => {
      const d = await rpc<{ company_id: string; account_id: string; activa: boolean; tipo?: ClaseDireccion } | null>("conta_entrada_destino", { p_local_part: lp, p_domain: dom });
      return d ? { companyId: d.company_id, accountId: d.account_id, activa: d.activa, tipo: d.tipo ?? "facturas" } : null;
    },
    yaVisto: async (id) => {
      const { data } = await sb.from("inbound_email_log").select("id").eq("email_id", id).maybeSingle();
      return !!data;
    },
    registrarCorreo: async (r) => {
      // Si se enrutó por el sobre (el To: era otro), queda dicho en el detalle.
      const detalle = r.porSobre ? { ...(r.detalle as Record<string, unknown> ?? {}), por_sobre: true } : r.detalle;
      await rpc("conta_entrada_correo", { p: { email_id: r.emailId, to: r.to, from: r.from, subject: r.subject, company_id: r.companyId, resultado: r.resultado, detalle } });
    },
    adjuntos: async (id) => {
      const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}/attachments`, { headers: { Authorization: `Bearer ${RESEND}` } });
      if (!r.ok) throw new Error(`Resend no da los adjuntos (${r.status})`);
      const j = await r.json() as { data?: AdjuntoResend[] };
      return j.data ?? [];
    },
    bajar: async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`no se ha podido bajar el adjunto (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    },
    subir: async (ruta, bytes, tipo) => {
      const { error } = await sb.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo, upsert: false });
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`no se ha podido guardar el adjunto: ${error.message}`);
    },
    sha256: async (b) => hex(await crypto.subtle.digest("SHA-256", b)),
    llegada: async (x) => {
      const r = await rpc<{ id: string; ya_estaba: boolean }>("conta_entrada_llegada", {
        p: { account_id: x.accountId, company_id: x.companyId, canal: "correo", email_id: x.emailId, to: x.to, from: x.from, subject: x.subject, recibido: x.recibido,
             ruta: x.ruta, nombre: x.nombre, tipo: x.tipo, bytes: x.bytes, sha256: x.sha256, enlace: x.enlace },
      });
      return { id: r.id, yaEstaba: r.ya_estaba };
    },
    // El correo entero: sus destinatarios y, si Resend las da, sus cabeceras y su sobre.
    correoEntero: async (id) => {
      const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${RESEND}` } });
      if (!r.ok) return null;
      return await r.json() as Sobre & Pick<CorreoResend, "to" | "cc" | "bcc">;
    },
    cuerpo: async (id) => {
      const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${RESEND}` } });
      if (!r.ok) throw new Error(`Resend no da el cuerpo del correo (${r.status})`);
      const j = await r.json() as { html?: string | null; text?: string | null };
      return { html: j.html ?? null, text: j.text ?? null };
    },
    liquidacion: async ({ companyId, datos }) => {
      const r = await rpc<{ liquidacion_id: string; ya_estaba: boolean; texto: string; factura?: { estado?: string } | null }>("conta_liquidacion_registrar", { p_company: companyId, p: datos, p_quien_nombre: null });
      return { id: r.liquidacion_id, yaEstaba: r.ya_estaba, texto: r.texto, factura: r.factura?.estado ?? null };
    },
    // Lo que la base sabe del remitente (la 0100 del 19): la dirección se compara por su huella.
    // Mientras esa tanda no esté aplicada, la función no existe (PGRST202): no se sabe nada de nadie.
    remitente: async (companyId, from) => {
      const { data, error } = await sb.rpc("conta_entrada_remitente", { p_company: companyId, p_from: from });
      if (error && error.code === "PGRST202") return null;
      if (error) throw new Error(`conta_entrada_remitente: ${error.message}`);
      return (data as { decision: "no_facturas" | "tipo"; motivo: string; tipo?: QueEs | null } | null) ?? null;
    },
    subirA: async (bucket, ruta, bytes, tipo) => {
      const { error } = await sb.storage.from(bucket).upload(ruta, bytes, { contentType: tipo, upsert: false });
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`no se ha podido guardar el adjunto: ${error.message}`);
    },
    colocar: async (inboxId, x) => {
      if (x.bucket) {
        const { error } = await sb.from("document_inbox").update({ file_bucket: x.bucket, updated_at: new Date().toISOString() }).eq("id", inboxId);
        if (error) throw new Error(`document_inbox: ${error.message}`);
      }
      if (x.tipo) await rpc("conta_entrada_tipo", { p_inbox: inboxId, p_tipo: x.tipo, p_por: x.por });
    },
    nomina: async ({ accountId, emailId, nombre, bytes }) => {
      const ruta = `_inbox/${accountId}/${emailId.replace(/[^A-Za-z0-9-]/g, "")}-${nombre.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await sb.storage.from(BUCKET_NOMINAS).upload(ruta, bytes, { contentType: "application/pdf", upsert: true });
      if (error) return { ok: false, texto: `${nombre}: no se ha podido guardar en Laboral (${error.message}).` };
      const r = await fetch(`${SUPABASE_URL}/functions/v1/payroll-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICIO}`, "x-internal-key": SERVICIO },
        body: JSON.stringify({ account_id: accountId, file_paths: [ruta], source: "gmail", email_id: emailId }),
      });
      return r.ok ? { ok: true, texto: `${nombre}: es una nómina, va a Laboral.` } : { ok: false, texto: `${nombre}: es una nómina, pero Laboral no la ha podido leer (${r.status}).` };
    },
    // S01j · La primera hoja de un Excel (el de Glovo), como objetos por su cabecera.
    hoja: async (bytes) => {
      const libro = XLSX.read(bytes, { type: "array", cellDates: true });
      const h = libro.Sheets[libro.SheetNames[0]];
      return h ? XLSX.utils.sheet_to_json(h, { defval: null }) as Record<string, unknown>[] : [];
    },
    // S01j · La factura de comisión escrita en el correo (Just Eat), como recibida.
    facturaComision: async ({ settlementId, datos, emailId }) => {
      const r = await rpc<{ factura_id: string | null; estado: string; texto: string }>("conta_comision_del_correo", { p_settlement: settlementId, p: { ...datos, email_id: emailId } });
      return { id: r.factura_id, estado: r.estado, texto: r.texto };
    },
    leer: async (inboxId) => {
      const { data: l } = await sb.from("document_inbox").select("account_id, file_path").eq("id", inboxId).single();
      const r = await fetch(`${SUPABASE_URL}/functions/v1/ocr-albaran`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICIO}`, "x-internal-key": SERVICIO },
        body: JSON.stringify({ account_id: l!.account_id, file_paths: [l!.file_path], modo: "factura" }),
      });
      const j = await r.json().catch(() => ({})) as { session_id?: string; error?: string };
      if (!r.ok || !j.session_id) {
        await sb.from("document_inbox").update({ status: "error", reason: `No se ha podido leer: ${j.error ?? r.status}`, updated_at: new Date().toISOString() }).eq("id", inboxId);
        return { estado: "error", texto: `No se ha podido leer (${j.error ?? r.status}).` };
      }
      const f = await rpc<{ estado: string; texto: string }>("conta_factura_desde_lectura", { p_inbox: inboxId, p_session: j.session_id });
      return { estado: f.estado, texto: f.texto };
    },
  };
}

// S01j · «Volver a leer» desde Correo de facturas (POST ?releer=1): con la sesión de la
// persona (no del aviso de Resend). La base dice qué correos de la empresa puede volver a leer
// (conta_correo_releer_lista: administración o encargado; los de un remitente, como
// mucho 60). Cada uno se pide otra vez a Resend y pasa por el camino de siempre.
async function releer(req: Request): Promise<Response> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "Falta la sesión." });
  let b: { company_id?: string; email_ids?: string[]; remitente?: string };
  try { b = await req.json(); } catch { return json(400, { error: "cuerpo no es JSON" }); }
  const comoPersona = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: ids, error } = await comoPersona.rpc("conta_correo_releer_lista", { p_company: b.company_id ?? null, p_email_ids: b.email_ids ?? null, p_remitente: b.remitente ?? null });
  if (error) return json(error.code === "42501" ? 403 : 400, { error: error.message });
  const puerto = puertoDe(createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } }));
  const rs = await releerCorreos((ids as string[] | null) ?? [], puerto, async (id) => {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${RESEND}` } });
    if (r.status === 404 || r.status === 410) return null;
    if (!r.ok) throw new Error(`Resend contesta ${r.status}`);
    return { ...(await r.json() as CorreoResend & Sobre), email_id: id };
  });
  return json(200, { texto: resumenReleidos(rs), correos: rs });
}

Deno.serve(async (req) => {
  // S01j · «Volver a leer» llega de la pantalla (?releer=1), con su CORS; el aviso de Resend, sin él.
  const esReleer = new URL(req.url).searchParams.get("releer") === "1";
  if (esReleer && req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "usa POST" });
  if (!SECRETO || !RESEND || !SERVICIO) return json(500, { error: "falta configurar el secreto del webhook, la clave de Resend o la de servicio" });
  if (esReleer) {
    const r = await releer(req);
    return new Response(r.body, { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const cuerpo = await req.text();
  const mal = await comprobarFirma(SECRETO, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), firma: req.headers.get("svix-signature") }, cuerpo, Math.floor(Date.now() / 1000));
  if (mal) return json(401, { error: mal });

  let ev: { type?: string; data?: CorreoResend & Sobre };
  try { ev = JSON.parse(cuerpo); } catch { return json(400, { error: "cuerpo no es JSON" }); }
  if (ev.type !== "email.received" || !ev.data?.email_id) return json(200, { ignorado: ev.type ?? "sin tipo" });

  const puerto = puertoDe(createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } }));

  try {
    const r = await recibirCorreo(ev.data, puerto);
    return json(200, r);
  } catch (x) {
    const motivo = x instanceof Error ? x.message : String(x);
    // Que quede apuntado; Resend reintenta si contestamos 5xx.
    await puerto.registrarCorreo({ emailId: ev.data.email_id, to: (ev.data.to ?? [""])[0], from: ev.data.from ?? null, subject: ev.data.subject ?? null, companyId: null, resultado: "error", detalle: { motivo } }).catch(() => null);
    return json(500, { error: motivo });
  }
});
