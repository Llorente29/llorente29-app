// tests/unit/modules/conta/k10c/pagos.test.ts
//
// K10c · Los pagos de una recibida: lo pendiente y los estados, y si un pago cabe. Importes inventados.
import { describe, expect, it } from 'vitest'
import { cabeElPago, cuantosPagos, estadoDePagos } from '@/modules/conta/nucleo/recibida/pagos'

describe('lo pendiente y el estado', () => {
  it('sin pagos, pendiente por el total', () => {
    expect(estadoDePagos(121, [])).toEqual({ pagado: 0, pendiente: 121, estado: 'pendiente', pagos: 0 })
  })
  it('una factura de 121 pagada en dos (60 + 61): en parte y luego pagada', () => {
    expect(estadoDePagos(121, [{ importe: 60 }])).toEqual({ pagado: 60, pendiente: 61, estado: 'pagada_parte', pagos: 1 })
    expect(estadoDePagos(121, [{ importe: 60 }, { importe: 61 }])).toEqual({ pagado: 121, pendiente: 0, estado: 'pagada', pagos: 2 })
  })
  it('al céntimo, sin errores de coma flotante', () => {
    expect(estadoDePagos(0.3, [{ importe: 0.1 }, { importe: 0.2 }]).estado).toBe('pagada')
    expect(estadoDePagos(100, [{ importe: 33.33 }, { importe: 33.33 }]).pendiente).toBe(33.34)
  })
})

describe('si un pago cabe', () => {
  it('no puede pasar del total con los demás, ni ser cero', () => {
    expect(cabeElPago(121, [{ importe: 60 }], 61)).toEqual({ cabe: true, falta: 61 })
    expect(cabeElPago(121, [{ importe: 60 }], 62)).toEqual({ cabe: false, falta: 61 })
    expect(cabeElPago(121, [{ importe: 60 }, { importe: 61 }], 1)).toEqual({ cabe: false, falta: 0 })
    expect(cabeElPago(121, [], 0).cabe).toBe(false)
  })
  it('al cambiar uno, su importe de antes no cuenta', () => {
    expect(cabeElPago(121, [{ importe: 60 }, { importe: 61 }], 61, 1)).toEqual({ cabe: true, falta: 61 })
    expect(cabeElPago(121, [{ importe: 60 }, { importe: 61 }], 61, 0)).toEqual({ cabe: false, falta: 60 })
    expect(cabeElPago(121, [{ importe: 60 }, { importe: 61 }], 61.01, 1).cabe).toBe(false)
  })
  it('«⊕ otro pago · N pagos»', () => {
    expect([1, 2].map(cuantosPagos)).toEqual(['1 pago', '2 pagos'])
  })
})
