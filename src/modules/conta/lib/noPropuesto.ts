// src/modules/conta/lib/noPropuesto.ts
//
// S01 · PR 3 · Entrega 5 (PC01): «Lo que no he podido proponer, y por qué», en
// cada apartado y no en Asientos. Los asientos se proponen solos en la base
// (al pasar lo que los origina y en la pasada de las 03:40); lo que no se puede
// proponer queda en conta_propuesta_pendiente con su porqué en palabras de
// oficina (qué falta y qué hacer) y el apartado donde se arregla. Estos son
// esos apartados, con las MISMAS palabras que escribe la base: una prueba las
// compara con las migraciones (regla 40: un texto entre comillas no lo mira tsc).

export const DONDE = {
  /** Las nóminas, hasta Laboral (encargo PC01, entrega 5, punto 6). */
  asientos: 'Contabilidad › Asientos',
  /** Lo recibido sin factura (y el pago a proveedor): se decide en Compras. */
  recibidas: 'Compras y gastos › Facturas recibidas',
  /** El socio de marca y la liquidación de plataforma (V01 · Entrega 3). */
  liquidaciones: 'Ventas › Liquidaciones',
  /** El no confirmado que una liquidación paga después. */
  cierres: 'Ventas › Cierres del día',
} as const

export type Donde = (typeof DONDE)[keyof typeof DONDE]

/** Una fila de lo que no se ha podido proponer. */
export interface NoPropuesto {
  id: string
  origen: string
  que: string
  porque: string
  /** Cuándo se intentó por última vez (ISO). */
  at: string
}

/** El título, con cuántos (regla 7: una pantalla que se abre a propósito no esconde filas). */
export function tituloNoPropuesto(n: number): string {
  return n === 1 ? 'Lo que no he podido proponer, y por qué · 1' : `Lo que no he podido proponer, y por qué · ${n}`
}
