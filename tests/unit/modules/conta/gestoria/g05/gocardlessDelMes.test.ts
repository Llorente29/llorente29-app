// G05 · nº 70 · Lo que GoCardless cobra EN un mes, para compararlo con el recibo
// de ese mes (supabase/functions/_shared/cobro/gocardless.ts). La anual no se
// reparte entre doce: entra entera en su mes. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { gocardlessEnElMes, type SuscripcionGuardada } from '../../../../../../supabase/functions/_shared/cobro/gocardless'
import { prepararRecibo } from '../../../../../../supabase/functions/_shared/cobro/recibo'
import { C, E, asignaciones, catalogo } from './comun'

const sus = (o: Partial<SuscripcionGuardada>): SuscripcionGuardada => ({ importeCent: 14520, intervalo: 'monthly', cada: 1, estado: 'active', proximoCobro: null, inicio: '2025-01-01', ...o })
// Un cliente con su cuota mensual (la del recibo de Sumied, 145,20 €) y el impuesto de sociedades anual de 300 €, que se cobra en junio.
const mensualYAnual = [sus({}), sus({ importeCent: 30000, intervalo: 'yearly', proximoCobro: '2027-06-15', inicio: '2024-06-15' })]

describe('G05 · nº 70 · lo que GoCardless cobra en el mes', () => {
  it('la mensual entra todos los meses; la anual, entera y solo en su mes', () => {
    expect(['2026-12', '2027-01', '2027-05', '2027-06', '2027-07', '2028-06'].map((m) => gocardlessEnElMes(mensualYAnual, m))).toEqual([14520, 14520, 14520, 44520, 14520, 44520])
  })
  it('sin próximo cobro, el mes de la anual sale de su inicio', () => {
    expect(gocardlessEnElMes([sus({ importeCent: 30000, intervalo: 'yearly', inicio: '2025-06-01' })], '2026-06')).toBe(30000)
    expect(gocardlessEnElMes([sus({ importeCent: 30000, intervalo: 'yearly', inicio: '2025-06-01' })], '2026-12')).toBe(0)
  })
  it('una cada tres meses, en sus meses; una semanal no se compara; las que no están activas no cuentan', () => {
    const trimestral = sus({ importeCent: 9000, cada: 3, proximoCobro: '2027-01-05' })
    expect(['2026-10', '2026-11', '2026-12', '2027-01'].map((m) => gocardlessEnElMes([trimestral], m))).toEqual([9000, 0, 0, 9000])
    expect(gocardlessEnElMes([sus({ intervalo: 'weekly' })], '2026-12')).toBe(0)
    expect(gocardlessEnElMes([sus({ estado: 'cancelled' })], '2026-12')).toBeNull()
    expect(gocardlessEnElMes([], '2026-12')).toBeNull()
  })
  it('un cliente con una mensual y una anual: el recibo de diciembre sale «igual», no «GoCardless le cobraba 170,20 € al mes…» (145,20 + 300 / 12)', () => {
    const totalCent = gocardlessEnElMes(mensualYAnual, '2026-12')!
    const r = prepararRecibo({ catalogo: catalogo(), asignaciones: asignaciones(), clienteId: C, empresaId: E, mes: '2026-12', situacionElDia1: 'activo',
      anterior: { mes: '2026-11', totalCent, lineas: [], deGoCardless: true } })
    if (!r.hay) throw new Error(r.porque)
    expect([r.recibo.totalCent, r.recibo.cambios, r.recibo.igualQueElMesPasado]).toEqual([14520, [], true])
  })
})

// nº 82 · Los MISMOS casos que la prueba de staging de conta_gocardless_del_mes
// (supabase/staging/sql/20261110_g05_gocardless_del_mes_prueba.sql): la base y
// «Revisar el cobro» cuentan igual.
describe('nº 82 · los casos de la prueba de la base', () => {
  const s = (importe: number, intervalo: string, cada: number, inicio: string, proximo: string | null, estado = 'active') =>
    ({ importeCent: importe * 100, intervalo, cada, estado, proximoCobro: proximo, inicio })
  const talleres = [
    s(25, 'monthly', 1, '2026-01-05', '2026-12-05'), s(25, 'monthly', 1, '2026-01-05', '2026-12-05'), s(25, 'monthly', 1, '2026-01-05', '2026-12-05'),
    s(150, 'monthly', 1, '2026-01-05', '2026-12-05'), s(300, 'yearly', 1, '2026-06-05', '2027-06-05'), s(60, 'monthly', 3, '2026-01-05', null),
    s(10, 'weekly', 1, '2026-01-05', '2026-11-16'), s(99, 'monthly', 1, '2026-01-05', null, 'cancelled'),
  ]
  it.each([['2026-11', 225], ['2026-12', 225], ['2027-01', 285], ['2027-04', 285], ['2027-06', 525], ['2027-07', 285]])('%s: %i €', (mes, euros) => {
    expect(gocardlessEnElMes(talleres, mes)).toBe(euros * 100)
  })
})
