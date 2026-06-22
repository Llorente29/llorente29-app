// src/modules/kitchen/services/recipeItemService.ts
//
// Service CRUD de recipe_item (ingrediente / receta / herramienta / plato).
// Scope cuenta. Sigue el patrón canónico de brandsService.ts.
// Recálculo automático integrado tras create/update (contrastado con mercado).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { Json } from '../../../types/database'
import type {
  RecipeItem,
  RecipeItemInsert,
  RecipeItemUpdate,
  RecipeItemType,
  RecipeItemReviewNote,
  RowRecipeItem,
  RowRecipeItemInsert,
  RowRecipeItemUpdate,
} from '../../../types/kitchen'

export function rowToRecipeItem(row: RowRecipeItem): RecipeItem {
  const mapped: RecipeItem = {
    id: row.id,
    accountId: row.account_id,
    type: row.type as RecipeItemType,
    name: row.name,
    altName: row.alt_name,
    code: row.code,
    familyId: row.family_id ?? null,
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
    defaultWastePct: row.default_waste_pct ?? null,
    seasonStart: row.season_start ?? null,
    seasonEnd: row.season_end ?? null,
    shelfLifeDays: row.shelf_life_days ?? null,
    origin: row.origin ?? null,
    source: row.source as RecipeItem['source'],
    aiConfidence: row.ai_confidence,
    needsReview: row.needs_review,
    reviewNotes: (row.review_notes as unknown as RecipeItemReviewNote | null) ?? null,
    reviewDismissedAt: row.review_dismissed_at,
    reviewDismissedBy: row.review_dismissed_by,
    reviewDismissedReason: row.review_dismissed_reason,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  }
  // IVA del artículo (vat_category_id / vat_category_source): viven en la fila,
  // pero database.ts puede ir por detrás del esquema (deuda conocida) y NO están
  // en el tipo RecipeItem todavía. Sin este passthrough, el IVA guardado en BBDD
  // nunca llegaba al objeto → la ficha mostraba "sin IVA" aunque estuviera
  // confirmado. Lectura laxa, igual que hace ItemVatSelector al leerlos.
  const r = row as unknown as { vat_category_id?: string | null; vat_category_source?: string | null }
  ;(mapped as unknown as { vat_category_id?: string | null }).vat_category_id = r.vat_category_id ?? null
  ;(mapped as unknown as { vat_category_source?: string | null }).vat_category_source = r.vat_category_source ?? null
  return mapped
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
  if (patch.familyId !== undefined) row.family_id = patch.familyId
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
  if (patch.defaultWastePct !== undefined) row.default_waste_pct = patch.defaultWastePct
  if (patch.seasonStart !== undefined) row.season_start = patch.seasonStart
  if (patch.seasonEnd !== undefined) row.season_end = patch.seasonEnd
  if (patch.shelfLifeDays !== undefined) row.shelf_life_days = patch.shelfLifeDays
  if (patch.origin !== undefined) row.origin = patch.origin
  if (patch.needsReview !== undefined) row.needs_review = patch.needsReview
  if (patch.reviewNotes !== undefined) {
    row.review_notes = (patch.reviewNotes as unknown as Json) ?? null
  }
  if (patch.reviewDismissedAt !== undefined) row.review_dismissed_at = patch.reviewDismissedAt
  if (patch.reviewDismissedBy !== undefined) row.review_dismissed_by = patch.reviewDismissedBy
  if (patch.reviewDismissedReason !== undefined) row.review_dismissed_reason = patch.reviewDismissedReason
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

/**
 * Conteo de uso de cada ingrediente: en cuántos PLATOS (type='dish') distintos de
 * la cuenta aparece como línea. RPC kitchen_raw_usage_counts (server-side, con
 * guard de tenancy). Se usa para ordenar el buscador de "añadir ingrediente"
 * por lo más usado en la cocina real (E2a). Devuelve { child_item_id: count }.
 */
export async function getRawUsageCounts(accountId: string): Promise<Record<string, number>> {
  requireSupabase()
  // NOTA: kitchen_raw_usage_counts se creó el 30/05 y aún no está en los tipos
  // autogenerados de Supabase (types/database.ts). Casteamos la llamada — pero
  // OJO: hay que llamarla como member-access de `supabase!` (no asignarla a una
  // variable suelta), o se pierde el `this` del cliente y el RPC devuelve vacío.
  // TODO saneamiento: regenerar tipos de Supabase y quitar el cast.
  const { data, error } = await (
    supabase!.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )('kitchen_raw_usage_counts', { p_account_id: accountId })

  if (error) {
    throw new Error(`Error obteniendo uso de ingredientes: ${error.message}`)
  }
  const rows = (data as { child_item_id: string; usage_count: number }[] | null) ?? []
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.child_item_id] = Number(row.usage_count)
  }
  return map
}

