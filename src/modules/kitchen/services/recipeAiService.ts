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

export interface EnrichFamily {
  id: string
  name: string
}

export interface EnrichProposal {
  // Familia casada con una EXISTENTE de la cuenta (o null si la IA no acertó una
  // con seguridad). De ella se deriva el IVA con el motor fiscal al aplicar.
  family: EnrichFamily | null
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
    family?: { id: string; name: string } | null
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
      family: row.proposal.family ?? null,
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
  // familyId: familia ACEPTADA (de las existentes). Si se aplica, el IVA se deriva
  // de ella con el motor fiscal (propose_vat_category). Nunca lo decide la IA.
  familyId?: string | null
  allergens?: EnrichAllergen[]
  defaultWastePct?: number | null
  conservationType?: string | null
  shelfLifeDays?: number | null
  menuTags?: string[]
  nutrition?: Record<string, number> | null
}

export interface ApplyEnrichmentResult {
  item: RecipeItem | null
  /** El IVA quedó derivado de la familia (vat_category_id no null). */
  vatDerived: boolean
  /** La ficha quedó terminada (se retiró needs_review). */
  finished: boolean
}

/**
 * Aplica al recipe_item las decisiones que el cocinero aceptó. Marca el
 * ingrediente needs_review=false implícitamente NO: lo dejamos como esté; la
 * revisión la cierra el cocinero desde la ficha. Aquí solo escribimos datos.
 */
export async function applyEnrichment(
  recipeItemId: string,
  decisions: EnrichDecisions,
): Promise<ApplyEnrichmentResult> {
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

  // 2) Familia (aceptada por el humano) + IVA derivado por el motor fiscal.
  //    Va PRIMERO (es lo esencial para "terminar" el ingrediente). El IVA NO lo
  //    decide la IA: se deriva de la familia con propose_vat_category
  //    (family_vat_default). Anti-invención: si la familia no mapea a una
  //    categoría, el IVA queda sin asignar y el ingrediente NO se da por terminado.
  if (decisions.familyId !== undefined) {
    const { error: famErr } = await supabase!
      .from('recipe_item')
      .update({ family_id: decisions.familyId })
      .eq('id', recipeItemId)
    if (famErr) throw new Error(`Error asignando la familia: ${famErr.message}`)

    if (decisions.familyId) {
      const { error: vatErr } = await supabase!.rpc('propose_vat_category', {
        p_recipe_item_id: recipeItemId,
      })
      if (vatErr) throw new Error(`Error derivando el IVA de la familia: ${vatErr.message}`)
    }
  }

  // 3) Alérgenos (satélite recipe_item_allergen). SECUNDARIO: si falla, se registra
  //    pero NO corta el flujo — un fallo aquí no debe impedir terminar el ingrediente
  //    (que depende de familia + IVA, no de los alérgenos). Se borran primero los de
  //    origen IA y se reinsertan, para evitar conflictos (409) al reprocesar.
  if (decisions.allergens && decisions.allergens.length > 0) {
    try {
      const codes = decisions.allergens.map((a) => a.code)
      // Limpia las filas previas de origen IA para estos códigos (idempotente).
      await supabase!
        .from('recipe_item_allergen')
        .delete()
        .eq('recipe_item_id', recipeItemId)
        .in('allergen_code', codes)
      const rows = decisions.allergens.map((a) => ({
        recipe_item_id: recipeItemId,
        allergen_code: a.code,
        state: a.state,
        source: 'ai_enrich',
      }))
      const { error } = await supabase!
        .from('recipe_item_allergen')
        .insert(rows)
      if (error) {
        console.warn('[applyEnrichment] alérgenos no guardados (no bloquea):', error.message)
      }
    } catch (e) {
      console.warn('[applyEnrichment] alérgenos: excepción no bloqueante:', String(e))
    }
  }

  // 4) ¿Ficha terminada? Releer el estado y RETIRAR "sin terminar" SOLO si:
  //    familia asignada + IVA derivado + sin incidencia abierta (review_notes null).
  //    Si falta algún dato fiable, queda needs_review (no se fuerza "terminado").
  const { data: cur, error: curErr } = await supabase!
    .from('recipe_item')
    .select('family_id, vat_category_id, needs_review, review_notes')
    .eq('id', recipeItemId)
    .maybeSingle()
  if (curErr) throw new Error(`Error releyendo el ingrediente: ${curErr.message}`)

  const hasFamily = !!cur?.family_id
  const vatDerived = !!cur?.vat_category_id
  const hasIncident = cur?.review_notes != null
  const wasFlagged = cur?.needs_review === true

  let finished = false
  if (hasFamily && vatDerived && !hasIncident) {
    if (wasFlagged) {
      updated = await updateRecipeItem(recipeItemId, { needsReview: false })
    }
    finished = true
  }

  return { item: updated, vatDerived, finished }
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
