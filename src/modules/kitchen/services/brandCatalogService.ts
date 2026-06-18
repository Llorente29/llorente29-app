// src/modules/kitchen/services/brandCatalogService.ts
//
// Servicio de lectura del CATÁLOGO DE MARCA (la "carta"): marcas con catálogo,
// categorías + productos por marca, combos + slots, y estado de escandallo por
// producto. Solo lectura (v1). La economía (coste/margen/FC%) se obtiene aparte
// vía getMenuItemEconomics (menuItemService) y se cruza en la página.
//
// Patrón del proyecto: supabase directo, mappers row->domain, requireSupabase().
// Scope cuenta (account_id). El catálogo lo pobló el importador lastapp-catalog-import.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ─────────────────────────────────────────────────────────────────────
// Tipos de dominio (locales — el catálogo de marca no estaba en kitchen.ts)
// ─────────────────────────────────────────────────────────────────────

export interface CatalogBrand {
  id: string
  name: string
  ownershipType: string | null
  productCount: number
  comboCount: number
  withRecipeCount: number   // productos (item) con recipe_item_id != null
  unavailableCount: number  // productos con is_available = false (agotados)
}

export interface CatalogProduct {
  id: string
  name: string
  shortName: string | null
  description: string | null
  photoUrl: string | null
  price: number
  productType: 'item' | 'combo'
  categoryId: string | null
  recipeItemId: string | null
  isActive: boolean
  isAvailable: boolean
  needsReview: boolean
  modifierGroupCount: number
  position: number
}

export interface CatalogCategory {
  id: string
  name: string
  emoji: string | null
  position: number
  products: CatalogProduct[]
}

export interface CatalogComboSlot {
  id: string
  name: string
  minSelections: number
  maxSelections: number
  position: number
  optionCount: number
}

