// src/modules/conta/diseno/plantillas/anchos.ts
//
// N5 · La regla de anchos de pantalla (Julio, aprobada el 23/10). Núcleo puro:
// qué hace cada pantalla según el ancho de la ventana, y qué columnas de una
// lista caben. Se prueba sin navegador.
//
//   · 1600 px o más ........ la barra abierta (como la deje cada persona) y el PDF al lado;
//   · de 1280 a 1599 ....... la barra se pliega sola (se puede abrir a mano un rato);
//   · de 1024 a 1279 ....... la barra plegada y el PDF en un panel, que se abre con un botón;
//   · de 768 a 1023 ........ como de 1024 a 1279 (la regla no lo dice: lo más prudente);
//   · menos de 768 ......... una sola columna (lo de siempre en el móvil).
//
// En las listas, las columnas se ocultan por prioridad, nunca con
// desplazamiento lateral: cada columna dice su prioridad (1 = siempre) y lo
// que ocupa como mínimo; se quitan las de prioridad más alta hasta que caben.
// Es el ancho de la COLUMNA, no el de las filas: ninguna fila se esconde (regla 7).

export type TramoAncho = 'ancho' | 'medio' | 'estrecho' | 'tableta' | 'movil'

export const CORTES = { ancho: 1600, medio: 1280, estrecho: 1024, tableta: 768 } as const

export function tramoDeAncho(px: number): TramoAncho {
  if (px >= CORTES.ancho) return 'ancho'
  if (px >= CORTES.medio) return 'medio'
  if (px >= CORTES.estrecho) return 'estrecho'
  if (px >= CORTES.tableta) return 'tableta'
  return 'movil'
}

/**
 * ¿La barra va abierta? Con 1600 px o más, como la deje cada persona (su
 * preferencia). Por debajo, plegada sola; si la abre a mano, abierta mientras
 * no cambie de tramo (no se guarda: la preferencia es la de la pantalla ancha).
 */
export function barraAbierta(tramo: TramoAncho, preferencia: boolean, aMano: boolean | null): boolean {
  if (tramo === 'ancho') return preferencia
  return aMano ?? false
}

/** ¿El PDF va en un panel (con un botón) en vez de al lado? De 768 a 1279 px. */
export const documentoEnPanel = (tramo: TramoAncho): boolean => tramo === 'estrecho' || tramo === 'tableta'

export interface ColumnaConPrioridad {
  id: string
  /** 1 = siempre se ve; cuanto más alta, antes se oculta. Sin ella, 1. */
  prioridad?: number
  /** Lo que ocupa como mínimo, en px. Sin él, 96. */
  minimo?: number
}

export const MINIMO_COLUMNA = 96

/**
 * Las columnas que caben en `disponible` px (lo que deja la lista, ya sin la
 * casilla ni la flecha de abrir). Se quitan primero las de prioridad más alta
 * (y, a igual prioridad, la de más a la derecha). Las de prioridad 1 no se
 * quitan nunca, aunque no quepan. Devuelve los id que se ven, en su orden.
 */
export function columnasQueCaben(columnas: readonly ColumnaConPrioridad[], disponible: number): string[] {
  const vistas = columnas.map((c, i) => ({ id: c.id, p: c.prioridad ?? 1, min: c.minimo ?? MINIMO_COLUMNA, i }))
  const ocupa = () => vistas.reduce((t, c) => t + c.min, 0)
  while (ocupa() > disponible) {
    const quitables = vistas.filter((c) => c.p > 1)
    if (quitables.length === 0) break
    const quitar = quitables.reduce((a, b) => (b.p > a.p || (b.p === a.p && b.i > a.i) ? b : a))
    vistas.splice(vistas.indexOf(quitar), 1)
  }
  return vistas.map((c) => c.id)
}

/** Lo que dice el pie de la lista si hay columnas ocultas (para quien echa una de menos). */
export function textoColumnasOcultas(ocultas: readonly string[]): string | null {
  if (ocultas.length === 0) return null
  const lista = ocultas.length === 1 ? ocultas[0] : `${ocultas.slice(0, -1).join(', ')} y ${ocultas[ocultas.length - 1]}`
  return `Con este ancho no caben ${lista}: están en la ficha de cada una.`
}
