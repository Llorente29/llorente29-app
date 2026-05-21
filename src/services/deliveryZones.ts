// src/services/deliveryZones.ts
// Servicio principal del módulo Zonas de Pedido

import type { DeliveryRecord, DeliveryZoneConfig } from '../types'

const WEBHOOK_URL = 'https://lastapp-webhook.vercel.app'
const STORAGE_KEY = 'andy-delivery-v1'
const ZONES_KEY   = 'andy-delivery-zones-v1'

// ── Coordenadas por defecto de cada local ──────────────────────────────────
// Vacío a propósito (Sesión 14): la app parte de cero. Cada cliente configura
// sus propias zonas en el módulo Zonas de Pedido. Si está vacío,
// coordsForLocation() devuelve null y no hay semilla automática.
export const DEFAULT_ZONE_COORDS: Record<string, { lat: number; lng: number; label: string }> = {}

// ── Coordenadas aproximadas de barrios de Madrid ───────────────────────────
// Usado como fallback para no necesitar geocoding en cada render
const BARRIO_COORDS: Record<string, { lat: number; lng: number }> = {
  'Ciudad Lineal':         { lat: 40.4423, lng: -3.6501 },
  'Cdad. Lineal':          { lat: 40.4423, lng: -3.6501 },
  'Salamanca':             { lat: 40.4286, lng: -3.6784 },
  'San Blas-Canillejas':   { lat: 40.4266, lng: -3.6079 },
  'Chamartín':             { lat: 40.4597, lng: -3.6770 },
  'Retiro':                { lat: 40.4082, lng: -3.6843 },
  'Carabanchel':           { lat: 40.3866, lng: -3.7366 },
  'Latina':                { lat: 40.4068, lng: -3.7285 },
  'Calle Piedrahita':      { lat: 40.3910, lng: -3.7280 },
  'Arganzuela':            { lat: 40.3959, lng: -3.7037 },
  'Calle Francolin':       { lat: 40.3875, lng: -3.7395 },
  'Tetuán':                { lat: 40.4597, lng: -3.7037 },
  'Chamberí':              { lat: 40.4354, lng: -3.7032 },
  'Fuencarral-El Pardo':   { lat: 40.5049, lng: -3.7101 },
  'Calle de Orense':       { lat: 40.4581, lng: -3.6938 },
  'Moncloa - Aravaca':     { lat: 40.4357, lng: -3.7248 },
  'Hortaleza':             { lat: 40.4777, lng: -3.6385 },
  'Barajas':               { lat: 40.4779, lng: -3.5787 },
  'Moratalaz':             { lat: 40.4052, lng: -3.6487 },
  'Vallecas':              { lat: 40.3836, lng: -3.6549 },
  'Puente de Vallecas':    { lat: 40.3936, lng: -3.6578 },
  'Vicálvaro':             { lat: 40.3985, lng: -3.6074 },
  'Centro':                { lat: 40.4168, lng: -3.7038 },
  'Villaverde':            { lat: 40.3534, lng: -3.7078 },
  'Usera':                 { lat: 40.3909, lng: -3.7136 },
}

// ── Haversine distance (km) ────────────────────────────────────────────────
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Match location name → default coords ──────────────────────────────────
export function coordsForLocation(name: string): { lat: number; lng: number } | null {
  const key = name.toLowerCase().trim()
  for (const [k, v] of Object.entries(DEFAULT_ZONE_COORDS)) {
    if (key.includes(k)) return v
  }
  return null
}

// ── Fetch registros del webhook ────────────────────────────────────────────
export interface RawWebhookRecord {
  date: string; time: string; hour: number; dayOfWeek: number
  turno: string; amount: number; dishes: number
  source: string; brand: string; ticket: string; billNumber?: string
  locationId: string; locationName: string
  // campos de tabs (si vienen del endpoint extendido)
  barrio?: string; address?: string; lat?: number; lng?: number
}

