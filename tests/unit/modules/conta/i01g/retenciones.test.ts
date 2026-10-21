// tests/unit/modules/conta/i01g/retenciones.test.ts
//
// I01g · El 111 y el 115 calculados por Sumied: la liquidación en palabras, lo
// comprobado contra el diario (con la explicación de una diferencia en la base
// de las nóminas, como el 1T de Foodint) y la frase al calcular. Cifras
// inventadas: las de Foodint no van al repositorio. La forma del diario es la
// que devuelve conta_impuesto_retenciones_diario (0330).

import { describe, expect, it } from 'vitest'
import {
  cuadreConDiario, fraseCalculoRetenciones, liquidacionRetenciones,
  type CasillaTrimestre, type RetencionesDiario,
} from '@/modules/conta/impuestos/trimestre'

const cs = (o: Record<string, number>): CasillaTrimestre[] =>
  Object.entries(o).map(([casilla, valor]) => ({ casilla, valor, texto: null, origen: casilla === '01' ? 'manual' : 'calculated', motivo: null }))

const diario = (o: Partial<RetencionesDiario['sumas']> = {}, extra: Partial<RetencionesDiario> = {}): RetencionesDiario => ({
  desde: '2026-10-01', hasta: '2026-12-31', asientos: [],
  sumas: {
    '115': { asientos: 0, base: 0, retenido: 0, perceptores: 0 },
    '111_nomina': { asientos: 0, base: 0, retenido: 0 },
    '111_profesional': { asientos: 0, base: 0, retenido: 0, perceptores: 0 },
    sin_modelo: { asientos: 0, retenido: 0 }, pagos: 0, aperturas: 0, ...o,
  },
  lineas_640: [], cuenta_621: 0, cuentas_4751: [], ...extra,
})

describe('la liquidación del 111 en palabras', () => {
  it('nóminas y profesionales, con cuántos, la base y lo retenido; el total y el resultado', () => {
    const l = liquidacionRetenciones('111', cs({ '01': 5, '02': 10000, '03': 200, '07': 1, '08': 1000, '09': 150, '28': 350, '30': 350 }))
    expect(l.filas.map((f) => [f.texto, f.perceptores, f.base, f.retenido, f.casillas.join(' ')])).toEqual([
      ['Nóminas', 5, 10000, 200, '01 02 03'],
      ['Profesionales', 1, 1000, 150, '07 08 09'],
    ])
    expect([l.total, l.casillaTotal, l.resultado, l.casillaResultado]).toEqual([350, '28', 350, '30'])
  })
  it('sin la [01] la fila de las nóminas sale igual, con los perceptores por escribir', () => {
    const l = liquidacionRetenciones('111', cs({ '02': 10000, '03': 200, '28': 200, '30': 200 }))
    expect(l.filas).toEqual([{ texto: 'Nóminas', perceptores: null, base: 10000, retenido: 200, casillas: ['01', '02', '03'] }])
  })
  it('sin nada retenido, ninguna fila', () => {
    expect(liquidacionRetenciones('111', cs({ '28': 0, '30': 0 })).filas).toEqual([])
  })
})

describe('la liquidación del 115 en palabras', () => {
  it('los alquileres, con los arrendadores; resultado en la [05]', () => {
    const l = liquidacionRetenciones('115', cs({ '01': 2, '02': 3000, '03': 570, '05': 570 }))
    expect(l.filas.map((f) => [f.texto, f.perceptores, f.base, f.retenido])).toEqual([['Alquileres de locales', 2, 3000, 570]])
    expect([l.total, l.casillaTotal, l.resultado, l.casillaResultado]).toEqual([570, '03', 570, '05'])
  })
})

