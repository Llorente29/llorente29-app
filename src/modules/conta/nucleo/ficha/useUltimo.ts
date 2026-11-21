// src/modules/conta/nucleo/ficha/useUltimo.ts
//
// K04 · Lo último que se leyó para ESTA clave (la misma factura): mientras se
// vuelve a leer (después de guardar, o de no poder validar), la ficha no se
// vacía. useLeer devuelve null en cuanto cambia su clave, y sin esto la ficha
// pasaba un momento sin factura y sin propuesta: la cuenta de gasto se quedaba
// vacía y F5 desde su casilla no encontraba cuenta (e2e 1507). Es el mismo
// patrón de la ficha de hoy (RevisarFacturaPage); otra clave (otra factura)
// empieza de cero. Lo heredan la emitida y el asiento.

import { useState } from 'react'

export function useUltimo<T>(datos: T | null, clave: string): T | null {
  const [ultimo, setUltimo] = useState<{ clave: string; datos: T } | null>(null)
  // Al pintar, no en un efecto (el patrón de React para «lo del render anterior»).
  if (datos !== null && (ultimo?.clave !== clave || ultimo.datos !== datos)) setUltimo({ clave, datos })
  return datos ?? (ultimo?.clave === clave ? ultimo.datos : null)
}
