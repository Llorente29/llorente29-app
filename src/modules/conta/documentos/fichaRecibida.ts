// src/modules/conta/documentos/fichaRecibida.ts
//
// La ficha de la factura recibida, completa (encargo «Para D · la ficha de la
// recibida completa», tablero 3b): lo que la pantalla decide, sin React ni
// red. Se prueba contra recibidas reales de Foodint (regla 31) en
// tests/unit/modules/conta/s02/ficha-recibida.test.ts.
//
//   · El BORRADOR: lo que se edita antes de validar (proveedor, número y fecha;
//     los importes por tipo de IVA, la retención y el recargo; a qué gasto va,
//     con su local; el pago; el PDF). Es la copia de useCambiosSinGuardar:
//     nada se guarda solo.
//   · Los importes por tipo: de supplier_invoice_tax si los hay; si no, de sus
//     líneas agrupadas por su IVA (la COHELDI P26 4.980 no tiene filas de
//     impuesto: el 4 % y el 10 % están en sus tres líneas, y por eso salía
//     «Tipo de IVA: —»). La cuota de cada tipo, con la regla del asiento
//     (cuotaIva sobre la suma de las líneas al céntimo).
//   · Base, IVA y total, contra el PDF: «Igual que el PDF» o la diferencia.
//   · El asiento rehecho al momento, como vista previa: debe arriba (gasto,
//     IVA por tipo, recargo), haber debajo (retención, proveedor), con las
//     cuentas de la propuesta que ya existe (verPropuestaFactura).
//   · Qué se puede guardar hoy y con qué, y qué no (regla 8: «Guardar
//     cambios» dice con contenido lo que no ha podido guardar y por qué).
//   · De dónde vino y su historial, de lo que la base ya guarda (sin inventar).

import { cent, cuotaIva, deCent } from '@/modules/conta/lib/libro'
import { leerImporteEs } from '@/modules/conta/lib/recibidaAMano'
import { eurosExactos, porcentaje } from '@/modules/conta/lib/formato'
import { diaMesMadrid } from '@/modules/conta/lib/ivaPresentado'
import { plantillaDevolucion } from '@/modules/conta/lib/asientosPropuestos'

// ── El borrador ──────────────────────────────────────────────────────────────

/** Una línea de IVA: los importes como se escriben («127,40»); el tipo, como el selector («4»). */
export interface LineaIva { base: string; tipo: string; cuota: string }
/** Una línea de gasto: la cuenta (código), el local (id, o '' común) y el importe; '' = lo que falte hasta la base. */
export interface LineaGasto { cuenta: string; local: string; importe: string }
/** Retención (IRPF) o recargo de equivalencia: su tipo y su importe. */
export interface Adicional { tipo: string; importe: string }

export type FormaPago = '' | 'transfer' | 'direct_debit' | 'card' | 'cash' | 'prepaid' | 'compensation'
export const FORMAS_PAGO: { valor: FormaPago; texto: string }[] = [
  { valor: '', texto: 'Sin decir' },
  { valor: 'transfer', texto: 'Transferencia' },
  { valor: 'direct_debit', texto: 'Domiciliación' },
  { valor: 'card', texto: 'Tarjeta' },
  { valor: 'cash', texto: 'Efectivo' },
  // D06 · Riders: se paga del saldo prepago de Catcher (la 40700001), sin vencimiento que esperar.
  { valor: 'prepaid', texto: 'Saldo prepago Catcher (40700001)' },
  // S01i · Las comisiones de las plataformas: se descuentan de lo que te paga la liquidación, no pasan por el banco.
  { valor: 'compensation', texto: 'Compensación con la liquidación' },
]
export const ESTADOS_PAGO: { valor: string; texto: string }[] = [
  { valor: 'sin_pagar', texto: 'Sin pagar' },
  { valor: 'pagada', texto: 'Pagada' },
]

/** Lo que se edita. Un `type` (no interface) para que valga como registro de useCambiosSinGuardar. */
export type BorradorFicha = {
  proveedorId: string
  numero: string
  /** AAAA-MM-DD. */
  fecha: string
  iva: LineaIva[]
  retencion: Adicional | null
  recargo: Adicional | null
  gastos: LineaGasto[]
  formaPago: string
  /** AAAA-MM-DD, o ''. */
  vence: string
  estadoPago: string
  /** El nombre del PDF o la foto nueva que se ha elegido ('' = ninguno). */
  documento: string
  sinPdf: boolean
  motivoSinPdf: string
  /** «Editar el asiento a mano»: la cuenta que se pone en lugar de la propuesta (código propuesto → código elegido). */
  aMano: Record<string, string>
}

export type CampoFicha = keyof BorradorFicha

/** Los rótulos, en el orden del formulario (el de la barra «N cambios sin guardar»). */
export const ETIQUETAS: Record<CampoFicha, string> = {
  proveedorId: 'Proveedor',
  numero: 'Nº de factura',
  fecha: 'Fecha',
  iva: 'Importes por tipo de IVA',
  retencion: 'Retención (IRPF)',
  recargo: 'Recargo de equivalencia',
  gastos: 'A qué gasto va',
  formaPago: 'Forma de pago',
  vence: 'Vence',
  estadoPago: 'Estado del pago',
  documento: 'PDF',
  sinPdf: 'Sin PDF',
  motivoSinPdf: 'Motivo de «Sin PDF»',
  aMano: 'El asiento, a mano',
}

// useGrouping 'always': en es-ES, sin él, cuatro cifras no llevan punto («1283,15») y el total sí («1.411,47 €»).
const num2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
/** Un importe como se escribe en el campo: «1.234,56». */
export const importeEs = (n: number): string => num2.format(n)
/** dd/mm/aaaa. */
export const fechaEs = (iso: string | null | undefined): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** Un tipo de IVA como se lee: «4 %», «Sin IVA (0 %)», «—». */
export function textoTipo(tipo: string | number | null): string {
  if (tipo === null || tipo === '') return '—'
  const n = Number(tipo)
  if (!Number.isFinite(n)) return '—'
  return n === 0 ? 'Sin IVA (0 %)' : porcentaje(n)
}

// ── Los importes por tipo, de lo que hay guardado ───────────────────────────

export interface FacturaParaTipos {
  /** supplier_invoice_tax, si la factura los tiene. */
  tipos: readonly { tipo: number; base: number; cuota: number; recargo: number | null }[]
  /** supplier_invoice_line. */
  lineas: readonly { importe: number | null; iva: number | null }[]
  base: number | null
  cuota: number | null
}

