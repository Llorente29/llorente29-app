// src/modules/pase/lib/elCierreAMano.ts
//
// Los motivos del cierre a mano y la frase con la que se confirma.
//
// 🔴 Viven en `lib/` y no dentro del componente por la regla del 05/09: exportar
// funciones y constantes desde un fichero de componente rompe el refresco en
// caliente y el lint lo canta (`react-refresh/only-export-components`). Aquel
// día costó cinco errores nuevos que se colaron detrás de un «no he roto nada».

import type { TarjetaDelPase } from '../services/paseService'
import { laSituacion } from './lasTresZonas'

/**
 * LOS CUATRO MOTIVOS, los de Julio (17/09). La clave viaja a la base --es lo
 * que se podrá contar dentro de un mes-- y el rótulo es lo que se lee.
 *
 * «Otro» pide texto OBLIGATORIO: un motivo que no se puede contar y que además
 * no se explica no sirve para nada, y el día que alguien mire por qué se
 * cierran a mano cuarenta pedidos al mes se encontrará cuarenta «Otro».
 */
export const MOTIVOS = [
  { clave: 'cliente_no_abre',      rotulo: 'El cliente no abre' },
  { clave: 'rider_no_puede',       rotulo: 'El repartidor no puede seguir' },
  { clave: 'entregado_sin_marcar', rotulo: 'Se entregó y no se marcó' },
  { clave: 'otro',                 rotulo: 'Otro' },
] as const

export type ClaveMotivo = typeof MOTIVOS[number]['clave']

/** Qué falta para poder pulsar. `null` = se puede. Se DICE, no se pone gris. */
export function loQueFalta(
  elegido: string | null, motivo: ClaveMotivo | null, texto: string,
): string | null {
  if (!elegido) return 'Elige primero el pedido.'
  if (!motivo) return 'Elige por qué se cierra.'
  if (motivo === 'otro' && texto.trim().length < 3) return 'Escribe el motivo.'
  return null
}

/** Lo que ve el que cierra, con CONTENIDO (regla 8). Nunca un visto. */
export function laConfirmacion(t: TarjetaDelPase | undefined, motivo: ClaveMotivo): string {
  const rotulo = MOTIVOS.find(m => m.clave === motivo)?.rotulo ?? 'Otro'
  const que = t ? `${t.codigo ?? 'El pedido'} · ${t.marca ?? ''}`.trim() : 'El pedido'
  const donde = t ? laSituacion(t) : null
  const estaba = donde === 'en_ruta' ? ' Estaba en «En ruta».'
               : donde === 'entregado' ? ' Ya constaba entregado.'
               : ''
  return `${que} cerrado a mano. Motivo: ${rotulo.toLowerCase()}.${estaba}`
}
