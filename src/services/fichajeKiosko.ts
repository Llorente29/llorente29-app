// src/services/fichajeKiosko.ts
import type { Employee, ClockEntry, Location, KioskoConfig } from '../types'

// Coordenadas conocidas de los locales (fallback si Location no tiene lat/lng)
const KNOWN_LOCATION_COORDS: Record<string, { lat: number; lng: number }> = {
  alcala:      { lat: 40.4346, lng: -3.6528 },
  carabanchel: { lat: 40.3912, lng: -3.7399 },
  castilla:    { lat: 40.4698, lng: -3.6928 },
}

export function coordsForLocation(loc: Location): { lat: number; lng: number } | null {
  if (loc.lat && loc.lng) return { lat: loc.lat, lng: loc.lng }
  const n = loc.name.toLowerCase()
  for (const [k, v] of Object.entries(KNOWN_LOCATION_COORDS)) {
    if (n.includes(k)) return v
  }
  return null
}

// Distancia en metros entre dos coordenadas (Haversine)
export function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Pide la posición actual del navegador
export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalización no disponible en este dispositivo'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      err => reject(new Error(geoErrorMessage(err))),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  })
}

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case 1: return 'Permiso de ubicación denegado. Activa la ubicación en el navegador.'
    case 2: return 'No se pudo obtener la ubicación. Comprueba el GPS.'
    case 3: return 'Tiempo de espera agotado al obtener la ubicación.'
    default: return 'Error de geolocalización: ' + err.message
  }
}

// Empleados disponibles para fichar en este kiosko (asignados al local activo)
export function employeesForKiosko(employees: Employee[], locationId: string): Employee[] {
  return employees
    .filter(e => e.active)
    .filter(e => {
      const assigned = e.assignedLocations && e.assignedLocations.length > 0
        ? e.assignedLocations
        : [e.locationId]
      return assigned.includes(locationId)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ¿Tiene jornada abierta? (último fichaje es entrada sin salida posterior)
export function hasOpenShift(employee: Employee): boolean {
  const entries = employee.clockEntries || []
  if (!entries.length) return false
  const sorted = [...entries].sort((a, b) =>
    new Date(b.datetime).getTime() - new Date(a.datetime).getTime(),
  )
  return sorted[0].type === 'entrada'
}

// Determina el tipo del próximo fichaje según el último
export function nextClockType(employee: Employee): 'entrada' | 'salida' {
  return hasOpenShift(employee) ? 'salida' : 'entrada'
}

// Validar PIN
export function checkPin(employee: Employee, pin: string): boolean {
  if (!employee.pin) return false
  return employee.pin === pin
}

// Crear el fichaje (sin guardar — la página llamará a actions del context)
export interface ClockResult {
  entry: ClockEntry
  withinGeofence: boolean
  distanceM: number
}

export function buildClockEntry(
  employee: Employee,
  location: Location,
  config: KioskoConfig,
  position: GeolocationPosition | null,
  photoDataUrl?: string,
): ClockResult {
  const type = nextClockType(employee)
  const now = new Date().toISOString()

  let withinGeofence = true
  let distanceM = 0

  if (position) {
    const locCoords = coordsForLocation(location)
    if (locCoords) {
      distanceM = distanceMeters(
        position.coords.latitude, position.coords.longitude,
        locCoords.lat, locCoords.lng,
      )
      withinGeofence = distanceM <= config.geofenceRadiusM
    }
  }

  const entry: ClockEntry = {
    id: 'fc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type,
    datetime: now,
    realDatetime: now,
    lat: position?.coords.latitude,
    lng: position?.coords.longitude,
    source: 'kiosko',
    locationIdAtClock: location.id,
    photoDataUrl,
  }

  return { entry, withinGeofence, distanceM }
}

// LocalStorage para config del kiosko
const KIOSKO_KEY = 'andy-kiosko-config-v1'

export function loadKioskoConfig(): KioskoConfig | null {
  try {
    const raw = localStorage.getItem(KIOSKO_KEY)
    return raw ? JSON.parse(raw) as KioskoConfig : null
  } catch { return null }
}

export function saveKioskoConfig(config: KioskoConfig): void {
  localStorage.setItem(KIOSKO_KEY, JSON.stringify(config))
}

export function defaultKioskoConfig(locationId: string): KioskoConfig {
  return {
    locationId,
    geofenceRadiusM: 200,
    requirePhoto: false,
    blockOutsideGeofence: true,
  }
}
