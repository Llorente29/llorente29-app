// src/modules/conta/impuestos/sociedades.ts
//
// I01h · El Impuesto de sociedades en palabras (Julio, 21/10): los 200
// guardados, lo que queda por cobrar de los que salieron a devolver y cada
// 202 con el 200 del que sale. Lo lee conta_impuesto_sociedades (0340). Aquí
// solo lo que se puede probar sin pantalla.

import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { importeDeTexto } from '@/modules/conta/diseno/valores'
import type { Estado } from './calendario'

export type Resultado200 = 'to_pay' | 'to_refund' | 'zero'

export interface Devolucion200 { importe: number; cobrado: number; cobrado_el: string | null; asiento: string | null; pendiente: number }

export interface Declaracion200 {
  ejercicio: number
  presentado: string
  base_imponible: number
  cuota: number
  resultado: Resultado200
  importe: number
  origen: 'manual' | 'justificante'
  motivo: string | null
  quien: string | null
  devolucion: Devolucion200 | null
}

export interface Pago202 {
  ejercicio: number
  periodo: '1P' | '2P' | '3P'
  ejercicio_base: number
  plazo: string | null
  cuota_200: number | null
  esperado: number | null
  declaracion: {
    id: string; estado: Estado; estado_texto: string; resultado: string | null; importe: number | null
    no_hace_falta: string | null; c01: number | null; c03: number | null; origen: string | null
  } | null
}

export interface Sociedades {
  empresa: string
  hoy: string
  puede_gestionar: boolean
  declaraciones_200: Declaracion200[]
  pagos_202: Pago202[]
}

const PRESENTADAS: ReadonlySet<Estado> = new Set(['filed', 'booked', 'paid', 'offset', 'refunded'])

/** El resultado de un 200 en palabras: «1.126,10 € a devolver». */
export function resultado200(d: Pick<Declaracion200, 'resultado' | 'importe'>): string {
  if (d.resultado === 'zero') return 'Resultado cero'
  return `${eurosExactos(d.importe)} ${d.resultado === 'to_pay' ? 'a ingresar' : 'a devolver'}`
}

/** Lo que salió a devolver, en palabras: pendiente de cobrar hasta que llega al banco. */
export function fraseDevolucion(ejercicio: number, d: Devolucion200): { tono: 'falta' | 'ok'; texto: string } {
  if (d.pendiente <= 0.004) {
    return { tono: 'ok', texto: `Cobrados los ${eurosExactos(d.importe)} a devolver del ${ejercicio}${d.cobrado_el ? `, el ${fechaLarga(d.cobrado_el)}` : ''}.` }
  }
  if (d.cobrado > 0.004) {
    return { tono: 'falta', texto: `Del ${ejercicio} quedan ${eurosExactos(d.pendiente)} por cobrar de ${eurosExactos(d.importe)} a devolver: llegaron ${eurosExactos(d.cobrado)} al banco.` }
  }
  return { tono: 'falta', texto: `${eurosExactos(d.importe)} a devolver del ${ejercicio}, pendientes de cobrar: Sumied lo da por cobrado cuando llegue al banco.` }
}

/**
 * En qué punto está un 202, en palabras. El 200 del que sale es el de dos
 * años antes para el 1P y el del año anterior para el 2P y el 3P.
 */
