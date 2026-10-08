// Lo que el nocturno de PRODUCCIÓN marcó el 08/10 (run 37832550115) y era fallo
// nuestro, no de los datos de Foodint. Cada caso sale de producción, medido en
// solo lectura: importes tal cual, sin fechas, referencias ni nombres (el
// repositorio es público); los nombres de las pruebas de NIF son inventados con
// la misma forma que los tres reales.
import { describe, expect, it } from 'vitest'
import { cuadre, ORIGEN_GLOVO } from '@/modules/conta/lib/liquidaciones'
import { nifDeListado, esIvaExtranjero } from '@/modules/conta/lib/importarPlan'
import { liquidacionPlataforma } from '@/modules/conta/lib/asientosPropuestos'
// @ts-expect-error — módulo .mjs sin tipos
import { descuadre, revisarTerceros } from '../../../../scripts/conta/lib/terceros.mjs'

type FilaBd = { gross_sales: number; commission: number; net_payout: number; accumulated_debt: number | null; otros: number[]; source: string }
const glovo = (gross_sales: number, commission: number, net_payout: number, accumulated_debt: number, otros: number[]): FilaBd =>
  ({ gross_sales, commission, net_payout, accumulated_debt, otros, source: ORIGEN_GLOVO })

// Siete liquidaciones de Glovo de producción: cuatro con deuda arrastrada (las que
// quedan a −1 céntimo) y las tres con más promociones (al céntimo exacto). En las
// 96 de Foodint: 60 al céntimo, 29 a −1 y 7 a +1; ninguna más lejos.
const GLOVO: FilaBd[] = [
  glovo(23.4, 13.59, -333.0, -339.95, [4.5, 0, 0, 0, 2.84, 0.75, 10, 0, 0, 0, 0]),
  glovo(31.6, 14.97, -366.73, -380.21, [3.5, 0, 0, 0, 4.22, 0.75, 10, 0, 0, 0, 0]),
  glovo(71.29, 17.97, 38.65, -10.89, [16.5, -9.21, 0, 0, 8.22, 0.75, 9, 0, 0, 0, 0]),
  glovo(75.7, 10.39, -222.74, -285.86, [16.5, 0, 0, 0, 8.89, 1.5, 0, 0, 0, 0, 0]),
  glovo(2578.56, 664.26, 1774.81, 0, [399, -364.33, -601.41, 340.59, 269.42, 44.25, 10, -27.5, 0, 0, 0]),
  glovo(1992.91, 556.31, 1319.77, 0, [289, -224.99, -544.62, 304.61, 204.95, 36.75, 10, -30.28, 0, 0, 0]),
  glovo(1870.5, 514.31, 1248.18, 0, [348, -20.28, -508.74, 291.41, 177.65, 35.25, 10, -13.58, 0, 0, 0]),
]
// Dos de ctb_sales_detail (el otro origen con neto): cuadran con la cuenta de siempre.
const CTB: FilaBd[] = [
  { gross_sales: 5071.2, commission: 3803.0, net_payout: 1268.2, accumulated_debt: null, otros: Array(11).fill(0), source: 'ctb_sales_detail' },
  { gross_sales: 3478.27, commission: 2608.43, net_payout: 869.84, accumulated_debt: null, otros: Array(11).fill(0), source: 'ctb_sales_detail' },
]
const app = (f: FilaBd) => cuadre({ ventas: f.gross_sales, comision: f.commission, otros: f.otros.filter((x) => x !== 0), neto: f.net_payout, source: f.source, deudaAnterior: f.accumulated_debt })

describe('neto de una liquidación de Glovo: ventas − comisión × 1,21 + deuda anterior', () => {
  it('las siete de producción cuadran, en la app y en el agente (antes: «con diferencia» todas)', () => {
    for (const f of GLOVO) {
      expect(app(f).descuadre, `app ${f.gross_sales}`).toBe(0)
      expect(descuadre(f), `agente ${f.gross_sales}`).toBe(0)
    }
  })
  it('con la cuenta general (sin el IVA de la comisión ni la deuda) no cuadraba ninguna: la prueba puede fallar', () => {
    for (const f of GLOVO) expect(descuadre({ ...f, source: 'otro' }), `${f.gross_sales}`).not.toBe(0)
  })
  it('una diferencia de verdad (2 céntimos o más) se sigue enseñando', () => {
    const f = { ...GLOVO[4], net_payout: GLOVO[4].net_payout - 5 }
    expect(app(f).descuadre).toBe(-5)
    expect(descuadre(f)).toBe(-500)
  })
  it('la frase dice la comisión con IVA y la deuda anterior', () => {
    expect(app(GLOVO[1]).frase).toContain('de comisión con IVA')
    expect(app(GLOVO[1]).frase).toContain('380,21 € de deuda anterior')
  })
  it('las de ctb_sales_detail siguen con la cuenta de siempre (y cuadran)', () => {
    for (const f of CTB) { expect(app(f).descuadre).toBe(0); expect(descuadre(f)).toBe(0) }
  })
})

