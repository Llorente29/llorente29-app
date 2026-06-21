// src/modules/tablet/services/tabletAvailabilityService.ts
//
// Servicio del 86 POR TOKEN para la Estación de Tablet (sin sesión). Espejo del
// availabilityService de oficina, pero todas las RPC validan el token del
// dispositivo y operan en SU local (no hay selector ni location param).
//
// RPC backend (creadas en Capa 2):
//   · availability_panel_by_token(token)              -> lista de agotados
//   · search_products_by_token(token, query)          -> buscar en la carta
//   · preview_scope_by_token(token, menu_item)        -> alcance (marcas·canales)
//   · set_product_availability_by_token(token, ...)   -> agotar/reactivar
//   · device_location_by_token(token)                 -> local del dispositivo (cabecera)

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

// rpc casteado (estas RPC no están en los tipos autogenerados)
function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  requireSupabase()
  return (supabase!.rpc as unknown as (
    fn: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args)
    .then(({ data, error }) => {
      if (error) throw new Error(`Tablet 86 · ${fn}: ${error.message}`)
      return data as T
    })
}

export interface TabletLocationInfo {
  locationId: string
  locationName: string
  deviceLabel: string
}

export interface SoldOutRow {
  id: string
  name: string
  recipeItemId: string | null
  reason: string
  availableUntil: string | null
  setAt: string | null
  brands: number
  representativeMenuItemId: string | null
  sourceFolvy: boolean
  sourceLast: boolean
  photoUrl: string | null
  brandNames: string[]
}

export interface ProductPick {
  menuItemId: string
  name: string
  externalId: string | null
  recipeItemId: string | null
  brands: number
}

export interface ScopePreview { brands: number; channels: number }

export interface AvailabilityResult {
  brands: number
  channels: number
  matriculas: number
}

/** Local del dispositivo (para la cabecera "¿dónde estoy?"). */
export async function getDeviceLocation(token: string): Promise<TabletLocationInfo> {
  const d = await rpc<Record<string, unknown>>('device_location_by_token', { p_device_token: token })
  return {
    locationId: (d.location_id as string) ?? '',
    locationName: (d.location_name as string) ?? 'Local',
    deviceLabel: (d.device_label as string) ?? '',
  }
}

/** Lista de agotados del local del dispositivo. */
export async function listSoldOut(token: string): Promise<SoldOutRow[]> {
  const data = await rpc<Record<string, unknown>[]>('availability_panel_by_token', { p_device_token: token })
  return (data ?? []).map((r) => ({
    id: (r.product_key as string) ?? (r.representative_menu_item_id as string),
    name: (r.name as string) ?? '(producto)',
    recipeItemId: (r.recipe_item_id as string) ?? null,
    reason: (r.reason as string) ?? 'manual',
    availableUntil: (r.available_until as string) ?? null,
    setAt: (r.set_at as string) ?? null,
    brands: Number(r.brands ?? 0),
    representativeMenuItemId: (r.representative_menu_item_id as string) ?? null,
    sourceFolvy: r.source_folvy === true,
    sourceLast: r.source_last === true,
    photoUrl: (r.photo_url as string) ?? null,
    brandNames: (r.brand_names as string[]) ?? [],
  }))
}

/** Busca productos de la carta (agrupados por producto físico). */
export async function searchProducts(token: string, query: string): Promise<ProductPick[]> {
  const term = query.trim()
  if (term.length < 2) return []
  const data = await rpc<Record<string, unknown>[]>('search_products_by_token', {
    p_device_token: token, p_query: term,
  })
  return (data ?? []).map((r) => ({
    menuItemId: r.menuItemId as string,
    name: r.name as string,
    externalId: (r.externalId as string) ?? null,
    recipeItemId: (r.recipeItemId as string) ?? null,
    brands: Number(r.brands ?? 0),
  }))
}

/** Previsualiza el alcance (marcas · canales) en el local del dispositivo. */
export async function previewScope(token: string, menuItemId: string): Promise<ScopePreview> {
  const d = await rpc<Record<string, unknown>>('preview_scope_by_token', {
    p_device_token: token, p_menu_item_id: menuItemId,
  })
  return { brands: Number(d.brands ?? 0), channels: Number(d.channels ?? 0) }
}

/** Agota o reactiva un producto en el local del dispositivo. */
export async function setProductAvailability(
  token: string,
  menuItemId: string,
  isAvailable: boolean,
  reason: string = 'manual',
  availableUntil?: string | null,
): Promise<AvailabilityResult> {
  const d = await rpc<Record<string, unknown>>('set_product_availability_by_token', {
    p_device_token: token,
    p_menu_item_id: menuItemId,
    p_is_available: isAvailable,
    p_reason: reason,
    p_available_until: availableUntil ?? null,
  })
  return {
    brands: Number(d.brands ?? 0),
    channels: Number(d.channels ?? 0),
    matriculas: Number(d.matriculas ?? 0),
  }
}
