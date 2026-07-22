// src/modules/kitchen/services/menuItemService.ts
//
// Service CRUD del ítem de carta (menu_item). Scope cuenta.
// Capa 2: el PVP vive aquí, por marca × canal. Una receta puede estar en
// N marcas × N canales a precios distintos (diferenciador Folvy).
//
// Operaciones:
//   - listMenuItems(opts)              → lista filtrada/paginada
//   - getMenuItemById(id)              → un ítem
//   - getMenuItemByBrandChannelRecipe  → validar duplicado (tripleta única)
//   - createMenuItem(input)            → alta
//   - updateMenuItem(id, patch)        → modificación
//   - archiveMenuItem(id)              → soft delete
//   - restoreMenuItem(id)              → des-archivar
//
// Convención de errores: todos los métodos LANZAN Error. Componentes en try/catch.
// Identidad operativa (v17.1): el caller pasa createdBy/createdByName; el
// service NO accede al context.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  MenuItem,
  MenuItemInsert,
  MenuItemUpdate,
  RowMenuItem,
  RowMenuItemInsert,
  RowMenuItemUpdate,
  MenuItemSource,
  MenuItemEconomics,
  MenuItemFlowType,
  FoodCostStatus,
} from '../../../types/kitchen'

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

export function rowToMenuItem(row: RowMenuItem): MenuItem {
  return {
    id: row.id,
    accountId: row.account_id,
    brandId: row.brand_id,
    channelId: row.channel_id,
    recipeItemId: row.recipe_item_id,
    name: row.name,
    description: row.description,
    category: row.category,
    photoUrl: row.photo_url,
    position: row.position,
    price: row.price,
    vatRate: row.vat_rate,
    consumptionPrice: row.consumption_price,
    isActive: row.is_active,
    isAvailable: row.is_available,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    source: row.source as MenuItemSource,
    aiConfidence: row.ai_confidence,
    needsReview: row.needs_review,
    aiSuggestedPrice: row.ai_suggested_price,
    kitchenName: row.kitchen_name ?? null,
    shortName: row.short_name ?? null,
    notesInternal: row.notes_internal ?? null,
    targetFoodCostPct: row.target_food_cost_pct != null ? Number(row.target_food_cost_pct) : null,
    tags: (row.tags as string[] | null) ?? [],
    packagingDescription: row.packaging_description ?? null,
    packagingCost: row.packaging_cost != null ? Number(row.packaging_cost) : null,
  }
}

function menuItemInsertToRow(input: MenuItemInsert): RowMenuItemInsert {
  return {
    account_id: input.accountId,
    brand_id: input.brandId,
    channel_id: input.channelId,
    recipe_item_id: input.recipeItemId,
    name: input.name,
    price: input.price,
    description: input.description ?? null,
    category: input.category ?? null,
    photo_url: input.photoUrl ?? null,
    position: input.position ?? 0,
    vat_rate: input.vatRate ?? 10,
    consumption_price: input.consumptionPrice ?? null,
    is_available: input.isAvailable ?? true,
    source: input.source ?? 'manual',
    ai_confidence: input.aiConfidence ?? null,
    needs_review: input.needsReview ?? false,
    ai_suggested_price: input.aiSuggestedPrice ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function menuItemUpdateToRow(patch: MenuItemUpdate): RowMenuItemUpdate {
  const row: RowMenuItemUpdate = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.recipeItemId !== undefined) row.recipe_item_id = patch.recipeItemId
  if (patch.description !== undefined) row.description = patch.description
  if (patch.category !== undefined) row.category = patch.category
  if (patch.photoUrl !== undefined) row.photo_url = patch.photoUrl
  if (patch.position !== undefined) row.position = patch.position
  if (patch.price !== undefined) row.price = patch.price
  if (patch.vatRate !== undefined) row.vat_rate = patch.vatRate
  if (patch.consumptionPrice !== undefined) row.consumption_price = patch.consumptionPrice
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.isAvailable !== undefined) row.is_available = patch.isAvailable
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  if (patch.needsReview !== undefined) row.needs_review = patch.needsReview
  if (patch.aiSuggestedPrice !== undefined) row.ai_suggested_price = patch.aiSuggestedPrice
  if (patch.kitchenName !== undefined) row.kitchen_name = patch.kitchenName
  if (patch.shortName !== undefined) row.short_name = patch.shortName
  if (patch.notesInternal !== undefined) row.notes_internal = patch.notesInternal
  if (patch.targetFoodCostPct !== undefined) row.target_food_cost_pct = patch.targetFoodCostPct
  if (patch.tags !== undefined) row.tags = patch.tags
  if (patch.packagingDescription !== undefined) row.packaging_description = patch.packagingDescription
  if (patch.packagingCost !== undefined) row.packaging_cost = patch.packagingCost
  return row
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────

export interface ListMenuItemsOptions {
  accountId: string
  brandId?: string
  channelId?: string
  includeArchived?: boolean
  includeInactive?: boolean
  search?: string
  limit?: number
  offset?: number
}

export async function listMenuItems(opts: ListMenuItemsOptions): Promise<MenuItem[]> {
  requireSupabase()
  let query = supabase!
    .from('menu_item')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('position', { ascending: true })
    .order('name', { ascending: true })

  if (opts.brandId) {
    query = query.eq('brand_id', opts.brandId)
  }
  if (opts.channelId) {
    query = query.eq('channel_id', opts.channelId)
  }
  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }
  if (opts.includeInactive === false) {
    query = query.eq('is_active', true)
  }
  if (opts.search && opts.search.trim() !== '') {
    const term = `%${opts.search.trim()}%`
    query = query.ilike('name', term)
  }
  if (typeof opts.limit === 'number') {
    const from = opts.offset ?? 0
    const to = from + opts.limit - 1
    query = query.range(from, to)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Error listando ítems de carta: ${error.message}`)
  }
  return (data ?? []).map(rowToMenuItem)
}

export async function getMenuItemById(id: string): Promise<MenuItem | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo ítem de carta ${id}: ${error.message}`)
  }
  return data ? rowToMenuItem(data) : null
}

