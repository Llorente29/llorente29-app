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
  // Referencia LARGA de la plataforma (HubRise: order.ref). En Glovo es el nº de
  // 12 dígitos con el que se RECLAMA; en Just Eat coincide con
  // platform_order_code y en Uber es un uuid, así que no siempre se imprime:
  // decide passCode.ts por la forma del dato. null en lo entrado por Last.app,
  // donde platform_order_code YA era ese número largo.
  platform_order_ref: string | null
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
  dispatch_error: string | null         // motivo del último fallo de despacho (null = sin fallo)
  // ── Rider de Catcher (webhook catcher-webhook; poblados en sale). ──
  rider_transport_type: string | null   // 'moto' | 'bici' | 'coche'… → icono + etiqueta
  rider_seen_at: string | null          // cuándo se vio esa posición/estado → "visto a las HH:MM"
  has_courier: boolean | null           // ¿hay repartidor asignado?
  rider_lat: number | null              // última posición (no streaming); de momento no se pinta
  rider_lng: number | null
  // ── Hitos de tiempo (KPI de cocina + reparto). Todos los devuelve el feed. ──
  accepted_at: string | null            // autoaceptación (INSERT): arranca el reloj de cocina
  ready_at: string | null               // "Listo" (fin de cocina); fallback de inicio del reparto si no hubo handoff
  handed_to_courier_at: string | null   // sellado al pasar delivery_state a in_delivery (Catcher casi nunca lo manda)
  delivered_at: string | null           // sellado por trg_sale_seal_delivered al delivery_state 'delivered'/'finish'
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
//
// PROMINENCIA POR ESTADO (operativa de cocina): la fila sube de intensidad según
// la urgencia real del momento. `phase` la calcula el servicio en UN solo sitio a
// partir de delivery_state; el componente solo la pinta.
//   searching  → discreto (aún no hay nada que hacer).
//   assigned   → nombre del rider + llamar A LA VISTA (sin desplegar).
//   enroute    → ídem, con estado "En camino".
//   at_pickup  → ★ REPARTIDOR EN EL LOCAL: handoff, resaltado (+ sonido opcional).
//   delivered  → se apaga a check verde.
//   failed / canceled / unknown → rojo / gris / fallback.

export type DeliveryRowKind = 'own' | 'platform' | 'none'
export type DeliveryTone = 'pending' | 'active' | 'done' | 'failed' | 'canceled'
export type DeliveryPhase =
  | 'searching' | 'assigned' | 'enroute' | 'at_pickup'
  | 'delivered' | 'failed' | 'canceled' | 'unknown'

export interface DeliveryView {
  kind: DeliveryRowKind
  phase: DeliveryPhase           // fase operativa derivada de delivery_state (prominencia)
  carrierLabel: string | null
  stateLabel: string | null
  stateTone: DeliveryTone
  rider: string | null
  phone: string | null
  etaText: string | null
  transport: string | null      // rider_transport_type (icono + etiqueta en el front)
  seenText: string | null       // "visto a las HH:MM" (Europe/Madrid) desde rider_seen_at
  hasCourier: boolean           // ¿hay repartidor asignado? (has_courier o rider_name)
  // TIEMPO DE REPARTO (el coste va FUERA de la tarjeta, decisión de Julio 24/07).
  deliveryDurationMin: number | null        // delivered_at − coalesce(handed_to_courier_at, ready_at), en min
  deliveryBasis: 'handoff' | 'listo' | null // 'handoff' = reparto puro · 'listo' = medido desde "Listo" (etiquetar)
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
  // Estados NORMALIZADOS de Catcher (docs/catcher_webhook_contrato.md).
  matching:            { label: 'Buscando repartidor', tone: 'pending' },
  matched:             { label: 'Repartidor asignado', tone: 'active' },
  picking:             { label: 'Recogiendo en local', tone: 'active' },
  in_picking_location: { label: 'Repartidor en el local', tone: 'active' },
  in_delivery:         { label: 'En camino', tone: 'active' },
  delivered:           { label: 'Entregado', tone: 'done' },
  failed:              { label: 'No entregado', tone: 'failed' },
  canceled:            { label: 'Cancelado', tone: 'canceled' },
  // Sinónimos/estados heredados de otros brokers (se conservan por robustez).
  created:    { label: 'Buscando repartidor', tone: 'pending' },
  pending:    { label: 'Buscando repartidor', tone: 'pending' },
  searching:  { label: 'Buscando repartidor', tone: 'pending' },
  assigned:   { label: 'Repartidor asignado', tone: 'active' },
  accepted:   { label: 'Repartidor asignado', tone: 'active' },
  picked_up:  { label: 'En camino', tone: 'active' },
  on_the_way: { label: 'En camino', tone: 'active' },
  completed:  { label: 'Entregado', tone: 'done' },
  cancelled:  { label: 'Cancelado', tone: 'canceled' },
}
function stateView(state: string | null): { label: string; tone: DeliveryTone } {
  if (!state) return { label: 'Reparto propio', tone: 'active' }
  return DELIVERY_STATE[state.toLowerCase()] ?? { label: state, tone: 'active' }
}

