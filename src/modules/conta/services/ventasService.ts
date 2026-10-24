// src/modules/conta/services/ventasService.ts
//
// V01 · Entrega 1 · Ventas › Facturas: leer y escribir las facturas de venta.
//
//   · La lista junta las de Sumied (customer_invoice, con sus cobros) y las
//     que ya estaban en el libro de expedidas (los resúmenes del cierre del día
//     y las traídas de Diez), leídas con su servicio de siempre
//     (leerLibroRegistro) y sin las de Sumied, que ya están por su factura.
//     El envío a Diez de cada asiento, de external_send (leerEnviosDiez).
//   · Escribir, solo por las funciones de la base (conta_venta_*): guardar el
//     borrador, borrarlo, emitirlo, corregir, cobrar. El PDF se hace aquí
//     (como el resumen de ventas) y se guarda con conta_venta_pdf_guardar; el
//     correo, por la función del servidor conta-venta-correo; Diez, con
//     enviarADiez (conDiezService), como cualquier asiento validado.
// Todo filtrado por cuenta y empresa (regla 9).

import { supabase } from '@/lib/supabase'
import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { leerLibroRegistro } from '@/modules/conta/services/librosService'
import { leerEnviosDiez, leerEnvioEmpresa } from '@/modules/conta/services/envioDiezService'
import { MAX_FILAS, facturasDeAnotaciones, mesesDeLaVentana } from '@/modules/conta/facturacion/emitidas'
import type { AnotacionLibro } from '@/modules/conta/lib/libroRegistro'
import { cifrasDe, diferenciaDe, type DiezFactura, type FacturaVenta, type OrigenFactura } from '@/modules/conta/lib/facturasVenta'
import { jsPDF } from 'jspdf'
import { facturaVentaPdf, type DatosFacturaPdf } from '../../../../supabase/functions/_shared/facturaVentaPdf.ts'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

async function leer(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, que: string): Promise<Fila[]> {
  const { data, error } = await q
  if (error) throw new Error(mensaje(`No he podido leer ${que}`, error))
  return (data as Fila[] | null) ?? []
}

const COLS = 'id, status, doc_type, origin, series_code, number_text, issue_date, due_date, party_id, customer, location_id, base, tax, total, entry_id, sent_at, corrects_id'

/** Las facturas de Sumied de la empresa (todas: son pocas) y sus cobros. */
async function deSumied(accountId: string, companyId: string): Promise<{ filas: Fila[]; cobros: { factura: string; fecha: string; importe: number }[] }> {
  const filas = await leer(tabla('customer_invoice').select(COLS).eq('account_id', accountId).eq('company_id', companyId)
    .order('issue_date', { ascending: false }), 'las facturas de venta')
  const cobros = filas.length === 0 ? [] : await leer(tabla('customer_invoice_payment').select('invoice_id, paid_on, amount')
    .eq('account_id', accountId).eq('company_id', companyId), 'los cobros de las facturas')
  return { filas, cobros: cobros.map((c) => ({ factura: String(c.invoice_id), fecha: String(c.paid_on), importe: n(c.amount) })) }
}

const diezDe = (estado: string | undefined, encendido: boolean, emitida: boolean): DiezFactura => {
  if (!emitida) return null
  if (estado === 'enviado' || estado === 'enlazado') return 'enviada'
  if (estado === 'error' || estado === 'por_aclarar') return 'error'
  if (estado) return 'en_cola'
  return encendido ? 'en_cola' : 'sin_envio'
}

/** Las facturas del libro (las que no son de Sumied), juntadas como en Emitidas (facturasDeAnotaciones). */
function delLibro(anot: readonly AnotacionLibro[]): Omit<FacturaVenta, 'diez'>[] {
  const fuente = new Map(anot.map((a) => [a.entryId, a.sourceType]))
  const origen = (entryId: string): OrigenFactura => {
    const t = fuente.get(entryId)
    if (t === 'migrated') return 'traida'
    if (t === 'sales_day' || t === 'sales_adjustment') return 'cierre_dia'
    if (t === 'channel_settlement' || t === 'licensed_settlement') return 'automatica'
    return 'a_mano'
  }
  return facturasDeAnotaciones(anot).map((e) => ({
    id: `libro:${e.id}`, fuente: 'libro' as const, entryId: e.entryId, numero: e.numero, serie: e.numero?.split('-')[0] ?? null, fecha: e.fecha, vence: null,
    cliente: e.cliente, nif: e.nif, origen: origen(e.entryId),
    base: e.base, iva: e.iva, total: e.total, cobrado: 0,
    guardado: e.estado === 'anulada' ? 'anulada' as const : 'emitida' as const, enviada: false, rectificativa: /rectificativa/i.test(e.tipo), localId: null,
  }))
}