/**
 * Platos (type='dish') INCOMPLETOS: con algún ingrediente needs_review O alguna
 * línea no costeable (unidad sin conversión). RPC kitchen_dishes_incomplete
 * (server-side, guard de tenancy, con HAVING → solo devuelve los incompletos).
 * Mismo criterio que kitchen_recipe_breakdown → coherencia editor/listado.
 * Devuelve un Set de dish_id.
 */
export async function getDishesIncomplete(accountId: string): Promise<Set<string>> {
  requireSupabase()
  // Mismo cast acotado que getRawUsageCounts: la RPC aún no está en los tipos
  // autogenerados. Llamar como member-access de `supabase!` (no a variable suelta).
  const { data, error } = await (
    supabase!.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )('kitchen_dishes_incomplete', { p_account_id: accountId })

  if (error) {
    throw new Error(`Error obteniendo platos incompletos: ${error.message}`)
  }
  const rows = (data as { dish_id: string }[] | null) ?? []
  return new Set(rows.map((r) => r.dish_id))
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

// Descarta la incidencia needs_review de un item: registra autor, motivo y
// fecha (auditable) y baja la bandera needs_review. Conserva review_notes
// como traza histórica.
//
// El actorId debe ser un user_profiles.id válido (hay FK). Algunos actores no
// tienen perfil (cuenta de pruebas "Folvy Interno", procesos de sistema): en
// ese caso la FK rechaza el id. Antes que bloquear el cierre por no poder
// identificar al autor, registramos la acción con autor null (el cuándo y el
// porqué se conservan igual). Por eso, si el primer intento falla por la FK de
// review_dismissed_by, reintentamos con by = null.
export async function dismissReview(
  id: string,
  reason: string,
  actorId: string | null
): Promise<RecipeItem> {
  requireSupabase()

  async function attempt(by: string | null) {
    return await supabase!
      .from('recipe_item')
      .update({
        needs_review: false,
        review_dismissed_at: new Date().toISOString(),
        review_dismissed_by: by,
        review_dismissed_reason: reason,
      })
      .eq('id', id)
      .select('*')
      .single()
  }

  let { data, error } = await attempt(actorId)

  // Fallback: actor sin perfil válido → la FK review_dismissed_by lo rechaza.
  // Reintentamos sin autor para no impedir el cierre de la incidencia.
  if (error && actorId !== null && error.message.includes('review_dismissed_by')) {
    ;({ data, error } = await attempt(null))
  }

  if (error) {
    throw new Error(`Error descartando incidencia del item ${id}: ${error.message}`)
  }
  return rowToRecipeItem(data!)
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

// ─────────────────────────────────────────────────────────────────────
// Reclasificar la NATURALEZA de un artículo (raw / packaging / tool)
// ─────────────────────────────────────────────────────────────────────
// Cambiar el `type` de un artículo no toca su coste (un raw y un packaging se
// costean igual), pero SÍ cambia el desglose food/packaging de cada plato que lo
// usa. updateRecipeItem recostea solo el propio artículo; estos helpers cubren
// el resto: contar en cuántos platos está (para avisar) y recostear esos platos.

/**
 * En cuántos PLATOS/RECETAS distintos aparece este artículo como línea.
 * Lectura directa de recipe_line (RLS de la cuenta). Para el aviso "se reordenará
 * en N platos" al cambiar la naturaleza del artículo.
 */
export async function countUsersOf(itemId: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('recipe_line')
    .select('parent_item_id')
    .eq('child_item_id', itemId)
  if (error) {
    throw new Error(`Error contando el uso del artículo ${itemId}: ${error.message}`)
  }
  const parents = new Set((data ?? []).map((r) => r.parent_item_id as string))
  return parents.size
}

/**
 * Recostea todos los platos/recetas que usan este artículo (RPC
 * kitchen_recompute_users_of, server-side, guard de tenancy). Se llama tras
 * cambiar la naturaleza del artículo para que el desglose food/packaging de sus
 * platos quede al día. Devuelve el nº de platos recosteados.
 */
export async function recomputeUsersOf(itemId: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('kitchen_recompute_users_of', {
    p_item_id: itemId,
  })
  if (error) {
    throw new Error(`Error recalculando los platos que usan ${itemId}: ${error.message}`)
  }
  return (data as number) ?? 0
}

// ─────────────────────────────────────────────────────────────────────
// Conteo de artículos por naturaleza (para mostrar/ocultar pestañas)
// ─────────────────────────────────────────────────────────────────────
/**
 * Cuántos artículos de un tipo hay en la cuenta (no archivados). Se usa para
 * decidir si la pestaña "Herramientas" se muestra (solo si hay alguna).
 */
export async function countRecipeItemsByType(
  accountId: string,
  type: RecipeItemType,
): Promise<number> {
  requireSupabase()
  const { count, error } = await supabase!
    .from('recipe_item')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('type', type)
    .is('archived_at', null)
  if (error) {
    throw new Error(`Error contando artículos de tipo ${type}: ${error.message}`)
  }
  return count ?? 0
}

// ─────────────────────────────────────────────────────────────────────
// Alta de ENVASE (packaging) con IVA por defecto correcto
// ─────────────────────────────────────────────────────────────────────
/**
 * Crea un artículo de tipo 'packaging' con el IVA correcto por defecto: la
 * categoría 'no_alimentario' del motor de IVA (un envase no es alimento → tipo
 * general, hoy 21%). NO se hardcodea el número: se asigna la CATEGORÍA del motor
 * y la tasa la sigue calculando el motor por fecha. Si la categoría no existe en
 * la cuenta (motor sin sembrar), crea el envase igualmente sin IVA (el usuario lo
 * pone en la ficha) — nunca bloquea el alta.
 *
 * Devuelve el artículo ya creado y recosteado (computed_cost = 0 al nacer, sin
 * proveedor todavía). El usuario completa coste/proveedor en la ficha.
 */
export async function createPackagingItem(input: {
  accountId: string
  name: string
  baseUnitId: string
  createdBy?: string | null
  createdByName?: string | null
}): Promise<RecipeItem> {
  requireSupabase()

  // Categoría de IVA 'no_alimentario' (general). Lectura suave: si falla o no
  // existe, seguimos sin IVA (no bloquea el alta del envase).
  let vatCategoryId: string | null = null
  try {
    const { data: cat } = await supabase!
      .from('vat_category')
      .select('id')
      .eq('code', 'no_alimentario')
      .maybeSingle()
    vatCategoryId = (cat as { id: string } | null)?.id ?? null
  } catch {
    vatCategoryId = null
  }

  // Insert directo (incluye family_id/vat que el insert canónico no mapea).
  const insertRow: Record<string, unknown> = {
    account_id: input.accountId,
    type: 'packaging',
    name: input.name,
    base_unit_id: input.baseUnitId,
    cost_strategy: 'fixed',
    source: 'manual',
    needs_review: false,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
  if (vatCategoryId) {
    insertRow.vat_category_id = vatCategoryId
    insertRow.vat_category_source = 'default'
  }

  const { data, error } = await supabase!
    .from('recipe_item')
    .insert(insertRow as never)
    .select('*')
    .single()
  if (error) {
    throw new Error(`Error creando envase: ${error.message}`)
  }
  const created = rowToRecipeItem(data)
  await tryRecompute(created.id)
  return (await getRecipeItemById(created.id)) ?? created
}

// ─────────────────────────────────────────────────────────────────────
// Borrado SEGURO y AUTÓNOMO (borra si no se usa, archiva si sí)
// ─────────────────────────────────────────────────────────────────────

export interface ItemDeleteCheck {
  deletable: boolean
  reasons: string[]   // motivos por los que NO se puede borrar (vacío si deletable)
  name: string
  type: string
}

/**
 * Pregunta si un artículo/receta se puede BORRAR físicamente o si habría que
 * archivarlo (porque está en cartas, se usa en platos, tiene stock, etc.).
 * No modifica nada. La UI lo usa para mostrar el diálogo correcto antes de actuar.
 */
export async function checkItemDeletable(itemId: string): Promise<ItemDeleteCheck> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('kitchen_item_delete_check', {
    p_item_id: itemId,
  })
  if (error) {
    throw new Error(`Error comprobando si se puede borrar ${itemId}: ${error.message}`)
  }
  const r = (data ?? {}) as { deletable?: boolean; reasons?: string[]; name?: string; type?: string }
  return {
    deletable: !!r.deletable,
    reasons: Array.isArray(r.reasons) ? r.reasons : [],
    name: r.name ?? '',
    type: r.type ?? '',
  }
}

export interface ItemDeleteResult {
  action: 'deleted' | 'archived'
  name: string
  reasons?: string[]
}

/**
 * Borra el artículo/receta si no tiene referencias bloqueantes; si las tiene, lo
 * archiva. Re-evalúa en el servidor (no se fía del check de la UI). Devuelve qué
 * hizo y, si archivó, por qué.
 */
export async function deleteOrArchiveItem(itemId: string): Promise<ItemDeleteResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('kitchen_delete_or_archive_item', {
    p_item_id: itemId,
  })
  if (error) {
    throw new Error(`Error al eliminar/archivar ${itemId}: ${error.message}`)
  }
  const r = (data ?? {}) as { action?: string; name?: string; reasons?: string[] }
  return {
    action: r.action === 'deleted' ? 'deleted' : 'archived',
    name: r.name ?? '',
    reasons: Array.isArray(r.reasons) ? r.reasons : undefined,
  }
}
