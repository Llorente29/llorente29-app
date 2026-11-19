// tests/conta/e05b-bancos/factura.test.ts
//
// E05b · «Es otra factura»: qué facturas se ofrecen y que el destino del casado es
// el de elegirFactura de la pantalla de hoy (bancos/Movimientos.tsx), tal cual, y la
// misma llamada al motor. Datos inventados.
import { describe, expect, it, vi } from 'vitest'

const motor = vi.hoisted(() => ({ confirmar: vi.fn() }))
vi.mock('@/modules/conta/services/bancosService', () => ({ bancos: motor }))

import { casadoConFactura, facturasQueEncajan } from '@/modules/conta/nucleo/bancos/factura'
import { casarConFactura } from '@/modules/conta/nucleo/bancos/conciliar'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import type { FacturaPendiente } from '@/modules/conta/services/bancosPantallas'

const pago = (o: Partial<MovimientoBanco> = {}): MovimientoBanco => ({
  id: 'm1', cuentaId: 'b', fecha: '2026-10-16', importeCent: -12100, conceptoBanco: 'TRANSFERENCIA PROVEEDOR DE PRUEBA BANCOS', conceptoLimpio: 'Proveedor de Prueba Bancos',
  estado: 'por_aclarar', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...o,
} as MovimientoBanco)
const f = (id: string, proveedor: string, pendienteCent: number, numero = `F-${id}`): FacturaPendiente =>
  ({ id, numero, fecha: '2026-10-02', pendienteCent, proveedor, terceroId: null, cuentaTercero: '40000501' })
const FACTURAS = [f('a', 'Proveedor de Prueba Bancos', 6050), f('b', 'Proveedor de Prueba Bancos', 12100), f('c', 'Otro Proveedor Ejemplo', 12100)]

describe('E05b · las facturas que se ofrecen', () => {
  it('las del proveedor que nombra el banco, la más cercana al importe primero', () => {
    expect(facturasQueEncajan(pago(), FACTURAS, '').map((x) => x.id)).toEqual(['b', 'a'])
  })
  it('si no nombra a ninguno, todas', () => {
    expect(facturasQueEncajan(pago({ conceptoBanco: 'TRANSFERENCIA', conceptoLimpio: 'Transferencia' }), FACTURAS, '').map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('con lo escrito, las que lo llevan en el proveedor o el número', () => {
    expect(facturasQueEncajan(pago(), FACTURAS, 'F-a').map((x) => x.id)).toEqual(['a'])
  })
})

describe('E05b · el casado con la factura, como hoy', () => {
  it('el destino y el porqué de elegirFactura, tal cual', () => {
    const m = pago(), x = FACTURAS[1]
    // Lo que construye hoy Movimientos.elegirFactura, copiado de allí:
    const importe = Math.min(Math.abs(m.importeCent), x.pendienteCent) / 100
    const concepto = `Pago de la factura ${x.numero ?? ''} de ${x.proveedor}`.replace(/\s+/g, ' ')
    const deHoy = { tipo: 'factura_recibida', facturas: [{ id: x.id, importe }], cuenta_tercero: x.cuentaTercero ?? '', tercero_id: x.terceroId, concepto }
    const c = casadoConFactura(m, x)
    expect(c.destino).toEqual(deHoy)
    expect(c.porque).toBe(`Lo dijiste tú: paga la factura ${x.numero ?? ''} de ${x.proveedor}.`)
  })
  it('paga de más que lo pendiente: solo lo pendiente, y lo dice', () => {
    expect(casadoConFactura(pago({ importeCent: -20000 }), FACTURAS[0]).destino).toMatchObject({ facturas: [{ id: 'a', importe: 60.5 }] })
  })
  it('la misma llamada al motor que hoy: nucleo.confirmar(id, porqué, destino, «probable», sin regla), y lo que dice', async () => {
    const t = await casarConFactura(pago(), FACTURAS[1], 'Proveedor de Prueba Bancos')
    expect(motor.confirmar).toHaveBeenCalledWith('m1', 'Lo dijiste tú: paga la factura F-b de Proveedor de Prueba Bancos.', casadoConFactura(pago(), FACTURAS[1]).destino, 'probable', null)
    expect(t).toBe('Casado: Pago de la factura F-b de Proveedor de Prueba Bancos (Proveedor de Prueba Bancos). La factura queda pagada.')
    const t2 = await casarConFactura(pago({ importeCent: -5000 }), FACTURAS[1], 'X')
    expect(t2).toBe('Casado: Pago de la factura F-b de Proveedor de Prueba Bancos (X). A la factura le quedan 71,00 € por pagar.')
  })
})
