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
import { cuentaDelLote, type Cuenta, type EstadoCosa } from '@/modules/conta/lib/catcherCuenta'

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

// ── E05 · Tarea 4 · El pago contra el saldo prepago ──────────────────────────────

/** El nombre de la 40700001, tal cual está en Diez C0008 (Julio, 15/10). */
export const SALDO_PREPAGO = { cuenta: '40700001', nombre: 'Saldo prepago Catcher' } as const

/** Propone el pago del lote contra la 40700001 (serie de tesorería). Si ya estaba, no crea otro y lo dice. */
export async function proponerPagoLote(loteId: string, quien: string | null): Promise<{ asiento: string; yaEstaba: boolean; texto: string }> {
  hayBase()
  const r = await rpc<Record<string, unknown>>('conta_lote_pago_proponer', { p_lote: loteId, p_quien_nombre: quien })
  return { asiento: String(r.id), yaEstaba: r.ya_estaba === true, texto: String(r.texto ?? '') }
}

export interface SaldoPrepago {
  existe: boolean; cuenta: string; nombre?: string; texto?: string
  recargas?: number; pagos?: number; saldo?: number; saldoValidado?: number; propuesto?: number; ultimoMovimiento?: string | null
  /** De los pagos, los que están en asientos aún sin validar (propuestos o en borrador). */
  pagosSinValidar?: number
  ultimaComprobacion?: { cuando: string; portal: number; app: number; coincide: boolean; quien: string | null } | null
}

/** El saldo de la 40700001 en la app (recargas menos pagos; lo validado y lo propuesto). */
export async function saldoPrepago(companyId: string): Promise<SaldoPrepago> {
  hayBase()
  const r = await rpc<Record<string, unknown>>('conta_catcher_saldo', { p_company: companyId })
  const n = (x: unknown) => (x == null ? undefined : Number(x))
  // La función da lo propuesto neto (recargas menos pagos); para decir «de esos
  // pagos, Y € aún sin validar» hace falta el haber de los asientos sin validar.
  let pagosSinValidar: number | undefined
  if (r.existe === true) {
    const { data, error } = await tabla('journal_line').select('credit, journal_entry!inner(status), company_account!inner(code)')
      .eq('company_id', companyId).eq('company_account.code', SALDO_PREPAGO.cuenta).in('journal_entry.status', ['propuesto', 'borrador']).gt('credit', 0)
    if (error) throw new Error(`No se han podido leer los pagos sin validar de la ${SALDO_PREPAGO.cuenta}: ${error.message}`)
    pagosSinValidar = ((data ?? []) as { credit: number }[]).reduce((t, l) => t + Math.round(Number(l.credit) * 100), 0) / 100
  }
  return {
    pagosSinValidar,
    existe: r.existe === true, cuenta: String(r.cuenta ?? SALDO_PREPAGO.cuenta), nombre: r.nombre == null ? undefined : String(r.nombre), texto: r.texto == null ? undefined : String(r.texto),
    recargas: n(r.recargas), pagos: n(r.pagos), saldo: n(r.saldo), saldoValidado: n(r.saldo_validado), propuesto: n(r.propuesto),
    ultimoMovimiento: r.ultimo_movimiento == null ? null : String(r.ultimo_movimiento),
    ultimaComprobacion: (r.ultima_comprobacion ?? null) as SaldoPrepago['ultimaComprobacion'],
  }
}

/** Compara el saldo que se ve en el portal de Catcher con el de la 40700001; queda apuntado y dice si coincide. */
export async function comprobarSaldoPortal(companyId: string, saldoPortal: number, quien: string | null): Promise<{ coincide: boolean; texto: string }> {
  hayBase()
  const r = await rpc<Record<string, unknown>>('conta_catcher_saldo_comprobar', { p_company: companyId, p_saldo_portal: saldoPortal, p_quien_nombre: quien })
  return { coincide: r.coincide === true, texto: String(r.texto ?? '') }
}

