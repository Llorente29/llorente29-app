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
  menu_item_id: string | null                // los combo_item casados lo traen
  family: string | null                      // familia del componente (para separar bebidas)
  family_color: string | null
  menu_category: string | null
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
  platform_order_code: string | null   // nº REAL de la plataforma (Glovo/Uber/JE); protagonista del ticket
  pos_short_code: string | null         // corto interno de Last (G931/U382/J076); referencia, null si no entró por Last
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
  // ── Reparto (fila plegable). Sólo con contenido cuando hay transportista propio. ──
  dispatch_mode: string | null          // 'auto' | 'manual' | null
  carrier_code: string | null           // 'catcher' | 'jelp' | … ; null = sin transportista propio
  delivery_state: string | null         // estado que reporta el broker (created/assigned/picked_up/delivered…)
  rider_name: string | null
  rider_phone: string | null
  eta_pickup: string | null
  eta_delivery: string | null
  transport_price: number | null
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

// ── Fila de reparto de la tarjeta ───────────────────────────────────────────
//
// Decide qué enseñar según QUIÉN reparte (no según el canal de venta):
//   - carrier propio (Catcher/Jelp) → fila completa (broker · estado · rider · tel),
//     venga el pedido de Glovo/Uber/JE/Shop.
//   - delivery de plataforma sin carrier propio → "Lo lleva {plataforma}", sin rider.
//   - recogida u otros → sin fila.

export type DeliveryRowKind = 'own' | 'platform' | 'none'
export type DeliveryTone = 'pending' | 'active' | 'done'

export interface DeliveryView {
  kind: DeliveryRowKind
  carrierLabel: string | null
  stateLabel: string | null
  stateTone: DeliveryTone
  rider: string | null
  phone: string | null
  etaText: string | null
  supportPhone: string | null   // soporte de la plataforma (Glovo/Uber/JE), sólo en kind='platform'
}

// Soporte de repartidores por plataforma (España). Fijos; si cambian, editar aquí
// (o migrar a tabla platform_support cuando se quiera editar sin desplegar).
const PLATFORM_SUPPORT: { match: RegExp; phone: string }[] = [
  { match: /glovo/i,                phone: '931 22 72 62' },
  { match: /uber/i,                 phone: '911 23 21 86' },
  { match: /just\s*eat|justeat|je\b/i, phone: '910 50 73 94' },
]
function supportPhoneFor(channel: string | null): string | null {
  if (!channel) return null
  return PLATFORM_SUPPORT.find(p => p.match.test(channel))?.phone ?? null
}

const CARRIER_LABEL: Record<string, string> = {
  catcher: 'Catcher', jelp: 'Jelp', jelp_delivery: 'Jelp',
}
function carrierPretty(code: string): string {
  return CARRIER_LABEL[code.toLowerCase()] ?? (code.charAt(0).toUpperCase() + code.slice(1))
}

const DELIVERY_STATE: Record<string, { label: string; tone: DeliveryTone }> = {
  created:    { label: 'Buscando repartidor', tone: 'pending' },
  pending:    { label: 'Buscando repartidor', tone: 'pending' },
  searching:  { label: 'Buscando repartidor', tone: 'pending' },
  assigned:   { label: 'Repartidor asignado', tone: 'active' },
  accepted:   { label: 'Repartidor asignado', tone: 'active' },
  picked_up:  { label: 'En camino', tone: 'active' },
  in_delivery:{ label: 'En camino', tone: 'active' },
  on_the_way: { label: 'En camino', tone: 'active' },
  delivered:  { label: 'Entregado', tone: 'done' },
  completed:  { label: 'Entregado', tone: 'done' },
  cancelled:  { label: 'Cancelado', tone: 'pending' },
  failed:     { label: 'Entrega fallida', tone: 'pending' },
}
function stateView(state: string | null): { label: string; tone: DeliveryTone } {
  if (!state) return { label: 'Reparto propio', tone: 'active' }
  return DELIVERY_STATE[state.toLowerCase()] ?? { label: state, tone: 'active' }
}

function etaText(iso: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (isNaN(ms)) return null
  const min = Math.round(ms / 60000)
  if (min <= 0) return 'Llegando'
  return `~${min} min`
}

export function deliveryView(order: OrderFeedItem): DeliveryView {
  if (order.carrier_code) {
    const st = stateView(order.delivery_state)
    return {
      kind: 'own',
      carrierLabel: carrierPretty(order.carrier_code),
      stateLabel: st.label, stateTone: st.tone,
      rider: order.rider_name, phone: order.rider_phone,
      etaText: etaText(order.eta_delivery),
      supportPhone: null,
    }
  }
  if (isPlatformDelivery(order.service_type)) {
    return {
      kind: 'platform',
      carrierLabel: order.channel ?? 'la plataforma',
      stateLabel: null, stateTone: 'active',
      rider: null, phone: null, etaText: null,
      supportPhone: supportPhoneFor(order.channel),
    }
  }
  return { kind: 'none', carrierLabel: null, stateLabel: null, stateTone: 'active', rider: null, phone: null, etaText: null, supportPhone: null }
}

// ── Llamadas a las RPC ──────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export async function getOrdersFeed(
  locationId: string,
  token?: string | null,
): Promise<OrdersFeedResult> {
  requireSupabase()
  // Con token (Estación de Tablet, sin sesión) → RPC by-token; el local sale del
  // dispositivo y se ignora locationId. Sin token → RPC de sesión.
  const { data, error } = token
    ? await (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
        => Promise<{ data: unknown; error: { message: string } | null }>)(
        'orders_feed_by_token', { p_device_token: token })
    : await supabase!.rpc('orders_feed', { p_location_id: locationId })
  if (error) throw new Error(`Orders · orders_feed: ${error.message}`)
  return data as unknown as OrdersFeedResult
}

export async function advanceOrder(
  saleId: string,
  newStatus: OrderStatus,
  token?: string | null,
): Promise<void> {
  requireSupabase()
  const { error } = token
    ? await (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
        => Promise<{ error: { message: string } | null }>)(
        'set_order_status_by_token',
        { p_device_token: token, p_sale_id: saleId, p_new_status: newStatus })
    : await supabase!.rpc('set_order_status', { p_sale_id: saleId, p_new_status: newStatus })
  if (error) throw new Error(`Orders · set_order_status: ${error.message}`)
}
