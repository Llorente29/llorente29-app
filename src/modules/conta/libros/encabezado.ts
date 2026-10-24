// src/modules/conta/libros/encabezado.ts
//
// S02 · PR 2 · Lo que el encabezado de un libro hace con el catálogo de su
// página, sin pintar (se prueba sin React: s02/pr2-libros-encabezado.test.ts).
//
// El problema: una página que pinta EncabezadoPagina le dice al marco que no
// pinte su fila de serie, y EncabezadoPagina mete TODO el catálogo en «Más
// acciones», también los grupos `ver` (los libros). Así se perdía el selector
// «Ver: Libro mayor. Cambiar», que es como se pasa de un libro a otro.
//
// La salida más sencilla, sin tocar el marco: el libro reparte el catálogo con
// la misma regla que la fila de serie (repartirAcciones, con «la página pinta
// lo suyo»). Los selectores («Ver») van a la izquierda de los botones del
// encabezado; lo demás, a su «Más acciones», como antes. Nada sale dos veces.

import { repartirAcciones, type GrupoDeAcciones, type Selector } from '@/modules/conta/marco/acciones'

export interface RepartoDelLibro {
  /** «Ver: <libro>. Cambiar» (y cualquier grupo con una entrada actual). */
  selectores: Selector[]
  /** Lo que queda del catálogo: a «Más acciones». */
  resto: GrupoDeAcciones[]
}

export function repartoDelLibro(catalogo: readonly GrupoDeAcciones[]): RepartoDelLibro {
  const r = repartirAcciones(catalogo, true)
  return { selectores: r.selectores, resto: r.mas }
}

/** «01/01/2026»: las fechas de la frase, como en el resto de Libros. */
export const ddmmaaaa = (f: string): string => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

/** La frase del periodo: «Del 01/01/2026 al 31/12/2026». */
export const fraseDelPeriodo = (desde: string, hasta: string): string => `Del ${ddmmaaaa(desde)} al ${ddmmaaaa(hasta)}`
