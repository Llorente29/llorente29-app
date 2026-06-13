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
// el kiosco (/kds?token=...) → se pasa el token a TODAS las RPC.
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

export interface KdsLine {
  line_id: string
  name: string
  qty: number
  station_id: string | null
  marked: boolean
  allergens: string[]
  has_recipe: boolean
  /** menu_item_id para abrir el Cook Mode (la RPC kds_recipe lo necesita).
   *  La RPC kds_board puede no traerlo en todas las versiones → opcional. */
  menu_item_id?: string | null
}

export interface KdsTicket {
  sale_id: string
  external_ref: string | null
  external_tab_ref: string | null
  status: 'open' | 'closed'
  brand: string | null
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
  qty_base: number
  qty_total: number
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

/** Tablero de una ubicación. Con sesión → sin token; kiosco → con token. */
export function getBoard(locationId: string, token?: string | null): Promise<KdsBoard> {
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
