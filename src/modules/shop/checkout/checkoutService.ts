// src/modules/shop/checkout/checkoutService.ts
//
// Servicio del checkout de Folvy Shop. Reutiliza el MISMO sistema de
// geocodificación que el editor de zonas (Mapbox, geocodeAddress) y valida la
// dirección del cliente contra las zonas de reparto del local (shop_check_delivery).
//
// El paso final (placeShopOrder) crea el pedido por la vía canónica
// (place_shop_order → sale source='folvy_shop'). Reprecia en servidor; el front
// nunca fija el precio. Agnóstico de pago: en esta versión el pago es simulado y
// Stripe se enchufa por encima después.

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
  payment: { mode: 'simulated' }
  lines: OrderLine[]
}

export interface PlaceOrderResult {
  ok: boolean
  reason?: string
  dryRun?: boolean
  saleId?: string
  code?: string
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
    subtotal: data.subtotal != null ? Number(data.subtotal) : undefined,
    deliveryFee: data.deliveryFee != null ? Number(data.deliveryFee) : undefined,
    total: data.total != null ? Number(data.total) : undefined,
    lines: data.lines ?? undefined,
  }
}