export async function getMenuItemByBrandChannelRecipe(
  brandId: string,
  channelId: string,
  recipeItemId: string
): Promise<MenuItem | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item')
    .select('*')
    .eq('brand_id', brandId)
    .eq('channel_id', channelId)
    .eq('recipe_item_id', recipeItemId)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo ítem por marca/canal/receta: ${error.message}`)
  }
  return data ? rowToMenuItem(data) : null
}

export async function createMenuItem(input: MenuItemInsert): Promise<MenuItem> {
  requireSupabase()

  const existing = await getMenuItemByBrandChannelRecipe(
    input.brandId,
    input.channelId,
    input.recipeItemId
  )
  if (existing && existing.archivedAt === null) {
    throw new Error(
      'Esta receta ya está en la carta de esta marca y canal. ' +
      'Para el mismo plato en otro precio, usa otro canal o marca.'
    )
  }

  const { data, error } = await supabase!
    .from('menu_item')
    .insert(menuItemInsertToRow(input))
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando ítem de carta: ${error.message}`)
  }
  return rowToMenuItem(data)
}

// ─────────────────────────────────────────────────────────────────────
// createBaseMenuItem — alta de producto BASE (CP1-a)
// ─────────────────────────────────────────────────────────────────────
// Crea un producto de carta con baja fricción (patrón Otter "create-then-cost"):
// solo marca + nombre + precio (+ categoría opcional). El canal va NULL (el precio
// por canal se ajusta luego con menu_item_override, CP1-b) y el escandallo se
// vincula después en la ficha (CatalogProductDetailPage). NO usa MenuItemInsert
// (que exige channelId/recipeItemId): el producto base no los tiene todavía.

export interface CreateBaseMenuItemInput {
  accountId: string
  brandId: string
  name: string
  price: number
  vatRate?: number
  menuCategoryId?: string | null
  description?: string | null
  shortName?: string | null
  productType?: 'item' | 'combo'   // 'item' por defecto; 'combo' crea un combo vacío
  createdBy?: string | null
  createdByName?: string | null
}