export interface CatalogCombo {
  id: string
  name: string
  shortName: string | null
  price: number
  isAvailable: boolean
  slots: CatalogComboSlot[]
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

// Marcas que tienen al menos un menu_item (productos o combos) en la cuenta,
// con sus conteos para el KPI de cobertura.
export async function listBrandsWithCatalog(accountId: string): Promise<CatalogBrand[]> {
  requireSupabase()

  // 1) Todas las marcas activas de la cuenta
  const { data: brands, error: brErr } = await supabase!
    .from('brand')
    .select('id, name, ownership_type')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('name', { ascending: true })
  if (brErr) throw new Error(`Error listando marcas: ${brErr.message}`)

  // 2) Todos los menu_item de la cuenta (para contar por marca)
  const { data: items, error: miErr } = await supabase!
    .from('menu_item')
    .select('brand_id, product_type, recipe_item_id, is_available')
    .eq('account_id', accountId)
  if (miErr) throw new Error(`Error contando ítems de carta: ${miErr.message}`)

  const byBrand = new Map<string, { products: number; combos: number; withRecipe: number; unavailable: number }>()
  for (const it of items ?? []) {
    const bid = it.brand_id as string
    if (!bid) continue
    const acc = byBrand.get(bid) ?? { products: 0, combos: 0, withRecipe: 0, unavailable: 0 }
    if (it.product_type === 'combo') acc.combos++
    else {
      acc.products++
      if (it.recipe_item_id) acc.withRecipe++
      if (it.is_available === false) acc.unavailable++
    }
    byBrand.set(bid, acc)
  }

  // Solo marcas con catálogo (algún producto o combo)
  return (brands ?? [])
    .filter((b) => byBrand.has(b.id as string))
    .map((b) => {
      const c = byBrand.get(b.id as string)!
      return {
        id: b.id as string,
        name: b.name as string,
        ownershipType: (b.ownership_type as string) ?? null,
        productCount: c.products,
        comboCount: c.combos,
        withRecipeCount: c.withRecipe,
        unavailableCount: c.unavailable,
      }
    })
}

// Categorías + productos (no combos) de una marca, agrupados por categoría.
// Los productos sin categoría se agrupan en una pseudo-categoría "Sin categoría".
export async function listCategoriesWithProducts(
  accountId: string,
  brandId: string,
): Promise<CatalogCategory[]> {
  requireSupabase()

  // Categorías de la marca
  const { data: cats, error: catErr } = await supabase!
    .from('menu_category')
    .select('id, name, emoji, position')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (catErr) throw new Error(`Error listando categorías: ${catErr.message}`)

  // Productos (item) de la marca
  const { data: items, error: miErr } = await supabase!
    .from('menu_item')
    .select('id, name, short_name, description, photo_url, price, product_type, menu_category_id, recipe_item_id, is_active, is_available, needs_review, position')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .eq('product_type', 'item')
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (miErr) throw new Error(`Error listando productos: ${miErr.message}`)

  // Conteo de grupos modificadores por producto
  const itemIds = (items ?? []).map((i) => i.id as string)
  const groupCountByItem = new Map<string, number>()
  if (itemIds.length > 0) {
    const { data: asg, error: asgErr } = await supabase!
      .from('modifier_group_assignment')
      .select('menu_item_id')
      .eq('account_id', accountId)
      .in('menu_item_id', itemIds)
    if (asgErr) throw new Error(`Error contando modificadores: ${asgErr.message}`)
    for (const a of asg ?? []) {
      const k = a.menu_item_id as string
      groupCountByItem.set(k, (groupCountByItem.get(k) ?? 0) + 1)
    }
  }

  const toProduct = (i: Record<string, unknown>): CatalogProduct => ({
    id: i.id as string,
    name: i.name as string,
    shortName: (i.short_name as string) ?? null,
    description: (i.description as string) ?? null,
    photoUrl: (i.photo_url as string) ?? null,
    price: Number(i.price ?? 0),
    productType: 'item',
    categoryId: (i.menu_category_id as string) ?? null,
    recipeItemId: (i.recipe_item_id as string) ?? null,
    isActive: i.is_active !== false,
    isAvailable: i.is_available !== false,
    needsReview: i.needs_review === true,
    modifierGroupCount: groupCountByItem.get(i.id as string) ?? 0,
    position: Number(i.position ?? 0),
  })

  const categories: CatalogCategory[] = (cats ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    emoji: (c.emoji as string) ?? null,
    position: Number(c.position ?? 0),
    products: [],
  }))
  const catById = new Map(categories.map((c) => [c.id, c]))

  const sinCategoria: CatalogCategory = {
    id: '__sin_categoria__', name: 'Sin categoría', emoji: null, position: 9999, products: [],
  }

  for (const i of items ?? []) {
    const p = toProduct(i)
    const cat = p.categoryId ? catById.get(p.categoryId) : undefined
    if (cat) cat.products.push(p)
    else sinCategoria.products.push(p)
  }

  const result = categories.filter((c) => c.products.length > 0)
  if (sinCategoria.products.length > 0) result.push(sinCategoria)
  return result
}

// Combos de una marca, con sus slots (y conteo de opciones por slot).
export async function listCombos(
  accountId: string,
  brandId: string,
): Promise<CatalogCombo[]> {
  requireSupabase()

  const { data: combos, error: cErr } = await supabase!
    .from('menu_item')
    .select('id, name, short_name, price, is_available')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .eq('product_type', 'combo')
    .order('name', { ascending: true })
  if (cErr) throw new Error(`Error listando combos: ${cErr.message}`)

  const comboIds = (combos ?? []).map((c) => c.id as string)
  if (comboIds.length === 0) return []

  const { data: slots, error: sErr } = await supabase!
    .from('combo_slot')
    .select('id, combo_item_id, name, min_selections, max_selections, position')
    .eq('account_id', accountId)
    .in('combo_item_id', comboIds)
    .order('position', { ascending: true })
  if (sErr) throw new Error(`Error listando slots de combo: ${sErr.message}`)

  const slotIds = (slots ?? []).map((s) => s.id as string)
  const optCountBySlot = new Map<string, number>()
  if (slotIds.length > 0) {
    const { data: opts, error: oErr } = await supabase!
      .from('combo_slot_option')
      .select('combo_slot_id')
      .eq('account_id', accountId)
      .in('combo_slot_id', slotIds)
    if (oErr) throw new Error(`Error contando opciones de slot: ${oErr.message}`)
    for (const o of opts ?? []) {
      const k = o.combo_slot_id as string
      optCountBySlot.set(k, (optCountBySlot.get(k) ?? 0) + 1)
    }
  }

  const slotsByCombo = new Map<string, CatalogComboSlot[]>()
  for (const s of slots ?? []) {
    const cid = s.combo_item_id as string
    const arr = slotsByCombo.get(cid) ?? []
    arr.push({
      id: s.id as string,
      name: s.name as string,
      minSelections: Number(s.min_selections ?? 1),
      maxSelections: Number(s.max_selections ?? 1),
      position: Number(s.position ?? 0),
      optionCount: optCountBySlot.get(s.id as string) ?? 0,
    })
    slotsByCombo.set(cid, arr)
  }

  return (combos ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    shortName: (c.short_name as string) ?? null,
    price: Number(c.price ?? 0),
    isAvailable: c.is_available !== false,
    slots: slotsByCombo.get(c.id as string) ?? [],
  }))
}

