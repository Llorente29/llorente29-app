// src/modules/kitchen/services/availabilityService.ts
//
// FRENTE 86 / DISPONIBILIDAD — servicio del panel de oficina (Carta).
// Habla con:
//   · locations              -> selector de local
//   · product_availability   -> lista de lo agotado (RLS de lectura por manager/admin)
//   · menu_item              -> resolver nombre, marcas y una ficha representativa
//   · external_catalog_product + external_location_map -> previsualizar "N canales"
//   · RPC set_product_availability(menu_item, bool, location, reason, until) -> agotar/reactivar
//
// La RPC hace la cascada cross-brand + el empuje por local en el servidor.
// Patrón del proyecto: supabase directo, requireSupabase(), mappers.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

const ACCOUNT_DOES_NOT_MATTER = null // marcador legibilidad

export type AvailabilityReason = 'manual' | 'stock_out' | 'schedule'

export interface LocationOption {
  id: string
  name: string
}

export interface SoldOutRow {
  id: string                    // clave de agrupación (product_key)
  name: string                  // nombre del producto
  recipeItemId: string | null
  locationId: string | null     // local Folvy (null = no atribuible)
  locationName: string | null
  reason: AvailabilityReason
  availableUntil: string | null // null = indefinido
  setAt: string | null
  brands: number                // marcas que comparten el producto
  representativeMenuItemId: string | null // para llamar a la RPC al reactivar
  sourceFolvy: boolean          // agotado desde Folvy
  sourceLast: boolean           // agotado en Last
  photoUrl: string | null
  brandNames: string[]
}

export interface ScopePreview {
  brands: number
  channels: number
}

export interface ProductPick {
  menuItemId: string
  name: string
  externalId: string | null
  recipeItemId: string | null
  brands: number
}