export async function createBaseMenuItem(input: CreateBaseMenuItemInput): Promise<MenuItem> {
  requireSupabase()

  const name = input.name.trim()
  if (name === '') throw new Error('El nombre del producto es obligatorio.')
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error('El precio debe ser un número válido.')
  }

  const { data, error } = await supabase!
    .from('menu_item')
    .insert({
      account_id: input.accountId,
      brand_id: input.brandId,
      name,
      price: input.price,
      vat_rate: input.vatRate ?? 10,
      product_type: input.productType ?? 'item',
      menu_category_id: input.menuCategoryId ?? null,
      description: input.description?.trim() ? input.description.trim() : null,
      short_name: input.shortName?.trim() ? input.shortName.trim() : null,
      channel_id: null,        // base: el precio por canal se hace con override (CP1-b)
      recipe_item_id: null,    // un combo NO tiene escandallo propio: su coste es la suma de componentes
      is_available: true,
      source: 'manual',
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    } as RowMenuItemInsert)
    .select('*')
    .single()

  if (error) throw new Error(`Error creando ${input.productType === 'combo' ? 'combo' : 'producto'}: ${error.message}`)
  return rowToMenuItem(data)
}

// ─────────────────────────────────────────────────────────────────────
// Categoría de un producto (CP1 capa 1) — mover/recategorizar
// ─────────────────────────────────────────────────────────────────────
// Cambia SOLO menu_category_id (no toca precio, escandallo ni nada más). Pasar
// null = mover a "Sin categoría". Confinado: no pasa por MenuItemUpdate.

export async function setMenuItemCategory(
  menuItemId: string,
  categoryId: string | null,
): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('menu_item')
    .update({ menu_category_id: categoryId })
    .eq('id', menuItemId)
  if (error) throw new Error(`Error moviendo el producto de categoría: ${error.message}`)
}

// Mover en bloque (arranque en frío: clasificar muchos a la vez). Una sola query
// con .in() — atómica para el usuario, sin 23 viajes.
export async function setMenuItemCategoryBulk(
  menuItemIds: string[],
  categoryId: string | null,
): Promise<void> {
  requireSupabase()
  if (menuItemIds.length === 0) return
  const { error } = await supabase!
    .from('menu_item')
    .update({ menu_category_id: categoryId })
    .in('id', menuItemIds)
  if (error) throw new Error(`Error moviendo productos de categoría: ${error.message}`)
}

