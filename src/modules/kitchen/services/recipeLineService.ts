// src/modules/kitchen/services/recipeLineService.ts
//
// Service de recipe_line: las líneas de una receta/plato. Corazón del escandallo.
// Tras añadir/editar/quitar una línea, recalcula el coste del PLATO PADRE
// (parent_item_id) con patrón fail-safe (si falla loguea, no revierte).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { recomputeRecipeItem } from './recipeItemService'
import type {
  RecipeLine,
  RecipeLineInsert,
  RecipeLineUpdate,
  RowRecipeLine,
  RowRecipeLineInsert,
  RowRecipeLineUpdate,
} from '../../../types/kitchen'

export interface RecipeLineBreakdown {
  lineId: string
  childItemId: string
  childName: string
  quantity: number
  unitAbbr: string
  lineCost: number
  needsReview: boolean
}

export function rowToRecipeLine(row: RowRecipeLine): RecipeLine {
  return {
    id: row.id,
    accountId: row.account_id,
    parentItemId: row.parent_item_id,
    childItemId: row.child_item_id,
    quantityNet: row.quantity_net,
    quantityGross: row.quantity_gross,
    unitId: row.unit_id,
    cutTypeId: row.cut_type_id,
    comment: row.comment,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function lineInsertToRow(input: RecipeLineInsert): RowRecipeLineInsert {
  return {
    account_id: input.accountId,
    parent_item_id: input.parentItemId,
    child_item_id: input.childItemId,
    quantity_net: input.quantityNet,
    unit_id: input.unitId,
    quantity_gross: input.quantityGross ?? null,
    cut_type_id: input.cutTypeId ?? null,
    comment: input.comment ?? null,
    position: input.position ?? 0,
  }
}

function lineUpdateToRow(patch: RecipeLineUpdate): RowRecipeLineUpdate {
  const row: RowRecipeLineUpdate = {}
  if (patch.quantityNet !== undefined) row.quantity_net = patch.quantityNet
  if (patch.quantityGross !== undefined) row.quantity_gross = patch.quantityGross
  if (patch.unitId !== undefined) row.unit_id = patch.unitId
  if (patch.cutTypeId !== undefined) row.cut_type_id = patch.cutTypeId
  if (patch.comment !== undefined) row.comment = patch.comment
  if (patch.position !== undefined) row.position = patch.position
  return row
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

async function tryRecomputeParent(parentItemId: string): Promise<void> {
  try {
    await recomputeRecipeItem(parentItemId)
  } catch (e) {
    console.error(
      `recipeLineService: recálculo del plato ${parentItemId} falló tras tocar una línea`,
      e
    )
  }
}

export async function listLinesByParent(parentItemId: string): Promise<RecipeLine[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_line')
    .select('*')
    .eq('parent_item_id', parentItemId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Error listando líneas del plato ${parentItemId}: ${error.message}`)
  }
  return (data ?? []).map(rowToRecipeLine)
}

/**
 * Desglose de coste por línea de un plato (RPC kitchen_recipe_breakdown).
 * Una fila por línea con su coste calculado server-side (misma lógica de
 * conversión que el total → las partes suman el total). El % lo calcula
 * la pantalla. Devuelve [] si no hay líneas o no es recipe/dish.
 */
export async function getRecipeBreakdown(parentItemId: string): Promise<RecipeLineBreakdown[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('kitchen_recipe_breakdown', {
    p_item_id: parentItemId,
  })
  if (error) {
    throw new Error(`Error obteniendo desglose del plato ${parentItemId}: ${error.message}`)
  }
  return (data ?? []).map((row) => ({
    lineId: row.line_id,
    childItemId: row.child_item_id,
    childName: row.child_name,
    quantity: row.quantity,
    unitAbbr: row.unit_abbr,
    lineCost: row.line_cost,
    needsReview: row.needs_review,
  }))
}

export async function addLine(input: RecipeLineInsert): Promise<RecipeLine> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_line')
    .insert(lineInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error añadiendo línea: ${error.message}`)
  }
  const line = rowToRecipeLine(data)
  await tryRecomputeParent(line.parentItemId)
  return line
}

export async function updateLine(id: string, patch: RecipeLineUpdate): Promise<RecipeLine> {
  requireSupabase()
  const rowPatch = lineUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const { data, error } = await supabase!
      .from('recipe_line').select('*').eq('id', id).single()
    if (error) throw new Error(`Error obteniendo línea ${id}: ${error.message}`)
    return rowToRecipeLine(data)
  }

  const { data, error } = await supabase!
    .from('recipe_line')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando línea ${id}: ${error.message}`)
  }
  const line = rowToRecipeLine(data)
  await tryRecomputeParent(line.parentItemId)
  return line
}

export async function deleteLine(id: string): Promise<string> {
  requireSupabase()
  const { data: existing, error: readErr } = await supabase!
    .from('recipe_line')
    .select('parent_item_id')
    .eq('id', id)
    .single()
  if (readErr) {
    throw new Error(`Error localizando línea ${id} antes de borrar: ${readErr.message}`)
  }
  const parentItemId = existing.parent_item_id as string

  const { error } = await supabase!
    .from('recipe_line')
    .delete()
    .eq('id', id)
  if (error) {
    throw new Error(`Error eliminando línea ${id}: ${error.message}`)
  }
  await tryRecomputeParent(parentItemId)
  return parentItemId
}
