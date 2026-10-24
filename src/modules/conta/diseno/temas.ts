// src/modules/conta/diseno/temas.ts
//
// Cómo pinta cada marca el sistema de diseño.
//
// S02 · Patrón único (Julio, 22/10): desde el S02 los valores de serie de
// diseno/tokens.css SON los de Sumied (los del patrón), y ninguna marca vuelve
// a pintar la aplicación encima: la marca cambia el logo y el nombre, no la
// forma ni los colores. Hasta el S02, Sumied ponía aquí su pintura (barra azul
// noche, fondo, estados) encima de los valores del marco N30, y Folvy se veía
// con los del N30: dos aplicaciones distintas con el mismo código.
//
// Se queda el tipo y la función, vacíos, para que una marca futura que de
// verdad tenga que pintar distinto lo haga AQUÍ y en ningún otro sitio.
// Medido en tests/unit/modules/conta/s01/diseno.test.tsx.

import type { IdMarca, Marca } from '../../../../supabase/functions/_shared/marcas.ts'

export interface TemaDiseno {
  /** Fondo de la página. */
  fondo: string
  /** Borde de lo que hay que ver para usarlo (campos, desplegables, casillas): ≥ 3:1. */
  bordeControl: string
  /** La barra lateral. */
  barra: string
}

/** S02: ninguna marca repinta el patrón. */
export const TEMAS_DISENO: Partial<Record<IdMarca, TemaDiseno>> = {}

/**
 * Las variables `--s-*` que una marca pondría encima de las de serie, o null.
 * S02: ninguna (el patrón es uno solo).
 */
export function variablesDeMarca(m: Marca): Record<string, string> | null {
  const d = TEMAS_DISENO[m.id]
  if (!d) return null
  return { '--s-fondo': d.fondo, '--s-borde-control': d.bordeControl, '--s-barra': d.barra }
}
