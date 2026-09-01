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
  /**
   * Los demás productos que caen en esta misma tarjeta. Una tarjeta agrupa por
   * ESCANDALLO, no por producto, porque el motor cascadea así: agotar uno agota
   * a sus hermanos. `name` es el que de verdad tiene el override aquí; estos
   * son los que se van con él.
   */
  otrosNombres: string[]
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
    otrosNombres: (r.otros_nombres as string[]) ?? [],
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

// ═══════════════════════════════════════════════════════════════════════════
// 86 DE OPCIONES DE MODIFICADOR (01/09)
//
// El 01/09 Alcalá se quedó sin milanesa de ternera. Los nueve productos se
// marcaron, y las dos opciones de modificador siguieron vendiéndose — que es la
// RUTA NORMAL del cliente. Entró comida que no existía mientras la pantalla
// decía que estaba resuelto.
//
// Un 86 que solo se puede hacer con SQL no es un 86: a las nueve de la noche,
// en pleno servicio, no hay nadie escribiendo consultas.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModifierOptionRow {
  /** Un id cualquiera de las que comparten external_id: la RPC ancla por el ref. */
  optionId: string
  name: string
  groupName: string
  externalId: string
  /**
   * Cuántas filas comparten este external_id. Las opciones vienen DUPLICADAS
   * del catálogo — «Milanesa de ternera» son cuatro filas, dos por grupo — y
   * agotar por ref las cubre todas de una vez. Se enseña para que nadie crea
   * que se ha dejado la mitad sin agotar.
   */
  filas: number
}

export interface SoldOutOptionRow extends ModifierOptionRow {
  locationId: string | null
  locationName: string | null
  availableUntil: string | null
  setAt: string | null
}

/** Opciones que se pueden agotar: las que tienen ref publicado en el canal. */
export async function searchModifierOptions(
  accountId: string, term: string, limit = 30,
): Promise<ModifierOptionRow[]> {
  requireSupabase()
  let q = supabase!.from('modifier_option')
    .select('id, name, external_id, modifier_group:modifier_group_id(name)')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .not('external_id', 'is', null)
    .order('name')
    .limit(200)
  if (term.trim()) q = q.ilike('name', `%${term.trim()}%`)
  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las opciones: ${error.message}`)

  // Se agrupa por external_id, que es como se agota. Sin esto la lista
  // enseñaría «Milanesa de ternera» cuatro veces y nadie sabría cuál pulsar.
  const porRef = new Map<string, ModifierOptionRow>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data as any[]) ?? []) {
    const ref = r.external_id as string
    const prev = porRef.get(ref)
    if (prev) { prev.filas += 1; continue }
    porRef.set(ref, {
      optionId: r.id as string,
      name: (r.name as string) ?? '',
      groupName: (r.modifier_group?.name as string) ?? '',
      externalId: ref,
      filas: 1,
    })
  }
  return Array.from(porRef.values()).slice(0, limit)
}

/** Lo que está agotado ahora mismo, por local. NO filtra nada (regla 7). */
export async function listSoldOutOptions(locationId: string | null): Promise<SoldOutOptionRow[]> {
  requireSupabase()
  // El cast se cae solo cuando se regenere database.ts: los tipos generados
  // todavía no conocen `target_kind`, que se añadió esta tarde.
  //
  // NO se embebe el local con `locations:location_id(name)`: `product_availability`
  // NO TIENE NINGUNA CLAVE AJENA — ni a locations ni a nada — así que PostgREST
  // no sabe resolver el embed y la consulta entera falla. La lista de agotados
  // habría salido vacía y la pantalla habría parecido rota sin decir por qué.
  // Los nombres de local se resuelven en una segunda consulta.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase!.from('product_availability') as any)
    .select('external_id, location_id, available_until, set_at')
    .eq('target_kind', 'modifier_option')
    .eq('is_available', false)
  if (locationId) q = q.eq('location_id', locationId)
  const { data, error } = await q
  if (error) throw new Error(`No se han podido leer las opciones agotadas: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filas = (data as any[]) ?? []
  if (filas.length === 0) return []

  // Nombres de local, por separado (ver arriba: no hay FK que embeber).
  const locIds = Array.from(new Set(
    filas.map(f => f.location_id as string | null).filter((x): x is string => !!x),
  ))
  const nombrePorLocal = new Map<string, string>()
  if (locIds.length > 0) {
    const { data: locs } = await supabase!.from('locations').select('id, name').in('id', locIds)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of (locs as any[]) ?? []) nombrePorLocal.set(l.id as string, (l.name as string) ?? '')
  }

  const refs = Array.from(new Set(filas.map(f => f.external_id as string)))
  const { data: opts } = await supabase!.from('modifier_option')
    .select('id, name, external_id, modifier_group:modifier_group_id(name)')
    .in('external_id', refs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infoPorRef = new Map<string, { id: string; name: string; grupo: string; filas: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of (opts as any[]) ?? []) {
    const ref = o.external_id as string
    const prev = infoPorRef.get(ref)
    if (prev) { prev.filas += 1; continue }
    infoPorRef.set(ref, {
      id: o.id as string, name: (o.name as string) ?? '',
      grupo: (o.modifier_group?.name as string) ?? '', filas: 1,
    })
  }

  return filas.map(f => {
    const ref = f.external_id as string
    const info = infoPorRef.get(ref)
    return {
      optionId: info?.id ?? ref,
      name: info?.name ?? '(opción desconocida)',
      groupName: info?.grupo ?? '',
      externalId: ref,
      filas: info?.filas ?? 1,
      locationId: (f.location_id as string) ?? null,
      locationName: f.location_id ? (nombrePorLocal.get(f.location_id as string) ?? null) : null,
      availableUntil: (f.available_until as string) ?? null,
      setAt: (f.set_at as string) ?? null,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export interface OptionAvailabilityResult {
  optionRefs: string[]
  label: string
  /** false = la fila se escribió pero NO llegó al canal. Hay que decirlo. */
  dispatched: boolean
  warning?: string
}

/**
 * Agota o reactiva una opción en un local. Ancla por el ref, así que cubre
 * todas las filas duplicadas que lo comparten.
 *
 * `dispatched` NO se ignora: si la RPC escribió la fila pero no pudo empujar al
 * canal, la pantalla tiene que decirlo. Un 86 que solo existe en nuestra base
 * de datos es el fallo silencioso de siempre, un piso más abajo.
 */
export async function setModifierOptionAvailability(
  optionId: string,
  isAvailable: boolean,
  locationId: string | null,
  availableUntil?: string | null,
  reasonCode?: string | null,
): Promise<OptionAvailabilityResult> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as (
    fn: string, args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'set_modifier_option_availability', {
      p_option_id: optionId,
      p_is_available: isAvailable,
      p_location_id: locationId ?? undefined,
      p_reason: 'stock_out',
      p_available_until: availableUntil ?? undefined,
      p_reason_code: reasonCode ?? undefined,
    })
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (data as any) ?? {}
  return {
    optionRefs: Array.isArray(r.option_refs) ? r.option_refs : [],
    label: r.label ?? '',
    dispatched: r.dispatched === true,
    warning: r.warning ?? undefined,
  }
}
