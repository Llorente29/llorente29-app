// src/modules/conta/alta/programa.ts
//
// C06, respuesta 4 (retoque 1): «¿De qué programa vienes?», en el paso de las
// cuentas del alta. Puro: la lista, lo que se entiende de lo que escribe la
// persona y lo que se le dice con cada respuesta.
//
// Lo que pasa con cada una (Julio):
//   · Cegid Diez: el plan se activa al terminar el alta, y el histórico (con
//     sus subcuentas) llega después con la tarjeta de Diez del Inicio.
//   · cualquier otro: el plan contable, y la pantalla dice la verdad — de
//     momento no se traen solos los datos de ese programa. Ningún botón
//     promete una importación que no existe.
//   · de cero: el plan contable.
// La respuesta se guarda con su registro (conta_programa_anterior, 0400).

import { normalizar } from '@/modules/conta/alta/actividades'

export type ProgramaAnterior = 'diez' | 'holded' | 'sage' | 'a3' | 'contasol' | 'quipu' | 'otro' | 'ninguno'

/** Las respuestas de un toque, en el orden de la pregunta. «Otro» pide el nombre. */
export const PROGRAMAS: { valor: ProgramaAnterior; texto: string; palabras: string[] }[] = [
  { valor: 'diez', texto: 'Cegid Diez', palabras: ['diez', 'cegid'] },
  { valor: 'holded', texto: 'Holded', palabras: ['holded'] },
  { valor: 'sage', texto: 'Sage', palabras: ['sage'] },
  { valor: 'a3', texto: 'a3', palabras: ['a3', 'a3con', 'a3asesor', 'a3innuva', 'wolters'] },
  { valor: 'contasol', texto: 'ContaSol', palabras: ['contasol'] },
  { valor: 'quipu', texto: 'Quipu', palabras: ['quipu'] },
  { valor: 'otro', texto: 'Otro', palabras: [] },
  { valor: 'ninguno', texto: 'Empiezo de cero', palabras: ['cero', 'ninguno', 'ninguna', 'nada', 'ningun', 'nuevo', 'nueva'] },
]

export interface Respuesta { programa: ProgramaAnterior; otro: string | null }

/**
 * Lo que escribió (o tocó) la persona. Un valor de la lista es ese programa;
 * «otro:<nombre>», «Otro» con su nombre; y un texto suelto, el programa de la
 * lista que nombre, o «Otro» con ese texto como nombre. Null: «Otro» sin
 * nombre todavía (hay que pedirlo).
 */
export function entenderPrograma(valor: string): Respuesta | null {
  const v = valor.trim()
  if (v.startsWith('otro:')) {
    const nombre = v.slice(5).trim()
    return nombre ? { programa: 'otro', otro: nombre } : null
  }
  if (v === 'otro') return null
  const exacto = PROGRAMAS.find((p) => p.valor === v)
  if (exacto) return { programa: exacto.valor, otro: null }
  const t = ` ${normalizar(v).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  const encajan = PROGRAMAS.filter((p) => p.palabras.some((w) => t.includes(` ${w} `)))
  if (encajan.length === 1) return { programa: encajan[0].valor, otro: null }
  if (v === '') return null
  return { programa: 'otro', otro: v }
}

export const nombrePrograma = (r: Respuesta): string =>
  r.programa === 'otro' ? (r.otro ?? 'otro programa') : PROGRAMAS.find((p) => p.valor === r.programa)?.texto ?? r.programa

/** El nombre del plan, tal cual lo eligió en la pregunta anterior. */
const nombrePlan = (plan: 'pymes' | 'normal') => (plan === 'normal' ? 'el plan general contable' : 'el plan general contable de pymes')

/** Lo que se le dice al contestar: la verdad de lo que pasa con su respuesta. */
export function fraseDePrograma(r: Respuesta, plan: 'pymes' | 'normal'): string {
  if (r.programa === 'diez') {
    return `Vienes de Cegid Diez: al terminar el alta activo ${nombrePlan(plan)}, y tu histórico, con tus subcuentas, lo traigo después. En el Inicio verás cómo va.`
  }
  if (r.programa === 'ninguno') return `Empezamos de cero, con ${nombrePlan(plan)}: lo activo al terminar el alta.`
  return `De momento no traigo solo los datos de ${nombrePrograma(r)}; empezamos con ${nombrePlan(plan)} y te ayudamos a pasar los saldos.`
}
