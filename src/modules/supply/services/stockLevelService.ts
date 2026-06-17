// src/modules/supply/services/stockLevelService.ts
//
// Frente ② — Niveles de stock (base del MRP II). Lee niveles + stock actual por
// local (stock_levels_overview) y los define (set_stock_level). La UI activa
// min_qty + par_qty; reorder_point/lead_time/safety quedan listos para el MRP II.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type Row = Record<string, unknown>

export interface StockLevelItem {
  recipeItemId: string
  itemName: string
  familyId: string | null
  familyName: string | null
  unitAbbr: string | null
  qtyOnHand: number
  unitCost: number
  minQty: number | null
  parQty: number | null
  reorderPoint: number | null
  leadTimeDays: number | null
  safetyQty: number | null
  hasLevel: boolean
  belowMin: boolean
  toParQty: number     // par − stock (0 si no aplica) — semilla del "To Par"
}

export async function getStockLevelsOverview(input: {
  accountId: string
  locationId: string
  onlyWithLevel?: boolean
}): Promise<StockLevelItem[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('stock_levels_overview', {
    p_account: input.accountId,
    p_location: input.locationId,
    p_only_with_level: input.onlyWithLevel ?? false,
  })
  if (error) throw new Error(`No se pudieron cargar los niveles: ${error.message}`)
  const obj = (data ?? {}) as { items?: unknown }
  return ((obj.items ?? []) as Row[]).map(r => ({
    recipeItemId: String(r.recipe_item_id),
    itemName: (r.item_name as string) ?? '(sin nombre)',
    familyId: (r.family_id as string | null) ?? null,
    familyName: (r.family_name as string | null) ?? null,
    unitAbbr: (r.unit_abbr as string | null) ?? null,
    qtyOnHand: Number(r.qty_on_hand ?? 0),
    unitCost: Number(r.unit_cost ?? 0),
    minQty: r.min_qty == null ? null : Number(r.min_qty),
    parQty: r.par_qty == null ? null : Number(r.par_qty),
    reorderPoint: r.reorder_point == null ? null : Number(r.reorder_point),
    leadTimeDays: r.lead_time_days == null ? null : Number(r.lead_time_days),
    safetyQty: r.safety_qty == null ? null : Number(r.safety_qty),
    hasLevel: Boolean(r.has_level),
    belowMin: Boolean(r.below_min),
    toParQty: Number(r.to_par_qty ?? 0),
  }))
}

export async function setStockLevel(input: {
  accountId: string
  locationId: string
  recipeItemId: string
  minQty: number | null
  parQty: number | null
  userId?: string | null
  userName?: string | null
}): Promise<void> {
  requireSupabase()
  // min/par: undefined omite el arg → la RPC usa default null → borra ese nivel.
  // reorder/lead/safety NO se envían aquí: los gestiona el MRP II, la UI no los pisa.
  const { error } = await supabase!.rpc('set_stock_level', {
    p_account: input.accountId,
    p_location: input.locationId,
    p_recipe_item: input.recipeItemId,
    p_min: input.minQty ?? undefined,
    p_par: input.parQty ?? undefined,
    p_user_id: input.userId ?? undefined,
    p_user_name: input.userName ?? undefined,
  })
  if (error) throw new Error(`No se pudo guardar el nivel: ${error.message}`)
}

// ─────────────────────────────────────────────────────────────────────
// Lectura ligera para la FICHA del artículo: min/par de un artículo en
// todos sus locales (lee la tabla directa; RLS filtra por cuenta).
// ─────────────────────────────────────────────────────────────────────
export interface ItemLevelRow {
  locationId: string
  minQty: number | null
  parQty: number | null
}

export async function getLevelsForItem(accountId: string, recipeItemId: string): Promise<ItemLevelRow[]> {
  requireSupabase()
  const { data, error } = await (supabase! as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Row[] | null; error: { message: string } | null }> }
      }
    }
  }).from('stock_level').select('location_id, min_qty, par_qty')
    .eq('account_id', accountId).eq('recipe_item_id', recipeItemId)
  if (error) throw new Error(`No se pudieron cargar los niveles del artículo: ${error.message}`)
  return ((data ?? []) as Row[]).map(r => ({
    locationId: String(r.location_id),
    minQty: r.min_qty == null ? null : Number(r.min_qty),
    parQty: r.par_qty == null ? null : Number(r.par_qty),
  }))
}
