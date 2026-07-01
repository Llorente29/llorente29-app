// src/modules/shop/checkout/checkoutService.ts
//
// Servicio del checkout de Folvy Shop. Reutiliza el MISMO sistema de
// geocodificación que el editor de zonas (Mapbox, geocodeAddress) y valida la
// dirección del cliente contra las zonas de reparto del local (shop_check_delivery).
//
// Flujo de cobro:
//   1) placeShopOrder  → crea el pedido canónico (sale source='folvy_shop','new').
//   2) createShopPaymentIntent → la Edge Function shop-payment-intent crea el
//      PaymentIntent como DIRECT CHARGE sobre la cuenta conectada del restaurante
//      y devuelve el client_secret + la cuenta conectada (para el Payment Element).
//   3) El comensal paga con tarjeta/Bizum; el webhook confirma el pedido.
//   4) getShopOrderStatus(token) → el front LEE el estado real del pedido (la
//      verdad la escribe el webhook), por un token no adivinable propio del
//      pedido. Es la base de la confirmación veraz y del seguimiento del cliente.
// El precio SIEMPRE se recalcula en servidor; el front nunca lo fija.

import { supabase } from '@/lib/supabase'
import type { OrderLine } from '@/modules/shop/services/dishConfigService'
export { geocodeAddress, type GeocodeHit } from '@/modules/shop/services/deliveryZoneService'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

export type DeliverySlot = { ts: string; label: string }

/** Franjas de hoy en las que el local entrega (respeta horario comercial). */
export async function getDeliverySlots(slug: string, locationId: string, etaMin: number, stepMin = 30): Promise<DeliverySlot[]> {
  const { data, error } = await db().rpc('shop_delivery_slots', {
    p_slug: slug, p_location_id: locationId, p_eta_min: etaMin, p_step_min: stepMin,
  })
  if (error || !data || data.ok !== true) return []
  return (data.slots ?? []) as DeliverySlot[]
}

export type DeliveryCheck =
  | { ok: true; zoneId: string; zoneName: string; deliveryFee: number; minOrder: number | null; etaMin: number | null; distanceM: number }
  | { ok: false; reason: 'out_of_zone' | 'account' | 'error' }

/** Valida una dirección (lat/lng) contra las zonas de reparto del local. */
export async function checkDelivery(slug: string, locationId: string, lat: number, lng: number): Promise<DeliveryCheck> {
  const { data, error } = await db().rpc('shop_check_delivery', {
    p_slug: slug, p_location_id: locationId, p_lat: lat, p_lng: lng,
  })
  if (error) return { ok: false, reason: 'error' }
  if (!data || data.ok !== true) {
    return { ok: false, reason: (data?.reason ?? 'error') as 'out_of_zone' | 'account' | 'error' }
  }
  return {
    ok: true,
    zoneId: data.zone_id,
    zoneName: data.zone_name,
    deliveryFee: Number(data.delivery_fee),
    minOrder: data.min_order != null ? Number(data.min_order) : null,
    etaMin: data.eta_min != null ? Number(data.eta_min) : null,
    distanceM: Number(data.distance_m),
  }
}

// ── Crear el pedido (ingesta canónica) ──────────────────────────────────

export interface ShopOrderPayload {
  locationId: string
  mode: 'delivery' | 'pickup'
  customer: { name: string; phone: string; email?: string }
  delivery: {
    address: string
    detail: string
    lat: number | null
    lng: number | null
    zoneId: string | null
    deliveryFee: number
    note: string
  }
  expectedTime: string | null            // ISO; null = lo antes posible
  payment: { mode: 'simulated' | 'stripe' | 'cash' }
  lines: OrderLine[]
}

export interface PlaceOrderResult {
  ok: boolean
  reason?: string
  dryRun?: boolean
  saleId?: string
  code?: string
  publicToken?: string
  subtotal?: number
  deliveryFee?: number
  total?: number
  lines?: { name: string; quantity: number; unitPrice: number; lineTotal: number; valid: boolean }[]
}

/**
 * Crea el pedido del Shop por la vía canónica. Con dryRun=true sólo reprecia y
 * valida (no inserta nada): útil para previsualizar el total real sin escribir.
 */
