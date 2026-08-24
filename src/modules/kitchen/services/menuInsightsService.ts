// src/modules/kitchen/services/menuInsightsService.ts
//
// Los datos de NEGOCIO que le faltaban al gestor de menús: ventas por producto,
// tendencia de la marca, top ventas y los 86 olvidados.
//
// TESIS DEL REDISEÑO: esta pantalla no es un gestor de cartas, es un panel de
// rentabilidad que además edita la carta. Para eso hace falta que la fila sepa
// cuánto vende, no solo cuánto cuesta.
//
// RENDIMIENTO — la carta puede tener 100+ productos y el encargo exige <2 s sin
// N+1. Nada aquí consulta por producto:
//   * las ventas salen de `menu_item_units_sold`, una RPC que YA EXISTÍA y
//     agrega en el servidor (GROUP BY menu_item_id). Tres llamadas en total
//     —7 días, los 7 anteriores y 30 días—, no tres por fila.
//   * los 86 salen de una sola lectura de `product_availability`, que es una
//     tabla de overrides vivos: tiene tantas filas como cosas agotadas hay.
//
// "AGOTADO DESDE CUÁNDO": OJO, NO es menu_item.updated_at.
// El encargo daba por bueno ese campo, pero `set_menu_item_updated_at` es un
// trigger BEFORE UPDATE sobre CUALQUIER columna: renombrar un producto —que
// desde F3 se hace con un doble clic— reinicia el reloj y el aviso de "llevas
// dos días con esto agotado" no saltaría nunca. La fecha de verdad es
// `product_availability.set_at`, que solo la escribe el 86.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { getMenuItemUnitsSold } from './menuEngineeringService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado')
}

export interface ItemInsight {
  units7d: number
  revenue7d: number
  units30d: number
}

export interface BrandInsight {
  revenue7d: number
  revenuePrev7d: number
  /** Variación vs la semana anterior. null si no hay base con la que comparar. */
  trendPct: number | null
  units7d: number
}

export interface StaleUnavailable {
  /** Clave con la que casar contra el producto: una de las dos vendrá. */
  externalId: string | null
  recipeItemId: string | null
  since: string
  hours: number
}

export interface MenuInsights {
  byItem: Map<string, ItemInsight>
  brand: BrandInsight
  /** Los 3 más vendidos en 7 DÍAS, con su puesto: menuItemId -> 1 | 2 | 3.
   *  Es un Map y no un Set porque la fila enseña el puesto ("TOP 2"), no un
   *  "estás en el podio" genérico. */
  topRank: Map<string, number>
  /** 86 puestos hace más de 48 h: ventas que quizá se estén perdiendo. */
  stale86: StaleUnavailable[]
}

export const EMPTY_INSIGHTS: MenuInsights = {
  byItem: new Map(),
  brand: { revenue7d: 0, revenuePrev7d: 0, trendPct: null, units7d: 0 },
  topRank: new Map(),
  stale86: [],
}

const STALE_86_HOURS = 48

function iso(d: Date): string { return d.toISOString() }

/**
 * Todo lo que la pantalla necesita saber del negocio de una marca.
 *
 * Degrada por partes: si las ventas fallan se devuelven a cero y la carta se
 * sigue viendo entera. Un panel que se cae porque falta un número es peor que
 * un panel sin ese número.
 */