export interface TipoDeFactura { tipo: number | null; base: number; cuota: number }

/**
 * Los importes por tipo de IVA de una factura guardada, de menor a mayor tipo:
 *   1. los de supplier_invoice_tax, tal cual (las liquidaciones y los lotes);
 *   2. si no, los de sus líneas agrupadas por su IVA, con la regla del asiento
 *      (cada línea al céntimo, la cuota sobre la suma): la COHELDI;
 *   3. si las líneas no dicen su IVA, un solo tipo sin saber cuál, con la base
 *      y la cuota de la cabecera (y el tipo, si sale exacto de ellas).
 */
export function tiposDeFactura(f: FacturaParaTipos): TipoDeFactura[] {
  if (f.tipos.length > 0) return [...f.tipos].map((t) => ({ tipo: Number(t.tipo), base: Number(t.base), cuota: Number(t.cuota) })).sort((a, b) => (a.tipo ?? 0) - (b.tipo ?? 0))
  const conImporte = f.lineas.filter((l) => l.importe !== null && Number.isFinite(Number(l.importe)))
  if (conImporte.length > 0 && conImporte.every((l) => l.iva !== null && Number.isFinite(Number(l.iva)))) {
    const por = new Map<number, number>()
    for (const l of conImporte) por.set(Number(l.iva), (por.get(Number(l.iva)) ?? 0) + cent(Number(l.importe)))
    return [...por.entries()].sort((a, b) => a[0] - b[0]).map(([tipo, c]) => ({ tipo, base: deCent(c), cuota: cuotaIva(deCent(c), tipo) }))
  }
  if (f.base === null) return []
  const cuota = f.cuota ?? 0
  // El tipo, solo si sale exacto: una cuota que es la base por un tipo de los de siempre.
  const tipo = [21, 10, 5, 4, 2, 0].find((t) => cent(cuotaIva(f.base!, t)) === cent(cuota)) ?? null
  return [{ tipo, base: f.base, cuota }]
}

// ── El borrador de una factura guardada ─────────────────────────────────────

export interface DatosParaBorrador extends FacturaParaTipos {
  proveedorId: string | null
  numero: string | null
  fecha: string | null
  vence: string | null
  retencion: number | null
  recargo: number | null
  /** La cuenta de gasto propuesta (la de la propuesta o la de sus facturas). */
  gasto: string | null
  /** El local guardado (location_id) o, sin él, el de su recepción. */
  local: string | null
  formaPago: string | null
  pagada: boolean
  /** El gasto repartido guardado (supplier_invoice_expense, 0790): manda sobre `gasto` y `local`. */
  reparto?: readonly { cuenta: string; local: string | null; importe: number }[] | null
  /** «Sin PDF» guardado (no_document_*, 0790). */
  sinPdf?: { motivo: string | null } | null
  /** El asiento a mano guardado, ya como borrador (aManoDeLoGuardado). */
  aMano?: Record<string, string>
}

/** Lo guardado, como borrador: el «Antes» de cada campo. */
export function borradorDe(d: DatosParaBorrador): BorradorFicha {
  const tipos = tiposDeFactura(d)
  const base = tipos.reduce((t, x) => t + cent(x.base), 0)
  return {
    proveedorId: d.proveedorId ?? '',
    numero: d.numero ?? '',
    fecha: d.fecha ?? '',
    iva: tipos.map((t) => ({ base: importeEs(t.base), tipo: t.tipo === null ? '' : String(t.tipo), cuota: importeEs(t.cuota) })),
    retencion: d.retencion ? { tipo: tipoDeRetencion(deCent(base), d.retencion), importe: importeEs(Math.abs(d.retencion)) } : null,
    recargo: d.recargo ? { tipo: '', importe: importeEs(d.recargo) } : null,
    gastos: d.reparto && d.reparto.length > 0
      ? d.reparto.map((g) => ({ cuenta: g.cuenta, local: g.local ?? '', importe: d.reparto!.length === 1 ? '' : importeEs(g.importe) }))
      : [{ cuenta: d.gasto ?? '', local: d.local ?? '', importe: '' }],
    formaPago: d.formaPago ?? '',
    vence: d.vence ?? '',
    estadoPago: d.pagada ? 'pagada' : 'sin_pagar',
    documento: '',
    sinPdf: !!d.sinPdf,
    motivoSinPdf: d.sinPdf?.motivo ?? '',
    aMano: d.aMano ?? {},
  }
}

/** Los tipos de retención de siempre (IRPF): si el importe es uno de ellos sobre la base, ese. */
export const TIPOS_RETENCION = [15, 7, 19, 1] as const
function tipoDeRetencion(base: number, importe: number): string {
  const t = TIPOS_RETENCION.find((x) => cent(cuotaIva(base, x)) === cent(Math.abs(importe)))
  return t === undefined ? '' : String(t)
}

/** Una línea de IVA nueva o tocada: la cuota se rehace con la base y el tipo. */
export function rehacerCuota(l: LineaIva): LineaIva {
  const base = leerImporteEs(l.base)
  const tipo = l.tipo === '' ? null : Number(l.tipo)
  if (base === null || tipo === null || !Number.isFinite(tipo)) return l
  return { ...l, cuota: importeEs(cuotaIva(base, tipo)) }
}

/** «+ Otro tipo de IVA»: el primero de los de siempre que aún no está. */
export function otroTipo(iva: readonly LineaIva[], tipos: readonly number[] = [21, 10, 4, 0]): LineaIva {
  const usados = new Set(iva.map((l) => l.tipo))
  const t = tipos.find((x) => !usados.has(String(x)))
  return { base: '', tipo: t === undefined ? '' : String(t), cuota: '' }
}

// ── Los totales y el PDF ─────────────────────────────────────────────────────

export interface Totales {
  base: number
  iva: number
  recargo: number
  retencion: number
  total: number
  /** Lo que no se ha podido leer como importe («La base del 10 %»). */
  malEscrito: string[]
}

