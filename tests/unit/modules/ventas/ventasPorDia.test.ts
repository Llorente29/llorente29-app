import { describe, it, expect } from 'vitest'
import {
  agrupaPorDia, indicesDeLosPicos, letraDe, etiquetaCorta, ventanaDeDosSemanas,
} from '@/modules/ventas/home/ventasPorDia'

// La serie REAL del 20/08 al 02/09, medida en la base el 02/09.
const REAL: [string, number][] = [
  ['2026-08-20', 1879], ['2026-08-21', 2484], ['2026-08-22', 2663], ['2026-08-23', 3086],
  ['2026-08-24', 1086], ['2026-08-25', 1072], ['2026-08-26', 1030], ['2026-08-27', 1663],
  ['2026-08-28', 2425], ['2026-08-29', 2751], ['2026-08-30', 3327], ['2026-08-31', 1539],
  ['2026-09-01', 2078], ['2026-09-02', 387],
]
// Una venta al mediodía de cada día, con el importe del día.
const FILAS = REAL.map(([ymd, total]) => ({ total, sold_at: `${ymd}T10:00:00Z` }))

describe('agrupaPorDia', () => {
  it('devuelve los 14 días con su día de la semana', () => {
    const d = agrupaPorDia(FILAS, '2026-08-20', 14, '2026-09-02')
    expect(d).toHaveLength(14)
    expect(d[0]).toMatchObject({ ymd: '2026-08-20', total: 1879, diaSemana: 3, esFinde: false })
    expect(d[2]).toMatchObject({ ymd: '2026-08-22', diaSemana: 5, esFinde: true })
    expect(d[3]).toMatchObject({ ymd: '2026-08-23', diaSemana: 6, esFinde: true })
    expect(d[13]).toMatchObject({ ymd: '2026-09-02', total: 387, enCurso: true })
  })

  // Si un día sin ventas se omitiera, la gráfica tendría 13 barras y el eje
  // `L M X J V S D` dejaria de cuadrar: se leería el lunes en la barra del
  // martes y nadie se daría cuenta.
  it('un día SIN ventas sale igual, con su barra a cero', () => {
    const d = agrupaPorDia(
      [{ total: 100, sold_at: '2026-08-20T10:00:00Z' }], '2026-08-20', 3, '2026-08-22')
    expect(d.map(x => x.total)).toEqual([100, 0, 0])
    expect(d).toHaveLength(3)
  })

  // Regla 4: una venta a las 00:10 de Madrid está guardada como 22:10 UTC del
  // día anterior, y es del día siguiente.
  it('una venta de madrugada cuenta en el día del NEGOCIO, no en el de UTC', () => {
    const d = agrupaPorDia(
      [{ total: 50, sold_at: '2026-08-20T22:10:00Z' }], '2026-08-20', 2, '2026-08-21')
    expect(d[0].total).toBe(0)
    expect(d[1].total).toBe(50)
  })

  it('varias ventas del mismo día se suman y se cuentan', () => {
    const d = agrupaPorDia([
      { total: 10, sold_at: '2026-08-20T10:00:00Z' },
      { total: 15, sold_at: '2026-08-20T12:00:00Z' },
    ], '2026-08-20', 1, '2026-08-21')
    expect(d[0]).toMatchObject({ total: 25, pedidos: 2 })
  })
})

describe('indicesDeLosPicos', () => {
  it('los dos picos reales son los dos domingos', () => {
    const d = agrupaPorDia(FILAS, '2026-08-20', 14, '2026-09-02')
    const picos = indicesDeLosPicos(d)
    expect(picos.map(i => d[i].ymd).sort()).toEqual(['2026-08-23', '2026-08-30'])
  })

  // A las nueve de la mañana la barra de hoy es un palito; a medianoche seria
  // el pico. Dejarlo entrar haria saltar la etiqueta sin que nadie hubiera
  // vendido nada distinto.
  it('el día EN CURSO nunca es un pico, aunque vaya el más alto', () => {
    const d = agrupaPorDia([
      { total: 100, sold_at: '2026-08-20T10:00:00Z' },
      { total: 999, sold_at: '2026-08-21T10:00:00Z' },
    ], '2026-08-20', 2, '2026-08-21')
    expect(indicesDeLosPicos(d)).toEqual([0])
  })

  it('sin ventas no hay picos, y no se inventa ninguno', () => {
    const d = agrupaPorDia([], '2026-08-20', 14, '2026-09-02')
    expect(indicesDeLosPicos(d)).toEqual([])
  })
})

describe('rótulos', () => {
  it('el eje va L M X J V S D', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(letraDe)).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D'])
  })
  // El ejemplo literal de la maqueta.
  it('«Sáb 22», como el hover de la maqueta', () => {
    expect(etiquetaCorta('2026-08-22')).toBe('Sáb 22')
  })
})

describe('ventanaDeDosSemanas · empieza en LUNES', () => {
  // Si empezara en un día cualquiera, el eje `L M X J V S D` ×2 no cuadraría
  // con las barras y se leería el lunes en la columna del martes.
  it('el miércoles 2/09 arranca el lunes 24/08, no «hace 14 días»', () => {
    expect(ventanaDeDosSemanas(new Date('2026-09-02T08:00:00Z')))
      .toEqual({ desdeYmd: '2026-08-24', dias: 14 })
  })
  it('un lunes arranca el lunes anterior', () => {
    expect(ventanaDeDosSemanas(new Date('2026-08-31T10:00:00Z')).desdeYmd).toBe('2026-08-24')
  })
  it('un domingo sigue en su semana, no salta a la siguiente', () => {
    expect(ventanaDeDosSemanas(new Date('2026-09-06T20:00:00Z')).desdeYmd).toBe('2026-08-24')
  })
})

describe('los días que aún no han llegado', () => {
  // Cero es una venta que no hubo; futuro es un día que no ha pasado.
  // Confundirlos enseña una caída que no existe.
  it('se marcan como futuro y no como cero', () => {
    const d = agrupaPorDia([], '2026-08-31', 7, '2026-09-02')
    expect(d.map(x => x.futuro)).toEqual([false, false, false, true, true, true, true])
  })
  it('un día futuro nunca es un pico', () => {
    const d = agrupaPorDia(
      [{ total: 100, sold_at: '2026-08-31T10:00:00Z' }], '2026-08-31', 4, '2026-09-01')
    expect(indicesDeLosPicos(d)).toEqual([0])
  })
})
