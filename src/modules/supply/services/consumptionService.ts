// src/modules/supply/services/consumptionService.ts
//
// CONSUMO TEÓRICO (capa 2). Lee el resultado del motor de consumo
// (movimientos `stock_movement` tipo 'consumo', escritos por venta×escandallo)
// y dispara su recálculo del histórico vía la FRONTERA con guard
// `recompute_sales_consumption` (sesión válida).
//
// El consumo NO se elige local a mano: viene del local operativo (igual que el
// resto de Supply). El motor por debajo es puro; esta es la entrada de la app.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

export interface ConsumptionByRaw {
  recipeItemId: string
  itemName: string
  unitAbbr: string | null
  qtyBase: number      // cantidad consumida en unidad base (positiva)
  valueEur: number     // € consumidos (Σ |qty_base| × unit_cost)
  salesCount: number   // nº de líneas de venta que lo movieron
}

export interface RecomputeConsumptionResult {
  linesProcessed: number
  movementsWritten: number
}

/**
 * Recalcula el consumo teórico del histórico para la cuenta en un rango.
 * Frontera con guard (admin/manager de la cuenta). Idempotente: el motor
 * borra y reescribe el consumo de cada línea. `to` es EXCLUSIVO.
 */
export async function recomputeConsumption(input: {
  accountId: string
  from?: string | null   // ISO; null = sin límite inferior
  to?: string | null     // ISO exclusivo; null = sin límite superior
}): Promise<RecomputeConsumptionResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('recompute_sales_consumption', {
    p_account_id: input.accountId,
    p_from: input.from ?? undefined,
    p_to: input.to ?? undefined,
  })
  if (error) throw new Error(`No se pudo recalcular el consumo: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Row | null
  return {
    linesProcessed: Number(r?.lines_processed ?? 0),
    movementsWritten: Number(r?.movements_written ?? 0),
  }
}

/**
 * Consumo teórico por ingrediente (raw) en un rango y local. Agrega los
 * movimientos `consumo` por `recipe_item_id`. Devuelve cantidad en unidad base
 * y valor en €, ordenado por € descendente (el que más dinero mueve, arriba).
 *
 * `to` es EXCLUSIVO. Las fechas se comparan contra `occurred_at` (= sold_at de
 * la venta), no contra created_at, para que el consumo caiga en el periodo real
 * de la venta.
 */
export async function listConsumptionByRaw(input: {
  accountId: string
  locationId: string
  from?: string | null
  to?: string | null
}): Promise<ConsumptionByRaw[]> {
  requireSupabase()

  let q = from('stock_movement')
    .select(`
      recipe_item_id, qty_base, unit_cost, source_id,
      recipe_item:recipe_item_id ( name, kitchen_unit:base_unit_id ( abbreviation ) )
    `)
    .eq('account_id', input.accountId)
    .eq('location_id', input.locationId)
    .eq('movement_type', 'consumo')

  if (input.from) q = q.gte('occurred_at', input.from)
  if (input.to) q = q.lt('occurred_at', input.to)

  const { data, error } = await q
  if (error) throw new Error(`Error cargando el consumo: ${error.message}`)

  // Agregación en cliente por raw: cantidad (|qty_base|), € (|qty_base|×unit_cost),
  // y nº de líneas de venta distintas que lo movieron.
  const acc = new Map<string, {
    name: string; unit: string | null; qty: number; value: number; sources: Set<string>
  }>()

  for (const r0 of (data as Row[] | null) ?? []) {
    const id = r0.recipe_item_id as string
    const item = (r0.recipe_item ?? null) as
      { name?: string; kitchen_unit?: { abbreviation?: string } | null } | null
    const qtyBase = Number(r0.qty_base ?? 0)         // negativo (salida)
    const unitCost = Number(r0.unit_cost ?? 0)
    const absQty = Math.abs(qtyBase)
    const srcId = (r0.source_id as string | null) ?? ''

    const cur = acc.get(id) ?? {
      name: item?.name ?? '(sin nombre)',
      unit: item?.kitchen_unit?.abbreviation ?? null,
      qty: 0, value: 0, sources: new Set<string>(),
    }
    cur.qty += absQty
    cur.value += absQty * unitCost
    if (srcId) cur.sources.add(srcId)
    acc.set(id, cur)
  }

  const out: ConsumptionByRaw[] = Array.from(acc.entries()).map(([id, v]) => ({
    recipeItemId: id,
    itemName: v.name,
    unitAbbr: v.unit,
    qtyBase: Math.round(v.qty * 1000) / 1000,
    valueEur: Math.round(v.value * 100) / 100,
    salesCount: v.sources.size,
  }))

  out.sort((a, b) => b.valueEur - a.valueEur)
  return out
}
