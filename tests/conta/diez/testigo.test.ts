// El testigo de sumas y saldos de Diez (regla 1). Datos INVENTADOS con la
// forma medida en los cuatro Excel de la C0008 (T2 §10): cabecera en dos
// filas, importes como texto «3,000.00», un haber negativo, una subcuenta con
// todo en blanco y la fila TOTALES.

import { describe, expect, it } from 'vitest'
import { canonicoTestigo, centimosDe, compararTestigo, huellaTestigo, leerTestigo, type CuentaFolvy } from '../../../supabase/functions/_shared/diezTestigo'

const CAB = [
  ['Datos Balance de sumas y saldos', null, null, null, null, null, null],
  [null, null, null, '______Datos acumulados______', null, null, null],
  ['Subcuenta', null, null, 'Debe', 'Haber', 'Deudor', 'Acreedor'],
]
const fila = (c: string, d: string | number | null, h: string | number | null, sd: string | number | null, sa: string | number | null) => [c, 'NOMBRE INVENTADO', null, d, h, sd, sa]
const EXCEL = [
  ...CAB,
  fila('10000000', null, '3,000.00', null, '3,000.00'),
  fila('43000001', '1,500.50', '1,000.00', '500.50', null),
  fila('70800000', null, '-24.79', '24.79', null),
  fila('52100000', null, null, null, null),
  fila('57200001', '2,524.29', null, '2,524.29', null),
  [null, null, 'TOTALES:', 4024.79, '3,975.21', 3049.58, '3,000.00'],
]

describe('centimosDe', () => {
  it.each([
    ['3,000.00', 300000], ['-1,024.79', -102479], ['3.000,00', 300000], ['0.73', 73], [1041466.21, 104146621], [null, 0], ['', 0], ['1,2,3', null], ['abc', null],
  ] as [unknown, number | null][])('%j → %j', (v, c) => { expect(centimosDe(v)).toBe(c) })
})

describe('leerTestigo', () => {
  it('lee la forma medida: una fila por subcuenta, saldo = debe − haber, negativos y filas en blanco', () => {
    // El TOTALES inventado no cuadra a propósito en debe/haber: se mira abajo.
    const t = leerTestigo(EXCEL)
    expect(t.cuentas.get('10000000')).toEqual({ debe: 0, haber: 300000, saldo: -300000 })
    expect(t.cuentas.get('70800000')).toEqual({ debe: 0, haber: -2479, saldo: 2479 })
    expect(t.cuentas.get('52100000')).toEqual({ debe: 0, haber: 0, saldo: 0 })
    expect(t.cuentas.size).toBe(5)
  })

  it('con un TOTALES que cuadra no hay problemas', () => {
    const ok = [...EXCEL.slice(0, -1), [null, null, 'TOTALES:', '4,024.79', '3,975.21', '3,049.58', '3,000.00']]
    // 4.024,79 ≠ 3.975,21: el inventado no está equilibrado, y eso también se dice.
    expect(leerTestigo(ok).problemas).toEqual(['TOTALES: el debe no es igual al haber'])
    const cuadrado = [
      ...CAB,
      fila('10000000', null, '3,000.00', null, '3,000.00'),
      fila('57200001', '3,000.00', null, '3,000.00', null),
      [null, null, 'TOTALES:', 3000, '3,000.00', 3000, '3,000.00'],
    ]
    expect(leerTestigo(cuadrado).problemas).toEqual([])
  })

  it('dice lo que no cuadra: saldo de una fila, filas contra TOTALES, repetidas, sin cabecera', () => {
    const malo = [...CAB, fila('43000001', '100.00', '40.00', '50.00', null), fila('43000001', '1.00', null, '1.00', null), [null, null, 'TOTALES:', 999, 999, 0, 0]]
    expect(leerTestigo(malo).problemas).toEqual([
      '43000001: el saldo no es debe − haber',
      '43000001: sale dos veces',
      'las filas no suman el debe y el haber de TOTALES',
      'las filas no suman los saldos de TOTALES',
    ])
    expect(leerTestigo([['a', 'b']]).problemas).toEqual(['no hay cabecera con Debe, Haber, Deudor y Acreedor'])
  })
})