export interface DatosFacturas { facturas: FacturaVenta[]; cobros: { fecha: string; importe: number }[]; envioEncendido: boolean; alTope: string[] }

/** La lista entera: las de Sumied y, de la ventana (un mes o los últimos 12), las del libro. */
export async function leerFacturasVenta(accountId: string, companyId: string, desde: string, hasta: string): Promise<DatosFacturas> {
  const [sumied, porMes, envio] = await Promise.all([
    deSumied(accountId, companyId),
    Promise.all(mesesDeLaVentana(desde, hasta).map(async (m) => ({ m, anot: await leerLibroRegistro(accountId, companyId, ['issued'], m.desde, m.hasta) }))),
    leerEnvioEmpresa(accountId, companyId).catch(() => ({ encendido: false })),
  ])
  const libro = porMes.flatMap((x) => x.anot)
  // Un mes que llega al tope puede tener más: se dice cuál (regla 7).
  const alTope = porMes.filter((x) => x.anot.length >= MAX_FILAS).map((x) => x.m.desde.slice(0, 7))
  const cobradoDe = new Map<string, number>()
  for (const c of sumied.cobros) cobradoDe.set(c.factura, Math.round(((cobradoDe.get(c.factura) ?? 0) + c.importe) * 100) / 100)
  const propias: Omit<FacturaVenta, 'diez'>[] = sumied.filas.map((f) => {
    const cli = (f.customer ?? {}) as Fila
    return {
      id: String(f.id), fuente: 'sumied' as const, entryId: s(f.entry_id), numero: s(f.number_text), serie: s(f.series_code),
      fecha: String(f.issue_date), vence: s(f.due_date), cliente: s(cli.nombre), nif: s(cli.nif), origen: String(f.origin) as OrigenFactura,
      base: n(f.base), iva: n(f.tax), total: n(f.total), cobrado: cobradoDe.get(String(f.id)) ?? 0,
      guardado: String(f.status) as FacturaVenta['guardado'], enviada: !!f.sent_at, rectificativa: f.doc_type === 'rectificativa', localId: s(f.location_id),
    }
  })
  // Lo de Sumied ya está por su factura: su anotación del libro no se repite.
  const deSumiedEnLibro = new Set(propias.map((f) => f.entryId).filter(Boolean))
  const ajenas = delLibro(libro.filter((a) => !deSumiedEnLibro.has(a.entryId) && a.sourceType !== 'customer_invoice'))
  const todas = [...propias, ...ajenas]
  const ids = todas.map((f) => f.entryId).filter((x): x is string => !!x)
  const { envios } = ids.length ? await leerEnviosDiez(accountId, ids) : { envios: new Map() }
  return {
    facturas: todas.map((f) => ({ ...f, diez: f.fuente === 'libro' && f.origen === 'traida' ? 'enviada' : diezDe(f.entryId ? envios.get(f.entryId)?.status : undefined, envio.encendido, f.guardado !== 'borrador') })),
    cobros: sumied.cobros.map((c) => ({ fecha: c.fecha, importe: c.importe })),
    envioEncendido: envio.encendido,
    alTope,
  }
}

// ── Una factura ───────────────────────────────────────────────────────────────

export interface LineaGuardada { id: string; concepto: string; cantidad: number; precio: number; descuento: number; tipoId: string; tipo: number; recargo: number | null; cuentaId: string; importe: number }
export interface EventoFactura { cuando: string; tipo: string; texto: string; quien: string | null }
export interface CobroFactura { id: string; fecha: string; importe: number; forma: string | null; nota: string | null; quien: string | null }

