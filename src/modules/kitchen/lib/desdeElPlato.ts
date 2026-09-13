// src/modules/kitchen/lib/desdeElPlato.ts
//
// DESDE EL PLATO: qué preguntas lleva, y quitar una sin salir de ahí.
//
// El gestor sólo iba en un sentido: desde la pregunta se veía en qué platos
// estaba. Al revés no había nada — y al revés es como se mira de verdad
// cuando un plato pregunta algo que no debería.
//
// Aquí vive TODO lo que se lee en pantalla. La RPC devuelve claves, no
// frases; las frases se escriben una sola vez y aquí.

import type { Pregunta } from './preguntasDeCocina'

/** El plato, tal y como llega de `kitchen_preguntas_de_un_plato`. */
export interface ElPlato {
  id: string
  nombre: string
  precio: number
  marca: string
  marcaId: string | null
  cedida: boolean
  activo: boolean
  archivado: boolean
}

/** Una de sus preguntas. */
export interface PreguntaDelPlato {
  id: string
  nombre: string
  tipo: Pregunta['tipo']
  min: number
  max: number
  obligatoria: boolean
  repetible: boolean
  dePago: boolean
  activa: boolean
  posicion: number
  /** ACTIVAS. Una respuesta retirada no se vende. */
  respuestas: number
  sinDecidir: number
  /** En cuántos platos MÁS está, sin contar éste. */
  otrosPlatos: number
  sePuedeQuitar: boolean
  porQueNo: string | null
}

export interface LoQuePreguntaElPlato {
  plato: ElPlato
  preguntas: PreguntaDelPlato[]
  cuantas: number
}

/** Lo que devuelve quitar una: contenido, no un visto (regla 8). */
export interface LoQueSeHaQuitado {
  pregunta: string
  plato: string
  marca: string
  leQuedan: number
  sigueEnPlatos: number
}

// ── La cabecera ─────────────────────────────────────────────────────────────

export function tituloDelPlato(p: ElPlato): string {
  return p.nombre
}

export function laReglaDelPlato(d: LoQuePreguntaElPlato): string {
  const n = d.cuantas
  if (n === 0) return 'Este plato no pregunta nada: el cliente lo añade y ya está.'
  const cuantas = n === 1 ? '1 pregunta' : `${n} preguntas`
  return `Este plato le hace ${cuantas} al cliente antes de entrar en la comanda.`
}

/** La segunda línea: de quién es la carta, y qué se puede hacer aquí. */
export function deQuienEsLaCarta(p: ElPlato): string {
  return p.cedida
    ? `${p.marca} · la carta la manda Last: sus preguntas se ponen y se quitan allí`
    : `${p.marca} · marca propia`
}

// ── Cada fila ───────────────────────────────────────────────────────────────

/** Las respuestas de una pregunta, con lo que falta pegado. */
export function respuestasEnTexto(p: PreguntaDelPlato): string {
  if (p.respuestas === 0) return 'Ninguna respuesta'
  const base = p.respuestas === 1 ? '1 respuesta' : `${p.respuestas} respuestas`
  if (p.sinDecidir === 0) return base
  return `${base} · ${p.sinDecidir} sin decidir qué llevan`
}

/** Dónde más vive. Decide si quitarla de aquí es un gesto pequeño. */
export function dondeMasEsta(p: PreguntaDelPlato): string {
  if (p.otrosPlatos === 0) return 'Sólo está en este plato'
  return p.otrosPlatos === 1
    ? 'También está en 1 plato más'
    : `También está en ${p.otrosPlatos} platos más`
}

export type TonoDeAviso = 'rojo' | 'ambar' | 'apagado'
export interface AvisoDeFila { texto: string; tono: TonoDeAviso }

/**
 * LO QUE HAY QUE MIRAR DE ESTA FILA, en orden de gravedad.
 *
 * La primera salió sola al abrir la pantalla contra datos reales: «Kebab
 * Combo Duo» tiene DOS preguntas obligatorias con CERO respuestas activas.
 * Una pregunta obligatoria sin respuestas no es una pregunta fea: es un plato
 * que el cliente no puede terminar de pedir.
 */
export function loQueHayQueMirar(p: PreguntaDelPlato): AvisoDeFila[] {
  const avisos: AvisoDeFila[] = []
  if (p.respuestas === 0 && p.obligatoria) {
    avisos.push({ texto: 'Obligatoria y sin respuestas: el cliente no puede terminar el pedido', tono: 'rojo' })
  } else if (p.respuestas === 0) {
    avisos.push({ texto: 'Sin respuestas: no le pregunta nada a nadie', tono: 'ambar' })
  }
  if (p.sinDecidir > 0) {
    avisos.push({
      texto: p.sinDecidir === 1
        ? '1 respuesta no descuenta nada del almacén'
        : `${p.sinDecidir} respuestas no descuentan nada del almacén`,
      tono: 'ambar',
    })
  }
  if (!p.activa) avisos.push({ texto: 'Apagada: no se la ve el cliente', tono: 'apagado' })
  return avisos
}

/** El botón de la fila. Nunca apagado sin una frase al lado. */
export function textoDeQuitar(p: PreguntaDelPlato): string {
  return p.sePuedeQuitar ? 'Quitar de este plato' : 'No se puede quitar aquí'
}

/** Lo que se lee ANTES de pulsar, para que nadie pulse a ciegas. */
export function loQuePasaSiQuitas(p: PreguntaDelPlato, plato: ElPlato): string {
  if (!p.sePuedeQuitar) return p.porQueNo ?? 'Esta pregunta no se puede quitar desde aquí.'
  const resto = p.otrosPlatos === 0
    ? 'No está en ningún plato más, así que dejará de preguntarse en toda la carta.'
    : p.otrosPlatos === 1
      ? 'Seguirá preguntándose en el otro plato en el que está.'
      : `Seguirá preguntándose en los otros ${p.otrosPlatos} platos en los que está.`
  return `«${p.nombre}» dejará de preguntarse en «${plato.nombre}». ${resto} La pregunta no se borra.`
}

/** Y DESPUÉS, con contenido: «Publicado. Avisadas 4 personas» dice algo. */
export function laConfirmacionDeQuitar(r: LoQueSeHaQuitado): string {
  const quedan = r.leQuedan === 0
    ? 'Ya no pregunta nada'
    : r.leQuedan === 1 ? 'Le queda 1 pregunta' : `Le quedan ${r.leQuedan} preguntas`
  const sigue = r.sigueEnPlatos === 0
    ? 'y ya no está en ningún plato'
    : r.sigueEnPlatos === 1 ? 'y sigue en 1 plato' : `y sigue en ${r.sigueEnPlatos} platos`
  return `Quitada «${r.pregunta}» de «${r.plato}». ${quedan}, ${sigue}.`
}

/** Cuando no lleva ninguna. Un vacío se explica, no se deja en blanco. */
export function elVacioDelPlato(p: ElPlato): string {
  return p.cedida
    ? `«${p.nombre}» no lleva ninguna pregunta. Su carta la manda Last: las preguntas se le ponen allí.`
    : `«${p.nombre}» no lleva ninguna pregunta. Se le ponen desde la pregunta, en «Preguntas de la carta».`
}
