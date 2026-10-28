// src/pages/trabajador/puedeFichar.ts
//
// L1a · R1 (27/10/2026). Cuándo está activo el botón de fichar, y si no, por
// qué. La misma regla que fichar() en la base: solo se bloquea cuando se SABE
// que la persona está fuera del radio y el local está en «bloquear». Sin la
// ubicación del móvil, o con un local sin la suya puesta, no se puede medir: se
// ficha igual y queda marcado. Un botón gris siempre lleva su motivo.

export interface EstadoParaFichar {
  local: { name: string } | null
  /** Cuántos locales puede elegir la persona. */
  locales: number
  /** Metros al local; null si no se puede medir (sin GPS o local sin coordenadas). */
  distancia: number | null
  radio: number
  modo: 'block' | 'warn'
  hayPosicion: boolean
  /** L1a PR 3: la ubicación del móvil es aproximada (más de 100 m): no se sabe si está fuera. */
  aproximada?: boolean
}

export interface PuedeFichar {
  puede: boolean
  /** Por qué el botón no está activo, en palabras; null si lo está. */
  porQueNo: string | null
  /** Se ficha sin poder medir la distancia: el motivo, para decirlo antes. */
  sinMedir: string | null
}

export function puedeFichar(e: EstadoParaFichar): PuedeFichar {
  if (!e.local) {
    return {
      puede: false,
      porQueNo: e.locales > 1 ? 'Elige arriba el local donde fichas.' : 'No tienes ningún local asignado. Díselo a tu encargado.',
      sinMedir: null,
    }
  }
  const fueraSabido = !e.aproximada && e.distancia !== null && e.distancia > e.radio
  if (fueraSabido && e.modo === 'block') {
    return {
      puede: false,
      porQueNo: `Estás a ${Math.round(e.distancia!)} m de ${e.local.name}. Acércate al local para fichar.`,
      sinMedir: null,
    }
  }
  const sinMedir = e.distancia === null
    ? (!e.hayPosicion ? 'No tenemos tu ubicación' : 'Tu local no tiene su ubicación puesta')
    : null
  return { puede: true, porQueNo: null, sinMedir }
}
