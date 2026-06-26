// src/modules/shop/checkout/checkoutService.ts
//
// Servicio del checkout de Folvy Shop. Reutiliza el MISMO sistema de
// geocodificación que el editor de zonas (Mapbox, geocodeAddress) y valida la
// dirección del cliente contra las zonas de reparto del local (shop_check_delivery).

import { supabase } from '@/lib/supabase'
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
