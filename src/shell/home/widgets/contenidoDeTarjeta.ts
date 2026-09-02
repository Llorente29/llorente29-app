// src/shell/home/widgets/contenidoDeTarjeta.ts
//
// GARANTÍA (d), la decisión: QUÉ enseña una tarjeta según lo que sabe.
//
// Vive fuera del componente porque es lo único que puede estar mal —y estarlo
// en silencio— y así se prueba sin montar React. Las tres reglas:
//
//   1. SIN DATO Y CON ERROR no se pinta cifra ni filas. Un «0» ahí es la peor
//      mentira posible: «cero agotados» y «no he podido mirar si hay agotados»
//      se leen igual y significan lo contrario. Es el fallo que se cazó el
//      01/09 en la lista de opciones agotadas: la frase tranquilizadora al lado
//      del error rojo.
//   2. CON DATO Y CON ERROR sí se enseña lo último bueno, y el sello dice de
//      cuándo es. Ahí hay dato: solo está viejo, y esconderlo sería peor.
//   3. LO QUE NO CABE SE CUENTA. Un tope ordena, nunca decide la existencia
//      (regla 7): si sobran filas, la tarjeta dice cuántas, no las corta y
//      calla.

/** Lo mínimo que la decisión necesita saber de una fila: que existe. */
export type FilaVisible = { etiqueta: string; valor: string }

export interface ContenidoConFilas<T> {
  sinComprobar: boolean
  visibles: T[]
  ocultas: number
}

export function decideContenido<T>(
  error: string | null | undefined,
  hayDato: boolean,
  filas: T[] | undefined,
  maxFilas: number,
): ContenidoConFilas<T> {
  const sinComprobar = error != null && !hayDato
  if (sinComprobar) return { sinComprobar: true, visibles: [], ocultas: 0 }
  const todas = filas ?? []
  // `maxFilas <= 0` no significa «ninguna»: significa «sin tope». Un tope de
  // cero escondería la lista entera, que es justo lo que la regla 7 prohíbe.
  const visibles = maxFilas > 0 ? todas.slice(0, maxFilas) : todas
  return { sinComprobar: false, visibles, ocultas: todas.length - visibles.length }
}

/** «y 3 más, que no caben aquí». null si no sobra ninguna. */
export function fraseDeLasQueSobran(ocultas: number): string | null {
  if (ocultas <= 0) return null
  return ocultas === 1 ? 'y 1 más, que no cabe aquí' : `y ${ocultas} más, que no caben aquí`
}