// Fase operativa a partir del estado normalizado del broker. Gobierna la
// prominencia de la fila (ver arriba). El handoff (`at_pickup`) es el único
// estado que "grita": el rider está EN el local esperando la bolsa.
//   NOTA: 'picking' = va de camino al local (aún no ha llegado) → enroute;
//         'in_picking_location' = ya está en el local → at_pickup (el grito).
//   Si en producción Catcher no emite in_picking_location, se remapea 'picking'
//   a at_pickup con el dato del primer despacho real (deuda-0, ver guion).
const PHASE_BY_STATE: Record<string, DeliveryPhase> = {
  matching: 'searching', created: 'searching', pending: 'searching', searching: 'searching',
  matched: 'assigned', assigned: 'assigned', accepted: 'assigned',
  picking: 'enroute', picked_up: 'enroute', on_the_way: 'enroute', in_delivery: 'enroute',
  in_picking_location: 'at_pickup',
  delivered: 'delivered', completed: 'delivered',
  failed: 'failed',
  canceled: 'canceled', cancelled: 'canceled',
}
function deliveryPhase(state: string | null, hasCourier: boolean): DeliveryPhase {
  if (!state) return hasCourier ? 'assigned' : 'unknown'
  return PHASE_BY_STATE[state.toLowerCase()] ?? (hasCourier ? 'assigned' : 'unknown')
}

// "visto a las HH:MM" (hora local Europe/Madrid) desde rider_seen_at. null si no hay.
function seenText(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const hhmm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
  return `visto a las ${hhmm}`
}

function etaText(iso: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (isNaN(ms)) return null
  const min = Math.round(ms / 60000)
  if (min <= 0) return 'Llegando'
  return `~${min} min`
}

// Tiempo de REPARTO: delivered_at − coalesce(handed_to_courier_at, ready_at), en minutos.
// `basis` distingue el reparto PURO (desde el handoff al rider) del medido desde "Listo":
// handed_to_courier_at casi nunca se sella (Catcher manda in_delivery ~1/454), así que en la
// práctica se mide desde ready_at y HAY QUE ETIQUETARLO, no venderlo como reparto puro.
// null si aún no hay entrega sellada (delivered_at) o falta el inicio.
function deliveryDuration(order: OrderFeedItem): { min: number | null; basis: 'handoff' | 'listo' | null } {
  if (!order.delivered_at) return { min: null, basis: null }
  const startIso = order.handed_to_courier_at ?? order.ready_at
  if (!startIso) return { min: null, basis: null }
  const ms = new Date(order.delivered_at).getTime() - new Date(startIso).getTime()
  if (isNaN(ms) || ms < 0) return { min: null, basis: null }
  return { min: Math.round(ms / 60000), basis: order.handed_to_courier_at ? 'handoff' : 'listo' }
}

export function deliveryView(order: OrderFeedItem): DeliveryView {
  if (order.carrier_code) {
    const st = stateView(order.delivery_state)
    const hasCourier = order.has_courier === true || !!order.rider_name
    const dur = deliveryDuration(order)
    return {
      kind: 'own',
      phase: deliveryPhase(order.delivery_state, hasCourier),
      carrierLabel: carrierPretty(order.carrier_code),
      stateLabel: st.label, stateTone: st.tone,
      rider: order.rider_name, phone: order.rider_phone,
      etaText: etaText(order.eta_delivery),
      transport: order.rider_transport_type ?? null,
      seenText: seenText(order.rider_seen_at),
      hasCourier,
      deliveryDurationMin: dur.min,
      deliveryBasis: dur.basis,
      supportPhone: null,
    }
  }
  if (isPlatformDelivery(order.service_type)) {
    return {
      kind: 'platform',
      phase: 'unknown',
      carrierLabel: order.channel ?? 'la plataforma',
      stateLabel: null, stateTone: 'active',
      rider: null, phone: null, etaText: null,
      transport: null, seenText: null, hasCourier: false,
      deliveryDurationMin: null, deliveryBasis: null,
      supportPhone: supportPhoneFor(order.channel),
    }
  }
  return { kind: 'none', phase: 'unknown', carrierLabel: null, stateLabel: null, stateTone: 'active', rider: null, phone: null, etaText: null, transport: null, seenText: null, hasCourier: false, deliveryDurationMin: null, deliveryBasis: null, supportPhone: null }
}

