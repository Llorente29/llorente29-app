// tests/conta/x31-erp10/intercalados.test.ts
//
// X31 · 2 · Antes de enviar: los asientos del mes en ERP10 que no ha escrito ni enlazado Sumied, por serie
// (supabase/functions/_shared/erp10Intercalados.ts). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { avisoIntercalados, deFuera } from '../../../supabase/functions/_shared/erp10Intercalados'

const a = (Serie: string, Documento: number) => ({ Serie, Documento, Fecha: 20261105 })

describe('lo que hay en ERP10 que no es de Sumied', () => {
  it('por serie, los números de fuera en orden, y cuántos son de Sumied', () => {
    const xs = deFuera([a('1', 12), a('1', 10), a('1', 11), a('2', 50), a('2', 51), a('1', 15)],
      [{ serie: '1', documento: 10 }, { serie: '1', documento: 11 }, { serie: '2', documento: 50 }, { serie: '2', documento: 51 }])
    expect(xs).toEqual([{ serie: '1', cuantos: 2, numeros: [12, 15], deSumied: 2 }])
  })
  it('lo que salió con el Excel o se enlazó, también es conocido; el mismo número en otra serie, no', () => {
    expect(deFuera([a('1', 10), a('3', 10)], [{ serie: '1', documento: 10 }])).toEqual([{ serie: '3', cuantos: 1, numeros: [10], deSumied: 0 }])
  })
  it('todo de Sumied, o nada en ERP10: no hay aviso', () => {
    expect(deFuera([a('1', 10)], [{ serie: '1', documento: 10 }])).toEqual([])
    expect(avisoIntercalados([], 'noviembre de 2026')).toBeNull()
    expect(deFuera([{ Serie: '1', Documento: 'x' }], [])).toEqual([])
  })
})

describe('el aviso antes de mandar', () => {
  it('uno solo', () => {
    expect(avisoIntercalados([{ serie: '1', cuantos: 1, numeros: [12], deSumied: 3 }], 'noviembre de 2026')).toBe(
      'En ERP10 ya hay 1 asiento de noviembre de 2026 que no ha escrito Sumied (en la serie 1, el 12). '
      + 'Lo que salga ahora coge los números siguientes de ERP10 y queda intercalado con ese: si alguien está metiendo asientos a mano en ERP10, mejor que pare mientras sale.')
  })
  it('varios, en dos series, y si son muchos, los cinco primeros y cuántos más', () => {
    const t = avisoIntercalados([{ serie: '1', cuantos: 2, numeros: [12, 15], deSumied: 0 }, { serie: '2', cuantos: 7, numeros: [1, 2, 3, 4, 5, 6, 7], deSumied: 0 }], 'noviembre de 2026')
    expect(t).toContain('hay 9 asientos de noviembre de 2026 que no ha escrito Sumied (en la serie 1, 2: los 12 y 15; en la serie 2, 7: los 1, 2, 3, 4, 5 y 2 más)')
    expect(t).toContain('intercalado con esos')
  })
})