export interface FacturaGuardada {
  id: string
  estado: 'borrador' | 'emitida' | 'anulada'
  rectificativa: boolean
  corrige: { id: string; numero: string | null; tipo: 'importes' | 'anular' | 'datos'; motivo: string | null } | null
  origen: OrigenFactura
  serie: string
  numero: string | null
  fecha: string
  vence: string | null
  clienteId: string | null
  cliente: { nombre: string | null; nif: string | null; calle: string | null; cp: string | null; ciudad: string | null; provincia: string | null; correo: string | null; nifComprobado: boolean }
  localId: string | null
  formaCobroId: string | null
  notas: string | null
  correo: string | null
  retencionId: string | null
  recargo: boolean
  base: number; iva: number; recargoImporte: number; retencion: number; total: number
  entryId: string | null
  pdf: { ruta: string; bytes: number | null } | null
  enviadaEl: string | null
  emitidaEl: string | null
  emitidaPor: string | null
  creadaPor: string | null
  lineas: LineaGuardada[]
  eventos: EventoFactura[]
  cobros: CobroFactura[]
  /** Las rectificativas que la corrigen (su número y si ya están emitidas). */
  rectificativas: { id: string; numero: string | null; estado: string; total: number }[]
}

export async function leerFactura(accountId: string, id: string): Promise<FacturaGuardada | null> {
  const [f] = await leer(tabla('customer_invoice').select('*').eq('account_id', accountId).eq('id', id), 'la factura')
  if (!f) return null
  const [lineas, eventos, cobros, rectif, original] = await Promise.all([
    leer(tabla('customer_invoice_line').select('*').eq('account_id', accountId).eq('invoice_id', id).order('position'), 'sus líneas'),
    leer(tabla('customer_invoice_event').select('at, kind, text, by_name').eq('account_id', accountId).eq('invoice_id', id).order('at', { ascending: false }), 'su historial'),
    leer(tabla('customer_invoice_payment').select('id, paid_on, amount, method, note, created_by_name').eq('account_id', accountId).eq('invoice_id', id).order('paid_on'), 'sus cobros'),
    leer(tabla('customer_invoice').select('id, number_text, status, total').eq('account_id', accountId).eq('corrects_id', id), 'sus rectificativas'),
    f.corrects_id ? leer(tabla('customer_invoice').select('id, number_text').eq('account_id', accountId).eq('id', String(f.corrects_id)), 'la factura que corrige') : Promise.resolve([] as Fila[]),
  ])
  const cli = (f.customer ?? {}) as Fila
  return {
    id: String(f.id), estado: String(f.status) as FacturaGuardada['estado'], rectificativa: f.doc_type === 'rectificativa',
    corrige: f.corrects_id ? { id: String(f.corrects_id), numero: s(original[0]?.number_text), tipo: String(f.correction_kind) as 'importes' | 'anular' | 'datos', motivo: s(f.correction_reason) } : null,
    origen: String(f.origin) as OrigenFactura, serie: String(f.series_code), numero: s(f.number_text), fecha: String(f.issue_date), vence: s(f.due_date),
    clienteId: s(f.party_id),
    cliente: { nombre: s(cli.nombre), nif: s(cli.nif), calle: s(cli.calle), cp: s(cli.cp), ciudad: s(cli.ciudad), provincia: s(cli.provincia), correo: s(cli.correo), nifComprobado: cli.nif_comprobado === true },
    localId: s(f.location_id), formaCobroId: s(f.payment_method_id), notas: s(f.notes), correo: s(f.email_to), retencionId: s(f.withholding_rate_id), recargo: f.surcharge === true,
    base: n(f.base), iva: n(f.tax), recargoImporte: n(f.surcharge_amount), retencion: n(f.withholding_amount), total: n(f.total),
    entryId: s(f.entry_id), pdf: f.pdf_path ? { ruta: String(f.pdf_path), bytes: f.pdf_bytes == null ? null : n(f.pdf_bytes) } : null,
    enviadaEl: s(f.sent_at), emitidaEl: s(f.issued_at), emitidaPor: s(f.issued_by_name), creadaPor: s(f.created_by_name),
    lineas: lineas.map((l) => ({ id: String(l.id), concepto: String(l.concept), cantidad: n(l.quantity), precio: n(l.unit_price), descuento: n(l.discount_pct),
      tipoId: String(l.tax_rate_id), tipo: n(l.tax_pct), recargo: l.surcharge_pct == null ? null : n(l.surcharge_pct), cuentaId: String(l.revenue_account_id), importe: n(l.amount) })),
    eventos: eventos.map((e) => ({ cuando: String(e.at), tipo: String(e.kind), texto: String(e.text), quien: s(e.by_name) })),
    cobros: cobros.map((c) => ({ id: String(c.id), fecha: String(c.paid_on), importe: n(c.amount), forma: s(c.method), nota: s(c.note), quien: s(c.created_by_name) })),
    rectificativas: rectif.map((r) => ({ id: String(r.id), numero: s(r.number_text), estado: String(r.status), total: n(r.total) })),
  }
}

