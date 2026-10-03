// src/modules/conta/alta/llevamos.ts
//
// «Lo que llevamos» (respuesta 3 del C00; maquetas N1bAlta y N1cAlta): los
// seis puntos del alta, cada uno hecho (✓), preguntándose (punto azul) o por
// hacer (círculo vacío), y el «4 de 6». Puro.
//
// Volver atrás no tiene botón: tocar un punto hecho (o su píldora) devuelve la
// conversación a ese punto, y también vale decirlo («cambia la dirección»).
// Este fichero dice A QUÉ PASO y A QUÉ PREGUNTAS se vuelve.

import { PASOS, type ClavePregunta, type PasoAlta } from '@/modules/conta/alta/guion'
import { normalizar } from '@/modules/conta/alta/actividades'

export type ClavePunto = 'quien' | 'donde' | 'actividad' | 'impuestos' | 'cuentas' | 'banco'
export type EstadoPunto = 'hecho' | 'actual' | 'falta'

export interface DefPunto {
  clave: ClavePunto
  etiqueta: string
  /** El paso del alta donde se pregunta. */
  paso: PasoAlta
  /** Las preguntas de ese paso que son de este punto. */
  preguntas: ClavePregunta[]
  /** Lo que se enseña mientras falta. */
  falta: string
}

export const PUNTOS: DefPunto[] = [
  { clave: 'quien', etiqueta: 'Quién eres', paso: 'nombre', preguntas: ['nif', 'nombre'], falta: 'Lo primero' },
  { clave: 'donde', etiqueta: 'Dónde', paso: 'nombre', preguntas: ['direccion'], falta: 'Enseguida' },
  { clave: 'actividad', etiqueta: 'A qué te dedicas', paso: 'actividad', preguntas: ['actividad'], falta: 'Enseguida' },
  { clave: 'impuestos', etiqueta: 'Tus impuestos', paso: 'impuestos', preguntas: ['periodo', 'retiene', 'alquiler', 'retenido70'], falta: 'Enseguida' },
  { clave: 'cuentas', etiqueta: 'Tus cuentas', paso: 'cuentas', preguntas: ['cuentas'], falta: 'Enseguida' },
  { clave: 'banco', etiqueta: 'Tu banco', paso: 'banco', preguntas: ['banco'], falta: 'Al final, si quieres' },
]

export const TOTAL_PUNTOS = PUNTOS.length

export interface Punto extends DefPunto {
  estado: EstadoPunto
  /** Lo apuntado, en una línea; null si aún no hay nada. */
  valor: string | null
}

export interface EntradaLlevamos {
  paso: PasoAlta
  /** La pregunta que se está haciendo ahora (null si ninguna). */
  actual: ClavePregunta | null
  /** Lo apuntado de cada punto. */
  valores: Partial<Record<ClavePunto, string | null>>
  /** En el paso «nombre», qué preguntas ya se contestaron (también con «No lo sé»). */
  contestadas?: ClavePregunta[]
}

const orden = (p: PasoAlta) => PASOS.indexOf(p)

export function loQueLlevamos(e: EntradaLlevamos): Punto[] {
  return PUNTOS.map((def) => {
    const valor = e.valores[def.clave] ?? null
    let estado: EstadoPunto
    if (e.actual !== null && def.preguntas.includes(e.actual)) estado = 'actual'
    else if (orden(e.paso) > orden(def.paso)) estado = 'hecho'
    else if (orden(e.paso) === orden(def.paso) && def.paso === 'nombre'
      && (valor !== null || def.preguntas.some((q) => e.contestadas?.includes(q)))) estado = 'hecho'
    else estado = 'falta'
    return { ...def, estado, valor }
  })
}

export const cuantosHechos = (puntos: Punto[]): number => puntos.filter((p) => p.estado === 'hecho').length

/**
 * El «4 de 6» de una empresa a medias, para el aviso de «Tu empresa», con lo
 * que trae la lista de empresas (el paso, y si ya tiene nombre y dirección).
 */
export function hechosDeUnaAMedias(paso: string | null, tieneNombre: boolean, tieneDireccion: boolean): number {
  const p: PasoAlta = (PASOS as string[]).includes(paso ?? '') ? paso as PasoAlta : 'nif'
  return cuantosHechos(loQueLlevamos({
    paso: p, actual: null,
    valores: { quien: tieneNombre ? 'sí' : null, donde: tieneDireccion ? 'sí' : null },
  }))
}

/**
 * Se puede volver a un punto si ya se ha pasado por él. Lo que falta no se
 * adelanta (las preguntas de después dependen de las de antes), y con el alta
 * terminada se cambia en «Tu empresa».
 */
export function sePuedeVolver(punto: Punto, paso: PasoAlta): boolean {
  return paso !== 'hecho' && punto.estado === 'hecho'
}

/**
 * Las respuestas con las que se vuelve a un punto: las demás preguntas de su
 * paso se dan por contestadas, para que solo se repregunte lo de este punto.
 */
export function respuestasParaVolver(def: DefPunto, preguntasDelPaso: ClavePregunta[]): Partial<Record<ClavePregunta, string>> {
  const r: Partial<Record<ClavePregunta, string>> = {}
  for (const q of preguntasDelPaso) if (!def.preguntas.includes(q)) r[q] = '__ya'
  return r
}

// ── «Cambia la dirección» ───────────────────────────────────────────────────

const PALABRAS: [ClavePunto, string[]][] = [
  ['quien', ['nombre', 'razon social', 'nif', 'cif']],
  ['donde', ['direccion', 'domicilio fiscal', 'calle', 'codigo postal']],
  ['actividad', ['actividad', 'actividades', 'epigrafe', 'a que me dedico', 'a que nos dedicamos', 'iae', 'cnae']],
  ['impuestos', ['impuestos', 'iva', 'modelos', 'retenciones', 'alquiler']],
  ['cuentas', ['cuentas', 'plan', 'plan contable', 'ejercicio']],
  ['banco', ['banco', 'iban']],
]

/**
 * Si lo que escribió la persona es «cambia X» (o «cambiar», «corrige»,
 * «vuelve a», «me he equivocado en»), el punto al que quiere volver.
 */
export function puntoQuePide(texto: string): ClavePunto | null {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  if (!/ (cambia|cambiar|cambiame|corrige|corregir|vuelve a|volver a|me he equivocado|esta mal|no es) /.test(t)) return null
  for (const [clave, palabras] of PALABRAS) {
    if (palabras.some((p) => t.includes(` ${p} `))) return clave
  }
  return null
}