export async function placeShopOrder(slug: string, payload: ShopOrderPayload, dryRun = false): Promise<PlaceOrderResult> {
  const { data, error } = await db().rpc('place_shop_order', {
    p_slug: slug, p_payload: payload, p_dry_run: dryRun,
  })
  if (error) return { ok: false, reason: error.message }
  if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
  return {
    ok: true,
    dryRun: data.dryRun === true,
    saleId: data.saleId ?? undefined,
    code: data.code ?? undefined,
    publicToken: data.publicToken ?? undefined,
    subtotal: data.subtotal != null ? Number(data.subtotal) : undefined,
    deliveryFee: data.deliveryFee != null ? Number(data.deliveryFee) : undefined,
    total: data.total != null ? Number(data.total) : undefined,
    lines: data.lines ?? undefined,
  }
}

// ── Iniciar el cobro (Stripe Connect, direct charge) ────────────────────

export interface PaymentIntentResult {
  ok: boolean
  reason?: string
  clientSecret?: string
  connectedAccountId?: string
  amount?: number
  paymentIntentId?: string
}

/**
 * Pide a la Edge Function shop-payment-intent que cree el PaymentIntent del
 * pedido (direct charge sobre la cuenta conectada del restaurante). Devuelve el
 * client_secret y la cuenta conectada, que el Payment Element necesita.
 */
export async function createShopPaymentIntent(saleId: string): Promise<PaymentIntentResult> {
  const { data, error } = await db().functions.invoke('shop-payment-intent', { body: { saleId } })
  if (error) return { ok: false, reason: error.message }
  if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
  return {
    ok: true,
    clientSecret: data.clientSecret,
    connectedAccountId: data.connectedAccountId,
    amount: data.amount != null ? Number(data.amount) : undefined,
    paymentIntentId: data.paymentIntentId,
  }
}

// ── Estado del pedido para el cliente (lectura anónima veraz) ────────────

export interface ShopOrderStatus {
  ok: boolean
  reason?: string
  code?: string
  orderStatus?: string
  /** 'pending' | 'paid' | 'failed' | 'refunded' — la verdad la escribe el webhook. */
  paymentStatus?: string
  /** 'stripe' | 'cash' | … */
  payMethod?: string
  mode?: 'pickup' | 'delivery'
  total?: number
  paidAt?: string | null
  deliveryState?: string | null
  etaAt?: string | null
  riderName?: string | null
}

/**
 * Lee el estado real de un pedido del Shop por su TOKEN (no adivinable). Canal
 * anónimo, solo-lectura: expone únicamente estado + total, nada de PII de más.
 * Es la fuente de verdad de la confirmación veraz y del seguimiento del cliente.
 */
export async function getShopOrderStatus(token: string): Promise<ShopOrderStatus> {
  try {
    const { data, error } = await db().rpc('shop_order_status', { p_token: token })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'not_found' }
    return {
      ok: true,
      code: data.code ?? undefined,
      orderStatus: data.orderStatus ?? undefined,
      paymentStatus: data.paymentStatus ?? undefined,
      payMethod: data.payMethod ?? undefined,
      mode: (data.mode ?? undefined) as 'pickup' | 'delivery' | undefined,
      total: data.total != null ? Number(data.total) : undefined,
      paidAt: data.paidAt ?? null,
      deliveryState: data.deliveryState ?? null,
      etaAt: data.etaAt ?? null,
      riderName: data.riderName ?? null,
    }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Locales de la tienda (para el selector de recogida, multi-local) ─────

export interface ShopLocation { id: string; name: string; address: string | null }

/** Locales activos de la cuenta dueña del slug (RPC pública shop_locations_by_slug). */
export async function getShopLocations(slug: string): Promise<ShopLocation[]> {
  const { data, error } = await db().rpc('shop_locations_by_slug', { p_slug: slug })
  if (error || !Array.isArray(data)) return []
  return (data as any[]).map((l) => ({ id: l.id, name: l.name ?? '', address: l.address ?? null }))
}

// ── Config de métodos de pago del Shop (tienda pública, por slug) ────────

export interface ShopPaymentConfig {
  online: boolean
  cashPickup: boolean
  cashDelivery: boolean
}

/**
 * Lee qué métodos de pago acepta la tienda (rpc pública shop_payment_config).
 * Si falla, devuelve un fallback seguro: solo online (nunca abre efectivo por error).
 */
export async function getShopPaymentConfig(slug: string): Promise<ShopPaymentConfig> {
  try {
    const { data, error } = await db().rpc('shop_payment_config', { p_slug: slug })
    if (error || !data || data.ok !== true) return { online: true, cashPickup: false, cashDelivery: false }
    return {
      online: data.online !== false,
      cashPickup: data.cashPickup === true,
      cashDelivery: data.cashDelivery === true,
    }
  } catch {
    return { online: true, cashPickup: false, cashDelivery: false }
  }
}