// Reordenar productos: aplica nuevas posiciones (una por producto). Se llama tras
// subir/bajar una fila. Secuencial (listas pequeñas por categoría). Siembra el
// orden 0..n-1 desde el caller, así que sirve aunque hoy todo esté a position 0.
export async function reorderMenuItems(
  updates: { id: string; position: number }[],
): Promise<void> {
  requireSupabase()
  for (const u of updates) {
    const { error } = await supabase!
      .from('menu_item')
      .update({ position: u.position })
      .eq('id', u.id)
    if (error) throw new Error(`Error reordenando productos: ${error.message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mismo producto/receta en VARIAS MARCAS (ficha-cockpit) — marcas virtuales
// ─────────────────────────────────────────────────────────────────────
// Folvy comparte la RECETA (recipe_item, de la cuenta) y tiene un menu_item por
// marca apuntando a ella (PVP propio por marca). Aquí: ver en qué marcas está,
// añadir a una marca (crea/reactiva el menu_item copiando el PVP de origen) y
// quitar (archiva el menu_item de esa marca). El coste/escandallo es único.

export interface RecipeBrandPresence {
  menuItemId: string
  brandId: string
  brandName: string
  price: number
}

export interface AccountBrandLite {
  id: string
  name: string
  ownershipType: string | null
}

export async function listBrandsForRecipe(
  accountId: string,
  recipeItemId: string,
): Promise<RecipeBrandPresence[]> {
  requireSupabase()
  const { data: items, error } = await supabase!
    .from('menu_item')
    .select('id, brand_id, price')
    .eq('account_id', accountId)
    .eq('recipe_item_id', recipeItemId)
    .is('archived_at', null)
  if (error) throw new Error(`Error listando marcas del producto: ${error.message}`)
  const brandIds = [...new Set((items ?? []).map((i) => i.brand_id as string))]
  const names = new Map<string, string>()
  if (brandIds.length > 0) {
    const { data: bs } = await supabase!.from('brand').select('id, name').in('id', brandIds)
    for (const b of bs ?? []) names.set(b.id as string, b.name as string)
  }
  return (items ?? []).map((i) => ({
    menuItemId: i.id as string,
    brandId: i.brand_id as string,
    brandName: names.get(i.brand_id as string) ?? '—',
    price: Number(i.price ?? 0),
  }))
}

export async function listAccountBrands(accountId: string): Promise<AccountBrandLite[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('brand')
    .select('id, name, ownership_type')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error listando marcas: ${error.message}`)
  return (data ?? []).map((b) => ({
    id: b.id as string,
    name: b.name as string,
    ownershipType: (b.ownership_type as string) ?? null,
  }))
}

// Añade la receta a una marca: crea el menu_item base (canal NULL) apuntando a la
// MISMA receta, copiando el PVP de origen. Si existe uno archivado para esa
// (marca, receta), lo reactiva (el índice único (brand,channel,recipe) cuenta
// también los archivados → no se puede insertar otro).
export async function addRecipeToBrand(input: {
  accountId: string
  recipeItemId: string
  brandId: string
  price: number
  name: string
  vatRate?: number
  createdBy?: string | null
  createdByName?: string | null
}): Promise<MenuItem> {
  requireSupabase()

  const { data: existing, error: findErr } = await supabase!
    .from('menu_item')
    .select('id, archived_at')
    .eq('brand_id', input.brandId)
    .eq('recipe_item_id', input.recipeItemId)
    .is('channel_id', null)
    .maybeSingle()
  if (findErr) throw new Error(`Error comprobando el producto en la marca: ${findErr.message}`)

  if (existing) {
    if ((existing as { archived_at: string | null }).archived_at === null) {
      throw new Error('Este producto ya está en esa marca.')
    }
    const { data, error } = await supabase!
      .from('menu_item')
      .update({ is_active: true, archived_at: null, price: input.price })
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single()
    if (error) throw new Error(`Error reactivando el producto en la marca: ${error.message}`)
    return rowToMenuItem(data)
  }

  const { data, error } = await supabase!
    .from('menu_item')
    .insert({
      account_id: input.accountId,
      brand_id: input.brandId,
      recipe_item_id: input.recipeItemId,
      name: input.name,
      price: input.price,
      vat_rate: input.vatRate ?? 10,
      product_type: 'item',
      channel_id: null,
      is_available: true,
      source: 'manual',
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    } as RowMenuItemInsert)
    .select('*')
    .single()
  if (error) throw new Error(`Error añadiendo el producto a la marca: ${error.message}`)
  return rowToMenuItem(data)
}

// ─────────────────────────────────────────────────────────────────────
// listLinkableMenuItems — productos de la carta SIN escandallo (candidatos a
// enlazar a una receta desde el editor). recipe_item_id IS NULL, tipo 'item'
// (NO combos: un combo nunca lleva escandallo propio), activos y no archivados.
// Enlazar uno desbloquea su coste/consumo/AvT (frente transversal catálogo↔escandallo).
// ─────────────────────────────────────────────────────────────────────

export interface LinkableMenuItem {
  id: string
  name: string
  brandId: string
  price: number
}

export async function listLinkableMenuItems(
  accountId: string,
  search?: string,
): Promise<LinkableMenuItem[]> {
  requireSupabase()
  let query = supabase!
    .from('menu_item')
    .select('id, name, brand_id, price')
    .eq('account_id', accountId)
    .is('recipe_item_id', null)
    .eq('product_type', 'item')
    .is('archived_at', null)
    .eq('is_active', true)
  if (search && search.trim() !== '') {
    query = query.ilike('name', `%${search.trim()}%`)
  }
  query = query.order('name', { ascending: true }).limit(50)

  const { data, error } = await query
  if (error) throw new Error(`Error listando productos sin escandallo: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    brandId: r.brand_id as string,
    price: Number((r as { price: number | null }).price ?? 0),
  }))
}

// ─────────────────────────────────────────────────────────────────────
// "Añadir producto existente" (autonomía multimarca) — ENCARGO 22/07/2026
// ─────────────────────────────────────────────────────────────────────
// Lectura: productos que YA EXISTEN en la cuenta y se pueden reutilizar en otra
// marca. Se DEDUPLICAN por receta (un resultado por producto real, no uno por
// marca) y se excluyen los que ya están (activos) en la marca destino. Cada
// resultado trae el nombre de referencia, el PVP modal entre marcas, en cuántas
// marcas está y si tiene modificadores (que se clonarán al añadirlo).

export interface ReusableProduct {
  recipeItemId: string
  name: string            // nombre de referencia (el más frecuente entre marcas)
  referencePrice: number  // PVP modal (sin IVA) entre marcas
  vatRate: number         // IVA de referencia (modal)
  brandCount: number      // en cuántas marcas está (activas)
  hasModifiers: boolean   // algún menu_item de esa receta tiene grupos de modificadores
}

// Devuelve el valor más frecuente de una lista (modal); desempata por el primero visto.
function modeOf<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>()
  let best: T | undefined
  let bestN = 0
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1
    counts.set(v, n)
    if (n > bestN) { bestN = n; best = v }
  }
  return best
}

export async function listReusableProducts(
  accountId: string,
  dstBrandId: string,
): Promise<ReusableProduct[]> {
  requireSupabase()

  // Productos (item) con receta, activos y no archivados, de toda la cuenta.
  const { data: items, error } = await supabase!
    .from('menu_item')
    .select('id, brand_id, recipe_item_id, name, price, vat_rate')
    .eq('account_id', accountId)
    .eq('product_type', 'item')
    .not('recipe_item_id', 'is', null)
    .is('archived_at', null)
  if (error) throw new Error(`Error listando productos reutilizables: ${error.message}`)

  // Qué recetas ya están (activas) en la marca destino → se excluyen (no duplicar).
  const inDstBrand = new Set<string>()
  for (const it of items ?? []) {
    if ((it.brand_id as string) === dstBrandId) inDstBrand.add(it.recipe_item_id as string)
  }

  // Menu_items que tienen algún grupo de modificadores (para marcar hasModifiers).
  const { data: asg, error: asgErr } = await supabase!
    .from('modifier_group_assignment')
    .select('menu_item_id')
    .eq('account_id', accountId)
  if (asgErr) throw new Error(`Error comprobando modificadores: ${asgErr.message}`)
  const itemsWithMods = new Set<string>((asg ?? []).map((a) => a.menu_item_id as string))

  // Agrupar por receta.
  interface Acc { brands: Set<string>; names: string[]; prices: number[]; vats: number[]; hasMods: boolean }
  const byRecipe = new Map<string, Acc>()
  for (const it of items ?? []) {
    const rid = it.recipe_item_id as string
    if (inDstBrand.has(rid)) continue // ya está en la marca destino
    const acc = byRecipe.get(rid) ?? { brands: new Set<string>(), names: [], prices: [], vats: [], hasMods: false }
    acc.brands.add(it.brand_id as string)
    acc.names.push(it.name as string)
    acc.prices.push(Number(it.price ?? 0))
    acc.vats.push(Number(it.vat_rate ?? 10))
    if (itemsWithMods.has(it.id as string)) acc.hasMods = true
    byRecipe.set(rid, acc)
  }

  const out: ReusableProduct[] = []
  for (const [rid, acc] of byRecipe) {
    out.push({
      recipeItemId: rid,
      name: modeOf(acc.names) ?? acc.names[0] ?? '—',
      referencePrice: modeOf(acc.prices) ?? acc.prices[0] ?? 0,
      vatRate: modeOf(acc.vats) ?? 10,
      brandCount: acc.brands.size,
      hasModifiers: acc.hasMods,
    })
  }
  // Orden alfabético estable para el buscador.
  out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return out
}

// Escritura: añade un producto existente (por receta) a la marca destino vía el RPC
// atómico add_existing_product_to_brand (crea el menu_item reutilizando la receta y
// clona los modificadores del producto a la marca destino). El RPC deduplica: si ya
// está activo devuelve 'skipped'; si estaba archivado, 'reactivated'.

export interface AddExistingResult {
  status: 'created' | 'reactivated' | 'skipped'
  menuItemId: string
  name: string
  groupsCloned: number
  optionsCloned: number
}

export async function addExistingProductToBrand(input: {
  accountId: string
  brandId: string
  recipeItemId: string
  name: string
  price: number
  vatRate?: number
  menuCategoryId?: string | null
  withModifiers?: boolean
}): Promise<AddExistingResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('add_existing_product_to_brand', {
    p_account: input.accountId,
    p_dst_brand: input.brandId,
    p_recipe_item_id: input.recipeItemId,
    p_name: input.name,
    p_price: input.price,
    p_vat_rate: input.vatRate ?? 10,
    p_menu_category_id: input.menuCategoryId ?? undefined,
    p_with_modifiers: input.withModifiers ?? true,
  })
  if (error) throw new Error(`Error añadiendo el producto existente: ${error.message}`)
  const r = (data ?? {}) as {
    status?: string; menu_item_id?: string; name?: string
    groups_cloned?: number; options_cloned?: number
  }
  return {
    status: (r.status as AddExistingResult['status']) ?? 'created',
    menuItemId: r.menu_item_id ?? '',
    name: r.name ?? input.name,
    groupsCloned: r.groups_cloned ?? 0,
    optionsCloned: r.options_cloned ?? 0,
  }
}

export async function getMenuItemCategoryId(menuItemId: string): Promise<string | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item')
    .select('menu_category_id')
    .eq('id', menuItemId)
    .maybeSingle()
  if (error) throw new Error(`Error leyendo la categoría del producto: ${error.message}`)
  return (data?.menu_category_id as string | null) ?? null
}

export async function updateMenuItem(
  id: string,
  patch: MenuItemUpdate
): Promise<MenuItem> {
  requireSupabase()

  const rowPatch = menuItemUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getMenuItemById(id)
    if (!current) throw new Error(`Ítem de carta ${id} no encontrado.`)
    return current
  }

  const { data, error } = await supabase!
    .from('menu_item')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error actualizando ítem de carta ${id}: ${error.message}`)
  }
  return rowToMenuItem(data)
}