describe('lo comprobado del 111 contra el diario', () => {
  const nominas = { '111_nomina': { asientos: 3, base: 10000, retenido: 200 } }
  it('casa casilla a casilla', () => {
    const c = cuadreConDiario('111', cs({ '01': 5, '02': 10000, '03': 200, '28': 200, '30': 200 }), diario(nominas))
    expect(c.casa).toBe(true)
    expect(c.lineas.map((l) => [l.casillas, l.modelo, l.diario, l.casa])).toEqual([
      ['[02]', 10000, 10000, true], ['[03]', 200, 200, true], ['[28]', 200, 200, true],
    ])
    expect(c.explicacion).toEqual([])
  })
  it('una base distinta que es justo una línea de la 640: no casa, dice cuál y no bloquea (el caso del 1T)', () => {
    const d = diario({ '111_nomina': { asientos: 3, base: 10123.45, retenido: 200 } }, {
      lineas_640: [
        { asiento: 'a', fecha: '2026-11-30', importe: 3333.33, concepto: null },
        { asiento: 'a', fecha: '2026-11-30', importe: 123.45, concepto: null },
      ],
    })
    const c = cuadreConDiario('111', cs({ '02': 10000, '03': 200, '28': 200, '30': 200 }), d)
    expect(c.casa).toBe(false)
    expect(c.lineas.find((l) => l.casillas === '[02]')!.casa).toBe(false)
    expect(c.lineas.find((l) => l.casillas === '[03]')!.casa).toBe(true)
    expect(c.explicacion).toHaveLength(1)
    expect(c.explicacion[0]).toContain('123,45 € más que la base del 111')
    expect(c.explicacion[0]).toContain('Es justo una línea de la 640 de la nómina del 30/11 (123,45 €)')
    expect(c.explicacion[0]).toContain('No bloquea nada.')
  })
  it('una diferencia que no es una línea: se dice la diferencia sin inventar de dónde sale', () => {
    const c = cuadreConDiario('111', cs({ '02': 10000, '03': 200, '28': 200 }), diario({ '111_nomina': { asientos: 1, base: 10050, retenido: 200 } }))
    expect(c.explicacion[0]).toContain('50,00 € más')
    expect(c.explicacion[0]).not.toContain('Es justo una línea')
  })
  it('los profesionales cuentan perceptores del diario', () => {
    const c = cuadreConDiario('111', cs({ '07': 2, '08': 1000, '09': 150, '28': 150 }), diario({ '111_profesional': { asientos: 2, base: 1000, retenido: 150, perceptores: 2 } }))
    expect(c.lineas.map((l) => [l.casillas, l.casa, l.personas])).toEqual([['[07]', true, true], ['[08]', true, false], ['[09]', true, false], ['[28]', true, false]])
  })
  it('un asiento con la 4751 sin modelo se dice', () => {
    const c = cuadreConDiario('111', cs({ '28': 0 }), diario({ sin_modelo: { asientos: 1, retenido: 10 } }))
    expect(c.explicacion).toEqual(['1 asiento mueve la 4751 sin gasto ni nómina (10,00 € retenidos): Sumied no sabe si va en el 111 o en el 115.'])
  })
})

describe('lo comprobado del 115 contra el diario', () => {
  it('arrendadores, base y retención; la 621 con alquileres sin retención se explica, no es un error', () => {
    const c = cuadreConDiario('115', cs({ '01': 2, '02': 3000, '03': 570, '05': 570 }),
      diario({ '115': { asientos: 6, base: 3000, retenido: 570, perceptores: 2 } }, { cuenta_621: 3800 }))
    expect(c.casa).toBe(true)
    expect(c.lineas.map((l) => [l.casillas, l.modelo, l.diario])).toEqual([['[01]', 2, 2], ['[02]', 3000, 3000], ['[03]', 570, 570]])
    expect(c.explicacion).toEqual(['La 621 del trimestre suma 3.800,00 €: 800,00 € son alquileres sin retención (un renting, por ejemplo), que no van en el 115.'])
  })
  it('un arrendador de menos no casa', () => {
    const c = cuadreConDiario('115', cs({ '01': 1, '02': 3000, '03': 570 }), diario({ '115': { asientos: 6, base: 3000, retenido: 570, perceptores: 2 } }, { cuenta_621: 3000 }))
    expect(c.casa).toBe(false)
    expect(c.lineas[0]).toMatchObject({ casillas: '[01]', modelo: 1, diario: 2, casa: false })
  })
})

describe('lo que dice la pantalla al calcular (regla 8)', () => {
  it('con la cifra, y lo que falta', () => {
    expect(fraseCalculoRetenciones('111', '4T', { importe: 350, resultado: 'to_pay', falta_perceptores: true }))
      .toBe('Calculado el 111 del 4T desde el diario: 350,00 € a ingresar. Falta escribir cuántas personas cobraron nómina ([01]).')
    expect(fraseCalculoRetenciones('115', '4T', { importe: 570, resultado: 'to_pay' })).toBe('Calculado el 115 del 4T desde el diario: 570,00 € a ingresar.')
    expect(fraseCalculoRetenciones('115', '4T', { importe: 0, resultado: 'no_activity' })).toBe('Calculado el 115 del 4T desde el diario: sin retenciones en el diario.')
  })
})
