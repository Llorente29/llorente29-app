// src/modules/kitchen/lib/laBusqueda.ts
//
// UNA SOLA CAJA. Escribes «harissa» y salen la pregunta, las respuestas y los
// platos, y cada fila dice POR QUÉ ha salido.
//
// POR QUÉ BUSCAR POR INGREDIENTE NO ES UN LUJO, medido en Foodint el 13/09
// con el ejemplo que puso Julio:
//
//   · «harissa» son DOS fichas: «Pasta Harissa» y «Salsa Mayo Harissa».
//   · Una de las respuestas que la llevan se llama «Sin Salsa Harisa» —con la
//     errata, tal cual está en producción, con una sola ese.
//
// Buscando por nombre esa respuesta no aparece jamás. Buscando por lo que
// LLEVA aparece la primera. El nombre lo escribió una persona con prisa; la
// ficha dice la verdad.

export type PorQueHaSalido = 'se_llama_asi' | 'lleva_eso' | 'las_dos' | 'su_pregunta_lleva_eso'

export interface UnaFicha { id: string; nombre: string }

export interface UnaPreguntaEncontrada {
  id: string
  nombre: string
  marca: string
  cedida: boolean
  activa: boolean
  respuestas: number
  porque: PorQueHaSalido
  cuantasRespuestasSalen: number
}

/** Las respuestas van AGRUPADAS POR NOMBRE: 13 copias de una son una fila. */
export interface UnaRespuestaEncontrada {
  id: string
  nombre: string
  copias: number
  preguntas: number
  marcas: number
  marca: string
  algunaActiva: boolean
  todasActivas: boolean
  /** La ficha que la hizo salir, si salió por lo que lleva. */
  ficha: string | null
  porque: PorQueHaSalido
}

export interface UnPlatoEncontrado {
  id: string
  nombre: string
  marca: string
  cedida: boolean
  porque: PorQueHaSalido
  cuantasPreguntasSalen: number
}

export interface LoEncontrado {
  texto: string
  corto: boolean
  tope: number
  fichas: UnaFicha[]
  preguntas: UnaPreguntaEncontrada[]
  respuestas: UnaRespuestaEncontrada[]
  platos: UnPlatoEncontrado[]
  cuantas: {
    fichas: number
    preguntas: number
    /** FILAS. Con «harissa», 18. */
    respuestas: number
    /** NOMBRES. Con «harissa», 2. Son cosas distintas y se dicen las dos. */
    respuestasDistintas: number
    platos: number
  }
}

export const LA_CAJA = 'Escribe un ingrediente, una respuesta o un plato'

/** Antes de escribir nada. No es un error: es que todavía no has escrito. */
export function elAntesDeBuscar(): string {
  return 'Busca por lo que LLEVA, no sólo por cómo se llama. Escribe «harissa» y salen las respuestas que la llevan, aunque su nombre no la mencione.'
}

export function laReglaDeLaBusqueda(r: LoEncontrado): string {
  if (r.corto) return 'Con una letra sale media carta. Escribe al menos dos.'
  const total = r.cuantas.preguntas + r.cuantas.respuestasDistintas + r.cuantas.platos
  if (total === 0) return `Nada lleva «${r.texto}», y nada se llama así.`
  const partes: string[] = []
  if (r.cuantas.fichas > 0) {
    partes.push(r.cuantas.fichas === 1
      ? '1 ficha de almacén se llama así'
      : `${r.cuantas.fichas} fichas de almacén se llaman así`)
  }
  return partes.length > 0
    ? `${partes[0]}. Y esto es lo que la usa o se llama parecido.`
    : `Nada en el almacén se llama «${r.texto}», pero esto sí:`
}

/** El motivo, en palabras de la casa. Va en la fila, no en una nota al pie. */
export function porQueHaSalido(p: PorQueHaSalido, texto: string): string {
  switch (p) {
    case 'se_llama_asi':          return `Se llama así`
    case 'lleva_eso':             return `Lleva ${texto}`
    case 'las_dos':               return `Se llama así y además lo lleva`
    case 'su_pregunta_lleva_eso': return `Una de sus preguntas lleva ${texto}`
  }
}

/** Los títulos de los tres montones, con la cifra de VERDAD. */
export function tituloDePreguntas(r: LoEncontrado): string {
  return r.cuantas.preguntas === 1 ? '1 pregunta' : `${r.cuantas.preguntas} preguntas`
}

export function tituloDeRespuestas(r: LoEncontrado): string {
  const n = r.cuantas.respuestasDistintas
  return n === 1 ? '1 respuesta' : `${n} respuestas`
}

export function tituloDePlatos(r: LoEncontrado): string {
  return r.cuantas.platos === 1 ? '1 plato' : `${r.cuantas.platos} platos`
}

/**
 * LAS COPIAS SE DICEN, porque son el trabajo que hay detrás.
 * «Salsa Harissa (Picante)» son 13 filas en 13 preguntas: decidirla una vez
 * las resuelve las trece.
 */
export function lasCopiasDeUnaRespuesta(x: UnaRespuestaEncontrada): string {
  if (x.copias === 1) return `En «${x.marca}»`
  const preguntas = x.preguntas === 1 ? '1 pregunta' : `${x.preguntas} preguntas`
  const marcas = x.marcas === 1 ? `de ${x.marca}` : `de ${x.marcas} marcas`
  return `${x.copias} copias, en ${preguntas} ${marcas}`
}

/** Si alguna está apagada se dice: una retirada no se vende. */
export function loApagadoDeUnaRespuesta(x: UnaRespuestaEncontrada): string | null {
  if (x.todasActivas) return null
  if (!x.algunaActiva) return x.copias === 1 ? 'Retirada' : 'Todas retiradas'
  return 'Alguna de las copias está retirada'
}

/**
 * EL CORTE SE DICE, NUNCA SE ESCONDE (regla 7). El total de arriba es el de
 * verdad; esto explica por qué la lista es más corta que el título.
 */
export function loQueNoCabe(mostrados: number, total: number): string | null {
  if (total <= mostrados) return null
  const mas = total - mostrados
  return mas === 1
    ? 'Hay 1 más que no cabe en la lista. Afina la búsqueda para verlo.'
    : `Hay ${mas} más que no caben en la lista. Afina la búsqueda para verlos.`
}
