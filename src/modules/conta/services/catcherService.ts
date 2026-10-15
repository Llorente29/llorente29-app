// src/modules/conta/services/catcherService.ts
//
// E05 · La quincena de Catcher en la base. El núcleo (lib/catcherQuincena.ts)
// lee los tres ficheros en el navegador; aquí:
//   · abrirQuincena: las tiendas → locales de la empresa (supplier_batch_store),
//     el NIF de la empresa, la lectura y cada PDF comprobado contra el Excel
//     (su texto, con pdfjs: los importes salen del Excel, no se leen con IA);
//   · subirQuincena: cada PDF al almacén (receipt-uploads, en una carpeta por
//     lote) y el lote a conta_lote_registrar, que dice lo que ha hecho (regla 8):
//     «Subida la 2.ª quincena de septiembre de 2026: 58 facturas (…)», o que ya
//     estaba y no ha creado nada.

import { rpc, tabla, hayBase } from '@/modules/conta/services/bd'
import { uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'
import { comprobarPdf, leerFacturas, leerQuincena, loteParaRegistrar, reconocer, type Fichero, type PdfSubido, type PedidoExcel, type Quincena, type TipoFactura } from '@/modules/conta/lib/catcherQuincena'
import { cruzar, type Cruce, type PedidoApp, type Tarifa } from '@/modules/conta/lib/catcherCruces'

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', new Uint8Array(b)))

/** El texto de un PDF, página a página (pdfjs, el build legacy que ya usa el plan). */
async function textoPdf(bytes: Uint8Array): Promise<string> {
  const pj = await pdfjs() as unknown as { getDocument(o: { data: Uint8Array; verbosity?: number }): { promise: Promise<{ numPages: number; getPage(i: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }> }> } }
  const doc = await pj.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  let t = ''
  for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str ?? '').join(' ') + '\n'
  return t
}

export type QuincenaAbierta = Quincena & { ficherosOriginales: Fichero[] }

