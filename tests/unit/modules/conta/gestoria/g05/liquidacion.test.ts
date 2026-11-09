// G05 · Tarea 2 · La liquidación de GoCardless hecha asiento
// (supabase/functions/_shared/cobro/liquidacion.ts). Partidas con la forma de la
// documentación de GoCardless (09/11); clientes e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import { asientoDeLiquidacion, type CobroConocido, type Partida } from '../../../../../../supabase/functions/_shared/cobro/liquidacion'

const cobros = new Map<string, CobroConocido>([
  ['PM1', { clienteId: 'c1', cliente: 'Panadería Muestra, S.L.', factura: 'F26-000101' }],
  ['PM2', { clienteId: 'c2', cliente: 'Estudio de Prueba, S.L.', factura: 'F26-000102' }],
])
const p = (tipo: string, importe: string, cobroId: string | null = null): Partida => ({ tipo, importe, cobroId })
const cuadra = (a: ReturnType<typeof asientoDeLiquidacion>) => a.lineas.reduce((s, l) => s + l.debeCent - l.haberCent, 0)

describe('G05 · la liquidación de GoCardless', () => {
  it('572 al debe por lo que llega, cada 430 al haber por lo que pagó y la comisión en 626, por diferencia', () => {
    // 145,20 + 96,80 cobrados; comisiones 0,68 + 0,445 (GoCardless guarda décimas de céntimo) = 1,125 → 1,13 €.
    const a = asientoDeLiquidacion(24087, 'PO000PRUEBA1', [
      p('payment_paid_out', '14520.0', 'PM1'), p('gocardless_fee', '-68.0', 'PM1'),
      p('payment_paid_out', '9680.0', 'PM2'), p('gocardless_fee', '-44.5', 'PM2'),
    ], cobros)
    expect([a.parado, a.cobrosCent, a.comisionCent, cuadra(a)]).toEqual([[], 24200, 113, 0])
    expect(a.lineas.map((l) => [l.cuenta, l.clienteId, l.debeCent, l.haberCent])).toEqual([
      ['banco', null, 24087, 0], ['comision', null, 113, 0], ['cliente', 'c2', 0, 9680], ['cliente', 'c1', 0, 14520],
    ])
    expect(a.lineas[3].concepto).toBe('Cobro de la F26-000101 por GoCardless')
  })
  it('un retrocedido después de cobrado se deshace: su 430 al debe (vuelve a «Te deben»), y su comisión se devuelve', () => {
    const a = asientoDeLiquidacion(9680 - 44 - 14520 + 68, 'PO000PRUEBA2', [
      p('payment_paid_out', '9680.0', 'PM2'), p('gocardless_fee', '-44.0', 'PM2'),
      p('payment_charged_back', '-14520.0', 'PM1'), p('gocardless_fee', '68.0', 'PM1'),
    ], cobros)
    expect([a.parado, a.devueltosCent, a.comisionCent, cuadra(a)]).toEqual([[], 14520, -24, 0])
    expect(a.lineas.find((l) => l.clienteId === 'c1')).toMatchObject({ debeCent: 14520, haberCent: 0, concepto: 'Devuelto de la F26-000101 por GoCardless' })
    expect(a.lineas.find((l) => l.cuenta === 'banco')).toMatchObject({ debeCent: 0, haberCent: 4816 })
    expect(a.lineas.find((l) => l.cuenta === 'comision')).toMatchObject({ debeCent: 0, haberCent: 24, concepto: 'Comisión devuelta por GoCardless PO000PRUEBA2' })
  })
  it('lo que no se sabe contabilizar no se inventa: la liquidación queda parada y lo dice', () => {
    expect(asientoDeLiquidacion(-500, 'PO3', [p('refund', '-500.0')], cobros).parado).toEqual(['Hay una partida de GoCardless que Sumied no sabe contabilizar («refund», −5,00 €)'])
    expect(asientoDeLiquidacion(1000, 'PO4', [p('payment_paid_out', '1000.0', 'PM9')], cobros).parado).toEqual(['Un cobro de 10,00 € no es de ningún recibo de Sumied'])
  })
  it('si lo que llega al banco no cuadra con los cobros menos la comisión de GoCardless, para', () => {
    const a = asientoDeLiquidacion(14000, 'PO5', [p('payment_paid_out', '14520.0', 'PM1'), p('gocardless_fee', '-68.0', 'PM1')], cobros)
    expect(a.parado).toEqual(['Lo que llega al banco (140,00 €) no cuadra con los cobros menos la comisión que dice GoCardless'])
  })
})