export async function getMenuInsights(
  accountId: string,
  brandId: string,
): Promise<MenuInsights> {
  requireSupabase()

  const now = new Date()
  const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const d14 = new Date(now.getTime() - 14 * 24 * 3600 * 1000)
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

  const [cur, prev, m30, stale] = await Promise.all([
    getMenuItemUnitsSold(brandId, iso(d7), iso(now)).catch(() => []),
    getMenuItemUnitsSold(brandId, iso(d14), iso(d7)).catch(() => []),
    getMenuItemUnitsSold(brandId, iso(d30), iso(now)).catch(() => []),
    listStaleUnavailable(accountId).catch(() => [] as StaleUnavailable[]),
  ])

  const byItem = new Map<string, ItemInsight>()
  for (const r of m30) {
    byItem.set(r.menuItemId, { units7d: 0, revenue7d: 0, units30d: r.unitsSold })
  }
  for (const r of cur) {
    const prevEntry = byItem.get(r.menuItemId)
    byItem.set(r.menuItemId, {
      units7d: r.unitsSold,
      revenue7d: r.revenue,
      units30d: prevEntry?.units30d ?? r.unitsSold,
    })
  }

  const revenue7d = cur.reduce((n, r) => n + r.revenue, 0)
  const revenuePrev7d = prev.reduce((n, r) => n + r.revenue, 0)
  const units7d = cur.reduce((n, r) => n + r.unitsSold, 0)

  // Sin semana anterior no hay tendencia. Pintar "+100%" porque antes no había
  // nada sería inventarse una mejora: mejor no decir nada.
  const trendPct = revenuePrev7d > 0
    ? ((revenue7d - revenuePrev7d) / revenuePrev7d) * 100
    : null

  // El podio va por ventas de 7 DÍAS, la misma ventana que enseña la fila y el
  // header: un "TOP 1" calculado a 30 días junto a un "12 vtas/7d" invitaría a
  // comparar dos cosas que no se pueden comparar.
  //
  // El desempate por id no es capricho: sin él, dos productos con las mismas
  // unidades podrían intercambiar el puesto entre recargas, y un podio que
  // baila sin que cambien las ventas no se lo cree nadie.
  const topRank = new Map<string, number>()
  ;[...cur]
    .filter((r) => r.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold || a.menuItemId.localeCompare(b.menuItemId))
    .slice(0, 3)
    .forEach((r, i) => topRank.set(r.menuItemId, i + 1))

  return { byItem, brand: { revenue7d, revenuePrev7d, trendPct, units7d }, topRank, stale86: stale }
}

/** 86 vivos con más de 48 h encima. Ver la nota de cabecera sobre `set_at`. */
export async function listStaleUnavailable(accountId: string): Promise<StaleUnavailable[]> {
  requireSupabase()
  const cutoff = new Date(Date.now() - STALE_86_HOURS * 3600 * 1000).toISOString()
  const { data, error } = await supabase!
    .from('product_availability')
    .select('external_id, recipe_item_id, set_at, available_until')
    .eq('account_id', accountId)
    .eq('is_available', false)
    .lt('set_at', cutoff)
  if (error) throw new Error(`Error leyendo agotados antiguos: ${error.message}`)

  const now = Date.now()
  return (data ?? [])
    // Un 86 con fecha de vuelta programada no está olvidado: está previsto.
    .filter((r) => !r.available_until || new Date(r.available_until as string).getTime() < now)
    .map((r) => ({
      externalId: (r.external_id as string) ?? null,
      recipeItemId: (r.recipe_item_id as string) ?? null,
      since: r.set_at as string,
      hours: Math.floor((now - new Date(r.set_at as string).getTime()) / 3600_000),
    }))
}

/**
 * Coste de plato por RECETA, en una sola consulta.
 *
 * POR QUÉ NO SE USA `menu_item_economics` PARA ESTO
 * Esa RPC hace `JOIN sales_channel sc ON sc.id = mi.channel_id` —un INNER
 * JOIN— y en esta cuenta `menu_item.channel_id` es NULL en las 513 filas
 * vivas. Resultado: la RPC devuelve CERO filas para cualquier marca, el mapa
 * de economía llega vacío, y todo lo que dependa de él se comporta como si
 * ningún plato tuviera escandallo. Ese fue el bug del badge.
 *
 * Y aunque devolviera filas, tampoco sería lo que la fila necesita: esa RPC
 * calcula margen NETO por canal (comisiones, reparto, licencias). El margen de
 * la fila es el de PLATO —precio contra coste de escandallo—, que es un número
 * por producto y no por canal.
 */
export async function listRecipeCosts(
  recipeItemIds: string[],
): Promise<Map<string, number>> {
  requireSupabase()
  const out = new Map<string, number>()
  if (recipeItemIds.length === 0) return out
  const { data, error } = await supabase!
    .from('recipe_item')
    .select('id, computed_cost')
    .in('id', recipeItemIds)
  if (error) throw new Error(`Error leyendo costes de escandallo: ${error.message}`)
  for (const r of data ?? []) {
    if (r.computed_cost === null) continue
    out.set(r.id as string, Number(r.computed_cost))
  }
  return out
}
