// src/modules/ventas/services/foodCostService.ts
//
// Food cost real (escandallo) por marca y por plato. Lee la RPC server-side
// `food_cost_dashboard` (sale_line -> menu_item -> recipe_item.computed_cost).
// Devuelve cobertura (salud del dato) y marca recetas sospechosas.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

export interface FoodCostSalud {
  lineas: number
  lineas_costeadas: number
  cobertura_pct: number | null
}
export interface FoodCostTotal {
  ingreso: number
  food_cost: number
  food_cost_pct: number | null
}
export interface FoodCostBrand {
  brand: string
  ingreso: number
  food_cost: number
  food_cost_pct: number | null
  cobertura_pct: number | null
  sospechoso: boolean
}
export interface FoodCostDish {
  dish: string
  brand: string | null
  uds: number
  precio: number
  food: number
  food_cost_pct: number | null
  ingreso: number
}
export interface FoodCostDashboard {
  salud: FoodCostSalud
  total: FoodCostTotal
  by_brand: FoodCostBrand[]
  by_dish: FoodCostDish[]
}

export interface FoodCostFilters {
  accountId: string
  from?: Date | null
  to?: Date | null
  locationId?: string | null
  brandId?: string | null
}

const EMPTY: FoodCostDashboard = {
  salud: { lineas: 0, lineas_costeadas: 0, cobertura_pct: null },
  total: { ingreso: 0, food_cost: 0, food_cost_pct: null },
  by_brand: [], by_dish: [],
}

// ── Margen por marca: comisión REAL (tarifa) + food cost REAL ────────────────

export interface MarginBrand {
  brand: string
  venta: number
  comision: number
  comision_pct: number | null
  food: number
  food_pct: number | null
  promo_pct: number | null
  cobertura_pct: number | null
}
export interface MarginByBrand {
  total: { venta: number; comision: number; food: number; promo: number }
  by_brand: MarginBrand[]
}

export async function getMarginByBrand(f: FoodCostFilters): Promise<MarginByBrand> {
  requireSupabase()
  const iso = (d?: Date | null) => (d ? d.toISOString() : null)
  const { data, error } = await (
    supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { message: string } | null }>
  )('margin_by_brand', {
    p_account: f.accountId, p_from: iso(f.from), p_to: iso(f.to), p_location: f.locationId ?? null,
  })
  if (error) throw new Error(`Error cargando margen: ${error.message}`)
  const d = (data ?? {}) as Partial<MarginByBrand>
  return { total: d.total ?? { venta: 0, comision: 0, food: 0, promo: 0 }, by_brand: d.by_brand ?? [] }
}

export async function getFoodCost(f: FoodCostFilters): Promise<FoodCostDashboard> {
  requireSupabase()
  const iso = (d?: Date | null) => (d ? d.toISOString() : null)
  const { data, error } = await (
    supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { message: string } | null }>
  )('food_cost_dashboard', {
    p_account: f.accountId,
    p_from: iso(f.from),
    p_to: iso(f.to),
    p_location: f.locationId ?? null,
    p_brand: f.brandId ?? null,
  })
  if (error) throw new Error(`Error cargando food cost: ${error.message}`)
  if (!data) return EMPTY
  const d = data as Partial<FoodCostDashboard>
  return {
    salud: d.salud ?? EMPTY.salud,
    total: d.total ?? EMPTY.total,
    by_brand: d.by_brand ?? [],
    by_dish: d.by_dish ?? [],
  }
}
