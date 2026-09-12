// src/modules/kitchen/lib/preguntasDeCocina.ts
//
// TODO el castellano del tablero 1 (la lista de preguntas). La RPC
// `modificadores_lista_preguntas` devuelve CLAVES —`tipo`, `accion`— y las
// frases se escriben aquí. Ni una palabra de pantalla vive en la base.
//
// LAS PALABRAS SON LAS DE LA MAQUETA, y no son negociables: pregunta, opción,
// extra, qué lleva, sin decidir, sustituye, añade, quita. Nunca grupo,
// modificador, impacto, bundle, confirmed ni inglés. Quien lea esta pantalla
// no sabe qué es un `modifier_group` y no tiene por qué.
//
// LA BASE VIAJA CON LA CIFRA. Julio, 12/09 11:52: sus 45 propias y mis 54 no
// se contradecían —él contaba las 56 activas y yo las 65 enteras— pero la
// misma cifra con dos bases en dos sitios parece que una miente. Así que
// `cifraConBase` escribe siempre de qué habla: «65 preguntas · 56 activas».
//
// LA LISTA NO ESCONDE. Las apagadas se etiquetan y se ordenan abajo; no se
// filtran (regla 7). Lo mismo con las que no están en ningún plato: van
// aparte, con su motivo, no desaparecen.

/** Lo que la RPC dice que puede hacer el cliente. Claves, no frases. */
export type TipoDePregunta = 'elige' | 'anade' | 'quita' | 'cross_sell'

/** El único botón de la fila. La RPC ya ha decidido cuál. */
export type AccionDePregunta = 'juntar' | 'revisar' | 'abrir'

export type TonoDePastilla = 'aviso' | 'malo' | 'apagado'

export interface Pastilla { texto: string; tono: TonoDePastilla }

/** Una fila de la lista, tal y como llega de la RPC (ya en camelCase). */
export interface Pregunta {
  id: string
  nombre: string
  tipo: TipoDePregunta
  dePago: boolean
  min: number
  max: number
  obligatoria: boolean
  repetible: boolean
  activa: boolean
  /** 'propia' | 'lastapp'. El origen de la fila, no de la marca. */
  origen: string
  /** Lo dice la MARCA (`ownership_type`), no el origen de la fila. */
  cedida: boolean
  editable: boolean
  /** Marca propia que arrastra la etiqueta `lastapp` de la importación vieja. */
  etiquetaVieja: boolean
  /** ACTIVAS. Una opción retirada no se vende: no cuenta para trabajar. */
  opciones: number
  opcionesCobran: number
  sinDecidir: number
  /** Las que ya no se venden. Van de contexto, nunca en rojo. */
  opcionesRetiradas: number
  platos: number
  copias: number
  reglasDistintas: boolean
  accion: AccionDePregunta
  /** Sólo en la sección de las que no están en ningún plato. */
  marca?: string | null
}

export interface MarcaConPreguntas {
  id: string
  nombre: string
  cedida: boolean
  preguntas: Pregunta[]
}

export interface CifrasDePreguntas {
  preguntas: number
  /** Total, de contexto. Lo que empuja a trabajar es `opcionesActivas`. */
  opciones: number
  opcionesActivas: number
  platosConPregunta: number
  platosActivos: number
  repetidasNombres: number
  repetidasPreguntas: number
  extrasDistintos: number
  opcionesDecididasActivas: number
  opcionesSinDecidir: number
  opcionesSinDecidirActivas: number
  opcionesSinDecidirCobran: number
  opcionesSinDecidirCobranActivas: number
}

export interface FranjaDeExtras {
  vendidas: number
  conQueLleva: number
  sinDecidir: number
  desconocidas: number
  cedidas: number
  propias: number
}

export interface Ventana { dias: number; desde: string; hasta: string }

// ── La ventana, escrita una sola vez ────────────────────────────────────────
// La RPC la devuelve en días enteros de Madrid. Aquí sólo se escribe; no se
// recalcula (regla 36: un solo reloj).
export function ventanaEnTexto(v: Ventana): string {
  return `${v.dias} ${v.dias === 1 ? 'día' : 'días'}`
}

