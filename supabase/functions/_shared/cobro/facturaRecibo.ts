// supabase/functions/_shared/cobro/facturaRecibo.ts
//
// G05 · Tarea 4 · LA FACTURA DE UN RECIBO, REMATADA EN EL SERVIDOR (Julio, nº 38
// y nº 40). Cuando el seguimiento del cobro (conta_cobro_seguir) emite la
// factura de un recibo cobrado, nadie la tiene abierta: aquí, justo después,
//   1. su PDF con el modelo «Sumied» (el mismo que la ficha: facturaSumiedDatos),
//      subido al almacén y guardado con conta_venta_pdf_guardar, que lo deja
//      ADJUNTO a la factura y a su asiento (journal_entry_document, el sistema
//      de documentos de siempre: se abre desde la factura, el asiento y el
//      libro diario);
//   2. y la factura, ya cobrada, se manda sola al cliente UNA vez
//      (_shared/facturaVentaEnviar.ts: en la demo, solo al buzón de pruebas; con
//      el freno de los correos cerrado, no sale y su historial lo dice).
// Lo llaman conta-gocardless-leer y conta-cobro («seguir») después de seguir el
// cobro. Cada factura, aparte: si una falla, las demás siguen y el fallo queda
// en el resultado. Con la clave de servicio, solo la empresa que se le pasa.

/** El cliente de Supabase con la clave de servicio (el de esm.sh o el de npm: aquí da igual cuál). */
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import { facturaSumiedPdf } from "../facturaSumiedPdf.ts";
import { montarDatosSumied } from "./facturaSumiedDatos.ts";
import { enviarFacturaVenta, type EntornoCorreo } from "../facturaVentaEnviar.ts";
import { cuentaPuedeSalir } from "../puerta.ts";

type Fila = Record<string, unknown>;
const BUCKET = "conta-documentos";
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const n = (v: unknown) => Number(v ?? 0);
/** Cuántas facturas se rematan como mucho en una pasada (el resto, en la siguiente). */
export const TOPE_POR_PASADA = 40;

export interface Herramientas {
  // deno-lint-ignore no-explicit-any
  jsPDF: new (o: { unit: "mm"; format: "a4"; orientation: "portrait" }) => any;
  /** La matriz del QR de una URL de Verifactu. */
  qr: (url: string) => boolean[][];
  correo: EntornoCorreo;
}
export interface Rematadas { pdfs: number; enviadas: number; sinEnviar: string[]; fallos: string[] }

async function leer(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q;
  if (error) throw new Error(`No se ha podido leer ${que}: ${error.message}`);
  return (data ?? []) as Fila[];
}

async function sha256(b: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array): string {
  let r = "";
  for (let i = 0; i < bytes.length; i += 0x8000) r += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(r);
}

/** El logo de Ajustes para el PDF: PNG o JPEG tal cual. Otro formato (WebP) o un fallo: sin logo (salen las iniciales). */
async function logoDe(db: SupabaseClient, ruta: string | null) {
  if (!ruta) return null;
  const { data, error } = await db.storage.from("company-logos").download(ruta);
  if (error || !data) return null;
  const formato = data.type === "image/png" ? "PNG" as const : data.type === "image/jpeg" ? "JPEG" as const : null;
  return formato ? { base64: base64(new Uint8Array(await data.arrayBuffer())), formato } : null;
}

