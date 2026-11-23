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

/**
 * La cuadrícula del IVA de ERP10: dos tipos por fila, y después del último el sitio del ⊕ (otro tipo). Solo las filas que
 * hacen falta (Respuesta K11b · 4): con un tipo, una fila (el tipo y el ⊕); la segunda sale al usar el segundo tipo.
 * `'mas'` es el sitio del ⊕; null, un hueco vacío.
 */
export function cuadriculaIva<T>(lineas: readonly T[], conMas = true): (T | 'mas' | null)[][] {
  const todos: (T | 'mas' | null)[] = [...lineas, ...(conMas ? ['mas' as const] : [])]
  if (!todos.length) todos.push(null)
  if (todos.length % 2) todos.push(null)
  const filas: (T | 'mas' | null)[][] = []
  for (let i = 0; i < todos.length; i += 2) filas.push([todos[i], todos[i + 1]])
  return filas
}

/** Cuántas letras caben en una casilla de la analítica (local, marca, plataforma) antes de pasar a su código corto. */
export const LETRAS_ANALITICA = 16

/**
 * Lo que se ve en una casilla de la analítica (Respuesta K11b · 4, punto 3): su nombre entero si cabe; si no, el código
 * corto (el de la analítica) si lo tiene y es más corto. El nombre entero va siempre en el `title`.
 */
export function vistaAnalitica(r: { codigo: string; descripcion: string }, letras = LETRAS_ANALITICA): string {
  // El código, solo si de verdad es más corto que el nombre (un slug largo no ayuda).
  return r.descripcion.length <= letras || !r.codigo || r.codigo.length >= r.descripcion.length ? r.descripcion : r.codigo
}

/** El ancho de la columna (en letras): lo que pide el nombre más largo que se ve, entre 6 y el tope. */
export function letrasDeLaColumna(registros: readonly { codigo: string; descripcion: string }[], letras = LETRAS_ANALITICA): number {
  const largo = registros.reduce((m, r) => Math.max(m, Math.min(vistaAnalitica(r, letras).length, letras)), 0)
  return Math.max(6, largo)
}

/**
 * El asiento del pago que aún no se ha hecho (la fila de «Pago factura» por validar), para la visualización: al debe el
 * proveedor y al haber la cuenta del pago, como en la maqueta 17a. Sin cuenta, sin proveedor o sin importe, nada.
 */
export function pagoPorHacer(o: { proveedor: { codigo: string; nombre: string } | null; cuenta: string; nombreCuenta: string; importe: number }): LineaVisible[] {
  if (!o.proveedor || !o.cuenta.trim() || !(o.importe > 0)) return []
  return [
    { importe: o.importe, cuenta: o.proveedor.codigo, nombre: o.proveedor.nombre, lado: 'debe' },
    { importe: o.importe, cuenta: o.cuenta.trim(), nombre: o.nombreCuenta, lado: 'haber' },
  ]
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
