// src/modules/kitchen/services/kitchenDashboardService.ts
//
// Agregador del dashboard "Resumen" de Folvy Kitchen (solo lectura).
// NO calcula nada nuevo: reúne lo que ya saben los services existentes y lo
// resume a nivel CUENTA (todas las marcas activas), para alimentar la pantalla
// de inicio del módulo.
//
// Fuentes reales que agrega:
//   - listBrands                          → marcas activas (eje de agregación)
//   - getMenuItemEconomics(brandId)       → food cost / margen real por plato×canal
//   - getMenuItemUnitsSold(brandId,…)     → ventas reales del periodo (eje popularidad / margen €)
//   - computeEngineering(...)             → cuadrantes (estrella/perro/…) sin re-consultar economics
//   - listRecipeItems(type) + getDishesIncomplete → conteos y "lo que falta"
//
// HONESTIDAD (regla nº1): solo trae lo que tiene fuente HOY. NO incluye
// "movimientos de precio 7 días" ni "alérgenos automáticos": el dato base
// existe en BBDD (article_supplier.last_price, recipe_item.nutrition) pero aún
// no hay servicio que lo calcule. Se añadirá en D4 cuando exista, no antes.
//
// Economics/ingeniería son POR MARCA: este agregador recorre las marcas activas
// y combina. Para carteras grandes, considerar caché (deuda anotada).

import { listBrands } from '../../multitenancy/services/brandsService'
import {
  listRecipeItems,
  getDishesIncomplete,
} from './recipeItemService'
import { getMenuItemEconomics } from './menuItemService'
import {
  getMenuItemUnitsSold,
  computeEngineering,
  type MenuItemUnitsSold,
  type MenuQuadrant,
} from './menuEngineeringService'
import type { MenuItemEconomics, FoodCostStatus } from '../../../types/kitchen'
import type { BrandOwnershipType } from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Convención: "ajustado" (ámbar) = por debajo del objetivo pero dentro de
// esta banda de puntos. El motor solo distingue under/over; este matiz de 3
// niveles es decisión de diseño nuestra, con dato real (foodCostPct vs target).
// ─────────────────────────────────────────────────────────────────────
const FOOD_COST_TIGHT_BAND_PCT = 5

// Severidad para elegir el PEOR estado de un plato entre sus canales.
const STATUS_SEVERITY: Record<FoodCostStatus, number> = {
  over: 0,
  no_cost: 1,
  n_a: 2,
  no_target: 3,
  under: 4,
}

// ─────────────────────────────────────────────────────────────────────
// Forma del resultado (view-model del dashboard; no es tabla)
// ─────────────────────────────────────────────────────────────────────
export interface KitchenDashboardKpis {
  avgFoodCostPct: number | null   // media de food cost % (platos own con coste)
  avgNetMarginPct: number | null  // media de margen neto % (rows con margen)
  monthlyMarginEur: number        // Σ (margen neto/ud × uds vendidas) en el periodo
  dishCount: number               // platos activos
  rawCount: number                // ingredientes activos
}

export interface KitchenAttentionCounts {
  recipesUnfinished: number   // platos incompletos (needs_review o línea no costeable)
  rawsWithoutCost: number     // ingredientes sin coste (ni fixed ni computed)
  dishesOverTarget: number    // platos con food cost SOBRE objetivo (distinct)
  dishesWithoutPhoto: number  // platos sin foto
}

export interface KitchenFoodCostHealth {
  healthy: number   // bajo objetivo, holgado
  tight: number     // bajo objetivo pero dentro de la banda (ajustado)
  over: number      // sobre objetivo (pierde margen)
  noData: number    // sin coste / sin objetivo
  total: number
}

export interface KitchenQuadrantCounts {
  star: number
  plowhorse: number
  puzzle: number
  dog: number
  totalRecoverableMonthly: number  // Σ upside mensual estimado (caballos+lastres)
}

export interface ChannelMargin {
  channelId: string
  channelName: string
  avgNetMarginPct: number | null
  rows: number
}

export interface BrandMargin {
  brandId: string
  brandName: string
  ownershipType: BrandOwnershipType
  avgNetMarginPct: number | null
  rows: number
}

