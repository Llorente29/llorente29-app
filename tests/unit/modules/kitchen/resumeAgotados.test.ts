import { describe, it, expect } from 'vitest'
import { resumeAgotados, diasDesde } from '@/modules/kitchen/home/resumeAgotados'
import type { SoldOutRow } from '@/modules/kitchen/services/availabilityService'

const AHORA = new Date(2026, 8, 2, 10, 0).getTime()

function fila(p: Partial<SoldOutRow>): SoldOutRow {
  return {
    id: 'x', name: 'Producto', recipeItemId: null, locationId: null, locationName: null,
    reason: 'manual', availableUntil: null, setAt: null, brands: 1,
    representativeMenuItemId: null, sourceFolvy: true, sourceLast: false,
    photoUrl: null, brandNames: [], otrosNombres: [], ...p,
  } as SoldOutRow
}

describe('diasDesde', () => {
  it('cuenta días ENTEROS, no redondea hacia arriba', () => {
    // 23 horas todavía no es un día.
    expect(diasDesde(new Date(2026, 8, 1, 11, 0).toISOString(), AHORA)).toBe(0)
    expect(diasDesde(new Date(2026, 8, 1, 9, 0).toISOString(), AHORA)).toBe(1)
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
      fila({ setAt: new Date(2026, 8, 1).toISOString() }),
      fila({ setAt: new Date(2026, 7, 19).toISOString() }),   // 14 días
    ], AHORA)
    expect(r.nota).toBe('El más antiguo lleva 14 días agotado')
  })

  it('singular y hoy, sin «1 días» ni «0 días»', () => {
    expect(resumeAgotados([fila({ setAt: new Date(2026, 8, 1, 9, 0).toISOString() })], AHORA).nota)
      .toBe('El más antiguo lleva 1 día agotado')
    expect(resumeAgotados([fila({ setAt: new Date(2026, 8, 2, 8, 0).toISOString() })], AHORA).nota)
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
