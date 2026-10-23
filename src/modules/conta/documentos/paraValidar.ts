// src/modules/conta/documentos/paraValidar.ts
//
// D06 · Lo que decide si una factura recibida se puede validar (sola o en
// bloque) y lo que se avisa antes. Núcleo puro: se prueba sin base ni React.
//
//   · El PDF es obligatorio: sin documento, solo se valida si está marcada
//     «Sin PDF» con su motivo. Las liquidaciones que nacen del correo de Uber
//     quedan fuera, como hoy (no tienen PDF: el resumen es el correo).
//   · Duplicadas: otra del mismo proveedor con el mismo número (normalizado:
//     sin espacios, guiones ni ceros a la izquierda), o con la misma fecha y el
//     mismo total.
//   · El NIF se compara normalizado (sin guiones, espacios ni «ES»); si el leído
//     no es válido y se diferencia en UN carácter del de la ficha, que sí lo es,
//     se leyó mal: se usa el de la ficha y se avisa en ámbar.
//   · Pagada con tarjeta: si lo que se leyó de la forma de pago lo dice.

import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'

// ── El número de factura ────────────────────────────────────────────────────

/** «F-0012 / 26» → «F1226»: sin espacios, guiones, barras ni puntos, y sin ceros a la izquierda de cada tramo de cifras. */
export function normaNumero(n: string | null | undefined): string {
  return (n ?? '').toUpperCase().replace(/[\s\-_./\\]/g, '').replace(/(^|[^0-9])0+(?=[0-9])/g, '$1')
}

// ── Duplicadas ──────────────────────────────────────────────────────────────

export interface FacturaParaComparar {
  id: string
  proveedorId: string | null
  numero: string | null
  fecha: string | null
  total: number | null
  /** Las descartadas no cuentan como la otra de una duplicada. */
  descartada?: boolean
}

export interface Duplicada { otra: string; por: 'numero' | 'fecha_total'; numero: string | null; fecha: string | null; total: number | null }

/** Para cada factura, la primera otra que la repite (o nada). */
export function duplicadas(facturas: readonly FacturaParaComparar[]): Map<string, Duplicada> {
  const fuera = new Map<string, Duplicada>()
  const vivas = facturas.filter((f) => !f.descartada && f.proveedorId)
  const porNumero = new Map<string, FacturaParaComparar[]>()
  const porFechaTotal = new Map<string, FacturaParaComparar[]>()
  for (const f of vivas) {
    const n = normaNumero(f.numero)
    if (n) porNumero.set(`${f.proveedorId}|${n}`, [...(porNumero.get(`${f.proveedorId}|${n}`) ?? []), f])
    if (f.fecha && f.total !== null) {
      const k = `${f.proveedorId}|${f.fecha}|${Math.round(f.total * 100)}`
      porFechaTotal.set(k, [...(porFechaTotal.get(k) ?? []), f])
    }
  }
  for (const f of facturas) {
    if (!f.proveedorId) continue
    const n = normaNumero(f.numero)
    const mismo = n ? (porNumero.get(`${f.proveedorId}|${n}`) ?? []).find((o) => o.id !== f.id) : undefined
    if (mismo) { fuera.set(f.id, { otra: mismo.id, por: 'numero', numero: mismo.numero, fecha: mismo.fecha, total: mismo.total }); continue }
    if (!f.fecha || f.total === null) continue
    const otra = (porFechaTotal.get(`${f.proveedorId}|${f.fecha}|${Math.round(f.total * 100)}`) ?? []).find((o) => o.id !== f.id)
    if (otra) fuera.set(f.id, { otra: otra.id, por: 'fecha_total', numero: otra.numero, fecha: otra.fecha, total: otra.total })
  }
  return fuera
}

const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'sin fecha')

/** El aviso de una duplicada, en palabras. */
export function textoDuplicada(d: Duplicada): string {
  return d.por === 'numero'
    ? `Puede estar repetida: ya tienes otra con el número ${d.numero ?? '—'} de este proveedor (${ddmm(d.fecha)}).`
    : `Puede estar repetida: ya tienes otra de este proveedor del ${ddmm(d.fecha)} por el mismo total.`
}

// ── El NIF ──────────────────────────────────────────────────────────────────

/** Normalizado: sin guiones, espacios, puntos ni el prefijo ES. */
export const normaNif = (x: string | null | undefined): string => (x ? normalizarNif(x).replace(/^ES(?=[A-Z0-9]{9}$)/, '') : '')

export const nifValido = (x: string | null | undefined): boolean => !!x && validarNifEs(x).ok

/** ¿Se diferencian en un solo carácter (misma longitud)? */
export function unCaracter(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++n > 1) return false
  return n === 1
}

/**
 * Cómo casa el NIF leído con el de la ficha:
 *   · 'igual': el mismo, normalizado;
 *   · 'leido_mal': el leído no es válido, el de la ficha sí, y solo cambia un carácter (se usa el de la ficha);
 *   · 'distinto': es otro NIF; · null: falta uno de los dos.
 */
export function casaNif(ficha: string | null | undefined, leido: string | null | undefined): 'igual' | 'leido_mal' | 'distinto' | null {
  const f = normaNif(ficha); const l = normaNif(leido)
  if (!f || !l) return null
  if (f === l) return 'igual'
  if (!nifValido(l) && nifValido(f) && unCaracter(f, l)) return 'leido_mal'
  return 'distinto'
}

