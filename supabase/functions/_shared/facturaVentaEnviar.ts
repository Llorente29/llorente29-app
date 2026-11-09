// supabase/functions/_shared/facturaVentaEnviar.ts
//
// Mandar por correo una factura de venta ya emitida, con su PDF adjunto. Lo
// usan conta-venta-correo («Enviar por correo», con la sesión de quien pulsa)
// y el envío solo al emitir una factura de un recibo (G05 · T4,
// cobro/facturaRecibo.ts). Quién puede ya lo ha mirado quien llama: aquí se
// usa la clave de servicio.
//
//   · LA PUERTA DE LAS DEMOS (DM1; G05 · T3, nº 23): el correo de una cuenta de
//     demostración va SOLO al buzón de pruebas fijo (CORREO_BUZON_PRUEBAS),
//     nunca al cliente. Sin buzón puesto, no sale, y se dice.
//   · EL FRENO: «factura_venta» está cerrado hasta que Julio lo abra en
//     CORREO_MARCA_ABIERTOS. Cerrado, no se manda nada y el historial lo dice.
//   · Sale de sumied.com con el nombre de la empresa; las respuestas, al correo
//     de la empresa si lo tiene. Todo lo que pasa queda en el historial de la
//     factura (conta_venta_enviada), también lo que no se manda.
//
// Nunca lanza: devuelve { enviado, texto } en palabras (regla 8).

/** El cliente de Supabase con la clave de servicio (el de esm.sh o el de npm: aquí da igual cuál). */
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import { cuentaPuedeSalir } from "./puerta.ts";
import { correoDeSalida } from "./puertaDePruebas.ts";
import { MARCAS } from "./marcas.ts";
import { cerrojoMarca } from "../send-email/marca.ts";
import { PLANTILLA_FACTURA_VENTA, correoFactura, correoValido, remitenteFactura } from "./facturaVentaCorreo.ts";
import { nombreFacturaPdf } from "./facturaVentaPdf.ts";

const BUCKET = "conta-documentos";

/** Lo que hace falta de la factura (customer_invoice). */
export interface FacturaParaEnviar {
  id: string; account_id: string; company_id: string; status: string; doc_type: string; number_text: string
  issue_date: string; due_date: string | null; total: number | string; customer: Record<string, unknown> | null; pdf_path: string | null
}
export interface EntornoCorreo { resendKey: string | undefined; buzonDePruebas: string | undefined; abiertos: string | undefined }
export interface ResultadoEnvio { enviado: boolean; texto: string; demo?: boolean }

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function enviarFacturaVenta(srv: SupabaseClient, f: FacturaParaEnviar, paraPedido: string, quien: string | null, env: EntornoCorreo): Promise<ResultadoEnvio> {
  let para = paraPedido;
  const apuntar = (enviado: boolean, texto: string, detalle: Record<string, unknown>) =>
    srv.rpc("conta_venta_enviada", { p_id: f.id, p_para: enviado ? para : null, p_texto: texto, p_detalle: detalle, p_quien_nombre: quien });

  if (f.status === "borrador") return { enviado: false, texto: "No se ha mandado: un borrador no se manda; emítela antes." };
  if (!f.pdf_path) {
    const texto = `No se ha mandado la ${f.number_text}: aún no tiene su PDF.`;
    await apuntar(false, texto, { para, motivo: "sin_pdf" });
    return { enviado: false, texto };
  }

  // La puerta de las demos.
  let alBuzon: string | null = null;
  if (!(await cuentaPuedeSalir(srv, f.account_id))) {
    const salida = correoDeSalida(true, para, env.buzonDePruebas);
    if ("porque" in salida) {
      await apuntar(false, salida.porque, { para, demo: true, motivo: "sin_buzon" });
      return { enviado: false, demo: true, texto: salida.porque };
    }
    alBuzon = para;
    para = salida.para;
  }

  // El freno, antes de tocar nada más.
  const cerrojo = cerrojoMarca(MARCAS.sumied, PLANTILLA_FACTURA_VENTA, para, env.abiertos);
  if (!cerrojo.abierto) {
    const texto = `No se ha mandado la ${f.number_text} a ${para}: los correos de facturas aún están cerrados (los abre Julio).`;
    await apuntar(false, texto, { para, motivo: "cerrado" });
    return { enviado: false, texto };
  }
  if (!env.resendKey) return { enviado: false, texto: "No se ha mandado: el servicio de correo no está configurado." };

  const { data: emp } = await srv.from("company").select("legal_name, trade_name, email").eq("id", f.company_id).maybeSingle();
  const empresa = String(emp?.trade_name || emp?.legal_name || "");
  const { data: pdf, error: e1 } = await srv.storage.from(BUCKET).download(f.pdf_path);
  if (e1 || !pdf) {
    const texto = `No se ha mandado la ${f.number_text}: no se ha podido leer su PDF.`;
    await apuntar(false, texto, { para, motivo: "pdf" });
    return { enviado: false, texto };
  }

  const cliente = String((f.customer as Record<string, unknown> | null)?.nombre ?? "");
  const c = correoFactura({
    empresa, numero: f.number_text, rectificativa: f.doc_type === "rectificativa", fecha: f.issue_date,
    total: Number(f.total), vence: f.due_date, cliente: cliente || "cliente",
  });
  const responder = correoValido(emp?.email);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
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
    console.error(`enviarFacturaVenta · ${f.id} · Resend ${res.status}`);
    return { enviado: false, texto };
  }
  const texto = alBuzon
    ? `Enviada la ${f.number_text} al buzón de pruebas (${para}), con su PDF: en la demo no se manda a ${alBuzon}.`
    : `Enviada la ${f.number_text} a ${para}, con su PDF.`;
  await apuntar(true, texto, { para, correo_id: cuerpo.id ?? null, ...(alBuzon ? { demo: true, era_para: alBuzon } : {}) });
  return { enviado: true, texto, ...(alBuzon ? { demo: true } : {}) };
}
