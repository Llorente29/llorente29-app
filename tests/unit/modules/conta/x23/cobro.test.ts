// tests/unit/modules/conta/x23/cobro.test.ts — X23 · «Cómo se cobra» con cualquier subcuenta del plan: la lista (la
// misma pieza que el pago del X21b, cuentasParaMover) y la línea del asiento cuando no es un banco ni la caja.
// Subcuentas inventadas (T11).

import { describe, expect, it } from 'vitest'
import { cuentasParaMover } from '@/modules/conta/lib/cuentasParaMover'
import { queHaceElCobro, textoAsientoDelCobro } from '@/modules/conta/nucleo/emitida/asiento'

const PLAN = [
  { id: 'a', code: '70000000', kind: 'template', status: 'activa' },
  { id: 'b', code: '43000002', kind: 'own', status: 'activa' },
  { id: 'c', code: '57200001', kind: 'own', status: 'activa' },
  { id: 'd', code: '57000000', kind: 'template', status: 'activa' },
  { id: 'e', code: '55100001', kind: 'own', status: 'activa' },
  { id: 'f', code: '62900009', kind: 'own', status: 'cerrada' },
  { id: 'g', code: '430', kind: 'group', status: 'activa' },
  { id: 'h', code: '4300', kind: 'template', status: 'activa' },
]

describe('X23 · la lista del cobro (y del pago): el plan entero, bancos y caja primero', () => {
  it('las tesorerías, después el grupo 5, después lo demás; sin grupos, sin cerradas, sin cuentas de menos cifras', () => {
    expect(cuentasParaMover(PLAN, { tesorerias: new Set(['57200001']) }).map((c) => c.code))
      .toEqual(['57200001', '55100001', '57000000', '43000002', '70000000'])
  })
  it('lo que la ficha pone delante (las 430 de las plataformas en el pago) va con el grupo 5', () => {
    expect(cuentasParaMover(PLAN, { tesorerias: new Set(['57200001']), delante: (c) => c.id === 'b' }).map((c) => c.code))
      .toEqual(['57200001', '43000002', '55100001', '57000000', '70000000'])
  })
})

describe('X23 · la línea del asiento del cobro, sin bloquear', () => {
  const base = { fecha: '2026-11-20', hoy: '2026-11-21', importe: 121, bancos: new Map([['57200001', 'b-1']]), cuentaCliente: '43000081' }
  const nombre = (c: string) => (c === '43000002' ? 'Plataforma inventada' : '')
  it('una 430 que no es la del cliente: el asiento del cobro, la elegida al debe y la del cliente al haber', () => {
    const q = queHaceElCobro({ ...base, cuenta: '43000002' })
    expect(q).toEqual({ que: 'otra', cuenta: '43000002', fecha: '2026-11-20', importe: 121 })
    expect(textoAsientoDelCobro(q, { nombre, cuentaCliente: '43000081', importe: '121,00 €' }))
      .toBe('No es un banco ni la caja: al guardar, un asiento del cobro con la 43000002 · Plataforma inventada al debe y la 43000081 del cliente al haber, por 121,00 €, y la factura queda cobrada.')
  })
  it('un banco, la caja o pendiente: no hay línea', () => {
    expect(textoAsientoDelCobro(queHaceElCobro({ ...base, cuenta: '57200001' }), { nombre, cuentaCliente: '43000081', importe: '121,00 €' })).toBeNull()
    expect(textoAsientoDelCobro(queHaceElCobro({ ...base, cuenta: '57000000' }), { nombre, cuentaCliente: '43000081', importe: '121,00 €' })).toBeNull()
    expect(textoAsientoDelCobro(queHaceElCobro({ ...base, cuenta: '' }), { nombre, cuentaCliente: '43000081', importe: '121,00 €' })).toBeNull()
  })
  it('la del propio cliente no es una cuenta de cobro: queda pendiente, con su porqué', () => {
    expect(queHaceElCobro({ ...base, cuenta: '43000081' })).toEqual({ que: 'pendiente', porque: 'la 43000081 es la del cliente, no una cuenta de cobro' })
  })
})
