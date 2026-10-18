// src/modules/conta/services/impuestosService.ts
//
// I01a · Impuestos por dentro. Lo que el front escribe de Impuestos va por
// funciones de la base (security definer): las respuestas del alta, que
// hasta el I01a se usaban para proponer los modelos y se tiraban, y los
// modelos que salen de las reglas de la base.

import { rpc } from '@/modules/conta/services/bd'
import type { Calendario } from '@/modules/conta/impuestos/calendario'

/** Las preguntas del paso «impuestos» del alta que deciden modelos. */
const CLAVES_DEL_ALTA = ['retiene', 'alquiler', 'retenido70'] as const

/**
 * Guarda, como datos de la empresa con quién y cuándo, las respuestas del
 * paso «impuestos»: «sí», «no» o «No lo sé» (__nolose). Las que no se
 * preguntaron no se envían. Devuelve cuántas se guardaron.
 */
export async function guardarRespuestasDelAlta(companyId: string, respuestas: Partial<Record<string, string>>): Promise<number> {
  const p: Record<string, string> = {}
  for (const k of CLAVES_DEL_ALTA) {
    const v = respuestas[k]
    if (v === 'si' || v === 'no' || v === '__nolose') p[k] = v
  }
  if (Object.keys(p).length === 0) return 0
  return rpc<number>('conta_impuesto_datos_del_alta', { p_company: companyId, p_respuestas: p })
}

/** Lo que devuelve conta_impuesto_obligaciones_calcular por cada modelo. */
interface ObligacionCalculada {
  modelo: string
  presenta: boolean
  regla: string
  por_que: string
  hecho: 'igual' | 'nuevo' | 'cambiado' | 'no_toca' | 'lo_decidio_una_persona'
}

/**
 * Escribe los modelos que dicen las reglas de la base (cada uno con su regla,
 * sus datos y su porqué; lo que decidió una persona no se toca) y devuelve los
 * que presenta, ordenados, con el porqué de cada uno en una frase.
 */
export async function calcularObligaciones(companyId: string): Promise<{ modelos: string[]; porque: string }> {
  const filas = await rpc<ObligacionCalculada[]>('conta_impuesto_obligaciones_calcular', { p_company: companyId })
  const presenta = filas.filter((f) => f.presenta).sort((a, b) => a.modelo.localeCompare(b.modelo))
  return {
    modelos: presenta.map((f) => f.modelo),
    porque: presenta.length
      ? presenta.map((f) => `${f.modelo}: ${f.por_que}`).join(' ')
      : 'Con lo que me has dicho, no presentas ningún modelo de los que conozco.',
  }
}

// ── I01b · Las pantallas de Impuestos ──────────────────────────────────────


/** Lo que pinta Impuestos › Calendario (conta_impuesto_calendario). */
export function leerCalendario(companyId: string, hoy?: string): Promise<Calendario> {
  return rpc<Calendario>('conta_impuesto_calendario', { p_company: companyId, ...(hoy ? { p_hoy: hoy } : {}) })
}

/** «+ Añadir otro impuesto»: con su motivo, queda quién y cuándo (conta_impuesto_obligacion_decidir). */
export function anadirImpuesto(companyId: string, modelo: string, motivo: string): Promise<string> {
  return rpc<string>('conta_impuesto_obligacion_decidir', { p_company: companyId, p_form: modelo, p_presenta: true, p_motivo: motivo })
}

/** Lo que devuelve conta_impuesto_303_calcular. */
export interface Calculo303 { declaracion: string; desde: string; hasta: string; apuntes: number; resultado: string; importe: number }

/** Calcula (o recalcula) el borrador del 303 de un periodo desde el libro de IVA. */
export function calcular303(companyId: string, ejercicio: number, periodo: string): Promise<Calculo303> {
  return rpc<Calculo303>('conta_impuesto_303_calcular', { p_company: companyId, p_year: ejercicio, p_period: periodo })
}
