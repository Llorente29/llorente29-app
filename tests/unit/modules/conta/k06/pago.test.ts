// tests/unit/modules/conta/k06/pago.test.ts
//
// K06 · La cuenta del pago de la recibida (src/modules/conta/nucleo/recibida/pago.ts):
// la propuesta (la de su ficha, o vacía; la del último pago, solo en la lupa) y qué hace al guardar.
import { describe, expect, it } from 'vitest'
import { PAGO_VACIO, cuentaDeLaCasilla, fechaDelPago, primerasDeLaLupa, propuestaDelPago, queHaceElPago, textoDudaPago } from '@/modules/conta/nucleo/recibida/pago'

// K10 (Julio, 21/11): la «Cuenta de pago» de la ficha y, sin ella, vacía. K11b (Julio, 23/11): la del último pago ya no
// se escribe en la casilla («una factura metida a mano no puede quedar pagada por haber validado otra antes»): va la
// primera al abrir la lupa. Lo que se ve es lo que se apunta: vaciada, pendiente aunque haya propuesta.
describe('la propuesta de la cuenta del pago', () => {
  it('la de su ficha', () => {
    expect(propuestaDelPago({ deLaFicha: '43000002', ultimas: ['57200001'] })).toEqual({ cuenta: '43000002', origen: 'De su ficha', duda: null })
  })
  it('sin la de su ficha, vacía aunque haya pagos de antes (la del último pago no se escribe)', () => {
    expect(propuestaDelPago({ deLaFicha: null, ultimas: ['57200001', '57200001'] })).toEqual({ cuenta: '', origen: null, duda: null })
    expect(propuestaDelPago({ deLaFicha: null, ultimas: ['55100001', '57200001', '55100001'] })).toEqual({ cuenta: '', origen: null, duda: null })
  })
  it('sin ninguna, vacía: pendiente de pagar', () => {
    expect(propuestaDelPago({ deLaFicha: null, ultimas: [] })).toEqual({ cuenta: '', origen: null, duda: null })
    expect(propuestaDelPago({ deLaFicha: '  ', ultimas: [] })).toEqual({ cuenta: '', origen: null, duda: null })
  })
  it('las de sus últimos pagos, las primeras de la lupa: sin repetir, de la más nueva a la más vieja, cinco', () => {
    expect(primerasDeLaLupa({ ultimas: ['55100001', '57200001', '55100001', ' '] })).toEqual(['55100001', '57200001'])
    expect(primerasDeLaLupa({ ultimas: ['a', 'b', 'c', 'd', 'e', 'f'] })).toHaveLength(5)
  })
  it('lo que se ve es lo que se apunta: la puesta; vaciada, nada (aunque haya propuesta); sin tocar, la propuesta', () => {
    expect(cuentaDeLaCasilla('57000000', '43000002')).toBe('57000000')
    expect(cuentaDeLaCasilla(PAGO_VACIO, '43000002')).toBe('')
    expect(cuentaDeLaCasilla(null, '43000002')).toBe('43000002')
    expect(cuentaDeLaCasilla(null, '')).toBe('')
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

// K11b (e2e 45268936661): vaciada, la casilla volvía a la propuesta cuando la ficha se releía, porque para el editor de
// cambios '' y null son lo mismo («vacío es vacío») y una relectura adopta lo que no se ha tocado. PAGO_VACIO no es vacío.
describe('la casilla del pago vaciada sobrevive a una relectura', () => {
  it('con PAGO_VACIO se queda vaciada; con la cadena vacía de antes volvía a null (y a la propuesta)', async () => {
    const { adoptar } = await import('@/modules/conta/diseno/plantillas/cambios')
    const base = { pagoCuenta: null as string | null }
    expect(adoptar(base, { pagoCuenta: PAGO_VACIO }, { pagoCuenta: null }).valor.pagoCuenta).toBe(PAGO_VACIO)
    expect(adoptar(base, { pagoCuenta: '' }, { pagoCuenta: null }).valor.pagoCuenta).toBeNull()
  })
})
