// src/modules/kitchen/services/menuCategoryService.ts
//
// Servicio CRUD de CATEGORÍAS de carta (menu_category). Scope cuenta + marca.
// Una "categoría" agrupa productos dentro de la carta de una marca (árbol vía
// parent_id; posición ordenable). Es la pieza de escritura que faltaba: hoy
// menu_category solo se leía (brandCatalogService). CP1-a.
//
// menu_category NO tiene archived_at → el "borrado" es soft vía is_active=false.
// El slug se autogenera del nombre (igual patrón que brandsService.createBrand).
//
// Patrón del proyecto: supabase directo, mappers row->domain, requireSupabase().

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { Database } from '../../../types/database'

type MenuCategoryUpdateRow = Database['public']['Tables']['menu_category']['Update']

export interface MenuCategory {
  id: string
  accountId: string
  brandId: string
  name: string
  emoji: string | null
  slug: string | null
  parentId: string | null
  position: number
  isActive: boolean
}

export interface CreateMenuCategoryInput {
  accountId: string
  brandId: string
  name: string
  emoji?: string | null
  parentId?: string | null
  position?: number
}

export interface UpdateMenuCategoryInput {
  name?: string
  emoji?: string | null
  parentId?: string | null
  position?: number
  isActive?: boolean
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// Slug a partir del nombre: minúsculas, sin acentos, guiones. Igual criterio que
// el resto de slugs del proyecto (marcas).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function rowToMenuCategory(r: Record<string, unknown>): MenuCategory {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    brandId: r.brand_id as string,
    name: r.name as string,
    emoji: (r.emoji as string) ?? null,
    slug: (r.slug as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
    position: Number(r.position ?? 0),
    isActive: r.is_active !== false,
  }
}

// Categorías activas de una marca, ordenadas por posición. Para el desplegable
// del modal de "nuevo producto" y para la gestión de categorías.
export async function listMenuCategories(
  accountId: string,
  brandId: string,
): Promise<MenuCategory[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_category')
    .select('id, account_id, brand_id, name, emoji, slug, parent_id, position, is_active')
    .eq('account_id', accountId)
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(`Error listando categorías: ${error.message}`)
  return (data ?? []).map(rowToMenuCategory)
}

export async function createMenuCategory(input: CreateMenuCategoryInput): Promise<MenuCategory> {
  requireSupabase()
  const name = input.name.trim()
  if (name === '') throw new Error('El nombre de la categoría es obligatorio.')
  const slug = slugify(name)
  const emoji = input.emoji?.trim() ? input.emoji.trim() : null

  // El constraint UNIQUE(brand_id, slug) cuenta también las INACTIVAS. Antes de
  // insertar comprobamos si el slug ya existe en la marca:
  //  - inactiva → la reactivamos (y refrescamos nombre/emoji) en vez de duplicar
  //  - activa   → aviso claro (no crear duplicada)
  const sel = 'id, account_id, brand_id, name, emoji, slug, parent_id, position, is_active'
  const { data: existing, error: findErr } = await supabase!
    .from('menu_category')
    .select(sel)
    .eq('brand_id', input.brandId)
    .eq('slug', slug)
    .maybeSingle()
  if (findErr) throw new Error(`Error comprobando categoría existente: ${findErr.message}`)

  if (existing) {
    if ((existing as { is_active: boolean }).is_active !== false) {
      throw new Error(`Ya tienes una categoría «${(existing as { name: string }).name}» en esta marca.`)
    }
    const { data, error } = await supabase!
      .from('menu_category')
      .update({ is_active: true, name, emoji })
      .eq('id', (existing as { id: string }).id)
      .select(sel)
      .single()
    if (error) throw new Error(`Error reactivando categoría: ${error.message}`)
    return rowToMenuCategory(data)
  }

  // Posición: si no se indica, va al final (max + 1) de la marca.
  let position = input.position
  if (position === undefined) {
    const { data: last } = await supabase!
      .from('menu_category')
      .select('position')
      .eq('account_id', input.accountId)
      .eq('brand_id', input.brandId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    position = last ? Number((last as { position: number }).position ?? 0) + 1 : 0
  }

  const { data, error } = await supabase!
    .from('menu_category')
    .insert({
      account_id: input.accountId,
      brand_id: input.brandId,
      name,
      emoji,
      slug,
      parent_id: input.parentId ?? null,
      position,
      is_active: true,
    })
    .select(sel)
    .single()
  if (error) {
    // Red de seguridad ante carrera: si saltara el constraint, mensaje legible.
    if (error.message.includes('menu_category_brand_id_slug_key')) {
      throw new Error(`Ya existe una categoría con ese nombre en esta marca.`)
    }
    throw new Error(`Error creando categoría: ${error.message}`)
  }
  return rowToMenuCategory(data)
}

export async function updateMenuCategory(
  id: string,
  patch: UpdateMenuCategoryInput,
): Promise<MenuCategory> {
  requireSupabase()
  const row: MenuCategoryUpdateRow = {}
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (n === '') throw new Error('El nombre de la categoría es obligatorio.')
    row.name = n
    row.slug = slugify(n)
  }
  if (patch.emoji !== undefined) row.emoji = patch.emoji?.trim() ? patch.emoji.trim() : null
  if (patch.parentId !== undefined) row.parent_id = patch.parentId
  if (patch.position !== undefined) row.position = patch.position
  if (patch.isActive !== undefined) row.is_active = patch.isActive

  if (Object.keys(row).length === 0) {
    const { data } = await supabase!
      .from('menu_category')
      .select('id, account_id, brand_id, name, emoji, slug, parent_id, position, is_active')
      .eq('id', id).single()
    return rowToMenuCategory(data!)
  }

  const { data, error } = await supabase!
    .from('menu_category')
    .update(row)
    .eq('id', id)
    .select('id, account_id, brand_id, name, emoji, slug, parent_id, position, is_active')
    .single()
  if (error) throw new Error(`Error actualizando categoría: ${error.message}`)
  return rowToMenuCategory(data)
}

// Soft-delete: desactiva la categoría (menu_category no tiene archived_at). Los
// productos que la tuvieran quedan con menu_category_id apuntando a una categoría
// inactiva → la carta los mostrará en "Sin categoría" (degradación limpia).
export async function deactivateMenuCategory(id: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('menu_category')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw new Error(`Error desactivando categoría: ${error.message}`)
}

// Reordenar: aplica nuevas posiciones (una por categoría). Se llama tras un
// drag&drop. Secuencial para no depender de upsert masivo.
export async function reorderMenuCategories(
  updates: { id: string; position: number }[],
): Promise<void> {
  requireSupabase()
  for (const u of updates) {
    const { error } = await supabase!
      .from('menu_category')
      .update({ position: u.position })
      .eq('id', u.id)
    if (error) throw new Error(`Error reordenando categorías: ${error.message}`)
  }
}
