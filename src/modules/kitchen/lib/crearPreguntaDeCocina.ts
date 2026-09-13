// src/modules/kitchen/lib/crearPreguntaDeCocina.ts
//
// TODO el castellano y TODAS las reglas del tablero 5 (crear una pregunta).
// Sin React y sin Supabase dentro: esto se prueba con filas reales y sin
// navegador, que es lo que hace que las reglas se puedan discutir con Julio
// leyéndolas.
//
// LAS PALABRAS SON LAS DE LA MAQUETA: pregunta, opción, extra, qué lleva,
// «lo que lee el cliente». Ni grupo, ni modificador, ni impacto, ni inglés.
//
// ── LO QUE LA MAQUETA PROMETE Y HOY NO EXISTE (medido el 12/09) ────────────
//
// La maqueta dice, bajo el selector de categorías: «Si más adelante añades un
// plato a la categoría, la pregunta se le pone sola». **Eso no existe.**
// Medido contra producción:
//   · 0 tablas de regla por categoría;
//   · 0 disparadores en `menu_item` que asignen preguntas (los cuatro que hay
//     son de precios, de `updated_at` y del grupo de stock);
//   · `modifier_group_assignment` es plato a plato: `modifier_group_id` +
//     `menu_item_id`, y no tiene columna de categoría.
//
// Así que la categoría es un ATAJO PARA ELEGIR los platos de hoy, y eso es lo
// que dice la ayuda. Pintar la frase de la maqueta sería prometer una regla
// permanente que nadie aplica: el usuario no lo descubriría hoy, lo
// descubriría semanas después con un plato nuevo sin su pregunta. Es la
// familia de la regla 35, y peor, porque el fallo es silencioso y tardío.
//
// Construir la regla de verdad es trabajo de base (tabla + disparador) y es
// decisión de Julio, no mía. Va apuntado, no pintado.

import { MUCHOS } from './preguntasDeCocina'

/** Lo que puede hacer el cliente. Las cuatro que la base ya usa. */
export type TipoNuevaPregunta = 'elige' | 'anade' | 'quita' | 'sugiere'

/**
 * Las respuestas a «qué lleva». Son las SEIS que tiene el CHECK de
 * `modifier_recipe_impact`, ni una inventada ni una escondida.
 *
 * El encargo nombra cinco y deja fuera `no_lleva_nada`. Va incluida a
 * propósito, y esto es el porqué: sin ella, «Sin bebida» o «Sin Extras» no se
 * podrían decidir NUNCA — se quedarían para siempre en la cuenta de las 110,
 * porque no llevan nada y no hay forma de decirlo. Y el tablero 1 ya cuenta
 * `none` como decidida (está escrito en su RPC), así que omitirla aquí dejaría
 * las dos pantallas contando distinto.
 */
export type QueLleva =
  | 'lleva' | 'quita' | 'cambia' | 'multiplica' | 'es_un_plato' | 'no_lleva_nada'

/** Una opción en construcción: un extra con su precio EN ESTA pregunta. */
export interface OpcionNueva {
  /** Id del extra si ya existe en Folvy; null si se va a crear. */
  extraId: string | null
  nombre: string
  /** Lo que suma al precio del plato. 0 = no cobra. */
  precio: number
  /**
   * Qué lleva. `null` = NADIE lo ha decidido todavía, ni aquí ni antes. Ésa es
   * la única que bloquea: ver `porQueNoSePuedeCrear`.
   */
  queLleva: QueLleva | null
  /** Ya venía decidido de antes: no se vuelve a preguntar ni se reescribe. */
  yaEstabaDecidido: boolean
  /** Para la línea de debajo: «Extra que ya existe · en 13 preguntas». */
  enCuantasPreguntas: number
  /** Texto de lo que lleva, cuando ya estaba decidido. Ej: «40 g de SALSA Yogur». */
  queLlevaEnTexto: string | null
}

export interface PlatoElegible {
  id: string
  nombre: string
  categoriaId: string | null
}

export interface CategoriaDeLaCarta {
  id: string
  nombre: string
  cuantosPlatos: number
  /** Preguntas que TODOS sus platos ya tienen. Para el aviso de duplicado. */
  yaTienen: string[]
}

/** El borrador entero, tal y como lo va rellenando la pantalla. */
export interface BorradorDePregunta {
  marcaId: string | null
  marcaNombre: string
  marcaCedida: boolean
  nombre: string
  tipo: TipoNuevaPregunta
  max: number
  obligatoria: boolean
  repetible: boolean
  opciones: OpcionNueva[]
  platosElegidos: string[]
}

// ── Las palabras ────────────────────────────────────────────────────────────

export function tituloDelTipo(t: TipoNuevaPregunta): string {
  switch (t) {
    case 'elige':   return 'Elegir una'
    case 'anade':   return 'Añadir varias'
    case 'quita':   return 'Quitar'
    case 'sugiere': return '¿Te apetece…? (sugerir otro plato)'
  }
}

