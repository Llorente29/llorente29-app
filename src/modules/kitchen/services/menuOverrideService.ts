// src/modules/kitchen/services/menuOverrideService.ts
//
// FRENTE OVERRIDES — servicio. Habla con el motor SQL menu_item_channel_economics
// (fuente única de verdad del margen por canal) y con set/clear_menu_item_override.
//
// · getMenuItemChannelEconomics(itemId, preview?) — una fila por canal con precio
//   efectivo (preview > override > base) y márgenes. Con `preview` ({canal: precio})
//   el servidor recalcula el margen AL TECLEAR sin reimplementar la fórmula en cliente.
// · listMenuItemOverrides(itemId) — overrides guardados (nivel marca/canal, sin local).
// · setMenuItemOverride / clearMenuItemOverride — escritura (RPC SECURITY DEFINER).
//
// Patrón del proyecto: supabase directo, mappers row->domain, requireSupabase().

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

export type PriceSource = 'preview' | 'override' | 'base'
export type FoodCostStatus = 'under' | 'over' | 'no_cost' | 'no_target'

/** Una fila por canal del motor menu_item_channel_economics. */
export interface ChannelEconomics {
  channelId: string
  channelName: string
  channelType: string | null
  serviceType: string | null
  price: number               // precio efectivo SIN IVA
  priceSource: PriceSource
  isAvailable: boolean        // 86 manual (override); true si no hay override
  vatRate: number
  priceWithVat: number        // PVP cliente
  cost: number | null         // escandallo
  costAvailable: boolean
  commissionPct: number | null
  commissionBase: string | null
  commissionAmount: number | null   // por plato
  commissionFixed: number | null    // por pedido (bruto)
  ownCourierCost: number | null     // por pedido (bruto)
  ownCustomerFee: number | null     // por pedido (bruto)
  orderCostsPerItem: number         // estimación diluida (solo own_delivery)
  contributionMargin: number | null // EXACTO: precio − coste − comisión%
  contributionMarginPct: number | null
  netMargin: number | null          // contribution − costes de pedido diluidos
  netMarginPct: number | null
  foodCostPct: number | null
  targetFoodCostPct: number | null
  foodCostStatus: FoodCostStatus
}

/** Override guardado de un producto (nivel marca/canal, sin local en esta capa). */
export interface MenuItemOverride {
  channelId: string | null
  price: number | null        // null = hereda el precio base
  isAvailable: boolean
}

export interface SetOverrideInput {
  menuItemId: string
  channelId: string
  price?: number | null       // omitir / null = hereda base (permite 86 sin tocar precio)
  isAvailable?: boolean        // default true
  locationId?: string | null   // null = todos los locales (capa actual)
}

export interface ClearOverrideInput {
  menuItemId: string
  channelId: string
  locationId?: string | null
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v)
}

function rowToChannelEconomics(r: Record<string, unknown>): ChannelEconomics {
  return {
    channelId: r.channel_id as string,
    channelName: r.channel_name as string,
    channelType: (r.channel_type as string) ?? null,
    serviceType: (r.service_type as string) ?? null,
    price: Number(r.price ?? 0),
    priceSource: (r.price_source as PriceSource) ?? 'base',
    isAvailable: r.is_available !== false,
    vatRate: Number(r.vat_rate ?? 0),
    priceWithVat: Number(r.price_with_vat ?? 0),
    cost: num(r.cost),
    costAvailable: r.cost_available === true,
    commissionPct: num(r.commission_pct),
    commissionBase: (r.commission_base as string) ?? null,
    commissionAmount: num(r.commission_amount),
    commissionFixed: num(r.commission_fixed),
    ownCourierCost: num(r.own_courier_cost),
    ownCustomerFee: num(r.own_customer_fee),
    orderCostsPerItem: Number(r.order_costs_per_item ?? 0),
    contributionMargin: num(r.contribution_margin),
    contributionMarginPct: num(r.contribution_margin_pct),
    netMargin: num(r.net_margin),
    netMarginPct: num(r.net_margin_pct),
    foodCostPct: num(r.food_cost_pct),
    targetFoodCostPct: num(r.target_food_cost_pct),
    foodCostStatus: (r.food_cost_status as FoodCostStatus) ?? 'no_cost',
  }
}