/** Base, IVA y total del borrador, al céntimo. */
export function totalesDe(b: Pick<BorradorFicha, 'iva' | 'retencion' | 'recargo'>): Totales {
  const mal: string[] = []
  let base = 0, iva = 0
  for (const l of b.iva) {
    const x = leerImporteEs(l.base); const c = leerImporteEs(l.cuota)
    const de = l.tipo === '' ? '' : ` del ${textoTipo(l.tipo)}`
    if (x === null) mal.push(`la base${de}`); else base += cent(x)
    if (c === null && l.cuota.trim() !== '') mal.push(`la cuota${de}`); else if (c !== null) iva += cent(c)
  }
  const rec = b.recargo ? leerImporteEs(b.recargo.importe) : 0
  if (rec === null) mal.push('el recargo')
  const ret = b.retencion ? leerImporteEs(b.retencion.importe) : 0
  if (ret === null) mal.push('la retención')
  const r = cent(rec ?? 0), t = cent(Math.abs(ret ?? 0))
  return { base: deCent(base), iva: deCent(iva), recargo: deCent(r), retencion: deCent(t), total: deCent(base + iva + r - t), malEscrito: mal }
}

/** Lo que dice el PDF (lo leído o escrito en la cabecera), para comparar. */
export interface ImportesDelPdf { base: number | null; iva: number | null; total: number | null }

/**
 * ¿Cuadra con el PDF? «Igual que el PDF» o la diferencia, en ámbar. `fuente`:
 * 'pdf' si salió de leer su fichero; 'factura' si se escribió (la a mano).
 */
export function contraElPdf(t: Totales, pdf: ImportesDelPdf, fuente: 'pdf' | 'factura' = 'pdf', o: { masDecimales?: boolean } = {}):
  { igual: boolean | null; texto: string; redondeo?: boolean } {
  const quien = fuente === 'pdf' ? 'el PDF' : 'la factura'
  if (t.malEscrito.length > 0) return { igual: false, texto: `No sé sumar: ${t.malEscrito.join(', ')} no es un importe.` }
  if (pdf.total === null) return { igual: null, texto: `${fuente === 'pdf' ? 'El PDF' : 'La factura'} no dice el total: compruébalo a ojo.` }
  const d = cent(t.total) - cent(pdf.total)
  if (d === 0) return { igual: true, texto: `Igual que ${quien}` }
  // Las líneas traen más de dos decimales (la Orange: 21,4463 + 7,438) y, al céntimo como el
  // asiento, sale un céntimo arriba o abajo: es redondeo, se dice en ámbar pero no es «Revisa esto».
  if (Math.abs(d) === 1 && o.masDecimales) return { igual: true, redondeo: true, texto: `1 céntimo de redondeo: sus líneas traen más de dos decimales (${quien} dice ${eurosExactos(pdf.total)})` }
  const cuanto = eurosExactos(deCent(Math.abs(d)))
  return { igual: false, texto: `${d > 0 ? `${cuanto} más` : `${cuanto} menos`} que ${quien} (${eurosExactos(pdf.total)})` }
}

/** ¿Alguna línea trae más de dos decimales? (la Orange: 21,4463). */
export const lineasConMasDecimales = (lineas: readonly { importe: number | null }[]): boolean =>
  lineas.some((l) => l.importe !== null && Math.abs(Math.round(Number(l.importe) * 100) - Number(l.importe) * 100) > 1e-6)

// ── El gasto ─────────────────────────────────────────────────────────────────

/** Las líneas de gasto con su importe: la que va vacía se lleva lo que falte hasta la base. */
export function gastosConImporte(gastos: readonly LineaGasto[], base: number): { cuenta: string; local: string; importe: number; restoAutomatico: boolean }[] {
  const escritos = gastos.map((g) => (g.importe.trim() === '' ? null : leerImporteEs(g.importe)))
  const suma = escritos.reduce<number>((t, x) => t + cent(x ?? 0), 0)
  const vacia = escritos.findIndex((x) => x === null)
  return gastos.map((g, i) => ({
    cuenta: g.cuenta, local: g.local,
    importe: i === vacia ? deCent(cent(base) - suma) : deCent(cent(escritos[i] ?? 0)),
    restoAutomatico: i === vacia,
  }))
}

/** ¿El reparto del gasto suma la base? Si no, cuánto falta o sobra. */
export function cuadraElGasto(gastos: readonly LineaGasto[], base: number): string | null {
  const g = gastosConImporte(gastos, base)
  const d = g.reduce((t, x) => t + cent(x.importe), 0) - cent(base)
  if (g.some((x) => !x.cuenta)) return 'Falta la cuenta de gasto.'
  if (d === 0) return null
  return d > 0 ? `El reparto pasa de la base en ${eurosExactos(deCent(d))}.` : `Faltan ${eurosExactos(deCent(-d))} por repartir.`
}

// ── El asiento, como vista previa ───────────────────────────────────────────

export interface Cuenta { codigo: string; nombre: string }

/** Las cuentas que el asiento necesita, sacadas de la propuesta (o de la ficha si no la hay). */
export interface CuentasFicha {
  proveedor: Cuenta | null
  /** La 472 de cada tipo. */
  iva: ReadonlyMap<number, Cuenta>
  retencion: Cuenta | null
  /**
   * S01h · 1 · La propuesta es la de un abono (ya girada por comoAbono: el
   * proveedor al Debe; la compra o su devolución y el IVA al Haber). Con ella,
   * la vista previa sale al revés, y cada compra va a su cuenta de devoluciones
   * si la propuesta la trae.
   */
  abono?: boolean
  /** S01h · 1 · Las cuentas del Haber de un abono que no son IVA ni retención: la 608x de cada compra (o la compra misma). */
  devoluciones?: readonly Cuenta[]
}

export interface LineaPropuestaVista {
  cuenta: string
  debe: number
  haber: number
  iva?: { tipo: number } | null
  retencion?: unknown
}

/** Las cuentas de la propuesta (verPropuestaFactura): la 400 del proveedor, la 472 de cada tipo y la 4751. */
export function cuentasDeLaPropuesta(lineas: readonly LineaPropuestaVista[], nombre: (codigo: string) => string): CuentasFicha {
  const iva = new Map<number, Cuenta>()
  let proveedor: Cuenta | null = null
  let retencion: Cuenta | null = null
  // S01h · 1 · Un abono: su IVA soportado va al Haber (comoAbono). Entonces el
  // proveedor es la línea del Debe, y lo demás del Haber son las devoluciones.
  // Antes se buscaba la 472 solo en el Debe y el proveedor en el Haber: con un
  // abono no había 472 y la 608 salía de «proveedor».
  const abono = lineas.some((l) => l.iva && l.haber > 0 && !(l.debe > 0))
  const devoluciones: Cuenta[] = []
  for (const l of lineas) {
    const c = { codigo: l.cuenta, nombre: nombre(l.cuenta) }
    if (l.iva && (abono ? l.haber > 0 : l.debe > 0)) iva.set(Number(l.iva.tipo), c)
    else if (l.retencion) retencion = c
    else if (abono ? l.debe > 0 : l.haber > 0) { if (!proveedor) proveedor = c }
    else if (abono && l.haber > 0 && !devoluciones.some((d) => d.codigo === c.codigo)) devoluciones.push(c)
  }
  return abono ? { proveedor, iva, retencion, abono, devoluciones } : { proveedor, iva, retencion }
}

