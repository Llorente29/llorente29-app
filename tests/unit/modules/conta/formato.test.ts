import { describe, expect, it } from 'vitest'
import { diaMes, diaMesCorto, euros, eurosExactos, hoyEnMadrid, iniciales, listaPorcentajes } from '@/modules/conta/lib/formato'

// Los casos son los de las maquetas aprobadas (docs/conta/maquetas/): así es
// como tiene que verse, no como lo escribiría Intl.
describe('formato de la ficha, igual que la maqueta', () => {
  it('importes', () => {
    expect(euros(18420)).toBe('18.420 €')
    expect(euros(1283.15)).toBe('1.283,15 €')
    expect(euros(0)).toBe('0 €')
    expect(eurosExactos(964.4)).toBe('964,40 €')
    expect(eurosExactos(1102.75)).toBe('1.102,75 €')
    expect(eurosExactos(1234567.891)).toBe('1.234.567,89 €')
  })
  it('fechas', () => {
    expect(diaMes('2026-10-24')).toBe('24 oct')
    expect(diaMesCorto('2026-09-24')).toBe('24/09')
  })
  it('IVA habitual', () => {
    expect(listaPorcentajes([10, 21])).toBe('10 % y 21 %')
    expect(listaPorcentajes([4, 10, 21])).toBe('4 %, 10 % y 21 %')
    expect(listaPorcentajes([21])).toBe('21 %')
  })
  it('iniciales', () => {
    expect(iniciales('Hermanos Ruiz')).toBe('HR')
    expect(iniciales('AMIRSA')).toBe('AM')
    expect(iniciales('Panadería · Luna')).toBe('PL')
  })
  it('hoy es el día de Madrid, no el de UTC', () => {
    // 23:30 UTC del 30/09 son las 01:30 del 01/10 en Madrid (horario de verano).
    expect(hoyEnMadrid(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01')
  })
})
