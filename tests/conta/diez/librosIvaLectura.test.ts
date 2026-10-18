// I01b · La lectura de los libros de IVA de Diez: sus funciones puras.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { cent, huella, trimestre, tramos } from '../../../scripts/conta/diez/libros-iva-lectura'

describe('libros de IVA de Diez · lectura', () => {
  it('el trimestre sale de la fecha AAAAMMDD', () => {
    expect([20260101, 20260331, 20260401, 20260630, 20260701, 20260930, 20261001].map(trimestre)).toEqual([1, 1, 2, 2, 3, 3, 4])
  })
  it('los céntimos redondean el double de Diez', () => {
    expect(cent(13.6)).toBe(1360)
    expect(cent(0.1 + 0.2)).toBe(30)
    expect(cent(-5)).toBe(-500)
    expect(cent(undefined)).toBe(0)
  })
  it('los tramos: hasta 8, solo los que tienen base o cuota', () => {
    const f = { BaseImponible1: 100, PorcentajeIVA1: 10, CuotaIVA1: 10, BaseImponible2: 50, PorcentajeIVA2: 21, CuotaIVA2: 10.5, BaseImponible3: 0, CuotaIVA3: 0, BaseImponible8: 1, PorcentajeIVA8: 0, CuotaIVA8: 0 }
    expect(tramos(f)).toEqual([{ base: 10000, tipo: 10, cuota: 1000 }, { base: 5000, tipo: 21, cuota: 1050 }, { base: 100, tipo: 0, cuota: 0 }])
  })
  it('la huella es la que se calcula fuera, del mismo texto', () => {
    expect(huella('985747')).toBe(createHash('md5').update('985747').digest('hex').slice(0, 16))
    expect(huella('985747')).toMatch(/^[0-9a-f]{16}$/)
  })
})
