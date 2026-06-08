// src/modules/kitchen/services/modifierImpactService.ts
//
// Service del IMPACTO de modificadores en el escandallo (G3).
// Define, por cada opción de modificador, QUÉ le hace a la receta del plato:
// añade / quita / sustituye un ingrediente, o multiplica la base. Eso es lo que
// enciende el coste real de los modificadores (lo consume compute_sale_line_cost).
//
// Ciclo de vida (tabla modifier_recipe_impact, ampliada en 20260608T2400):
//   status='proposed'  -> la IA propuso; NO toca el coste.
//   status='confirmed' -> validado por humano (o auto, Nivel 3); el motor lo usa.
//   status='rejected'  -> descartado.
//
// "El sistema aprende y no repite": una opción con impacto confirmed no vuelve a
// pedirse; las ventas se costean solas. La pantalla solo muestra lo proposed / sin
// impacto. SIEMPRE hay un humano entre la IA y el coste (proposed no cuenta).
//
// Patrón calcado de recipeStepService.ts: cliente por ruta relativa +
// requireSupabase(), mapeo Row(snake) ↔ dominio(camel), update parcial. El llamador
// aporta accountId (el service no resuelve la cuenta activa), igual que setStepLines.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { Database } from '../../../types/database'

type RowImpactInsert =
  Database['public']['Tables']['modifier_recipe_impact']['Insert']
type RowImpactUpdate =
  Database['public']['Tables']['modifier_recipe_impact']['Update']

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tipos de dominio
// ─────────────────────────────────────────────────────────────────────

export type ImpactType =
  | 'add_item' | 'remove_item' | 'replace_item' | 'multiply' | 'bundle' | 'none'
export type ImpactStatus = 'proposed' | 'confirmed' | 'rejected'
export type ImpactSource = 'human' | 'ai' | 'import'

// El impacto concreto de una opción (una fila de modifier_recipe_impact).
export interface ModifierImpact {
  id: string
  accountId: string
  modifierOptionId: string
  impactType: ImpactType
  targetRecipeItemId: string | null
  quantity: number | null
  unitId: string | null
  status: ImpactStatus
  confidence: number | null
  source: ImpactSource
  rationale: string | null
  confirmedByName: string | null
  confirmedAt: string | null
}

// Una opción de modificador de un plato, con su impacto (si lo tiene).
export interface OptionWithImpact {
  optionId: string
  optionName: string
  priceImpact: number          // suplemento del catálogo (€)
  groupId: string
  groupName: string
  minSelections: number
  maxSelections: number
  impact: ModifierImpact | null   // null = sin definir; proposed/confirmed según status
}

// Resumen de cobertura de un plato (conocidos vs por revisar).
export interface ImpactCoverage {
  total: number
  confirmed: number
  pending: number       // proposed + sin impacto
  coveragePct: number   // confirmed / total
}