/** Una URL para ver o bajar el PDF (firmada, una hora). */
export async function urlDelPdf(ruta: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from('conta-documentos').createSignedUrl(ruta, 3600)
  if (error) return null
  return data?.signedUrl ?? null
}

// ── Lo que hace falta para escribir una ────────────────────────────────────────

export interface Catalogos {
  clientes: { id: string; nombre: string; nif: string | null; recargo: boolean; retencionId: string | null; formaCobro: string | null; dias: number | null; correo: string | null }[]
  tipos: { id: string; nombre: string; tipo: number; recargo: number | null }[]
  cuentas: { id: string; code: string; nombre: string }[]
  retenciones: { id: string; nombre: string; tipo: number }[]
  formas: { id: string; nombre: string; code: string }[]
}

export async function catalogosFactura(accountId: string, companyId: string): Promise<Catalogos> {
  const [papeles, partes, fiscales, contactos, tipos, cuentas, retenciones, formas] = await Promise.all([
    leer(tabla('party_role').select('party_id, role').eq('account_id', accountId).eq('role', 'customer'), 'los clientes'),
    leer(tabla('party').select('id, name, tax_id, archived_at').eq('account_id', accountId).is('archived_at', null).order('name'), 'los contactos'),
    leer(tabla('customer_fiscal').select('party_id, legal_name, equivalence_surcharge, withholding_rate_id, payment_method, payment_terms_days').eq('account_id', accountId), 'los datos fiscales'),
    // Los clientes no tienen correo en su ficha: se propone el de su última factura.
    leer(tabla('customer_invoice').select('party_id, email_to, created_at').eq('account_id', accountId).eq('company_id', companyId).not('email_to', 'is', null)
      .order('created_at', { ascending: false }), 'los correos de las facturas'),
    leer(tabla('tax_rate').select('id, name, rate, surcharge_rate, treatment, company_id, valid_to').eq('treatment', 'taxed').or(`company_id.is.null,company_id.eq.${companyId}`).order('rate', { ascending: false }), 'los tipos de IVA'),
    leer(tabla('company_account').select('id, code, name, plain_name').eq('company_id', companyId).like('code', '70%').order('code'), 'las cuentas de ventas'),
    leer(tabla('withholding_rate').select('id, name, rate, company_id').or(`company_id.is.null,company_id.eq.${companyId}`).order('rate', { ascending: false }), 'las retenciones'),
    leer(tabla('payment_method').select('id, name, code, company_id, account_id').or(`account_id.is.null,account_id.eq.${accountId}`).order('sort_order'), 'las formas de cobro'),
  ])
  const clientesIds = new Set(papeles.map((p) => String(p.party_id)))
  const fiscal = new Map(fiscales.map((f) => [String(f.party_id), f]))
  const correo = new Map<string, string>()
  for (const c of contactos) if (c.party_id && c.email_to && !correo.has(String(c.party_id))) correo.set(String(c.party_id), String(c.email_to))
  const hoy = new Date().toISOString().slice(0, 10)
  return {
    clientes: partes.filter((p) => clientesIds.has(String(p.id)) || fiscal.has(String(p.id))).map((p) => {
      const f = fiscal.get(String(p.id))
      return { id: String(p.id), nombre: s(f?.legal_name) ?? String(p.name), nif: s(p.tax_id), recargo: f?.equivalence_surcharge === true,
        retencionId: s(f?.withholding_rate_id), formaCobro: s(f?.payment_method), dias: f?.payment_terms_days == null ? null : n(f.payment_terms_days), correo: correo.get(String(p.id)) ?? null }
    }),
    tipos: tipos.filter((t) => !t.valid_to || String(t.valid_to) >= hoy).map((t) => ({ id: String(t.id), nombre: String(t.name), tipo: n(t.rate), recargo: t.surcharge_rate == null ? null : n(t.surcharge_rate) })),
    // Las de ventas: la 700 a la 705 (descuentos, devoluciones y rappels, 706 a 709, no son líneas de una factura).
    cuentas: cuentas.filter((c) => /^70[0-5]/.test(String(c.code))).map((c) => ({ id: String(c.id), code: String(c.code), nombre: s(c.plain_name) ?? String(c.name) })),
    retenciones: retenciones.map((r) => ({ id: String(r.id), nombre: String(r.name), tipo: n(r.rate) })),
    formas: formas.map((f) => ({ id: String(f.id), nombre: String(f.name), code: String(f.code) })),
  }
}