/**
 * Economía por canal de un producto. `preview` ({channelId: precioSinIva}) hace que
 * el servidor recalcule el margen con los precios tecleados, sin guardarlos.
 */
export async function getMenuItemChannelEconomics(
  menuItemId: string,
  preview?: Record<string, number> | null
): Promise<ChannelEconomics[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('menu_item_channel_economics', {
    p_menu_item_id: menuItemId,
    p_overrides: preview && Object.keys(preview).length > 0 ? preview : null,
  })
  if (error) throw new Error(`Error calculando economía por canal: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(rowToChannelEconomics)
}

/** Overrides guardados del producto a nivel marca/canal (location_id null). */
export async function listMenuItemOverrides(menuItemId: string): Promise<MenuItemOverride[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('menu_item_override')
    .select('channel_id, price, is_available')
    .eq('menu_item_id', menuItemId)
    .is('location_id', null)
  if (error) throw new Error(`Error listando overrides: ${error.message}`)
  return (data ?? []).map((o) => ({
    channelId: (o.channel_id as string) ?? null,
    price: o.price === null || o.price === undefined ? null : Number(o.price),
    isAvailable: o.is_available !== false,
  }))
}

/** Fija precio (o lo hereda con null) y disponibilidad (86) de un producto en un canal. */
export async function setMenuItemOverride(input: SetOverrideInput): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_menu_item_override', {
    p_menu_item_id: input.menuItemId,
    p_channel_id: input.channelId,
    p_price: input.price ?? undefined,        // undefined → la RPC aplica su default null
    p_is_available: input.isAvailable ?? true,
    p_location_id: input.locationId ?? undefined,
  })
  if (error) throw new Error(`Error guardando precio del canal: ${error.message}`)
}

/** Elimina el override (vuelve al precio base y disponible). */
export async function clearMenuItemOverride(input: ClearOverrideInput): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('clear_menu_item_override', {
    p_menu_item_id: input.menuItemId,
    p_channel_id: input.channelId,
    p_location_id: input.locationId ?? undefined,
  })
  if (error) throw new Error(`Error limpiando el override del canal: ${error.message}`)
}

// ─── 86 / DISPONIBILIDAD (producto físico, cascada cross-brand) ───────────────

export type AvailabilityReason = 'manual' | 'stock_out' | 'schedule'

/** Alcance real devuelto por set_product_availability (para el "se agota en N marcas"). */
export interface ProductAvailabilityResult {
  affectedItems: number   // fichas (menu_item) afectadas en todas las marcas
  brands: number          // marcas distintas
  channels: number        // canales (catálogos) donde se empujará
  matriculas: number      // matrículas distintas tocadas
}

/**
 * Marca un producto disponible / agotado (86). El servidor cascadea CROSS-BRAND:
 * afecta a todas las marcas que comparten el producto físico (mismo escandallo o
 * misma matrícula) y dispara el empuje a los canales (Last hoy; HubRise/Otter
 * mañana). `reason` deja entrar auto-86 sin cambiar la firma; `availableUntil`
 * es el timer (Fase 2). Devuelve el alcance real.
 */
export async function setProductAvailability(
  menuItemId: string,
  isAvailable: boolean,
  reason: AvailabilityReason = 'manual',
  availableUntil?: string | null,
): Promise<ProductAvailabilityResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('set_product_availability', {
    p_menu_item_id: menuItemId,
    p_is_available: isAvailable,
    p_reason: reason,
    p_available_until: availableUntil ?? undefined,
  })
  if (error) throw new Error(`Error cambiando disponibilidad: ${error.message}`)
  const r = (data ?? {}) as Record<string, unknown>
  return {
    affectedItems: Number(r.affected_items ?? 0),
    brands: Number(r.brands ?? 0),
    channels: Number(r.channels ?? 0),
    matriculas: Number(r.matriculas ?? 0),
  }
}

export { ZERO_UUID }