/** Lee los ficheros soltados (sin subir nada todavía): lo que dicen y si cada PDF cuadra con el Excel. */
export async function abrirQuincena(accountId: string, companyId: string, files: readonly File[]): Promise<QuincenaAbierta> {
  hayBase()
  const ficheros: Fichero[] = await Promise.all(files.map(async (f) => ({ nombre: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
  const [{ data: tiendas, error: e1 }, { data: empresa, error: e2 }] = await Promise.all([
    tabla('supplier_batch_store').select('store_name, location_id').eq('account_id', accountId).eq('company_id', companyId).eq('provider', 'catcher'),
    tabla('company').select('tax_id').eq('id', companyId).eq('account_id', accountId).maybeSingle(),
  ])
  if (e1) throw new Error(`No se han podido leer las tiendas de Catcher: ${e1.message}`)
  if (e2) throw new Error(`No se ha podido leer la empresa: ${e2.message}`)
  const mapa = Object.fromEntries(((tiendas ?? []) as { store_name: string; location_id: string }[]).map((t) => [t.store_name, t.location_id]))
  const q = leerQuincena(ficheros, { tiendas: mapa, empresa: { nif: ((empresa ?? {}) as { tax_id?: string | null }).tax_id ?? null } })
  // Cada PDF contra su fila del Excel.
  const excel = leerFacturas(reconocer(ficheros).facturas).facturas
  for (const f of q.facturas) {
    const fila = excel.find((x) => x.numero === f.numero)
    if (!f.pdf || !fila) continue
    try { f.contraPdf = comprobarPdf(fila, await textoPdf(f.pdf.bytes)) } catch (e) {
      f.contraPdf = [{ id: 'pdf_abrir', ok: false, texto: `No he podido leer el PDF (${e instanceof Error ? e.message : String(e)}).` }]
    }
  }
  return { ...q, ficherosOriginales: ficheros }
}

export interface QuincenaSubida { loteId: string; yaEstaba: boolean; facturas: number; yaEstaban: number; sinPdf: number; total: number; catcherSinFicha: boolean; texto: string }

/** Sube los PDF y registra el lote. Si la quincena ya estaba, no sube nada y lo dice. */
export async function subirQuincena(accountId: string, companyId: string, q: QuincenaAbierta, quien: string | null): Promise<QuincenaSubida> {
  hayBase()
  const { data: ya } = await tabla('supplier_batch').select('id').eq('account_id', accountId).eq('company_id', companyId)
    .eq('provider', 'catcher').eq('period_from', q.desde).eq('period_to', q.hasta).maybeSingle()
  const pdfs: Record<string, PdfSubido> = {}
  if (!ya) {
    const conPdf = q.facturas.filter((f) => f.pdf)
    // Todos en una carpeta: la del lote.
    const rutas = await uploadReceiptFiles(accountId, conPdf.map((f) => new File([new Uint8Array(f.pdf!.bytes)], f.pdf!.nombre, { type: 'application/pdf' })))
    for (const [i, f] of conPdf.entries()) pdfs[f.numero] = { ruta: rutas[i], nombre: f.pdf!.nombre, sha256: await sha256(f.pdf!.bytes), bytes: f.pdf!.bytes.byteLength }
  }
  const huellas = await Promise.all(q.ficheros.map(async (x) => {
    const o = q.ficherosOriginales.find((f) => f.nombre === x.nombre)!
    return { ...x, sha256: await sha256(o.bytes), bytes: o.bytes.byteLength }
  }))
  const r = await rpc<Record<string, unknown>>('conta_lote_registrar', { p_company: companyId, p_lote: loteParaRegistrar(q, pdfs, huellas), p_quien_nombre: quien })
  return {
    loteId: String(r.lote_id), yaEstaba: r.ya_estaba === true, facturas: Number(r.facturas ?? 0), yaEstaban: Number(r.ya_estaban ?? 0),
    sinPdf: Number(r.sin_pdf ?? 0), total: Number(r.total ?? 0), catcherSinFicha: r.catcher_sin_ficha === true, texto: String(r.texto ?? ''),
  }
}

// ── E05 · Tarea 3 · Cruzar el lote ─────────────────────────────────────────────

/** Las tarifas de Catcher de la empresa (supplier_rate), de la más antigua a la más nueva. */
export async function tarifasDeCatcher(accountId: string, companyId: string): Promise<Tarifa[]> {
  hayBase()
  const { data, error } = await tabla('supplier_rate').select('valid_from, params').eq('account_id', accountId).eq('company_id', companyId).eq('provider', 'catcher').order('valid_from')
  if (error) throw new Error(`No se ha podido leer la tarifa de Catcher: ${error.message}`)
  return ((data ?? []) as { valid_from: string; params: Omit<Tarifa, 'desde'> }[]).map((r) => ({ ...r.params, desde: r.valid_from }))
}

/** Guarda una versión de la tarifa (vale desde `t.desde`; si ya hay una ese día, la corrige). */
export async function guardarTarifa(companyId: string, t: Tarifa, quien: string | null): Promise<string> {
  hayBase()
  const { desde, ...params } = t
  const r = await rpc<Record<string, unknown>>('conta_tarifa_guardar', { p_company: companyId, p_provider: 'catcher', p_desde: desde, p_params: params, p_quien_nombre: quien })
  return String(r.texto ?? '')
}

/**
 * Cruza un lote ya subido: sus facturas y pedidos (de la base), lo que la app
 * mandó a Catcher en su periodo y la tarifa; y guarda lo que sale. Devuelve el
 * cruce y la frase de lo que se ha hecho.
 */
export async function cruzarLote(accountId: string, companyId: string, loteId: string, quien: string | null): Promise<{ cruce: Cruce; texto: string }> {
  hayBase()
  const [lote, facs, peds, app, tarifas] = await Promise.all([
    tabla('supplier_batch').select('period_from, period_to, grand_total').eq('id', loteId).eq('account_id', accountId).single(),
    tabla('supplier_invoice').select('invoice_number, tax_base_total, grand_total, reading').eq('batch_id', loteId).eq('account_id', accountId),
    tabla('supplier_batch_order').select('invoice_number, kind, order_code, order_status, ordered_at, tax_base, tax_amount, total').eq('batch_id', loteId).eq('account_id', accountId),
    rpc<PedidoApp[]>('conta_lote_pedidos_app', { p_lote: loteId }),
    tarifasDeCatcher(accountId, companyId),
  ])
  for (const r of [lote, facs, peds]) if (r.error) throw new Error(`No se ha podido leer el lote: ${r.error.message}`)
  const l = lote.data as { period_from: string; period_to: string; grand_total: number | null }
  type F = { invoice_number: string; tax_base_total: number; grand_total: number; reading: { confianza?: string; lote?: { tipo?: TipoFactura } } | null }
  const facturas = ((facs.data ?? []) as F[]).map((f) => ({
    numero: f.invoice_number, tipo: f.reading?.lote?.tipo ?? 'rider', base: Number(f.tax_base_total), total: Number(f.grand_total), seguraAlLeer: f.reading?.confianza === 'seguro',
  }))
  type P = { invoice_number: string; kind: string; order_code: string; order_status: string; ordered_at: string | null; tax_base: number; tax_amount: number; total: number }
  const pedidos: PedidoExcel[] = ((peds.data ?? []) as P[]).map((p) => ({
    factura: p.invoice_number, tipo: p.kind, codigo: p.order_code, estado: p.order_status,
    momento: p.ordered_at ? new Date(p.ordered_at).toISOString() : null, base: Number(p.tax_base), cuota: Number(p.tax_amount), total: Number(p.total),
  }))
  const cruce = cruzar({
    facturas, pedidos, app: app.map((a) => ({ ...a, momento: new Date(a.momento).toISOString(), precio: a.precio == null ? null : Number(a.precio) })),
    tarifas, periodo: { desde: l.period_from, hasta: l.period_to }, totalLote: l.grand_total == null ? null : Number(l.grand_total),
  })
  const r = await rpc<Record<string, unknown>>('conta_lote_cruce_guardar', { p_lote: loteId, p_cruce: cruce, p_quien_nombre: quien })
  return { cruce, texto: String(r.texto ?? '') }
}

/** La persona decide sobre una cosa por aclarar: se da por buena, se reclama (con lo que se reclama) o se vuelve a abrir. */
export async function aclarar(issueId: string, decision: 'aceptada' | 'reclamada' | 'abierta', nota: string | null, quien: string | null): Promise<string> {
  hayBase()
  const r = await rpc<Record<string, unknown>>('conta_lote_aclarar', { p_issue: issueId, p_decision: decision, p_nota: nota, p_quien_nombre: quien })
  return String(r.texto ?? '')
}
