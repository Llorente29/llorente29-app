// src/modules/kitchen/services/availabilityService.ts
//
// FRENTE 86 / DISPONIBILIDAD — servicio del panel de oficina (Carta).
// Habla con:
//   · locations              -> selector de local
//   · product_availability   -> lista de lo agotado (RLS de lectura por manager/admin)
//   · menu_item              -> resolver nombre, marcas y una ficha representativa
//   · external_catalog_product + external_location_map -> previsualizar "Last: N canales"
//   · brand_hubrise_catalog  -> previsualizar "HubRise: N marcas"
//   · RPC search_products_86(account, query, location) -> buscar en la carta (86 lote)
//   · RPC set_product_availability(menu_item, bool, location, reason, until) -> agotar/reactivar 1
//   · RPC set_products_availability_bulk(menu_items[], ...) -> agotar/reactivar en lote (86 lote)
//
// La RPC hace la cascada cross-brand + el empuje por local en el servidor.
// Patrón del proyecto: supabase directo, requireSupabase(), mappers.
//
// ENCARGO 86 (06/08): search_products_86/previewScopeBulk/setProductsAvailabilityBulk
// son NUEVOS para la multi-selección. search_products_86 sustituye la consulta
// directa .from('menu_item') de antes (incluye combos, excluye ya-agotados y
// marcas inactivas — ver migración 20260815T1700). El contador de canales pasa
// de {brands, channels} a {brands, channelsLast, brandsHubrise}: el viejo
// "channels" solo miraba Last (source='lastapp') y desde que Uber salió de
// Last ese contador mentía en producción (enseñaba menos canales de los que de
// verdad se apagaban). previewScope (singular) se queda por compatibilidad —
// lo sigue usando EnCartaTab (ficha de producto) — con la misma forma honesta.

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

/** Alcance honesto: Last (real, de siempre) + HubRise (real, ENCARGO 86 — antes
 *  no se contaba y el aviso mentía desde que Uber salió de Last). null = no se
 *  pudo calcular ese tramo (nunca se pinta como si fuera 0). */
export interface ScopePreview {
  brands: number
  channelsLast: number | null
  brandsHubrise: number | null
}

export interface ProductPick {
  menuItemId: string
  name: string
  externalId: string | null
  recipeItemId: string | null
  brands: number
  isCombo: boolean
}

export interface AvailabilityResult {
  brands: number
  channels: number
  matriculas: number
}

export interface BulkAvailabilityFailure {
  menuItemId: string
  error: string
}

export interface BulkAvailabilityResult {
  products: number
  brands: number
  channels: number
  failed: BulkAvailabilityFailure[]
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
  stock_group_id: string | null
  name: string
}

/**
 * Carga las menu_item que casan con recipe_item_id / stock_group_id (Fase B).
 * NO usa external_id crudo: colisiona por accidente entre marcas (Last
 * reutiliza ids), así que ya no es señal de "mismo producto físico" — la
 * cascada cross-brand real es receta compartida O grupo de stock EXPLÍCITO.
 */