// ── Escribir (solo por las funciones de la base) ───────────────────────────────

export interface DatosBorrador {
  clienteId: string | null
  fecha: string
  vence: string | null
  serie: string
  formaCobroId: string | null
  localId: string | null
  notas: string | null
  correo: string | null
  retencionId: string | null
  recargo: boolean
  motivo?: string | null
}

export async function guardarBorrador(companyId: string, id: string | null, d: DatosBorrador, lineas: readonly { concepto: string; cantidad: number; precio: number; descuento: number; tipoId: string; cuentaId: string }[], quien: string | null) {
  return rpc<{ id: string; nuevo: boolean; total: number; lineas: number }>('conta_venta_guardar', {
    p_company: companyId, p_id: id,
    p_datos: { cliente_id: d.clienteId, fecha: d.fecha, vence: d.vence, serie: d.serie, forma_cobro_id: d.formaCobroId, local_id: d.localId, notas: d.notas,
      correo: d.correo, retencion_id: d.retencionId, recargo: d.recargo, motivo: d.motivo ?? null },
    p_lineas: lineas.map((l) => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento, tipo_id: l.tipoId, cuenta_id: l.cuentaId })),
    p_quien_nombre: quien,
  })
}

export const borrarBorrador = (id: string) => rpc<{ id: string; borrado: boolean; total: number }>('conta_venta_borrar', { p_id: id })

export const emitirFactura = (id: string, quien: string | null) =>
  rpc<{ id: string; numero: string; total: number; asiento: string | null; numero_asiento: number | null }>('conta_venta_emitir', { p_id: id, p_quien_nombre: quien })

export const corregirFactura = (id: string, tipo: 'importes' | 'anular' | 'datos', motivo: string, quien: string | null) =>
  rpc<{ id: string; ya_estaba: boolean; total: number }>('conta_venta_corregir', { p_id: id, p_tipo: tipo, p_motivo: motivo, p_quien_nombre: quien })

export const cobrarFactura = (id: string, fecha: string, importe: number, forma: string | null, nota: string | null, quien: string | null) =>
  rpc<{ id: string; cobrado: number; queda: number }>('conta_venta_cobrar', { p_id: id, p_fecha: fecha, p_importe: importe, p_forma: forma, p_nota: nota, p_quien_nombre: quien })

// ── El PDF, el correo y Diez ──────────────────────────────────────────────────

const BUCKET = 'conta-documentos'

async function hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const direccion = (x: { calle?: string | null; cp?: string | null; ciudad?: string | null; provincia?: string | null }): string | null =>
  [x.calle, [x.cp, x.ciudad].filter(Boolean).join(' '), x.provincia].filter(Boolean).join(', ') || null

/** La empresa, como sale arriba a la izquierda del PDF. */
export async function empresaDelPdf(accountId: string, companyId: string): Promise<DatosFacturaPdf['empresa']> {
  const [emp] = await leer(tabla('company').select('legal_name, trade_name, tax_id, fiscal_street_type, fiscal_street, fiscal_number, fiscal_extra, fiscal_postal_code, fiscal_city, fiscal_province')
    .eq('account_id', accountId).eq('id', companyId), 'los datos de la empresa')
  if (!emp) throw new Error('No he podido leer los datos de la empresa.')
  const calle = [s(emp.fiscal_street_type), s(emp.fiscal_street), s(emp.fiscal_number), s(emp.fiscal_extra)].filter(Boolean).join(' ')
  return {
    nombre: String(s(emp.trade_name) ?? s(emp.legal_name) ?? ''), nif: String(emp.tax_id ?? ''),
    direccion: [calle, [s(emp.fiscal_postal_code), s(emp.fiscal_city)].filter(Boolean).join(' '), s(emp.fiscal_province)].filter(Boolean).join(', ') || null,
  }
}

