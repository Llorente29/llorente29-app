// src/modules/kds/services/kdsService.ts
//
// Servicio del KDS (Kitchen Display System). Frontera fina sobre las RPC que YA
// viven en producción (backend Capa 1). El servicio llama a la RPC y el
// componente pinta — NADA se calcula en cliente (semáforo, escalado, ruteo y
// estado vienen del servidor). Único redondeo en cliente: cantidades del
// escandallo para mostrar (decimales largos), que se hace en el COMPONENTE.
//
// DOBLE PUERTA (sesión / token): todas las RPC del tablero aceptan un token de
// dispositivo opcional. Desde la app con sesión → se llama SIN token (RLS). Desde
// el kiosco (/cocina-tv?token=...) → se pasa el token a TODAS las RPC.
//
// Patrón calcado de salesDashboardService (rpc casteado) y goodsReceiptService
// (from() acotado para tablas que aún no están en database.ts: kitchen_station,
// kitchen_family_route, kds_device — DEUDA: regenerar types cuando convenga).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// rpc() casteado: las RPC del KDS no están en los tipos autogenerados.
// Member-access de `supabase!` para no perder el `this` del cliente.
function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  requireSupabase()
  return (
    supabase!.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args).then(({ data, error }) => {
    if (error) throw new Error(`KDS · ${fn}: ${error.message}`)
    return data as T
  })
}

