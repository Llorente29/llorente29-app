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
//
// LLEVA `editando` PORQUE LA FRASE CAMBIA, y no es un matiz: al CREAR, una
// respuesta sin decidir impide crear; al EDITAR, no impide nada — se ofrece
// resolverla. La primera versión decía «hasta decidirlo, la pregunta no se
// puede crear» también editando, que es exactamente lo contrario del remate de
// Julio y habría empujado a la gente a no tocar nada. Lo cazó la captura.
export function lineaDelExtra(o: OpcionNueva, editando = false): string {
  if (o.yaEstabaDecidido) {
    const donde = o.enCuantasPreguntas === 1 ? 'en 1 pregunta' : `en ${o.enCuantasPreguntas} preguntas`
    return `Extra que ya existe · ${donde}`
  }
  if (o.extraId === null) return 'Extra nuevo · se crea al guardar'
  if (o.enCuantasPreguntas > 1) {
    return `Existe ${o.enCuantasPreguntas} veces y ninguna dice qué lleva.`
      + (editando ? '' : ' Hasta decidirlo, la pregunta no se puede crear.')
  }
  return 'Este extra todavía no dice qué lleva.'
}

export function precioEnTexto(precio: number): string {
  if (precio === 0) return 'No cobra'
  const s = precio.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `+${s} €`
}

// ═══════════════════════════════════════════════════════════════════════════
// EDITAR UNA PREGUNTA QUE YA EXISTE (13/09)
// ═══════════════════════════════════════════════════════════════════════════
//
// La asimetría, y es deliberada: CREAR exige decir qué lleva cada respuesta —
// una opción nueva sin efecto es la fila 111 mientras limpiamos las 110—, pero
// EDITAR no obliga a resolverlo todo de golpe. Si entrar a corregir un precio
// obligara a resolver nueve fichas, nadie entraría a corregir el precio, y la
// deuda se quedaría quieta por prudencia.
//
// EL REMATE DE JULIO (13/09 10:10): que editar OFREZCA resolverlas. Ofrecer, no
// obligar. Así la deuda baja sola cada vez que alguien entra a tocar cualquier
// cosa, en vez de esperar a que alguien se siente a hacer una limpieza que
// nadie tiene tiempo de hacer.

/** Cuántas respuestas de esta pregunta siguen sin decir qué llevan. */
export function cuantasSinDecidir(ops: OpcionNueva[]): number {
  return ops.filter((o) => o.queLleva === null && !o.yaEstabaDecidido).length
}

/**
 * La invitación al editar. `null` cuando no hay deuda: un aviso que aparece
 * siempre deja de leerse, y decir «0 sin decidir» en una pregunta limpia es
 * ruido con cara de dato.
 */
export function laDeudaDeEstaPregunta(ops: OpcionNueva[]): string | null {
  const n = cuantasSinDecidir(ops)
  if (n === 0) return null
  return n === 1
    ? 'Una de estas respuestas todavía no dice qué lleva. ¿La dejamos resuelta ahora?'
    : `${n} de estas respuestas todavía no dicen qué llevan. ¿Las dejamos resueltas ahora?`
}

/**
 * Lo que impide GUARDAR una pregunta que ya existe. Es `porQueNoSePuedeCrear`
 * menos las dos exigencias que solo tienen sentido al estrenarla:
 *   · las respuestas viejas sin decidir NO bloquean (se ofrecen, ver arriba);
 *   · los platos tampoco: se eligen en el tablero 3, y una pregunta que ya
 *     estaba en platos no se queda sin ellos por editarle el nombre.
 * Lo que SÍ sigue bloqueando: la marca cedida, el texto vacío, quedarse sin
 * respuestas, los nombres repetidos y una respuesta NUEVA sin efecto.
 */
