// src/modules/multitenancy/services/cartaMarcaService.ts
//
// F01 · PR 3 · La carta de una marca (tablero 3) y Marcas › Revisar (tablero
// 4). La lógica vive en la base (20261028T0850_f01c_recetas_y_codigo.sql).

import { rpcSinTipar } from '@/lib/rpcSinTipar'
import {
  leerCarta, leerColocar, leerPorRevisar, sumarColocar,
  type CartaMarca, type PorRevisar, type ResultadoColocar,
} from '../lib/cartaMarca'

export async function leerCartaMarca(accountId: string, brandId: string): Promise<CartaMarca> {
  return leerCarta(await rpcSinTipar<unknown>('f01_carta_marca', { p_account: accountId, p_brand: brandId }))
}

/** «Hacer receta»: el artículo donde se escribe la receta del plato (se crea si no tenía). */
export async function prepararReceta(accountId: string, menuItemId: string): Promise<{ recipeItemId: string; creado: boolean }> {
  const r = await rpcSinTipar<{ recipe_item_id?: string; creado?: boolean }>('f01_preparar_receta', { p_account: accountId, p_menu_item: menuItemId })
  if (!r?.recipe_item_id) throw new Error('La base no ha devuelto dónde escribir la receta.')
  return { recipeItemId: r.recipe_item_id, creado: r.creado === true }
}

/** «Subir mis recetas»: la lectura de un fichero va a ese plato (se guarda allí al confirmarla). */
export async function destinoLectura(accountId: string, sessionId: string, menuItemId: string): Promise<string> {
  const r = await rpcSinTipar<{ recipe_item_id?: string }>('f01_destino_lectura', { p_account: accountId, p_session: sessionId, p_menu_item: menuItemId })
  if (!r?.recipe_item_id) throw new Error('La base no ha devuelto el plato de la receta.')
  return r.recipe_item_id
}

/**
 * Coloca lo vendido de las recetas recién puestas (con la regla 6). La base
 * trabaja por tandas: se repite mientras «quedan», con un tope por si algo no avanza.
 */
export async function colocarRecetas(accountId: string, recetaRecienGuardada: string | null = null): Promise<ResultadoColocar> {
  let total = leerColocar(await rpcSinTipar<unknown>('f01_colocar_recetas', { p_account: accountId, p_receta: recetaRecienGuardada }))
  for (let i = 0; total.quedan > 0 && i < 20; i++) {
    total = sumarColocar(total, leerColocar(await rpcSinTipar<unknown>('f01_colocar_recetas', { p_account: accountId, p_receta: null })))
  }
  return total
}

export async function leerMarcasPorRevisar(accountId: string): Promise<PorRevisar> {
  return leerPorRevisar(await rpcSinTipar<unknown>('f01_marcas_por_revisar', { p_account: accountId }))
}

export interface ResultadoDecision {
  como: 'confirmada' | 'otra'
  nombreLast: string
  marca: string
  locales: { id: string; nombre: string }[]
  ventas: ResultadoColocar
  /** Los platos de la carta de Last que se han quedado sin receta al unirla. */
  sinReceta: string[]
}

export async function decidirMarca(accountId: string, org: string, nombreLast: string, brandId: string, es: boolean): Promise<ResultadoDecision> {
  const r = await rpcSinTipar<Record<string, unknown>>('f01_decidir_marca', { p_account: accountId, p_org: org, p_nombre: nombreLast, p_brand: brandId, p_es: es })
  return {
    como: r?.como === 'otra' ? 'otra' : 'confirmada',
    nombreLast: String(r?.nombre_last ?? nombreLast),
    marca: String(r?.marca ?? ''),
    locales: (Array.isArray(r?.locales) ? (r.locales as { id: string; nombre: string }[]) : []),
    ventas: leerColocar(r?.ventas),
    sinReceta: (Array.isArray(r?.sin_receta) ? (r.sin_receta as unknown[]) : []).map(String).sort((a, b) => a.localeCompare(b, 'es')),
  }
}

export async function avisoVisto(accountId: string, id: string): Promise<string> {
  const r = await rpcSinTipar<{ vistos?: number }>('f01_aviso_visto', { p_account: accountId, p_id: id })
  return (r?.vistos ?? 0) > 0 ? 'Entendido: no volverá a avisar.' : 'Ya estaba visto.'
}
