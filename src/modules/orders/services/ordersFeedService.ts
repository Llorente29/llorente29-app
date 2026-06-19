// src/modules/orders/services/ordersFeedService.ts
//
// Servicio del FEED de pedidos (lente "por pedido"). Llama a la RPC orders_feed
// (ya tipada en database.ts) y expone tipos espejo del JSON que devuelve.
//
// Avance del pedido (ruta completa): advanceOrder llama a la Edge order-advance,
// que mueve el estado interno + empuja al canal (Last) cuando procede. setOrderStatus
// (RPC directa) queda como utilidad de bajo nivel (la Edge la usa por dentro).
//
// Agnóstico de canal: la RPC ya entrega campos canónicos; este servicio no sabe
// de HubRise/Otter/Last.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ── Tipos espejo del JSON de orders_feed ────────────────────────────────────

/** Estado de plataforma del pedido (CHECK de sale.order_status). */
export type OrderStatus =
  | 'new' | 'received' | 'accepted' | 'in_preparation'
  | 'awaiting_collection' | 'awaiting_shipment' | 'in_delivery'
  | 'completed' | 'rejected' | 'cancelled' | 'delivery_failed'

/** Línea hija: componente de combo o modificador. */
export interface OrderFeedChild {
  line_id: string
  name: string
  qty: number
  line_type: string          // 'combo_item' | 'modifier'
  customer_note: string | null
}

/** Línea padre (producto visible en la tarjeta). */
export interface OrderFeedLine {
  line_id: string
  name: string
  qty: number
  menu_item_id: string | null
  unit_price: number | null
  line_total: number | null
  marked: boolean
  allergens: string[]
  has_recipe: boolean
  customer_note: string | null
  children: OrderFeedChild[]
}

/** Un pedido del feed. */
export interface OrderFeedItem {
  sale_id: string
  external_ref: string | null
  external_tab_ref: string | null
  order_status: OrderStatus
  status: string
  service_type: string | null
  source: string
  brand: string | null
  channel: string | null
  channel_id: string | null
  customer_name: string | null
  customer_phone: string | null
  delivery_address: string | null
  expected_time: string | null
  customer_note: string | null
  total: number
  paid: number | null
  payment_method: string | null
  discount_amount: number | null
  delivery_cost: number | null
  entro_at: string
  minutos: number
  lineas: OrderFeedLine[]
}

export interface OrdersFeedResult {
  location_id: string
  now: string
  orders: OrderFeedItem[]
}

// ── Transiciones (la "ruta completa" del pedido) ────────────────────────────

const TERMINAL_SET: OrderStatus[] = ['completed', 'rejected', 'cancelled', 'delivery_failed']
export function isTerminalStatus(s: OrderStatus): boolean { return TERMINAL_SET.includes(s) }

function isPickup(serviceType: string | null): boolean {
  const t = (serviceType ?? '').toLowerCase()
  return t.includes('collection') || t.includes('pickup') || t.includes('takeaway')
}

export interface OrderAction { label: string; next: OrderStatus }

/** Acción PRIMARIA de avance según el estado actual. null si es terminal. */
export function primaryAction(order: OrderFeedItem): OrderAction | null {
  switch (order.order_status) {
    case 'new':
    case 'received':
      return { label: 'Aceptar', next: 'accepted' }
    case 'accepted':
      return { label: 'Empezar', next: 'in_preparation' }
    case 'in_preparation':
      return isPickup(order.service_type)
        ? { label: 'Marcar listo', next: 'awaiting_collection' }
        : { label: 'Marcar listo', next: 'in_delivery' }
    case 'awaiting_collection':
    case 'awaiting_shipment':
    case 'in_delivery':
      return { label: 'Completar', next: 'completed' }
    default:
      return null
  }
}

/** Acción SECUNDARIA: cancelar (activos) o reabrir (terminales). */
export function secondaryAction(order: OrderFeedItem): OrderAction | null {
  if (isTerminalStatus(order.order_status)) {
    return { label: 'Reabrir', next: 'in_preparation' }
  }
  if (order.order_status === 'new' || order.order_status === 'received') {
    return { label: 'Rechazar', next: 'rejected' }
  }
  return { label: 'Cancelar', next: 'cancelled' }
}

// ── Resultado del avance (incluye el empuje al canal) ───────────────────────

export interface AdvanceResult {
  ok: boolean
  internal_status?: string
  push?: { attempted: boolean; ok: boolean; reason?: string }
  error?: string
}

// ── Llamadas a las RPC / Edge ───────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

/** Trae el feed de pedidos de un local. */
export async function getOrdersFeed(locationId: string): Promise<OrdersFeedResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('orders_feed', { p_location_id: locationId })
  if (error) throw new Error(`Orders · orders_feed: ${error.message}`)
  return data as unknown as OrdersFeedResult
}

/** RPC directa de bajo nivel: solo mueve el estado interno (sin empuje). */
export async function setOrderStatus(saleId: string, newStatus: OrderStatus): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_order_status', {
    p_sale_id: saleId,
    p_new_status: newStatus,
  })
  if (error) throw new Error(`Orders · set_order_status: ${error.message}`)
}

/** Avanza el pedido (ruta completa): estado interno + empuje al canal (Last). */
export async function advanceOrder(saleId: string, newStatus: OrderStatus): Promise<AdvanceResult> {
  requireSupabase()
  const { data, error } = await supabase!.functions.invoke('order-advance', {
    body: { sale_id: saleId, new_status: newStatus },
  })
  if (error) throw new Error(`Orders · order-advance: ${error.message}`)
  return data as AdvanceResult
}
