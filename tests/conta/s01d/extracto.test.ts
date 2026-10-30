// S01d · El extracto de Excel: reordenar dentro del día antes de comprobar la
// cadena de saldos, y entrar con aviso si solo cuadra el total. Datos de
// mentira (el Excel de verdad de Foodint no va a un repositorio público).
import { describe, expect, it } from 'vitest'
import { cuadrarCuenta, encadenarPorDia, type CuentaLeida, type MovimientoLeido } from '@/modules/conta/lib/extractoBanco'

const mov = (fecha: string, euros: number, concepto = 'MOVIMIENTO'): MovimientoLeido => ({
  fecha, fechaValor: fecha, importeCent: Math.round(euros * 100), conceptoBanco: concepto, contraparte: null, conceptoComun: null, conceptoPropio: null,
  numeroDocumento: null, referencia1: null, referencia2: null, equivalencia: null, tipoMovimiento: null,
} as MovimientoLeido)
const cuenta = (movimientos: MovimientoLeido[], saldos: number[]): CuentaLeida => ({
  iban: null, identificacion: '···· 6536', titular: null, divisa: 'EUR', desde: null, hasta: null, saldoInicialCent: null, saldoFinalCent: null,
  movimientos, control: null, saldosPorFila: saldos.map((x) => Math.round(x * 100)),
})

describe('reordenar los movimientos de un mismo día', () => {
  // Saldo de partida 100,00. El 28/09 pasó −4,99 → 145,01; +20 → 165,01; −2 → 163,01,
  // y el banco lo pone en otro orden: −2 (163,01), −4,99 (145,01), +20 (165,01).
  const movs = [mov('2026-09-27', 50), mov('2026-09-28', -2), mov('2026-09-28', -4.99), mov('2026-09-28', 20)]
  const saldos = [150, 163.01, 145.01, 165.01]
  it('pone primero el que sale del saldo anterior', () => {
    expect(encadenarPorDia(movs, saldos.map((x) => Math.round(x * 100)))).toEqual([0, 2, 3, 1])
  })
  it('después de reordenar, encadena: entra sin aviso', () => {
    const c = cuadrarCuenta(cuenta(movs, saldos))
    expect(c).toMatchObject({ ok: true, motivos: [], avisos: [], filasRotas: [] })
  })
  it('lo que sigue roto (otro día, otra cosa) entra con aviso si el total cuadra, con sus filas', () => {
    // El 29/09 el banco apunta un saldo que no sale de la fila anterior, y el siguiente lo recompone.
    const m2 = [...movs, mov('2026-09-29', -10, 'RECIBO'), mov('2026-09-30', -5, 'COMISION')]
    const c = cuadrarCuenta(cuenta(m2, [...saldos, 154.01, 148.01]))
    expect(c.ok).toBe(true)
    expect(c.avisos).toEqual(['···· 6536: en 2 filas el saldo del banco no sale de la anterior; el total cuadra.'])
    expect(c.filasRotas?.map((f) => [f.fecha, f.saldoCent, f.esperadoCent])).toEqual([['2026-09-29', 15401, 15301], ['2026-09-30', 14801, 14901]])
  })
})
