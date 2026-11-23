// tests/unit/modules/conta/k11b/fichaErp10.test.ts
//
// K11b · Lo que calcula la recibida copiada de ERP10: la suma de control de las contrapartidas, las filas de «Pago
// factura» con lo pendiente, la visualización del asiento y la cuadrícula del IVA. Importes de la maqueta 18b y de la
// prueba de staging del K10c (121 en 60 + 61).

import { describe, expect, it } from 'vitest'
import { aVisual, cuadriculaIva, filasDePago, otraLinea, otroPago, rotuloDeLaSuma, sumaDeContrapartidas } from '@/modules/conta/nucleo/recibida/fichaErp10'

const cifra = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

describe('K11b · la suma de las contrapartidas contra la base', () => {
  it('las tres líneas de la maqueta 18b cuadran con la base (504,18 + 16,36 − 191,22 = 329,32)', () => {
    const r = sumaDeContrapartidas([504.18, 16.36, -191.22], 329.32)
    expect(r).toEqual({ suma: 329.32, cuadra: true, diferencia: 0 })
    expect(rotuloDeLaSuma(r, cifra)).toEqual({ texto: 'Suma 329,32 · cuadra con la base', motivo: null })
  })
  it('si falta, en ámbar con lo que falta en el motivo; si sobra, lo que pasa', () => {
    expect(rotuloDeLaSuma(sumaDeContrapartidas([100, null], 121), cifra)).toEqual({ texto: 'Suma 100,00 · no cuadra', motivo: 'Faltan 21,00 para llegar a la base.' })
    expect(rotuloDeLaSuma(sumaDeContrapartidas([100, 30], 121), cifra).motivo).toBe('Pasa de la base en 9,00.')
  })
  it('sin errores de coma flotante: 0,1 + 0,2 cuadra con 0,3', () => {
    expect(sumaDeContrapartidas([0.1, 0.2], 0.3).cuadra).toBe(true)
  })
  it('«⊕ otra línea · N líneas» y «⊕ otro pago · N pagos»', () => {
    expect(otraLinea(1)).toBe('otra línea · 1 línea')
    expect(otraLinea(3)).toBe('otra línea · 3 líneas')
    expect(otroPago(2)).toBe('otro pago · 2 pagos')
  })
})

describe('K11b · las filas de «Pago factura» y lo pendiente', () => {
  const pago = (id: string, importe: number, numero: number) => ({ id, fecha: '2026-11-10', importe, cuenta: '55100099', concepto: 'Pago', serie: 4, numero })
  it('sin pagos y por validar: la propuesta del K06 por todo, sin documento ni ámbar', () => {
    const r = filasDePago({ total: 121, pagos: [], propuesta: { cuenta: '57200001', fecha: '2026-11-30', concepto: 'PAGO F-1' }, cifra })
    expect(r.filas).toEqual([{ id: null, ejercicio: '2026', documento: '', cuenta: '57200001', fecha: '2026-11-30', concepto: 'PAGO F-1', importe: 121 }])
    expect(r.ambar).toBe(false)
    expect(r.pendiente).toBe(121)
  })
  it('por validar y con la cuenta vacía (pendiente de pagar): la fila sigue, para escribirla', () => {
    const r = filasDePago({ total: 121, pagos: [], propuesta: { cuenta: '', fecha: '', concepto: '' }, cifra })
    expect(r.filas).toHaveLength(1)
    expect(r.filas[0].cuenta).toBe('')
  })
  it('un pago de 60 de 121: una fila con su número, y lo pendiente (61) en ámbar con su motivo', () => {
    const r = filasDePago({ total: 121, pagos: [pago('p1', 60, 1)], propuesta: null, cifra })
    expect(r.filas.map((f) => [f.id, f.documento, f.importe])).toEqual([['p1', '1', 60]])
    expect(r.pendiente).toBe(61)
    expect(r.ambar).toBe(true)
    expect(r.motivo).toBe('Los pagos suman 60,00: faltan 61,00 para el total de 121,00.')
  })
  it('dos pagos que llegan al total: sin ámbar, y la propuesta ya no sale', () => {
    const r = filasDePago({ total: 121, pagos: [pago('p1', 60, 1), pago('p2', 61, 2)], propuesta: { cuenta: '57200001', fecha: '2026-11-30', concepto: 'x' }, cifra })
    expect(r.filas).toHaveLength(2)
    expect(r.ambar).toBe(false)
    expect(r.pendiente).toBe(0)
  })
})

describe('K11b · la visualización del asiento y la cuadrícula del IVA', () => {
  it('cada línea a su lado, con su importe (el debe y el haber de una misma línea, los dos)', () => {
    expect(aVisual([
      { codigo: '62800003', nombre: 'Teléfono e internet', debe: 52.56, haber: null },
      { codigo: '47200021', nombre: 'H.P. IVA soportado', debe: 11.04, haber: null },
      { codigo: '41000013', nombre: 'Proveedor de Prueba', debe: null, haber: 63.6 },
    ])).toEqual([
      { importe: 52.56, cuenta: '62800003', nombre: 'Teléfono e internet', lado: 'debe' },
      { importe: 11.04, cuenta: '47200021', nombre: 'H.P. IVA soportado', lado: 'debe' },
      { importe: 63.6, cuenta: '41000013', nombre: 'Proveedor de Prueba', lado: 'haber' },
    ])
  })
  it('el IVA en dos filas de dos tipos, como ERP10; con cinco tipos, tres filas', () => {
    expect(cuadriculaIva(['21'])).toEqual([['21', null], [null, null]])
    expect(cuadriculaIva(['21', '10', '4'])).toEqual([['21', '10'], ['4', null]])
    expect(cuadriculaIva(['a', 'b', 'c', 'd', 'e'])).toEqual([['a', 'b'], ['c', 'd'], ['e', null]])
  })
})