// ── E05 · Tarea 5 · Lo que enseñan las pantallas ─────────────────────────────

export interface LoteFila {
  id: string; etiqueta: string; desde: string; hasta: string; facturas: number; total: number
  cruzado: boolean; pago: string | null; subido: string; quien: string | null
  /** Lo abierto, lo reclamado y lo dado por bueno ahora mismo (catcherCuenta: una sola cuenta para todas las pantallas). */
  cuenta: Cuenta
}

type FilaLote = { id: string; label: string; period_from: string; period_to: string; invoice_count: number; grand_total: number | null; crossed_at: string | null; cross_summary: unknown; payment_entry_id: string | null; created_at: string; created_by_name: string | null }
const deFila = (r: FilaLote, cuenta: Cuenta): LoteFila => ({
  id: r.id, etiqueta: r.label, desde: r.period_from, hasta: r.period_to, facturas: r.invoice_count, total: Number(r.grand_total ?? 0),
  cruzado: !!r.crossed_at, pago: r.payment_entry_id, subido: r.created_at, quien: r.created_by_name, cuenta,
})
const COLUMNAS_LOTE = 'id, label, period_from, period_to, invoice_count, grand_total, crossed_at, cross_summary, payment_entry_id, created_at, created_by_name'

/**
 * S01e · ¿Trabaja la empresa con Catcher? Sí si tiene algo suyo puesto: sus tiendas
 * (supplier_batch_store), su tarifa (supplier_rate) o alguna quincena ya subida
 * (supplier_batch). Sin nada de eso, la tarjeta de la quincena no se enseña: no
 * esconde ninguna fila, porque no hay ninguna (regla 7). Siempre por cuenta y empresa (regla 9).
 */
export async function usaCatcher(accountId: string, companyId: string): Promise<boolean> {
  hayBase()
  const hay = async (t: 'supplier_batch_store' | 'supplier_rate' | 'supplier_batch', que: string) => {
    const { data, error } = await tabla(t).select('id').eq('account_id', accountId).eq('company_id', companyId).eq('provider', 'catcher').limit(1)
    if (error) throw new Error(`No se ha podido saber si trabajas con Catcher (${que}): ${error.message}`)
    return (data ?? []).length > 0
  }
  const [tiendas, tarifa, lotes] = await Promise.all([hay('supplier_batch_store', 'las tiendas'), hay('supplier_rate', 'la tarifa'), hay('supplier_batch', 'las quincenas')])
  return tiendas || tarifa || lotes
}

/** Las quincenas de Catcher subidas por la empresa, la más reciente primero. */
export async function leerLotes(accountId: string, companyId: string): Promise<LoteFila[]> {
  hayBase()
  const { data, error } = await tabla('supplier_batch').select(COLUMNAS_LOTE).eq('account_id', accountId).eq('company_id', companyId).eq('provider', 'catcher').order('period_from', { ascending: false })
  if (error) throw new Error(`No se han podido leer las quincenas de Catcher: ${error.message}`)
  const filas = (data ?? []) as FilaLote[]
  if (!filas.length) return []
  const { data: is, error: e2 } = await tabla('supplier_batch_issue').select('batch_id, supplier_invoice_id, status').eq('account_id', accountId).in('batch_id', filas.map((f) => f.id))
  if (e2) throw new Error(`No se ha podido leer lo que queda por aclarar: ${e2.message}`)
  const cosas = (is ?? []) as { batch_id: string; supplier_invoice_id: string | null; status: EstadoCosa }[]
  return filas.map((f) => deFila(f, cuentaDelLote(cosas.filter((c) => c.batch_id === f.id).map((c) => ({ facturaId: c.supplier_invoice_id, estado: c.status }))).total))
}

