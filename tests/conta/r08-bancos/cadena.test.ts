// tests/conta/r08-bancos/cadena.test.ts
//
// R08 · La cadena de extractos: el saldo del banco es el del último extracto, y el recibo que el
// banco no cobró sale por el hueco con el cierre del anterior. Con los casos reales del 19/11 y de
// los cargos que ya se cazaban, sin conceptos ni nombres: solo importes y fechas (de la medida
// del ensayo 44600555762, cuenta r08-bancos).
import { describe, expect, it } from 'vitest'
import { cadena, cargosNoCobrados, ultimoExtracto, type CargoDelExtracto, type EslabonExtracto } from '@/modules/conta/nucleo/bancos/cadena'

const c = (e: number) => Math.round(e * 100)
const ext = (id: string, hasta: string, subido: string, inicial: number, final: number): EslabonExtracto =>
  ({ id, hasta, subido, saldoInicialCent: c(inicial), saldoFinalCent: c(final) })
let n = 0
const mov = (extractoId: string, fecha: string, importe: number): CargoDelExtracto => ({ id: `m${String(++n).padStart(3, '0')}`, extractoId, fecha, importeCent: c(importe) })

describe('el saldo del banco: el último extracto de la cadena', () => {
  it('cuatro extractos el mismo día (Revolut, 19/11): el que llegó el último, no uno del medio', () => {
    const xs = [
      ext('045', '2026-11-19', '2026-11-19T12:22:00+01', 6668.93, 5353.99),
      ext('048', '2026-11-19', '2026-11-19T13:17:00+01', 1561.28, 549.22),
      ext('046', '2026-11-19', '2026-11-19T12:24:00+01', 5353.99, 3919.56),
      ext('047', '2026-11-19', '2026-11-19T12:24:30+01', 3919.56, 1561.28),
      ext('044', '2026-11-19', '2026-11-19T11:50:00+01', 4343.93, 6668.93),
    ]
    expect(ultimoExtracto(xs)?.saldoFinalCent).toBe(c(549.22))
  })
  it('hasta una fecha: el último que acaba ese día o antes; sin saldo no cuenta', () => {
    const xs = [ext('a', '2026-11-10', '2026-11-11T03:00:00+01', 0, 10), ext('b', '2026-11-20', '2026-11-21T03:00:00+01', 10, 20),
      { id: 'c', hasta: '2026-11-15', subido: '2026-11-16T03:00:00+01', saldoInicialCent: null, saldoFinalCent: null }]
    expect(ultimoExtracto(xs, '2026-11-15')?.id).toBe('a')
    expect(ultimoExtracto([], '2026-11-15')).toBeNull()
  })
})

describe('el recibo que el banco no cobró', () => {
  it('el caso real: el 11/11 cerró en 0,00; del 12 al 16/11, −31,50, −18,87, −0,30 y +19,17; apertura inventada 31,50 y cierre 0,00', () => {
    const xs = [ext('010', '2026-11-11', '2026-11-12T03:02:00+01', 195.39, 0), ext('011', '2026-11-16', '2026-11-17T03:02:00+01', 31.50, 0)]
    const movs = [mov('011', '2026-11-16', -31.50), mov('011', '2026-11-16', -18.87), mov('011', '2026-11-16', -0.30), mov('011', '2026-11-16', 19.17)]
    const eslabon = cadena(xs, movs).find((e) => e.extracto.id === '011')!
    expect(eslabon.huecoCent).toBe(c(31.50))
    const r = cargosNoCobrados(xs, movs)
    expect(r).toHaveLength(1)
    expect(r[0].cargos.map((m) => m.importeCent)).toEqual([c(-31.50)])
    expect(r[0].anterior.saldoFinalCent).toBe(0)
  })
  it('los tres que ya se cazaban en la 57200001 (21,16 del 05/11, 31,50 del 10/11 y 35,45 del 11/11) se siguen cazando', () => {
    const xs = [
      ext('006', '2026-11-04', '2026-11-05T03:02:00+01', 296.96, 0.64),
      ext('007', '2026-11-05', '2026-11-06T03:02:00+01', 21.80, 0.64),
      ext('008', '2026-11-09', '2026-11-10T03:02:00+01', 0.64, 159.94),
      ext('009', '2026-11-10', '2026-11-11T03:02:00+01', 191.44, 159.94),
      ext('010', '2026-11-11', '2026-11-12T03:02:00+01', 195.39, 0),
    ]
    const movs = [mov('007', '2026-11-05', -21.16), mov('008', '2026-11-09', 159.30), mov('009', '2026-11-10', -31.50),
      mov('010', '2026-11-11', -159.94), mov('010', '2026-11-11', -35.45)]
    const r = cargosNoCobrados(xs, movs)
    expect(r.map((x) => [x.extracto.id, x.cargos.map((m) => m.importeCent)])).toEqual([['007', [c(-21.16)]], ['009', [c(-31.50)]], ['010', [c(-35.45)]]])
  })
  it('lo apartado o lo que alguien dijo que es bueno ya no se señala', () => {
    const xs = [ext('a', '2026-11-11', '2026-11-12T03:00:00+01', 0, 0), ext('b', '2026-11-16', '2026-11-17T03:00:00+01', 31.50, 0)]
    expect(cargosNoCobrados(xs, [{ ...mov('b', '2026-11-16', -31.50), apartado: true }])).toEqual([])
    expect(cargosNoCobrados(xs, [{ ...mov('b', '2026-11-16', -31.50), esBueno: true }])).toEqual([])
  })
  it('un retraso del banco (el hueco y su contrario en la misma cuenta) no es un recibo sin cobrar', () => {
    // El −200,00 de ···0133 del 03-04/11: lo descontó un día y dio el movimiento al siguiente.
    const xs = [ext('3', '2026-11-02', '2026-11-03T03:02:00+01', 324.61, 319.34), ext('4', '2026-11-03', '2026-11-04T03:02:00+01', 119.34, 100.90),
      ext('5', '2026-11-04', '2026-11-05T03:02:00+01', 300.90, 2.11)]
    const movs = [mov('4', '2026-11-03', -13.41), mov('4', '2026-11-03', -5.03), mov('5', '2026-11-04', -200), mov('5', '2026-11-04', -98.79)]
    expect(cadena(xs, movs).map((e) => e.huecoCent)).toEqual([null, c(-200), c(200)])
    expect(cargosNoCobrados(xs, movs)).toEqual([])
  })
  it('si hay más de una forma de sumar el hueco, no se dice nada', () => {
    // Tres cargos de 10,00 y un hueco de 20,00: tres formas de sumarlo.
    const xs = [ext('a', '2026-11-11', '2026-11-12T03:00:00+01', 0, 0), ext('b', '2026-11-16', '2026-11-17T03:00:00+01', 20, -10)]
    const movs = [mov('b', '2026-11-16', -10), mov('b', '2026-11-16', -10), mov('b', '2026-11-16', -10)]
    expect(cadena(xs, movs)[1].huecoCent).toBe(2000)
    expect(cargosNoCobrados(xs, movs)).toEqual([])
  })
})
