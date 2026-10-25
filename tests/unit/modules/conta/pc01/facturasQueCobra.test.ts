// PC01 · El cobro de un cliente en Bancos nombra sus facturas emitidas cuando
// cuadran (y entonces bank_casar escribe su cobro con el asiento del banco).
import { describe, expect, it } from 'vitest'
import { facturasQueCobra } from '@/modules/conta/lib/conciliacion'

const c = { facturas: [
  { id: 'a', numero: 'F-2026/0001', fecha: '2026-09-01', pendienteCent: 12100 },
  { id: 'b', numero: 'F-2026/0002', fecha: '2026-09-15', pendienteCent: 5000 },
] }

describe('qué facturas cobra un ingreso', () => {
  it('la que queda justo por ese importe', () => {
    expect(facturasQueCobra(c, 5000)).toEqual([{ id: 'b', importe: 50, numero: 'F-2026/0002' }])
  })
  it('todas, si suman justo eso', () => {
    expect(facturasQueCobra(c, 17100).map((f) => f.id)).toEqual(['a', 'b'])
  })
  it('si no cuadra, ninguna: el cobro va a la 430 como antes', () => {
    expect(facturasQueCobra(c, 9999)).toEqual([])
    expect(facturasQueCobra({}, 5000)).toEqual([])
  })
  it('dos que quedan por el mismo importe: no adivina', () => {
    expect(facturasQueCobra({ facturas: [{ id: 'x', numero: null, fecha: '2026-09-01', pendienteCent: 100 }, { id: 'y', numero: null, fecha: '2026-09-02', pendienteCent: 100 }] }, 100)).toEqual([])
  })
})