export async function archiveMenuItem(id: string): Promise<MenuItem> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item')
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error archivando ítem de carta ${id}: ${error.message}`)
  }
  return rowToMenuItem(data)
}

export async function restoreMenuItem(id: string): Promise<MenuItem> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item')
    .update({
      is_active: true,
      archived_at: null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error restaurando ítem de carta ${id}: ${error.message}`)
  }
  return rowToMenuItem(data)
}

// ─────────────────────────────────────────────────────────────────────
// Economía de carta (RPC a la función SQL menu_item_economics)
// ─────────────────────────────────────────────────────────────────────

// Fila cruda que devuelve la RPC (snake_case)
interface RowMenuItemEconomics {
  menu_item_id: string
  menu_item_name: string
  recipe_item_id: string
  channel_id: string
  channel_name: string
  flow_type: string
  cost: number | null
  packaging_cost: number | null
  food_cost: number | null
  cost_available: boolean
  price: number
  vat_rate: number
  price_with_vat: number
  food_cost_pct: number | null
  contribution_margin: number | null
  commission_pct: number | null
  commission_amount: number | null
  commission_fixed: number | null
  delivery_fee: number | null
  revenue_share_pct: number | null
  revenue_share_amount: number | null
  consumption_reimb: number | null
  net_margin: number | null
  net_margin_pct: number | null
  target_food_cost_pct: number | null
  food_cost_status: string
  plate_cost_pct: number | null
  target_plate_cost_pct: number | null
  plate_cost_status: string
}

