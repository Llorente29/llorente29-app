// src/modules/kds/lib/closureScope.ts
//
// EL LOCAL DE UN CIERRE, EN UN SITIO SOLO — 31/08/2026.
//
// El 29/08 se arregló la ESCRITURA: cerrar una marca pasó a ser por local
// (brand_closure, una fila por marca y local). La LECTURA se quedó atrás: el
// 31/08 a las ~17:30, con Foodint Alcalá seleccionado, el banner de Pedidos
// decía «2 marcas cerradas · indefinido» (Meraki Pita y Milanesa House) con un
// botón Reabrir al lado. Las dos filas eran de Foodint Carabanchel
// (92d7656e-…) — el dato estaba bien, el lector no filtraba. Con ese botón,
// alguien en Alcalá reabría Carabanchel en pleno servicio sin que nadie en
// Carabanchel lo pidiera.
//
// Este módulo es la respuesta: NINGÚN componente parte una lista de cierres a
// mano. Todos pasan por `partirPorLocal`, que devuelve dos mitades con nombre
// —`aqui` y `otrosLocales`— para que la diferencia entre "lo mío" y "lo de al
// lado" sea imposible de perder por descuido. La regla que imponen las firmas:
//
//   · `aqui` es lo único que puede llevar botón de acción.
//   · `otrosLocales` es SOLO LECTURA y siempre etiquetado con el nombre del
//     local (regla 7: no se oculta, pero ver no es tocar).
//
// Funciones puras a propósito (sin React, sin red): son las que se prueban en
// tests/unit/modules/kds/closureScope.test.ts, que es donde queda escrito que
// un cierre de Carabanchel no cae nunca en el lado de Alcalá.

/** Lo mínimo que tiene una fila de cierre para poder situarla en un local. */
export interface ConLocal {
  location_id: string
  location_name: string
}

export interface CierresPorAlcance<T> {
  /** Cierres del local seleccionado (o del local del dispositivo, con token). */
  aqui: T[]
  /** Cierres de OTROS locales de la cuenta. Solo lectura: nunca acción. */
  otrosLocales: T[]
}

/**
 * Parte una lista de cierres en «este local» / «otros locales».
 *
 * `locationId === null` significa que NO hay un local con el que contrastar:
 *   · vista consolidada («todos los locales») en Disponibilidad web, o
 *   · lectura por token, donde la RPC ya devolvió solo el local del dispositivo.
 * En ese caso todo cae en `aqui` — y por eso cada fila pinta SIEMPRE su
 * `location_name`: sin local seleccionado, la única forma honesta de enseñar un
 * cierre es diciendo de qué local es.
 */
export function partirPorLocal<T extends ConLocal>(
  filas: T[],
  locationId: string | null,
): CierresPorAlcance<T> {
  if (locationId === null) return { aqui: filas, otrosLocales: [] }
  return {
    aqui: filas.filter((f) => f.location_id === locationId),
    otrosLocales: filas.filter((f) => f.location_id !== locationId),
  }
}

/**
 * Id de fila. Desde el 01/09/2026 una marca puede salir DOS veces, una por
 * local cerrado: la marca sola ya no identifica nada (dos filas de Meraki Pita
 * compartirían el estado de "ocupado" y el botón de una reabriría la otra).
 */
export function filaId(f: { brand_id: string } & ConLocal): string {
  return `${f.brand_id}:${f.location_id}`
}

/**
 * Hasta cuándo está cerrada, en cristiano.
 *
 * `resume_at` null no es un error ni un valor raro: es «cerrada hasta que
 * alguien la reabra a mano», una de las duraciones que ofrece el propio
 * selector. La pantalla decía «indefinido», que suena a dato que falta o a
 * fallo de carga; dice ya lo que pasa.
 */
export function textoReapertura(resumeAt: string | null): string {
  if (!resumeAt) return 'sin fecha de reapertura'
  return `hasta las ${new Date(resumeAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
}

/** Versión corta para el chip, que ya lleva «reabre» delante o va suelta. */
export function textoReaperturaChip(resumeAt: string | null): string {
  if (!resumeAt) return 'sin fecha de reapertura'
  return `reabre ${new Date(resumeAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * El texto del botón/confirmación de reapertura. NUNCA un «Reabrir» mudo: el
 * local va en la frase que lee quien pulsa, no solo en el argumento de la RPC.
 */
export function textoReabrir(brandName: string, locationName: string): string {
  return `Reabrir ${brandName} en ${locationName}`
}

/** «1 marca cerrada» / «N marcas cerradas». */
export function textoMarcasCerradas(n: number): string {
  return n === 1 ? '1 marca cerrada' : `${n} marcas cerradas`
}

/** «1 marca cerrada en otro local» / «N marcas cerradas en otros locales». */
export function textoOtrosLocales(n: number): string {
  return n === 1 ? '1 marca cerrada en otro local' : `${n} marcas cerradas en otros locales`
}
