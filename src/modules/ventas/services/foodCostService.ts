// src/modules/ventas/services/foodCostService.ts
//
// Food cost real (escandallo) por marca y por plato. Lee la RPC server-side
// `food_cost_dashboard` (sale_line -> menu_item -> recipe_item.computed_cost).
// Devuelve cobertura (salud del dato) y marca recetas sospechosas.
//
// 02/09 — LA RPC CUENTA POR UNIDAD DE VENTA, NO POR LÍNEA. Un combo reparte su
// coste entre las líneas hijas y su PRECIO en la línea padre (581 de 605 combos
// de 30 días lo hacen así, 13.229 €). Contando por línea, el coste de los hijos
// entraba en el numerador y el ingreso del padre se caía del denominador por no
// tener receta: el food cost salía 27,4 % siendo 22,3 %, y marcas enteras
// aparecían al doble de lo que son (Ay Mamita Bowls 46,3 % -> 18,9 %).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

/**
 * SALUD DEL DATO, contada por UNIDAD DE VENTA — no por línea.
 *
 * Una unidad es una línea de producto MÁS sus hijos (`combo_item` y
 * `modifier`): lo que el cliente compró y pagó junto. Hasta el 02/09 esto se
 * contaba por línea suelta y decía 71,4 % donde la verdad es 95,2 %, porque
 * metía en el denominador 2.862 líneas de modificador y de componente de combo
 * que no son platos y no pueden llevar escandallo propio.
 *
 * `cobertura_dinero_pct` es la misma pregunta pesada por euros, que es la que
 * de verdad importa: da igual que falte por costear una unidad de 2 € o una de
 * 40 si se cuentan igual.
 */
export interface FoodCostSalud {
  unidades: number
  unidades_costeadas: number
  cobertura_pct: number | null
  cobertura_dinero_pct: number | null
  /** Ingreso del periodo ENTERO, costeado o no. Es la prueba en euros de
   *  `cobertura_dinero_pct`: sin él, la cifra iría acompañada de un conteo de
   *  unidades que da OTRO porcentaje. */
  ingreso_total: number
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
  salud: {
    unidades: 0, unidades_costeadas: 0,
    cobertura_pct: null, cobertura_dinero_pct: null, ingreso_total: 0,
  },
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

export interface LocationOpt { id: string; name: string }
export async function getLocations(accountId: string): Promise<LocationOpt[]> {
  requireSupabase()
  const { data, error } = await (supabase! as any)
    .from('locations').select('id,name').eq('account_id', accountId).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((l: any) => ({ id: l.id, name: l.name }))
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
