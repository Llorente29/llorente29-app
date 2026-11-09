// G05 · Tarea 2 · Los asientos del cobro (supabase/functions/_shared/cobro/asientos.ts),
// con las subcuentas de QBO (decisiones_qbo.md, 09/11; nº 29: confirmado con su libro mayor). Partidas con la forma
// de la documentación de GoCardless; clientes e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  CUENTAS_DE_QBO, asientoDeLaDevolucion, asientoDeLaFactura, asientoDelCobro, asientoDelIngreso, subcuentaDelCliente,
  type CuentasDelCobro, type Partida,
} from '../../../../../../supabase/functions/_shared/cobro/asientos'

const C: CuentasDelCobro = CUENTAS_DE_QBO
const cliente = { cuenta: '43000052', nombre: 'TALLERES DE EJEMPLO SL' }
const filas = (a: { lineas: { cuenta: string; debeCent: number; haberCent: number }[] }) => a.lineas.map((l) => [l.cuenta, l.debeCent, l.haberCent])
const p = (tipo: string, importe: string, cobroId: string | null = null): Partida => ({ tipo, importe, cobroId })

describe('G05 · los asientos del cobro', () => {
  it('la subcuenta del cliente: 430 + su código de 5 cifras (cliente 827 → 43000827)', () => {
    expect([subcuentaDelCliente(C, 827), subcuentaDelCliente(C, '52'), subcuentaDelCliente(C, '00052')]).toEqual(['43000827', '43000052', '43000052'])
    expect(() => subcuentaDelCliente(C, 123456)).toThrow('no cabe')
    expect(() => subcuentaDelCliente(C, 'abc')).toThrow('tiene que ser un número')
  })
  it('la factura: 430 cliente / 70500000 + 47700021 (la de la maqueta: 157,30 = 130,00 + 27,30)', () => {
    const a = asientoDeLaFactura(C, cliente, '2026/1/141', '2026-12-04', { baseCent: 13000, ivaCent: 2730, retencionCent: 0, totalCent: 15730 })
    expect([a.parado, filas(a)]).toEqual([[], [['43000052', 15730, 0], ['70500000', 0, 13000], ['47700021', 0, 2730]]])
    const conRetencion = asientoDeLaFactura(C, cliente, '2026/1/142', '2026-12-04', { baseCent: 10000, ivaCent: 2100, retencionCent: 1500, totalCent: 10600 })
    expect(conRetencion.parado).toEqual(['La factura lleva retención y la empresa no tiene su cuenta de retenciones'])
  })
  it('el cobro confirmado: 57200002 Plataforma GoCardless / 430 cliente, con la fecha del cobro y el concepto del libro mayor de QBO', () => {
    const a = asientoDelCobro(C, cliente, '2026/1/141', '2026-12-06', 15730)
    expect([a.parado, a.fecha, filas(a)]).toEqual([[], '2026-12-06', [['57200002', 15730, 0], ['43000052', 0, 15730]]])
    expect(a.lineas.map((l) => l.concepto)).toEqual(['2026/1/141-TALLERES DE EJEMPLO SL', '2026/1/141-TALLERES DE EJEMPLO SL'])
    expect(asientoDelCobro(C, cliente, '2026/1/141', '06/12/2026', 15730).parado).toEqual(['El asiento no tiene una fecha AAAA-MM-DD'])
  })
  it('la devolución: se deshace el cobro (430 / 57200002) y el cliente vuelve a «Te deben»', () => {
    const a = asientoDeLaDevolucion(C, cliente, '2026/1/141', '2026-12-20', 15730, true)
    expect([a.parado, a.fecha, filas(a)]).toEqual([[], '2026-12-20', [['43000052', 15730, 0], ['57200002', 0, 15730]]])
    expect(a.lineas[0].concepto).toBe('Retrocedido 2026/1/141-TALLERES DE EJEMPLO SL')
  })
  it('el ingreso en el banco: 57200000 banco / 57200002 por el neto; la comisión se queda en la 57200002 hasta su factura mensual', () => {
    // 157,30 + 96,80 cobrados; comisiones 0,68 + 0,445 (décimas de céntimo): GoCardless redondea la suma y llegan 252,98 €.
    const a = asientoDelIngreso(C, 25298, 'PO000PRUEBA1', '2026-12-08', [
      p('payment_paid_out', '15730.0', 'PM1'), p('gocardless_fee', '-68.0', 'PM1'),
      p('payment_paid_out', '9680.0', 'PM2'), p('gocardless_fee', '-44.5', 'PM2'),
    ], new Set(['PM1', 'PM2']))
    expect([a.parado, filas(a), a.comisionCent]).toEqual([[], [['57200000', 25298, 0], ['57200002', 0, 25298]], 112])
  })
  it('un retrocedido en la liquidación cuenta en lo que llega; si sale más de lo que entra, el asiento va al revés', () => {
    const a = asientoDelIngreso(C, 9680 - 44 - 15730 + 68, 'PO000PRUEBA2', '2026-12-22', [
      p('payment_paid_out', '9680.0', 'PM2'), p('gocardless_fee', '-44.0', 'PM2'), p('payment_charged_back', '-15730.0', 'PM1'), p('gocardless_fee', '68.0', 'PM1'),
    ], new Set(['PM1', 'PM2']))
    expect([a.parado, filas(a), a.comisionCent]).toEqual([[], [['57200002', 6026, 0], ['57200000', 0, 6026]], -24])
  })
  it('lo que no se sabe contabilizar no se inventa: un cobro que no es de Sumied, una partida rara o un banco que no cuadra', () => {
    expect(asientoDelIngreso(C, 1000, 'PO3', '2026-12-08', [p('payment_paid_out', '1000.0', 'PM9')], new Set(['PM1'])).parado)
      .toEqual(['Un cobro de 10,00 € no es de ningún recibo de Sumied: ¿sigue viva una suscripción en GoCardless?'])
    expect(asientoDelIngreso(C, -500, 'PO4', '2026-12-08', [p('refund', '-500.0')], new Set()).parado)
      .toEqual(['Hay una partida de GoCardless que Sumied no sabe contabilizar («refund», −5,00 €)'])
    expect(asientoDelIngreso(C, 15000, 'PO5', '2026-12-08', [p('payment_paid_out', '15730.0', 'PM1'), p('gocardless_fee', '-68.0', 'PM1')], new Set(['PM1'])).parado)
      .toEqual(['Lo que llega al banco (150,00 €) no es lo que suman sus cobros, devoluciones y comisiones (156,62 €)'])
  })
})
