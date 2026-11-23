// src/modules/conta/nucleo/recibida/fichaErp10.ts
//
// K11b · Lo que calcula la ficha de la recibida copiada de ERP10 (maqueta nucleo_17a), sin pantalla:
//   · la suma de control de las contrapartidas contra la base (en ámbar si no cuadra; pieza 12);
//   · las filas de «Pago factura»: los pagos hechos, y la propuesta del K06 si aún no hay ninguno; lo pendiente, en
//     ámbar si los pagos no llegan al total;
//   · la «Visualización del asiento» (pieza 7): el de la factura y, debajo, el de cada pago, con su número;
//   · la cuadrícula del IVA de ERP10: dos filas de dos tipos (base, %, cuota).

import type { LineaVisible } from '../piezas/Ventana'
import { estadoDePagos, cuantosPagos } from './pagos'

const cent = (x: number) => Math.round(x * 100)

/** Las líneas de contrapartida suman la base: «Suma 329,32 · cuadra con la base», o en ámbar lo que falta o sobra. */
export function sumaDeContrapartidas(importes: readonly (number | null)[], base: number): { suma: number; cuadra: boolean; diferencia: number } {
  const suma = importes.reduce<number>((t, x) => t + (x ?? 0), 0)
  const diferencia = (cent(base) - cent(suma)) / 100
  return { suma: cent(suma) / 100, cuadra: cent(suma) === cent(base), diferencia }
}

/** El rótulo de la suma de control, como la maqueta 18b; con el motivo para el `title` si no cuadra. */
export function rotuloDeLaSuma(r: { suma: number; cuadra: boolean; diferencia: number }, cifra: (n: number) => string): { texto: string; motivo: string | null } {
  if (r.cuadra) return { texto: `Suma ${cifra(r.suma)} · cuadra con la base`, motivo: null }
  return {
    texto: `Suma ${cifra(r.suma)} · no cuadra`,
    motivo: r.diferencia > 0 ? `Faltan ${cifra(r.diferencia)} para llegar a la base.` : `Pasa de la base en ${cifra(-r.diferencia)}.`,
  }
}

/** Lo que dice «⊕ otra línea · 3 líneas». */
export const otraLinea = (n: number): string => `otra línea · ${n} ${n === 1 ? 'línea' : 'líneas'}`
export const otroPago = (n: number): string => `otro pago · ${cuantosPagos(n)}`

export interface FilaDePago {
  /** El pago de la base (null: la propuesta del K06, que se apunta al validar). */
  id: string | null
  ejercicio: string
  documento: string
  cuenta: string
  fecha: string
  concepto: string
  importe: number
}

/**
 * Las filas de «Pago factura» y lo pendiente. Con pagos: uno por fila. Sin ninguno y por validar: la propuesta (la
 * cuenta del K06 por lo que queda, o vacía: pendiente de pagar), sin documento. Lo pendiente sale en ámbar si los pagos no llegan al total, con su
 * motivo para el `title`.
 */
export function filasDePago(o: {
  total: number
  pagos: readonly { id: string; fecha: string; importe: number; cuenta: string | null; concepto: string; serie: number | null; numero: number | null }[]
  propuesta: { cuenta: string; fecha: string; concepto: string } | null
  cifra: (n: number) => string
}): { filas: FilaDePago[]; pendiente: number; ambar: boolean; motivo: string | null } {
  const e = estadoDePagos(o.total, o.pagos)
  const anio = (f: string) => f.slice(0, 4)
  const filas: FilaDePago[] = o.pagos.map((p) => ({
    id: p.id, ejercicio: anio(p.fecha), documento: p.numero === null ? '' : String(p.numero), cuenta: p.cuenta ?? '', fecha: p.fecha, concepto: p.concepto, importe: p.importe,
  }))
  // La fila de la propuesta sale siempre por validar, también vacía (pendiente de pagar): es donde se escribe la cuenta.
  if (!filas.length && o.propuesta) {
    filas.push({ id: null, ejercicio: anio(o.propuesta.fecha || ''), documento: '', cuenta: o.propuesta.cuenta, fecha: o.propuesta.fecha, concepto: o.propuesta.concepto, importe: e.pendiente })
  }
  const ambar = o.total > 0 && e.pendiente > 0.005 && o.pagos.length > 0
  return {
    filas, pendiente: e.pendiente, ambar,
    motivo: ambar ? `Los pagos suman ${o.cifra(e.pagado)}: faltan ${o.cifra(e.pendiente)} para el total de ${o.cifra(o.total)}.` : null,
  }
}

