// src/modules/kitchen/services/kitchenUnitService.ts
//
// Service de kitchen_unit. Scope cuenta + semillas globales.
// listUnits NO filtra por account_id: la RLS ya devuelve seed (account_id
// NULL) + las de la cuenta. Filtrar en código ocultaría las seed globales.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  KitchenUnit,
  KitchenUnitInsert,
  KitchenUnitUpdate,
  UnitDimension,
  RowKitchenUnit,
  RowKitchenUnitInsert,
  RowKitchenUnitUpdate,
} from '../../../types/kitchen'

export function rowToKitchenUnit(row: RowKitchenUnit): KitchenUnit {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    abbreviation: row.abbreviation,
    dimension: row.dimension as UnitDimension,
    factorToBase: row.factor_to_base,
    isBase: row.is_base,
    isSeed: row.is_seed,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function unitInsertToRow(input: KitchenUnitInsert): RowKitchenUnitInsert {
  return {
    account_id: input.accountId,
    name: input.name,
    abbreviation: input.abbreviation,
    dimension: input.dimension,
    factor_to_base: input.factorToBase,
    is_base: input.isBase ?? false,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function unitUpdateToRow(patch: KitchenUnitUpdate): RowKitchenUnitUpdate {
  const row: RowKitchenUnitUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.abbreviation !== undefined) row.abbreviation = patch.abbreviation
  if (patch.factorToBase !== undefined) row.factor_to_base = patch.factorToBase
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface ListUnitsOptions {
  dimension?: UnitDimension
  includeInactive?: boolean
  includeArchived?: boolean
}

export async function listUnits(opts: ListUnitsOptions = {}): Promise<KitchenUnit[]> {
  requireSupabase()
  let query = supabase!
    .from('kitchen_unit')
    .select('*')
    .order('dimension', { ascending: true })
    .order('factor_to_base', { ascending: true })

  if (opts.dimension) query = query.eq('dimension', opts.dimension)
  if (!opts.includeArchived) query = query.is('archived_at', null)
  if (opts.includeInactive === false) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw new Error(`Error listando unidades: ${error.message}`)
  return (data ?? []).map(rowToKitchenUnit)
}

export async function getUnitById(id: string): Promise<KitchenUnit | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_unit').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Error obteniendo unidad ${id}: ${error.message}`)
  return data ? rowToKitchenUnit(data) : null
}

export async function createUnit(input: KitchenUnitInsert): Promise<KitchenUnit> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_unit').insert(unitInsertToRow(input)).select('*').single()
  if (error) throw new Error(`Error creando unidad: ${error.message}`)
  return rowToKitchenUnit(data)
}

export async function updateUnit(id: string, patch: KitchenUnitUpdate): Promise<KitchenUnit> {
  requireSupabase()
  const rowPatch = unitUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getUnitById(id)
    if (!current) throw new Error(`Unidad ${id} no encontrada.`)
    return current
  }
  const { data, error } = await supabase!
    .from('kitchen_unit').update(rowPatch).eq('id', id).select('*').single()
  if (error) throw new Error(`Error actualizando unidad ${id}: ${error.message}`)
  return rowToKitchenUnit(data)
}

export async function archiveUnit(id: string): Promise<KitchenUnit> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_unit')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id).select('*').single()
  if (error) throw new Error(`Error archivando unidad ${id}: ${error.message}`)
  return rowToKitchenUnit(data)
}

export async function restoreUnit(id: string): Promise<KitchenUnit> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('kitchen_unit')
    .update({ is_active: true, archived_at: null })
    .eq('id', id).select('*').single()
  if (error) throw new Error(`Error restaurando unidad ${id}: ${error.message}`)
  return rowToKitchenUnit(data)
}