// ¿Es un pedido de reparto propio pendiente de despachar (modo manual o tras fallo)?
// Sirve para decidir si la fila muestra el botón "Despachar / Reintentar".
export function isOwnDeliveryUndispatched(order: OrderFeedItem): boolean {
  return (order.service_type === 'own_delivery') && !order.carrier_code
}

// ── B68 §1/§2 (05/09/2026) ──────────────────────────────────────────────────
// Cuando la plataforma NO manda la direccion, dos cosas que antes no habia.

/**
 * El portal de la plataforma, para que quien lee el cartel sepa adonde ir.
 *
 * NO se enlaza al pedido concreto: no tengo un patron de enlace profundo
 * verificado para ninguna de las tres, y mandar a alguien a una URL inventada a
 * las dos de la manana es peor que no poner boton. Se enlaza a la pantalla de
 * pedidos y ya.
 *
 * ⚠️ ESTAS TRES URLS ESTAN SIN CONFIRMAR. Las usa Julio a diario; si alguna no
 * es, se corrige aqui y es una linea. Un canal sin URL NO ensena boton, a
 * proposito: mejor sin boton que con uno que lleva donde no es.
 */
/**
 * Portales de plataforma con URL CONFIRMADA.
 *
 * Solo entra aqui lo que alguien ha abierto y ha visto funcionar. En la primera
 * version puse las tres de memoria y una de ellas, `managerportal.glovoapp.com`,
 * NO EXISTE: habria mandado al repartidor a una pared justo cuando le corre
 * prisa. La de Glovo la verifico Julio el 05/09.
 *
 * Uber Eats y Just Eat estan fuera A PROPOSITO mientras nadie confirme su URL.
 * Para esos canales no sale boton -- mejor nada que un enlace roto, que ademas
 * ensena al operario a no fiarse del boton (misma familia que la regla 7: si no
 * puedes decir la verdad, no digas nada, pero no digas una mentira comoda).
 *
 * Anadir un canal = anadir su fila, con la URL comprobada, no recordada.
 */
const PORTAL_PLATAFORMA: { match: RegExp; url: string; nombre: string }[] = [
  { match: /glovo/i, url: 'https://portal.glovoapp.com/dashboard', nombre: 'Glovo' },
]

/**
 * Devuelve el portal del canal, o `null` si para ese canal no tenemos URL.
 * Quien llama solo distingue «hay portal / no lo hay»: no conoce la lista.
 */
export function portalDeLaPlataforma(channel: string | null): { url: string; nombre: string } | null {
  if (!channel) return null
  const p = PORTAL_PLATAFORMA.find(x => x.match.test(channel))
  return p ? { url: p.url, nombre: p.nombre } : null
}

/** Lo que devuelve `sale_coordenadas_de_entrega`. `hay:false` trae el motivo. */
export type CoordenadasEntrega =
  | { hay: true; lat: number; lng: number; origen: 'delivery' | 'customer'; aproximada: true; tiene_direccion_postal: boolean }
  | { hay: false; motivo: string }

/**
 * Coordenadas de entrega de un pedido cuya plataforma no mando direccion.
 *
 * Funcion APARTE y no un campo mas del feed: `orders_feed` alimenta tambien las
 * tablets del pase, y esto se pregunta solo para los pedidos que lo necesitan
 * -- 26 en 30 dias, no uno por pantalla.
 */
export async function coordenadasDeEntrega(saleId: string): Promise<CoordenadasEntrega> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
    => Promise<{ data: unknown; error: { message: string } | null }>)(
      'sale_coordenadas_de_entrega', { p_sale_id: saleId })
  if (error) throw new Error(error.message)
  return data as CoordenadasEntrega
}

// Despacha un pedido a Catcher (invocación manual desde la tarjeta). Reusa la Edge
// catcher-dispatch: acepta { sale_id } con JWT de usuario (sin secret interno) y es
// idempotente. Lanza Error con el motivo si falla.
/**
 * Lo que dice el resolutor sobre un pedido. `carrier` null = NO se despacha, y
 * `reason` explica por qué en castellano.
 */
