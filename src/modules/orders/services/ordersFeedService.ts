// src/modules/orders/services/ordersFeedService.ts
//
// Servicio del FEED de pedidos (lente "por pedido"). Llama a la RPC orders_feed
// (ya tipada en database.ts) y expone tipos espejo del JSON que devuelve.
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

// ── Llamada a la RPC ────────────────────────────────────────────────────────

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
