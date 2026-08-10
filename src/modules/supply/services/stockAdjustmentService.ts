// src/modules/supply/services/stockAdjustmentService.ts
//
// AL1 — Ajuste de stock con motivo.
// Envuelve el RPC register_adjustment: el usuario FIJA el conteo real (en unidad
// base) y el backend calcula la diferencia contra el saldo actual, la escribe al
// ledger como movimiento 'ajuste' con un motivo, y recalcula el saldo.

import { supabase } from '@/lib/supabase'

export interface AdjustmentResult {
  adjustmentId: string
  deltaBase: number   // movimiento aplicado (con signo)
  costEur: number     // impacto en € (con signo)
}

export interface RegisterAdjustmentInput {
  accountId: string
  locationId: string
  recipeItemId: string
  reasonCode: string
  countedBase: number              // conteo real, en unidad base
  useUnitLabel?: string | null     // unidad amigable en que contó ("Bolsa")
  useUnitFactor?: number | null    // factor de esa unidad a base
  useQty?: number | null           // cantidad en esa unidad amigable
  notes?: string | null
  actorId?: string | null
  actorName?: string | null
}

export async function registerAdjustment(input: RegisterAdjustmentInput): Promise<AdjustmentResult> {
  const { data, error } = await supabase!.rpc('register_adjustment', {
    p_account_id: input.accountId,
    p_location_id: input.locationId,
    p_recipe_item_id: input.recipeItemId,
    p_reason_code: input.reasonCode,
    p_counted_base: input.countedBase,
    p_use_unit_label: input.useUnitLabel ?? undefined,
    p_use_unit_factor: input.useUnitFactor ?? undefined,
    p_use_qty: input.useQty ?? undefined,
    p_notes: input.notes ?? undefined,
    p_user_id: input.actorId ?? undefined,
    p_user_name: input.actorName ?? undefined,
  })
  if (error) throw new Error(`No se pudo registrar el ajuste: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as
    | { adjustment_id?: unknown; delta_base?: unknown; cost_eur?: unknown }
    | null
  return {
    adjustmentId: String(row?.adjustment_id ?? ''),
    deltaBase: Number(row?.delta_base ?? 0),
    costEur: Number(row?.cost_eur ?? 0),
  }
}

// Motivos de ajuste. reason_code es TEXTO LIBRE en el backend (register_adjustment
// solo exige que no esté vacío, sin CHECK ni enum) — añadir motivos aquí no
// necesita migración. Cubren las causas reales de un stock negativo/descuadrado
// (10/08, vigía de stock negativo): recuento, falta de recepción, merma,
// caducidad, error de escandallo, consumo de personal, traspaso no registrado.
export const ADJUST_REASONS: { code: string; label: string }[] = [
  { code: 'count_correction', label: 'Corrección de conteo' },
  { code: 'direct_receipt',   label: 'Recepción directa' },
  { code: 'waste',            label: 'Merma' },
  { code: 'expired',          label: 'Caducado' },
  { code: 'recipe_error',     label: 'Error de escandallo' },
  { code: 'staff_use',        label: 'Consumo de personal' },
  { code: 'transfer',         label: 'Traspaso no registrado' },
  { code: 'other',            label: 'Otro' },
]
