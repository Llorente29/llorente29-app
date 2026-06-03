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
  parentFamilyId: string | null
  accountingCategory: string | null
}

// Familia con sus subfamilias (para el árbol del gestor) y conteo de ingredientes.
export interface FamilyNode extends IngredientFamily {
  itemCount: number          // ingredientes asignados directamente a esta familia
  children: FamilyNode[]     // subfamilias (nivel 2)
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
    .select('id, name, position, parent_family_id, accounting_category')
    .eq('account_id', accountId)
    .eq('scope', 'ingredient')
    .eq('is_active', true)
    .order('position', { ascending: true })

  if (error) throw new Error(`Error listando familias de ingrediente: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    position: r.position ?? null,
    parentFamilyId: r.parent_family_id ?? null,
    accountingCategory: r.accounting_category ?? null,
  }))
}

// Lista las propuestas de clasificación pendientes de aplicar (las que la IA
// generó y aún no se han confirmado por humano). Incluye nombre del ingrediente
// y de la familia propuesta para pintar la pantalla sin más consultas.
export async function listFamilyProposals(accountId: string): Promise<FamilyProposal[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('mapping_proposal')
    .select('id, source_ref, source_text, chosen_target_id, confidence, status, rationale')
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
    proposedFamilyName: null,  // se resuelve en el cliente con el mapa de familias
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


// ─────────────────────────────────────────────────────────────────────────────
// GESTIÓN DE FAMILIAS (G2): crear / editar / archivar / reordenar.
// Familias de INGREDIENTE (scope='ingredient'). 2 niveles: raíz (parent NULL) e
// hija (parent = id de una raíz). recipe_family NO tiene updated_at (no incluir).
// ─────────────────────────────────────────────────────────────────────────────

// Árbol de familias (raíces con sus hijas) + conteo de ingredientes por familia.
// Para el gestor: "Carnes y aves (23)" con sus subfamilias debajo.
export async function listFamilyTree(accountId: string): Promise<FamilyNode[]> {
  requireSupabase()
  const flat = await listIngredientFamilies(accountId)

  // Conteo de ingredientes por family_id (solo raws activos de la cuenta).
  const { data: rows, error } = await supabase!
    .from('recipe_item')
    .select('family_id')
    .eq('account_id', accountId)
    .eq('type', 'raw')
    .eq('is_active', true)
    .not('family_id', 'is', null)
  if (error) throw new Error(`Error contando ingredientes por familia: ${error.message}`)
  const count = new Map<string, number>()
  for (const r of (rows ?? []) as any[]) {
    const fid = r.family_id as string
    count.set(fid, (count.get(fid) ?? 0) + 1)
  }

  const node = (f: IngredientFamily): FamilyNode => ({
    ...f, itemCount: count.get(f.id) ?? 0, children: [],
  })
  const byId = new Map<string, FamilyNode>()
  flat.forEach(f => byId.set(f.id, node(f)))

  const roots: FamilyNode[] = []
  for (const f of flat) {
    const n = byId.get(f.id)!
    if (f.parentFamilyId && byId.has(f.parentFamilyId)) {
      byId.get(f.parentFamilyId)!.children.push(n)
    } else {
      roots.push(n)
    }
  }
  // Ordenar por position en cada nivel.
  const byPos = (a: FamilyNode, b: FamilyNode) => (a.position ?? 0) - (b.position ?? 0)
  roots.sort(byPos)
  roots.forEach(r => r.children.sort(byPos))
  return roots
}

export interface CreateFamilyInput {
  accountId: string
  name: string
  parentFamilyId?: string | null
  accountingCategory?: string | null
}

// Crear familia (raíz si parentFamilyId es null) o subfamilia. position = siguiente.
export async function createIngredientFamily(input: CreateFamilyInput): Promise<IngredientFamily> {
  requireSupabase()
  const name = input.name.trim()
  if (name === '') throw new Error('El nombre de la familia no puede estar vacío.')

  // Siguiente position dentro del scope ingredient de la cuenta.
  const { data: maxRow } = await supabase!
    .from('recipe_family')
    .select('position')
    .eq('account_id', input.accountId)
    .eq('scope', 'ingredient')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = ((maxRow as any)?.position ?? 0) + 1

  const { data, error } = await supabase!
    .from('recipe_family')
    .insert({
      account_id: input.accountId,
      name,
      scope: 'ingredient',
      parent_family_id: input.parentFamilyId ?? null,
      accounting_category: input.accountingCategory ?? null,
      position: nextPos,
      is_active: true,
    } as any)
    .select('id, name, position, parent_family_id, accounting_category')
    .single()
  if (error) throw new Error(`Error creando familia: ${error.message}`)
  return {
    id: (data as any).id,
    name: (data as any).name,
    position: (data as any).position ?? null,
    parentFamilyId: (data as any).parent_family_id ?? null,
    accountingCategory: (data as any).accounting_category ?? null,
  }
}

export interface UpdateFamilyInput {
  name?: string
  parentFamilyId?: string | null
  accountingCategory?: string | null
  position?: number
}

// Editar familia (renombrar, mover de madre, categoría contable, reordenar).
export async function updateIngredientFamily(familyId: string, patch: UpdateFamilyInput): Promise<void> {
  requireSupabase()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (n === '') throw new Error('El nombre de la familia no puede estar vacío.')
    row.name = n
  }
  if (patch.parentFamilyId !== undefined) {
    if (patch.parentFamilyId === familyId) throw new Error('Una familia no puede ser su propia madre.')
    row.parent_family_id = patch.parentFamilyId
  }
  if (patch.accountingCategory !== undefined) row.accounting_category = patch.accountingCategory
  if (patch.position !== undefined) row.position = patch.position
  if (Object.keys(row).length === 0) return

  const { error } = await supabase!
    .from('recipe_family')
    .update(row as any)
    .eq('id', familyId)
  if (error) throw new Error(`Error actualizando familia: ${error.message}`)
}

// Archivar familia (is_active=false; no borra). Opcionalmente, reasigna los
// ingredientes de esta familia a otra (reassignToFamilyId) o los deja sin
// clasificar (null). Si la familia tiene subfamilias, también se archivan.
export async function archiveIngredientFamily(
  accountId: string,
  familyId: string,
  reassignToFamilyId: string | null = null,
): Promise<void> {
  requireSupabase()

  // 1) Reasignar (o limpiar) los ingredientes que apuntaban a esta familia.
  const { error: reErr } = await supabase!
    .from('recipe_item')
    .update({ family_id: reassignToFamilyId } as any)
    .eq('account_id', accountId)
    .eq('family_id', familyId)
  if (reErr) throw new Error(`Error reasignando ingredientes: ${reErr.message}`)

  // 2) Archivar la familia y sus subfamilias (parent = familyId).
  const { error: famErr } = await supabase!
    .from('recipe_family')
    .update({ is_active: false } as any)
    .or(`id.eq.${familyId},parent_family_id.eq.${familyId}`)
    .eq('account_id', accountId)
  if (famErr) throw new Error(`Error archivando familia: ${famErr.message}`)
}

// Reordenar: aplica una lista de {id, position} de una vez.
export async function reorderFamilies(items: { id: string; position: number }[]): Promise<void> {
  requireSupabase()
  for (const it of items) {
    const { error } = await supabase!
      .from('recipe_family')
      .update({ position: it.position } as any)
      .eq('id', it.id)
    if (error) throw new Error(`Error reordenando familias: ${error.message}`)
  }
}
