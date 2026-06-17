// src/modules/supply/services/movementsService.ts
//
// AL1 — Frente ① Movimientos (libro mayor del almacén).
//   listMovements      → histórico del ledger con referencia legible (RPC).
//   registerTransfer   → traspaso entre LOCALES (RPC, dos movimientos enlazados).
//   registerDirectEntry→ entrada directa SIN albarán: suma stock reusando el
//                        ajuste (fijar conteo = saldo + N, motivo 'direct_receipt').
// La merma sigue en wasteService (registerWaste); aquí solo se lista en el ledger.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { registerAdjustment, type AdjustmentResult } from './stockAdjustmentService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

type Row = Record<string, unknown>

export interface MovementRow {
  id: string
  movementType: string
  sourceType: string
  itemName: string
  unitAbbr: string | null
  qtyBase: number         // con signo (+ entra, − sale)
  unitCost: number | null
  costEur: number         // |qty| * unitCost
  occurredAt: string
  createdByName: string | null
  reference: string | null  // "Glovo · G047", "GR-00012", "Ajuste · …", "→ Carabanchel"…
  notes: string | null
}

export async function listMovements(input: {
  accountId: string
  locationId: string
  types?: string[] | null
  from?: string | null
  to?: string | null
  limit?: number
  offset?: number
}): Promise<{ total: number; items: MovementRow[] }> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('list_stock_movements', {
    p_account: input.accountId,
    p_location: input.locationId,
    p_types: input.types && input.types.length > 0 ? input.types : undefined,
    p_from: input.from ?? undefined,
    p_to: input.to ?? undefined,
    p_limit: input.limit ?? 200,
    p_offset: input.offset ?? 0,
  })
  if (error) throw new Error(`No se pudo cargar el histórico: ${error.message}`)
  const obj = (data ?? {}) as { total?: unknown; items?: unknown }
  const items = ((obj.items ?? []) as Row[]).map(r => ({
    id: String(r.id),
    movementType: String(r.movement_type),
    sourceType: String(r.source_type),
    itemName: (r.item_name as string) ?? '(sin nombre)',
    unitAbbr: (r.unit_abbr as string | null) ?? null,
    qtyBase: Number(r.qty_base ?? 0),
    unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
    costEur: Number(r.cost_eur ?? 0),
    occurredAt: String(r.occurred_at),
    createdByName: (r.created_by_name as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }))
  return { total: Number(obj.total ?? 0), items }
}

export interface RegisterTransferInput {
  accountId: string
  fromLocation: string
  toLocation: string
  recipeItemId: string
  qtyBase: number
  notes?: string | null
  actorId?: string | null
  actorName?: string | null
}

export async function registerTransfer(input: RegisterTransferInput): Promise<{ transferId: string; costEur: number }> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('register_transfer', {
    p_account_id: input.accountId,
    p_from_location: input.fromLocation,
    p_to_location: input.toLocation,
    p_recipe_item_id: input.recipeItemId,
    p_qty_base: input.qtyBase,
    p_notes: input.notes ?? undefined,
    p_user_id: input.actorId ?? undefined,
    p_user_name: input.actorName ?? undefined,
  })
  if (error) throw new Error(`No se pudo registrar el traspaso: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Row | null
  return { transferId: String(r?.transfer_id ?? ''), costEur: Number(r?.cost_eur ?? 0) }
}

// Entrada directa = SUMAR N al saldo del local, sin albarán. Se apoya en el
// ajuste con motivo 'direct_receipt': fija el conteo a (saldo actual + N). Lee
// el saldo actual para calcular el total a fijar.
export async function registerDirectEntry(input: {
  accountId: string
  locationId: string
  recipeItemId: string
  qtyBase: number
  notes?: string | null
  actorId?: string | null
  actorName?: string | null
}): Promise<AdjustmentResult> {
  requireSupabase()
  const { data } = await supabase!
    .from('recipe_item_location_stock')
    .select('qty_on_hand')
    .eq('account_id', input.accountId)
    .eq('location_id', input.locationId)
    .eq('recipe_item_id', input.recipeItemId)
    .maybeSingle()
  const current = Number((data as { qty_on_hand?: unknown } | null)?.qty_on_hand ?? 0)
  return registerAdjustment({
    accountId: input.accountId,
    locationId: input.locationId,
    recipeItemId: input.recipeItemId,
    reasonCode: 'direct_receipt',
    countedBase: current + input.qtyBase,
    notes: input.notes ?? null,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
  })
}

// Agrupaciones de tipo para el filtro del histórico.
export const MOVEMENT_FILTERS: { key: string; label: string; types: string[] | null }[] = [
  { key: 'all',       label: 'Todos',     types: null },
  { key: 'entradas',  label: 'Entradas',  types: ['recepcion', 'traspaso_entrada'] },
  { key: 'salidas',   label: 'Salidas',   types: ['consumo', 'traspaso_salida'] },
  { key: 'ajustes',   label: 'Ajustes',   types: ['ajuste', 'apertura', 'recuento'] },
  { key: 'mermas',    label: 'Mermas',    types: ['merma'] },
  { key: 'traspasos', label: 'Traspasos', types: ['traspaso_entrada', 'traspaso_salida'] },
]

// Etiqueta legible del tipo de movimiento (para el chip de la fila).
export function movementLabel(type: string): string {
  switch (type) {
    case 'consumo': return 'Venta'
    case 'recepcion': return 'Recepción'
    case 'ajuste': return 'Ajuste'
    case 'apertura': return 'Apertura'
    case 'recuento': return 'Recuento'
    case 'merma': return 'Merma'
    case 'traspaso_entrada': return 'Traspaso entrada'
    case 'traspaso_salida': return 'Traspaso salida'
    default: return type
  }
}