/** El `group_type` de la base. La pantalla nunca ve estas palabras. */
export function tipoEnLaBase(t: TipoNuevaPregunta): string {
  switch (t) {
    case 'elige':   return 'choice'
    case 'anade':   return 'extras'
    case 'quita':   return 'removal'
    case 'sugiere': return 'cross_sell'
  }
}

export function tituloDelQueLleva(q: QueLleva): string {
  switch (q) {
    case 'lleva':          return 'Lleva…'
    case 'quita':          return 'Quita…'
    case 'cambia':         return 'Cambia…'
    case 'multiplica':     return 'Doble de…'
    case 'es_un_plato':    return 'Es un plato'
    case 'no_lleva_nada':  return 'No lleva nada'
  }
}

/** El `impact_type` de la base. Los SEIS están en su CHECK, medido el 13/09. */
export function queLlevaEnLaBase(q: QueLleva): string {
  switch (q) {
    case 'lleva':         return 'add_item'
    case 'quita':         return 'remove_item'
    case 'cambia':        return 'replace_item'
    case 'multiplica':    return 'multiply'
    case 'es_un_plato':   return 'bundle'
    case 'no_lleva_nada': return 'none'
  }
}

/** Todas, en el orden en que se ofrecen en la pantalla. */
export const LOS_QUE_LLEVA: QueLleva[] =
  ['lleva', 'quita', 'cambia', 'multiplica', 'es_un_plato', 'no_lleva_nada']

/** La regla, en una línea, debajo del título. */
export function laReglaDeLaPantalla(b: BorradorDePregunta): string {
  const marca = b.marcaNombre || 'Sin marca'
  if (b.marcaCedida) {
    return `${marca} · marca cedida · la carta la manda Last, así que aquí no se crean preguntas`
  }
  return `${marca} · marca propia · se publica en Glovo, Uber y la web con la próxima publicación de la carta`
}

// ── Qué puede hacer el cliente, en la cabecera de la pregunta ───────────────
// Misma vara que el tablero 1: por encima de MUCHOS se dice lo que significa,
// porque «Añadir hasta 100» no dice nada. Se importa, no se copia: dos copias
// del mismo umbral es como acaban diciendo cosas distintas.
export function loQueVeraElCliente(b: BorradorDePregunta): string {
  const tope = b.max >= MUCHOS ? null : b.max
  if (b.tipo === 'quita') return tope == null ? 'Quitar las que quiera' : `Quitar hasta ${tope}`
  if (b.tipo === 'anade' || b.tipo === 'sugiere') {
    return tope == null ? 'Añadir los que quiera' : `Añadir hasta ${tope}`
  }
  if (b.obligatoria) {
    return b.max <= 1 ? 'Elegir 1 · obligatoria' : `Elegir de 1 a ${tope ?? b.max} · obligatoria`
  }
  return tope == null ? 'Elegir las que quiera' : `Elegir hasta ${tope}`
}

// ── LO QUE IMPIDE CREAR, y cada cosa con su motivo en castellano ───────────
//
// Devuelve la lista ENTERA, no el primero: quien rellena esto quiere saber
// todo lo que le falta de una vez, no descubrirlo de uno en uno. Y el botón
// dice cuántas faltan, no un «no» a secas (regla 8).
export function porQueNoSePuedeCrear(b: BorradorDePregunta): string[] {
  const faltan: string[] = []

  if (b.marcaCedida) {
    faltan.push('Esta marca es cedida: su carta la manda Last y aquí no se crean preguntas.')
    return faltan   // lo demás sobra: no se va a poder de ninguna manera
  }
  if (!b.marcaId) faltan.push('Falta elegir de qué marca es la pregunta.')
  if (b.nombre.trim() === '') faltan.push('Falta lo que lee el cliente.')

  if (b.opciones.length === 0) {
    faltan.push('Falta al menos una opción: una pregunta sin opciones no sale en las plataformas.')
  }
  const sinDecidir = b.opciones.filter((o) => o.queLleva === null && !o.yaEstabaDecidido)
  if (sinDecidir.length > 0) {
    faltan.push(
      sinDecidir.length === 1
        ? `«${sinDecidir[0].nombre}» no tiene decidido qué lleva.`
        : `${sinDecidir.length} opciones no tienen decidido qué llevan: ${sinDecidir.map((o) => `«${o.nombre}»`).join(', ')}.`,
    )
  }
  const repetidas = nombresRepetidos(b.opciones)
  if (repetidas.length > 0) {
    faltan.push(`Hay dos opciones con el mismo nombre: ${repetidas.map((n) => `«${n}»`).join(', ')}.`)
  }

  if (b.platosElegidos.length === 0) {
    faltan.push('Falta elegir en qué platos va: una pregunta sin platos no la ve ningún cliente.')
  }
  if (b.max < 1) faltan.push('«¿Cuántas como mucho?» tiene que ser 1 o más.')
  if (b.obligatoria && b.tipo === 'elige' && b.opciones.length === 0) {
    faltan.push('Si es obligatoria, tiene que haber algo que elegir.')
  }
  return faltan
}

