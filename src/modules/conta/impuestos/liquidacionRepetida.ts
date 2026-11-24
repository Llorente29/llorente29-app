// src/modules/conta/impuestos/liquidacionRepetida.ts
//
// S01p·21 · Una liquidación de IVA apuntada dos veces en un trimestre (Julio, 13/11): lo que
// dice Impuestos › Trimestre. Puro: las frases, sin pantalla ni base.

import { eurosExactos } from '@/modules/conta/lib/formato'

/** Una de las liquidaciones repetidas del trimestre (conta_liquidaciones_repetidas). */
export interface LiquidacionRepetida {
  asiento: string; serie: number; numero: number | null; fecha: string; concepto: string | null; importe: number
  traida: boolean; enlazada: boolean; repetida: boolean
  contraasiento: string | null; contra_serie: number | null; contra_numero: number | null; contra_fecha: string | null
}

const dia = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—')
export const nombreAsiento = (serie: number | null, numero: number | null) => `${serie ?? '—'}/${numero ?? '—'}`

/** ¿Queda algo por decidir? Hay más de una y no está ya resuelta (una enlazada y las demás sin efecto). */
export function quedaPorDecidir(xs: readonly LiquidacionRepetida[]): boolean {
  if (xs.length < 2) return false
  return !(xs.some((x) => x.enlazada) && xs.filter((x) => !x.enlazada).every((x) => x.repetida && x.contraasiento))
}

/** La línea de cada una: número, fecha, de dónde viene, su concepto y lo que salda de la 477. */
export function lineaLiquidacion(x: LiquidacionRepetida): string {
  return `${nombreAsiento(x.serie, x.numero)} · ${dia(x.fecha)}${x.traida ? ' · traída de Diez' : ''}${x.concepto ? ` · ${x.concepto}` : ''} · 477 ${eurosExactos(x.importe)}`
}

/** Su estado, en palabras. */
export function estadoLiquidacion(x: LiquidacionRepetida): string | null {
  if (x.enlazada) return 'La del 303'
  if (x.repetida && x.contraasiento) return `Sin efecto: contraasiento ${nombreAsiento(x.contra_serie, x.contra_numero)} del ${dia(x.contra_fecha)}`
  return null
}

/** La frase de arriba, resuelta o no. */
export function fraseRepetida(xs: readonly LiquidacionRepetida[]): string {
  const buena = xs.find((x) => x.enlazada)
  if (!quedaPorDecidir(xs) && buena) {
    const otras = xs.filter((x) => !x.enlazada).map((x) => `la ${nombreAsiento(x.serie, x.numero)} con el contraasiento ${nombreAsiento(x.contra_serie, x.contra_numero)} del ${dia(x.contra_fecha)}`)
    return `Resuelta: se deja la ${nombreAsiento(buena.serie, buena.numero)}; ${otras.join(' y ')} queda${otras.length === 1 ? '' : 'n'} sin efecto. Ningún libro de IVA cambió.`
  }
  return `Este trimestre tiene la liquidación de IVA apuntada ${xs.length === 2 ? 'dos' : String(xs.length)} veces, con los mismos apuntes. Deja solo una: el 303 queda con ella y ${xs.length === 2 ? 'la otra queda' : 'las otras quedan'} sin efecto con un contraasiento en el primer día abierto. Ningún libro de IVA cambia.`
}
