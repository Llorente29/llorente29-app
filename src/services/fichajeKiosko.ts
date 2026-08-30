// src/services/fichajeKiosko.ts
import type { Employee, ClockEntry, Location, KioskoConfig } from '../types'
import { applyRounding, type CalendarContext } from './horasComputo'

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
  roundingToleranceMin = 8,
  calendarCtx?: CalendarContext,
): ClockResult {
  const type = nextClockType(employee)
  const realDate = new Date()
  const realISO = realDate.toISOString()

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

  // Aplicar redondeo amistoso (Opción 3) — solo si hay calendario publicado para ese día
  const rounding = applyRounding(realDate, type, employee, roundingToleranceMin, calendarCtx)

  const entry: ClockEntry = {
    id: 'fc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type,
    datetime: rounding.effectiveDateTime,    // hora efectiva (puede estar redondeada)
    realDatetime: realISO,                   // hora real siempre
    scheduled: rounding.scheduledTime,
    roundingApplied: rounding.applied,
    diffMinutes: rounding.diffMin,
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
    geofenceRadiusM: 1000,  // FIX 14/06: era 200. Holgado hasta mover radio/flag a la tabla locations (hoy viven en localStorage del admin, no llegan al movil).
    requirePhoto: false,
    blockOutsideGeofence: true,
  }
}

// ─── AVISO DE CONTEXTO DEL FICHAJE (30/08/2026) ───────────────────────────
// La app decide sola el tipo del fichaje — hay UN solo botón — así que cuando
// el contexto es raro tiene que enseñar QUÉ va a escribir antes de escribirlo.
// Informa y deja pasar: quien confirma, ficha. Vive aquí, fuera del componente,
// porque los umbrales son la parte que más fácil se equivoca y así se prueban.

/** Una ENTRADA a estas horas locales es rara en cualquier local de Folvy. */
export const AVISO_ENTRADA_RARA_DESDE_H = 23
export const AVISO_ENTRADA_RARA_HASTA_H = 5
/**
 * Volver a entrar poco después de salir. 120 min y NO 6 h a propósito: Camichi
 * parte el día (salida ~16:45, entrada ~19:45) y a 6 h saltaría cada día
 * partido — 100 de las 397 entradas de los últimos 90 días. A 2 h son 12.
 */
export const AVISO_REENTRADA_MIN = 120
/**
 * Jornada que ya no parece una jornada. 12 h y NO 10,5 h: sobre las 395
 * jornadas cerradas de los últimos 90 días, cortar a 10,5 h avisaría 47 veces
 * (12 % de las salidas, ~4 por semana) y 26 de ellas caen en la franja 11-12 h,
 * que es un turno largo REAL y recurrente de las ocho personas, todas las
 * semanas. A 12 h son 20 avisos en 90 días (~1,7 por semana) y sigue cazando el
 * caso que motivó el encargo (15 h 54 min). Es además la misma línea que traza
 * la BBDD en c_jornada_rancia: app y trigger avisan de lo mismo.
 */
export const AVISO_JORNADA_LARGA_MIN = 720

/** Lo que employee_clock_status dice AHORA. Leído en vivo, nunca del array. */
export interface EstadoFichajeVivo {
  estado: 'trabajando' | 'fuera' | 'sin_fichajes'
  /** Último fichaje no anulado; si está trabajando, su última ENTRADA. */
  since: string | null
  abiertaDesde: string | null
}

export interface AvisoContexto {
  titulo: string
  texto: string
  /** Lo que la app iba a escribir. */
  accion: 'entrada' | 'salida'
  /**
   * Acción contraria a un toque. Solo cuando el estado REAL de la BBDD discrepa
   * de lo que la app iba a escribir: ahí la contraria es la única que la BBDD
   * aceptaría. Si app y BBDD coinciden no se ofrece, porque escribiría un
   * fichaje huérfano.
   */
  alternativa: 'entrada' | 'salida' | null
}

export const horaCorta = (d: Date) =>
  d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

