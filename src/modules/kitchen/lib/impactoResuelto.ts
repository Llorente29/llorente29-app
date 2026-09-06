// src/modules/kitchen/lib/impactoResuelto.ts
//
// B73a (06/09/2026). ¿Cuánto cuesta DE VERDAD un impacto de modificador, y si no
// cuesta nada, por qué?
//
// EL PROBLEMA QUE RESUELVE, con su factura delante. `_impact_cost` tiene cuatro
// caminos que devuelven **0 en silencio**: sin destino, sin cantidad, **sin
// unidad**, y unidad no convertible. En producción había **diez** impactos
// `add_item` confirmados sin unidad, todos apuntando a fichas con coste, todos
// aportando 0,00 €. Y la pantalla los pintaba **«✓ Confirmado» en verde** y los
// contaba dentro del «50 % de cobertura».
//
// Devolver 0 no es «no inventar un coste»: es **afirmar que no cuesta nada**.
// Llamarlo «confirmado» encima es la mentira cara: quien lo mira concluye que el
// trabajo está hecho y no vuelve. Familia de las reglas 7 y 8 — la 7 prohíbe
// esconder filas que existen, la 8 esconder que algo ha pasado; ésta prohíbe
// **decir que algo está bien cuando el propio motor dice que no ha podido**.
//
// Esto replica el motor, no lo adivina. Los tres estados son a propósito:
// `no_calculable` existe porque la conversión entre dimensiones vive en
// `recipe_item_unit_conversion`, que esta pantalla no carga. Un «no lo sé» honesto
// vale más que un verde optimista.

import type { ImpactType } from '@/modules/kitchen/services/modifierImpactService'

/** Lo que esta pantalla sabe de una unidad de cocina. */
export interface UnidadPick {
  id: string
  abreviatura: string
  dimension: string
  factorABase: number
}

/** Lo que esta pantalla sabe de la ficha destino de un impacto. */
export interface FichaDestino {
  costeUnitario: number | null   // COALESCE(computed_cost, fixed_cost) del motor
  baseUnitId: string | null
}

export type ImpactoResuelto =
  /** Aporta dinero. `euros` es lo que suma por cada vez que se elige la opción. */
  | { estado: 'con_coste'; euros: number }
  /** Resuelve a 0,00 € y se sabe por qué. Esto NO cuenta como cobertura. */
  | { estado: 'sin_coste'; motivo: string }
  /** Hace falta el motor para saberlo. Ni verde ni rojo. */
  | { estado: 'no_calculable'; motivo: string }
  /** El impacto declara que no cambia el coste. Es una respuesta, no un hueco. */
  | { estado: 'no_aplica' }

/**
 * Réplica de `_impact_cost` + la rama de `compute_sale_line_cost` que la llama.
 *
 * Contrato copiado del motor, no inventado:
 *  - el coste de la ficha es `computed_cost ?? fixed_cost ?? 0` — y **no** incluye
 *    `packaging_cost`, que ninguna de las dos funciones lee (eso es B73b);
 *  - si la unidad de la línea y la base de la ficha comparten dimensión, la
 *    cantidad se pasa a base con `factor_linea / factor_base`;
 *  - si no la comparten, el motor busca en `recipe_item_unit_conversion` y, si no
 *    la encuentra, devuelve 0. Aquí eso es `no_calculable`, no `con_coste`.
 */
export function resuelveImpacto(args: {
  impactType: ImpactType
  targetRecipeItemId: string | null
  quantity: number | null
  unitId: string | null
  ficha: FichaDestino | null
  unidadDeLaLinea: UnidadPick | null
  unidadBaseDeLaFicha: UnidadPick | null
}): ImpactoResuelto {
  const { impactType, targetRecipeItemId, quantity, unitId, ficha } = args

  if (impactType === 'none') return { estado: 'no_aplica' }

  // `multiply` no mira a una ficha: escala el plato base, que esta pantalla no
  // tiene delante. Lo único que sí se puede afirmar es que multiplicar por 1
  // (o por nada) no cambia nada.
  if (impactType === 'multiply') {
    if (quantity == null || quantity === 1) {
      return { estado: 'sin_coste', motivo: 'multiplica por 1, así que no cambia el coste' }
    }
    return { estado: 'no_calculable', motivo: 'depende del coste del plato base' }
  }

  if (!targetRecipeItemId) return { estado: 'sin_coste', motivo: 'no tiene ficha de destino' }
  if (quantity == null)    return { estado: 'sin_coste', motivo: 'no tiene cantidad' }
  if (!unitId)             return { estado: 'sin_coste', motivo: 'le falta la unidad' }
  if (!ficha)              return { estado: 'sin_coste', motivo: 'la ficha de destino ya no existe' }

  const coste = ficha.costeUnitario ?? 0
  if (coste === 0) return { estado: 'sin_coste', motivo: 'la ficha de destino no tiene coste' }

  const linea = args.unidadDeLaLinea
  const base = args.unidadBaseDeLaFicha
  if (!linea || !base) {
    return { estado: 'no_calculable', motivo: 'no se ha podido leer la unidad' }
  }

  if (linea.dimension !== base.dimension) {
    return { estado: 'no_calculable', motivo: 'necesita una conversión propia de la ficha' }
  }
  if (!base.factorABase) {
    return { estado: 'no_calculable', motivo: 'la unidad base de la ficha no tiene factor' }
  }

  const enBase = (quantity * linea.factorABase) / base.factorABase
  return { estado: 'con_coste', euros: coste * enBase }
}

