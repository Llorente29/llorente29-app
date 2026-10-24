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

import { cruce } from '../../../scripts/conta/diez/libros-iva-lectura'
describe('libros de IVA de Diez · el cruce con Sumied', () => {
  const asientos = [
    { e: '2026', s: '1', n: 10, f: '20260115', c477: 1000, c472: 0 },
    { e: '2026', s: '1', n: 11, f: '20260116', c477: 500, c472: 0 },
    { e: '2026', s: '2', n: 20, f: '20260801', c477: 0, c472: 2100 },
    { e: '2026', s: '2', n: 21, f: '20260802', c477: 0, c472: 900 },
    { e: '2026', s: '4', n: 30, f: '20260930', c477: 0, c472: 0 },
  ]
  const facturas = [
    { Ejercicio: '2026', Serie: '1', Documento: 10, Fecha: 20260115, BaseImponible1: 100, PorcentajeIVA1: 10, CuotaIVA1: 10 },
    { Ejercicio: '2026', Serie: '1', Documento: 11, Fecha: 20260116, BaseImponible1: 40, PorcentajeIVA1: 10, CuotaIVA1: 4 },
    { Ejercicio: '2026', Serie: '2', Documento: 20, Fecha: 20260801, BaseImponible1: -100, PorcentajeIVA1: 21, CuotaIVA1: -21 },
    { Ejercicio: '2026', Serie: '2', Documento: 99, Fecha: 20260803, BaseImponible1: 10, PorcentajeIVA1: 21, CuotaIVA1: 2.1 },
  ]
  const g = cruce(facturas, asientos)
  it('casa por ejercicio, serie y documento, y compara la cuota con la 477 o la 472', () => {
    expect(g.get('expedidas.1t')).toEqual({ casan: 1, distinta: [11], mismaEnValorAbsoluto: 0, sinAsiento: [], asientoSinFactura: [] })
  })
  it('separa lo que solo cambia de signo, la factura sin asiento y el asiento con IVA sin factura', () => {
    expect(g.get('recibidas.3t')).toEqual({ casan: 0, distinta: [20], mismaEnValorAbsoluto: 1, sinAsiento: [99], asientoSinFactura: [21] })
  })
  it('un asiento sin IVA no cuenta como «sin factura»', () => {
    expect([...g.keys()].some((k) => k.startsWith('serie4'))).toBe(false)
  })
})

import { diasEntre } from '../../../scripts/conta/diez/libros-iva-lectura'
describe('libros de IVA de Diez · día a día', () => {
  it('de enero a septiembre de 2026 son 273 días, del 1/1 al 30/9, con los febreros y los fines de mes bien', () => {
    const d = diasEntre('202601', '202609')
    expect(d.length).toBe(273)
    expect(d[0]).toBe(20260101)
    expect(d.at(-1)).toBe(20260930)
    expect(d).toContain(20260228)
    expect(d).not.toContain(20260229)
    expect(new Set(d).size).toBe(273)
  })
})

import { tramosDocumento } from '../../../scripts/conta/diez/libros-iva-lectura'
describe('libros de IVA de Diez · un día lleno, en tramos de documento', () => {
  it('cubre del 1 al máximo sin huecos ni solapes', () => {
    const t = tramosDocumento(9999, 150)
    expect(t[0]).toEqual([1, 150])
    expect(t.at(-1)).toEqual([9901, 9999])
    for (let i = 1; i < t.length; i++) expect(t[i][0]).toBe(t[i - 1][1] + 1)
    expect(t.length).toBe(67)
  })
})