export function estado202(p: Pago202, hoy?: string): { tono: 'ok' | 'falta' | 'neutro'; texto: string } {
  const d = p.declaracion
  if (d && PRESENTADAS.has(d.estado)) {
    const presentado = d.c03 ?? d.importe
    if (p.esperado === null || presentado === null) return { tono: 'ok', texto: `Presentado${presentado !== null ? `: ${eurosExactos(presentado)}` : ''}.` }
    const casa = Math.abs(presentado - p.esperado) < 0.005
    return casa
      ? { tono: 'ok', texto: `Presentado: ${eurosExactos(presentado)}, el 18 % de la cuota del ${p.ejercicio_base}. Casa.` }
      : { tono: 'falta', texto: `Presentado: ${eurosExactos(presentado)}, y el 18 % de la cuota del ${p.ejercicio_base} da ${eurosExactos(p.esperado)}. No casa.` }
  }
  if (d?.estado === 'not_required') return { tono: 'neutro', texto: `No hay que presentarlo${d.no_hace_falta ? `: ${d.no_hace_falta}` : ''}.` }
  if (p.cuota_200 === null) {
    // Ese 200 aún no se puede haber presentado (se presenta en julio del año siguiente): se dice, sin pedirlo.
    if (hoy && hoy < `${p.ejercicio_base + 1}-07-01`) return { tono: 'neutro', texto: `Saldrá del Impuesto de sociedades del ${p.ejercicio_base}, que se presenta en julio de ${p.ejercicio_base + 1}.` }
    return { tono: 'falta', texto: `Falta el Impuesto de sociedades del ${p.ejercicio_base}: escribe su cuota abajo y Sumied lo calcula.` }
  }
  if (p.esperado === 0) return { tono: 'neutro', texto: `No hay que presentarlo: el impuesto del ${p.ejercicio_base} salió a cero.` }
  if (d && d.resultado === 'to_pay' && d.importe !== null) {
    return { tono: 'falta', texto: `${eurosExactos(d.importe)} a ingresar (el 18 % de ${eurosExactos(p.cuota_200)}, la cuota del ${p.ejercicio_base}).` }
  }
  return { tono: 'falta', texto: `Saldrá ${eurosExactos(p.esperado ?? 0)} a ingresar (el 18 % de ${eurosExactos(p.cuota_200)}, la cuota del ${p.ejercicio_base}).` }
}

/** Los pagos de antes a después: por año y, dentro, 1P, 2P y 3P. */
export function ordenarPagos(ps: readonly Pago202[]): Pago202[] {
  return [...ps].sort((a, b) => a.ejercicio - b.ejercicio || a.periodo.localeCompare(b.periodo))
}

/** Lo que se escribe de un 200, como lo teclea la persona. */
export interface Formulario200 { ejercicio: string; presentado: string; base: string; cuota: string; resultado: Resultado200 | ''; importe: string; motivo: string }

/** Valida el formulario del 200: los errores por campo, o lo que se manda a conta_impuesto_200_poner. */
export function validar200(f: Formulario200, hoy: string): { errores: Partial<Record<keyof Formulario200, string>>; datos: null | { ejercicio: number; datos: Record<string, unknown>; motivo: string } } {
  const e: Partial<Record<keyof Formulario200, string>> = {}
  const y = /^\d{4}$/.test(f.ejercicio.trim()) ? Number(f.ejercicio.trim()) : null
  if (y === null) e.ejercicio = 'El año del impuesto, con cuatro cifras.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.presentado)) e.presentado = 'La fecha en que se presentó.'
  else if (y !== null && f.presentado <= `${y}-12-31`) e.presentado = `El de ${y} se presenta en ${y + 1}.`
  else if (f.presentado > hoy) e.presentado = 'No puede ser de después de hoy.'
  const base = importeDeTexto(f.base)
  if (base === null) e.base = 'La base imponible, aunque sea negativa.'
  const cuota = importeDeTexto(f.cuota)
  if (cuota === null) e.cuota = 'La cuota; si salió negativa, 0.'
  else if (cuota < 0) e.cuota = 'No puede ser negativa: si salió negativa, es 0.'
  if (!f.resultado) e.resultado = 'A ingresar, a devolver o cero.'
  const importe = f.resultado === 'zero' ? 0 : importeDeTexto(f.importe)
  if (f.resultado && f.resultado !== 'zero' && (importe === null || importe <= 0)) e.importe = 'El importe, sin signo.'
  if (!f.motivo.trim()) e.motivo = 'De dónde salen los datos.'
  if (Object.keys(e).length) return { errores: e, datos: null }
  return { errores: {}, datos: { ejercicio: y!, motivo: f.motivo.trim(), datos: { presentado: f.presentado, base_imponible: base, cuota, resultado: f.resultado, importe } } }
}
