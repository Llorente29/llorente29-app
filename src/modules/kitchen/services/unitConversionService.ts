// src/modules/kitchen/services/unitConversionService.ts
//
// Conversiones de unidad por ingrediente (recipe_item_unit_conversion): la
// equivalencia AMIGABLE "1 [from_unit] = qty_in_base [unidad base del ingrediente]"
// (p. ej. "1 ud = 85 g", "1 loncha = 25 g", "1 papel = 50 cm").
//
// El motor de coste/stock (_qty_in_base, explode_recipe_to_raws,
// kitchen_recompute_item, avt_*) YA LEE esta tabla cuando la unidad de una línea
// es de otra dimensión que la base del ingrediente. Este servicio SOLO gestiona
// las filas; no toca SQL. Tras guardar/quitar, recostea el ingrediente y los
// platos que lo usan (recomputeItemAndAncestors) → una línea bloqueada por
// "falta convertir la unidad" se cura sola.
//
// Dirección FIJA por construcción (evita el error de montarla al revés): la base
// es la del ingrediente, y qty_in_base = cuántas unidades BASE hay en 1 from_unit.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { recomputeItemAndAncestors } from './costCascadeService'
import type { Database } from '../../../types/database'

type ConvInsert = Database['public']['Tables']['recipe_item_unit_conversion']['Insert']
type ConvUpdate = Database['public']['Tables']['recipe_item_unit_conversion']['Update']

export interface UnitConversion {
  id: string
  itemId: string
  fromUnitId: string
  qtyInBase: number
  needsReview: boolean
  source: string | null
}

interface ConvRow {
  id: string
  item_id: string
  from_unit_id: string
  qty_in_base: number
  needs_review: boolean | null
  source: string | null
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

function rowToConversion(r: ConvRow): UnitConversion {
  return {
    id: r.id,
    itemId: r.item_id,
    fromUnitId: r.from_unit_id,
    qtyInBase: r.qty_in_base,
    needsReview: r.needs_review ?? false,
    source: r.source ?? null,
  }
}

async function tryRecompute(itemId: string): Promise<void> {
  try {
    await recomputeItemAndAncestors(itemId)
  } catch (e) {
    console.error(`unitConversionService: recálculo tras tocar conversión de ${itemId} falló`, e)
  }
}

/** Conversiones activas de un ingrediente. */
export async function listConversions(itemId: string): Promise<UnitConversion[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item_unit_conversion')
    .select('id, item_id, from_unit_id, qty_in_base, needs_review, source')
    .eq('item_id', itemId)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Error listando conversiones: ${error.message}`)
  return ((data ?? []) as unknown as ConvRow[]).map(rowToConversion)
}

/**
 * Crea o actualiza la conversión "1 from_unit = qtyInBase base" de un ingrediente.
 * Busca una activa existente (item × from_unit) y la actualiza; si no, inserta.
 * Manual y confirmada (needs_review=false). Recostea ingrediente + ancestros.
 */
export async function upsertConversion(
  accountId: string,
  itemId: string,
  fromUnitId: string,
  qtyInBase: number,
): Promise<UnitConversion> {
  requireSupabase()
  if (!(qtyInBase > 0)) {
    throw new Error('La equivalencia debe ser un número mayor que 0.')
  }

  const { data: existing, error: findErr } = await supabase!
    .from('recipe_item_unit_conversion')
    .select('id')
    .eq('item_id', itemId)
    .eq('from_unit_id', fromUnitId)
    .eq('is_active', true)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle()
  if (findErr) throw new Error(`Error buscando conversión existente: ${findErr.message}`)

  let saved: ConvRow
  if (existing) {
    const patch: ConvUpdate = {
      qty_in_base: qtyInBase,
      needs_review: false,
      source: 'manual',
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase!
      .from('recipe_item_unit_conversion')
      .update(patch)
      .eq('id', (existing as { id: string }).id)
      .select('id, item_id, from_unit_id, qty_in_base, needs_review, source')
      .single()
    if (error) throw new Error(`Error actualizando conversión: ${error.message}`)
    saved = data as unknown as ConvRow
  } else {
    const insert: ConvInsert = {
      account_id: accountId,
      item_id: itemId,
      from_unit_id: fromUnitId,
      qty_in_base: qtyInBase,
      source: 'manual',
      needs_review: false,
      is_active: true,
    }
    const { data, error } = await supabase!
      .from('recipe_item_unit_conversion')
      .insert(insert)
      .select('id, item_id, from_unit_id, qty_in_base, needs_review, source')
      .single()
    if (error) throw new Error(`Error creando conversión: ${error.message}`)
    saved = data as unknown as ConvRow
  }

  await tryRecompute(itemId)
  return rowToConversion(saved)
}

/** Quita (soft) una conversión y recostea el ingrediente + ancestros. */
export async function removeConversion(id: string, itemId: string): Promise<void> {
  requireSupabase()
  const patch: ConvUpdate = {
    is_active: false,
    archived_at: new Date().toISOString(),
  }
  const { error } = await supabase!
    .from('recipe_item_unit_conversion')
    .update(patch)
    .eq('id', id)
  if (error) throw new Error(`Error quitando conversión: ${error.message}`)
  await tryRecompute(itemId)
}