export interface UpsertImpactInput {
  accountId: string
  modifierOptionId: string
  impactType: ImpactType
  targetRecipeItemId?: string | null
  quantity?: number | null
  unitId?: string | null
  status: ImpactStatus
  confidence?: number | null
  source: ImpactSource
  rationale?: string | null
  actorName?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────

interface RowImpact {
  id: string
  account_id: string
  modifier_option_id: string
  impact_type: string
  target_recipe_item_id: string | null
  quantity: number | null
  unit_id: string | null
  status: string
  confidence: number | null
  source: string
  rationale: string | null
  confirmed_by_name: string | null
  confirmed_at: string | null
}

function rowToImpact(row: RowImpact): ModifierImpact {
  return {
    id: row.id,
    accountId: row.account_id,
    modifierOptionId: row.modifier_option_id,
    impactType: row.impact_type as ImpactType,
    targetRecipeItemId: row.target_recipe_item_id,
    quantity: row.quantity,
    unitId: row.unit_id,
    status: row.status as ImpactStatus,
    confidence: row.confidence,
    source: row.source as ImpactSource,
    rationale: row.rationale,
    confirmedByName: row.confirmed_by_name,
    confirmedAt: row.confirmed_at,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lectura: opciones de modificador de un plato, con su impacto.
// ─────────────────────────────────────────────────────────────────────

/**
 * Lista los grupos de modificadores de un plato (menu_item) y sus opciones, cada
 * una con su impacto (si existe). Es la consulta que pinta la pantalla G3.
 *
 * Cadena: menu_item -> modifier_group_assignment -> modifier_group -> modifier_option
 *         -> modifier_recipe_impact (left, puede no haber).
 */
export async function listOptionsWithImpacts(
  menuItemId: string,
): Promise<OptionWithImpact[]> {
  requireSupabase()

  // Grupos asignados al plato + sus opciones (cadena de joins).
  const { data: rows, error } = await supabase!
    .from('modifier_group_assignment')
    .select(`
      modifier_group:modifier_group_id (
        id, name, min_selections, max_selections,
        modifier_option ( id, name, price_impact, position )
      )
    `)
    .eq('menu_item_id', menuItemId)

  if (error) {
    throw new Error(`Error listando modificadores del plato ${menuItemId}: ${error.message}`)
  }

  // Aplanar a opciones.
  const options: Omit<OptionWithImpact, 'impact'>[] = []
  for (const r of rows ?? []) {
    const g = (r as any).modifier_group
    if (!g) continue
    const opts = (g.modifier_option ?? []) as any[]
    opts
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((o) => {
        options.push({
          optionId: o.id,
          optionName: o.name,
          priceImpact: Number(o.price_impact ?? 0),
          groupId: g.id,
          groupName: g.name,
          minSelections: g.min_selections,
          maxSelections: g.max_selections,
        })
      })
  }
  if (options.length === 0) return []

  // Impactos de esas opciones (los que existan).
  const optionIds = options.map((o) => o.optionId)
  const { data: impactRows, error: impErr } = await supabase!
    .from('modifier_recipe_impact')
    .select('*')
    .in('modifier_option_id', optionIds)
  if (impErr) {
    throw new Error(`Error obteniendo impactos: ${impErr.message}`)
  }

  // Por opción nos quedamos con un impacto: confirmed > proposed > rejected.
  const rank: Record<string, number> = { confirmed: 3, proposed: 2, rejected: 1 }
  const byOption = new Map<string, RowImpact>()
  for (const ir of (impactRows ?? []) as RowImpact[]) {
    const prev = byOption.get(ir.modifier_option_id)
    if (!prev || (rank[ir.status] ?? 0) > (rank[prev.status] ?? 0)) {
      byOption.set(ir.modifier_option_id, ir)
    }
  }

  return options.map((o) => {
    const ir = byOption.get(o.optionId)
    return { ...o, impact: ir ? rowToImpact(ir) : null }
  })
}

/**
 * Igual que listOptionsWithImpacts pero partiendo del PLATO (recipe_item), que es
 * con lo que trabaja el editor de receta. Un recipe puede tener varios menu_item
 * (uno por marca); se agregan sus opciones deduplicando por optionId (un grupo
 * compartido entre marcas no se muestra dos veces).
 */
export async function listOptionsByRecipe(
  recipeItemId: string,
  accountId: string,
): Promise<OptionWithImpact[]> {
  requireSupabase()

  const { data: menuRows, error: menuErr } = await supabase!
    .from('menu_item')
    .select('id')
    .eq('account_id', accountId)
    .eq('recipe_item_id', recipeItemId)
    .is('archived_at', null)
  if (menuErr) {
    throw new Error(`Error resolviendo menu_item del plato ${recipeItemId}: ${menuErr.message}`)
  }
  const menuIds = (menuRows ?? []).map((m) => m.id)
  if (menuIds.length === 0) return []

  // Reutiliza listOptionsWithImpacts por cada menu_item y deduplica por optionId.
  const all = await Promise.all(menuIds.map((id) => listOptionsWithImpacts(id)))
  const seen = new Set<string>()
  const merged: OptionWithImpact[] = []
  for (const list of all) {
    for (const o of list) {
      if (seen.has(o.optionId)) continue
      seen.add(o.optionId)
      merged.push(o)
    }
  }
  return merged
}

/**
 * Cobertura de impacto de un plato: cuántas opciones tienen impacto confirmado
 * frente a las pendientes (proposed o sin impacto). Alimenta el contador
 * "conocidos · por revisar · cobertura".
 */
export async function getCoverage(menuItemId: string): Promise<ImpactCoverage> {
  const opts = await listOptionsWithImpacts(menuItemId)
  const total = opts.length
  const confirmed = opts.filter((o) => o.impact?.status === 'confirmed').length
  const pending = total - confirmed
  return {
    total,
    confirmed,
    pending,
    coveragePct: total > 0 ? Math.round((confirmed / total) * 100) : 0,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Escritura: crear/ajustar, confirmar, rechazar.
// ─────────────────────────────────────────────────────────────────────

/**
 * Crea o actualiza el impacto de una opción (upsert por modifier_option_id).
 * Sirve para "Ajustar" (humano define/corrige) y para que la IA escriba
 * propuestas (status='proposed', source='ai'). Un impacto por opción.
 *
 * Si status='confirmed', sella confirmed_at + confirmed_by_name (auditoría).
 * Tras escribir un confirmed, el llamador debe recomputar el coste de las
 * ventas afectadas (recomputeAffectedSales).
 */
export async function upsertImpact(input: UpsertImpactInput): Promise<ModifierImpact> {
  requireSupabase()

  const nowIso = new Date().toISOString()
  const confirmedFields =
    input.status === 'confirmed'
      ? { confirmed_by_name: input.actorName ?? null, confirmed_at: nowIso }
      : {}

  // ¿Existe ya un impacto para esta opción? (upsert manual por modifier_option_id)
  const { data: existing, error: readErr } = await supabase!
    .from('modifier_recipe_impact')
    .select('id')
    .eq('modifier_option_id', input.modifierOptionId)
    .maybeSingle()
  if (readErr) throw new Error(`Error buscando impacto: ${readErr.message}`)

  if (existing) {
    const patch: RowImpactUpdate = {
      impact_type: input.impactType,
      target_recipe_item_id: input.targetRecipeItemId ?? null,
      quantity: input.quantity ?? null,
      unit_id: input.unitId ?? null,
      status: input.status,
      confidence: input.confidence ?? null,
      source: input.source,
      rationale: input.rationale ?? null,
      updated_at: nowIso,
      ...confirmedFields,
    }
    const { data, error } = await supabase!
      .from('modifier_recipe_impact')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw new Error(`Error actualizando impacto: ${error.message}`)
    return rowToImpact(data as unknown as RowImpact)
  }

  const insert: RowImpactInsert = {
    account_id: input.accountId,
    modifier_option_id: input.modifierOptionId,
    impact_type: input.impactType,
    target_recipe_item_id: input.targetRecipeItemId ?? null,
    quantity: input.quantity ?? null,
    unit_id: input.unitId ?? null,
    status: input.status,
    confidence: input.confidence ?? null,
    source: input.source,
    rationale: input.rationale ?? null,
    ...confirmedFields,
  }
  const { data, error } = await supabase!
    .from('modifier_recipe_impact')
    .insert(insert)
    .select('*')
    .single()
  if (error) throw new Error(`Error creando impacto: ${error.message}`)
  return rowToImpact(data as unknown as RowImpact)
}

/**
 * Confirma una propuesta existente (status -> confirmed), sellando autoría.
 * Tras esto, el motor de coste ya la usará. El llamador recomputa las ventas.
 */
export async function confirmImpact(
  impactId: string,
  actorName: string,
): Promise<ModifierImpact> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('modifier_recipe_impact')
    .update({
      status: 'confirmed',
      confirmed_by_name: actorName,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', impactId)
    .select('*')
    .single()
  if (error) throw new Error(`Error confirmando impacto ${impactId}: ${error.message}`)
  return rowToImpact(data as unknown as RowImpact)
}

/** Rechaza una propuesta (status -> rejected). No toca el coste. */
export async function rejectImpact(impactId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('modifier_recipe_impact')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', impactId)
  if (error) throw new Error(`Error rechazando impacto ${impactId}: ${error.message}`)
}

/**
 * Recomputa el coste de todas las sale_line que llevan una opción de modificador
 * concreta (las ventas afectadas al confirmar/ajustar su impacto). Llama a la RPC
 * compute_sale_line_cost por cada línea afectada.
 *
 * Identifica las líneas por el external_id de la opción: las sale_line cuyo
 * modifier_option_id coincide, y sus líneas padre (el producto cuyo coste cambia).
 * Devuelve cuántas líneas recomputó.
 */
export async function recomputeAffectedSales(
  accountId: string,
  modifierOptionId: string,
): Promise<number> {
  requireSupabase()

  // Líneas-modificador que apuntan a esta opción + sus padres (el coste vive en el padre).
  const { data: modLines, error: e1 } = await supabase!
    .from('sale_line')
    .select('id, parent_sale_line_id')
    .eq('account_id', accountId)
    .eq('modifier_option_id', modifierOptionId)
  if (e1) throw new Error(`Error buscando ventas afectadas: ${e1.message}`)

  const targetIds = new Set<string>()
  for (const l of modLines ?? []) {
    if (l.parent_sale_line_id) targetIds.add(l.parent_sale_line_id)
    else targetIds.add(l.id)
  }
  if (targetIds.size === 0) return 0

  let recomputed = 0
  for (const id of targetIds) {
    const { error } = await supabase!.rpc('compute_sale_line_cost', { p_sale_line_id: id })
    if (!error) recomputed++
  }
  return recomputed
}

export interface AIProposalResult {
  procesados: number
  propuestos: number
  aprendidos: number
  sin_propuesta: number
}

/**
 * Pide a la IA que proponga impactos para las opciones sin definir de un plato
 * (Nivel 2). Llama a la Edge propose-modifier-impacts con el token del usuario.
 * Las propuestas se escriben como status='proposed' (no tocan el coste). El
 * llamador recarga la pestaña para mostrarlas.
 *
 * Patrón de invocación calcado de folvyAIService: getSession -> access_token ->
 * fetch al endpoint con Bearer. Aquí la respuesta es un JSON único (sin SSE).
 */
export async function requestAIProposals(
  accountId: string,
  recipeItemId: string,
): Promise<AIProposalResult> {
  requireSupabase()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const { data: sessionData, error: sessionErr } = await supabase!.auth.getSession()
  if (sessionErr) throw new Error(`Error obteniendo sesión: ${sessionErr.message}`)
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('No hay sesión activa')

  const resp = await fetch(`${supabaseUrl}/functions/v1/propose-modifier-impacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account_id: accountId, recipe_item_id: recipeItemId }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Error pidiendo propuestas a la IA (HTTP ${resp.status}): ${text || resp.statusText}`)
  }
  const data = await resp.json()
  return {
    procesados: data.procesados ?? 0,
    propuestos: data.propuestos ?? 0,
    aprendidos: data.aprendidos ?? 0,
    sin_propuesta: data.sin_propuesta ?? 0,
  }
}