/** Lo que pinta el PDF, de la factura guardada (las cifras, las de la base). */
export function datosDelPdf(empresa: DatosFacturaPdf['empresa'], f: FacturaGuardada, original: FacturaGuardada | null, formaCobro: string | null): DatosFacturaPdf {
  // Por tipo, como la base (redondeo por tipo). Una rectificativa pinta lo que
  // debía ser, pero sus cifras son la diferencia con la que corrige.
  const deLineas = (ls: readonly LineaGuardada[]) => cifrasDe(ls.map((l) => ({ ...l, recargo: null })), false, 0)
  let porTipo = deLineas(f.lineas).porTipo
  if (f.rectificativa) {
    const vieja = deLineas(original?.lineas ?? [])
    const nueva = f.corrige?.tipo === 'anular' ? deLineas([]) : f.corrige?.tipo === 'datos' ? vieja : deLineas(f.lineas)
    porTipo = diferenciaDe(nueva, vieja).porTipo
  }
  const retPct = f.base === 0 ? 0 : Math.round(f.retencion / f.base * 10000) / 100
  return {
    empresa,
    numero: f.numero ?? '',
    fecha: f.fecha,
    vence: f.vence,
    formaCobro,
    cliente: { nombre: f.cliente.nombre ?? '', nif: f.cliente.nif ?? '', direccion: direccion(f.cliente) },
    lineas: f.lineas.map((l) => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento, tipo: l.tipo, importe: l.importe })),
    porTipo,
    base: f.base, iva: f.iva, recargo: f.recargoImporte,
    retencion: f.retencion ? { pct: retPct, importe: f.retencion } : null,
    total: f.total,
    notas: f.notas,
    rectifica: f.rectificativa && f.corrige ? { numero: f.corrige.numero ?? '', motivo: f.corrige.motivo ?? '', que: f.corrige.tipo === 'anular' ? 'la anula entera' : f.corrige.tipo === 'datos' ? 'corrige los datos del cliente' : 'corrige los importes' } : null,
  }
}

/** El PDF de una emitida: se hace aquí, se sube y se guarda en la factura. Si ya lo tiene, no se rehace. */
export async function guardarPdf(accountId: string, f: FacturaGuardada, datos: DatosFacturaPdf): Promise<{ ruta: string; yaEstaba: boolean }> {
  if (f.pdf) return { ruta: f.pdf.ruta, yaEstaba: true }
  if (!supabase) throw new Error('No hay conexión con la base de datos.')
  const pdf = facturaVentaPdf(jsPDF, datos)
  const sha = await hex(pdf)
  const ruta = `${accountId}/ventas/${f.id}/${sha.slice(0, 16)}.pdf`
  const sub = await supabase.storage.from(BUCKET).upload(ruta, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`No se ha podido subir su PDF (${sub.error.message}).`)
  const g = await rpc<{ ruta: string; ya_estaba: boolean }>('conta_venta_pdf_guardar', { p_id: f.id, p_ruta: ruta, p_sha256: sha, p_bytes: pdf.length })
  return { ruta: g.ruta, yaEstaba: g.ya_estaba }
}

/** El correo al cliente con el PDF (conta-venta-correo). Nunca lanza: dice qué ha pasado. */
export async function enviarPorCorreo(id: string, para: string, quien: string | null): Promise<{ enviado: boolean; texto: string }> {
  if (!supabase) return { enviado: false, texto: 'No se ha mandado: no hay conexión con la base de datos.' }
  const { data, error } = await supabase.functions.invoke('conta-venta-correo', { body: { factura: id, para, quien } })
  if (!error && data && typeof data === 'object' && 'texto' in data) return data as { enviado: boolean; texto: string }
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const b = await ctx.clone().json().catch(() => null) as Fila | null
    if (b?.texto) return { enviado: false, texto: String(b.texto) }
    if (b?.error) return { enviado: false, texto: `No se ha mandado: ${String(b.error)}` }
    if (ctx.status === 404) return { enviado: false, texto: 'No se ha mandado: el envío por correo aún no está publicado en este entorno.' }
  }
  return { enviado: false, texto: `No se ha mandado: ${error?.message ?? 'el envío por correo no ha contestado'}.` }
}