export interface AvailabilityResult {
  brands: number
  channels: number
  matriculas: number
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

/** Locales activos de la cuenta (para el selector). */
export async function listLocations(accountId: string): Promise<LocationOption[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('locations')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('name')
  if (error) throw new Error(`Error cargando locales: ${error.message}`)
  return (data ?? []).map((l) => ({ id: l.id as string, name: l.name as string }))
}

interface MiLite {
  id: string
  external_id: string | null
  recipe_item_id: string | null
  brand_id: string | null
  name: string
}

/** Carga las menu_item de la cuenta que casan con un conjunto de external_id / recipe_item_id. */
async function loadSiblings(
  accountId: string,
  externalIds: string[],
  recipeItemIds: string[],
): Promise<MiLite[]> {
  if (externalIds.length === 0 && recipeItemIds.length === 0) return []
  const ors: string[] = []
  if (externalIds.length > 0) ors.push(`external_id.in.(${externalIds.map((e) => `"${e}"`).join(',')})`)
  if (recipeItemIds.length > 0) ors.push(`recipe_item_id.in.(${recipeItemIds.join(',')})`)
  const { data, error } = await supabase!
    .from('menu_item')
    .select('id, external_id, recipe_item_id, brand_id, name')
    .eq('account_id', accountId)
    .or(ors.join(','))
  if (error) throw new Error(`Error resolviendo productos: ${error.message}`)
  return (data ?? []) as MiLite[]
}

/**
 * Lista lo agotado en un local (o en todos si locationId es null), UNIENDO las dos
 * fuentes: agotado desde Folvy (product_availability) + agotado en Last (espejo
 * is_enabled=false). Agrupado por producto físico vía la RPC availability_panel.
 */
export async function listSoldOut(
  accountId: string,
  locationId: string | null,
): Promise<SoldOutRow[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('availability_panel', {
    p_account_id: accountId,
    p_location_id: locationId ?? undefined,
  })
  if (error) throw new Error(`Error cargando agotados: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: (r.product_key as string) ?? (r.representative_menu_item_id as string),
    name: (r.name as string) ?? '(producto)',
    recipeItemId: (r.recipe_item_id as string) ?? null,
    locationId: (r.location_id as string) ?? null,
    locationName: (r.location_name as string) ?? null,
    reason: (r.reason as AvailabilityReason) ?? 'manual',
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

/** Busca productos de la carta por nombre (para el flujo "Agotar producto"). */
export async function searchProducts(accountId: string, query: string): Promise<ProductPick[]> {
  requireSupabase()
  const term = query.trim()
  if (term.length < 2) return []
  const { data, error } = await supabase!
    .from('menu_item')
    .select('id, external_id, recipe_item_id, brand_id, name')
    .eq('account_id', accountId)
    .eq('product_type', 'item')
    .ilike('name', `%${term}%`)
    .limit(200)
  if (error) throw new Error(`Error buscando productos: ${error.message}`)
  const rows = (data ?? []) as MiLite[]
  // agrupar por producto físico (external_id o recipe_item_id) para no repetir por marca
  const byKey = new Map<string, ProductPick>()
  const brandSets = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = r.recipe_item_id ?? r.external_id ?? r.id
    if (!byKey.has(key)) {
      byKey.set(key, {
        menuItemId: r.id,
        name: r.name,
        externalId: r.external_id,
        recipeItemId: r.recipe_item_id,
        brands: 0,
      })
      brandSets.set(key, new Set())
    }
    if (r.brand_id) brandSets.get(key)!.add(r.brand_id)
  }
  return [...byKey.entries()]
    .map(([key, p]) => ({ ...p, brands: brandSets.get(key)!.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 30)
}

/**
 * Previsualiza el alcance real de agotar (sin escribir nada): marcas que se apagan
 * y canales (catálogos de Last) que se tocarán en ese local.
 */
export async function previewScope(
  accountId: string,
  menuItemId: string,
  locationId: string | null,
): Promise<ScopePreview> {
  requireSupabase()
  // identidad del producto
  const { data: mi } = await supabase!
    .from('menu_item')
    .select('external_id, recipe_item_id')
    .eq('id', menuItemId)
    .maybeSingle()
  const ext = (mi?.external_id as string) ?? null
  const rec = (mi?.recipe_item_id as string) ?? null

  const sibs = await loadSiblings(accountId, ext ? [ext] : [], rec ? [rec] : [])
  const brands = new Set(sibs.map((s) => s.brand_id).filter(Boolean)).size
  const matriculas = [...new Set(sibs.map((s) => s.external_id).filter(Boolean) as string[])]
  if (matriculas.length === 0) return { brands, channels: 0 }

  // external_location_id del local (todas las del local; null = todas las de la cuenta)
  let elmQ = supabase!
    .from('external_location_map')
    .select('external_location_id')
    .eq('account_id', accountId)
    .eq('source', 'lastapp')
    .eq('is_active', true)
  if (locationId) elmQ = elmQ.eq('location_id', locationId)
  const { data: elm } = await elmQ
  const extLocs = (elm ?? []).map((e) => e.external_location_id as string)

  let ecpQ = supabase!
    .from('external_catalog_product')
    .select('external_channel')
    .eq('account_id', accountId)
    .in('organization_product_id', matriculas)
  if (extLocs.length > 0) ecpQ = ecpQ.in('external_location_id', extLocs)
  const { data: ecp } = await ecpQ
  const channels = new Set((ecp ?? []).map((c) => c.external_channel as string)).size

  return { brands, channels }
}

/** Agota o reactiva un producto en un local (cascada + empuje los hace la RPC). */
export async function setProductAvailability(
  menuItemId: string,
  isAvailable: boolean,
  locationId: string | null,
  reason: AvailabilityReason = 'manual',
  availableUntil?: string | null,
): Promise<AvailabilityResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('set_product_availability', {
    p_menu_item_id: menuItemId,
    p_is_available: isAvailable,
    p_location_id: locationId ?? undefined,
    p_reason: reason,
    p_available_until: availableUntil ?? undefined,
  })
  if (error) throw new Error(`Error cambiando disponibilidad: ${error.message}`)
  const r = (data ?? {}) as Record<string, unknown>
  return {
    brands: Number(r.brands ?? 0),
    channels: Number(r.channels ?? 0),
    matriculas: Number(r.matriculas ?? 0),
  }
}

export { ACCOUNT_DOES_NOT_MATTER }
