// tests/conta/e05b-bancos/mes.test.ts
//
// E05b · El periodo de Bancos: qué mes queda con Re Pág y Av Pág y qué se lee de
// cada mes (los movimientos de ese mes, la 572 a su corte y el extracto que da el
// saldo del banco), con la regla de la pantalla de hoy. Datos inventados.
import { describe, expect, it, vi } from 'vitest'

const bd = vi.hoisted(() => ({ leerMovimientos: vi.fn(), saldosContables: vi.fn(), leerDatosBancos: vi.fn() }))
const base = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/modules/conta/services/bancosPantallas', () => bd)
vi.mock('@/modules/conta/services/bd', () => ({ tabla: () => ({}), mensaje: (x: string) => x, rpc: base.rpc }))
vi.mock('@/lib/supabase', () => ({ supabase: null }))

import { corteDelMes, extractoDelMes, mesDeAlLado, textoMes } from '@/modules/conta/nucleo/bancos/mes'
import { leerBancos } from '@/modules/conta/nucleo/bancos/servicio'
import type { BancoVista, DatosBancos } from '@/modules/conta/services/bancosPantallas'

const MESES = ['2026-11', '2026-10', '2026-09'] // como mesesElegibles: del más nuevo al más viejo
const ext = (cuentaId: string, hasta: string, saldoFinalCent: number | null) => ({ cuentaId, hasta, saldoFinalCent })

describe('E05b · el mes', () => {
  it('Re Pág, el de antes; Av Pág, el de después; en los extremos se queda', () => {
    expect(mesDeAlLado(MESES, '2026-10', 'PageUp')).toBe('2026-09')
    expect(mesDeAlLado(MESES, '2026-10', 'PageDown')).toBe('2026-11')
    expect(mesDeAlLado(MESES, '2026-09', 'PageUp')).toBe('2026-09')
    expect(mesDeAlLado(MESES, '2026-11', 'PageDown')).toBe('2026-11')
    expect(textoMes('2026-09')).toBe('Septiembre 2026')
  })
  it('el corte: el fin del mes, u hoy si no ha acabado', () => {
    expect(corteDelMes('2026-09', '2026-11-19')).toBe('2026-09-30')
    expect(corteDelMes('2026-11', '2026-11-19')).toBe('2026-11-19')
  })
  it('el saldo del banco: el primer extracto de ese banco que acaba dentro del mes y trae saldo (el .find de hoy)', () => {
    const extractos = [ext('b', '2026-10-31', 121410), ext('otro', '2026-09-30', 1), ext('b', '2026-09-30', null), ext('b', '2026-09-15', 100000)]
    expect(extractoDelMes(extractos, 'b', '2026-10')?.saldoFinalCent).toBe(121410)
    expect(extractoDelMes(extractos, 'b', '2026-09')?.saldoFinalCent).toBe(100000)
    expect(extractoDelMes(extractos, 'b', '2026-08')).toBeNull()
  })
})

// R08 · El saldo del banco es el del último extracto de la cadena (bank_saldo_extracto) y la 572,
// lo que está en el diario (bank_saldo_diario): la base los da a la fecha de corte del mes.
describe('E05b · qué se lee de cada mes (R08: el saldo del extracto y el del diario, de la base)', () => {
  const banco = { id: 'b', cuenta: '57200050' } as unknown as BancoVista
  const datos = { corte: null, extractos: [ext('b', '2026-10-31', 121410), ext('b', '2026-09-30', 100000)] } as unknown as DatosBancos
  const responder = (extracto: { saldo: number; hasta: string } | null, diario: number) => base.rpc.mockImplementation((nombre: string) =>
    Promise.resolve(nombre === 'bank_saldo_extracto' ? (extracto ? [{ ...extracto, llego: '2026-11-19T12:17:00Z' }] : []) : diario))
  it('septiembre: sus movimientos, la 572 al 30/09 y el extracto de septiembre', async () => {
    bd.leerMovimientos.mockResolvedValue([])
    responder({ saldo: 1000, hasta: '2026-09-30' }, -30)
    const r = await leerBancos('acc', 'emp', datos, banco, '2026-09', '2026-11-19')
    expect(bd.leerMovimientos).toHaveBeenLastCalledWith('acc', 'b', '2026-09')
    expect(base.rpc).toHaveBeenCalledWith('bank_saldo_extracto', { p_treasury: 'b', p_hasta: '2026-09-30' })
    expect(base.rpc).toHaveBeenCalledWith('bank_saldo_diario', { p_company: 'emp', p_hasta: '2026-09-30', p_cuenta: '57200050' })
    expect(r.extractoHasta).toBe('2026-09-30')
    expect(r.cuadre).toMatchObject({ bancoCent: 100000, libroCent: -3000, faltaCent: 103000 })
  })
  it('octubre: los suyos, la 572 al 31/10 y el extracto de octubre', async () => {
    responder({ saldo: 1214.10, hasta: '2026-10-31' }, 1214.10)
    const r = await leerBancos('acc', 'emp', datos, banco, '2026-10', '2026-11-19')
    expect(bd.leerMovimientos).toHaveBeenLastCalledWith('acc', 'b', '2026-10')
    expect(base.rpc).toHaveBeenCalledWith('bank_saldo_diario', { p_company: 'emp', p_hasta: '2026-10-31', p_cuenta: '57200050' })
    expect(r.cuadre).toMatchObject({ bancoCent: 121410, libroCent: 121410, faltaCent: 0 })
  })
  it('un mes sin extracto que acabe dentro: no se sabe el saldo del banco', async () => {
    responder({ saldo: 1000, hasta: '2026-09-30' }, 0)
    const r = await leerBancos('acc', 'emp', datos, banco, '2026-10', '2026-11-19')
    expect(r.extractoHasta).toBeNull()
    expect(r.cuadre.bancoCent).toBeNull()
  })
})
