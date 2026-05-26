// src/modules/kitchen/services/recipeItemService.ts
//
// Service CRUD de recipe_item (ingrediente / receta / herramienta / plato).
// Scope cuenta. Sigue el patrón canónico de brandsService.ts.
// Recálculo automático integrado tras create/update (contrastado con mercado).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  RecipeItem,
  RecipeItemInsert,
  RecipeItemUpdate,
  RecipeItemType,
  RowRecipeItem,
  RowRecipeItemInsert,
  RowRecipeItemUpdate,
} from '../../../types/kitchen'

export function rowToRecipeItem(row: RowRecipeItem): RecipeItem {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type as RecipeItemType,
    name: row.name,
    altName: row.alt_name,
    code: row.code,
    baseUnitId: row.base_unit_id,
    costStrategy: row.cost_strategy as RecipeItem['costStrategy'],
    costWindowDays: row.cost_window_days,
    fixedCost: row.fixed_cost,
    computedCost: row.computed_cost,
    costUpdatedAt: row.cost_updated_at,
    indirectCostPct: row.indirect_cost_pct,
    prepTimeMinutes: row.prep_time_minutes,
    cookTimeMinutes: row.cook_time_minutes,
    procedureText: row.procedure_text,
    platingNotes: row.plating_notes,
    kitchenPhotoUrl: row.kitchen_photo_url,
    yieldPortions: row.yield_portions,
    conservationType: row.conservation_type as RecipeItem['conservationType'],
    serviceTempC: row.service_temp_c,
    notes: row.notes,
    source: row.source as RecipeItem['source'],
    aiConfidence: row.ai_confidence,
    needsReview: row.needs_review,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
}

function recipeItemInsertToRow(input: RecipeItemInsert): RowRecipeItemInsert {
  return {
    account_id: input.accountId,
    type: input.type,
    name: input.name,
    base_unit_id: input.baseUnitId,
    alt_name: input.altName ?? null,
    code: input.code ?? null,
    cost_strategy: input.costStrategy ?? 'fixed',
    fixed_cost: input.fixedCost ?? null,
    indirect_cost_pct: input.indirectCostPct ?? null,
    prep_time_minutes: input.prepTimeMinutes ?? null,
    cook_time_minutes: input.cookTimeMinutes ?? null,
    procedure_text: input.procedureText ?? null,
    plating_notes: input.platingNotes ?? null,
    kitchen_photo_url: input.kitchenPhotoUrl ?? null,
    yield_portions: input.yieldPortions ?? null,
    conservation_type: input.conservationType ?? null,
    service_temp_c: input.serviceTempC ?? null,
    notes: input.notes ?? null,
    source: input.source ?? 'manual',
    ai_confidence: input.aiConfidence ?? null,
    needs_review: input.needsReview ?? false,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function recipeItemUpdateToRow(patch: RecipeItemUpdate): RowRecipeItemUpdate {
  const row: RowRecipeItemUpdate = {}
  if (patch.type !== undefined) row.type = patch.type
  if (patch.name !== undefined) row.name = patch.name
  if (patch.altName !== undefined) row.alt_name = patch.altName
  if (patch.code !== undefined) row.code = patch.code
  if (patch.baseUnitId !== undefined) row.base_unit_id = patch.baseUnitId
  if (patch.costStrategy !== undefined) row.cost_strategy = patch.costStrategy
  if (patch.costWindowDays !== undefined) row.cost_window_days = patch.costWindowDays
  if (patch.fixedCost !== undefined) row.fixed_cost = patch.fixedCost
  if (patch.indirectCostPct !== undefined) row.indirect_cost_pct = patch.indirectCostPct
  if (patch.prepTimeMinutes !== undefined) row.prep_time_minutes = patch.prepTimeMinutes
  if (patch.cookTimeMinutes !== undefined) row.cook_time_minutes = patch.cookTimeMinutes
  if (patch.procedureText !== undefined) row.procedure_text = patch.procedureText
  if (patch.platingNotes !== undefined) row.plating_notes = patch.platingNotes
  if (patch.kitchenPhotoUrl !== undefined) row.kitchen_photo_url = patch.kitchenPhotoUrl
  if (patch.yieldPortions !== undefined) row.yield_portions = patch.yieldPortions
  if (patch.conservationType !== undefined) row.conservation_type = patch.conservationType
  if (patch.serviceTempC !== undefined) row.service_temp_c = patch.serviceTempC
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.needsReview !== undefined) row.needs_review = patch.needsReview
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

export interface ListRecipeItemsOptions {
  accountId: string
  type?: RecipeItemType
  includeInactive?: boolean
  includeArchived?: boolean
  search?: string
  limit?: number
  offset?: number
}

export async function listRecipeItems(opts: ListRecipeItemsOptions): Promise<RecipeItem[]> {
  requireSupabase()
  let query = supabase!
    .from('recipe_item')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('name', { ascending: true })

  if (opts.type) {
    query = query.eq('type', opts.type)
  }
  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.search && opts.search.trim() !== '') {
    query = query.ilike('name', `%${opts.search.trim()}%`)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    query = query.range(from, from + opts.limit - 1)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando items de cocina: ${error.message}`)
  }
  return (data ?? []).map(rowToRecipeItem)
}

export async function getRecipeItemById(id: string): Promise<RecipeItem | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo item ${id}: ${error.message}`)
  }
  return data ? rowToRecipeItem(data) : null
}

export async function recomputeRecipeItem(id: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('kitchen_recompute_item', {
    p_item_id: id,
  })
  if (error) {
    throw new Error(`Error recalculando coste del item ${id}: ${error.message}`)
  }
  return (data as number) ?? 0
}

async function tryRecompute(id: string): Promise<boolean> {
  try {
    await recomputeRecipeItem(id)
    return true
  } catch (e) {
    console.error(`recipeItemService: recálculo automático falló para ${id}`, e)
    return false
  }
}

export async function createRecipeItem(input: RecipeItemInsert): Promise<RecipeItem> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .insert(recipeItemInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando item de cocina: ${error.message}`)
  }
  const created = rowToRecipeItem(data)
  await tryRecompute(created.id)
  return (await getRecipeItemById(created.id)) ?? created
}

export async function updateRecipeItem(
  id: string,
  patch: RecipeItemUpdate
): Promise<RecipeItem> {
  requireSupabase()
  const rowPatch = recipeItemUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getRecipeItemById(id)
    if (!current) throw new Error(`Item ${id} no encontrado.`)
    return current
  }

  const { data, error } = await supabase!
    .from('recipe_item')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando item ${id}: ${error.message}`)
  }
  const updated = rowToRecipeItem(data)
  await tryRecompute(updated.id)
  return (await getRecipeItemById(updated.id)) ?? updated
}

export async function archiveRecipeItem(id: string): Promise<RecipeItem> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando item ${id}: ${error.message}`)
  }
  return rowToRecipeItem(data)
}

export async function restoreRecipeItem(id: string): Promise<RecipeItem> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .update({ is_active: true, archived_at: null })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando item ${id}: ${error.message}`)
  }
  return rowToRecipeItem(data)
}