export interface KitchenDashboardData {
  periodFrom: string
  periodTo: string
  kpis: KitchenDashboardKpis
  attention: KitchenAttentionCounts
  foodCostHealth: KitchenFoodCostHealth
  quadrants: KitchenQuadrantCounts
  byChannel: ChannelMargin[]
  byBrand: BrandMargin[]
}

export interface GetKitchenDashboardOptions {
  accountId: string
  /** ISO. Si se omiten ambos, se usa el mes natural en curso. */
  from?: string
  to?: string
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Ventana móvil de 30 días (no mes natural): un dashboard serio no depende del
// calendario ni del huso. "Hoy" puede no tener ventas aún; "ayer" puede caer en
// otro mes/UTC. 30 días siempre refleja actividad reciente real.
function defaultRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: now.toISOString() }
}

function hasCost(fixed: number | null, computed: number | null): boolean {
  const f = fixed ?? 0
  const c = computed ?? 0
  return f > 0 || c > 0
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────
export async function getKitchenDashboard(
  opts: GetKitchenDashboardOptions
): Promise<KitchenDashboardData> {
  const range =
    opts.from && opts.to
      ? { from: opts.from, to: opts.to }
      : defaultRange()

  // Marcas activas + conteos de catálogo + incompletos (en paralelo).
  const [brands, dishes, raws, incompleteDishIds] = await Promise.all([
    listBrands({ accountId: opts.accountId, includeInactive: false }),
    listRecipeItems({ accountId: opts.accountId, type: 'dish' }),
    listRecipeItems({ accountId: opts.accountId, type: 'raw' }),
    getDishesIncomplete(opts.accountId),
  ])

  // Economía + ventas del periodo por marca (paralelo por marca).
  const perBrand = await Promise.all(
    brands.map(async (b) => {
      const [economics, sales] = await Promise.all([
        getMenuItemEconomics(b.id),
        getMenuItemUnitsSold(b.id, range.from, range.to),
      ])
      return { brand: b, economics, sales }
    })
  )

  // Aplanado de todas las filas económicas (para salud, canal, KPIs).
  const allEconomics: MenuItemEconomics[] = perBrand.flatMap((p) => p.economics)

  // ── KPIs ──────────────────────────────────────────────────────────
  const fcRows = allEconomics.filter(
    (r) => r.flowType === 'own' && r.foodCostPct !== null
  )
  const avgFoodCostPct =
    fcRows.length > 0
      ? round1(fcRows.reduce((acc, r) => acc + (r.foodCostPct ?? 0), 0) / fcRows.length)
      : null

  const nmRows = allEconomics.filter((r) => r.netMarginPct !== null)
  const avgNetMarginPct =
    nmRows.length > 0
      ? round1(nmRows.reduce((acc, r) => acc + (r.netMarginPct ?? 0), 0) / nmRows.length)
      : null

  // Margen del periodo en €: Σ (margen neto/ud × uds vendidas).
  let monthlyMarginEur = 0
  for (const p of perBrand) {
    const salesById = new Map<string, MenuItemUnitsSold>(
      p.sales.map((s) => [s.menuItemId, s])
    )
    for (const r of p.economics) {
      if (r.netMargin === null) continue
      const s = salesById.get(r.menuItemId)
      const units = s ? s.unitsSold : 0
      if (units > 0) monthlyMarginEur += r.netMargin * units
    }
  }
  monthlyMarginEur = round2(monthlyMarginEur)

  // ── Salud del food cost (por PLATO, peor estado entre sus canales) ──
  const byDish = new Map<string, MenuItemEconomics[]>()
  for (const r of allEconomics) {
    if (r.flowType !== 'own') continue
    const arr = byDish.get(r.recipeItemId)
    if (arr) arr.push(r)
    else byDish.set(r.recipeItemId, [r])
  }
  let healthy = 0
  let tight = 0
  let over = 0
  let noData = 0
  for (const rows of byDish.values()) {
    let worstSev = 99
    let worst: FoodCostStatus = 'n_a'
    for (const r of rows) {
      const sev = STATUS_SEVERITY[r.foodCostStatus]
      if (sev < worstSev) {
        worstSev = sev
        worst = r.foodCostStatus
      }
    }
    if (worst === 'over') {
      over += 1
    } else if (worst === 'under') {
      const isTight = rows.some((r) => {
        if (r.foodCostStatus !== 'under') return false
        if (r.foodCostPct === null || r.targetFoodCostPct === null) return false
        return r.foodCostPct >= r.targetFoodCostPct - FOOD_COST_TIGHT_BAND_PCT
      })
      if (isTight) tight += 1
      else healthy += 1
    } else {
      noData += 1
    }
  }
  const foodCostHealth: KitchenFoodCostHealth = {
    healthy,
    tight,
    over,
    noData,
    total: byDish.size,
  }

  // ── Ingeniería de menús (cuadrantes por marca, agregados) ───────────
  let star = 0
  let plowhorse = 0
  let puzzle = 0
  let dog = 0
  let totalRecoverableMonthly = 0
  for (const p of perBrand) {
    const salesById = new Map<string, MenuItemUnitsSold>(
      p.sales.map((s) => [s.menuItemId, s])
    )
    const eng = computeEngineering(p.economics, salesById)
    for (const it of eng.items) {
      const q: MenuQuadrant = it.quadrant
      if (q === 'star') star += 1
      else if (q === 'plowhorse') plowhorse += 1
      else if (q === 'puzzle') puzzle += 1
      else dog += 1
    }
    totalRecoverableMonthly += eng.totalRecoverableMonthly
  }
  const quadrants: KitchenQuadrantCounts = {
    star,
    plowhorse,
    puzzle,
    dog,
    totalRecoverableMonthly: round2(totalRecoverableMonthly),
  }

  // ── Margen por canal (todas las marcas) ─────────────────────────────
  const chMap = new Map<
    string,
    { channelId: string; channelName: string; sum: number; n: number }
  >()
  for (const r of allEconomics) {
    if (r.netMarginPct === null) continue
    const e = chMap.get(r.channelId)
    if (e) {
      e.sum += r.netMarginPct
      e.n += 1
    } else {
      chMap.set(r.channelId, {
        channelId: r.channelId,
        channelName: r.channelName,
        sum: r.netMarginPct,
        n: 1,
      })
    }
  }
  const byChannel: ChannelMargin[] = Array.from(chMap.values())
    .map((e) => ({
      channelId: e.channelId,
      channelName: e.channelName,
      avgNetMarginPct: e.n > 0 ? round1(e.sum / e.n) : null,
      rows: e.n,
    }))
    .sort((a, b) => (b.avgNetMarginPct ?? -999) - (a.avgNetMarginPct ?? -999))

  // ── Margen por marca ────────────────────────────────────────────────
  const byBrand: BrandMargin[] = perBrand
    .map((p) => {
      const rows = p.economics.filter((r) => r.netMarginPct !== null)
      const avg =
        rows.length > 0
          ? round1(rows.reduce((acc, r) => acc + (r.netMarginPct ?? 0), 0) / rows.length)
          : null
      return {
        brandId: p.brand.id,
        brandName: p.brand.name,
        ownershipType: p.brand.ownershipType,
        avgNetMarginPct: avg,
        rows: rows.length,
      }
    })
    .sort((a, b) => (b.avgNetMarginPct ?? -999) - (a.avgNetMarginPct ?? -999))

  // ── "Necesita tu atención" ──────────────────────────────────────────
  const rawsWithoutCost = raws.filter(
    (r) => !hasCost(r.fixedCost, r.computedCost)
  ).length
  const dishesWithoutPhoto = dishes.filter(
    (d) => d.kitchenPhotoUrl === null || d.kitchenPhotoUrl.trim() === ''
  ).length

  const attention: KitchenAttentionCounts = {
    recipesUnfinished: incompleteDishIds.size,
    rawsWithoutCost,
    dishesOverTarget: over,
    dishesWithoutPhoto,
  }

  return {
    periodFrom: range.from,
    periodTo: range.to,
    kpis: {
      avgFoodCostPct,
      avgNetMarginPct,
      monthlyMarginEur,
      dishCount: dishes.length,
      rawCount: raws.length,
    },
    attention,
    foodCostHealth,
    quadrants,
    byChannel,
    byBrand,
  }
}
