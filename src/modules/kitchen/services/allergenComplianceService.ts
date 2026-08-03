// src/modules/kitchen/services/allergenComplianceService.ts
//
// Wrappers TS de las 4 RPCs de lectura de la matriz de cumplimiento de
// alérgenos (Capa 2, Fase 3 — supabase/migrations/20260805T1400_alergenos_
// matriz_cumplimiento_rpcs.sql). Consumidas por
// src/modules/appcc/pages/AllergensCompliancePage.tsx.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { AllergenCode, AllergenState } from '../lib/allergens'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export type AllergenSource = 'inherited' | 'manual' | 'automatic' | 'ai_enrich'

export interface AllergenCell {
  state: AllergenState
  source: AllergenSource
}

export interface ComplianceMatrixRow {
  recipeItemId: string
  recipeName: string
  recipeType: string
  brands: string[]
  // Código AUSENTE del mapa = "sin declarar" (5º estado UI-only) — nunca
  // inferir 'free' de una ausencia (misma regla que EtiquetadoTab).
  allergens: Partial<Record<AllergenCode, AllergenCell>>
}

export async function getAllergenComplianceMatrix(
  accountId: string,
): Promise<ComplianceMatrixRow[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('allergen_compliance_matrix', {
    p_account_id: accountId,
  })
  if (error) throw new Error(`Error leyendo la matriz de alérgenos: ${error.message}`)
  return (data ?? []).map((row) => ({
    recipeItemId: row.recipe_item_id,
    recipeName: row.recipe_name,
    recipeType: row.recipe_type,
    brands: row.brands ?? [],
    allergens: (row.allergens ?? {}) as Partial<Record<AllergenCode, AllergenCell>>,
  }))
}

export interface BlockingIngredient {
  ingredientId: string
  ingredientName: string
  dishCount: number
}

export async function getAllergenBlockingIngredients(
  accountId: string,
): Promise<BlockingIngredient[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('allergen_blocking_ingredients', {
    p_account_id: accountId,
  })
  if (error) throw new Error(`Error leyendo ingredientes bloqueantes: ${error.message}`)
  return (data ?? []).map((row) => ({
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    dishCount: row.dish_count,
  }))
}

export interface DataHealthRow {
  scope: 'ingrediente' | 'plato'
  source: AllergenSource
  rowCount: number
}

export async function getAllergenDataHealth(accountId: string): Promise<DataHealthRow[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('allergen_data_health', {
    p_account_id: accountId,
  })
  if (error) throw new Error(`Error leyendo salud del dato de alérgenos: ${error.message}`)
  return (data ?? []).map((row) => ({
    scope: row.scope as 'ingrediente' | 'plato',
    source: row.source as AllergenSource,
    rowCount: row.row_count,
  }))
}

export interface AllergenDiscrepancy {
  recipeItemId: string
  recipeName: string
  allergenCode: AllergenCode
  declaredState: AllergenState
  wouldInherit: AllergenState
}

export async function getAllergenDiscrepancies(
  accountId: string,
): Promise<AllergenDiscrepancy[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('allergen_discrepancies', {
    p_account_id: accountId,
  })
  if (error) throw new Error(`Error leyendo discrepancias de alérgenos: ${error.message}`)
  return (data ?? []).map((row) => ({
    recipeItemId: row.recipe_item_id,
    recipeName: row.recipe_name,
    allergenCode: row.allergen_code as AllergenCode,
    declaredState: row.declared_state as AllergenState,
    wouldInherit: row.would_inherit as AllergenState,
  }))
}
