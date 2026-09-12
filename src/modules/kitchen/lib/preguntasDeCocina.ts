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
  opciones: number
  opcionesCobran: number
  sinDecidir: number
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
  opciones: number
  platosConPregunta: number
  platosActivos: number
  repetidasNombres: number
  repetidasPreguntas: number
  extrasDistintos: number
  opcionesSinDecidir: number
  opcionesSinDecidirCobran: number
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

/** «Ninguno» va en rojo: una pregunta sin plato no se la ve nadie. */
export function platosPreocupa(p: Pregunta): boolean {
  return p.platos === 0
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
  if (p.sinDecidir > 0) {
    out.push({ texto: `${p.sinDecidir} sin decidir`, tono: 'malo' })
  }
  if (p.cedida) out.push({ texto: 'Se cambia en Last', tono: 'apagado' })
  if (!p.activa) out.push({ texto: 'Apagada', tono: 'apagado' })
  return out
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

export function detalleDeLaFranja(f: FranjaDeExtras): string {
  const partes = [
    `${f.conQueLleva} tienen decidido qué llevan`,
    `${f.sinDecidir} sin decidir`,
  ]
  if (f.desconocidas > 0) partes.push(`${f.desconocidas} que Folvy no conoce`)
  return `${partes.join(' · ')}. De marca cedida ${f.cedidas}, de marca propia ${f.propias}.`
}

// ── La sección de las que no están en ningún plato ──────────────────────────
export function tituloSinPlato(preguntas: number, opciones: number): string {
  const p = preguntas === 1 ? '1 pregunta' : `${preguntas} preguntas`
  const o = opciones === 1 ? '1 opción' : `${opciones} opciones`
  return `${p} en ningún plato · ${o}`
}

export function lineaSinPlato(p: Pregunta): string {
  const marca = p.marca ? `${p.marca} · ` : ''
  return `${marca}En ningún plato activo`
}