/** S01h · 1 · La cuenta del Haber de un abono para una compra: su 608x si la propuesta la trae; si no, la misma compra. */
function devolucionDe(gasto: string, c: CuentasFicha): Cuenta | null {
  const p = plantillaDevolucion(gasto)
  return (p ? c.devoluciones?.find((d) => d.codigo.startsWith(p)) : null) ?? null
}

export interface LineaVista {
  codigo: string
  nombre: string
  debe: number | null
  haber: number | null
  /** El local de la línea de gasto, si lo tiene. */
  local?: string | null
  /** Su cuenta se cambió en «Editar el asiento a mano». */
  aMano?: boolean
}

/**
 * El asiento que saldría con lo que hay en pantalla. Primero el debe (el gasto
 * de cada línea, el IVA de cada tipo, el recargo), luego el haber (la
 * retención, el proveedor). Lo que no tiene cuenta sale sin código y lo dice
 * `faltan`; nada se inventa.
 */
export function asientoVistaPrevia(b: BorradorFicha, c: CuentasFicha, nombreGasto: (codigo: string) => string, nombreLocal: (id: string) => string | null):
  { lineas: LineaVista[]; debe: number; haber: number; cuadra: boolean; faltan: string[] } {
  const t = totalesDe(b)
  const faltan: string[] = []
  const debe: LineaVista[] = []
  for (const g of gastosConImporte(b.gastos, t.base)) {
    if (!g.cuenta) faltan.push('la cuenta de gasto')
    if (g.importe !== 0) debe.push({ codigo: g.cuenta, nombre: g.cuenta ? nombreGasto(g.cuenta) : 'Sin cuenta de gasto', debe: g.importe, haber: null, local: g.local ? nombreLocal(g.local) : null })
  }
  const porTipo = new Map<number, number>()
  for (const l of b.iva) {
    const tipo = l.tipo === '' ? null : Number(l.tipo)
    const cuota = leerImporteEs(l.cuota)
    if (tipo === null || !Number.isFinite(tipo) || cuota === null || cent(cuota) === 0) continue
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + cent(cuota))
  }
  for (const [tipo, cc] of [...porTipo.entries()].sort((a, b2) => a[0] - b2[0])) {
    const cta = c.iva.get(tipo)
    if (!cta) faltan.push(`la cuenta del IVA soportado al ${porcentaje(tipo)}`)
    debe.push({ codigo: cta?.codigo ?? '', nombre: cta?.nombre ?? `IVA soportado ${porcentaje(tipo)}`, debe: deCent(cc), haber: null })
  }
  if (t.recargo) {
    const g = b.gastos[0]?.cuenta ?? ''
    debe.push({ codigo: g, nombre: 'Recargo de equivalencia (más gasto)', debe: t.recargo, haber: null })
  }
  const haber: LineaVista[] = []
  if (t.retencion) {
    if (!c.retencion) faltan.push('la cuenta de la retención')
    haber.push({ codigo: c.retencion?.codigo ?? '', nombre: c.retencion?.nombre ?? 'Retenciones (IRPF)', debe: null, haber: t.retencion })
  }
  if (!c.proveedor) faltan.push('la cuenta del proveedor')
  haber.push({ codigo: c.proveedor?.codigo ?? '', nombre: c.proveedor?.nombre ?? 'Proveedor', debe: null, haber: t.total })
  // «Editar el asiento a mano»: la cuenta elegida en lugar de la propuesta, marcada.
  // S01h · 1 · Un abono, al revés que su factura: el proveedor al Debe; la
  // compra (en su cuenta de devoluciones, si la propuesta la trae) y el IVA de
  // cada tipo al Haber. Cada importe, en positivo en su columna.
  const enOrden = c.abono
    ? [...haber, ...debe].map((l) => {
        const d = l.debe !== null && l.codigo && l.codigo !== c.proveedor?.codigo && !/^472/.test(l.codigo) ? devolucionDe(l.codigo, c) : null
        return { ...l, ...(d ? { codigo: d.codigo, nombre: d.nombre } : {}), debe: l.haber, haber: l.debe }
      })
    : [...debe, ...haber]
  const lineas = enOrden.map((l) => {
    const otra = l.codigo ? b.aMano[l.codigo] : undefined
    return otra && otra !== l.codigo ? { ...l, codigo: otra, nombre: nombreGasto(otra), aMano: true } : l
  })
  const sd = lineas.reduce((s, l) => s + cent(l.debe ?? 0), 0)
  const sh = lineas.reduce((s, l) => s + cent(l.haber ?? 0), 0)
  return { lineas, debe: deCent(sd), haber: deCent(sh), cuadra: sd === sh && sd > 0, faltan: [...new Set(faltan)] }
}

// ── Qué se guarda hoy, y con qué ────────────────────────────────────────────

/**
 * Cómo se guarda cada campo. Con la tanda 0790 (D03), todo lo de la ficha tiene
 * su función en la base y nada se escribe directo en una tabla desde aquí:
 *   · conta_recibida_guardar(p_invoice, p_cambios, p_quien_nombre): proveedor,
 *     número, fecha, local, vence, forma de pago, IVA por tipo, retención,
 *     recargo, el gasto repartido y el asiento a mano, en un viaje;
 *   · conta_recibida_papel_poner: el PDF nuevo (subido a receipt-uploads);
 *   · conta_recibida_sin_papel: «Sin PDF» con su motivo.
 * «Pagada» no: mark_supplier_invoice_paid pide la factura aprobada (se marca al
 * validarla, o la casa el banco).
 */
export type ComoSeGuarda = { con: string } | { falta: string }

