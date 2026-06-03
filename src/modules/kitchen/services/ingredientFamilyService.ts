// src/modules/kitchen/services/ingredientFamilyService.ts
//
// Familias de INGREDIENTE (recipe_family scope='ingredient', taxonomía AECOC) y
// el flujo de revisión/aprobación de las propuestas de clasificación que genera
// la IA (Edge Function map-products, modo recipe_item->recipe_family).
//
// Patrón "IA propone -> humano aprueba":
//   - La IA escribe mapping_proposal (source_kind='recipe_item',
//     target_kind='recipe_family') con status auto_confirmed | needs_review.
//   - NO toca recipe_item.family_id. Eso se escribe aquí, al APROBAR.
//
// Aprobar = dos escrituras (RLS protege por cuenta):
//   1) recipe_item.family_id = familia elegida.
//   2) mapping_proposal.status = 'human_confirmed' (+ chosen_target_id = familia).
// Si (2) fallara, (1) ya quedó bien escrito (lo que importa); reaprobar es
// idempotente. No necesita RPC: una RPC SECURITY DEFINER sería sobre-ingeniería
// para dos updates con RLS.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ── Familia de ingrediente (forma de dominio) ──
export interface IngredientFamily {
  id: string
  name: string
  position: number | null
}

// ── Propuesta de clasificación (una por ingrediente) ──
export interface FamilyProposal {
  proposalId: string
  itemId: string            // recipe_item (raw) clasificado
  itemName: string          // nombre del ingrediente
  proposedFamilyId: string | null
  proposedFamilyName: string | null
  confidence: number | null
  status: 'auto_confirmed' | 'needs_review' | 'no_candidate' | string
  rationale: string | null
}

// Lista las 15 familias de ingrediente de la cuenta (scope='ingredient').
export async function listIngredientFamilies(accountId: string): Promise<IngredientFamily[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_family')
    .select('id, name, position')
    .eq('account_id', accountId)
    .eq('scope', 'ingredient')
    .eq('is_active', true)
    .order('position', { ascending: true })

  if (error) throw new Error(`Error listando familias de ingrediente: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, position: r.position ?? null,
  }))
}

// Lista las propuestas de clasificación pendientes de aplicar (las que la IA
// generó y aún no se han confirmado por humano). Incluye nombre del ingrediente
// y de la familia propuesta para pintar la pantalla sin más consultas.
export async function listFamilyProposals(accountId: string): Promise<FamilyProposal[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('mapping_proposal')
    .select(`
      id, source_ref, source_text, chosen_target_id, confidence, status, rationale,
      family:chosen_target_id ( name )
    `)
    .eq('account_id', accountId)
    .eq('source_kind', 'recipe_item')
    .eq('target_kind', 'recipe_family')
    .in('status', ['auto_confirmed', 'needs_review', 'no_candidate'])
    .order('confidence', { ascending: true })

  if (error) throw new Error(`Error listando propuestas de familia: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    proposalId: r.id,
    itemId: r.source_ref,
    itemName: r.source_text,
    proposedFamilyId: r.chosen_target_id ?? null,
    proposedFamilyName: r.family?.name ?? null,
    confidence: r.confidence ?? null,
    status: r.status,
    rationale: r.rationale ?? null,
  }))
}

// ¿Cuántas propuestas pendientes hay? (para el banner). Devuelve totales por
// estado sin traer todas las filas.
export interface ProposalSummary {
  total: number
  auto: number
  review: number
  noCandidate: number
}

export async function getFamilyProposalSummary(accountId: string): Promise<ProposalSummary> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('mapping_proposal')
    .select('status')
    .eq('account_id', accountId)
    .eq('source_kind', 'recipe_item')
    .eq('target_kind', 'recipe_family')
    .in('status', ['auto_confirmed', 'needs_review', 'no_candidate'])

  if (error) throw new Error(`Error resumiendo propuestas: ${error.message}`)
  const rows = data ?? []
  return {
    total: rows.length,
    auto: rows.filter((r: any) => r.status === 'auto_confirmed').length,
    review: rows.filter((r: any) => r.status === 'needs_review').length,
    noCandidate: rows.filter((r: any) => r.status === 'no_candidate').length,
  }
}

// Aprueba UNA propuesta: escribe family_id en el ingrediente y marca la propuesta
// como human_confirmed. familyId puede venir corregido por el humano (distinto
// del propuesto). Si familyId es null, se interpreta como "sin familia" (deja el
// ingrediente sin clasificar) y la propuesta se marca rejected.
export async function approveFamilyProposal(
  proposalId: string,
  itemId: string,
  familyId: string | null,
): Promise<void> {
  requireSupabase()

  // 1) Escribir la familia (o limpiarla) en el ingrediente.
  const { error: itemErr } = await supabase!
    .from('recipe_item')
    .update({ family_id: familyId } as any)
    .eq('id', itemId)
  if (itemErr) throw new Error(`Error asignando familia al ingrediente: ${itemErr.message}`)

  // 2) Marcar la propuesta. family_id null => rechazada (sin familia); si no, confirmada.
  const { error: propErr } = await supabase!
    .from('mapping_proposal')
    .update({
      status: familyId ? 'human_confirmed' : 'rejected',
      chosen_target_id: familyId,
      method: 'human',
    } as any)
    .eq('id', proposalId)
  if (propErr) throw new Error(`Error confirmando la propuesta: ${propErr.message}`)
}

// Aprueba EN BLOQUE todas las propuestas auto_confirmed (las de alta confianza):
// escribe family_id en cada ingrediente y marca las propuestas human_confirmed.
// Devuelve cuántas aplicó. Itera (sin RPC) — son ~100, asumible en una pasada.
export async function approveAllAuto(accountId: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('mapping_proposal')
    .select('id, source_ref, chosen_target_id')
    .eq('account_id', accountId)
    .eq('source_kind', 'recipe_item')
    .eq('target_kind', 'recipe_family')
    .eq('status', 'auto_confirmed')

  if (error) throw new Error(`Error leyendo propuestas auto: ${error.message}`)
  const rows = (data ?? []).filter((r: any) => r.chosen_target_id)

  let applied = 0
  for (const r of rows as any[]) {
    try {
      await approveFamilyProposal(r.id, r.source_ref, r.chosen_target_id)
      applied++
    } catch (e) {
      console.error('approveAllAuto: fallo en', r.id, e)
    }
  }
  return applied
}
