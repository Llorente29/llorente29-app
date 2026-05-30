// src/modules/kitchen/services/menuEngineeringService.ts
//
// Ingeniería de menús: cruza la economía de carta (margen) con las ventas
// reales (popularidad) y clasifica cada plato en un cuadrante.
//
//   Estrella  (star)      → vende mucho + buen margen
//   Caballo   (plowhorse) → vende mucho + margen pobre
//   Puzzle    (puzzle)    → vende poco + buen margen
//   Lastre    (dog)       → vende poco + margen pobre
//
// Eje rentabilidad = contribution margin (€/ud), estándar Kasavana-Smith.
// Eje popularidad  = unidades vendidas reales (sale_line) en un rango.
// Las medias de corte son DINÁMICAS: se calculan sobre el conjunto que se
// clasifica, así que al filtrar por canal el umbral se reajusta (igual que
// hacen las baselines dinámicas de Crunchtime).
//
// Solo entran en la matriz los platos 'own' con coste disponible y ventas:
// un 'licensed' no tiene food cost propio, y un plato sin ventas no tiene
// eje popularidad. Ambos se devuelven aparte para no perderlos de vista.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { getMenuItemEconomics } from './menuItemService'
import type { MenuItemEconomics } from '../../../types/kitchen'

export type MenuQuadrant = 'star' | 'plowhorse' | 'puzzle' | 'dog'

// Fila cruda de la RPC menu_item_units_sold (snake_case)
interface RowMenuItemUnitsSold {
  menu_item_id: string
  units_sold: number
  revenue: number
  lines_count: number
  first_sold_at: string | null
  last_sold_at: string | null
}

export interface MenuItemUnitsSold {
  menuItemId: string
  unitsSold: number
  revenue: number
  linesCount: number
  firstSoldAt: string | null
  lastSoldAt: string | null
}