export async function resolveDispatch(saleId: string): Promise<{ carrier: string | null; reason: string }> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
    => Promise<{ data: unknown; error: { message: string } | null }>)('resolve_dispatch', { p_sale_id: saleId })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as { carrier?: string | null; reason?: string } | null
  return { carrier: row?.carrier ?? null, reason: row?.reason ?? 'sin motivo del resolutor' }
}

/**
 * Despacha un pedido, PASANDO POR EL MISMO GUARD que el despacho automático.
 *
 * ENCARGO CODE (31/08 noche), punto 3 del reparto de Julio. Antes esto llamaba
 * a `catcher-dispatch` DIRECTO, esquivando `resolve_dispatch` entero: ni
 * interruptor de marca, ni dirección. Era el único de los cuatro caminos que
 * podía despachar un pedido que el resolutor había rechazado — y el botón está
 * justo en la pantalla donde aparecen los pedidos mal clasificados, que es
 * donde más fácil es pulsarlo por error.
 *
 * Ahora se pregunta primero. Si el resolutor dice que no, NO se invoca a
 * Catcher y se devuelve su motivo tal cual: «sin dirección: este pedido no lo
 * repartimos nosotros», «marca sin reparto propio (interruptor apagado)». El
 * motivo lo escribe el resolutor, no esta función: si algún día cambia la
 * regla, el mensaje cambia con ella y no hay dos textos que mantener.
 */