export const COMO_SE_GUARDA: Record<CampoFicha, ComoSeGuarda> = {
  proveedorId: { con: 'conta_recibida_guardar' },
  numero: { con: 'conta_recibida_guardar' },
  fecha: { con: 'conta_recibida_guardar' },
  iva: { con: 'conta_recibida_guardar' },
  retencion: { con: 'conta_recibida_guardar' },
  recargo: { con: 'conta_recibida_guardar' },
  gastos: { con: 'conta_recibida_guardar' },
  formaPago: { con: 'conta_recibida_guardar' },
  vence: { con: 'conta_recibida_guardar' },
  aMano: { con: 'conta_recibida_guardar' },
  documento: { con: 'conta_recibida_papel_poner' },
  sinPdf: { con: 'conta_recibida_sin_papel' },
  motivoSinPdf: { con: 'conta_recibida_sin_papel' },
  estadoPago: { falta: 'una factura sin validar no se puede marcar pagada: mark_supplier_invoice_paid pide que esté aprobada. Se marca al validarla, o la casa el banco' },
}

const SIN_TANDA = 'la base aún no tiene la función que lo guarda (la tanda D03, 0790, no está aplicada)'
/**
 * Lo de antes de la 0790, para cuando la base aún no tiene sus funciones (staging antes
 * de aplicarla): el proveedor y el vencimiento con lo que ya existía; lo demás se dice.
 */
export const SIN_LA_TANDA: Record<CampoFicha, ComoSeGuarda> = {
  ...(Object.fromEntries(Object.keys(COMO_SE_GUARDA).map((k) => [k, { falta: SIN_TANDA }])) as Record<CampoFicha, ComoSeGuarda>),
  proveedorId: { con: 'supplier_invoice.supplier_id (el «Es este» de siempre)' },
  vence: { con: 'set_supplier_invoice_due_date' },
  estadoPago: COMO_SE_GUARDA.estadoPago,
}

export const seGuardaHoy = (campo: CampoFicha, conTanda = true): boolean => 'con' in (conTanda ? COMO_SE_GUARDA : SIN_LA_TANDA)[campo]

/** Los campos cambiados, partidos en lo que se guarda y lo que no (con la tanda 0790 o sin ella). */
export function partirCambios<C extends { campo: string; etiqueta: string }>(cambios: readonly C[], conTanda = true): { hoy: C[]; noHoy: (C & { porque: string })[] } {
  const mapa = conTanda ? COMO_SE_GUARDA : SIN_LA_TANDA
  const hoy: C[] = []
  const noHoy: (C & { porque: string })[] = []
  for (const c of cambios) {
    const como = mapa[c.campo as CampoFicha]
    if (como && 'con' in como) hoy.push(c)
    else noHoy.push({ ...c, porque: como && 'falta' in como ? como.falta : 'no se sabe dónde guardarlo' })
  }
  return { hoy, noHoy }
}

/**
 * Regla 8: lo que dice «Guardar cambios» al acabar, con contenido. `hechos`:
 * lo guardado («Vence: 18/11/2026»); `fallos`: lo que se intentó y la base
 * rechazó; `noHoy`: lo que aún no tiene dónde guardarse.
 */
export function textoDelGuardado(o: {
  hechos: readonly string[]
  fallos: readonly { etiqueta: string; porque: string }[]
  noHoy: readonly { etiqueta: string; porque: string }[]
}): { tono: 'ok' | 'falta'; texto: string } {
  const partes: string[] = []
  if (o.hechos.length) partes.push(`Guardado: ${o.hechos.join(' · ')}.`)
  for (const f of o.fallos) partes.push(`${f.etiqueta}: no se ha guardado (${f.porque.replace(/\.$/, '')}).`)
  if (o.noHoy.length) {
    const quien = o.noHoy.map((x) => x.etiqueta)
    const lista = quien.length === 1 ? quien[0] : `${quien.slice(0, -1).join(', ')} y ${quien[quien.length - 1]}`
    partes.push(`${lista}: ${quien.length === 1 ? 'no se puede' : 'no se pueden'} guardar todavía — ${o.noHoy[0].porque.replace(/\.$/, '')}${o.noHoy.length > 1 ? '; y lo demás, igual' : ''}. ${quien.length === 1 ? 'Sigue marcado' : 'Siguen marcados'} para que no se pierda${quien.length === 1 ? '' : 'n'}: descártalo${quien.length === 1 ? '' : 's'} para validar.`)
  }
  if (!partes.length) return { tono: 'ok', texto: 'No había nada que guardar.' }
  return { tono: o.fallos.length || o.noHoy.length ? 'falta' : 'ok', texto: partes.join(' ') }
}

// ── Lo que va a conta_recibida_guardar (contrato D03 · 0790) ──────────────

/** Recargo de equivalencia de cada tipo de IVA (Ley del IVA, art. 161). */
export const RECARGO_DE: Readonly<Record<number, number>> = { 21: 5.2, 10: 1.4, 5: 0.62, 4: 0.5, 2: 0.26, 0: 0 }

/**
 * El recargo, repartido por tipo: el de cada tipo por su base; si el escrito no es
 * la suma (el PDF lo redondea de otro modo), la diferencia va al tipo de más base.
 */
export function recargoPorTipo(iva: readonly LineaIva[], recargo: Adicional | null): { tipo: number | null; importe: number }[] {
  const xs = iva.map((l) => {
    const base = leerImporteEs(l.base) ?? 0, tipo = l.tipo === '' ? null : Number(l.tipo)
    const pct = tipo === null ? null : RECARGO_DE[tipo] ?? null
    return { base, tipo: pct, importe: recargo && pct ? cuotaIva(base, pct) : 0 }
  })
  if (!recargo) return xs.map(() => ({ tipo: null, importe: 0 }))
  const total = leerImporteEs(recargo.importe) ?? 0
  const d = cent(total) - xs.reduce((t, x) => t + cent(x.importe), 0)
  if (d !== 0 && xs.length) {
    const i = xs.reduce((m, x, k) => (x.base > xs[m].base ? k : m), 0)
    xs[i] = { ...xs[i], importe: deCent(cent(xs[i].importe) + d) }
  }
  return xs.map((x) => ({ tipo: x.tipo, importe: x.importe }))
}

export interface LineaAMano { posicion: number; cuenta: string; debe: number; haber: number; local?: string | null }

/** El asiento a mano para la base (entry_overrides): las líneas de la vista previa con la cuenta tocada; null si no se tocó nada. */
export function asientoAManoParaGuardar(b: BorradorFicha, previa: readonly LineaVista[]): LineaAMano[] | null {
  if (!Object.entries(b.aMano).some(([a, x]) => a !== x)) return null
  return previa.map((l, i) => ({ posicion: i, cuenta: l.codigo, debe: l.debe ?? 0, haber: l.haber ?? 0 }))
}