/**
 * ¿Este impacto está confirmado y aun así no aporta lo que debería?
 *
 * Devuelve el estado que la tarjeta tiene que pintar. `no_calculable` **también**
 * sale del verde, y esto no es prudencia: es lo que hace el motor. El caso que lo
 * demostró es real y está en la prueba — «Sweet Chili T» de Big Mike´s cobra
 * 0,60 €, su impacto dice **50 g** y la ficha de la salsa está en **ml**. Al no
 * compartir dimensión, `_impact_cost` busca una conversión propia de la ficha, no
 * la encuentra, y **devuelve 0**. Verificado: `_impact_cost(...) = 0` y
 * `recipe_item_unit_conversion` no tiene ni una fila para esa ficha.
 *
 * Así que pintar eso de verde sería exactamente el mismo error, un camino más
 * allá. Se dice «no se ha podido calcular» y se saca de la cobertura.
 */
export function pintaComoConfirmado(
  status: string | null | undefined,
  r: ImpactoResuelto,
): boolean {
  return status === 'confirmed' && (r.estado === 'con_coste' || r.estado === 'no_aplica')
}

/** El aviso que sustituye al «✓ Confirmado» verde, o null si no hace falta. */
export function avisoDeConfirmadoSinCoste(
  status: string | null | undefined,
  r: ImpactoResuelto,
): string | null {
  if (status !== 'confirmed') return null
  if (r.estado === 'sin_coste') return `Confirmado, pero sin coste — ${r.motivo}`
  if (r.estado === 'no_calculable') return `Confirmado, sin poder calcular — ${r.motivo}`
  return null
}

/**
 * La cobertura, contada como lo que es.
 *
 * Antes: `confirmados / total`. Con eso, diez impactos que valen cero inflaban el
 * porcentaje — el «50 %» de la captura de Julio incluía a «Si, con patatas», que
 * aportaba 0,00 €. Ahora los confirmados que no aportan salen **de la cobertura y
 * a su propio contador**: no desaparecen de la pantalla (regla 7), cambian de
 * casilla, y la casilla se enseña.
 */
export function cuentaCobertura(
  filas: { status: string | null | undefined; resuelto: ImpactoResuelto }[],
): { total: number; conCoste: number; sinCoste: number; dudoso: number; porRevisar: number; pct: number } {
  const total = filas.length
  let conCoste = 0
  let sinCoste = 0
  let dudoso = 0
  for (const f of filas) {
    if (f.status !== 'confirmed') continue
    if (f.resuelto.estado === 'sin_coste') sinCoste += 1
    else if (f.resuelto.estado === 'no_calculable') dudoso += 1
    else conCoste += 1
  }
  return {
    total,
    conCoste,
    sinCoste,
    dudoso,
    porRevisar: total - conCoste - sinCoste - dudoso,
    pct: total > 0 ? Math.round((conCoste / total) * 100) : 0,
  }
}

/**
 * La unidad con la que se mide una RACIÓN: la base de la dimensión `unit`, que en
 * esta base de datos es la «Unidad (ud)» global. Cuando el destino de un impacto
 * es un PLATO, la cantidad son raciones y no hay nada que preguntar.
 */
export function unidadRacion(unidades: UnidadPick[]): UnidadPick | null {
  return unidades.find((u) => u.dimension === 'unit' && u.factorABase === 1)
      ?? unidades.find((u) => u.dimension === 'unit')
      ?? null
}