export function porQueNoSePuedeGuardar(b: BorradorDePregunta): string[] {
  const faltan: string[] = []
  if (b.marcaCedida) {
    return ['Esta marca es cedida: su carta la manda Last y aquí no se edita.']
  }
  if (b.nombre.trim() === '') faltan.push('Falta lo que lee el cliente.')
  if (b.opciones.length === 0) {
    faltan.push('Falta al menos una respuesta: una pregunta sin respuestas no sale en las plataformas.')
  }
  const nuevasSinEfecto = b.opciones.filter(
    (o) => o.extraId === null && o.queLleva === null && !o.yaEstabaDecidido,
  )
  if (nuevasSinEfecto.length > 0) {
    faltan.push(
      nuevasSinEfecto.length === 1
        ? `«${nuevasSinEfecto[0].nombre}» es nueva y no dice qué lleva.`
        : `${nuevasSinEfecto.length} respuestas nuevas no dicen qué llevan: `
          + nuevasSinEfecto.map((o) => `«${o.nombre}»`).join(', ') + '.',
    )
  }
  const repetidas = nombresRepetidos(b.opciones)
  if (repetidas.length > 0) {
    faltan.push(`Hay dos respuestas con el mismo nombre: ${repetidas.map((n) => `«${n}»`).join(', ')}.`)
  }
  if (b.max < 1) faltan.push('«¿Cuántas puede elegir?» tiene que ser 1 o más.')
  return faltan
}

/**
 * Lo que le falta al EFECTO de cada respuesta para que descuente de verdad.
 *
 * ── POR QUÉ EXISTE (13/09 13:25, y lo pagó una decisión de Julio) ──────────
 *
 * Esta mañana el tablero 5 dejó guardar dos respuestas de «Elige los
 * ingredientes para tu Burrito/Bowl» —Maíz y Frijoles— con su ficha puesta y
 * la casilla de cantidad EN BLANCO. El contador bajó de 107 a 105, o sea que
 * la pantalla las dio por decididas. Y no descuentan nada:
 *
 *   `_sale_line_raw_consumption` hace `mri.quantity * COALESCE(m.quantity, 1)`
 *   y la de la IZQUIERDA no está coalescida. `null × 1 = null`, `_qty_in_base`
 *   devuelve null, y `explode_recipe_to_raws` con null devuelve CERO FILAS.
 *   Medido: consumo 0, cuando con cantidad 1 sería 1.
 *
 * Es de la familia de la regla 7 y la 8, en su versión más cara: un número que
 * dice «hecho» cuando no está hecho. Peor que el 107 de antes, porque el 105
 * parece progreso.
 *
 * Y el candado no estaba en ningún sitio: ni en esta pantalla, ni en
 * `kitchen_guardar_pregunta`, ni en `kitchen_extras_poner_lo_que_lleva`. Los 73
 * `add_item` anteriores tienen cantidad porque la pantalla de Extras siempre la
 * mandaba, no porque nada lo impidiera. El agujero es viejo; el tablero 5 solo
 * fue el primero en dispararlo.
 *
 * ── POR QUÉ AQUÍ Y CON SU PROPIA FORMA ────────────────────────────────────
 *
 * `porQueNoSePuedeGuardar` no podía cazarlo: recibe un `BorradorDePregunta` y
 * `OpcionNueva` NO LLEVA ni la ficha ni la cantidad — viven en la fila de la
 * pantalla. **El candado estaba donde no está el dato**, que es la razón
 * estructural de que faltara. Así que esta función pide justo lo que necesita.
 *
 * NO se rellena un 1 por nuestra cuenta. Una cantidad es cuánto sale del
 * almacén cada vez que alguien elige esa respuesta: inventarla es escribir un
 * consumo que nadie ha dicho. Se bloquea y se pide.
 */
export function loQueLeFaltaAlEfecto(
  opciones: Array<{
    nombre: string
    queLleva: QueLleva | null
    fichaId: string | null
    cantidad: string
  }>,
): string[] {
  const faltan: string[] = []
  for (const o of opciones) {
    // «No lleva nada» y «Es un plato» no piden ficha, así que tampoco cantidad.
    if (o.queLleva === null || o.queLleva === 'no_lleva_nada' || o.queLleva === 'es_un_plato') continue
    const como = o.nombre.trim() === '' ? 'Una respuesta' : `«${o.nombre.trim()}»`
    if (o.fichaId === null) {
      faltan.push(`${como} dice «${tituloDelQueLleva(o.queLleva).replace('…', '')}» pero no ha elegido el artículo.`)
      continue
    }
    const n = Number(o.cantidad.trim().replace(',', '.'))
    if (o.cantidad.trim() === '' || !Number.isFinite(n) || n <= 0) {
      faltan.push(
        `${como} no dice CUÁNTO. Sin cantidad no descuenta nada del almacén, `
        + 'aunque la pregunta quede como decidida.',
      )
    }
  }
  return faltan
}