describe('compararTestigo', () => {
  const T = leerTestigo(EXCEL).cuentas
  const F = (o: Record<string, [number, number, number?]>) => new Map<string, CuentaFolvy>(Object.entries(o).map(([k, [debe, haber, negativos = 0]]) => [k, { debe, haber, negativos }]))

  it('igual al céntimo, y el negativo movido se acepta solo si explica exactamente la diferencia', () => {
    const r = compararTestigo(T, F({ '10000000': [0, 300000], '43000001': [150050, 100000], '70800000': [2479, 0, 2479], '57200001': [252429, 0] }))
    expect(r.resumen).toEqual({ igual: 4, igual_con_negativos: 1 })
    expect(r.cuadra).toBe(true)
  })

  it('cada diferencia con su estado', () => {
    const r = compararTestigo(T, F({ '10000000': [0, 300001], '43000001': [160050, 110000], '70800000': [2479, 0, 0], '99999999': [100, 0] }))
    const e = Object.fromEntries(r.filas.map((x) => [x.cuenta, x.estado]))
    expect(e).toEqual({
      '10000000': 'saldo_distinto',
      '43000001': 'sumas_distintas',
      '52100000': 'igual',
      '57200001': 'solo_testigo',
      '70800000': 'sumas_distintas', // saldo igual, pero no consta lo movido
      '99999999': 'solo_folvy',
    })
    expect(r.cuadra).toBe(false)
  })

  it('matiz 3: debe igual a haber o vacía es saldo cero, no subcuenta que falta', () => {
    const t = leerTestigo([...CAB, fila('55100001', '28.00', '28.00', null, null), fila('52100000', null, null, null, null), fila('10000000', null, '1.00', null, '1.00'), [null, null, 'TOTALES:', 28, 29, 0, 1]]).cuentas
    const r = compararTestigo(t, F({ '10000000': [0, 100], '47200000': [3545, 3545] }))
    const e = Object.fromEntries(r.filas.map((x) => [x.cuenta, x.estado]))
    expect(e).toEqual({
      '10000000': 'igual',
      '47200000': 'saldo_cero', // en Folvy con debe = haber, y el Excel no la trae
      '52100000': 'igual', // vacía en el Excel y sin nada en Folvy
      '55100001': 'saldo_cero', // en el Excel con debe = haber, y Folvy no la trae
    })
    expect(r.cuadra).toBe(true)
    // Con saldo, faltar sí es faltar.
    expect(compararTestigo(t, F({ '10000000': [0, 100], '47200000': [3545, 0] })).filas.find((x) => x.cuenta === '47200000')!.estado).toBe('solo_folvy')
  })
})

describe('huella del testigo', () => {
  it('una línea por subcuenta con importe, ordenadas, en céntimos; las vacías no cuentan', async () => {
    const t = leerTestigo(EXCEL).cuentas
    expect(canonicoTestigo(t)).toBe('10000000:0:300000\n43000001:150050:100000\n57200001:252429:0\n70800000:0:-2479')
    const otraVez = new Map([...t.entries()].reverse())
    expect(await huellaTestigo(otraVez)).toBe(await huellaTestigo(t)) // el orden de entrada no importa
    const unCentimo = new Map(t); unCentimo.set('57200001', { debe: 252430, haber: 0, saldo: 252430 })
    expect(await huellaTestigo(unCentimo)).not.toBe(await huellaTestigo(t))
    // Igual que la de la base: sha256 en hexadecimal de esa misma cadena.
    expect(await huellaTestigo(t)).toMatch(/^[0-9a-f]{64}$/)
  })
})
