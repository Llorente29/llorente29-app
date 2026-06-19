// src/modules/orders/services/ordersFeedService.ts
//
// Servicio del FEED de pedidos (lente "por pedido").
//
// VÍA ÚNICA DE EMPUJE (Opción A): el front SOLO mueve el estado interno vía
// set_order_status. El empuje al canal lo dispara el trigger trg_sale_push_status.
//
// CICLO DE VIDA POR TIPO DE REPARTO (7a):
//   - platform (Glovo/Uber/JE): listo -> "Entregado al rider" -> cerrado.
//   - pickup: listo -> "Entregado al cliente" -> cerrado.
//   - own_delivery: listo -> "En reparto" -> "Completar". (7b: flota + métricas)
//
// MODIFICADORES (#6): cada hija trae group_type del catálogo (removal/extras/
// choice/side/cross_sell/info) o null si no casó. El front pinta por ese dato.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ── Tipos espejo del JSON de orders_feed ────────────────────────────────────

export type OrderStatus =
  | 'new' | 'received' | 'accepted' | 'in_preparation'
  | 'awaiting_collection' | 'awaiting_shipment' | 'in_delivery'
  | 'completed' | 'rejected' | 'cancelled' | 'delivery_failed'

/** Tipo de grupo de modificador del catálogo (verdad estructural). */
export type ModifierGroupType =
  | 'choice' | 'extras' | 'removal' | 'side' | 'cross_sell' | 'info'

export interface OrderFeedChild {
  line_id: string
  name: string
  qty: number
  line_type: string                          // 'combo_item' | 'modifier'
  group_type: ModifierGroupType | null       // null si no casó con el catálogo
  customer_note: string | null
}

export interface OrderFeedLine {
  line_id: string
  name: string
  qty: number
  menu_item_id: string | null
  unit_price: number | null
  line_total: number | null
  marked: boolean
  allergens: string[]
  family: string | null          // dish_family.name (categoría de cocina normalizada)
  family_color: string | null
  family_icon: string | null
  menu_category: string | null   // menu_item.category (texto libre de carta; hoy vacío)
  has_recipe: boolean
  customer_note: string | null
  children: OrderFeedChild[]
}

export interface OrderFeedItem {
  sale_id: string
  external_ref: string | null
  external_tab_ref: string | null
  order_status: OrderStatus
  status: string
  service_type: string | null
  source: string
  brand: string | null
  brand_logo_url: string | null
  brand_color: string | null
  brand_shop_url: string | null
  brand_qr_caption: string | null
  brand_ownership_type: 'own' | 'licensed' | null
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

// ── Tipo de reparto ─────────────────────────────────────────────────────────

const TERMINAL_SET: OrderStatus[] = ['completed', 'rejected', 'cancelled', 'delivery_failed']
export function isTerminalStatus(s: OrderStatus): boolean { return TERMINAL_SET.includes(s) }

function isPickup(serviceType: string | null): boolean {
  const t = (serviceType ?? '').toLowerCase()
  return t.includes('pickup') || t.includes('collection') || t.includes('takeaway')
}
function isPlatformDelivery(serviceType: string | null): boolean {
  return (serviceType ?? '').toLowerCase().includes('platform')
}

// ── Transiciones (la "ruta completa" del pedido) ────────────────────────────

export interface OrderAction { label: string; next: OrderStatus }

export function primaryAction(order: OrderFeedItem): OrderAction | null {
  const s = order.service_type
  switch (order.order_status) {
    case 'new':
    case 'received':
      return { label: 'Aceptar', next: 'accepted' }
    case 'accepted':
      return { label: 'Empezar', next: 'in_preparation' }
    case 'in_preparation':
      return (isPickup(s) || isPlatformDelivery(s))
        ? { label: 'Marcar listo', next: 'awaiting_collection' }
        : { label: 'Marcar listo', next: 'in_delivery' }
    case 'awaiting_collection':
    case 'awaiting_shipment':
      return {
        label: isPlatformDelivery(s) ? 'Entregado al rider'
             : isPickup(s)            ? 'Entregado al cliente'
             :                          'Completar',
        next: 'completed',
      }
    case 'in_delivery':
      return { label: 'Completar', next: 'completed' }
    default:
      return null
  }
}

export function secondaryAction(order: OrderFeedItem): OrderAction | null {
  if (isTerminalStatus(order.order_status)) {
    return { label: 'Reabrir', next: 'in_preparation' }
  }
  if (order.order_status === 'new' || order.order_status === 'received') {
    return { label: 'Rechazar', next: 'rejected' }
  }
  return { label: 'Cancelar', next: 'cancelled' }
}

// ── Modificadores: cómo pintar una hija (#6) ────────────────────────────────

export type ChildTone = 'remove' | 'add' | 'neutral'
export interface ChildVisual { tone: ChildTone; confirmed: boolean }

const LOOKS_REMOVE = /^\s*(sin|no|quitar|without|sans)\b/i

/**
 * Decide cómo pintar una hija combinando el dato del catálogo (group_type, fiable)
 * con el texto como desempate/red de seguridad. confirmed=false => inferido.
 */
export function childVisual(child: OrderFeedChild): ChildVisual {
  if (child.line_type === 'combo_item') return { tone: 'neutral', confirmed: true }
  const looksRemove = LOOKS_REMOVE.test(child.name)
  switch (child.group_type) {
    case 'removal': return { tone: 'remove', confirmed: true }
    case 'extras':  return { tone: 'add', confirmed: true }
    case 'choice':
    case 'side':
      // elección del plato; si el texto dice "sin", es un quitar mal clasificado
      return looksRemove ? { tone: 'remove', confirmed: false } : { tone: 'neutral', confirmed: true }
    case 'cross_sell':
    case 'info':
      return { tone: 'neutral', confirmed: true }
    default:
      // no casó con el catálogo: heurística por texto, sin confirmar
      return looksRemove ? { tone: 'remove', confirmed: false } : { tone: 'add', confirmed: false }
  }
}

// ── Llamadas a las RPC ──────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export async function getOrdersFeed(locationId: string): Promise<OrdersFeedResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('orders_feed', { p_location_id: locationId })
  if (error) throw new Error(`Orders · orders_feed: ${error.message}`)
  return data as unknown as OrdersFeedResult
}

export async function advanceOrder(saleId: string, newStatus: OrderStatus): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.rpc('set_order_status', {
    p_sale_id: saleId,
    p_new_status: newStatus,
  })
  if (error) throw new Error(`Orders · set_order_status: ${error.message}`)
}