// from() acotado para tablas de Ajustes aún no presentes en database.ts.
type Row = Record<string, unknown>
function from(table: string) {
  requireSupabase()
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DEL TABLERO (espejo del JSON de kds_board)
// ─────────────────────────────────────────────────────────────────────────────

export type KdsStationState = 'done' | 'pending'

/** Línea hija de un plato: componente de combo (line_type='combo_item') o
 *  modificador (line_type='modifier'). El board solo trae 1 nivel de hijas
 *  (las hijas directas del padre top-level); las nietas (p.ej. modificador de
 *  un componente de combo) NO vienen en Nivel 1a. */
export interface KdsLineChild {
  line_id: string
  name: string
  qty: number
  line_type: string
  customer_note: string | null
  /** ENCARGO TPV T1.e Tarea C (12/08): nombre de cocina, si existe y no está
   *  vacío. TIPADO EN ESPERA — kds_board (RECON 12/08, pg_get_functiondef en
   *  vivo) construye 'name' desde sale_line.product_name y NO joina
   *  menu_item.kitchen_name; el campo llega siempre undefined hasta que una
   *  migración APARTE (no la de order_for_print/orders_feed_by_token) toque
   *  kds_board. El fallback a `name` hace que esto sea inofensivo mientras
   *  tanto — no es lo mismo que "ya funciona en el Pase". */
  kitchenName?: string | null
}

export interface KdsLine {
  line_id: string
  name: string
  qty: number
  station_id: string | null
  marked: boolean
  allergens: string[]
  has_recipe: boolean
  /** menu_item_id para abrir el Cook Mode (kds_recipe lo necesita). La RPC
   *  kds_board lo devuelve en cada línea (confirmado). */
  menu_item_id: string | null
  /** Hijas de esta línea (componentes de combo y/o modificadores). [] si ninguna. */
  children: KdsLineChild[]
  /** Nota del cliente para ESTE plato (de raw_tab por organizationProductId). */
  customer_note: string | null
  /** Ver nota en KdsLineChild.kitchenName — mismo hueco pendiente en kds_board. */
  kitchenName?: string | null
}

/** Estación tal como la devuelve kds_board (para nombrar grupos en el kiosco,
 *  sin sesión: el board ya trae el bloque `stations` de la ubicación). */
export interface KdsBoardStation {
  id: string
  name: string
  kind: StationKind
  display_order: number
  /** Estación por defecto del local (las líneas sin ruteo caen aquí). */
  is_default: boolean
}

export interface KdsTicket {
  sale_id: string
  external_ref: string | null
  external_tab_ref: string | null
  status: 'open' | 'closed'
  brand: string | null
  brand_logo_url: string | null
  brand_color: string | null
  channel: string | null
  minutos: number
  entro_at: string
  lineas: KdsLine[]
  estaciones: Record<string, KdsStationState> | null
}

export interface KdsBoard {
  location_id: string
  station_filter: string[] | null
  now: string
  /** Estación por defecto del local: las líneas sin ruteo específico caen aquí
   *  (ya no en station_id null). null si el local no tiene default configurada. */
  default_station_id: string | null
  /** Estación de Pase (expo) del local: la que sirve el botón "Servir". null si
   *  el local no tiene estación de Pase → el botón Servir se deshabilita. */
  expo_station_id: string | null
  /** Estaciones de la ubicación (para nombrar grupos sin sesión en el kiosco). */
  stations: KdsBoardStation[]
  tickets: KdsTicket[]
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DEL COOK MODE (espejo del JSON de kds_recipe)
// ─────────────────────────────────────────────────────────────────────────────

export type AllergenState = 'contains' | 'may_contain' | 'free' | 'unknown'

export interface RecipeAllergen {
  code: string
  state: AllergenState
}

export interface RecipeIngredient {
  name: string
  unit: string
  /** Cantidades del escandallo. NULLABLE de forma legítima: hay líneas de
   *  receta sin gramaje cargado. La vista las formatea con roundQty (tolera
   *  null → '—'); no asumir número aquí. */
  qty_base: number | null
  qty_total: number | null
  cut: string | null
}

export interface RecipeStep {
  position: number
  text: string
  kind: string | null
  duration_min: number | null
  temperature_c: number | null
  photo_url: string | null
  /** Ingredientes ligados al paso (códigos/nombres a resaltar). */
  ingredients: string[]
}

export interface KdsRecipe {
  found: boolean
  qty: number
  photo_url: string | null
  allergens: RecipeAllergen[]
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC DEL TABLERO (doble puerta: token opcional)
// ─────────────────────────────────────────────────────────────────────────────

/** Tablero de una ubicación. Con sesión → locationId + sin token. Kiosco →
 *  locationId = null + token (la RPC deriva el local del token). */
export function getBoard(locationId: string | null, token?: string | null): Promise<KdsBoard> {
  return rpc<KdsBoard>('kds_board', {
    p_location_id: locationId,
    p_device_token: token ?? null,
  })
}

/** Marca (pedido × estación) = done. Si la estación es expo y queda done, el
 *  pedido se considera servido y desaparece en el siguiente refresco. */
export function bump(saleId: string, stationId: string, token?: string | null): Promise<void> {
  return rpc<void>('kds_bump', {
    p_sale_id: saleId,
    p_station_id: stationId,
    p_token: token ?? null,
  })
}

/** Revierte (pedido × estación) a pending (recall). */
export function unbump(saleId: string, stationId: string, token?: string | null): Promise<void> {
  return rpc<void>('kds_unbump', {
    p_sale_id: saleId,
    p_station_id: stationId,
    p_token: token ?? null,
  })
}

/** Toggle del marcado por plato. Devuelve el nuevo estado (true = marcado). */
export function markLine(saleLineId: string, token?: string | null): Promise<boolean> {
  return rpc<boolean>('kds_mark_line', {
    p_sale_line_id: saleLineId,
    p_token: token ?? null,
  })
}

/** Cook Mode. p_qty = la cantidad de ESA línea (para el escalado server-side).
 *  Desde kiosco, pasa también token y locationId. */
export function getRecipe(
  menuItemId: string,
  qty: number,
  token?: string | null,
  locationId?: string | null
): Promise<KdsRecipe> {
  return rpc<KdsRecipe>('kds_recipe', {
    p_menu_item_id: menuItemId,
    p_qty: qty,
    p_token: token ?? null,
    p_location_id: locationId ?? null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ALARMA DE REPARTO (Capa 2): fallo / no entregado. Doble puerta (sesión | token).
// ─────────────────────────────────────────────────────────────────────────────

export interface KdsAlarm {
  sale_id: string
  kind: string                    // 'failed' | 'canceled' | 'cancelled' | (futuro) 'stalled_*'
  raised_at: string
  delivery_state: string | null
  order_status: string | null
  code: string | null             // nº de pedido para identificarlo de un vistazo
  customer_name: string | null
  delivery_address: string | null
  rider_name: string | null
  rider_phone: string | null
}

export interface KdsAlarmsResult {
  location_id: string
  now: string
  alarms: KdsAlarm[]
}

/** Alarmas de reparto VIVAS (no reconocidas) del local. Kiosco/tablet → token. */
export function getAlarms(locationId: string | null, token?: string | null): Promise<KdsAlarmsResult> {
  return rpc<KdsAlarmsResult>('kds_alarms', {
    p_location_id: locationId,
    p_token: token ?? null,
  })
}

/** "Enterado": reconoce (silencia) la alarma de un pedido. */
export function ackAlarm(saleId: string, token?: string | null): Promise<void> {
  return rpc<void>('kds_ack_alarm', {
    p_sale_id: saleId,
    p_token: token ?? null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// AVISO MULTI-INTEGRADOR (86 Fase 0): al agotar un producto en un local que usa
// otros integradores (Last, Otter…), recuerda desconectarlo también allí.
// Lo inserta siempre la RPC del 86 (set_product_availability(_by_token)); este
// servicio solo lee/reconoce. Doble puerta (sesión | token), calcado de la
// alarma de reparto de arriba.
// ─────────────────────────────────────────────────────────────────────────────

export interface AvailabilityNotice {
  id: string
  product_name: string
  external_id: string | null
  recipe_item_id: string | null
  brands: number
  integrators: string[]
  reason: string | null
  raised_at: string
}

export interface AvailabilityNoticesResult {
  location_id: string
  notices: AvailabilityNotice[]
}

/** Avisos multi-integrador VIVOS (sin acuse) del local. Kiosco/tablet → token. */
export function getAvailabilityNotices(locationId: string | null, token?: string | null): Promise<AvailabilityNoticesResult> {
  return rpc<AvailabilityNoticesResult>('availability_notices', {
    p_location_id: locationId,
    p_token: token ?? null,
  })
}

/** "Hecho": sella el acuse del aviso. */
export function ackAvailabilityNotice(noticeId: string, token?: string | null): Promise<void> {
  return rpc<void>('availability_ack_notice', {
    p_notice_id: noticeId,
    p_token: token ?? null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DEL LOCAL (Fase A · Cap. C): cerrar/reabrir el local en HubRise
// (order_acceptance). NO confundir con la auto-aceptación de pedidos entrantes
// (order_acceptance_config, otro frente). Doble puerta (sesión | token).
// ─────────────────────────────────────────────────────────────────────────────

export type LocationStatusMode = 'normal' | 'busy' | 'paused'

export interface LocationStatus {
  location_id: string
  location_name: string
  mode: LocationStatusMode
  resume_at: string | null
  reason: string | null
  set_at: string | null
  /** false = local sin conexión HubRise (ej. Carabanchel/Plaza Castilla): la UI degrada. */
  connected: boolean
}

/** Estado actual del local. Kiosco/tablet → token. */
export function getLocationStatus(locationId: string | null, token?: string | null): Promise<LocationStatus> {
  return rpc<LocationStatus>('location_status', {
    p_location_id: locationId,
    p_token: token ?? null,
  })
}

/** Cierra/reabre el local (mode='paused' para cerrar, 'normal' para reabrir). */
export function setLocationStatus(
  locationId: string,
  mode: LocationStatusMode,
  resumeAt?: string | null,
  reason?: string | null,
  reasonCode?: string | null,
): Promise<{ location_id: string; mode: LocationStatusMode; connected: boolean }> {
  return rpc('set_location_status', {
    p_location_id: locationId,
    p_mode: mode,
    p_resume_at: resumeAt ?? null,
    p_reason: reason ?? null,
    p_reason_code: reasonCode ?? null,
  })
}

/** Cierra/reabre el local del dispositivo (tablet, sin selector). */
export function setLocationStatusByToken(
  token: string,
  mode: LocationStatusMode,
  resumeAt?: string | null,
  reason?: string | null,
  reasonCode?: string | null,
): Promise<{ location_id: string; mode: LocationStatusMode; connected: boolean }> {
  return rpc('set_location_status_by_token', {
    p_device_token: token,
    p_mode: mode,
    p_resume_at: resumeAt ?? null,
    p_reason: reason ?? null,
    p_reason_code: reasonCode ?? null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CERRAR MARCA (Fase B · Cap. B): 86 masivo de los ref POR-MARCA de una marca
// (nunca los stock_group compartidos). Reutiliza la maquinaria de Fase 0 en
// modo batch. Doble puerta (sesión | token).
// ─────────────────────────────────────────────────────────────────────────────

export type BrandStatusMode = 'normal' | 'paused'

export interface BrandStatus {
  brand_id: string
  brand_name: string
  mode: BrandStatusMode
  resume_at: string | null
  reason: string | null
  set_at: string | null
}

export interface BrandOption { id: string; name: string }

/** Estado actual de cierre de una marca. */
export function getBrandStatus(brandId: string, token?: string | null): Promise<BrandStatus> {
  return rpc<BrandStatus>('brand_status', { p_brand_id: brandId, p_token: token ?? null })
}

/** Cierra/reabre una marca (sesión, oficina). */
export function setBrandStatus(
  brandId: string,
  mode: BrandStatusMode,
  resumeAt?: string | null,
  reason?: string | null,
  reasonCode?: string | null,
): Promise<{ brand_id: string; mode: BrandStatusMode; items: number }> {
  return rpc('set_brand_status', {
    p_brand_id: brandId,
    p_mode: mode,
    p_resume_at: resumeAt ?? null,
    p_reason: reason ?? null,
    p_reason_code: reasonCode ?? null,
  })
}

/** Cierra/reabre una marca desde la tablet (token del local; la marca se elige a mano). */
export function setBrandStatusByToken(
  token: string,
  brandId: string,
  mode: BrandStatusMode,
  resumeAt?: string | null,
  reason?: string | null,
  reasonCode?: string | null,
): Promise<{ brand_id: string; mode: BrandStatusMode; items: number }> {
  return rpc('set_brand_status_by_token', {
    p_device_token: token,
    p_brand_id: brandId,
    p_mode: mode,
    p_resume_at: resumeAt ?? null,
    p_reason: reason ?? null,
    p_reason_code: reasonCode ?? null,
  })
}

/**
 * Marcas de la cuenta con presencia REAL en HubRise (catálogo Fase 2 o
 * mapeo bridge con conexión utilizable) — mismo criterio que
 * hubrise-catalog-publish. Excluye las cedidas (solo Last, sin catálogo
 * HubRise): cerrarlas sería una promesa falsa. Doble puerta (sesión | token).
 */
export function listBrandsForClosure(accountId: string | null, token?: string | null): Promise<BrandOption[]> {
  return rpc<BrandOption[]>('brands_for_closure', {
    p_account_id: accountId,
    p_token: token ?? null,
  })
}

export interface ClosedBrand {
  brand_id: string
  brand_name: string
  mode: BrandStatusMode
  resume_at: string | null
  reason: string | null
  set_at: string | null
}

/**
 * Marcas EFECTIVAMENTE cerradas ahora mismo (indicador ambiental, §9-C) — la
 * RPC ya oculta las que tenían resume_at y ya pasó (HubRise las reabrió sola
 * vía expires_at, aunque brand.closure_mode en Folvy no se reescriba solo).
 */
export function getClosedBrands(accountId: string | null, token?: string | null): Promise<ClosedBrand[]> {
  return rpc<ClosedBrand[]>('closed_brands', {
    p_account_id: accountId,
    p_token: token ?? null,
  })
}

export interface AnomalousBrandClosure {
  brand_id: string
  brand_name: string
  resume_at: string | null
  set_at: string | null
  reason: string | null
  kind: 'indefinite' | 'expired'
}

/**
 * Cierres de marca ANÓMALOS (Cap. B · Pata 3): indefinidos hace >24h, o con
 * resume_at ya vencido. Mismo criterio que availability-watchdog usa para la
 * alarma por email — aquí consultable para pintar el aviso en pantalla.
 * Cierre correcto con hora futura NO aparece aquí (eso es closed_brands).
 */
export function getAnomalousBrandClosures(accountId: string | null, token?: string | null): Promise<AnomalousBrandClosure[]> {
  return rpc<AnomalousBrandClosure[]>('anomalous_brand_closures', {
    p_account_id: accountId,
    p_token: token ?? null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// AJUSTES DE COCINA (lectura/escritura por servicio, RLS de SESIÓN — sin token)
// ─────────────────────────────────────────────────────────────────────────────

export type StationKind = 'prep' | 'expo'

export interface KitchenStation {
  id: string
  accountId: string
  locationId: string
  name: string
  kind: StationKind
  displayOrder: number
  isActive: boolean
  /** Estación por defecto del local (UNA por local). Las líneas de plato sin
   *  ruteo específico se preparan aquí. */
  isDefault: boolean
}

function rowToStation(r: Row): KitchenStation {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    locationId: r.location_id as string,
    name: r.name as string,
    kind: (r.kind as StationKind) ?? 'prep',
    displayOrder: (r.display_order as number) ?? 0,
    isActive: Boolean(r.is_active),
    isDefault: Boolean(r.is_default),
  }
}

/** Estaciones de un local (todas, activas e inactivas), ordenadas. */
export async function listStations(
  accountId: string,
  locationId: string
): Promise<KitchenStation[]> {
  const { data, error } = await from('kitchen_station')
    .select('*')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(`KDS · listStations: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(rowToStation)
}

export async function createStation(input: {
  accountId: string
  locationId: string
  name: string
  kind: StationKind
  displayOrder?: number
}): Promise<KitchenStation> {
  const { data, error } = await from('kitchen_station')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      name: input.name.trim(),
      kind: input.kind,
      display_order: input.displayOrder ?? 0,
      is_active: true,
    })
    .select('*')
    .single()
  if (error) throw new Error(`KDS · createStation: ${error.message}`)
  return rowToStation(data as Row)
}

export async function updateStation(
  id: string,
  patch: Partial<{ name: string; kind: StationKind; displayOrder: number; isActive: boolean }>
): Promise<void> {
  const update: Row = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if (patch.kind !== undefined) update.kind = patch.kind
  if (patch.displayOrder !== undefined) update.display_order = patch.displayOrder
  if (patch.isActive !== undefined) update.is_active = patch.isActive
  const { error } = await from('kitchen_station').update(update).eq('id', id)
  if (error) throw new Error(`KDS · updateStation: ${error.message}`)
}

/** Fija la estación por defecto del local. UNA por local (índice único parcial
 *  where is_default en el backend). ATÓMICO vía RPC: kds_set_default_station
 *  hace el swap (quitar el anterior + poner el nuevo) en una sola transacción,
 *  sin la ventana de "cero defaults" de dos UPDATE sueltos. La cuenta la deriva
 *  la RPC de la estación → accountId queda sin usar (firma intacta para no tocar
 *  el componente que la llama). */
export async function setDefaultStation(
  _accountId: string,
  locationId: string,
  stationId: string
): Promise<void> {
  await rpc<void>('kds_set_default_station', {
    p_location_id: locationId,
    p_station_id: stationId,
  })
}

// ── Familias de plato (recipe_family scope='dish') ──────────────────────────

export interface DishFamily {
  id: string
  name: string
}

/** Familias de PLATO de la cuenta (las que se rutean a estaciones). */
export async function listDishFamilies(accountId: string): Promise<DishFamily[]> {
  const { data, error } = await from('recipe_family')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('scope', 'dish')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(`KDS · listDishFamilies: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => ({ id: r.id as string, name: r.name as string }))
}

// ── Ruteo familia → estación (kitchen_family_route) ─────────────────────────

export interface FamilyRoute {
  id: string
  accountId: string
  familyId: string
  stationId: string
}

function rowToRoute(r: Row): FamilyRoute {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    familyId: r.family_id as string,
    stationId: r.station_id as string,
  }
}

export async function listFamilyRoutes(accountId: string): Promise<FamilyRoute[]> {
  const { data, error } = await from('kitchen_family_route')
    .select('*')
    .eq('account_id', accountId)
  if (error) throw new Error(`KDS · listFamilyRoutes: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(rowToRoute)
}

/** Asigna (o reasigna) una familia a una estación. Upsert por account+family.
 *  stationId = null → borra el ruteo de esa familia (vuelve a "Sin estación"). */
export async function setFamilyRoute(
  accountId: string,
  familyId: string,
  stationId: string | null
): Promise<void> {
  if (stationId === null) {
    const { error } = await from('kitchen_family_route')
      .delete()
      .eq('account_id', accountId)
      .eq('family_id', familyId)
    if (error) throw new Error(`KDS · setFamilyRoute(delete): ${error.message}`)
    return
  }
  const { error } = await from('kitchen_family_route')
    .upsert(
      { account_id: accountId, family_id: familyId, station_id: stationId },
      { onConflict: 'account_id,family_id' }
    )
  if (error) throw new Error(`KDS · setFamilyRoute(upsert): ${error.message}`)
}

// ── Dispositivos / tablets (kds_device) ─────────────────────────────────────

export interface KdsDevice {
  id: string
  accountId: string
  locationId: string
  label: string
  token: string
  stationIds: string[] | null
  isActive: boolean
  lastSeenAt: string | null
}

function rowToDevice(r: Row): KdsDevice {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    locationId: r.location_id as string,
    label: r.label as string,
    token: r.token as string,
    stationIds: (r.station_ids as string[] | null) ?? null,
    isActive: Boolean(r.is_active),
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
  }
}

export async function listDevices(
  accountId: string,
  locationId?: string | null
): Promise<KdsDevice[]> {
  let q = from('kds_device').select('*').eq('account_id', accountId)
  if (locationId) q = q.eq('location_id', locationId)
  const { data, error } = await q.order('label', { ascending: true })
  if (error) throw new Error(`KDS · listDevices: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(rowToDevice)
}

/** Genera un token largo aleatorio para un dispositivo nuevo. */
export function generateDeviceToken(): string {
  return 'kdsdev_' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
}

export async function createDevice(input: {
  accountId: string
  locationId: string
  label: string
  stationIds: string[] | null
  token: string
}): Promise<KdsDevice> {
  const { data, error } = await from('kds_device')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      label: input.label.trim(),
      token: input.token,
      station_ids: input.stationIds,
      is_active: true,
    })
    .select('*')
    .single()
  if (error) throw new Error(`KDS · createDevice: ${error.message}`)
  return rowToDevice(data as Row)
}

export async function updateDevice(
  id: string,
  patch: Partial<{ label: string; stationIds: string[] | null; isActive: boolean }>
): Promise<void> {
  const update: Row = {}
  if (patch.label !== undefined) update.label = patch.label.trim()
  if (patch.stationIds !== undefined) update.station_ids = patch.stationIds
  if (patch.isActive !== undefined) update.is_active = patch.isActive
  const { error } = await from('kds_device').update(update).eq('id', id)
  if (error) throw new Error(`KDS · updateDevice: ${error.message}`)
}

/** Revoca un dispositivo (is_active=false). El token deja de validar. */
export async function revokeDevice(id: string): Promise<void> {
  await updateDevice(id, { isActive: false })
}
