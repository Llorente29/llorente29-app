// src/modules/kitchen/services/itemStockService.ts
//
// AL1 — Ficha del artículo viva. Dos lecturas:
//   getItemStockByLocation → saldo del artículo en cada local (cantidad, valor)
//     + formato de compra de referencia para mostrarlo legible.
//   getItemMovements → histórico del artículo en todos los locales, con el nombre
//     del local y la referencia resuelta (venta/recepción/ajuste/merma/traspaso).

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type Row = Record<string, unknown>

export interface ItemLocationStock {
  locationId: string
  locationName: string
  qty: number
  valueEur: number
  hasStockRow: boolean
}

export interface ItemStockByLocation {
  unitAbbr: string | null
  buyFormatName: string | null
  buyFormatQtyInBase: number | null
  totalQty: number
  totalValue: number
  locations: ItemLocationStock[]
}

export async function getItemStockByLocation(accountId: string, recipeItemId: string): Promise<ItemStockByLocation> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('item_stock_by_location', {
    p_account: accountId,
    p_recipe_item: recipeItemId,
  })
  if (error) throw new Error(`No se pudo leer el stock: ${error.message}`)
  const o = (data ?? {}) as Row
  return {
    unitAbbr: (o.unit_abbr as string | null) ?? null,
    buyFormatName: (o.buy_format_name as string | null) ?? null,
    buyFormatQtyInBase: o.buy_format_qty_in_base == null ? null : Number(o.buy_format_qty_in_base),
    totalQty: Number(o.total_qty ?? 0),
    totalValue: Number(o.total_value ?? 0),
    locations: ((o.locations ?? []) as Row[]).map(r => ({
      locationId: String(r.location_id),
      locationName: (r.location_name as string) ?? '(local)',
      qty: Number(r.qty ?? 0),
      valueEur: Number(r.value_eur ?? 0),
      hasStockRow: Boolean(r.has_stock_row),
    })),
  }
}

export interface ItemMovement {
  id: string
  movementType: string
  sourceType: string
  locationName: string | null
  qtyBase: number
  unitCost: number | null
  costEur: number
  occurredAt: string
  createdByName: string | null
  reference: string | null
  notes: string | null
}

export async function getItemMovements(
  accountId: string,
  recipeItemId: string,
  opts?: { location?: string | null; from?: string | null; to?: string | null; limit?: number },
): Promise<ItemMovement[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('item_movements', {
    p_account: accountId,
    p_recipe_item: recipeItemId,
    p_location: opts?.location ?? undefined,
    p_from: opts?.from ?? undefined,
    p_to: opts?.to ?? undefined,
    p_limit: opts?.limit ?? 200,
  })
  if (error) throw new Error(`No se pudo leer el histórico: ${error.message}`)
  return ((data ?? []) as Row[]).map(r => ({
    id: String(r.id),
    movementType: String(r.movement_type),
    sourceType: String(r.source_type),
    locationName: (r.location_name as string | null) ?? null,
    qtyBase: Number(r.qty_base ?? 0),
    unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
    costEur: Number(r.cost_eur ?? 0),
    occurredAt: String(r.occurred_at),
    createdByName: (r.created_by_name as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }))
}
