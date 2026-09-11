// src/modules/tablet/services/tabletAvailabilityService.ts
//
// Servicio del 86 POR TOKEN para la Estación de Tablet (sin sesión). Espejo del
// availabilityService de oficina, pero todas las RPC validan el token del
// dispositivo y operan en SU local (no hay selector ni location param).
//
// RPC backend (creadas en Capa 2; ampliadas ENCARGO 86 06/08 — ver migración
// supabase/migrations/20260815T1700_agotar_producto_lote_encargo86.sql):
//   · availability_panel_by_token(token)                    -> lista de agotados
//   · search_products_by_token(token, query)                -> buscar en la carta
//                                                                (ahora incluye combos,
//                                                                 excluye ya-agotados y
//                                                                 marcas inactivas)
//   · preview_scope_by_token(token, menu_item)               -> alcance de 1 producto,
//                                                                honesto (Last + HubRise)
//   · preview_scope_bulk_by_token(token, menu_item[])        -> alcance agregado, lote
//   · set_product_availability_by_token(token, ...)          -> agotar/reactivar 1
//   · set_products_availability_bulk_by_token(token, [...])  -> agotar/reactivar en lote
//   · device_location_by_token(token)                        -> local del dispositivo (cabecera)

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
  /** Los demás productos de la misma tarjeta: comparten escandallo y se
   *  reactivan juntos. `name` es el que tiene el override aquí. */
  otrosNombres: string[]
}

export interface ProductPick {
  menuItemId: string
  name: string
  externalId: string | null
  recipeItemId: string | null
  brands: number
  isCombo: boolean
}

/** Alcance honesto: Last (real) + HubRise (real, ENCARGO 86). */
export interface ScopePreview {
  brands: number
  channelsLast: number | null
  brandsHubrise: number | null
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
    otrosNombres: (r.otros_nombres as string[]) ?? [],
  }))
}

/** Busca productos de la carta (agrupados por producto físico; combos incluidos). */
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
    isCombo: r.isCombo === true,
  }))
}

/** Previsualiza el alcance (marcas · Last · HubRise) en el local del dispositivo. */
export async function previewScope(token: string, menuItemId: string): Promise<ScopePreview> {
  const d = await rpc<Record<string, unknown>>('preview_scope_by_token', {
    p_device_token: token, p_menu_item_id: menuItemId,
  })
  return {
    brands: Number(d.brands ?? 0),
    channelsLast: d.channelsLast == null ? null : Number(d.channelsLast),
    brandsHubrise: d.brandsHubrise == null ? null : Number(d.brandsHubrise),
  }
}

/**
 * Previsualiza el alcance AGREGADO de VARIOS productos a la vez (ENCARGO 86,
 * multi-selección en la tablet).
 */
export async function previewScopeBulk(token: string, menuItemIds: string[]): Promise<ScopePreview> {
  if (menuItemIds.length === 0) return { brands: 0, channelsLast: 0, brandsHubrise: 0 }
  const d = await rpc<Record<string, unknown>>('preview_scope_bulk_by_token', {
    p_device_token: token, p_menu_item_ids: menuItemIds,
  })
  return {
    brands: Number(d.brands ?? 0),
    channelsLast: d.channelsLast == null ? null : Number(d.channelsLast),
    brandsHubrise: d.brandsHubrise == null ? null : Number(d.brandsHubrise),
  }
}

/** Agota o reactiva un producto en el local del dispositivo. */
export async function setProductAvailability(
  token: string,
  menuItemId: string,
  isAvailable: boolean,
  reason: string = 'manual',
  availableUntil?: string | null,
  reasonCode?: string | null,
): Promise<AvailabilityResult> {
  const d = await rpc<Record<string, unknown>>('set_product_availability_by_token', {
    p_device_token: token,
    p_menu_item_id: menuItemId,
    p_is_available: isAvailable,
    p_reason: reason,
    p_available_until: availableUntil ?? null,
    p_reason_code: reasonCode ?? null,
  })
  return {
    brands: Number(d.brands ?? 0),
    channels: Number(d.channels ?? 0),
    matriculas: Number(d.matriculas ?? 0),
  }
}

/**
 * Agota o reactiva VARIOS productos de una vez en el local del dispositivo,
 * con motivo/vencimiento ÚNICOS (ENCARGO 86). Un solo empuje a canales. Los
 * fallos individuales vienen en `failed` (nada de catch mudo).
 */