async function loadSiblings(
  accountId: string,
  recipeItemIds: string[],
  stockGroupIds: string[],
): Promise<MiLite[]> {
  if (recipeItemIds.length === 0 && stockGroupIds.length === 0) return []
  const ors: string[] = []
  if (recipeItemIds.length > 0) ors.push(`recipe_item_id.in.(${recipeItemIds.join(',')})`)
  if (stockGroupIds.length > 0) ors.push(`stock_group_id.in.(${stockGroupIds.join(',')})`)
  const { data, error } = await supabase!
    .from('menu_item')
    .select('id, external_id, recipe_item_id, brand_id, stock_group_id, name')
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

/**
 * Busca productos de la carta por nombre (flujo "Agotar producto", ENCARGO 86).
 * Vía RPC search_products_86 (migración 20260815T1700): incluye combos, excluye
 * ya-agotados y marcas inactivas — antes era una query directa que solo miraba
 * product_type='item' y no sabía qué ya estaba agotado.
 */
export async function searchProducts(
  accountId: string,
  query: string,
  locationId: string | null = null,
): Promise<ProductPick[]> {
  requireSupabase()
  const term = query.trim()
  if (term.length < 2) return []
  const { data, error } = await supabase!.rpc('search_products_86', {
    p_account_id: accountId,
    p_query: term,
    p_location_id: locationId ?? undefined,
  })
  if (error) throw new Error(`Error buscando productos: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    menuItemId: r.menuItemId as string,
    name: r.name as string,
    externalId: (r.externalId as string) ?? null,
    recipeItemId: (r.recipeItemId as string) ?? null,
    brands: Number(r.brands ?? 0),
    isCombo: r.isCombo === true,
  }))
}

/**
 * Canales Last reales para un conjunto de matrículas ya resueltas. null = no
 * se pudo calcular (el caller lo pinta como "—", nunca como 0 — ENCARGO 86).
 */
async function countChannelsLast(
  accountId: string,
  matriculas: string[],
  locationId: string | null,
): Promise<number | null> {
  if (matriculas.length === 0) return 0
  try {
    let elmQ = supabase!
      .from('external_location_map')
      .select('external_location_id')
      .eq('account_id', accountId)
      .eq('source', 'lastapp')
      .eq('is_active', true)
    if (locationId) elmQ = elmQ.eq('location_id', locationId)
    const { data: elm, error: elmErr } = await elmQ
    if (elmErr) throw elmErr
    const extLocs = (elm ?? []).map((e) => e.external_location_id as string)

    let ecpQ = supabase!
      .from('external_catalog_product')
      .select('external_channel')
      .eq('account_id', accountId)
      .in('organization_product_id', matriculas)
    if (extLocs.length > 0) ecpQ = ecpQ.in('external_location_id', extLocs)
    const { data: ecp, error: ecpErr } = await ecpQ
    if (ecpErr) throw ecpErr
    return new Set((ecp ?? []).map((c) => c.external_channel as string)).size
  } catch {
    return null
  }
}

/**
 * Marcas con catálogo HubRise real para un conjunto de brand_id (ENCARGO 86).
 * null = no se pudo calcular (el caller lo pinta como "—", nunca como 0).
 */
async function countBrandsHubrise(
  accountId: string,
  brandIds: string[],
  locationId: string | null,
): Promise<number | null> {
  if (brandIds.length === 0) return 0
  try {
    let bhcQ = supabase!
      .from('brand_hubrise_catalog')
      .select('brand_id')
      .eq('account_id', accountId)
      .in('brand_id', brandIds)
    if (locationId) bhcQ = bhcQ.eq('location_id', locationId)
    const { data: bhc, error } = await bhcQ
    if (error) throw error
    return new Set((bhc ?? []).map((b) => b.brand_id as string)).size
  } catch {
    return null
  }
}

/**
 * Previsualiza el alcance real de agotar UN producto (sin escribir nada):
 * marcas que se apagan, canales Last y marcas con HubRise que se tocarán en
 * ese local.
 */
export async function previewScope(
  accountId: string,
  menuItemId: string,
  locationId: string | null,
): Promise<ScopePreview> {
  requireSupabase()
  const { data: mi } = await supabase!
    .from('menu_item')
    .select('external_id, recipe_item_id, stock_group_id, brand_id')
    .eq('id', menuItemId)
    .maybeSingle()
  const ext = (mi?.external_id as string) ?? null
  const rec = (mi?.recipe_item_id as string) ?? null
  const grp = (mi?.stock_group_id as string) ?? null
  const ownBrand = (mi?.brand_id as string) ?? null

  const sibs = await loadSiblings(accountId, rec ? [rec] : [], grp ? [grp] : [])
  // sin hermanos por receta/grupo -> el alcance es SOLO este item (por-marca, aislado)
  const brands = sibs.length > 0 ? new Set(sibs.map((s) => s.brand_id).filter(Boolean)).size : (ownBrand ? 1 : 0)
  const matriculas = sibs.length > 0
    ? [...new Set(sibs.map((s) => s.external_id).filter(Boolean) as string[])]
    : (ext ? [ext] : [])
  const brandIds = sibs.length > 0
    ? [...new Set(sibs.map((s) => s.brand_id).filter(Boolean) as string[])]
    : (ownBrand ? [ownBrand] : [])

  const channelsLast = await countChannelsLast(accountId, matriculas, locationId)
  const brandsHubrise = await countBrandsHubrise(accountId, brandIds, locationId)

  return { brands, channelsLast, brandsHubrise }
}

/**
 * Previsualiza el alcance AGREGADO de agotar VARIOS productos a la vez
 * (ENCARGO 86, multi-selección): une hermanos/matrículas/marcas de toda la
 * selección y calcula el alcance real una sola vez para el conjunto.
 */
export async function previewScopeBulk(
  accountId: string,
  menuItemIds: string[],
  locationId: string | null,
): Promise<ScopePreview> {
  requireSupabase()
  if (menuItemIds.length === 0) return { brands: 0, channelsLast: 0, brandsHubrise: 0 }

  const { data: misData, error } = await supabase!
    .from('menu_item')
    .select('id, external_id, recipe_item_id, stock_group_id, brand_id')
    .eq('account_id', accountId)
    .in('id', menuItemIds)
  if (error) throw new Error(`Error resolviendo selección: ${error.message}`)
  const picked = (misData ?? []) as { id: string; external_id: string | null; recipe_item_id: string | null; stock_group_id: string | null; brand_id: string | null }[]

  const recipeIds = [...new Set(picked.map((p) => p.recipe_item_id).filter((x): x is string => !!x))]
  const stockGroupIds = [...new Set(picked.map((p) => p.stock_group_id).filter((x): x is string => !!x))]
  const sibs = await loadSiblings(accountId, recipeIds, stockGroupIds)

  const brandIds = new Set<string>()
  const matriculas = new Set<string>()
  sibs.forEach((s) => {
    if (s.brand_id) brandIds.add(s.brand_id)
    if (s.external_id) matriculas.add(s.external_id)
  })
  // items sin receta ni stock_group: aislados (por-marca), cuentan aparte
  picked.forEach((p) => {
    if (!p.recipe_item_id && !p.stock_group_id) {
      if (p.brand_id) brandIds.add(p.brand_id)
      if (p.external_id) matriculas.add(p.external_id)
    }
  })

  const channelsLast = await countChannelsLast(accountId, [...matriculas], locationId)
  const brandsHubrise = await countBrandsHubrise(accountId, [...brandIds], locationId)

  return { brands: brandIds.size, channelsLast, brandsHubrise }
}

/** Agota o reactiva un producto en un local (cascada + empuje los hace la RPC). */
export async function setProductAvailability(
  menuItemId: string,
  isAvailable: boolean,
  locationId: string | null,
  reason: AvailabilityReason = 'manual',
  availableUntil?: string | null,
  reasonCode?: string | null,
): Promise<AvailabilityResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('set_product_availability', {
    p_menu_item_id: menuItemId,
    p_is_available: isAvailable,
    p_location_id: locationId ?? undefined,
    p_reason: reason,
    p_available_until: availableUntil ?? undefined,
    p_reason_code: reasonCode ?? undefined,
  })
  if (error) throw new Error(`Error cambiando disponibilidad: ${error.message}`)
  const r = (data ?? {}) as Record<string, unknown>
  return {
    brands: Number(r.brands ?? 0),
    channels: Number(r.channels ?? 0),
    matriculas: Number(r.matriculas ?? 0),
  }
}

/**
 * Agota o reactiva VARIOS productos de una vez, con motivo/vencimiento ÚNICOS
 * para toda la selección (ENCARGO 86). Un solo empuje a canales en el
 * servidor para toda la selección (RPC set_products_availability_bulk). Los
 * fallos individuales no abortan el resto — vienen en `failed` y se lanzan
 * como error agregado para que la UI los muestre (nada de catch mudo).
 */
export async function setProductsAvailabilityBulk(
  menuItemIds: string[],
  isAvailable: boolean,
  locationId: string | null,
  reason: AvailabilityReason = 'manual',
  availableUntil?: string | null,
  reasonCode?: string | null,
): Promise<BulkAvailabilityResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('set_products_availability_bulk', {
    p_menu_item_ids: menuItemIds,
    p_is_available: isAvailable,
    p_location_id: locationId ?? undefined,
    p_reason: reason,
    p_available_until: availableUntil ?? undefined,
    p_reason_code: reasonCode ?? undefined,
  })
  if (error) throw new Error(`Error agotando en lote: ${error.message}`)
  const r = (data ?? {}) as Record<string, unknown>
  const failed = ((r.failed as Record<string, unknown>[]) ?? []).map((f) => ({
    menuItemId: f.menu_item_id as string,
    error: (f.error as string) ?? 'error desconocido',
  }))
  return {
    products: Number(r.products ?? 0),
    brands: Number(r.brands ?? 0),
    channels: Number(r.channels ?? 0),
    failed,
  }
}

export { ACCOUNT_DOES_NOT_MATTER }