export async function fetchWebhookRecords(days = 30): Promise<RawWebhookRecord[]> {
  const res = await fetch(`${WEBHOOK_URL}/api/webhook?days=${days}`)
  if (!res.ok) throw new Error(`Webhook ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Webhook error')
  return data.records || []
}

// ── Geocodificar barrio vía /api/geodata ──────────────────────────────────
export async function geocodeBarrios(barrios: string[]): Promise<Record<string, { lat: number; lng: number }>> {
  // Primero intentamos el lookup local
  const result: Record<string, { lat: number; lng: number }> = {}
  const missing: string[] = []
  for (const b of barrios) {
    if (BARRIO_COORDS[b]) result[b] = BARRIO_COORDS[b]
    else missing.push(b)
  }
  if (!missing.length) return result

  try {
    const res = await fetch(`${WEBHOOK_URL}/api/geodata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: missing.map(b => `${b}, Madrid, España`) }),
    })
    if (res.ok) {
      const data = await res.json()
      for (const b of missing) {
        const key = `${b}, Madrid, España`
        if (data.results?.[key]?.ok) {
          result[b] = { lat: data.results[key].lat, lng: data.results[key].lng }
        }
      }
    }
  } catch { /* silencioso — usamos solo los que tenemos */ }

  return result
}

// ── Transformar raw records en DeliveryRecords enriquecidos ───────────────
export function enrichRecords(
  raw: RawWebhookRecord[],
  zoneConfigs: DeliveryZoneConfig[],
  barrioCoords: Record<string, { lat: number; lng: number }>
): DeliveryRecord[] {
  return raw.map((r, i) => {
    const rec: DeliveryRecord = {
      id: `dr-${i}`,
      locationId: r.locationId,
      locationName: r.locationName,
      date: r.date,
      amount: r.amount,
      source: r.source,
      barrio: r.barrio || 'Desconocido',
      lat: r.lat,
      lng: r.lng,
      address: r.address,
    }

    // Enriquecer con coords del barrio si no tiene las propias
    const barrioC = barrioCoords[rec.barrio]
    if (!rec.lat && barrioC) {
      rec.lat = barrioC.lat + (Math.random() - 0.5) * 0.005 // pequeño jitter para no apilar
      rec.lng = barrioC.lng + (Math.random() - 0.5) * 0.005
    }

    // Calcular local más cercano
    if (rec.lat && rec.lng && zoneConfigs.length > 0) {
      let minDist = Infinity
      let closestId = ''
      for (const z of zoneConfigs) {
        const d = haversineKm(rec.lat, rec.lng, z.lat, z.lng)
        if (d < minDist) { minDist = d; closestId = z.locationId }
      }
      rec.distanceKm = minDist
      rec.closestLocationId = closestId
    }

    return rec
  })
}

// ── Persistencia ──────────────────────────────────────────────────────────
export function saveRecords(records: DeliveryRecord[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ records, savedAt: new Date().toISOString() })) }
  catch { console.warn('localStorage full') }
}

export function loadRecords(): { records: DeliveryRecord[]; savedAt: string } | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

export function saveZoneConfigs(zones: DeliveryZoneConfig[]) {
  try { localStorage.setItem(ZONES_KEY, JSON.stringify(zones)) }
  catch { /* ignore */ }
}

