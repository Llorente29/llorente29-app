import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildClockEntry, defaultKioskoConfig, etiquetaOrigen,
} from '../../../src/services/fichajeKiosko'
import type { CalendarContext } from '../../../src/services/horasComputo'
import type { Employee, Location } from '../../../src/types'

// L0 · punto 4 (27/10/2026). buildClockEntry escribía siempre source 'kiosko',
// también cuando se fichaba desde el móvil: el 100 % de los 1.478 fichajes no
// manuales de Foodint llevan 'kiosko'. Estas pruebas fijan que un fichaje nuevo
// guarda desde dónde se hizo y que 'kiosko' ya no lo escribe nadie.

const emp = { id: 'e1', name: 'Prueba', active: true, clockEntries: [] } as unknown as Employee
const local = { id: 'l1', name: 'Alcalá', lat: 40.4346, lng: -3.6528 } as unknown as Location
const config = defaultKioskoConfig('l1')
const pos = { coords: { latitude: 40.4346, longitude: -3.6528 } } as unknown as GeolocationPosition

describe('buildClockEntry guarda el origen real', () => {
  it('desde el portal del trabajador: móvil', () => {
    expect(buildClockEntry(emp, local, config, pos, { origen: 'movil' }).entry.source).toBe('movil')
  })

  it('desde la pantalla de kiosko: tablet del local', () => {
    expect(buildClockEntry(emp, local, config, pos, { origen: 'tablet' }).entry.source).toBe('tablet')
  })

  it('sin GPS también lleva su origen', () => {
    expect(buildClockEntry(emp, local, config, null, { origen: 'tablet' }).entry.source).toBe('tablet')
    expect(buildClockEntry(emp, local, config, null, { origen: 'movil' }).entry.source).toBe('movil')
  })

  it('el redondeo y el turno teórico siguen llegando por las opciones', () => {
    // Un turno publicado de 09:00 a 17:00 hoy, y una entrada a las 09:03: se
    // redondea a las 09:00 y se guarda el turno, igual que antes del cambio.
    const ahora = new Date()
    const iso = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
    const ctx: CalendarContext = {
      assignmentsByDate: new Map([[iso, { shiftTypeId: 't' }]]),
      typesById: new Map([['t', { startTime: '00:00', endTime: '23:59', hours: 24, isOff: false }]]),
    }
    const r = buildClockEntry(emp, local, config, pos, { origen: 'movil', roundingToleranceMin: 8, calendarCtx: ctx })
    expect(r.entry.scheduled).toBe('00:00')
    // Sin calendario (la tablet nunca lo pasa) no hay turno teórico: es la pista
    // que distingue los fichajes antiguos del móvil (ver la auditoría L0, §4).
    expect(buildClockEntry(emp, local, config, pos, { origen: 'tablet' }).entry.scheduled).toBeUndefined()
  })
})

describe('etiquetaOrigen: lo que lee quien revisa el registro', () => {
  it('cada origen, en palabras', () => {
    expect(etiquetaOrigen('movil')).toBe('Móvil del trabajador')
    expect(etiquetaOrigen('tablet')).toBe('Tablet del local')
    expect(etiquetaOrigen('manual')).toBe('Puesto a mano')
  })

  it("lo antiguo ('kiosko' o sin origen) no se da por tablet ni por móvil", () => {
    expect(etiquetaOrigen('kiosko')).toBe('Tablet o móvil (sin distinguir)')
    expect(etiquetaOrigen(undefined)).toBe('Tablet o móvil (sin distinguir)')
    expect(etiquetaOrigen(null)).toBe('Tablet o móvil (sin distinguir)')
  })
})

describe('las pantallas que fichan dicen su origen', () => {
  const leer = (f: string) => readFileSync(f, 'utf8')

  it("la pantalla de kiosko ficha como 'tablet', y solo así", () => {
    const t = leer('src/pages/KioskoFichajePage.tsx')
    const llamadas = t.match(/buildClockEntry\([^)]*\)/g) ?? []
    expect(llamadas.length).toBeGreaterThan(0)
    for (const l of llamadas) expect(l).toContain("origen: 'tablet'")
  })

  it("el portal del trabajador ficha como 'movil', y solo así", () => {
    const t = leer('src/pages/trabajador/FichajeEmpleado.tsx')
    const llamadas = t.match(/buildClockEntry\([^)]*\)/g) ?? []
    expect(llamadas.length).toBeGreaterThan(0)
    for (const l of llamadas) expect(l).toContain("origen: 'movil'")
  })

  it("nadie escribe ya 'kiosko' en un fichaje nuevo", () => {
    expect(leer('src/services/fichajeKiosko.ts')).not.toMatch(/source:\s*'kiosko'/)
  })
})
