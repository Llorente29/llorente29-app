// src/modules/conta/impuestos/justificantes.ts
//
// I01c · P1 · «Subir justificantes», lo que no es pantalla: cada fila del
// repaso en palabras, su chip, lo que se manda a la base y las casillas
// escritas a mano cuando el PDF no se pudo leer.

import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { MODELOS_JUSTIFICANTE, tituloJustificante, type Justificante } from '@/modules/conta/lib/justificanteAeat'
import type { TonoChip } from '@/modules/conta/diseno'

/** Lo que dice la base de cada justificante (conta_impuesto_justificantes_repasar). */
export interface Mirado {
  i: number
  estado: 'nuevo' | 'completa' | 'ya_estaba' | 'error'
  motivo: string | null
  declaracion: string | null
  cuenta?: string
  resultado?: 'to_pay' | 'to_refund' | 'to_offset' | 'zero' | null
  importe?: number | null
  presentada?: string | null
  falta_pdf?: boolean
  diferencias?: { casilla: string; sumied: number; presentado: number | null }[]
}

/** Lo que se manda a la base: lo leído, o lo escrito a mano. */
export interface DatosJustificante {
  modelo: string
  ejercicio: number
  periodo: string
  presentada: string
  csv: string
  justificante: string | null
  nif: string
  casillas: Record<string, number>
  resultado: number | null
  devolucion?: boolean
  a_mano?: boolean
  motivo?: string
}

export function datosDe(j: Justificante, resultadoAMano: number | null = null, devolucion = false): DatosJustificante {
  return {
    modelo: j.modelo, ejercicio: j.ejercicio, periodo: j.periodo, presentada: j.presentada, csv: j.csv, justificante: j.justificante,
    nif: j.nif, casillas: j.casillas, resultado: j.resultado?.importe ?? resultadoAMano, ...(devolucion ? { devolucion: true } : {}),
  }
}

/** El chip de cada fila: Leído, Ya estaba o No se pudo leer. */
export function chipDe(m: Pick<Mirado, 'estado'> | null): { tono: TonoChip; texto: string } {
  if (!m || m.estado === 'error') return { tono: 'falta', texto: 'No se pudo leer' }
  if (m.estado === 'ya_estaba') return { tono: 'neutro', texto: 'Ya estaba' }
  return { tono: 'seguro', texto: 'Leído' }
}

/**
 * La línea de debajo del título: «303 · −1.761,96 € a compensar · presentado
 * el 20/10/2025». El importe, con su signo de oficina: a compensar o a devolver
 * van en negativo, como en el justificante.
 */
export function lineaDe(d: Pick<DatosJustificante, 'modelo' | 'presentada' | 'resultado'>, devolucion = false): string {
  const partes = [`modelo ${d.modelo}`]
  if (d.resultado !== null && d.resultado !== undefined) {
    const que = d.resultado > 0 ? 'a ingresar' : d.resultado === 0 ? 'sale a cero' : devolucion ? 'a devolver' : 'a compensar'
    partes.push(`${eurosExactos(d.resultado)} ${que}`)
  } else partes.push('resultado sin leer')
  if (d.presentada) partes.push(`presentado el ${fechaLarga(d.presentada.slice(0, 10))}`)
  return partes.join(' · ')
}

export const tituloDe = tituloJustificante

/** El 303 del último periodo del año que sale negativo: compensar o pedir la devolución lo decide la persona. */
export const pideDevolucion = (d: Pick<DatosJustificante, 'modelo' | 'periodo' | 'resultado'>) =>
  d.modelo === '303' && (d.periodo === '4T' || d.periodo === '12') && (d.resultado ?? 0) < 0

/**
 * Las casillas escritas a mano: una por línea, el número y el importe como en el
 * justificante («27 9.855,66», «[71] -3.723,44»). Devuelve las casillas o la
 * primera línea que no se entiende.
 */
export function casillasEscritas(texto: string): { ok: true; casillas: Record<string, number> } | { ok: false; linea: string } {
  const out: Record<string, number> = {}
  for (const l of texto.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const m = /^\[?(\d{2,3})\]?\s*[:=·]?\s*([-−]?[\d.]*\d(?:,\d{1,2})?)\s*€?$/.exec(l)
    if (!m) return { ok: false, linea: l }
    // El punto, de miles; la coma, decimal (como en el justificante).
    const v = Number(m[2].replace('−', '-').replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(v)) return { ok: false, linea: l }
    out[m[1]] = v
  }
  return { ok: true, casillas: out }
}

/** La casilla del resultado de cada modelo (el 202 no tiene una fija). */
export const casillaResultado = (modelo: string): string | null => MODELOS_JUSTIFICANTE[modelo]?.resultado ?? null

/** El resumen de lo guardado: «Guardados 4 justificantes. 1 no se ha podido: …». Con contenido, regla 8. */
export function resumenGuardado(r: { ok: boolean; titulo: string; mensaje: string }[]): string {
  const bien = r.filter((x) => x.ok)
  const mal = r.filter((x) => !x.ok)
  const partes: string[] = []
  if (bien.length) partes.push(`${bien.length === 1 ? 'Guardado 1 justificante' : `Guardados ${bien.length} justificantes`}: ${bien.map((x) => x.titulo).join(', ')}.`)
  if (mal.length) partes.push(`${mal.length === 1 ? '1 no se ha podido guardar' : `${mal.length} no se han podido guardar`}: ${mal.map((x) => `${x.titulo} (${x.mensaje})`).join('; ')}.`)
  return partes.join(' ') || 'No había nada que guardar.'
}
