// tests/conta/e05c-bancos/cobro.test.ts
//
// E05c · «Es otra factura» en un cobro: qué facturas emitidas salen y el destino
// del casado, comparado con el que arma el motor de verdad (conciliacion.ts) para
// el mismo cobro, y la misma llamada al motor que los pagos. Datos inventados.
import { describe, expect, it, vi } from 'vitest'

const motor = vi.hoisted(() => ({ confirmar: vi.fn(), cargarContexto: vi.fn() }))
vi.mock('@/modules/conta/services/bancosService', () => ({ bancos: motor }))

import { cobroConFactura, emitidasDeLosClientes, emitidasQueEncajan } from '@/modules/conta/nucleo/bancos/factura'
import { casarConEmitida, facturasEmitidasPendientes } from '@/modules/conta/nucleo/bancos/conciliar'
import { decidir, type Cliente, type Contexto, type Movimiento } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'

const CLIENTES: Cliente[] = [
  { terceroId: null, nombre: 'Cliente de Prueba Bancos', alias: ['Cliente de Prueba Bancos'], cuenta: '43000501', pendienteCent: 36300,
    facturas: [{ id: 'f1', numero: 'E05C-1', fecha: '2026-10-01', pendienteCent: 24200 }, { id: 'f2', numero: 'E05C-2', fecha: '2026-10-02', pendienteCent: 12100 }] },
  { terceroId: null, nombre: 'Otro Cliente Ejemplo', alias: ['Otro Cliente Ejemplo'], cuenta: '43000502', pendienteCent: 24200,
    facturas: [{ id: 'g1', numero: 'OTRO-1', fecha: '2026-10-03', pendienteCent: 24200 }] },
]
const FACTURAS = emitidasDeLosClientes(CLIENTES)
const cobro = (o: Partial<MovimientoBanco> = {}): MovimientoBanco => ({
  id: 'm1', cuentaId: 'b', fecha: '2026-10-18', importeCent: 24200, conceptoBanco: 'TRANSFERENCIA RECIBIDA CLIENTE DE PRUEBA BANCOS', conceptoLimpio: 'Cliente de Prueba Bancos',
  estado: 'por_aclarar', confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null, ...o,
} as MovimientoBanco)

describe('E05c · las facturas emitidas que se ofrecen', () => {
  it('una lista con su cliente y su 430', () => {
    expect(FACTURAS.map((f) => `${f.id} ${f.cliente} ${f.cuenta430}`)).toEqual(['f1 Cliente de Prueba Bancos 43000501', 'f2 Cliente de Prueba Bancos 43000501', 'g1 Otro Cliente Ejemplo 43000502'])
  })
  it('las del cliente que nombra el banco, la más cercana al importe primero', () => {
    expect(emitidasQueEncajan(cobro(), FACTURAS, '').map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(emitidasQueEncajan(cobro({ importeCent: 12100 }), FACTURAS, '').map((f) => f.id)).toEqual(['f2', 'f1'])
  })
  it('si no nombra a ninguno, todas; con lo escrito, las que lo llevan', () => {
    expect(emitidasQueEncajan(cobro({ conceptoBanco: 'TRANSFERENCIA', conceptoLimpio: 'Transferencia' }), FACTURAS, '').map((f) => f.id).sort()).toEqual(['f1', 'f2', 'g1'])
    expect(emitidasQueEncajan(cobro(), FACTURAS, 'E05C-2').map((f) => f.id)).toEqual(['f2'])
  })
  it('las lee del motor (cargarContexto), tal cual', async () => {
    motor.cargarContexto.mockResolvedValue({ ctx: { clientes: CLIENTES }, movimientos: [] })
    expect(await facturasEmitidasPendientes('acc', 'emp', '2026-11-19')).toEqual(FACTURAS)
    expect(motor.cargarContexto).toHaveBeenCalledWith('acc', 'emp', '2026-11-19')
  })
})

describe('E05c · el casado del cobro, como lo arma el motor', () => {
  it('el mismo destino que el motor para ese cobro (tipo, 430, factura e importes)', () => {
    const ctx = { cuentas: [{ id: 'b', nombre: 'Banco', cuenta: '57200050' }], sinCasar: [], facturas: [], saldosTraidos: [], proveedores: [], clientes: CLIENTES,
      liquidaciones: [], plataformas: [], nominas: [], impuestos: [], contratos: [], reglas: [], aprendido: [], asientos: [], nombres: {} } as unknown as Contexto
    const mov: Movimiento = { id: 'm1', cuentaId: 'b', fecha: '2026-10-18', importeCent: 24200, concepto: 'TRANSFERENCIA RECIBIDA CLIENTE DE PRUEBA BANCOS', conceptoComun: null, referencias: [], antesDelCorte: false }
    const delMotor = decidir(mov, ctx).destino as unknown as Record<string, unknown>
    expect(delMotor?.tipo).toBe('factura_emitida')
    const nuestro = cobroConFactura(cobro(), FACTURAS[0]).destino as unknown as Record<string, unknown>
    for (const k of ['tipo', 'tercero_id', 'lineas', 'facturas']) expect(nuestro[k], k).toEqual(delMotor[k])
  })
  it('paga de más: la 430 se lleva todo el ingreso y la factura solo lo que le queda', () => {
    expect(cobroConFactura(cobro({ importeCent: 30000 }), FACTURAS[0]).destino).toMatchObject({ lineas: [{ cuenta: '43000501', importe: 300 }], facturas: [{ id: 'f1', importe: 242 }] })
  })
  it('la misma llamada que los pagos: nucleo.confirmar(id, porqué, destino, «probable», sin regla), y lo que dice', async () => {
    const t = await casarConEmitida(cobro(), FACTURAS[0], 'Cliente de Prueba Bancos')
    expect(motor.confirmar).toHaveBeenCalledWith('m1', 'Lo dijiste tú: cobra la factura E05C-1 de Cliente de Prueba Bancos.', cobroConFactura(cobro(), FACTURAS[0]).destino, 'probable', null)
    expect(t).toBe('Cobrado: Cobro de la factura E05C-1 de Cliente de Prueba Bancos (Cliente de Prueba Bancos) · en el diario. La factura queda cobrada.')
    expect(await casarConEmitida(cobro({ importeCent: 10000 }), FACTURAS[0], 'X')).toBe('Cobrado: Cobro de la factura E05C-1 de Cliente de Prueba Bancos (X) · en el diario. A la factura le quedan 142,00 € por cobrar.')
    expect(await casarConEmitida(cobro({ importeCent: 30000 }), FACTURAS[0], 'X')).toBe('Cobrado: Cobro de la factura E05C-1 de Cliente de Prueba Bancos (X) · en el diario. La factura queda cobrada. Sobran 58,00 €: quedan a favor del cliente en su cuenta.')
  })
})
