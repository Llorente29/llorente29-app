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