describe('el asiento de una liquidación de Glovo: su factura es la comisión con IVA, sin los cargos del desglose', () => {
  const cuentas = { cliente430: '43000001', proveedor410: '41000002', comision: '62300000', otrosCargos: '62900000', iva21: { cuenta: '47200021', tipoId: 't21' }, banco: null, pendienteSocio: null }
  const f = GLOVO[4]
  const entrada = (cargos: { concepto: string; importe: number }[]) => ({
    id: 'l', fecha: '2026-10-15', ref: null, plataforma: 'la plataforma', flujo: 'own' as const, ventas: f.gross_sales, comision: f.commission,
    cargos, devoluciones: 0, neto: f.net_payout - (f.accumulated_debt ?? 0), cobrado: null, pedidos: { total: 0, asentados: 0 }, localId: null,
  })
  it('sin cargos (como lo llama ahora el servicio para Glovo) cuadra con el neto: sin «duda» por el neto', () => {
    const { propuesta } = liquidacionPlataforma(entrada([]), cuentas)
    expect(propuesta!.avisos.join(' ')).not.toMatch(/la plataforma dice neto/)
  })
  it('con el desglose como cargos (lo de antes) no cuadra: la factura saldría inflada', () => {
    const { propuesta } = liquidacionPlataforma(entrada([{ concepto: 'Transporte', importe: 399 }, { concepto: 'Cuota de acceso', importe: 269.42 }]), cuentas)
    expect(propuesta!.avisos.join(' ')).toMatch(/la plataforma dice neto/)
  })
  it('a 1 céntimo (el redondeo del IVA de Glovo) tampoco es «duda»', () => {
    const g = GLOVO[0]
    const { propuesta } = liquidacionPlataforma({ ...entrada([]), ventas: g.gross_sales, comision: g.commission, neto: g.net_payout - (g.accumulated_debt ?? 0) }, cuentas)
    expect(propuesta!.avisos.join(' ')).not.toMatch(/la plataforma dice neto/)
  })
})

describe('dos subcuentas: solo cuenta la PRINCIPAL de cada tercero', () => {
  const A = 'a'
  // Las cuatro de producción, con sus códigos y el papel de cada enlace (solo códigos de cuenta).
  const cuentas = [
    { entity_id: 'p1', role: 'principal', codes: ['40000001'] }, { entity_id: 'p1', role: 'gasto', codes: ['60000000'] },
    { entity_id: 'p2', role: 'principal', codes: ['41000002'] }, { entity_id: 'p2', role: 'pago', codes: ['43000001'] },
    { entity_id: 'p3', role: 'principal', codes: ['40000002'] }, { entity_id: 'p3', role: 'pago', codes: ['43000004'] }, { entity_id: 'p3', role: 'gasto', codes: ['60000000'] },
    { entity_id: 'p4', role: 'principal', codes: ['41000004'] }, { entity_id: 'p4', role: 'pago', codes: ['43000003'] },
  ].map((c) => ({ account_id: A, company_id: 'e', entity: 'supplier', ...c }))
  const dos = (cs: unknown[]) => (revisarTerceros({ terceros: [], cuentas: cs, liquidaciones: [], ventas_anio: [], excluidos_347: [] }) as { tipo: string }[]).filter((h) => h.tipo === 'dos_subcuentas')
  it('principal + gasto + pago no son «dos subcuentas» (antes: 4 rojos)', () => {
    expect(dos(cuentas)).toHaveLength(0)
  })
  it('dos principales para el mismo papel sí lo son', () => {
    expect(dos([...cuentas, { account_id: A, company_id: 'e', entity: 'supplier', entity_id: 'p5', role: 'principal', codes: ['40000008', '40000009'] }])).toHaveLength(1)
  })
  it('juntándolas como antes (sin el papel) salían las cuatro: la prueba puede fallar', () => {
    const juntas = ['p1', 'p2', 'p3', 'p4'].map((p) => ({ account_id: A, company_id: 'e', entity: 'supplier', entity_id: p, codes: cuentas.filter((c) => c.entity_id === p).flatMap((c) => c.codes) }))
    expect(dos(juntas)).toHaveLength(4)
  })
})

describe('el NIF de la columna de Diez: el nombre del proveedor no es un «NIF extranjero»', () => {
  it('nombres recortados a 13 letras, como los tres de producción (inventados aquí), no son NIF', () => {
    for (const n of ['RAMIROPEREZGA', 'TALLERESNOVAS', 'DESCONOCIDOSL']) {
      expect(esIvaExtranjero(n), n).toBe(false)
      expect(nifDeListado(n).nif, n).toBeNull()
      expect(nifDeListado(n).aviso).toMatch(/no es un NIF válido/)
    }
  })
  it('un número de IVA de otro país sí: prefijo de país y cifras', () => {
    for (const n of ['PT500000000', 'LU12345678', 'IE1234567T', 'FRXX999999999', 'NL123456789B01', 'DE123456789', 'GB123456789']) expect(nifDeListado(n).nif, n).toBe(n)
  })
  it('y el NIF español, como siempre', () => {
    expect(nifDeListado('B-99000010').nif).toBe('B99000010')
  })
})
