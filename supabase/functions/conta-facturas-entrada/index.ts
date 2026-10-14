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
// Mientras Julio no dé de alta el dominio entrada.folvy.app en Resend, aquí no
// llega nada; y aunque llegara, las direcciones nacen apagadas.
//
// verify_jwt = false (config.toml): es un webhook externo; la seguridad la da
// la firma de svix, como en payroll-inbound.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { comprobarFirma, recibirCorreo, type AdjuntoResend, type CorreoResend, type PuertoEntrada } from "../_shared/facturasEntrada.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const SECRETO = Deno.env.get("RESEND_FACTURAS_WEBHOOK_SECRET") ?? "";
const BUCKET = "receipt-uploads";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "usa POST" });
  if (!SECRETO || !RESEND || !SERVICIO) return json(500, { error: "falta configurar el secreto del webhook, la clave de Resend o la de servicio" });

  const cuerpo = await req.text();
  const mal = await comprobarFirma(SECRETO, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), firma: req.headers.get("svix-signature") }, cuerpo, Math.floor(Date.now() / 1000));
  if (mal) return json(401, { error: mal });

  let ev: { type?: string; data?: CorreoResend };
  try { ev = JSON.parse(cuerpo); } catch { return json(400, { error: "cuerpo no es JSON" }); }
  if (ev.type !== "email.received" || !ev.data?.email_id) return json(200, { ignorado: ev.type ?? "sin tipo" });

  const sb = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const rpc = async <T>(f: string, a: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(f, a);
    if (error) throw new Error(`${f}: ${error.message}`);
    return data as T;
  };
  const puerto: PuertoEntrada = {
    destino: async (lp, dom) => {
      const d = await rpc<{ company_id: string; account_id: string; activa: boolean } | null>("conta_entrada_destino", { p_local_part: lp, p_domain: dom });
      return d ? { companyId: d.company_id, accountId: d.account_id, activa: d.activa } : null;
    },
    yaVisto: async (id) => {
      const { data } = await sb.from("inbound_email_log").select("id").eq("email_id", id).maybeSingle();
      return !!data;
    },
    registrarCorreo: async (r) => {
      await rpc("conta_entrada_correo", { p: { email_id: r.emailId, to: r.to, from: r.from, subject: r.subject, company_id: r.companyId, resultado: r.resultado, detalle: r.detalle } });
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
