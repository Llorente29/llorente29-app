// tests/unit/modules/conta/i01c/trimestreV4.test.ts
//
// I01c · Trimestre, maqueta v4 (20/10): la liquidación del 303 en palabras,
// lo comprobado (libro de IVA ↔ 303 y 111/115 ↔ 4751 y 621), las fechas del
// trimestre y los tipos del 303 como porcentaje. Cifras inventadas: las de
// Foodint de la maqueta no van al repositorio.

import { describe, expect, it } from 'vitest'
import {
  cuadreLibro303, cuadreRetenciones, fechasTrimestre, liquidacion303,
  type CasillaTrimestre, type FilaLibroTrimestre,
} from '@/modules/conta/impuestos/trimestre'
import { esCasillaDePorcentaje } from '@/modules/conta/impuestos/casillasModelos'

const cs = (o: Record<string, number>): CasillaTrimestre[] =>
  Object.entries(o).map(([casilla, valor]) => ({ casilla, valor, texto: null, origen: 'calculated', motivo: null }))

describe('las fechas de un trimestre', () => {
  it('del primer día al último, también febrero bisiesto', () => {
    expect(fechasTrimestre(2026, '1T')).toEqual({ desde: '2026-01-01', hasta: '2026-03-31' })
    expect(fechasTrimestre(2026, '2T')).toEqual({ desde: '2026-04-01', hasta: '2026-06-30' })
    expect(fechasTrimestre(2026, '3T')).toEqual({ desde: '2026-07-01', hasta: '2026-09-30' })
    expect(fechasTrimestre(2026, '4T')).toEqual({ desde: '2026-10-01', hasta: '2026-12-31' })
  })
})

describe('los tipos del 303 son porcentajes, no euros (punto 2)', () => {
  it('[02], [05], [08], los del recargo y los de 2025 en adelante', () => {
    for (const c of ['02', '05', '08', '151', '154', '166', '17', '20', '23', '157', '169']) expect(esCasillaDePorcentaje('303', c), c).toBe(true)
    expect(esCasillaDePorcentaje('303', '2')).toBe(true)
    expect(esCasillaDePorcentaje('303', '65')).toBe(true)
  })
  it('las bases y cuotas, no', () => {
    for (const c of ['01', '03', '06', '09', '27', '29', '45', '46', '71', '110']) expect(esCasillaDePorcentaje('303', c), c).toBe(false)
  })
  it('en los otros modelos, solo la [17] del 202', () => {
    expect(esCasillaDePorcentaje('202', '17')).toBe(true)
    expect(esCasillaDePorcentaje('111', '02')).toBe(false)
    expect(esCasillaDePorcentaje('115', '02')).toBe(false)
  })
})

describe('la liquidación del 303 en palabras', () => {
  const l = liquidacion303(cs({
    '01': 1000, '02': 4, '03': 40, '04': 20000, '05': 10, '06': 2000, '07': 3000, '08': 21, '09': 630,
    '10': 500, '11': 105, '27': 2775, '28': 9000, '29': 1500, '36': 500, '37': 105, '45': 1605, '46': 1170, '71': 1170,
  }))
  it('«IVA que cobras»: una fila por tipo, con su porcentaje y sus casillas', () => {
    expect(l.cobras.map((f) => [f.texto, f.base, f.cuota, f.casillas.join(' ')])).toEqual([
      ['Ventas al 4 %', 1000, 40, '01 03'],
      ['Ventas al 10 %', 20000, 2000, '04 06'],
      ['Ventas al 21 %', 3000, 630, '07 09'],
      ['Adquisiciones intracomunitarias (autoliquidadas)', 500, 105, '10 11'],
    ])
    expect(l.totalCobras).toBe(2775)
  })
  it('«IVA que deduces», y el resultado', () => {
    expect(l.deduces.map((f) => [f.texto, f.base, f.cuota])).toEqual([
      ['Compras y gastos corrientes', 9000, 1500],
      ['Adquisiciones intracomunitarias corrientes', 500, 105],
    ])
    expect([l.totalDeduces, l.diferencia, l.resultado]).toEqual([1605, 1170, 1170])
  })
  it('lo que está a cero no sale aquí (sigue en «Ver las casillas»); sin casillas, todo vacío', () => {
    expect(liquidacion303(cs({ '07': 0, '08': 21, '09': 0 })).cobras).toEqual([])
    expect(liquidacion303([])).toEqual({ cobras: [], totalCobras: null, deduces: [], totalDeduces: null, diferencia: null, resultado: null })
  })
  it('un tipo con decimales va con coma', () => {
    expect(liquidacion303(cs({ '16': 100, '17': 5.2, '18': 5.2 })).cobras[0].texto).toBe('Recargo de equivalencia al 5,2 %')
  })
})