export interface FacturaDeLote {
  id: string; numero: string; tipo: TipoFactura; emisor: string | null; nif: string | null; local: string | null
  total: number; confianza: 'seguro' | 'probable' | 'duda' | null; estado: string; sinProveedor: boolean
}
export interface CosaPorAclarar {
  id: string; factura: string | null; facturaId: string | null; motivo: string; codigo: string | null; momento: string | null
  texto: string; estado: 'abierta' | 'aceptada' | 'reclamada'; nota: string | null; quien: string | null
}
export interface LoteDetalle {
  lote: LoteFila; facturas: FacturaDeLote[]; porAclarar: CosaPorAclarar[]; comision: { esperada: number; cobrada: number } | null
  /** La cuenta de cada factura, de la misma pasada que lote.cuenta. */
  porFactura: Map<string, Cuenta>
}

/** Una quincena con sus facturas (agrupables por tipo) y lo que queda por aclarar. */
export async function leerLote(accountId: string, loteId: string): Promise<LoteDetalle> {
  hayBase()
  const [l, fs, is, ls] = await Promise.all([
    tabla('supplier_batch').select(COLUMNAS_LOTE).eq('id', loteId).eq('account_id', accountId).single(),
    tabla('supplier_invoice').select('id, invoice_number, issuer_name, issuer_tax_id, location_id, grand_total, reading_confidence, reading, status, supplier_id').eq('batch_id', loteId).eq('account_id', accountId).order('invoice_number'),
    tabla('supplier_batch_issue').select('id, supplier_invoice_id, reason, order_code, ordered_at, text, status, note, resolved_by_name').eq('batch_id', loteId).eq('account_id', accountId).order('created_at'),
    tabla('locations').select('id, name').eq('account_id', accountId),
  ])
  for (const r of [l, fs, is, ls]) if (r.error) throw new Error(`No se ha podido leer la quincena: ${r.error.message}`)
  const locales = new Map(((ls.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
  type F = { id: string; invoice_number: string; issuer_name: string | null; issuer_tax_id: string | null; location_id: string | null; grand_total: number; reading_confidence: FacturaDeLote['confianza']; reading: { lote?: { tipo?: TipoFactura } } | null; status: string; supplier_id: string | null }
  const facturas = ((fs.data ?? []) as F[]).map((f): FacturaDeLote => ({
    id: f.id, numero: f.invoice_number, tipo: f.reading?.lote?.tipo ?? 'rider', emisor: f.issuer_name, nif: f.issuer_tax_id,
    local: f.location_id ? locales.get(f.location_id) ?? null : null, total: Number(f.grand_total), confianza: f.reading_confidence,
    estado: f.status, sinProveedor: !f.supplier_id,
  }))
  const numeroDe = new Map(facturas.map((f) => [f.id, f.numero]))
  type I = { id: string; supplier_invoice_id: string | null; reason: string; order_code: string | null; ordered_at: string | null; text: string; status: CosaPorAclarar['estado']; note: string | null; resolved_by_name: string | null }
  const porAclarar = ((is.data ?? []) as I[]).map((i): CosaPorAclarar => ({
    id: i.id, facturaId: i.supplier_invoice_id, factura: i.supplier_invoice_id ? numeroDe.get(i.supplier_invoice_id) ?? null : null, motivo: i.reason,
    codigo: i.order_code, momento: i.ordered_at, texto: i.text, estado: i.status, nota: i.note, quien: i.resolved_by_name,
  }))
  const lote = l.data as FilaLote & { cross_summary: { totales?: { comisionEsperada?: number; comisionCobrada?: number } } | null }
  const t = lote.cross_summary?.totales
  const cuenta = cuentaDelLote(porAclarar)
  return { lote: deFila(lote, cuenta.total), facturas, porAclarar, porFactura: cuenta.porFactura, comision: t && t.comisionCobrada != null ? { esperada: Number(t.comisionEsperada ?? 0), cobrada: Number(t.comisionCobrada) } : null }
}