export async function setProductsAvailabilityBulk(
  token: string,
  menuItemIds: string[],
  isAvailable: boolean,
  reason: string = 'manual',
  availableUntil?: string | null,
  reasonCode?: string | null,
): Promise<BulkAvailabilityResult> {
  const d = await rpc<Record<string, unknown>>('set_products_availability_bulk_by_token', {
    p_device_token: token,
    p_menu_item_ids: menuItemIds,
    p_is_available: isAvailable,
    p_reason: reason,
    p_available_until: availableUntil ?? null,
    p_reason_code: reasonCode ?? null,
  })
  const failed = ((d.failed as Record<string, unknown>[]) ?? []).map((f) => ({
    menuItemId: f.menu_item_id as string,
    error: (f.error as string) ?? 'error desconocido',
  }))
  return {
    products: Number(d.products ?? 0),
    brands: Number(d.brands ?? 0),
    channels: Number(d.channels ?? 0),
    failed,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRAS (11/09/2026)
//
// Un extra es lo que el cliente añade aparte: una salsa, unas tiras de pollo.
// Hasta hoy sólo se podían agotar desde la oficina, y en cocina —que es quien
// se queda sin salsa de yogur a las nueve de la noche— no había forma.
//
// SE AGRUPAN POR NOMBRE, no por `external_id`. Medido en Foodint: 241 opciones,
// 210 con ref, y 210 refs distintas — es decir, la ref no agrupa nada. Pero 52
// de 126 nombres tienen más de una copia, y «Salsa Yogur» tiene TRECE. Agotar
// una sola dejaría las otras doce vendiéndose.
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtraSoldOutRow {
  clave: string
  name: string
  /** Una cualquiera del grupo CON referencia: el servidor resuelve el resto. */
  optionId: string | null
  /** Cuántas copias del extra hay en la cuenta, y cuántas están agotadas. */
  opciones: number
  agotadas: number
  marcas: number
  /** Copias SIN referencia de canal: no se pueden agotar en la plataforma. */
  sinRef: number
  reason: string
  availableUntil: string | null
  setAt: string | null
}

export interface ExtraPick {
  clave: string
  name: string
  /** Una cualquiera del grupo: el servidor agota TODAS las del mismo nombre. */
  optionId: string
  opciones: number
  marcas: number
  conRef: number
  sinRef: number
}

/** Extras agotados ahora mismo en el local del dispositivo. */
export async function listSoldOutExtras(token: string): Promise<ExtraSoldOutRow[]> {
  const data = await rpc<Record<string, unknown>[]>('extras_availability_panel_by_token', {
    p_device_token: token,
  })
  return (data ?? []).map((r) => ({
    clave: r.clave as string,
    name: (r.name as string) ?? '(extra)',
    optionId: (r.option_id as string) ?? null,
    opciones: Number(r.opciones ?? 0),
    agotadas: Number(r.agotadas ?? 0),
    marcas: Number(r.marcas ?? 0),
    sinRef: Number(r.sin_ref ?? 0),
    reason: (r.reason as string) ?? 'manual',
    availableUntil: (r.available_until as string) ?? null,
    setAt: (r.set_at as string) ?? null,
  }))
}

/** Busca extras de la carta, agrupados por nombre. */
export async function searchExtras(token: string, query: string): Promise<ExtraPick[]> {
  const term = query.trim()
  if (term.length < 2) return []
  const data = await rpc<Record<string, unknown>[]>('search_extras_by_token', {
    p_device_token: token, p_query: term,
  })
  return (data ?? []).map((r) => ({
    clave: r.clave as string,
    name: (r.name as string) ?? '(extra)',
    optionId: r.option_id as string,
    opciones: Number(r.opciones ?? 0),
    marcas: Number(r.marcas ?? 0),
    conRef: Number(r.con_ref ?? 0),
    sinRef: Number(r.sin_ref ?? 0),
  }))
}

export interface ExtraAvailabilityResult {
  /** Copias agotadas o reactivadas de verdad (las que tienen ref de canal). */
  opciones: number
  refs: number
  /** Copias que se quedan fuera por no tener ref. Se dice, no se esconde. */
  sinRef: number
  dispatched: boolean
}

/** Agota o reactiva un extra — y con él, todas sus copias del mismo nombre. */
export async function setExtraAvailability(
  token: string,
  optionId: string,
  isAvailable: boolean,
  reason: 'manual' | 'stock_out' = 'manual',
  availableUntil: string | null = null,
  reasonCode: string | null = null,
): Promise<ExtraAvailabilityResult> {
  const d = await rpc<Record<string, unknown>>('set_modifier_option_availability_by_token', {
    p_device_token: token,
    p_option_id: optionId,
    p_is_available: isAvailable,
    p_reason: reason,
    p_available_until: availableUntil,
    p_reason_code: reasonCode,
  })
  return {
    opciones: Number(d?.opciones ?? 0),
    refs: Number(d?.refs ?? 0),
    sinRef: Number(d?.sin_ref ?? 0),
    dispatched: d?.dispatched === true,
  }
}
