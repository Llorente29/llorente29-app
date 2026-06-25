// src/modules/shop/services/deliveryZoneService.ts
//
// Capa 1 del motor de envío: zonas de entrega por local.
// La geometría (geography) NO se escribe desde aquí: se delega en RPCs que la
// construyen en SQL (upsert_delivery_zone_*). Lectura vía list_delivery_zones,
// que devuelve la geometría ya serializada (center_lat/lng, area_geojson) para
// pintar el mapa sin tocar PostGIS en el cliente.
//
// Geocodificación de direcciones (dirección del cliente → lat/lng) con Mapbox.
// El token es público (VITE_MAPBOX_TOKEN), restringido por URL en Mapbox.

import { supabase } from '@/lib/supabase'

export type ZoneMethod = 'radius' | 'polygon' | 'postal'

// Una zona tal como la devuelve list_delivery_zones (geometría ya serializada).
export type DeliveryZone = {
  id: string
  name: string
  method: ZoneMethod
  delivery_fee: number
  min_order: number | null
  eta_min: number | null
  radius_m: number | null
  priority: number
  is_active: boolean
  center_lat: number | null
  center_lng: number | null
  area_geojson: GeoJSON.Polygon | null
  postal_codes: string[] | null
}

// Campos económicos comunes a los tres métodos.
export type ZoneEconomics = {
  name: string
  delivery_fee: number
  min_order?: number | null
  eta_min?: number | null
  priority?: number
}

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

// ── Lectura ──────────────────────────────────────────────────────────────────
export async function listDeliveryZones(locationId: string): Promise<DeliveryZone[]> {
  const { data, error } = await db().rpc('list_delivery_zones', { p_location_id: locationId })
  if (error) throw new Error(`No se pudieron leer las zonas: ${error.message}`)
  return (data ?? []) as DeliveryZone[]
}

// ── Escritura (una RPC por método) ────────────────────────────────────────────

/** Crea/actualiza una zona de RADIO. id null = crear. */
export async function upsertRadiusZone(
  id: string | null, locationId: string,
  radiusM: number, lat: number, lng: number, eco: ZoneEconomics,
): Promise<string> {
  const { data, error } = await db().rpc('upsert_delivery_zone_radius', {
    p_id: id, p_location_id: locationId, p_name: eco.name,
    p_radius_m: Math.round(radiusM), p_lat: lat, p_lng: lng,
    p_delivery_fee: eco.delivery_fee, p_min_order: eco.min_order ?? null,
    p_eta_min: eco.eta_min ?? null, p_priority: eco.priority ?? 0,
  })
  if (error) throw new Error(`No se pudo guardar la zona de radio: ${error.message}`)
  return data as string
}

/** Crea/actualiza una zona de POLÍGONO o ISÓCRONA (ambas son un Polygon GeoJSON). */
export async function upsertPolygonZone(
  id: string | null, locationId: string,
  polygon: GeoJSON.Polygon, eco: ZoneEconomics,
): Promise<string> {
  const { data, error } = await db().rpc('upsert_delivery_zone_polygon', {
    p_id: id, p_location_id: locationId, p_name: eco.name,
    p_geojson: polygon, p_delivery_fee: eco.delivery_fee,
    p_min_order: eco.min_order ?? null, p_eta_min: eco.eta_min ?? null,
    p_priority: eco.priority ?? 0,
  })
  if (error) throw new Error(`No se pudo guardar la zona de polígono: ${error.message}`)
  return data as string
}

/** Crea/actualiza una zona de CÓDIGOS POSTALES. */
export async function upsertPostalZone(
  id: string | null, locationId: string,
  postalCodes: string[], eco: ZoneEconomics,
): Promise<string> {
  const clean = postalCodes.map(c => c.trim()).filter(Boolean)
  if (clean.length === 0) throw new Error('Añade al menos un código postal.')
  const { data, error } = await db().rpc('upsert_delivery_zone_postal', {
    p_id: id, p_location_id: locationId, p_name: eco.name,
    p_postal_codes: clean, p_delivery_fee: eco.delivery_fee,
    p_min_order: eco.min_order ?? null, p_eta_min: eco.eta_min ?? null,
    p_priority: eco.priority ?? 0,
  })
  if (error) throw new Error(`No se pudo guardar la zona de códigos postales: ${error.message}`)
  return data as string
}

/** Borra una zona. */
export async function deleteZone(id: string): Promise<void> {
  const { error } = await db().rpc('delete_delivery_zone', { p_id: id })
  if (error) throw new Error(`No se pudo borrar la zona: ${error.message}`)
}

// ── Mapbox: geocodificación e isócrona ────────────────────────────────────────

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

export function hasMapbox(): boolean {
  return !!MAPBOX_TOKEN
}

export type GeocodeHit = {
  label: string            // texto mostrable de la dirección
  lat: number
  lng: number
  postcode: string | null
}

/** Geocodifica una dirección (texto → coords + CP). Sesgado a España.
 *  Cachear el resultado aguas arriba (la geocodificación de Mapbox es la API más
 *  cara; no re-geocodificar la misma dirección). */
export async function geocodeAddress(query: string): Promise<GeocodeHit[]> {
  if (!MAPBOX_TOKEN) throw new Error('Falta el token de Mapbox (VITE_MAPBOX_TOKEN).')
  const q = query.trim()
  if (!q) return []
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
    + `?access_token=${MAPBOX_TOKEN}&country=es&language=es&limit=5&types=address,postcode,place`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocodificación falló (${res.status}).`)
  const json = await res.json()
  return (json.features ?? []).map((f: any): GeocodeHit => {
    const ctx = f.context ?? []
    const pc = (f.place_type?.includes('postcode') ? f.text : null)
      ?? ctx.find((c: any) => String(c.id).startsWith('postcode'))?.text
      ?? null
    return { label: f.place_name as string, lng: f.center[0], lat: f.center[1], postcode: pc }
  })
}

/** Isócrona: polígono alcanzable en p_minutes de conducción desde (lat,lng).
 *  Devuelve un Polygon GeoJSON listo para upsertPolygonZone. */
export async function isochrone(lat: number, lng: number, minutes: number): Promise<GeoJSON.Polygon> {
  if (!MAPBOX_TOKEN) throw new Error('Falta el token de Mapbox (VITE_MAPBOX_TOKEN).')
  const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${lng},${lat}`
    + `?contours_minutes=${Math.round(minutes)}&polygons=true&denoise=1&access_token=${MAPBOX_TOKEN}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Isócrona falló (${res.status}).`)
  const json = await res.json()
  const feat = json.features?.[0]
  if (!feat?.geometry || feat.geometry.type !== 'Polygon') {
    throw new Error('La isócrona no devolvió un polígono.')
  }
  return feat.geometry as GeoJSON.Polygon
}