describe('lo comprobado del 303: el libro de IVA contra sus cuotas', () => {
  const f = (x: Partial<FilaLibroTrimestre>): FilaLibroTrimestre =>
    ({ book: 'received', tax_rate: 21, tax_amount: 0, reverse_charge: false, operation_key: '01', investment_good: false, ...x })
  const libro = [
    f({ book: 'issued', tax_rate: 10, tax_amount: 1200.1 }), f({ book: 'issued', tax_rate: 10, tax_amount: 799.9 }),
    f({ book: 'issued', tax_rate: 21, tax_amount: 630 }),
    f({ tax_amount: 1000.01 }), f({ tax_rate: 10, tax_amount: 499.99 }),
    f({ reverse_charge: true, operation_key: '09', tax_amount: 105 }),
    f({ investment_good: true, tax_amount: 300 }),
  ]
  it('casa cuota a cuota al céntimo; la intracomunitaria va a la [11] y a la [37]; el bien de inversión no va a la [29]', () => {
    const r = cuadreLibro303(libro, cs({ '06': 2000, '09': 630, '11': 105, '29': 1500, '37': 105 }))
    expect(r.map((x) => [x.casilla, x.libro, x.presentado, x.casa])).toEqual([
      ['06', 2000, 2000, true], ['09', 630, 630, true], ['11', 105, 105, true], ['29', 1500, 1500, true], ['37', 105, 105, true],
    ])
  })
  it('una factura deducida en otro trimestre: la [29] no casa y se ve la diferencia', () => {
    const r = cuadreLibro303(libro, cs({ '06': 2000, '09': 630, '11': 105, '29': 1250.5, '37': 105 }))
    expect(r.find((x) => x.casilla === '29')).toMatchObject({ libro: 1500, presentado: 1250.5, casa: false })
  })
  it('una casilla con algo en el 303 y nada en el libro sale, y no casa', () => {
    expect(cuadreLibro303([], cs({ '03': 40 }))).toEqual([{ casilla: '03', texto: 'IVA de las ventas al 4 %', libro: 0, presentado: 40, casa: false }])
  })
})

describe('los cuadres del 111 y el 115 con el diario', () => {
  const cuentas = [
    { codigo: '47510000', nombre: 'HP acreedora por retenciones', debe: 900, haber: 1234.56 },
    { codigo: '47510019', nombre: 'HP acreedora retenciones alquileres', debe: 0, haber: 380 },
    { codigo: '62100000', nombre: 'Arrendamientos', debe: 2500, haber: 0 },
  ]
  it('el 111: lo retenido [28] casa con el haber de una subcuenta de la 4751', () => {
    const r = cuadreRetenciones('111', cs({ '28': 1234.56 }), cuentas.slice(0, 2))
    expect(r.conclusion).toEqual({ casa: true, texto: 'Lo retenido casa con el haber de la 47510000 en el trimestre.' })
    expect(r.lineas.map((x) => [x.importe, x.casa])).toEqual([[1234.56, undefined], [1234.56, true], [380, false]])
  })
  it('el 111 sin [28] usa la [30]', () => {
    expect(cuadreRetenciones('111', cs({ '30': 380 }), cuentas).conclusion?.texto).toContain('47510019')
  })
  it('el 115: [03] contra la 4751 y la [02] contra lo cargado en la 621, que puede no casar sin ser un error', () => {
    const r = cuadreRetenciones('115', cs({ '02': 2000, '03': 380 }), cuentas)
    expect(r.conclusion?.casa).toBe(true)
    expect(r.lineas.at(-2)).toMatchObject({ texto: 'Base de las retenciones del 115', importe: 2000, casillas: '[02]' })
    expect(r.lineas.at(-1)).toMatchObject({ importe: 2500, casa: false })
  })
  it('sin movimientos en la 4751 lo dice; sin lo retenido, no hay cuadre', () => {
    expect(cuadreRetenciones('111', cs({ '28': 10 }), []).conclusion).toEqual({ casa: false, texto: 'El diario no tiene movimientos de la 4751 en el trimestre.' })
    expect(cuadreRetenciones('111', cs({ '29': 10 }), cuentas)).toEqual({ lineas: [], conclusion: null })
    expect(cuadreRetenciones('202', cs({ '28': 10 }), cuentas)).toEqual({ lineas: [], conclusion: null })
  })
})