// ─────────────────────────────────────────────────────────────────────
// Detalle de producto: grupos de modificadores con sus opciones
// ─────────────────────────────────────────────────────────────────────

export interface CatalogModifierOption {
  id: string
  name: string
  priceImpact: number
  isDefault: boolean
  recipeItemId: string | null
}

export interface CatalogModifierGroup {
  id: string
  name: string
  groupType: string
  minSelections: number
  maxSelections: number
  position: number
  options: CatalogModifierOption[]
}

// Grupos de modificadores asignados a un producto, con sus opciones ordenadas.
export async function getProductModifierGroups(
  accountId: string,
  menuItemId: string,
): Promise<CatalogModifierGroup[]> {
  requireSupabase()

  // Asignaciones del producto -> grupos
  const { data: asg, error: asgErr } = await supabase!
    .from('modifier_group_assignment')
    .select('modifier_group_id, position')
    .eq('account_id', accountId)
    .eq('menu_item_id', menuItemId)
    .order('position', { ascending: true })
  if (asgErr) throw new Error(`Error leyendo modificadores del producto: ${asgErr.message}`)

  const groupIds = (asg ?? []).map((a) => a.modifier_group_id as string)
  if (groupIds.length === 0) return []

  // Grupos
  const { data: groups, error: gErr } = await supabase!
    .from('modifier_group')
    .select('id, name, group_type, min_selections, max_selections, position')
    .eq('account_id', accountId)
    .in('id', groupIds)
  if (gErr) throw new Error(`Error leyendo grupos: ${gErr.message}`)

  // Opciones de esos grupos
  const { data: opts, error: oErr } = await supabase!
    .from('modifier_option')
    .select('id, modifier_group_id, name, price_impact, is_default, recipe_item_id, position')
    .eq('account_id', accountId)
    .in('modifier_group_id', groupIds)
    .order('position', { ascending: true })
  if (oErr) throw new Error(`Error leyendo opciones: ${oErr.message}`)

  const optsByGroup = new Map<string, CatalogModifierOption[]>()
  for (const o of opts ?? []) {
    const gid = o.modifier_group_id as string
    const arr = optsByGroup.get(gid) ?? []
    arr.push({
      id: o.id as string,
      name: o.name as string,
      priceImpact: Number(o.price_impact ?? 0),
      isDefault: o.is_default === true,
      recipeItemId: (o.recipe_item_id as string) ?? null,
    })
    optsByGroup.set(gid, arr)
  }

  // Orden de grupos según la posición de la asignación
  const posByGroup = new Map<string, number>()
  for (const a of asg ?? []) posByGroup.set(a.modifier_group_id as string, Number(a.position ?? 0))

  return (groups ?? [])
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      groupType: (g.group_type as string) ?? 'choice',
      minSelections: Number(g.min_selections ?? 0),
      maxSelections: Number(g.max_selections ?? 1),
      position: posByGroup.get(g.id as string) ?? Number(g.position ?? 0),
      options: optsByGroup.get(g.id as string) ?? [],
    }))
    .sort((a, b) => a.position - b.position)
}