// ── Qué puede hacer el cliente ──────────────────────────────────────────────
// LOS 100 DE «¿Quieres añadir un postre?» SON REALES, y por eso existe el caso
// de arriba: «Añadir hasta 100» no es una frase que diga nada. Por encima de
// 20 se dice lo que significa. Con ejemplos inventados esto no habría salido.
const MUCHOS = 20

export function quePuedeHacerElCliente(p: Pregunta): string {
  const tope = p.max >= MUCHOS ? null : p.max
  if (p.tipo === 'quita') {
    return tope == null ? 'Quitar las que quiera' : `Quitar hasta ${tope}`
  }
  if (p.tipo === 'anade' || p.tipo === 'cross_sell') {
    return tope == null ? 'Añadir los que quiera' : `Añadir hasta ${tope}`
  }
  // elige
  if (p.obligatoria) {
    if (p.max <= 1) return 'Elegir 1 · obligatoria'
    return tope == null
      ? `Elegir ${p.min} o más · obligatoria`
      : `Elegir de ${p.min} a ${tope} · obligatoria`
  }
  return tope == null ? 'Elegir las que quiera' : `Elegir hasta ${tope}`
}

/** La segunda línea del nombre: «Añade · de pago», «Elige», «Quita · gratis». */
export function queHaceEnElPlato(p: Pregunta): string {
  const verbo = p.tipo === 'quita' ? 'Quita'
    : (p.tipo === 'anade' || p.tipo === 'cross_sell') ? 'Añade'
    : 'Elige'
  if (p.tipo === 'quita') return `${verbo} · gratis`
  return p.dePago ? `${verbo} · de pago` : verbo
}

// ── Las columnas ────────────────────────────────────────────────────────────
export function opcionesEnTexto(p: Pregunta): string {
  if (p.opciones === 0) return 'Ninguna'
  if (p.opcionesCobran === 0) return String(p.opciones)
  const cobran = p.opcionesCobran === 1 ? '1 cobra' : `${p.opcionesCobran} cobran`
  return `${p.opciones} · ${cobran}`
}

export function platosEnTexto(p: Pregunta): string {
  if (p.platos === 0) return 'Ninguno'
  return p.platos === 1 ? '1 plato' : `${p.platos} platos`
}

/**
 * NADA en esta columna va en rojo, y por eso esto siempre es `false`.
 *
 * Lo pinté rojo pensando que «Ninguno» era una alarma. Pero las únicas filas
 * con «Ninguno» están en la sección que trata precisamente de las que no
 * están en ningún plato: allí el rojo no dice nada que el rótulo no diga ya.
 * Julio, 12/09 12:10: «cuando todo es rojo, el rojo deja de significar nada».
 *
 * Se queda la función, no el color: si algún día una pregunta con plato
 * apareciera a cero, aquí es donde se decide. Por eso sigue recibiendo la
 * pregunta aunque hoy no la mire — y por eso la mira, para no dejar un
 * parámetro muerto que el lint tenga que perdonar.
 */
export function platosPreocupa(p: Pregunta): boolean {
  return p.platos < 0
}

