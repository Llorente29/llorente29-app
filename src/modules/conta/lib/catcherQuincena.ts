// src/modules/conta/lib/catcherQuincena.ts
//
// E05 · La quincena de Catcher: el ZIP de PDF y los dos Excel (FACTURAS y
// PEDIDOS) que da el portal, arrastrados juntos, se convierten en una factura
// recibida por PDF. Núcleo puro: sin red ni base (los bytes entran, el lote
// sale). Lo usan la subida (services/catcherService.ts) y las pruebas.
//
// Lo que se sabe de los ficheros (doc de Julio, 15/10, medido sobre los reales):
//   · ZIP: un PDF por factura, `invoice_<id>_<número>.pdf`; las flotas,
//     `invoice_fleet_…`. Cada PDF lleva el emisor, «Cobrar a» la empresa, la
//     fecha, la base, el IVA del 21 %, el total, «Ejercicio: AAAA-MM-DD –
//     AAAA-MM-DD» y «Pedidos entregados: N». Sin IRPF.
//   · FACTURAS, tres hojas: Invoices (una fila por factura), Amounts By
//     Partners (cuánto de cada rider o flota es de cada tienda) y Commissions
//     By Partners (la comisión de Catcher por tienda).
//   · PEDIDOS, hoja Worksheet: una fila por pedido y factura. El código del
//     pedido se repite (G236): la clave es código + fecha y hora.
// Los importes, el emisor y su NIF/NIE salen del EXCEL, no se leen del PDF con
// IA; el PDF se comprueba contra ellos (comprobarPdf).
//
// Norma, comprobada en cada factura (requisitos):
//   · RD 1619/2012, art. 6: número, fecha de expedición, nombre y NIF del que
//     la expide y del destinatario, sus domicilios, la operación, el tipo, la
//     cuota, la base y la fecha de la operación si no es la de expedición.
//   · Ley 37/1992, art. 97: el IVA soportado solo se deduce con factura válida;
//     por eso, una que no cumple no se propone como segura.

import * as XLSX from 'xlsx'
import { unzipSync } from 'fflate'
import { claveNumero, formaDeNif, normalizarNif } from '../../../../supabase/functions/_shared/lecturaFactura.ts'

// ── Lo que entra y lo que sale ───────────────────────────────────────────────

export type Fichero = { nombre: string; bytes: Uint8Array }
export type Clase = 'zip' | 'facturas' | 'pedidos'
export type TipoFactura = 'rider' | 'flota' | 'catcher'

/** Una fila de la hoja Invoices, con los nombres de Folvy. */
export type FacturaExcel = {
  numero: string
  base: number; cuota: number; total: number
  emisor: { nombre: string; nif: string | null; domicilio: string | null }
  destinatario: { nombre: string; nif: string | null; domicilio: string | null }
  pedidos: number | null
  desde: string | null; hasta: string | null
  fecha: string | null
}
/** Cuánto de una factura es de cada tienda (Amounts By Partners / Commissions By Partners). */
export type PorTienda = { tienda: string; total: number; pedidos: number | null; nif: string | null; nombre: string | null; tipo: string | null }
/** Una fila de PEDIDOS. `momento`: ISO con la hora de Madrid ya pasada a UTC. */
export type PedidoExcel = { factura: string; tipo: string; codigo: string; estado: string; momento: string | null; base: number; cuota: number; total: number }

export type Comprobacion = { id: string; ok: boolean; texto: string }

export type FacturaDelLote = {
  numero: string
  tipo: TipoFactura
  fecha: string | null
  emisor: FacturaExcel['emisor']
  base: number; cuota: number; total: number; tipoIva: number | null
  pedidos: number | null
  periodo: { desde: string | null; hasta: string | null }
  /** El local, si toda la factura es de una tienda conocida; si no, null y `reparto` lo dice. */
  localId: string | null
  reparto: { tienda: string; localId: string | null; total: number }[]
  pdf: { nombre: string; bytes: Uint8Array } | null
  requisitos: Comprobacion[]
  /** Lo del PDF (comprobarPdf); vacío hasta que se lea su texto. */
  contraPdf: Comprobacion[]
}

