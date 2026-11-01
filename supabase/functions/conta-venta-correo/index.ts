// supabase/functions/conta-venta-correo/index.ts
//
// V01 · Entrega 1 · «Enviar por correo» una factura de venta ya emitida, con
// su PDF adjunto. Lo llama la ficha (al emitir, si se ha marcado, y con
// «Enviar de nuevo»), con la sesión de quien pulsa.
//
//   · la factura y la empresa se leen CON EL JWT DE QUIEN LLAMA (si no es de su
//     cuenta, no está), y tiene que ser administrador o encargado;
//   · el PDF se baja del almacén y el envío se apunta con la clave de servicio;
//   · sale de sumied.com con el nombre de la empresa, y las respuestas van al
//     correo de la empresa si lo tiene (_shared/facturaVentaCorreo.ts);
//   · EL FRENO: «factura_venta» está cerrado hasta que Julio lo abra en
//     CORREO_MARCA_ABIERTOS. El primer envío real, solo a su correo de prueba
//     («factura_venta:<correo>») y con su sí. Cerrado, no se manda nada y el
//     historial de la factura lo dice.
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
import { PLANTILLA_FACTURA_VENTA, correoFactura, correoValido, remitenteFactura } from "../_shared/facturaVentaCorreo.ts";
import { nombreFacturaPdf } from "../_shared/facturaVentaPdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "conta-documentos";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let id = "", para: string | null = null, quien: string | null = null;
  try {
    const b = await req.json() as { factura?: unknown; para?: unknown; quien?: unknown };
    id = typeof b.factura === "string" ? b.factura : "";
    para = correoValido(b.para);
    quien = typeof b.quien === "string" ? b.quien.slice(0, 120) : null;
  } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "falta la factura" }, 400);
  if (!para) return json({ enviado: false, texto: "No se ha mandado: ese correo no vale." }, 400);

  const { data: f, error: e0 } = await sb.from("customer_invoice")
    .select("id, account_id, company_id, status, doc_type, number_text, issue_date, due_date, total, customer, pdf_path")
    .eq("id", id).maybeSingle();
  if (e0) return json({ enviado: false, texto: `No se ha mandado: ${e0.message}` }, 400);
  if (!f) return json({ enviado: false, texto: "No se ha mandado: esa factura no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: f.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta manda facturas." }, 403);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const apuntar = (enviado: boolean, texto: string, detalle: Record<string, unknown>) =>
    srv.rpc("conta_venta_enviada", { p_id: id, p_para: enviado ? para : null, p_texto: texto, p_detalle: detalle, p_quien_nombre: quien });

  if (f.status === "borrador") return json({ enviado: false, texto: "No se ha mandado: un borrador no se manda; emítela antes." });
  if (!f.pdf_path) {
    const texto = `No se ha mandado la ${f.number_text}: aún no tiene su PDF.`;
    await apuntar(false, texto, { para, motivo: "sin_pdf" });
    return json({ enviado: false, texto });
  }

  // DM1 · PR 2a · La puerta: una cuenta de demo no manda correos. Queda como enviada, y lo dice.
  if (!(await cuentaPuedeSalir(srv, f.account_id))) {
    const texto = `Enviada la ${f.number_text} a ${para}. ${EN_LA_DEMO}`;
    await apuntar(true, texto, { para, demo: true });
    return json({ enviado: true, demo: true, texto });
  }

  // El freno, antes de tocar nada más.
  const cerrojo = cerrojoMarca(MARCAS.sumied, PLANTILLA_FACTURA_VENTA, para, Deno.env.get("CORREO_MARCA_ABIERTOS"));
  if (!cerrojo.abierto) {
    const texto = `No se ha mandado la ${f.number_text} a ${para}: los correos de facturas aún están cerrados (los abre Julio).`;
    await apuntar(false, texto, { para, motivo: "cerrado" });
    return json({ enviado: false, texto });
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ enviado: false, texto: "No se ha mandado: el servicio de correo no está configurado." }, 500);

  const { data: emp } = await sb.from("company").select("legal_name, trade_name, email").eq("id", f.company_id).maybeSingle();
  const empresa = String(emp?.trade_name || emp?.legal_name || "");
  const { data: pdf, error: e1 } = await srv.storage.from(BUCKET).download(f.pdf_path);
  if (e1 || !pdf) {
    const texto = `No se ha mandado la ${f.number_text}: no se ha podido leer su PDF.`;
    await apuntar(false, texto, { para, motivo: "pdf" });
    return json({ enviado: false, texto });
  }

  const cliente = String((f.customer as Record<string, unknown> | null)?.nombre ?? "");
  const c = correoFactura({
    empresa, numero: f.number_text, rectificativa: f.doc_type === "rectificativa", fecha: f.issue_date,
    total: Number(f.total), vence: f.due_date, cliente: cliente || "cliente",
  });
  const responder = correoValido(emp?.email);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: remitenteFactura(empresa), to: [para], subject: c.asunto, html: c.html, text: c.texto,
      ...(responder ? { reply_to: responder } : {}),
      attachments: [{ filename: nombreFacturaPdf(f.number_text), content: base64(new Uint8Array(await pdf.arrayBuffer())) }],
    }),
  });
  const cuerpo = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) {
    const texto = `No se ha mandado la ${f.number_text} a ${para}: el proveedor de correo lo ha rechazado (${cuerpo.message ?? `HTTP ${res.status}`}).`;
    await apuntar(false, texto, { para, motivo: "proveedor", estado: res.status });
    console.error(`conta-venta-correo · ${id} · Resend ${res.status}`);
    return json({ enviado: false, texto });
  }
  const texto = `Enviada la ${f.number_text} a ${para}, con su PDF.`;
  await apuntar(true, texto, { para, correo_id: cuerpo.id ?? null });
  return json({ enviado: true, texto });
});