export async function dispatchOrder(saleId: string): Promise<void> {
  requireSupabase()
  const { carrier, reason } = await resolveDispatch(saleId)
  if (!carrier) throw new Error(reason)
  const { data, error } = await supabase!.functions.invoke('catcher-dispatch', { body: { sale_id: saleId } })
  if (error) throw new Error(error.message)
  if (data && data.ok === false) throw new Error(data.error ?? 'No se pudo despachar.')
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

/** Reimprime un pedido. `docType` opcional: si se pasa ('bag'|'kitchen'|'labels')
 *  reimprime SOLO ese documento (la pestaña activa del modal); si se omite, todos.
 *  Con token (Estación) → RPC by-token; sin token (admin) → RPC de sesión.
 *  Devuelve el nº de jobs encolados. 0 = el local no tiene impresoras (para ese doc). */
export async function reprintOrder(
  saleId: string,
  token?: string | null,
  docType?: string | null,
): Promise<number> {
  requireSupabase()
  const { data, error } = token
    ? await (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
        => Promise<{ data: unknown; error: { message: string } | null }>)(
        'reprint_order_by_token', { p_device_token: token, p_sale_id: saleId, p_doc_type: docType ?? undefined })
    : await supabase!.rpc('reprint_order', { p_sale_id: saleId, p_doc_type: docType ?? undefined })
  if (error) throw new Error(`Orders · reprint_order: ${error.message}`)
  return Number(data ?? 0)
}

// ── KPI DE COCINA (chip de tiempo + banner del día) ─────────────────────────

/** Umbrales de tiempo de cocina por local (tabla kitchen_time_config). */
export interface KitchenThresholds {
  green_max_minutes: number
  amber_max_minutes: number
  ceiling_minutes: number
  floor_minutes: number
  enabled: boolean
}

/** Defaults (= semilla de kitchen_time_config). Reserva del chip mientras no llega el banner. */
export const DEFAULT_KITCHEN_THRESHOLDS: KitchenThresholds = {
  green_max_minutes: 15, amber_max_minutes: 25, ceiling_minutes: 30, floor_minutes: 3, enabled: true,
}

/** Banner del día (RPC kitchen_day_banner / _by_token). Colectivo, del local. */
export interface KitchenDayBanner {
  location_id: string
  objetivo_min: number | null
  n_medidos: number
  n_elegibles: number
  mediana_min: number | null
  suficiente: boolean          // guarda de muestra mínima: false => "aún sin datos suficientes"
  bajo_objetivo: boolean | null
  config: KitchenThresholds | null
}

export type CookState = 'none' | 'green' | 'amber' | 'red' | 'incident' | 'frozen'
export interface CookChip { state: CookState; minutes: number | null }

/**
 * Estado del chip de tiempo de COCINA de una tarjeta. Tiempo de cocina = ready_at − accepted_at.
 *   - sin accepted_at        → 'none' ("—", nunca 0).
 *   - ready_at puesto        → 'frozen' con el tiempo final (el mérito queda fijado).
 *   - cocinando (ready null)  → reloj vivo desde accepted_at, coloreado por umbrales:
 *       verde ≤ green_max · ámbar ≤ amber_max · rojo > amber_max · INCIDENCIA > ceiling.
 * `nowMs` lo provee el contenedor (un tick por minuto), no un intervalo por tarjeta.
 */
export function cookingChip(order: OrderFeedItem, cfg: KitchenThresholds, nowMs: number): CookChip {
  if (!order.accepted_at) return { state: 'none', minutes: null }
  const acc = new Date(order.accepted_at).getTime()
  if (isNaN(acc)) return { state: 'none', minutes: null }

  if (order.ready_at) {
    const r = new Date(order.ready_at).getTime()
    if (isNaN(r) || r < acc) return { state: 'frozen', minutes: null }
    return { state: 'frozen', minutes: Math.round((r - acc) / 60000) }
  }

  const m = Math.max(0, Math.round((nowMs - acc) / 60000))
  let state: CookState
  if (m > cfg.ceiling_minutes) state = 'incident'
  else if (m > cfg.amber_max_minutes) state = 'red'
  else if (m > cfg.green_max_minutes) state = 'amber'
  else state = 'green'
  return { state, minutes: m }
}

// Banner del día para la pantalla de Pedidos. Con token (Estación) → RPC by-token,
// sin token (sesión) → RPC de sesión. Ambas SECURITY DEFINER (funciona en la tablet).
export async function getKitchenBanner(
  locationId: string,
  token?: string | null,
): Promise<KitchenDayBanner | null> {
  requireSupabase()
  // OJO: .bind(supabase!) es OBLIGATORIO. Extraer supabase!.rpc a una variable pierde
  // el `this`; supabase-js revienta en this.rest y la petición NUNCA se envía. El cast a
  // la firma simple va ANTES del .bind (si no, TS instancia el tipo sobrecargado gigante).
  const rpc = (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
    => Promise<{ data: unknown; error: { message: string } | null }>).bind(supabase!)
  const { data, error } = token
    ? await rpc('kitchen_day_banner_by_token', { p_device_token: token })
    : await rpc('kitchen_day_banner', { p_location_id: locationId })
  if (error) throw new Error(`Cocina · kitchen_day_banner: ${error.message}`)
  return (data as KitchenDayBanner | null) ?? null
}

// ── Panel de tiempos de cocina (RPC kitchen_time_stats, server-side, por local) ──

export interface KitchenStatsSummary {
  n_medidos: number
  mediana_min: number | null
  peor_min: number | null
  pct_en_objetivo: number | null
  pct_en_verde: number | null
  pct_sobre_techo: number | null
}
export interface KitchenStatsAdoption {
  elegibles: number
  con_listo: number
  pct: number | null
  representativo: boolean       // >= 80%; si no, el dato NO es representativo
}
export interface KitchenStatsHour  { hora: number; n: number; mediana_min: number | null }
export interface KitchenStatsBrand { brand_id: string | null; brand: string | null; n: number; mediana_min: number | null }
export interface KitchenStatsWeek  { semana: string; n: number; mediana_min: number | null; pct_en_objetivo: number | null }

export interface KitchenTimeStats {
  location_id: string
  from: string
  to: string
  config: KitchenThresholds | null
  summary: KitchenStatsSummary
  adopcion: KitchenStatsAdoption
  por_hora: KitchenStatsHour[]
  por_marca: KitchenStatsBrand[]
  tendencia_semanal: KitchenStatsWeek[]
}

/** Panel de tiempos, POR LOCAL (nunca global). Sesión (admin/manager), sin token. */
export async function getKitchenTimeStats(
  locationId: string,
  fromIso: string,
  toIso: string,
): Promise<KitchenTimeStats> {
  requireSupabase()
  // .bind(supabase!) OBLIGATORIO (sin él se pierde el `this` y supabase-js falla en
  // this.rest). Cast a la firma simple ANTES del .bind para no instanciar el tipo gigante.
  const rpc = (supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>)
    => Promise<{ data: unknown; error: { message: string } | null }>).bind(supabase!)
  const { data, error } = await rpc('kitchen_time_stats', {
    p_location_id: locationId, p_from: fromIso, p_to: toIso,
  })
  if (error) throw new Error(`Cocina · kitchen_time_stats: ${error.message}`)
  return data as unknown as KitchenTimeStats
}