function rowToUnitsSold(row: RowMenuItemUnitsSold): MenuItemUnitsSold {
  return {
    menuItemId: row.menu_item_id,
    unitsSold: Number(row.units_sold),
    revenue: Number(row.revenue),
    linesCount: Number(row.lines_count),
    firstSoldAt: row.first_sold_at,
    lastSoldAt: row.last_sold_at,
  }
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

/**
 * Unidades e ingresos vendidos por menu_item de una marca en un rango.
 * Llama a la función SQL menu_item_units_sold. Eje popularidad de la matriz.
 * from/to en ISO; si se omiten, la RPC usa sus defaults (últimos 90 días).
 */
export async function getMenuItemUnitsSold(
  brandId: string,
  from?: string,
  to?: string
): Promise<MenuItemUnitsSold[]> {
  requireSupabase()
  const params: Record<string, string> = { p_brand_id: brandId }
  if (from) params.p_from = from
  if (to) params.p_to = to
  // 'menu_item_units_sold' se creó después de la última regeneración de
  // database.ts, así que el tipo generado aún no la conoce. Cast puntual
  // (patrón Supabase para RPCs nuevas); el tipo nativo tomará el relevo
  // cuando se regeneren los tipos.
  const { data, error } = await supabase!.rpc(
    'menu_item_units_sold' as never,
    params as never
  )
  if (error) {
    throw new Error(`Error obteniendo ventas de la marca ${brandId}: ${error.message}`)
  }
  return ((data ?? []) as unknown as RowMenuItemUnitsSold[]).map(rowToUnitsSold)
}

// ─────────────────────────────────────────────────────────────────────
// Cruce economics × ventas + clasificación en cuadrantes
// ─────────────────────────────────────────────────────────────────────

// Un plato de la matriz: su economía + su popularidad + el cuadrante.
export interface MenuEngineeringItem {
  menuItemId: string
  menuItemName: string
  channelId: string
  channelName: string
  unitsSold: number
  revenue: number
  contributionMargin: number   // €/ud (eje Y) — siempre presente en la matriz
  netMargin: number | null     // €/ud tras comisión (info adicional)
  foodCostPct: number | null
  price: number
  cost: number | null
  quadrant: MenuQuadrant
  // Impacto: cuánto margen total mueve este plato (margen/ud × unidades).
  // Es el criterio para priorizar acciones: dónde hay más dinero en juego.
  totalContribution: number
  // Precio al que este plato alcanzaría el margen medio del conjunto y
  // pasaría a ser estrella/puzzle (margen ≥ media). Para 'own': coste +
  // margenMedio. null si ya está por encima de la media (no necesita subir).
  targetPrice: number | null
  // Upside mensual estimado si se sube al margen medio manteniendo volumen:
  // (margenMedio − margenActual) × unidades. Solo > 0 para platos bajo la
  // media de margen (caballos y lastres). Estimación, no promesa.
  recoverableMonthly: number
}

export interface MenuEngineeringResult {
  items: MenuEngineeringItem[]      // platos clasificables (own + coste + ventas)
  avgUnitsSold: number              // media de corte (eje X)
  avgContributionMargin: number     // media de corte (eje Y)
  // Suma del upside recuperable de todos los platos bajo la media de margen.
  // El gancho: "subiendo los caballos al margen medio ganarías ~X€/mes".
  // Estimación que asume que el volumen de ventas se mantiene.
  totalRecoverableMonthly: number
  excludedNoSales: MenuItemEconomics[]   // own con coste pero sin ventas en rango
  excludedNoCost: MenuItemEconomics[]    // own sin coste (escandallo incompleto)
  excludedLicensed: MenuItemEconomics[]  // cedidos (sin food cost propio)
}

function classify(
  units: number,
  margin: number,
  avgUnits: number,
  avgMargin: number
): MenuQuadrant {
  const popular = units >= avgUnits
  const profitable = margin >= avgMargin
  if (popular && profitable) return 'star'
  if (popular && !profitable) return 'plowhorse'
  if (!popular && profitable) return 'puzzle'
  return 'dog'
}

/**
 * Ingeniería de menús de una marca: cruza economics × ventas y clasifica.
 * El cliente puede recalcular pasando un subconjunto (p.ej. filtrado por
 * canal) para que las medias de corte se reajusten — ver computeEngineering.
 */
export async function getMenuEngineering(
  brandId: string,
  from?: string,
  to?: string
): Promise<MenuEngineeringResult> {
  const [economics, sales] = await Promise.all([
    getMenuItemEconomics(brandId),
    getMenuItemUnitsSold(brandId, from, to),
  ])
  const salesById = new Map(sales.map(s => [s.menuItemId, s]))
  return computeEngineering(economics, salesById)
}

/**
 * Núcleo puro del cálculo (sin red): cruza economics con un mapa de ventas,
 * calcula las medias dinámicas y asigna cuadrante. Exportado para que la UI
 * lo reaplique sobre subconjuntos (filtro de canal) sin volver a consultar.
 */
export function computeEngineering(
  economics: MenuItemEconomics[],
  salesById: Map<string, MenuItemUnitsSold>
): MenuEngineeringResult {
  const excludedLicensed: MenuItemEconomics[] = []
  const excludedNoCost: MenuItemEconomics[] = []
  const excludedNoSales: MenuItemEconomics[] = []

  // Candidatos a la matriz: own, con coste y con contribution margin
  const candidates: Array<{ e: MenuItemEconomics; s: MenuItemUnitsSold }> = []
  for (const e of economics) {
    if (e.flowType === 'licensed') {
      excludedLicensed.push(e)
      continue
    }
    if (!e.costAvailable || e.contributionMargin === null) {
      excludedNoCost.push(e)
      continue
    }
    const s = salesById.get(e.menuItemId)
    if (!s || s.unitsSold <= 0) {
      excludedNoSales.push(e)
      continue
    }
    candidates.push({ e, s })
  }

  const n = candidates.length
  const avgUnitsSold =
    n > 0 ? candidates.reduce((acc, c) => acc + c.s.unitsSold, 0) / n : 0
  const avgContributionMargin =
    n > 0
      ? candidates.reduce((acc, c) => acc + (c.e.contributionMargin ?? 0), 0) / n
      : 0

  const items: MenuEngineeringItem[] = candidates.map(({ e, s }) => {
    const cm = e.contributionMargin ?? 0
    const belowAvgMargin = cm < avgContributionMargin
    // Precio objetivo: el que lleva el margen del plato a la media del
    // conjunto. Para 'own', margen = precio − coste, así que el precio que
    // da margen = avgMargin es coste + avgMargin. Solo si está por debajo.
    const targetPrice =
      belowAvgMargin && e.cost !== null
        ? Math.round((e.cost + avgContributionMargin) * 100) / 100
        : null
    // Upside mensual: cerrar la brecha de margen sobre las unidades actuales.
    const recoverableMonthly = belowAvgMargin
      ? Math.round((avgContributionMargin - cm) * s.unitsSold * 100) / 100
      : 0
    return {
      menuItemId: e.menuItemId,
      menuItemName: e.menuItemName,
      channelId: e.channelId,
      channelName: e.channelName,
      unitsSold: s.unitsSold,
      revenue: s.revenue,
      contributionMargin: cm,
      netMargin: e.netMargin,
      foodCostPct: e.foodCostPct,
      price: e.price,
      cost: e.cost,
      quadrant: classify(s.unitsSold, cm, avgUnitsSold, avgContributionMargin),
      totalContribution: Math.round(cm * s.unitsSold * 100) / 100,
      targetPrice,
      recoverableMonthly,
    }
  })

  const totalRecoverableMonthly =
    Math.round(items.reduce((acc, it) => acc + it.recoverableMonthly, 0) * 100) / 100

  return {
    items,
    avgUnitsSold,
    avgContributionMargin,
    totalRecoverableMonthly,
    excludedNoSales,
    excludedNoCost,
    excludedLicensed,
  }
}
