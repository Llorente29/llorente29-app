// G04 · Tarea 4 · El próximo cobro de GoCardless (Julio, nº 11 y nº 12): en
// grande, el total de los próximos 30 días; debajo, el día principal y «otros
// días»; en «Las dos», una línea por empresa. Nunca la primera fecha sola.
// Importes inventados con la forma del caso de QBO del 08/11 (el primer día,
// pequeño; el grande, el 4).
import { describe, expect, it } from 'vitest'
import { proximoCobro, type SiguienteCobro } from '../../../../../../supabase/functions/_shared/tarifa/proximoCobro'

const Q = { id: 'qbo', nombre: 'QBO Prueba' }
const A = { id: 'anny', nombre: 'Anny Prueba' }
const s = (empresaId: string, fecha: string | null, importeCent: number): SiguienteCobro => ({ empresaId, fecha, importeCent })
const xs: SiguienteCobro[] = [
  ...Array.from({ length: 5 }, () => s('qbo', '2026-11-16', 3630)), // el primer día: 5 · 181,50 €
  ...Array.from({ length: 4 }, () => s('qbo', '2026-12-04', 7600)), // el grande: 4 · 304,00 €
  s('qbo', '2026-12-01', 2420),
  s('qbo', '2027-01-04', 6050), // fuera de los 30 días
  s('qbo', '2026-11-01', 6050), // ya pasado
  s('qbo', null, 6050), // sin fecha
  ...Array.from({ length: 2 }, () => s('anny', '2026-12-04', 4840)),
]

describe('G04 · el próximo cobro de GoCardless', () => {
  it('en grande, el total de los próximos 30 días', () => {
    const p = proximoCobro(xs, [Q], '2026-11-08')
    expect(p.total).toEqual({ cobros: 10, importeCent: 18150 + 30400 + 2420 })
    expect(p.titulo).toBe('10 cobros · 509,70 €')
    expect(p.sinFecha).toBe(1)
  })
  it('debajo, el día principal (el de más importe, no el primero) y «otros días»', () => {
    const p = proximoCobro(xs, [Q], '2026-11-08')
    expect(p.porEmpresa[0].principal).toEqual({ fecha: '2026-12-04', cobros: 4, importeCent: 30400 })
    expect(p.desglose).toEqual(['4 dic.: 4 cobros · 304 € · otros días: 6 cobros · 206 €'])
  })
  it('en «Las dos», el total de las dos y una línea por empresa', () => {
    const p = proximoCobro(xs, [Q, A], '2026-11-08')
    expect(p.titulo).toBe('12 cobros · 606,50 €')
    expect(p.desglose).toEqual([
      'QBO Prueba · 4 dic.: 4 cobros · 304 € · otros días: 6 cobros · 206 €',
      'Anny Prueba · 4 dic.: 2 cobros · 97 €',
    ])
  })
  it('los miles con su punto, también con cuatro cifras', () => {
    const p = proximoCobro(Array.from({ length: 1060 }, () => s('qbo', '2026-12-04', 100000)), [Q], '2026-11-08')
    expect([p.titulo, p.desglose[0]]).toEqual(['1.060 cobros · 1.060.000,00 €', '4 dic.: 1.060 cobros · 1.060.000 €'])
  })
  it('ya sumados por día (la base, 2308), lo mismo que uno a uno', () => {
    const p = proximoCobro([{ empresaId: 'qbo', fecha: '2026-12-04', importeCent: 106000000, cobros: 1060 }, { empresaId: 'qbo', fecha: null, importeCent: 0, cobros: 3 }], [Q], '2026-11-08')
    expect([p.titulo, p.desglose[0], p.sinFecha]).toEqual(['1.060 cobros · 1.060.000,00 €', '4 dic.: 1.060 cobros · 1.060.000 €', 3])
  })
  it('sin cobros en 30 días, lo dice', () => {
    expect(proximoCobro([], [Q], '2026-11-08')).toMatchObject({ titulo: 'Ningún cobro en los próximos 30 días', desglose: ['Ningún cobro en 30 días'] })
  })
})
