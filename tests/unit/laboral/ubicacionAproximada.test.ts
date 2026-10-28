// tests/unit/laboral/ubicacionAproximada.test.ts
//
// L1a · PR 3: la ubicación aproximada del móvil. La frontera es la de fichar()
// en la base (la 1923): más de 100 m de precisión. Y buildClockEntry guarda la
// precisión y no da por «fuera de zona» una ubicación aproximada.
import { describe, expect, it } from 'vitest'
import {
  AVISO_APROXIMADA, PASOS_UBICACION_PRECISA, PRECISION_MAXIMA_M, esAproximada, precisionDe, textoPrecision,
} from '@/modules/personal/laboral/ubicacionAproximada'
import { buildClockEntry } from '@/services/fichajeKiosko'
import type { Employee, Location } from '@/types'

const posicion = (lat: number, lng: number, accuracy: number) =>
  ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.now() }) as unknown as GeolocationPosition

describe('la ubicación aproximada', () => {
  it('la frontera es 100 m, la misma que fichar()', () => {
    expect(PRECISION_MAXIMA_M).toBe(100)
    expect(esAproximada(100)).toBe(false)
    expect(esAproximada(100.4)).toBe(false)
    expect(esAproximada(101)).toBe(true)
    expect(esAproximada(1500)).toBe(true)
    expect(esAproximada(5)).toBe(false)
  })
  it('sin precisión no se sabe: no es aproximada', () => {
    expect(esAproximada(null)).toBe(false)
    expect(esAproximada(undefined)).toBe(false)
    expect(esAproximada(Number.NaN)).toBe(false)
    expect(precisionDe(-1)).toBeNull()
    expect(precisionDe(12.6)).toBe(13)
  })
  it('la precisión, en palabras', () => {
    expect(textoPrecision(120)).toBe('± 120 m')
    expect(textoPrecision(1500)).toBe('± 1,5 km')
  })
  it('el aviso dice qué hacer, y hay pasos para Android y para iPhone', () => {
    expect(AVISO_APROXIMADA).toBe('Tu móvil está dando una ubicación aproximada: activa la ubicación precisa')
    expect(PASOS_UBICACION_PRECISA.map((p) => p.sistema)).toEqual(['Android', 'iPhone'])
    expect(PASOS_UBICACION_PRECISA.find((p) => p.sistema === 'Android')!.pasos.join(' ')).toContain('Usar ubicación precisa')
    expect(PASOS_UBICACION_PRECISA.find((p) => p.sistema === 'iPhone')!.pasos.join(' ')).toContain('Ubicación exacta')
  })
})

describe('buildClockEntry con la precisión', () => {
  const local = { id: 'l1', name: 'Alcalá', lat: 40.4168, lng: -3.7038 } as unknown as Location
  const persona = { id: 'e1', name: 'Natacha', active: true, clockEntries: [], locationId: 'l1' } as unknown as Employee
  const config = { geofenceRadiusM: 200 } as never

  it('el caso de Natacha: a 670 m con ± 1,5 km es aproximada, no fuera de zona, y guarda la precisión', () => {
    const r = buildClockEntry(persona, local, config, posicion(40.4228, -3.7038, 1500), { origen: 'movil' })
    expect(r.aproximada).toBe(true)
    expect(r.withinGeofence).toBe(true)
    expect(Math.round(r.distanceM)).toBeGreaterThan(600)
    expect(r.entry.precisionM).toBe(1500)
  })
  it('a 670 m con ± 12 m: fuera de zona, como siempre', () => {
    const r = buildClockEntry(persona, local, config, posicion(40.4228, -3.7038, 12), { origen: 'movil' })
    expect(r.aproximada).toBe(false)
    expect(r.withinGeofence).toBe(false)
    expect(r.entry.precisionM).toBe(12)
  })
  it('sin posición: sin precisión', () => {
    const r = buildClockEntry(persona, local, config, null, { origen: 'movil' })
    expect(r.aproximada).toBe(false)
    expect(r.entry.precisionM).toBeUndefined()
  })
})