/** "15 h 54 min" — sin decimales ni ceros que nadie lee. */
export function duracionLarga(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "hoy a las 20:15" · "ayer a las 00:15" · "el 27/08 a las 22:00". */
export function cuando(d: Date, ahora: Date): string {
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((dia(ahora) - dia(d)) / 86400000)
  if (diff === 0) return `hoy a las ${horaCorta(d)}`
  if (diff === 1) return `ayer a las ${horaCorta(d)}`
  // A mano y no con toLocaleDateString: el ICU de Node devuelve "17/8" y el del
  // movil "17/08". La fecha de un fichaje no cambia de forma segun el aparato.
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `el ${dd}/${mm} a las ${horaCorta(d)}`
}

/**
 * ¿Hay que avisar antes de escribir? null = fichaje normal, sin fricción.
 * @param vaAEscribir el tipo que la app ha deducido y va a escribir
 * @param st          estado REAL leído de la BBDD al pulsar
 */
export function avisoDeContexto(
  vaAEscribir: 'entrada' | 'salida',
  st: EstadoFichajeVivo,
  ahora: Date = new Date(),
): AvisoContexto | null {
  const desde = st.abiertaDesde ? new Date(st.abiertaDesde) : null
  const ultimo = st.since ? new Date(st.since) : null

  if (vaAEscribir === 'entrada') {
    // La BBDD dice que ya está dentro y la app iba a escribir OTRA entrada.
    if (st.estado === 'trabajando') {
      return {
        titulo: 'Ya constas DENTRO',
        texto: `Vas a fichar ENTRADA a las ${horaCorta(ahora)}, pero en el sistema tienes una `
             + `jornada abierta desde ${desde ? cuando(desde, ahora) : 'antes'}. `
             + `¿Querías fichar la SALIDA?`,
        accion: 'entrada', alternativa: 'salida',
      }
    }
    const h = ahora.getHours()
    const horaRara = h >= AVISO_ENTRADA_RARA_DESDE_H || h < AVISO_ENTRADA_RARA_HASTA_H
    const minFuera = ultimo ? Math.round((ahora.getTime() - ultimo.getTime()) / 60000) : null
    const reentradaRapida = minFuera !== null && minFuera >= 0 && minFuera < AVISO_REENTRADA_MIN
    if (!horaRara && !reentradaRapida) return null
    const fuera = ultimo
      ? `Tu último fichaje fue una SALIDA ${cuando(ultimo, ahora)}`
      : 'No tienes ningún fichaje anterior'
    return {
      titulo: horaRara ? 'Entrada a una hora poco habitual' : 'Vuelves a entrar muy pronto',
      texto: `Vas a fichar ENTRADA a las ${horaCorta(ahora)}. ${fuera}, así que ahora mismo no `
           + `tienes ninguna jornada abierta. Si creías estar dentro, es que tu entrada no llegó `
           + `a registrarse: fíchala ahora y avisa a tu encargado de la hora real.`,
      accion: 'entrada', alternativa: null,
    }
  }

  // Va a escribir una SALIDA.
  if (st.estado !== 'trabajando') {
    return {
      titulo: 'No consta ninguna jornada abierta',
      texto: `Vas a fichar SALIDA a las ${horaCorta(ahora)}, pero en el sistema no tienes ninguna `
           + `entrada abierta que cerrar${ultimo ? ` (tu último fichaje fue ${cuando(ultimo, ahora)})` : ''}. `
           + `¿Querías fichar la ENTRADA?`,
      accion: 'salida', alternativa: 'entrada',
    }
  }
  if (desde) {
    const min = Math.round((ahora.getTime() - desde.getTime()) / 60000)
    if (min >= AVISO_JORNADA_LARGA_MIN) {
      return {
        titulo: 'Jornada muy larga',
        texto: `Vas a cerrar una jornada de ${duracionLarga(min)} que empezó ${cuando(desde, ahora)}. `
             + `¿Es correcto? Si olvidaste fichar la salida de aquel día, fíchala igualmente y `
             + `avisa a tu encargado para que la corrija.`,
        accion: 'salida', alternativa: null,
      }
    }
  }
  return null
}
