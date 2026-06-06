// src/modules/kitchen/services/recipeItemAllergenService.ts
//
// Alérgenos de un ingrediente (tabla satélite recipe_item_allergen).
// Separado de RecipeItem (que no los lleva): la ficha los lee y edita aparte.
//
// Modelo: una fila por (recipe_item_id, allergen_code) con su estado
// (contains | may_contain | free) y un 'source' que traza el origen
// (manual | ai_enrich | template_global...). La edición a mano REEMPLAZA la
// lista del ingrediente (borra las que no están, inserta/actualiza las dadas).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { AllergenCode, AllergenState } from '../lib/allergens'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface ItemAllergen {
  code: AllergenCode
  state: AllergenState
  source: string | null
}

/** Lee los alérgenos de un ingrediente. */
export async function listItemAllergens(
  recipeItemId: string,
): Promise<ItemAllergen[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item_allergen')
    .select('allergen_code, state, source')
    .eq('recipe_item_id', recipeItemId)
  if (error) {
    throw new Error(`Error leyendo alérgenos: ${error.message}`)
  }
  return (data ?? []).map((r) => ({
    code: r.allergen_code as AllergenCode,
    state: (r.state as AllergenState) ?? 'contains',
    source: r.source ?? null,
  }))
}

/**
 * Guarda la lista FINAL de alérgenos de un ingrediente (edición a mano).
 * Reemplaza el estado: borra las filas que ya no están y upserta las dadas.
 * source='manual' para las editadas a mano (el cocinero asume la declaración).
 */
export async function saveItemAllergens(
  recipeItemId: string,
  allergens: { code: AllergenCode; state: AllergenState }[],
): Promise<void> {
  requireSupabase()

  const keepCodes = allergens.map((a) => a.code)

  // 1) Borrar las que ya no estén en la lista.
  if (keepCodes.length > 0) {
    const { error: delErr } = await supabase!
      .from('recipe_item_allergen')
      .delete()
      .eq('recipe_item_id', recipeItemId)
      .not('allergen_code', 'in', `(${keepCodes.join(',')})`)
    if (delErr) throw new Error(`Error actualizando alérgenos: ${delErr.message}`)
  } else {
    // Lista vacía -> borrar todas.
    const { error: delAllErr } = await supabase!
      .from('recipe_item_allergen')
      .delete()
      .eq('recipe_item_id', recipeItemId)
    if (delAllErr) throw new Error(`Error actualizando alérgenos: ${delAllErr.message}`)
  }

  // 2) Upsert de las actuales (source='manual': editadas/confirmadas a mano).
  if (allergens.length > 0) {
    const rows = allergens.map((a) => ({
      recipe_item_id: recipeItemId,
      allergen_code: a.code,
      state: a.state,
      source: 'manual',
    }))
    const { error: upErr } = await supabase!
      .from('recipe_item_allergen')
      .upsert(rows, { onConflict: 'recipe_item_id,allergen_code' })
    if (upErr) throw new Error(`Error guardando alérgenos: ${upErr.message}`)
  }
}
