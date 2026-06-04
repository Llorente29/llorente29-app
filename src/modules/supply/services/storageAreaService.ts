// src/modules/supply/services/storageAreaService.ts
//
// Áreas de almacén (storage_area) y asignación artículo↔área.
// Capa 1.2 del inventario perpetuo: el "hogar" físico de cada artículo dentro
// de un local, para secuenciar el conteo (shelf-to-sheet) por recorrido real.
//
// Modelo (decidido tras benchmark MarketMan/NetSuite/Zoho):
//   - El STOCK se valora por LOCAL (locations + recipe_item_location_stock).
//     La cocina/almacén central es un local más; se conectan por traspasos.
//   - El ÁREA organiza el conteo dentro del local, NO valora stock.
//   - parent_id opcional → jerarquía configurable por cliente (plano para un
//     bar; un nivel de anidación para quien tenga almacén con zonas).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// ─── Áreas de almacén ───

export interface StorageArea {
  id: string
  locationId: string
  name: string
  parentId: string | null
  position: number
  active: boolean
  itemCount?: number  // nº de artículos asignados (cuando se pide)
}

export interface CreateStorageAreaInput {
  accountId: string
  locationId: string
  name: string
  parentId?: string | null
  position?: number
  createdBy?: string | null
  createdByName?: string | null
}

/** Áreas de un local, ordenadas por position. Incluye recuento de artículos. */
export async function listStorageAreas(
  accountId: string,
  locationId: string,
): Promise<StorageArea[]> {
  requireSupabase()
  const { data, error } = await from('storage_area')
    .select('id, location_id, name, parent_id, position, active, recipe_item_storage_area(count)')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .order('position', { ascending: true })
  if (error) throw new Error(`Error cargando áreas: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => {
    const rel = (r.recipe_item_storage_area ?? null) as { count?: number }[] | { count?: number } | null
    const count = Array.isArray(rel) ? (rel[0]?.count ?? 0) : (rel?.count ?? 0)
    return {
      id: r.id as string,
      locationId: r.location_id as string,
      name: (r.name as string) ?? '',
      parentId: (r.parent_id as string | null) ?? null,
      position: Number(r.position ?? 100),
      active: Boolean(r.active),
      itemCount: Number(count),
    }
  })
}

export async function createStorageArea(input: CreateStorageAreaInput): Promise<StorageArea> {
  requireSupabase()
  const { data, error } = await from('storage_area')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      name: input.name.trim(),
      parent_id: input.parentId ?? null,
      position: input.position ?? 100,
      active: true,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    })
    .select('id, location_id, name, parent_id, position, active')
    .single()
  if (error) throw new Error(`No se pudo crear el área: ${error.message}`)
  const r = data as Row
  return {
    id: r.id as string,
    locationId: r.location_id as string,
    name: r.name as string,
    parentId: (r.parent_id as string | null) ?? null,
    position: Number(r.position ?? 100),
    active: Boolean(r.active),
  }
}

export async function renameStorageArea(id: string, name: string): Promise<void> {
  requireSupabase()
  const { error } = await from('storage_area')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`No se pudo renombrar: ${error.message}`)
}

export async function reorderStorageArea(id: string, position: number): Promise<void> {
  requireSupabase()
  const { error } = await from('storage_area')
    .update({ position, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`No se pudo reordenar: ${error.message}`)
}

/** Archiva (desactiva) un área. No la borra para no perder histórico de asignaciones. */
export async function archiveStorageArea(id: string): Promise<void> {
  requireSupabase()
  const { error } = await from('storage_area')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`No se pudo archivar: ${error.message}`)
}

// ─── Asignación artículo↔área ───

export interface AreaItem {
  recipeItemId: string
  itemName: string
  position: number
}

/** Artículos asignados a un área, ordenados por position. */
export async function listAreaItems(
  accountId: string,
  storageAreaId: string,
): Promise<AreaItem[]> {
  requireSupabase()
  const { data, error } = await from('recipe_item_storage_area')
    .select('recipe_item_id, position, recipe_item:recipe_item_id ( name )')
    .eq('account_id', accountId)
    .eq('storage_area_id', storageAreaId)
    .order('position', { ascending: true })
  if (error) throw new Error(`Error cargando artículos del área: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => {
    const item = (r.recipe_item ?? null) as { name?: string } | null
    return {
      recipeItemId: r.recipe_item_id as string,
      itemName: item?.name ?? '(sin nombre)',
      position: Number(r.position ?? 100),
    }
  })
}

/** Asigna un artículo a un área (idempotente por la unique recipe_item_id+storage_area_id). */
export async function assignItemToArea(
  accountId: string,
  recipeItemId: string,
  storageAreaId: string,
  position = 100,
): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item_storage_area')
    .upsert(
      { account_id: accountId, recipe_item_id: recipeItemId, storage_area_id: storageAreaId, position },
      { onConflict: 'recipe_item_id,storage_area_id' },
    )
  if (error) throw new Error(`No se pudo asignar: ${error.message}`)
}

export async function unassignItemFromArea(
  recipeItemId: string,
  storageAreaId: string,
): Promise<void> {
  requireSupabase()
  const { error } = await from('recipe_item_storage_area')
    .delete()
    .eq('recipe_item_id', recipeItemId)
    .eq('storage_area_id', storageAreaId)
  if (error) throw new Error(`No se pudo quitar: ${error.message}`)
}

// ─── Artículos de la cuenta (para el asignador) ───

export interface InventoryItem {
  recipeItemId: string
  name: string
}

/** Artículos raw (ingredientes, los que se cuentan) de la cuenta, para asignar a áreas. */
export async function listInventoryItems(accountId: string): Promise<InventoryItem[]> {
  requireSupabase()
  const { data, error } = await from('recipe_item')
    .select('id, name, type')
    .eq('account_id', accountId)
    .eq('type', 'raw')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error cargando artículos: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({
    recipeItemId: r.id as string,
    name: (r.name as string) ?? '(sin nombre)',
  }))
}