// ── Las pastillas de «qué le pasa» ──────────────────────────────────────────
// Se pintan TODAS las que apliquen. Una fila sin ninguna no es un hueco: es
// una pregunta que no pide nada, y eso también se dice («—»).
export function pastillas(p: Pregunta): Pastilla[] {
  const out: Pastilla[] = []
  if (p.copias > 1 && p.reglasDistintas) {
    out.push({ texto: 'Mismo nombre, reglas distintas', tono: 'aviso' })
  } else if (p.copias > 1) {
    out.push({ texto: `Copiada ${p.copias} veces`, tono: 'aviso' })
  }
  // DECISIÓN 3 DE JULIO (12/09, 10:35): una pregunta sin ninguna opción NO
  // sale en las plataformas y no se publica. La columna sólo pone «Ninguna»,
  // que se lee como un cero más, no como «esto no existe para el cliente».
  //
  // SÓLO SI LA PREGUNTA ESTÁ VIVA. Una apagada ya dice por qué no sale, y
  // repetirlo en rojo no añade nada que hacer (Julio, 12:10: el rojo es para
  // lo accionable). Al contar sólo opciones activas, seis preguntas más se
  // quedan en cero — y las seis están apagadas.
  if (p.opciones === 0 && p.activa) {
    out.push({ texto: 'Sin opciones: no sale', tono: 'malo' })
  }
  if (p.sinDecidir > 0) {
    out.push({ texto: `${p.sinDecidir} sin decidir`, tono: 'malo' })
  }
  // Contexto, no alarma: explica por qué el número de opciones es el que es.
  if (p.opcionesRetiradas > 0) {
    out.push({
      texto: p.opcionesRetiradas === 1 ? '1 retirada' : `${p.opcionesRetiradas} retiradas`,
      tono: 'apagado',
    })
  }
  if (p.cedida) out.push({ texto: 'Se cambia en Last', tono: 'apagado' })
  if (!p.activa) out.push({ texto: 'Apagada', tono: 'apagado' })
  return out
}

/** La frase entera, para cuando hay sitio: la pastilla es su resumen. */
export function porQueNoSale(p: Pregunta): string | null {
  if (p.opciones > 0 || !p.activa) return null
  return 'No sale en las plataformas: no tiene ninguna opción activa.'
}

export function textoDelBoton(a: AccionDePregunta): string {
  return a === 'juntar' ? 'Juntar' : a === 'revisar' ? 'Revisar' : 'Abrir'
}

// ── Los candados, y por qué ─────────────────────────────────────────────────
// CEDIDA SE MIDE POR LA MARCA. Medido el 12/09 y corregido por Julio: la
// etiqueta `lastapp` en una marca propia es de la importación del 12/06 y el
// importador no la ha vuelto a tocar — su pasada del 11/09 a las 12:11 sólo
// reescribió opciones de marcas cedidas. Bloquear por origen habría dejado a
// Julio sin editar 40 preguntas suyas.
export function porQueNoSeEdita(p: Pregunta): string | null {
  if (p.editable) return null
  return 'Esta pregunta la manda Last: se ve, pero no se edita aquí.'
}

/** La línea de las 40 que arrastran la etiqueta vieja. */
export function lineaDeEtiquetaVieja(p: Pregunta): string | null {
  if (!p.etiquetaVieja) return null
  return 'Esta pregunta venía de una importación antigua; al guardarla pasa a ser tuya.'
}

// ── Las cifras, con su base ─────────────────────────────────────────────────
/** «65 preguntas · 56 activas». Nunca una cifra suelta cuyo criterio no se vea. */
export function cifraConBase(total: number, activas: number, singular: string, plural: string): string {
  const nombre = total === 1 ? singular : plural
  return `${total} ${nombre} · ${activas} ${activas === 1 ? 'activa' : 'activas'}`
}

export function cuantasActivas(marcas: MarcaConPreguntas[], sinPlato: Pregunta[]): number {
  const todas = [...marcas.flatMap((m) => m.preguntas), ...sinPlato]
  return todas.filter((p) => p.activa).length
}

// ── El orden ────────────────────────────────────────────────────────────────
// La RPC ya ordena «primero las que piden algo». Aquí sólo se baja lo apagado,
// que es lo que pidió Julio: etiquetado y abajo, nunca escondido (regla 7).
export function ordena(preguntas: Pregunta[]): Pregunta[] {
  return [...preguntas].sort((a, b) => {
    if (a.activa !== b.activa) return a.activa ? -1 : 1
    return 0
  })
}