/** Lo guardado en entry_overrides, como el «aMano» del borrador: cuenta propuesta → cuenta elegida, por posición. */
export function aManoDeLoGuardado(overrides: unknown, previaSinTocar: readonly LineaVista[]): Record<string, string> {
  if (!Array.isArray(overrides)) return {}
  const m: Record<string, string> = {}
  overrides.forEach((o, i) => {
    const x = o as { posicion?: number; cuenta?: string }
    const orig = previaSinTocar[typeof x.posicion === 'number' ? x.posicion : i]
    if (orig?.codigo && typeof x.cuenta === 'string' && x.cuenta && x.cuenta !== orig.codigo) m[orig.codigo] = x.cuenta
  })
  return m
}

const nulo = (x: string) => (x === '' ? null : x)

/**
 * Las claves de p_cambios para conta_recibida_guardar, SOLO de los campos
 * cambiados (todas son opcionales: lo que no viene no se toca). `previa`: las
 * líneas del asiento que se ve (para el asiento a mano); `comun`: el valor de
 * «Común» en el selector de local de esta pantalla ('' en la ficha).
 */
export function cambiosParaLaBase(b: BorradorFicha, campos: readonly string[], o: { previa?: readonly LineaVista[]; comun?: string; retencionTipoId?: string | null } = {}): Record<string, unknown> {
  const c = new Set(campos)
  const p: Record<string, unknown> = {}
  const t = totalesDe(b)
  if (c.has('proveedorId')) p.proveedor = nulo(b.proveedorId)
  if (c.has('numero')) p.numero = b.numero.trim()
  if (c.has('fecha')) p.fecha = nulo(b.fecha)
  if (c.has('vence')) p.vence = nulo(b.vence)
  if (c.has('formaPago')) p.forma_pago = nulo(b.formaPago)
  if (c.has('iva') || c.has('recargo')) {
    const rec = recargoPorTipo(b.iva, b.recargo)
    // Contrato final de la 0790: un tipo por línea; recargo_tipo y recargo solo si hay recargo.
    p.iva = b.iva.map((l, i) => ({
      tipo: l.tipo === '' ? null : Number(l.tipo), base: leerImporteEs(l.base), cuota: leerImporteEs(l.cuota) ?? 0,
      ...(b.recargo ? { recargo_tipo: rec[i].tipo, recargo: rec[i].importe } : {}),
    }))
  }
  if (c.has('retencion') || (b.retencion && c.has('iva'))) {
    // Con su tipo_id si es la de siempre (withholding_rate_id): con solo el tanto, la base coge la última del proveedor.
    p.retencion = b.retencion ? {
      ...(b.retencion.tipo !== '' ? { tipo: Number(b.retencion.tipo) } : {}),
      ...(o.retencionTipoId ? { tipo_id: o.retencionTipoId } : {}),
      base: t.base, importe: leerImporteEs(b.retencion.importe) ?? 0,
    } : null
  }
  if (c.has('gastos')) {
    const comun = o.comun ?? ''
    const g = gastosConImporte(b.gastos, t.base)
    p.gasto = g.map((x) => ({ cuenta: x.cuenta, local: x.local && x.local !== comun ? x.local : null, comun: !x.local || x.local === comun, importe: x.importe }))
    const locales = [...new Set(g.map((x) => (x.local && x.local !== comun ? x.local : null)))]
    // El local de la factura: el de su gasto si es uno solo; si se reparte, común (lo dice el reparto).
    p.local = locales.length === 1 ? locales[0] : null
  }
  if (c.has('aMano')) p.asiento_a_mano = o.previa ? asientoAManoParaGuardar(b, o.previa) : null
  return p
}

/** Cómo se escribe cada campo en «Antes: …» y en la barra. */
export function formatoCampo(nombreProveedor: (id: string) => string, nombreLocal: (id: string) => string | null) {
  return (campo: string, v: unknown): string => {
    switch (campo as CampoFicha) {
      case 'proveedorId': return v ? nombreProveedor(String(v)) : '—'
      case 'fecha': case 'vence': return v ? fechaEs(String(v)) : '—'
      case 'iva': {
        const xs = (v as LineaIva[] | null) ?? []
        return xs.length ? xs.map((l) => `${l.base || '—'} al ${textoTipo(l.tipo)}`).join(' + ') : '—'
      }
      case 'retencion': case 'recargo': {
        const a = v as Adicional | null
        return a ? `${a.importe || '—'}${a.tipo ? ` (${textoTipo(a.tipo)})` : ''}` : 'Ninguno'
      }
      case 'gastos': {
        const xs = (v as LineaGasto[] | null) ?? []
        return xs.map((g) => `${g.cuenta || 'sin cuenta'}${g.local ? ` · ${nombreLocal(g.local) ?? 'otro local'}` : ' · común'}${g.importe ? ` · ${g.importe}` : ''}`).join(' + ') || '—'
      }
      case 'formaPago': return FORMAS_PAGO.find((f) => f.valor === v)?.texto ?? '—'
      case 'estadoPago': return ESTADOS_PAGO.find((f) => f.valor === v)?.texto ?? '—'
      case 'documento': return v ? `«${String(v)}»` : 'el que tenía'
      case 'sinPdf': return v ? 'Sí' : 'No'
      case 'aMano': {
        const m = (v as Record<string, string> | null) ?? {}
        const xs = Object.entries(m).filter(([a, b2]) => a !== b2)
        return xs.length ? xs.map(([a, b2]) => `${a} → ${b2}`).join(' · ') : 'el propuesto'
      }
      default: return v === '' || v === null || v === undefined ? '—' : String(v)
    }
  }
}

/** Lo que se puede subir en el hueco del PDF: un PDF o una foto (JPG o PNG), que se guarda como PDF. */
export const ACEPTA_PAPEL = 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png'

// ── De dónde vino y su historial ────────────────────────────────────────────

export interface OrigenFicha {
  /** supplier_invoice.source: 'ocr', 'manual', 'lote', 'liquidacion'… */
  fuente: string | null
  /** document_inbox.channel, si llegó por la bandeja. */
  canal: string | null
  /** La recepción de la que salió. */
  recepcion: { fecha: string; local: string | null; quien: string | null; cuando: string | null } | null
  /** La lectura de su fichero (goods_receipt_ai_session). */
  lectura: { cuando: string; archivo: string | null } | null
  creada: { cuando: string; quien: string | null }
}