/** El PDF «Sumied» de una factura de un recibo, subido y guardado (adjunto a la factura y a su asiento). */
export async function pdfDeFacturaDeRecibo(db: SupabaseClient, h: Herramientas, f: Fila, r: Fila): Promise<string> {
  const cuenta = String(f.account_id), empresa = String(f.company_id), id = String(f.id);
  const lineasRecibo = Array.isArray((r.factura as Fila | null)?.lineas) ? ((r.factura as Fila).lineas as Fila[]) : [];
  const asignaciones = lineasRecibo.map((l) => s(l.asignacionId)).filter((x): x is string => !!x);
  const [lineas, [emp], [cc], asig, [vf]] = await Promise.all([
    leer(db.from("customer_invoice_line").select("tax_pct, amount, tax_amount").eq("invoice_id", id).order("position"), "sus líneas"),
    leer(db.from("company").select("legal_name, trade_name, tax_id, fiscal_street_type, fiscal_street, fiscal_number, fiscal_extra, fiscal_postal_code, fiscal_city, fiscal_province, email, phone, logo_path").eq("id", empresa), "la empresa"),
    leer(db.from("conta_cobro_cliente").select("codigo_cliente").eq("company_id", empresa).eq("party_id", String(r.party_id)), "el código del cliente"),
    asignaciones.length ? leer(db.from("conta_consulta_asignacion").select("id, servicio_id, nivel_id, paquete_id").eq("cuenta_id", cuenta).in("id", asignaciones), "las asignaciones") : Promise.resolve([] as Fila[]),
    leer(db.from("verifactu_factura_estado").select("url_qr, entorno").eq("invoice_id", id), "su estado con Hacienda"),
  ]);
  if (!emp) throw new Error("no se ha podido leer la empresa");
  const ids = (k: string) => asig.map((a) => s(a[k])).filter((x): x is string => !!x);
  const mandato = s(r.mandato_gc_id);
  const [niveles, paquetes, servicios, cuentaMandato, logo, sale] = await Promise.all([
    ids("nivel_id").length ? leer(db.from("conta_servicio_nivel").select("id, incluye").eq("account_id", cuenta).in("id", ids("nivel_id")), "los niveles") : Promise.resolve([] as Fila[]),
    ids("paquete_id").length ? leer(db.from("conta_paquete").select("id, descripcion").eq("account_id", cuenta).in("id", ids("paquete_id")), "los paquetes") : Promise.resolve([] as Fila[]),
    ids("servicio_id").length ? leer(db.from("conta_servicio").select("id, clave, incluye").eq("account_id", cuenta).in("id", ids("servicio_id")), "los servicios") : Promise.resolve([] as Fila[]),
    mandato ? leer(db.from("conta_gc_mandato").select("cuenta_final, cuenta_pais").eq("company_id", empresa).eq("gc_id", mandato), "la cuenta del mandato") : Promise.resolve([] as Fila[]),
    logoDe(db, s(emp.logo_path)),
    cuentaPuedeSalir(db, cuenta),
  ]);
  const cli = (f.customer ?? {}) as Fila;
  const url = s(vf?.url_qr);
  const datos = montarDatosSumied({
    factura: { numero: s(f.number_text), fecha: String(f.issue_date), base: n(f.base), iva: n(f.tax), retencion: n(f.withholding_amount), total: n(f.total),
      cliente: { nombre: s(cli.nombre), nif: s(cli.nif), calle: s(cli.calle), cp: s(cli.cp), ciudad: s(cli.ciudad), provincia: s(cli.provincia) },
      lineas: lineas.map((l) => ({ tipo: n(l.tax_pct), importe: n(l.amount), cuota: l.tax_amount == null ? null : n(l.tax_amount) })) },
    recibo: { mes: String(r.mes), factura: (r.factura as Fila | null) ?? null, confirmado_el: s(r.confirmado_el) },
    empresa: emp, codigoCliente: cc?.codigo_cliente == null ? null : n(cc.codigo_cliente),
    asignaciones: asig, niveles, servicios, paquetes,
    cuenta: cuentaMandato[0] ? { pais: s(cuentaMandato[0].cuenta_pais), final: s(cuentaMandato[0].cuenta_final) } : null,
    logo, demo: !sale, verifactu: url ? { modulos: h.qr(url), prueba: vf?.entorno === "pruebas" } : null,
  });
  const pdf = facturaSumiedPdf(h.jsPDF, datos);
  const sha = await sha256(pdf);
  const ruta = `${cuenta}/ventas/${id}/${sha.slice(0, 16)}.pdf`;
  const sub = await db.storage.from(BUCKET).upload(ruta, new Blob([pdf as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`no se ha podido subir su PDF (${sub.error.message})`);
  const { data: g, error } = await db.rpc("conta_venta_pdf_guardar", { p_id: id, p_ruta: ruta, p_sha256: sha, p_bytes: pdf.length });
  if (error) throw new Error(`no se ha podido guardar su PDF (${error.message})`);
  return String((g as Fila | null)?.ruta ?? ruta);
}

/** El correo al que va la factura: el de la factura, el de su cliente en ella o el que tiene GoCardless de ese cliente. */
async function correoDelCliente(db: SupabaseClient, f: Fila): Promise<string | null> {
  const valido = (x: unknown) => (typeof x === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim()) ? x.trim() : null);
  const propio = valido(f.email_to) ?? valido((f.customer as Fila | null)?.correo);
  if (propio || !f.party_id) return propio;
  const [gc] = await leer(db.from("conta_gc_cliente").select("correo").eq("company_id", String(f.company_id)).eq("party_id", String(f.party_id)).not("correo", "is", null).limit(1), "el correo del cliente en GoCardless");
  return valido(gc?.correo);
}

/**
 * Las facturas de los recibos de una empresa que aún no tienen su PDF, o que
 * no se han intentado mandar nunca: su PDF y su envío. Idempotente: lo hecho no
 * se rehace (el PDF ya guardado, o un envío ya apuntado en su historial).
 */
export async function rematarFacturasDeRecibos(db: SupabaseClient, empresa: string, h: Herramientas): Promise<Rematadas> {
  const out: Rematadas = { pdfs: 0, enviadas: 0, sinEnviar: [], fallos: [] };
  const recibos = await leer(db.from("conta_recibo").select("id, party_id, mes, factura, confirmado_el, mandato_gc_id, invoice_id")
    .eq("company_id", empresa).not("invoice_id", "is", null).order("updated_at", { ascending: false }).limit(500), "los recibos facturados");
  if (!recibos.length) return out;
  const facturas = await leer(db.from("customer_invoice").select("id, account_id, company_id, party_id, status, doc_type, number_text, issue_date, due_date, base, tax, withholding_amount, total, customer, email_to, pdf_path, sent_at")
    .in("id", recibos.map((r) => String(r.invoice_id))), "sus facturas");
  const intentadas = new Set((await leer(db.from("customer_invoice_event").select("invoice_id").in("invoice_id", facturas.map((f) => String(f.id))).in("kind", ["enviada", "correo_no"]), "sus envíos"))
    .map((e) => String(e.invoice_id)));
  const porHacer = facturas.filter((f) => f.status === "emitida" && (!f.pdf_path || (!f.sent_at && !intentadas.has(String(f.id))))).slice(0, TOPE_POR_PASADA);
  for (const f of porHacer) {
    const r = recibos.find((x) => String(x.invoice_id) === String(f.id))!;
    try {
      if (!f.pdf_path) {
        f.pdf_path = await pdfDeFacturaDeRecibo(db, h, f, r);
        out.pdfs++;
      }
      if (!f.sent_at && !intentadas.has(String(f.id))) {
        const para = await correoDelCliente(db, f);
        if (!para) {
          const texto = `No se ha mandado la ${f.number_text}: su cliente no tiene correo (ni en la factura ni en GoCardless). Mándala desde su ficha cuando lo tengas.`;
          await db.rpc("conta_venta_enviada", { p_id: f.id, p_para: null, p_texto: texto, p_detalle: { motivo: "sin_correo", solo: true }, p_quien_nombre: "Sumied" });
          out.sinEnviar.push(texto);
          continue;
        }
        const e = await enviarFacturaVenta(db, f as never, para, "Sumied", h.correo);
        if (e.enviado) out.enviadas++; else out.sinEnviar.push(e.texto);
      }
    } catch (e) {
      out.fallos.push(`${f.number_text}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
