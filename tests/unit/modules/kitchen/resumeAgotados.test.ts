import { describe, it, expect } from 'vitest'
import { resumeAgotados, diasDesde } from '@/modules/kitchen/home/resumeAgotados'
import type { SoldOutRow } from '@/modules/kitchen/services/availabilityService'

// Instantes EXPLÍCITOS en UTC, no `new Date(2026, 8, 2, 10, 0)`, que es hora
// local: con TZ=UTC esa fecha cae en otro día natural de Madrid y la prueba
// falla aunque el código esté bien. El código se fija a Europe/Madrid a
// propósito; la prueba tiene que serlo también o mide el husо de quien la corre.
// (Comprobado: con fixtures locales, verde en Madrid y roja en UTC, Nueva York
// y Tokio.)
const AHORA = new Date('2026-09-02T08:25:18Z').getTime()   // 10:25 de Madrid

function fila(p: Partial<SoldOutRow>): SoldOutRow {
  return {
    id: 'x', name: 'Producto', recipeItemId: null, locationId: null, locationName: null,
    reason: 'manual', availableUntil: null, setAt: null, brands: 1,
    representativeMenuItemId: null, sourceFolvy: true, sourceLast: false,
    photoUrl: null, brandNames: [], otrosNombres: [], ...p,
  } as SoldOutRow
}

describe('diasDesde · días NATURALES, no horas transcurridas', () => {
  // Los dos casos REALES del 02/09 medidos contra la base de datos. Con el
  // cálculo por horas transcurridas daban 4 y 13; la base decía 5 y 14.
  it('Alcalá: agotado el 28/08 a las 12:17 de Madrid → 5 el 02/09 por la mañana', () => {
    expect(diasDesde('2026-08-28T10:17:23.715Z', new Date('2026-09-02T08:25:18Z').getTime())).toBe(5)
  })
  it('Carabanchel: agotado el 19/08 a las 21:05 de Madrid → 14', () => {
    expect(diasDesde('2026-08-19T19:05:51.988Z', new Date('2026-09-02T08:25:18Z').getTime())).toBe(14)
  })

  // LO QUE IMPORTA: que la cifra NO baile a lo largo del día. Antes saltaba a
  // las 12:17, un instante que no significa nada para quien lo lee.
  it('no cambia a lo largo del día: sale lo mismo a las 00:05 que a las 23:55', () => {
    const agotado = '2026-08-28T10:17:23.715Z'
    const alba  = new Date('2026-09-01T22:05:00Z').getTime()   // 00:05 del 2 en Madrid
    const noche = new Date('2026-09-02T21:55:00Z').getTime()   // 23:55 del 2 en Madrid
    expect(diasDesde(agotado, alba)).toBe(5)
    expect(diasDesde(agotado, noche)).toBe(5)
  })

  it('cambia a MEDIANOCHE, que es cuando una persona lo espera', () => {
    const agotado = '2026-08-28T10:17:23.715Z'
    expect(diasDesde(agotado, new Date('2026-09-02T21:59:00Z').getTime())).toBe(5)  // 23:59 del 2
    expect(diasDesde(agotado, new Date('2026-09-02T22:01:00Z').getTime())).toBe(6)  // 00:01 del 3
  })

  it('mismo día natural = 0, aunque hayan pasado horas', () => {
    expect(diasDesde('2026-09-02T06:00:00Z', new Date('2026-09-02T20:00:00Z').getTime())).toBe(0)
  })

  // El cambio de hora no puede meter ni quitar un día: por eso se restan días
  // reinterpretados a mediodía UTC y no instantes.
  it('el cambio de hora de octubre no descuadra el conteo', () => {
    // 24/10 y 26/10 de 2026, con el cambio a horario de invierno el 25 de madrugada.
    expect(diasDesde('2026-10-24T10:00:00Z', new Date('2026-10-26T10:00:00Z').getTime())).toBe(2)
  })

  it('sin fecha, ni cero ni excepción: null', () => {
    expect(diasDesde(null, AHORA)).toBeNull()
    expect(diasDesde('no soy una fecha', AHORA)).toBeNull()
  })
})

describe('resumeAgotados', () => {
  it('el caso real del 02/09: 81 en la cuenta, Carabanchel primero', () => {
    const filas = [
      ...Array.from({ length: 63 }, () => fila({ locationName: 'Foodint Carabanchel' })),
      ...Array.from({ length: 18 }, () => fila({ locationName: 'Foodint Alcalá' })),
    ]
    const r = resumeAgotados(filas, AHORA)
    expect(r.total).toBe(81)
    expect(r.filas).toEqual([
      { etiqueta: 'Foodint Carabanchel', valor: '63' },
      { etiqueta: 'Foodint Alcalá', valor: '18' },
    ])
  })

  // Con un solo local el desglose repetiría la cifra grande.
  it('un solo local: sin desglose', () => {
    const r = resumeAgotados([fila({ locationName: 'Foodint Alcalá' })], AHORA)
    expect(r.total).toBe(1)
    expect(r.filas).toEqual([])
  })

  it('empate: alfabético, para que la tarjeta no baile entre recargas', () => {
    const r = resumeAgotados([
      fila({ locationName: 'Zamora' }), fila({ locationName: 'Alcalá' }),
    ], AHORA)
    expect(r.filas.map(f => f.etiqueta)).toEqual(['Alcalá', 'Zamora'])
  })

  it('la nota dice el MÁS ANTIGUO, no el más reciente', () => {
    const r = resumeAgotados([
      fila({ setAt: '2026-09-01T10:00:00Z' }),                 // 1 día
      fila({ setAt: '2026-08-19T19:05:51Z' }),                 // 14 días naturales
    ], AHORA)
    expect(r.nota).toBe('El más antiguo lleva 14 días agotado')
  })

  it('singular y hoy, sin «1 días» ni «0 días»', () => {
    expect(resumeAgotados([fila({ setAt: '2026-09-01T21:30:00Z' })], AHORA).nota)   // 23:30 del 1
      .toBe('El más antiguo lleva 1 día agotado')
    expect(resumeAgotados([fila({ setAt: '2026-09-02T06:00:00Z' })], AHORA).nota)   // 08:00 del 2
      .toBe('El más antiguo se agotó hoy')
  })

  it('sin nada agotado: cero de verdad y ninguna nota inventada', () => {
    const r = resumeAgotados([], AHORA)
    expect(r.total).toBe(0)
    expect(r.nota).toBeUndefined()
    expect(r.filas).toEqual([])
  })

  it('una fila sin local no se pierde ni se atribuye a otro', () => {
    const r = resumeAgotados([
      fila({ locationName: 'Foodint Alcalá' }), fila({ locationName: null }),
    ], AHORA)
    expect(r.total).toBe(2)
    expect(r.filas.map(f => f.etiqueta)).toContain('Sin local')
  })
})