const CANALES: Record<string, string> = { correo: 'Llegó por correo', subida: 'Se subió', portal: 'Llegó del portal', cocina: 'Llegó del local' }

/** La frase de debajo del título: «Entró con la recepción del 19/10 en Foodint Alcalá · leída de su PDF». */
export function deDondeVino(o: OrigenFicha): string {
  const leida = o.lectura ? ` · leída de su ${/\.(jpe?g|png|webp)$/i.test(o.lectura.archivo ?? '') ? 'foto' : 'PDF'}` : ''
  if (o.fuente === 'manual') return `Escrita a mano el ${ddmm(o.creada.cuando.slice(0, 10))}${o.creada.quien ? ` por ${o.creada.quien.trim()}` : ''}`
  if (o.recepcion) return `Entró con la recepción del ${ddmm(o.recepcion.fecha)}${o.recepcion.local ? ` en ${o.recepcion.local}` : ''}${leida}`
  if (o.canal && CANALES[o.canal]) return `${CANALES[o.canal]} el ${ddmm(o.creada.cuando.slice(0, 10))}${leida}`
  if (o.fuente === 'liquidacion') return `Salió de una liquidación de la plataforma el ${ddmm(o.creada.cuando.slice(0, 10))}`
  if (o.fuente === 'lote') return `Salió de una factura de lote el ${ddmm(o.creada.cuando.slice(0, 10))}${leida}`
  return `Se dio de alta el ${ddmm(o.creada.cuando.slice(0, 10))}${o.creada.quien ? ` por ${o.creada.quien.trim()}` : ''}${leida}`
}

export interface HechoHistorial { cuando: string; texto: string }

export interface DatosHistorial extends OrigenFicha {
  marca: string
  aprobada: { cuando: string; quien: string | null } | null
  venceCambiado: { cuando: string; quien: string | null; vence: string | null } | null
  pagos: readonly { cuando: string; accion: string; quien: string | null; pagada: string | null; vence: string | null }[]
  asiento: { numero: number | null; validado: { cuando: string; quien: string | null } | null; creado: string | null } | null
  descartada: { cuando: string; quien: string | null; motivo: string | null } | null
  /** supplier_invoice_change (0790): lo que guardó una persona en la ficha. */
  cambios?: readonly {
    cuando: string; quien: string | null; que: string; campos: readonly string[]
    /** D06 · El documento que había antes (la foto, si llegó su PDF). */
    anterior?: string | null
    /** D06 · Fue el PDF bueno, llegado después, que ocupó el sitio de la foto. */
    pdfSustituye?: boolean
  }[]
}

const QUE_CAMBIO: Record<string, string> = { guardar: 'Cambió', papel: 'Puso el PDF', sin_papel: 'Marcó «Sin PDF»' }

/** Las claves de p_cambios (y de supplier_invoice_change.cambios[].campo), en palabras. */
export const ETIQUETA_DE_CLAVE: Record<string, string> = {
  proveedor: 'el proveedor', numero: 'el número', fecha: 'la fecha', local: 'el local', vence: 'el vencimiento', forma_pago: 'la forma de pago',
  iva: 'los importes por tipo de IVA', retencion: 'la retención', gasto: 'el gasto', asiento_a_mano: 'el asiento a mano',
}

const quienEs = (q: string | null | undefined) => (q && q.trim() ? ` (${q.trim()})` : '')

