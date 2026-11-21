// tests/unit/modules/conta/k06/pago.test.ts
//
// K06 · La cuenta del pago de la recibida (src/modules/conta/nucleo/recibida/pago.ts):
// la propuesta (la última del proveedor, la 430 de plataforma, vacía) y qué hace al guardar.
import { describe, expect, it } from 'vitest'
import { fechaDelPago, propuestaDelPago, queHaceElPago, textoDudaPago } from '@/modules/conta/nucleo/recibida/pago'

describe('la propuesta de la cuenta del pago', () => {
  it('la de su último pago, con su origen', () => {
    expect(propuestaDelPago({ plataforma: null, ultimas: ['57200001', '57200001'] })).toEqual({ cuenta: '57200001', origen: 'de la última', duda: null })
  })
  it('si sus últimos pagos van por más de una cuenta, la última y la duda con las dos', () => {
    expect(propuestaDelPago({ plataforma: null, ultimas: ['55100001', '57200001', '55100001'] }))
      .toEqual({ cuenta: '55100001', origen: 'de la última', duda: { cuentas: ['55100001', '57200001'] } })
  })
  it('la duda mira solo los cinco últimos', () => {
    expect(propuestaDelPago({ plataforma: null, ultimas: ['57200001', '57200001', '57200001', '57200001', '57200001', '55100001'] }).duda).toBeNull()
  })
  it('sin pagos de antes, vacía: pendiente de pagar', () => {
    expect(propuestaDelPago({ plataforma: null, ultimas: [] })).toEqual({ cuenta: '', origen: null, duda: null })
  })
  it('de una plataforma con su liquidación, su 430', () => {
    expect(propuestaDelPago({ plataforma: { nombre: 'Glovo', cuenta430: '43000001', hayLiquidacion: true }, ultimas: ['57200001'] }))
      .toEqual({ cuenta: '43000001', origen: 'de su liquidación', duda: null })
  })
  it('de una plataforma sin liquidación, vacía (no se pone la 430), aunque antes se pagara por banco', () => {
    expect(propuestaDelPago({ plataforma: { nombre: 'Glovo', cuenta430: '43000001', hayLiquidacion: false }, ultimas: ['57200001'] }))
      .toEqual({ cuenta: '', origen: null, duda: null })
  })
  it('de una plataforma sin su 430 en el plan, vacía', () => {
    expect(propuestaDelPago({ plataforma: { nombre: 'Glovo', cuenta430: null, hayLiquidacion: true }, ultimas: [] }).cuenta).toBe('')
  })
})

describe('qué hace al guardar', () => {
  const base = { fecha: '2026-10-25', hoy: '2026-11-20', importe: 121, tesorerias: new Map([['57200001', 'banco-1']]), plataforma: null, cuentaProveedor: '40000071' }
  it('un banco: lo de «Ya la he pagado» de Pagos', () => {
    expect(queHaceElPago({ ...base, cuenta: '57200001' })).toEqual({ que: 'banco', tesoreriaId: 'banco-1', cuenta: '57200001', fecha: '2026-10-25', importe: 121 })
  })
  it('otra cuenta (la 551 del socio): su asiento', () => {
    expect(queHaceElPago({ ...base, cuenta: '55100001' })).toEqual({ que: 'otra', cuenta: '55100001', fecha: '2026-10-25', importe: 121 })
  })
  it('vacía: pendiente de pagar', () => {
    expect(queHaceElPago({ ...base, cuenta: '  ' })).toEqual({ que: 'pendiente', porque: 'sin cuenta de pago' })
  })
  it('la 430 de la plataforma con su liquidación: la compensación, sin mirar la fecha', () => {
    expect(queHaceElPago({ ...base, fecha: '', cuenta: '43000001', plataforma: { cuenta430: '43000001', hayLiquidacion: true } })).toEqual({ que: 'liquidacion', cuenta: '43000001' })
  })
  it('la 430 de la plataforma sin liquidación: pendiente, se paga después por bancos', () => {
    expect(queHaceElPago({ ...base, cuenta: '43000001', plataforma: { cuenta430: '43000001', hayLiquidacion: false } }))
      .toEqual({ que: 'pendiente', porque: 'no hay liquidación de la que descontarla: se paga después por bancos' })
  })
  it('la del proveedor no es una cuenta de pago', () => {
    expect(queHaceElPago({ ...base, cuenta: '40000071' }).que).toBe('pendiente')
  })
  it('sin fecha, o después de hoy: pendiente, con su porqué', () => {
    expect(queHaceElPago({ ...base, cuenta: '57200001', fecha: '' })).toEqual({ que: 'pendiente', porque: 'sin la fecha del pago' })
    expect(queHaceElPago({ ...base, cuenta: '57200001', fecha: '2026-12-01' })).toEqual({ que: 'pendiente', porque: 'se paga el 01/12/2026, después de hoy' })
  })
})

describe('la fecha del pago y la duda', () => {
  it('la del vencimiento; si no, la de la factura', () => {
    expect(fechaDelPago('2026-10-20', '2026-11-19')).toBe('2026-11-19')
    expect(fechaDelPago('2026-10-20', '')).toBe('2026-10-20')
    expect(fechaDelPago('', '')).toBe('')
  })
  it('la duda nombra cada cuenta con su nombre', () => {
    const n = new Map([['55100001', 'Socio de Prueba'], ['57200001', 'Bancos · Cuenta principal']])
    expect(textoDudaPago({ cuentas: ['55100001', '57200001'] }, (c) => n.get(c) ?? '').texto)
      .toBe('Sus últimos pagos van por la 55100001 (Socio de Prueba) y la 57200001 (Bancos · Cuenta principal): mira cuál es esta')
  })
})