/** El botón, según se estrene o se edite. Siempre dice lo que hace. */
export function textoDelBotonGuardar(b: BorradorDePregunta, editando: boolean): string {
  if (!editando) return 'Guardar y ponerla en platos'
  const n = cuantasSinDecidir(b.opciones)
  return n === 0 ? 'Guardar cambios' : 'Guardar y ponerla en platos'
}

/** La confirmación al editar. Con contenido, y con lo que sigue sin pasar. */
export function laConfirmacionAlEditar(
  nombre: string, resueltas: number, retiradas: number,
): string {
  const partes = [`Guardada «${nombre.trim()}»`]
  if (resueltas > 0) {
    partes.push(resueltas === 1
      ? 'con 1 respuesta que ya dice qué lleva'
      : `con ${resueltas} respuestas que ya dicen qué llevan`)
  }
  if (retiradas > 0) {
    partes.push(retiradas === 1 ? 'y 1 respuesta retirada' : `y ${retiradas} respuestas retiradas`)
  }
  return partes.join(', ')
    + '. Todavía no está en Glovo ni en Uber: sale con la próxima publicación de la carta.'
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLERO 3 · PONERLA EN PLATOS
// ═══════════════════════════════════════════════════════════════════════════

/** El contador, siempre a la vista. Es la cifra que dice si la pregunta sirve. */
export function elContadorDePlatos(n: number): string {
  if (n === 0) return 'No está en ningún plato todavía'
  return n === 1 ? 'Estará en 1 plato' : `Estará en ${n} platos`
}

/** «Marcar los 7 de Bebidas». El número por delante, no un «marcar todos». */
export function marcarLaCategoria(nombre: string, cuantos: number): string {
  return cuantos === 1 ? `Marcar el de ${nombre}` : `Marcar los ${cuantos} de ${nombre}`
}

/**
 * Lo que cambia respecto a como estaba. Sin esto, guardar en el tablero 3 es un
 * botón que no dice qué va a hacer — y quitar una pregunta de un plato es tan
 * importante como ponerla.
 */
export function elCambioEnPlatos(antes: string[], ahora: string[]): string {
  const seAnaden = ahora.filter((p) => !antes.includes(p)).length
  const seQuitan = antes.filter((p) => !ahora.includes(p)).length
  if (seAnaden === 0 && seQuitan === 0) return 'Sin cambios'
  const partes: string[] = []
  if (seAnaden > 0) partes.push(seAnaden === 1 ? 'se añade a 1 plato' : `se añade a ${seAnaden} platos`)
  if (seQuitan > 0) partes.push(seQuitan === 1 ? 'se quita de 1 plato' : `se quita de ${seQuitan} platos`)
  return partes.join(' y ').replace(/^./, (c) => c.toUpperCase())
}

/** La confirmación del tablero 3. Contenido, no un visto (regla 8). */
export function laConfirmacionDePlatos(
  pregunta: string, total: number, puestos: number, quitados: number,
): string {
  const donde = total === 0 ? 'ningún plato'
    : total === 1 ? '1 plato' : `${total} platos`
  const detalle: string[] = []
  if (puestos > 0) detalle.push(puestos === 1 ? '1 nuevo' : `${puestos} nuevos`)
  if (quitados > 0) detalle.push(quitados === 1 ? '1 quitado' : `${quitados} quitados`)
  return `«${pregunta.trim()}» está en ${donde}`
    + (detalle.length ? ` (${detalle.join(', ')})` : '')
    + '. Pendiente de publicar: sale en Glovo y Uber con la próxima publicación de la carta.'
}

// ═══════════════════════════════════════════════════════════════════════════
// DECIDIR UNA VEZ PARA TODAS LAS IGUALES (Julio, 13/09 10:40)
// ═══════════════════════════════════════════════════════════════════════════
//
// LA PALANCA, medida el 13/09: de 107 respuestas activas sin decidir hay solo
// 62 nombres distintos. 69 de las 107 comparten nombre con otra, y 24 nombres
// se llevan por delante esas 69 — el 65 %. «Salsa Harissa (Picante)» sale 7
// veces, «Salsa Yogur» 6.
//
// Nadie va a entrar 107 veces a decir que la salsa de yogur lleva salsa de
// yogur. La deuda no son 107 decisiones: son 62.
//
// SE OFRECE, NO SE HACE. La lista va delante con la pregunta y la marca de
// cada una, y cada fila se puede desmarcar. Aplicar a ciegas «todas las que se
// llamen así» es como se escribe en siete sitios una decisión que valía para
// cuatro — y varias de estas cruzan DOS marcas propias.

/** Una respuesta que se llama igual y sigue sin decidir. */
export interface UnaIgual {
  id: string
  nombre: string
  pregunta: string
  marca: string
}

/** Una que se llama igual pero NO se toca, con su motivo. */
export interface UnaQueQuedaFuera {
  id: string
  pregunta: string
  marca: string
  motivo: 'cedida' | 'ya_decidida' | 'apagada'
}

/**
 * La oferta. `null` cuando no hay ninguna igual: un aviso que sale siempre
 * deja de leerse.
 */
export function laOfertaDeLasIguales(iguales: UnaIgual[]): string | null {
  if (iguales.length === 0) return null
  const porMarca = new Map<string, number>()
  for (const i of iguales) porMarca.set(i.marca, (porMarca.get(i.marca) ?? 0) + 1)
  const reparto = [...porMarca.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m, n]) => `${m} ×${n}`)
    .join(', ')
  return iguales.length === 1
    ? `Esto mismo vale para otra que se llama igual, en ${reparto}. ¿La resuelvo?`
    : `Esto mismo vale para estas ${iguales.length}: ${reparto}. ¿Las resuelvo?`
}