function nombresRepetidos(ops: OpcionNueva[]): string[] {
  const vistos = new Map<string, number>()
  for (const o of ops) {
    const k = o.nombre.trim().toLowerCase()
    if (k === '') continue
    vistos.set(k, (vistos.get(k) ?? 0) + 1)
  }
  return ops
    .map((o) => o.nombre.trim())
    .filter((n, i, a) => n !== '' && (vistos.get(n.toLowerCase()) ?? 0) > 1 && a.indexOf(n) === i)
}

export function sePuedeCrear(b: BorradorDePregunta): boolean {
  return porQueNoSePuedeCrear(b).length === 0
}

/** El botón dice a cuántos platos va, porque eso es lo que hace (regla 8). */
export function textoDelBotonCrear(b: BorradorDePregunta): string {
  const n = b.platosElegidos.length
  if (n === 0) return 'Crear'
  return n === 1 ? 'Crear y poner en 1 plato' : `Crear y poner en ${n} platos`
}

// ── La confirmación, con contenido ─────────────────────────────────────────
// Regla 8: «Publicado. Avisadas 4 personas» dice algo; «Hecho» no. Y dice
// también lo que NO ha pasado todavía: la carta no sale sola.
export function laConfirmacion(b: BorradorDePregunta, extrasCreados: number): string {
  const platos = b.platosElegidos.length === 1 ? '1 plato' : `${b.platosElegidos.length} platos`
  const ops = b.opciones.length === 1 ? '1 opción' : `${b.opciones.length} opciones`
  const nuevos = extrasCreados === 0 ? ''
    : extrasCreados === 1 ? ' Se ha creado 1 extra nuevo.'
    : ` Se han creado ${extrasCreados} extras nuevos.`
  return `Creada «${b.nombre.trim()}» con ${ops}, puesta en ${platos}.${nuevos}`
    + ' Todavía no está en Glovo ni en Uber: sale con la próxima publicación de la carta.'
}

// ── El atajo por categoría, dicho como lo que es ───────────────────────────
export function ayudaDeLaCategoria(): string {
  return 'Marcar una categoría elige los platos que hay HOY en ella. '
    + 'Es un atajo para no ir uno a uno: no es una regla. '
    + 'Un plato que añadas mañana a esa categoría NO llevará esta pregunta.'
}

export function cuentaDePlatos(cats: CategoriaDeLaCarta[], elegidas: string[]): number {
  return cats.filter((c) => elegidas.includes(c.id)).reduce((a, c) => a + c.cuantosPlatos, 0)
}

// ── El aviso de «esto ya existe» ───────────────────────────────────────────
// El más caro de los avisos: si ya hay una pregunta igual, crear otra duplica
// el trabajo para siempre. Por eso el aviso lleva el nombre de la que existe y
// dónde está, no un «puede que exista».
export function avisoDeParecida(
  nombre: string,
  parecida: { nombre: string; platos: number; opciones: string[] } | null,
): { titulo: string; detalle: string } | null {
  if (!parecida) return null
  const ops = parecida.opciones.slice(0, 3).join(', ')
  return {
    titulo: `¿No es la misma pregunta que «${parecida.nombre}»?`,
    detalle: `${parecida.platos === 1 ? '1 plato ya la tiene' : `${parecida.platos} platos ya la tienen`}`
      + (ops ? `, con ${ops}` : '')
      + `. Si es lo mismo, pon esa en los platos nuevos y no crees «${nombre.trim()}»: `
      + 'así se cambia en un solo sitio y no hay dos versiones que se separen.',
  }
}

// ── La línea de cada opción ────────────────────────────────────────────────
export function lineaDelExtra(o: OpcionNueva): string {
  if (o.yaEstabaDecidido) {
    const donde = o.enCuantasPreguntas === 1 ? 'en 1 pregunta' : `en ${o.enCuantasPreguntas} preguntas`
    return `Extra que ya existe · ${donde}`
  }
  if (o.extraId === null) return 'Extra nuevo · se crea al guardar'
  if (o.enCuantasPreguntas > 1) {
    return `Existe ${o.enCuantasPreguntas} veces y ninguna dice qué lleva. `
      + 'Hasta decidirlo, la pregunta no se puede crear.'
  }
  return 'Este extra todavía no dice qué lleva.'
}

export function precioEnTexto(precio: number): string {
  if (precio === 0) return 'No cobra'
  const s = precio.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `+${s} €`
}