/** De las líneas de un asiento (debe / haber) a la visualización de ERP10: cada una a su lado, con su importe. */
export function aVisual(lineas: readonly { codigo: string; nombre: string; debe: number | null; haber: number | null }[]): LineaVisible[] {
  const r: LineaVisible[] = []
  for (const l of lineas) {
    if (l.debe) r.push({ importe: l.debe, cuenta: l.codigo, nombre: l.nombre, lado: 'debe' })
    if (l.haber) r.push({ importe: l.haber, cuenta: l.codigo, nombre: l.nombre, lado: 'haber' })
  }
  return r
}

/** La cuadrícula del IVA de ERP10: dos filas de dos tipos; los que haya, en orden, y el resto vacíos. */
export function cuadriculaIva<T>(lineas: readonly T[]): (T | null)[][] {
  const n = Math.max(4, lineas.length + (lineas.length % 2))
  const todos: (T | null)[] = Array.from({ length: n }, (_, i) => lineas[i] ?? null)
  const filas: (T | null)[][] = []
  for (let i = 0; i < todos.length; i += 2) filas.push([todos[i], todos[i + 1]])
  return filas
}

/**
 * El IVA deducible de «Otros datos» (K11a) en la visualización: lo que no se deduce de cada 472 pasa al gasto, repartido
 * entre las líneas de gasto por su importe (la última se queda los céntimos). Al 100 %, las líneas tal cual.
 */
export function conIvaDeducible<T extends { codigo: string; debe: number | null; haber: number | null }>(lineas: readonly T[], pct: number): T[] {
  if (!(pct >= 0 && pct < 100)) return [...lineas]
  const esIva = (l: T) => /^472/.test(l.codigo) && (l.debe ?? 0) !== 0
  const esGasto = (l: T) => !/^472/.test(l.codigo) && (l.debe ?? 0) !== 0 && !/^4[01]/.test(l.codigo)
  let noDeduce = 0
  const r = lineas.map((l) => {
    if (!esIva(l)) return { ...l }
    const fuera = Math.round(cent(l.debe ?? 0) * (100 - pct) / 100)
    noDeduce += fuera
    return { ...l, debe: (cent(l.debe ?? 0) - fuera) / 100 }
  })
  const gastos = r.map((l, i) => [l, i] as const).filter(([l]) => esGasto(l))
  const total = gastos.reduce((t, [l]) => t + cent(l.debe ?? 0), 0)
  if (!noDeduce || !gastos.length || !total) return r
  let puesto = 0
  gastos.forEach(([l, i], k) => {
    const parte = k === gastos.length - 1 ? noDeduce - puesto : Math.round(noDeduce * cent(l.debe ?? 0) / total)
    puesto += parte
    r[i] = { ...l, debe: (cent(l.debe ?? 0) + parte) / 100 }
  })
  return r
}

/**
 * El cambio de una línea para conta_recibida_otros_datos: su posición y SOLO las claves que cambian (20261123T1750: la
 * base deja como está lo que no viene, y una clave con null la borra). Nunca rellena lo que no cambia con lo leído: una
 * lectura que aún no ha vuelto borraría la marca al elegir la plataforma (e2e 45225555049).
 */
export function cambioDeLinea(posicion: number, c: { concepto?: string | null; marca?: string | null; plataforma?: string | null }):
  { posicion: number; concepto?: string | null; marca?: string | null; plataforma?: string | null } {
  const r: { posicion: number; concepto?: string | null; marca?: string | null; plataforma?: string | null } = { posicion }
  if (c.concepto !== undefined) r.concepto = c.concepto
  if (c.marca !== undefined) r.marca = c.marca
  if (c.plataforma !== undefined) r.plataforma = c.plataforma
  return r
}