export type Quincena = {
  desde: string; hasta: string
  /** «2.ª quincena de septiembre de 2026». */
  etiqueta: string
  facturas: FacturaDelLote[]
  pedidos: PedidoExcel[]
  ficheros: { clase: Clase; nombre: string }[]
  /** Lo que impide dar el lote por leído (ficheros que faltan, periodos mezclados…). */
  problemas: string[]
  /** Lo que no cuadra entre ficheros, factura a factura (PDF sin factura, factura sin PDF…). */
  avisos: string[]
  totales: { facturas: number; base: number; cuota: number; total: number; porTipo: Record<TipoFactura, { facturas: number; total: number }> }
}

export class LoteNoValido extends Error {}

// ── Utilidades ───────────────────────────────────────────────────────────────

const c = (x: number) => Math.round(x * 100)
const e = (x: number) => x / 100
/** Una cabecera, para compararla: minúsculas, sin acentos ni separadores. */
const cab = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const txt = (x: unknown) => { const s = String(x ?? '').trim(); return s === '' ? null : s }
/** Un importe del Excel: número, o texto con coma o punto decimal. */
export function importe(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  const s = String(x ?? '').trim().replace(/\s|€/g, '')
  if (!s) return null
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
/** El tipo de IVA que da esa cuota sobre esa base, al céntimo (21, 10, 5, 4 o 0); null si ninguno. */
export const tipoIvaDe = (base: number, cuota: number): number | null => [21, 10, 5, 4, 0].find((t) => c(cuota) === Math.round((c(base) * t) / 100)) ?? null
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El desfase de Madrid (en minutos) en un instante UTC. */
function desfaseMadrid(utc: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utc)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]))
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utc) / 60000
}
/** Una hora de pared de Madrid → ISO en UTC (regla 4: sold_at está en UTC). */
export function madridAUtc(a: number, m: number, d: number, h = 0, mi = 0, s = 0): string {
  const pared = Date.UTC(a, m - 1, d, h, mi, s)
  let utc = pared - desfaseMadrid(pared) * 60000
  utc = pared - desfaseMadrid(utc) * 60000
  return new Date(utc).toISOString()
}