/**
 * Las que se quedan fuera, dichas con su motivo. NO se esconden (regla 7):
 * quien mira tiene que poder ver que hay más que no se tocan, y por qué. Sin
 * esta línea, la pantalla estaría diciendo «son 5» cuando son 12.
 */
export function lasQueQuedanFuera(fuera: UnaQueQuedaFuera[]): string | null {
  if (fuera.length === 0) return null
  const cedidas = fuera.filter((f) => f.motivo === 'cedida').length
  const decididas = fuera.filter((f) => f.motivo === 'ya_decidida').length
  const apagadas = fuera.filter((f) => f.motivo === 'apagada').length
  const partes: string[] = []
  if (cedidas > 0) {
    partes.push(cedidas === 1
      ? '1 está en una marca que manda Last y no se toca'
      : `${cedidas} están en marcas que manda Last y no se tocan`)
  }
  if (decididas > 0) {
    partes.push(decididas === 1 ? '1 ya tiene decidido lo suyo' : `${decididas} ya tienen decidido lo suyo`)
  }
  if (apagadas > 0) {
    partes.push(apagadas === 1 ? '1 está retirada' : `${apagadas} están retiradas`)
  }
  const total = fuera.length === 1 ? 'Hay otra que se llama igual' : `Hay otras ${fuera.length} que se llaman igual`
  return `${total}: ${partes.join(', ')}.`
}

/** La línea de cada fila de la lista: dónde vive esa igual. */
export function dondeViveLaIgual(i: UnaIgual): string {
  return `${i.marca} · ${i.pregunta}`
}

/** El botón, que dice a cuántas va (regla 8). */
export function textoDelBotonDeLasIguales(cuantasMarcadas: number): string {
  if (cuantasMarcadas === 0) return 'Solo esta'
  return cuantasMarcadas === 1
    ? 'Resolver también la otra'
    : `Resolver también las otras ${cuantasMarcadas}`
}

/** La confirmación, con contenido y con las marcas nombradas. */
export function laConfirmacionDeLasIguales(nombre: string, donde: string[]): string {
  if (donde.length === 0) return `«${nombre.trim()}» resuelta.`
  const marcas = [...new Set(donde.map((d) => d.split(' · ')[0]))]
  return `«${nombre.trim()}» resuelta en ${donde.length} ${donde.length === 1 ? 'sitio' : 'sitios'}`
    + ` (${marcas.join(', ')}). Cada una queda con su propio registro de quién y cuándo.`
}