// ── La franja ───────────────────────────────────────────────────────────────
// SIN PORCENTAJE, y es una decisión, no un olvido. De 1.378 líneas de extra
// vendidas en 30 días, 859 tienen decidido qué llevan y sólo 281 descuentan.
// Los 578 de diferencia pueden ser el corte, un precio indefendible o un extra
// que SUSTITUYE en vez de sumar. Hasta que el tablero 7 pueda explicarlo, un
// «20 %» inventa una avería — que es justo lo que prohíbe el §5.
export function tituloDeLaFranja(f: FranjaDeExtras, v: Ventana): string {
  return `De los extras vendidos en ${ventanaEnTexto(v)}, ${f.vendidas} líneas`
}

// EL DETALLE SÓLO LLEVA LO ACCIONABLE. El reparto cedida/propia no es una
// alarma, es un reparto: baja a su propia línea, en gris.
export function detalleDeLaFranja(f: FranjaDeExtras): string {
  const partes = [
    `${f.conQueLleva} tienen decidido qué llevan`,
    `${f.sinDecidir} sin decidir`,
  ]
  if (f.desconocidas > 0) partes.push(`${f.desconocidas} que Folvy no conoce`)
  return `${partes.join(' · ')}.`
}

/** Contexto, en gris y fuera del rojo: quién vende esos extras. */
export function repartoDeLaFranja(f: FranjaDeExtras): string {
  return `De marca cedida ${f.cedidas}, de marca propia ${f.propias}.`
}

// ── La cabecera de cada marca ───────────────────────────────────────────────
// La segunda mitad de la frase de la cedida NO es decoración: es lo único que
// se puede hacer ahí. Sin ella, «la carta la manda Last» se lee como «aquí no
// pintas nada», y no es verdad — lo que lleva cada opción sí es de Folvy.
export function subtituloDeMarca(cedida: boolean): string {
  return cedida
    ? 'Marca cedida · la carta la manda Last. Aquí se pone lo que lleva cada opción'
    : 'Marca propia · se edita aquí'
}

// ── Los chips de marca ──────────────────────────────────────────────────────
// La maqueta enseña cinco y un «+ N marcas». Con 14 marcas la fila entera se
// parte en dos y empuja la lista hacia abajo. El chip de más NO esconde nada:
// abre el resto en el sitio (regla 7 — un tope ordena, no oculta).
export const MARCAS_A_LA_VISTA = 5

export function chipDeMasMarcas(cuantasQuedan: number): string {
  return cuantasQuedan === 1 ? '+ 1 marca' : `+ ${cuantasQuedan} marcas`
}

// ── El pie ──────────────────────────────────────────────────────────────────
// «Qué lleva» es la palabra que más se repite en la pantalla y la única que
// no se explica sola. Va en el pie, como en la maqueta.
export function elPieDeLaLista(): string {
  return '«Qué lleva» es lo que se descuenta del almacén y suma al coste del '
    + 'plato cuando el cliente elige esa opción. Las preguntas y las opciones '
    + 'retiradas se siguen viendo, etiquetadas y abajo: la lista no esconde '
    + 'nada, pero las cifras de arriba cuentan sólo lo que se puede vender hoy. '
    + 'Una pregunta de marca cedida se ve pero no se edita: la manda Last y el '
    + 'próximo volcado devolvería el cambio. En las marcas propias manda Folvy. '
    + 'Las fichas de cada pregunta llegan en el siguiente paso.'
}

// ── La sección de las que no están en ningún plato ──────────────────────────
export function tituloSinPlato(preguntas: number, opciones: number): string {
  const p = preguntas === 1 ? '1 pregunta' : `${preguntas} preguntas`
  const o = opciones === 1 ? '1 opción' : `${opciones} opciones`
  return `${p} en ningún plato · ${o}`
}

// Aquí no hay bloque de marca —estas 15 no cuelgan de ninguno—, así que la
// marca hay que decirla en la fila. Lo que NO se repite es el hecho: el
// rótulo del panel dice «en ningún plato» y la columna dice «Ninguno». Decirlo
// una tercera vez debajo es ruido, y el ruido es lo que hace que se deje de
// leer la línea que sí trae información.
export function lineaSinPlato(p: Pregunta): string {
  return p.marca ? `Marca: ${p.marca}` : 'Sin marca'
}