/** Una fecha (y hora) del Excel → { dia: AAAA-MM-DD, utc } con la hora de Madrid. */
export function fechaExcel(x: unknown): { dia: string; utc: string } | null {
  let a: number, m: number, d: number, h: number, mi: number, s: number
  if (typeof x === 'number' && Number.isFinite(x)) {
    // Número de serie de Excel: días desde el 30/12/1899, hora de pared.
    const ms = Math.round((x - 25569) * 864e5)
    const t = new Date(ms)
    ;[a, m, d, h, mi, s] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()]
  } else {
    const v = String(x ?? '').trim()
    let r = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (r) [a, m, d, h, mi, s] = [+r[1], +r[2], +r[3], +(r[4] ?? 0), +(r[5] ?? 0), +(r[6] ?? 0)]
    else if ((r = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) [d, m, a, h, mi, s] = [+r[1], +r[2], +r[3], +(r[4] ?? 0), +(r[5] ?? 0), +(r[6] ?? 0)]
    else return null
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { dia: `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, utc: madridAUtc(a, m, d, h, mi, s) }
}

/** Las filas de una hoja como objetos con la cabecera normalizada (cab). */
function filas(hoja: XLSX.WorkSheet | undefined): Record<string, unknown>[] {
  if (!hoja) return []
  const crudas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][]
  const i = crudas.findIndex((r) => r.some((x) => txt(x) !== null))
  if (i < 0) return []
  const nombres = crudas[i].map(cab)
  return crudas.slice(i + 1).filter((r) => r.some((x) => txt(x) !== null))
    .map((r) => Object.fromEntries(nombres.map((n, j) => [n, r[j] ?? null])))
}
const hojaPor = (wb: XLSX.WorkBook, nombre: string) => wb.Sheets[wb.SheetNames.find((h) => cab(h) === cab(nombre)) ?? '']
const tieneHojas = (wb: XLSX.WorkBook, ...hs: string[]) => hs.every((h) => wb.SheetNames.some((x) => cab(x) === cab(h)))

// ── 1 · Qué es cada fichero ──────────────────────────────────────────────────

const esZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/** El libro de un Excel, o null si no lo es. Un .xlsx también empieza por PK: se mira dentro. */
function libro(f: Fichero): XLSX.WorkBook | null {
  if (!/\.(xlsx|xls)$/i.test(f.nombre)) return null
  try { return XLSX.read(f.bytes, { type: 'array', cellDates: false }) } catch { return null }
}

/**
 * Reconoce los tres ficheros por lo que llevan dentro (no por cómo se llaman):
 * el ZIP con PDF, el Excel con la hoja Invoices y el Excel con la hoja
 * Worksheet de pedidos. Lanza si falta alguno o sobra algo.
 */
export function reconocer(ficheros: Fichero[]): { zip: Fichero; facturas: XLSX.WorkBook; pedidos: XLSX.WorkBook; clases: { clase: Clase; nombre: string }[] } {
  let zip: Fichero | null = null, facturas: XLSX.WorkBook | null = null, pedidos: XLSX.WorkBook | null = null
  const clases: { clase: Clase; nombre: string }[] = []
  const sobran: string[] = []
  for (const f of ficheros) {
    const wb = libro(f)
    if (wb && tieneHojas(wb, 'Invoices')) { if (facturas) throw new LoteNoValido('Hay dos Excel de FACTURAS: sube los de una sola quincena.'); facturas = wb; clases.push({ clase: 'facturas', nombre: f.nombre }); continue }
    if (wb && filas(hojaPor(wb, 'Worksheet')).some((r) => 'ordercode' in r)) { if (pedidos) throw new LoteNoValido('Hay dos Excel de PEDIDOS: sube los de una sola quincena.'); pedidos = wb; clases.push({ clase: 'pedidos', nombre: f.nombre }); continue }
    if (!wb && esZip(f.bytes)) { if (zip) throw new LoteNoValido('Hay dos ZIP: sube el de una sola quincena.'); zip = f; clases.push({ clase: 'zip', nombre: f.nombre }); continue }
    sobran.push(f.nombre)
  }
  const faltan = [!zip && 'el ZIP de las facturas en PDF', !facturas && 'el Excel de FACTURAS', !pedidos && 'el Excel de PEDIDOS'].filter(Boolean)
  if (faltan.length) throw new LoteNoValido(`Falta ${faltan.join(', ')}${sobran.length ? ` (y no sé qué es ${sobran.join(', ')})` : ''}.`)
  if (sobran.length) throw new LoteNoValido(`No sé qué es ${sobran.join(', ')}: sube solo el ZIP y los dos Excel de la quincena.`)
  return { zip: zip!, facturas: facturas!, pedidos: pedidos!, clases }
}

// ── 2 · Lo que dice cada fichero ─────────────────────────────────────────────

export function leerFacturas(wb: XLSX.WorkBook): { facturas: FacturaExcel[]; porRider: PorTienda[]; comisiones: PorTienda[] } {
  const dom = (r: Record<string, unknown>, p: string) => [txt(r[`${p}location`]), [txt(r[`${p}cp`]), txt(r[`${p}city`])].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
  const facturas = filas(hojaPor(wb, 'Invoices')).map((r): FacturaExcel => {
    const numero = txt(r.number)
    if (!numero) throw new LoteNoValido('Una fila de Invoices no tiene número de factura.')
    const base = importe(r.amount), cuota = importe(r.vat), total = importe(r.total)
    if (base == null || cuota == null || total == null) throw new LoteNoValido(`La factura ${numero} no trae base, IVA o total en el Excel.`)
    return {
      numero, base, cuota, total,
      emisor: { nombre: txt(r.fromname) ?? '', nif: normalizarNif(txt(r.fromcif)), domicilio: dom(r, 'from') },
      destinatario: { nombre: txt(r.toname) ?? '', nif: normalizarNif(txt(r.tocif)), domicilio: dom(r, 'to') },
      pedidos: importe(r.totalorders),
      desde: fechaExcel(r.datefrom)?.dia ?? null, hasta: fechaExcel(r.dateto)?.dia ?? null,
      fecha: fechaExcel(r.dateissue)?.dia ?? null,
    }
  })
  const porTienda = (r: Record<string, unknown>): PorTienda => ({
    tienda: txt(r.name) ?? '', total: importe(r.total) ?? 0, pedidos: importe(r.totalorders),
    nif: normalizarNif(txt(r.riderdni) ?? txt(r.cif) ?? txt(r.socialcif)), nombre: txt(r.ridername) ?? txt(r.socialname), tipo: txt(r.type),
  })
  return { facturas, porRider: filas(hojaPor(wb, 'Amounts By Partners')).map(porTienda), comisiones: filas(hojaPor(wb, 'Commissions By Partners')).map(porTienda) }
}

export function leerPedidos(wb: XLSX.WorkBook): PedidoExcel[] {
  return filas(hojaPor(wb, 'Worksheet')).map((r) => ({
    factura: txt(r.invoicenumber) ?? '', tipo: (txt(r.type) ?? '').toLowerCase(), codigo: txt(r.ordercode) ?? '',
    estado: (txt(r.orderstatus) ?? '').toLowerCase(), momento: fechaExcel(r.orderdate)?.utc ?? null,
    base: importe(r.amount) ?? 0, cuota: importe(r.vat) ?? 0, total: importe(r.total) ?? 0,
  }))
}

/** Los PDF del ZIP (sin carpetas ni ficheros del sistema). */
export function pdfsDelZip(zip: Fichero): { nombre: string; bytes: Uint8Array }[] {
  let dentro: Record<string, Uint8Array>
  try { dentro = unzipSync(zip.bytes) } catch { throw new LoteNoValido(`No he podido abrir ${zip.nombre} como ZIP.`) }
  return Object.entries(dentro)
    .filter(([n, b]) => b.length > 0 && /\.pdf$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n))
    .map(([n, b]) => ({ nombre: n.split('/').pop()!, bytes: b }))
}

// ── 3 · Qué factura es cada una ──────────────────────────────────────────────

const CATCHER = /catcher/i
/** El tipo: la comisión de Catcher (por su nombre o por sus pedidos «pitcher commissions»), la flota (su PDF o su NIF de empresa) o un rider. */
export function tipoDe(f: FacturaExcel, pdf: string | null, pedidos: PedidoExcel[]): TipoFactura {
  if (CATCHER.test(f.emisor.nombre) || pedidos.some((p) => p.factura === f.numero && /commission/.test(p.tipo))) return 'catcher'
  if ((pdf && /^invoice_fleet_/i.test(pdf)) || /^[ABCDEFGHJNPQRSUVW]/.test(f.emisor.nif ?? '')) return 'flota'
  return 'rider'
}

/** El PDF de cada factura: el nombre del fichero termina en su número (con la clave de conta_clave_numero). */
export function casarPdfs(facturas: FacturaExcel[], pdfs: { nombre: string; bytes: Uint8Array }[]) {
  const deFactura = new Map<string, { nombre: string; bytes: Uint8Array }>()
  const sinFactura: string[] = []
  const usados = new Set<string>()
  for (const p of pdfs) {
    const k = claveNumero(p.nombre.replace(/\.pdf$/i, '')) ?? ''
    const suyas = facturas.filter((f) => { const n = claveNumero(f.numero); return !!n && k.endsWith(n) })
    // Si dos números encajan (uno acaba en el otro), el más largo.
    const f = suyas.sort((a, b) => (claveNumero(b.numero)?.length ?? 0) - (claveNumero(a.numero)?.length ?? 0))[0]
    if (!f || usados.has(f.numero)) { sinFactura.push(p.nombre); continue }
    usados.add(f.numero); deFactura.set(f.numero, p)
  }
  return { deFactura, sinFactura, sinPdf: facturas.filter((f) => !deFactura.has(f.numero)).map((f) => f.numero) }
}

/** Cuánto de la factura es de cada tienda: los riders y flotas por su NIF (o el nombre de la flota); Catcher, sus comisiones. */
export function repartoDe(f: FacturaExcel, tipo: TipoFactura, porRider: PorTienda[], comisiones: PorTienda[]): { tienda: string; total: number }[] {
  const nombre = cab(f.emisor.nombre)
  const filasDe = tipo === 'catcher' ? comisiones
    : porRider.filter((r) => (f.emisor.nif && r.nif === f.emisor.nif) || (tipo === 'flota' && nombre && cab(r.nombre) === nombre))
  const t = new Map<string, number>()
  for (const r of filasDe) if (r.tienda) t.set(r.tienda, (t.get(r.tienda) ?? 0) + c(r.total))
  return [...t].map(([tienda, x]) => ({ tienda, total: e(x) })).sort((a, b) => b.total - a.total || a.tienda.localeCompare(b.tienda))
}

// ── 4 · La norma (RD 1619/2012, art. 6) ──────────────────────────────────────

/**
 * Lo que pide el art. 6 a una factura completa, mirado en lo que trae el Excel.
 * `destinatario`: la empresa que la recibe (su NIF, para ver que es a ella).
 */
export function requisitos(f: FacturaExcel, destinatario: { nif: string | null }): Comprobacion[] {
  const tipo = tipoIvaDe(f.base, f.cuota)
  const r: Comprobacion[] = [
    { id: 'numero', ok: !!claveNumero(f.numero), texto: 'Número de factura (art. 6.1.a).' },
    { id: 'fecha', ok: !!f.fecha, texto: 'Fecha de expedición (art. 6.1.b).' },
    { id: 'emisor', ok: !!f.emisor.nombre, texto: 'Nombre de quien la expide (art. 6.1.c).' },
    { id: 'emisor_nif', ok: formaDeNif(f.emisor.nif), texto: 'NIF o NIE de quien la expide, con forma válida (art. 6.1.d).' },
    { id: 'destinatario', ok: !!f.destinatario.nombre && !!f.destinatario.nif, texto: 'Nombre y NIF del destinatario (art. 6.1.c y d).' },
    { id: 'es_a_la_empresa', ok: !!destinatario.nif && f.destinatario.nif === normalizarNif(destinatario.nif), texto: 'Está a nombre de esta empresa (su NIF).' },
    { id: 'domicilios', ok: !!f.emisor.domicilio && !!f.destinatario.domicilio, texto: 'Domicilio de los dos (art. 6.1.e).' },
    { id: 'periodo', ok: !!f.desde && !!f.hasta, texto: 'Fecha de las operaciones, si no es la de expedición: el ejercicio (art. 6.1.g).' },
    { id: 'tipo', ok: tipo === 21, texto: 'Tipo de IVA aplicado (art. 6.1.h): el 21 %.' },
    { id: 'cuota', ok: c(f.cuota) === Math.round(c(f.base) * 0.21), texto: 'Cuota de IVA: el 21 % de la base (art. 6.1.i).' },
    { id: 'total', ok: c(f.base) + c(f.cuota) === c(f.total), texto: 'Base + IVA = total.' },
  ]
  return r
}

// ── 5 · El PDF contra el Excel ───────────────────────────────────────────────

/** Las formas en que un importe puede salir escrito en el PDF: 1.062,25 · 1062,25 · 1062.25 · 1,062.25. */
function formasImporte(x: number): string[] {
  // eslint-disable-next-line no-restricted-syntax -- x es un importe del Excel ya convertido a número (importe()), nunca null.
  const [ent, dec] = Math.abs(x).toFixed(2).split('.')
  const miles = (sep: string) => ent.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  const signo = x < 0 ? '-' : ''
  return [...new Set([`${miles('.')},${dec}`, `${ent},${dec}`, `${ent}.${dec}`, `${miles(',')}.${dec}`])].map((s) => signo + s)
}
const plano = (s: string) => s.replace(/\s+/g, '')
const fechas = (iso: string | null) => {
  if (!iso) return []
  const [a, m, d] = iso.split('-')
  return [iso, `${d}/${m}/${a}`, `${d}-${m}-${a}`, `${+d}/${+m}/${a}`]
}

/** Lo que el PDF tiene que decir, comparado con lo que dice el Excel. `texto`: el del PDF (pdfjs). */
export function comprobarPdf(f: FacturaExcel, texto: string): Comprobacion[] {
  const t = plano(texto)
  const T = t.toUpperCase()
  const hay = (xs: string[]) => xs.some((x) => t.includes(plano(x)))
  const nif = f.emisor.nif
  return [
    { id: 'pdf_numero', ok: !!claveNumero(f.numero) && (claveNumero(texto) ?? '').includes(claveNumero(f.numero)!), texto: 'El PDF lleva el número de la factura.' },
    { id: 'pdf_nif', ok: !!nif && (T.replace(/[^A-Z0-9]/g, '').includes(nif)), texto: 'El PDF lleva el NIF o NIE del emisor.' },
    { id: 'pdf_base', ok: hay(formasImporte(f.base)), texto: 'La base del PDF es la del Excel.' },
    { id: 'pdf_cuota', ok: hay(formasImporte(f.cuota)), texto: 'El IVA del PDF es el del Excel.' },
    { id: 'pdf_total', ok: hay(formasImporte(f.total)), texto: 'El total del PDF es el del Excel.' },
    { id: 'pdf_fecha', ok: hay(fechas(f.fecha)), texto: 'La fecha del PDF es la del Excel.' },
    { id: 'pdf_ejercicio', ok: hay(fechas(f.desde)) && hay(fechas(f.hasta)), texto: 'El ejercicio del PDF es el del Excel.' },
    { id: 'pdf_pedidos', ok: f.pedidos == null || new RegExp(`PEDIDOSENTREGADOS:?${f.pedidos}(?!\\d)`).test(T), texto: 'Los pedidos entregados del PDF son los del Excel.' },
  ]
}

// ── 6 · El lote ──────────────────────────────────────────────────────────────

/** «1.ª quincena de septiembre de 2026» (del 1 al 15) o «2.ª …» (del 16 al final). */
export function etiquetaQuincena(desde: string): string {
  const [a, m, d] = desde.split('-').map(Number)
  return `${d <= 15 ? '1.ª' : '2.ª'} quincena de ${MESES[m - 1]} de ${a}`
}

/**
 * Los tres ficheros → la quincena. `tiendas`: la tienda de Catcher → el local
 * (supplier_batch_store); `empresa`: el NIF de la empresa que las recibe.
 * Lo que falta o no cuadra no se inventa: va a `problemas` (para el lote) o a
 * `avisos` (para una factura).
 */
export function leerQuincena(ficheros: Fichero[], o: { tiendas: Record<string, string>; empresa: { nif: string | null } }): Quincena {
  const r = reconocer(ficheros)
  const { facturas, porRider, comisiones } = leerFacturas(r.facturas)
  const pedidos = leerPedidos(r.pedidos)
  const pdfs = pdfsDelZip(r.zip)
  if (!facturas.length) throw new LoteNoValido('El Excel de FACTURAS no tiene ninguna factura.')
  const problemas: string[] = []
  const avisos: string[] = []

  const periodos = [...new Set(facturas.map((f) => `${f.desde ?? '?'}|${f.hasta ?? '?'}`))]
  if (periodos.length > 1) problemas.push(`Las facturas son de ${periodos.length} periodos distintos: sube una quincena cada vez.`)
  const [desde, hasta] = periodos[0].split('|')
  if (desde === '?' || hasta === '?') problemas.push('Hay facturas sin el periodo (date_from / date_to).')
  const enPedidos = new Set(pedidos.map((p) => p.factura))
  for (const n of [...enPedidos].filter((n) => n && !facturas.some((f) => f.numero === n))) avisos.push(`PEDIDOS trae pedidos de la factura ${n}, que no está en FACTURAS.`)

  const casado = casarPdfs(facturas, pdfs)
  for (const n of casado.sinFactura) avisos.push(`El PDF ${n} no es de ninguna factura del Excel.`)
  for (const n of casado.sinPdf) avisos.push(`La factura ${n} no tiene su PDF en el ZIP.`)

  const deLote = facturas.map((f): FacturaDelLote => {
    const pdf = casado.deFactura.get(f.numero) ?? null
    const tipo = tipoDe(f, pdf?.nombre ?? null, pedidos)
    const rep = repartoDe(f, tipo, porRider, comisiones).map((x) => ({ ...x, localId: o.tiendas[x.tienda] ?? null }))
    for (const x of rep.filter((x) => !x.localId)) avisos.push(`La tienda «${x.tienda}» de la factura ${f.numero} no tiene local.`)
    const locales = [...new Set(rep.map((x) => x.localId))]
    return {
      numero: f.numero, tipo, fecha: f.fecha, emisor: f.emisor, base: f.base, cuota: f.cuota, total: f.total,
      tipoIva: tipoIvaDe(f.base, f.cuota), pedidos: f.pedidos,
      periodo: { desde: f.desde, hasta: f.hasta },
      localId: locales.length === 1 ? locales[0] : null, reparto: rep, pdf,
      requisitos: requisitos(f, o.empresa), contraPdf: [],
    }
  })

  const suma = (xs: FacturaDelLote[], k: 'base' | 'cuota' | 'total') => e(xs.reduce((t, f) => t + c(f[k]), 0))
  const porTipo = Object.fromEntries((['rider', 'flota', 'catcher'] as TipoFactura[]).map((t) => {
    const xs = deLote.filter((f) => f.tipo === t)
    return [t, { facturas: xs.length, total: suma(xs, 'total') }]
  })) as Quincena['totales']['porTipo']
  return {
    desde, hasta, etiqueta: desde && desde !== '?' ? etiquetaQuincena(desde) : 'quincena sin fecha',
    facturas: deLote, pedidos, ficheros: r.clases, problemas, avisos,
    totales: { facturas: deLote.length, base: suma(deLote, 'base'), cuota: suma(deLote, 'cuota'), total: suma(deLote, 'total'), porTipo },
  }
}

/** La confianza de una factura: segura si cumple la norma y su PDF dice lo mismo que el Excel. */
export function confianzaDe(f: FacturaDelLote): 'seguro' | 'duda' {
  return f.pdf && f.requisitos.every((x) => x.ok) && f.contraPdf.length > 0 && f.contraPdf.every((x) => x.ok) && f.localId ? 'seguro' : 'duda'
}

/** El resumen de una línea: «2.ª quincena de septiembre de 2026 · 58 facturas · 1.062,25 €». */
export function resumen(q: Quincena): string {
  const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(q.totales.total)
  return `${q.etiqueta} · ${q.totales.facturas} ${q.totales.facturas === 1 ? 'factura' : 'facturas'} · ${eur}`
}

// ── 7 · Lo que se manda a la base (conta_lote_registrar) ─────────────────────

/** Una factura lista para la base: su PDF ya subido (ruta y huella). */
export type PdfSubido = { ruta: string; nombre: string; sha256: string; bytes: number }

/**
 * El lote tal como lo pide conta_lote_registrar. `pdfs`: número de factura →
 * su PDF ya subido. Los bytes no viajan: van en el almacén.
 */
export function loteParaRegistrar(q: Quincena, pdfs: Record<string, PdfSubido>, huellas: { clase: Clase; nombre: string; sha256: string; bytes: number }[]) {
  return {
    proveedor: 'catcher', desde: q.desde, hasta: q.hasta, etiqueta: q.etiqueta,
    ficheros: huellas, avisos: q.avisos,
    facturas: q.facturas.map((f) => ({
      numero: f.numero, tipo: f.tipo, fecha: f.fecha, emisor: f.emisor,
      base: f.base, cuota: f.cuota, total: f.total, tipoIva: f.tipoIva, pedidos: f.pedidos, periodo: f.periodo,
      localId: f.localId, reparto: f.reparto, requisitos: f.requisitos, contraPdf: f.contraPdf,
      confianza: confianzaDe(f), pdf: pdfs[f.numero] ?? null,
    })),
    pedidos: q.pedidos,
  }
}