export const AVISO_NIF_LEIDO_MAL = 'He leído mal el NIF; uso el de su ficha'

// ── El documento ────────────────────────────────────────────────────────────

export interface DocumentoFactura {
  tieneDocumento: boolean
  /** Marcada «Sin PDF» con su motivo. */
  sinPdf: boolean
  /** supplier_invoice.source: 'liquidacion' nace del correo de Uber y no lleva PDF. */
  fuente: string | null
}

/** Por qué no se puede validar por falta de documento; null si se puede. */
export function faltaDocumento(d: DocumentoFactura): string | null {
  if (d.tieneDocumento || d.sinPdf || d.fuente === 'liquidacion') return null
  return 'Falta su PDF: súbelo o márcala «Sin PDF» con su motivo para poder validarla.'
}

// ── La forma de pago leída ──────────────────────────────────────────────────

/** ¿Dice el documento que se pagó con tarjeta? («Pagado con tarjeta», «VISA ****6300», «TPV»…). */
export function pagadaConTarjeta(texto: string | null | undefined): boolean {
  return !!texto && /\b(tarjeta|card|visa|master\s*card|maestro|amex|tpv|dat[aá]fono|contactless)\b/i.test(texto)
}

/** Los cuatro últimos de la tarjeta, si el texto los trae («****6300», «tarjeta 6300»). */
export function ultimos4(texto: string | null | undefined): string | null {
  const m = (texto ?? '').match(/(?:\*{2,}|x{2,}|tarjeta\D{0,12}|card\D{0,12})(\d{4})\b/i)
  return m ? m[1] : null
}

/** Un cargo del banco que puede ser el pago con tarjeta: mismo importe, en los 5 días siguientes a la factura. */
export interface CargoBanco { id: string; fecha: string; importe: number; concepto: string }

const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const palabras = (x: string) => x.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Z0-9]+/).filter((p) => p.length >= 4 && !['SOCIEDAD', 'LIMITADA', 'ANONIMA'].includes(p))

/**
 * El cargo que casa con la factura pagada con tarjeta: el mismo importe (en negativo), entre el día
 * de la factura y 5 días después, y con el nombre del proveedor (o la tarjeta) en su concepto. Si hay
 * más de uno igual de bueno, ninguno: se elige a mano.
 */
export function cargoDeLaTarjeta(f: { fecha: string; total: number; proveedor: string; tarjeta: string | null }, cargos: readonly CargoBanco[]): CargoBanco | null {
  const nombre = palabras(f.proveedor)
  const buenos = cargos.filter((c) => Math.round(Math.abs(c.importe) * 100) === Math.round(f.total * 100) && c.importe < 0)
    .filter((c) => { const d = dias(f.fecha, c.fecha); return d >= 0 && d <= 5 })
    .filter((c) => { const t = c.concepto.toUpperCase(); return nombre.some((p) => t.includes(p)) || (!!f.tarjeta && t.includes(f.tarjeta)) })
  return buenos.length === 1 ? buenos[0] : null
}

// ── El reparto de lo que se va a validar en bloque ──────────────────────────

export interface ParaRepartir { cuenta: { codigo: string; nombre: string } | null; base: number | null; total: number | null; local: string | null }
export interface FilaReparto { codigo: string; nombre: string; facturas: number; base: number; total: number }

/** Por cuenta (Cuenta · Nombre · Facturas · Base · Total, de más a menos total) y los locales que tocan. */
export function repartoDelBloque(xs: readonly ParaRepartir[]): { cuentas: FilaReparto[]; locales: string[]; base: number; total: number } {
  const m = new Map<string, FilaReparto>()
  let base = 0, total = 0
  for (const x of xs) {
    const k = x.cuenta?.codigo ?? '—'
    const f = m.get(k) ?? { codigo: k, nombre: x.cuenta?.nombre ?? 'Sin cuenta todavía', facturas: 0, base: 0, total: 0 }
    f.facturas += 1; f.base += x.base ?? 0; f.total += x.total ?? 0
    base += x.base ?? 0; total += x.total ?? 0
    m.set(k, f)
  }
  const r2 = (v: number) => Math.round(v * 100) / 100
  const cuentas = [...m.values()].map((f) => ({ ...f, base: r2(f.base), total: r2(f.total) })).sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo))
  const locales = [...new Set(xs.map((x) => x.local ?? 'Común'))].sort((a, b) => a.localeCompare(b, 'es'))
  return { cuentas, locales, base: r2(base), total: r2(total) }
}

/** El texto de la forma de pago que se leyó del documento (payment_terms_text), esté donde esté en la lectura. */
export function textoDePago(lectura: unknown): string | null {
  const ver = (x: unknown, hondo: number): string | null => {
    if (!x || typeof x !== 'object' || hondo > 6) return null
    const o = x as Record<string, unknown>
    if (typeof o.payment_terms_text === 'string' && o.payment_terms_text.trim()) return o.payment_terms_text
    for (const v of Object.values(o)) { const r = ver(v, hondo + 1); if (r) return r }
    return null
  }
  return ver(lectura, 0)
}
