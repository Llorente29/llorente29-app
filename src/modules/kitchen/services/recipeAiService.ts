// src/modules/kitchen/services/recipeAiService.ts
//
// Copiloto IA de ficha (front). Lanza la Edge Function enrich-ingredient y
// aplica al recipe_item SOLO lo que el cocinero acepta (campo a campo).
// "IA propone, humano decide": enrichIngredient() devuelve la propuesta;
// applyEnrichment() escribe únicamente las decisiones confirmadas.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { updateRecipeItem } from './recipeItemService'
import type { Database, Json } from '../../../types/database'
import type { RecipeItem } from '../../../types/kitchen'
import type { AllergenCode, AllergenState } from '../lib/allergens'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export interface EnrichAllergen {
  code: AllergenCode
  state: AllergenState
}

export interface EnrichProposal {
  allergens: EnrichAllergen[]
  defaultWastePct: number | null
  conservationType: string | null
  shelfLifeDays: number | null
  menuTags: string[]
  nutrition: Record<string, number> | null
  confidence: number | null
}

export interface EnrichResult {
  sessionId: string | null
  proposal: EnrichProposal
  aiModel: string | null
  aiLatencyMs: number | null
}

interface EnrichResponseRow {
  session_id: string | null
  proposal: {
    allergens: { code: string; state: string }[]
    default_waste_pct: number | null
    conservation_type: string | null
    shelf_life_days: number | null
    menu_tags: string[]
    nutrition: Record<string, number> | null
    confidence: number | null
  }
  ai_model: string | null
  ai_latency_ms: number | null
  warning?: string
}

/**
 * Pide a la IA una propuesta de datos (alérgenos + merma + conservación) para
 * un ingrediente existente. No aplica nada: solo propone.
 */
export async function enrichIngredient(
  recipeItemId: string,
  accountId: string,
): Promise<EnrichResult> {
  requireSupabase()
  const { data, error } = await supabase!.functions.invoke('enrich-ingredient', {
    body: { recipe_item_id: recipeItemId, account_id: accountId },
  })
  if (error) {
    throw new Error(`Error al completar con IA: ${error.message}`)
  }
  const row = data as EnrichResponseRow
  if (!row || !row.proposal) {
    throw new Error('La IA no devolvió una propuesta válida.')
  }
  return {
    sessionId: row.session_id,
    proposal: {
      allergens: (row.proposal.allergens ?? []).map((a) => ({
        code: a.code as AllergenCode,
        state: a.state as AllergenState,
      })),
      defaultWastePct: row.proposal.default_waste_pct,
      conservationType: row.proposal.conservation_type,
      shelfLifeDays: row.proposal.shelf_life_days,
      menuTags: row.proposal.menu_tags ?? [],
      nutrition: row.proposal.nutrition ?? null,
      confidence: row.proposal.confidence,
    },
    aiModel: row.ai_model,
    aiLatencyMs: row.ai_latency_ms,
  }
}

export interface EnrichDecisions {
  // Solo los campos presentes se aplican. allergens: lista FINAL aceptada.
  allergens?: EnrichAllergen[]
  defaultWastePct?: number | null
  conservationType?: string | null
  shelfLifeDays?: number | null
  menuTags?: string[]
  nutrition?: Record<string, number> | null
}

/**
 * Aplica al recipe_item las decisiones que el cocinero aceptó. Marca el
 * ingrediente needs_review=false implícitamente NO: lo dejamos como esté; la
 * revisión la cierra el cocinero desde la ficha. Aquí solo escribimos datos.
 */
export async function applyEnrichment(
  recipeItemId: string,
  decisions: EnrichDecisions,
): Promise<RecipeItem | null> {
  requireSupabase()

  // 1) Campos directos del recipe_item (merma, conservación, vida útil).
  const patch: Record<string, unknown> = {}
  if (decisions.defaultWastePct !== undefined) {
    patch.defaultWastePct = decisions.defaultWastePct
  }
  if (decisions.conservationType !== undefined) {
    patch.conservationType =
      decisions.conservationType as RecipeItem['conservationType']
  }
  if (decisions.shelfLifeDays !== undefined) {
    patch.shelfLifeDays = decisions.shelfLifeDays
  }
  let updated: RecipeItem | null = null
  if (Object.keys(patch).length > 0) {
    updated = await updateRecipeItem(recipeItemId, patch)
  }

  // nutrition y menu_tags se escriben directo (updateRecipeItem no los mapea).
  // Tipado con el Update del esquema para que Supabase lo acepte.
  const directPatch: Database['public']['Tables']['recipe_item']['Update'] = {}
  if (decisions.nutrition !== undefined && decisions.nutrition !== null) {
    directPatch.nutrition = decisions.nutrition as Json
  }
  if (decisions.menuTags !== undefined) {
    directPatch.menu_tags = decisions.menuTags
  }
  if (Object.keys(directPatch).length > 0) {
    const { error } = await supabase!
      .from('recipe_item')
      .update(directPatch)
      .eq('id', recipeItemId)
    if (error) {
      throw new Error(`Error guardando nutrición/etiquetas: ${error.message}`)
    }
  }

  // 2) Alérgenos (satélite recipe_item_allergen). Upsert por (item, code).
  //    source='ai_enrich' para trazar el origen IA (texto libre, sin CHECK).
  if (decisions.allergens && decisions.allergens.length > 0) {
    const rows = decisions.allergens.map((a) => ({
      recipe_item_id: recipeItemId,
      allergen_code: a.code,
      state: a.state,
      source: 'ai_enrich',
    }))
    const { error } = await supabase!
      .from('recipe_item_allergen')
      .upsert(rows, { onConflict: 'recipe_item_id,allergen_code' })
    if (error) {
      throw new Error(`Error guardando alérgenos: ${error.message}`)
    }
  }

  return updated
}

/**
 * Lee los "extras" jsonb/array de un recipe_item que el mapper de RecipeItem no
 * lleva (nutrición + etiquetas de menú): la ficha los carga aparte para
 * mostrarlos. Devuelve {} y [] si no hay nada guardado.
 */
export async function getIngredientExtras(
  recipeItemId: string,
): Promise<{ nutrition: Record<string, number>; menuTags: string[] }> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_item')
    .select('nutrition, menu_tags')
    .eq('id', recipeItemId)
    .maybeSingle()
  if (error) {
    throw new Error(`Error leyendo extras del ingrediente: ${error.message}`)
  }
  const n = data?.nutrition
  const nutrition =
    n && typeof n === 'object' && !Array.isArray(n)
      ? (n as Record<string, number>)
      : {}
  const menuTags = Array.isArray(data?.menu_tags)
    ? (data!.menu_tags as string[])
    : []
  return { nutrition, menuTags }
}