export function loadZoneConfigs(): DeliveryZoneConfig[] {
  try {
    const s = localStorage.getItem(ZONES_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

// ── Análisis: barrios compartidos ─────────────────────────────────────────
export interface BarrioStats {
  barrio: string
  byLocation: Record<string, { count: number; amount: number }>
  total: number
  totalAmount: number
  isShared: boolean        // aparece en 2+ locales
  // Si tenemos coords: % mal asignados (pedido más cerca de otro local)
  malAsignadosPct?: number
  malAsignadosCount?: number
}

export function computeBarrioStats(records: DeliveryRecord[]): BarrioStats[] {
  const map = new Map<string, BarrioStats>()

  for (const r of records) {
    if (!map.has(r.barrio)) {
      map.set(r.barrio, {
        barrio: r.barrio,
        byLocation: {},
        total: 0,
        totalAmount: 0,
        isShared: false,
      })
    }
    const s = map.get(r.barrio)!
    if (!s.byLocation[r.locationId]) s.byLocation[r.locationId] = { count: 0, amount: 0 }
    s.byLocation[r.locationId].count++
    s.byLocation[r.locationId].amount += r.amount
    s.total++
    s.totalAmount += r.amount
  }

  // Calcular isShared y mal asignados
  for (const s of map.values()) {
    const locs = Object.keys(s.byLocation)
    s.isShared = locs.length > 1

    if (s.isShared) {
      // Mal asignados = pedidos cuyo closestLocationId != locationId
      const barrioRecords = records.filter(r => r.barrio === s.barrio && r.closestLocationId)
      const mal = barrioRecords.filter(r => r.closestLocationId !== r.locationId)
      if (barrioRecords.length > 0) {
        s.malAsignadosCount = mal.length
        s.malAsignadosPct = mal.length / barrioRecords.length
      }
    }
  }

  return [...map.values()].sort((a, b) => b.total - a.total)
}

// ── Estadísticas por local ─────────────────────────────────────────────────
export interface LocationStats {
  locationId: string
  locationName: string
  count: number
  amount: number
  ticketMedio: number
  bySource: Record<string, number>
  topBarrios: { barrio: string; count: number; amount: number }[]
  // distribución de distancias (si disponible)
  distP50?: number; distP75?: number; distP90?: number
}

export function computeLocationStats(records: DeliveryRecord[]): LocationStats[] {
  const map = new Map<string, LocationStats>()

  for (const r of records) {
    if (!map.has(r.locationId)) {
      map.set(r.locationId, {
        locationId: r.locationId,
        locationName: r.locationName,
        count: 0, amount: 0, ticketMedio: 0,
        bySource: {}, topBarrios: [],
      })
    }
    const s = map.get(r.locationId)!
    s.count++
    s.amount += r.amount
    s.bySource[r.source] = (s.bySource[r.source] || 0) + 1
  }

  for (const s of map.values()) {
    s.ticketMedio = s.count > 0 ? s.amount / s.count : 0

    // Top barrios
    const barrioMap = new Map<string, { count: number; amount: number }>()
    for (const r of records.filter(r => r.locationId === s.locationId)) {
      if (!barrioMap.has(r.barrio)) barrioMap.set(r.barrio, { count: 0, amount: 0 })
      const b = barrioMap.get(r.barrio)!
      b.count++; b.amount += r.amount
    }
    s.topBarrios = [...barrioMap.entries()]
      .map(([barrio, v]) => ({ barrio, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Percentiles de distancia
    const dists = records
      .filter(r => r.locationId === s.locationId && r.distanceKm != null)
      .map(r => r.distanceKm!)
      .sort((a, b) => a - b)
    if (dists.length > 5) {
      s.distP50 = dists[Math.floor(dists.length * 0.50)]
      s.distP75 = dists[Math.floor(dists.length * 0.75)]
      s.distP90 = dists[Math.floor(dists.length * 0.90)]
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count)
}

// ── Simulador de radio ─────────────────────────────────────────────────────
export interface RadiusSimResult {
  locationId: string
  radiusKm: number
  covered: number       // pedidos dentro del radio
  coveredAmount: number
  lost: number          // pedidos del local fuera del radio
  lostAmount: number
  coveredPct: number
}

export function simulateRadius(
  records: DeliveryRecord[],
  zoneConfigs: DeliveryZoneConfig[]
): RadiusSimResult[] {
  return zoneConfigs.map(z => {
    const locRecords = records.filter(r => r.locationId === z.locationId && r.distanceKm != null)
    const covered = locRecords.filter(r => (r.distanceKm || 0) <= z.radiusKm)
    const lost = locRecords.filter(r => (r.distanceKm || 0) > z.radiusKm)
    const totalAmt = locRecords.reduce((s, r) => s + r.amount, 0)
    const covAmt = covered.reduce((s, r) => s + r.amount, 0)
    return {
      locationId: z.locationId,
      radiusKm: z.radiusKm,
      covered: covered.length,
      coveredAmount: covAmt,
      lost: lost.length,
      lostAmount: totalAmt - covAmt,
      coveredPct: locRecords.length > 0 ? covered.length / locRecords.length : 1,
    }
  })
}