function rowToMenuItemEconomics(row: RowMenuItemEconomics): MenuItemEconomics {
  return {
    menuItemId: row.menu_item_id,
    menuItemName: row.menu_item_name,
    recipeItemId: row.recipe_item_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    flowType: row.flow_type as MenuItemFlowType,
    cost: row.cost,
    packagingCost: row.packaging_cost,
    foodCost: row.food_cost,
    costAvailable: row.cost_available,
    price: row.price,
    vatRate: row.vat_rate,
    priceWithVat: row.price_with_vat,
    foodCostPct: row.food_cost_pct,
    contributionMargin: row.contribution_margin,
    commissionPct: row.commission_pct,
    commissionAmount: row.commission_amount,
    commissionFixed: row.commission_fixed,
    deliveryFee: row.delivery_fee,
    revenueSharePct: row.revenue_share_pct,
    revenueShareAmount: row.revenue_share_amount,
    consumptionReimb: row.consumption_reimb,
    netMargin: row.net_margin,
    netMarginPct: row.net_margin_pct,
    targetFoodCostPct: row.target_food_cost_pct,
    foodCostStatus: row.food_cost_status as FoodCostStatus,
    plateCostPct: row.plate_cost_pct,
    targetPlateCostPct: row.target_plate_cost_pct,
    plateCostStatus: row.plate_cost_status as FoodCostStatus,
  }
}

/**
 * Economía de la carta de una marca (todas las combinaciones canal×receta).
 * Llama a la función SQL menu_item_economics. Fuente de verdad del cálculo.
 */
export async function getMenuItemEconomics(brandId: string): Promise<MenuItemEconomics[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .rpc('menu_item_economics', { p_brand_id: brandId })

  if (error) {
    throw new Error(`Error calculando economía de la marca ${brandId}: ${error.message}`)
  }
  return ((data ?? []) as RowMenuItemEconomics[]).map(rowToMenuItemEconomics)
}