/** El historial, de lo que la base ya guarda, del más antiguo al más nuevo. No hay tabla de historial: cada hecho sale de su sello. */
export function historialDe(d: DatosHistorial): HechoHistorial[] {
  const h: HechoHistorial[] = []
  if (d.recepcion?.cuando) h.push({ cuando: d.recepcion.cuando, texto: `Recepción${d.recepcion.local ? ` en ${d.recepcion.local}` : ''}${quienEs(d.recepcion.quien)}` })
  if (d.lectura) h.push({ cuando: d.lectura.cuando, texto: `${d.marca} leyó ${d.lectura.archivo ? `«${d.lectura.archivo}»` : 'su fichero'}` })
  h.push({ cuando: d.creada.cuando, texto: `${d.fuente === 'manual' ? 'Escrita a mano' : 'Se dio de alta la factura'}${quienEs(d.creada.quien)}` })
  if (d.venceCambiado) h.push({ cuando: d.venceCambiado.cuando, texto: `Vence: ${fechaEs(d.venceCambiado.vence)}${quienEs(d.venceCambiado.quien)}` })
  for (const p of d.pagos) {
    if (p.accion === 'due_date_changed' && d.venceCambiado && p.cuando === d.venceCambiado.cuando) continue
    const texto = p.accion === 'paid' ? `Marcada pagada${p.pagada ? ` el ${fechaEs(p.pagada)}` : ''}`
      : p.accion === 'unpaid' ? 'Quitada la marca de pagada'
        : p.accion === 'due_date_changed' ? `Vence: ${fechaEs(p.vence)}` : p.accion
    h.push({ cuando: p.cuando, texto: `${texto}${quienEs(p.quien)}` })
  }
  if (d.aprobada) h.push({ cuando: d.aprobada.cuando, texto: `Aprobada${quienEs(d.aprobada.quien)}` })
  if (d.asiento?.creado) h.push({ cuando: d.asiento.creado, texto: 'Se propuso su asiento' })
  if (d.asiento?.validado) h.push({ cuando: d.asiento.validado.cuando, texto: `Contabilizada${d.asiento.numero ? `: asiento ${d.asiento.numero}` : ''}${quienEs(d.asiento.validado.quien)}` })
  for (const c of d.cambios ?? []) {
    if (c.pdfSustituye) {
      const foto = c.anterior ? c.anterior.replace(/^.*\//, '') : null
      h.push({ cuando: c.cuando, texto: `Llegó su PDF: sustituye a ${foto ? `la foto «${foto}»` : 'la foto'}, que queda como documento anterior` })
      continue
    }
    const que = QUE_CAMBIO[c.que] ?? 'Cambió'
    const campos = [...new Set(c.campos.map((k) => ETIQUETA_DE_CLAVE[k] ?? k))]
    h.push({ cuando: c.cuando, texto: `${que}${c.que === 'guardar' && campos.length ? ` ${campos.join(', ')}` : ''}${quienEs(c.quien)}` })
  }
  if (d.descartada) h.push({ cuando: d.descartada.cuando, texto: `No es una factura${d.descartada.motivo ? `: «${d.descartada.motivo}»` : ''}${quienEs(d.descartada.quien)}` })
  return h.sort((a, b) => (a.cuando < b.cuando ? -1 : a.cuando > b.cuando ? 1 : 0))
}

/** «19/10 · …»: el día en Madrid, siempre con dos cifras (diaMesMadrid, el mismo de Impuestos). */
export function diaDeHecho(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso.slice(8, 10) + '/' + iso.slice(5, 7)
  return diaMesMadrid(iso)
}

/** El PDF que guardó su lectura (goods_receipt_ai_session.input_files): la primera ruta de receipt-uploads. */
export function papelDeLaLectura(ficheros: unknown): string | null {
  if (!Array.isArray(ficheros)) return null
  for (const f of ficheros) {
    if (typeof f === 'string' && f) return f
    if (f && typeof f === 'object') {
      const o = f as Record<string, unknown>
      if (typeof o.path === 'string' && (o.bucket === undefined || o.bucket === 'receipt-uploads')) return o.path
    }
  }
  return null
}

// ── La recibida a mano, con la misma ficha ─────────────────────────────────

/** Lo que se guarda de una a mano, ya comprobado: una línea por tipo de IVA (de las líneas sale el asiento). */
export interface RecibidaAManoComprobada {
  proveedorId: string
  numero: string
  fecha: string
  /** null = común. */
  localId: string | null
  lineas: { base: number; tipo: number; cuota: number }[]
  base: number
  cuota: number
  total: number
  /** La cuenta de gasto elegida (supplier_invoice_line.expense_account_code), o null para la de su ficha. */
  cuentaGasto: string | null
  vence: string | null
}

export type CampoAMano = 'proveedor' | 'numero' | 'fecha' | 'local' | 'importes'

const fechaValida = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Comprueba una a mano escrita con la ficha. Los mismos textos que la de antes
 * (lib/recibidaAMano.comprobarRecibida), con varias líneas de IVA. `comun` es
 * el valor de «Común» en el selector de local; `conLocal`, si se pregunta.
 */
export function comprobarAMano(b: BorradorFicha, tipos: readonly number[], hoy: string, conLocal: boolean, comun: string):
  { errores: Partial<Record<Exclude<CampoAMano, 'importes'>, string>> & { importes?: string[] }; datos: RecibidaAManoComprobada | null } {
  const e: Partial<Record<Exclude<CampoAMano, 'importes'>, string>> & { importes?: string[] } = {}
  if (!b.proveedorId) e.proveedor = 'Elige el proveedor. Si no está, dalo de alta primero.'
  const numero = b.numero.trim()
  if (!numero) e.numero = 'Escribe el número de la factura, tal como viene en ella.'
  else if (numero.length > 60) e.numero = 'El número es demasiado largo (como mucho 60 caracteres).'
  if (!b.fecha) e.fecha = 'Pon la fecha de expedición de la factura.'
  else if (!fechaValida(b.fecha)) e.fecha = 'Esa fecha no existe: escríbela como dd/mm/aaaa.'
  else if (b.fecha > hoy) e.fecha = `La fecha es posterior a hoy (${fechaEs(hoy)}): una factura recibida no puede ser del futuro.`
  const g = b.gastos[0] ?? { cuenta: '', local: '', importe: '' }
  if (conLocal && !g.local) e.local = 'Elige el local de la factura, o «Común» si es de todos.'
  const imp: string[] = []
  const lineas: RecibidaAManoComprobada['lineas'] = []
  b.iva.forEach((l, i) => {
    const de = b.iva.length > 1 ? ` (línea ${i + 1})` : ''
    const base = leerImporteEs(l.base)
    if (l.base.trim() === '') imp.push(`Escribe la base imponible.${de ? ` Falta en la línea ${i + 1}.` : ''}`)
    else if (base === null) imp.push(`La base no es un importe: escríbela así, 1.234,56.${de}`)
    else if (base <= 0) imp.push(`La base tiene que ser mayor que 0. Un abono no se da de alta aquí.${de}`)
    const tipo = l.tipo === '' ? null : Number(l.tipo)
    if (tipo === null || !Number.isFinite(tipo) || !tipos.includes(tipo)) imp.push(`Elige el tipo de IVA de la factura.${de}`)
    const cuota = l.cuota.trim() === '' && base !== null && tipo !== null ? cuotaIva(base, tipo) : leerImporteEs(l.cuota)
    if (cuota === null && l.cuota.trim() !== '') imp.push(`La cuota no es un importe: escríbela así, 259,26.${de}`)
    else if (cuota !== null && cuota < 0) imp.push(`La cuota no puede ser negativa.${de}`)
    else if (tipo === 0 && cuota) imp.push(`Sin IVA (0 %), la cuota es 0.${de}`)
    if (base !== null && base > 0 && tipo !== null && cuota !== null && cuota >= 0) lineas.push({ base, tipo, cuota })
  })
  if (b.iva.length === 0) imp.push('Escribe la base imponible.')
  const tiposVistos = b.iva.map((l) => l.tipo).filter(Boolean)
  if (new Set(tiposVistos).size !== tiposVistos.length) imp.push('Hay dos líneas con el mismo tipo de IVA: súmalas en una.')
  if (imp.length) e.importes = [...new Set(imp)]
  if (Object.keys(e).length > 0 || lineas.length !== b.iva.length) return { errores: e, datos: null }
  const base = lineas.reduce((t, l) => t + cent(l.base), 0)
  const cuota = lineas.reduce((t, l) => t + cent(l.cuota), 0)
  return {
    errores: e,
    datos: {
      proveedorId: b.proveedorId, numero, fecha: b.fecha, localId: !conLocal || !g.local || g.local === comun ? null : g.local,
      lineas, base: deCent(base), cuota: deCent(cuota), total: deCent(base + cuota), cuentaGasto: g.cuenta || null, vence: b.vence || null,
    },
  }
}

/** Lo que el formulario a mano no guarda todavía (no hay columna): se dice al guardar (regla 8). */
export function noSeGuardaAMano(b: BorradorFicha): string[] {
  const xs: string[] = []
  if (b.formaPago) xs.push('la forma de pago')
  if (b.estadoPago === 'pagada') xs.push('que está pagada (se marca al validarla)')
  if (b.sinPdf) xs.push('«Sin PDF» y su motivo')
  if (b.retencion) xs.push('la retención')
  if (b.recargo) xs.push('el recargo de equivalencia')
  return xs
}
