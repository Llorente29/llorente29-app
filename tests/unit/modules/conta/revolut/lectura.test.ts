// B01 Revolut · PR 1 · La lectura de Revolut: sin duplicados, por patas, solo lo
// completado, con la fecha de Madrid, devoluciones y comisiones. Todo
// inventado (T11): ni IBAN, ni nombres, ni importes reales. El IBAN es del
// banco 9999 con dígitos de control 00, que no valen: se ven inventados.
//
// La prueba de «sin duplicados» va contra una base simulada que hace lo mismo
// que bank_importar: on conflict (treasury_account_id, fingerprint) do nothing.
import { describe, expect, it } from 'vitest'
import { paraImportar, sincronizarEmpresa, type BaseAgregador } from '../../../../../supabase/functions/_shared/bancoAgregador.ts'
import {
  OPCIONES_REVOLUT, movimientosDeRevolut, proveedorRevolut, SIN_CADUCIDAD, diaMadrid,
  type ClienteLecturaRevolut, type CuentaRevolut, type TransaccionRevolut,
} from '../../../../../supabase/functions/_shared/revolut/lectura.ts'

const IBAN = 'ES0099990000000000005678'
const CUENTA = 'cuenta-eur-1'
const OTRA = 'cuenta-eur-2'

function tx(p: Partial<TransaccionRevolut> & { id: string; amount: number; at: string; cuenta?: string; fee?: number }): TransaccionRevolut {
  return {
    id: p.id, type: p.type ?? 'transfer', state: p.state ?? 'completed', created_at: p.created_at ?? p.at, updated_at: p.updated_at ?? p.at,
    completed_at: p.completed_at === undefined ? p.at : p.completed_at, reference: p.reference ?? null,
    legs: p.legs ?? [{ leg_id: 'l1', account_id: p.cuenta ?? CUENTA, amount: p.amount, fee: p.fee ?? 0, currency: 'EUR', description: 'To Suministros Prueba S.L.' }],
  }
}

describe('movimientosDeRevolut', () => {
  it('solo lo completado: pending, created, declined y failed no entran', () => {
    const txs = [
      tx({ id: 'a', amount: -10, at: '2026-10-20T10:00:00Z' }),
      tx({ id: 'b', amount: -11, at: '2026-10-20T11:00:00Z', state: 'pending', completed_at: null }),
      tx({ id: 'c', amount: -12, at: '2026-10-20T11:00:00Z', state: 'created', completed_at: null }),
      tx({ id: 'd', amount: -13, at: '2026-10-20T12:00:00Z', state: 'declined', completed_at: null }),
      tx({ id: 'e', amount: -14, at: '2026-10-20T12:00:00Z', state: 'failed', completed_at: null }),
    ]
    expect(movimientosDeRevolut(txs, CUENTA, '2026-10-20', '2026-10-20').map((m) => m.id)).toEqual(['a:l1'])
  })

  it('la fecha es la de completed_at en Madrid (regla 4), no la de creación', () => {
    // Creada el 20 a las 23:50 de Madrid, completada el 21 a las 00:10 de Madrid.
    const t = tx({ id: 'n', amount: -50, at: '2026-10-20T22:10:00Z', created_at: '2026-10-20T21:50:00Z' })
    expect(diaMadrid('2026-10-20T22:10:00Z')).toBe('2026-10-21')
    expect(movimientosDeRevolut([t], CUENTA, '2026-10-20', '2026-10-20')).toEqual([])
    expect(movimientosDeRevolut([t], CUENTA, '2026-10-21', '2026-10-21').map((m) => [m.fecha, m.importeCent])).toEqual([['2026-10-21', -5000]])
  })

  it('una pata por cuenta: una transferencia entre dos cuentas propias entra una vez en cada una', () => {
    const t = tx({ id: 'x', amount: 0, at: '2026-10-20T10:00:00Z', legs: [
      { leg_id: 'l1', account_id: CUENTA, amount: -100, currency: 'EUR', description: 'To Ahorro' },
      { leg_id: 'l2', account_id: OTRA, amount: 100, currency: 'EUR', description: 'From Principal' },
    ] })
    expect(movimientosDeRevolut([t], CUENTA, '2026-10-20', '2026-10-20').map((m) => [m.id, m.importeCent])).toEqual([['x:l1', -10000]])
    expect(movimientosDeRevolut([t], OTRA, '2026-10-20', '2026-10-20').map((m) => [m.id, m.importeCent])).toEqual([['x:l2', 10000]])
  })

  it('la comisión de la pata, un movimiento aparte', () => {
    const t = tx({ id: 'f', amount: -200, fee: 0.3, at: '2026-10-20T10:00:00Z' })
    expect(movimientosDeRevolut([t], CUENTA, '2026-10-20', '2026-10-20').map((m) => [m.id, m.importeCent])).toEqual([['f:l1', -20000], ['f:l1:comision', -30]])
  })

  it('una devolución: lo que entró se queda y entra el contrario el día que se devolvió', () => {
    const t = tx({ id: 'r', amount: -75.5, at: '2026-10-10T09:00:00Z', state: 'reverted', updated_at: '2026-10-13T09:00:00Z' })
    expect(movimientosDeRevolut([t], CUENTA, '2026-10-10', '2026-10-10').map((m) => [m.id, m.importeCent])).toEqual([['r:l1', -7550]])
    expect(movimientosDeRevolut([t], CUENTA, '2026-10-13', '2026-10-13').map((m) => [m.id, m.fecha, m.importeCent])).toEqual([['r:l1:vuelta', '2026-10-13', 7550]])
    // Devuelta sin haberse completado nunca: no entró nada, no sale nada.
    expect(movimientosDeRevolut([tx({ id: 's', amount: -1, at: '2026-10-10T09:00:00Z', state: 'reverted', completed_at: null })], CUENTA, '2026-10-01', '2026-10-31')).toEqual([])
  })

  it('el mismo orden cada vez que se lee el mismo día, aunque Revolut las dé en otro orden', () => {
    const txs = [tx({ id: 'p2', amount: -5, at: '2026-10-20T12:00:00Z' }), tx({ id: 'p1', amount: -5, at: '2026-10-20T09:00:00Z' })]
    const a = movimientosDeRevolut(txs, CUENTA, '2026-10-20', '2026-10-20')
    const b = movimientosDeRevolut([...txs].reverse(), CUENTA, '2026-10-20', '2026-10-20')
    expect(a.map((m) => m.id)).toEqual(['p1:l1', 'p2:l1'])
    expect(paraImportar(a)).toEqual(paraImportar(b))
  })
})

// ── La lectura entera, contra una base que hace lo de bank_importar ──────────
// Lo terminado de Revolut entra en cuanto llega (respuesta 3): se lee hasta
// HOY, se vuelve a leer el último día y solo se manda lo que la base no tiene.

function cliente(txs: TransaccionRevolut[], cuentas: CuentaRevolut[]): ClienteLecturaRevolut {
  return {
    cuentas: async () => cuentas,
    datosBanco: async (c) => (c === CUENTA ? [{ iban: IBAN, bic: 'REVOLT21', beneficiary: 'Taberna de Prueba Norte S.L.' }] : [{ iban: null }]),
    transacciones: async (c, desde, hasta) => txs.filter((t) => t.created_at >= desde && t.created_at < hasta && t.legs.some((l) => l.account_id === c)),
  }
}

function baseSimulada() {
  const movimientos = new Map<string, Record<string, unknown>>()
  const extractos: { fuente: string; desde: string; hasta: string; inicial: number | null; final: number | null }[] = []
  const apuntes: Record<string, unknown>[] = []
  const base: BaseAgregador = {
    bancos: async () => [{ id: 'banco-revolut', nombre: 'Revolut · Principal', iban: 'ES00 9999 0000 0000 0000 5678' }],
    extractos: async () => extractos,
    async importar(args) {
      let nuevos = 0, repetidos = 0
      for (const m of args.p_movs as Record<string, unknown>[]) {
        const k = `${args.p_treasury}|${m.huella}`
        if (movimientos.has(k)) repetidos++
        else { movimientos.set(k, m); nuevos++ }
      }
      // La continuidad de la 2212: el último extracto de Revolut que acaba antes o el mismo día en que empieza este.
      const prev = [...extractos].filter((e) => e.final !== null && e.hasta <= String(args.p_desde)).pop()
      const inicial = args.p_saldo_inicial as number | null
      extractos.push({ fuente: String(args.p_fuente), desde: String(args.p_desde), hasta: String(args.p_hasta), inicial, final: args.p_saldo_final as number | null })
      const continuidad = inicial === null ? 'sin_saldo' : !prev ? 'primero' : Math.round(prev.final! * 100) === Math.round(inicial * 100) ? 'sigue' : 'hueco'
      return { nuevos, repetidos, posibles_repetidos: 0, continuidad }
    },
    async apuntar(a) { apuntes.push(a) },
    async conocidos(_t, refs) { return new Set(refs.filter((r) => [...movimientos.values()].some((m) => m.ref2 === r))) },
  }
  return { base, movimientos, extractos, apuntes }
}

const empresa = { accountId: 'a', companyId: 'c', banco: 'Revolut', renovar: null }
const leer = (s: ReturnType<typeof baseSimulada>, txs: TransaccionRevolut[], cuentas: CuentaRevolut[], hoy: string, desdeInicial?: string) =>
  sincronizarEmpresa(s.base, proveedorRevolut(cliente(txs, cuentas), hoy), empresa, hoy, hoy, { ...OPCIONES_REVOLUT, desdeInicial })

describe('proveedorRevolut con sincronizarEmpresa', () => {
  const cuentas = (saldo: number): CuentaRevolut[] => [
    { id: CUENTA, name: 'Principal', balance: saldo, currency: 'EUR', state: 'active' },
    { id: 'usd', name: 'Dólares', balance: 50, currency: 'USD', state: 'active' },
  ]
  const antes = [tx({ id: 't1', amount: -100, at: '2026-10-28T10:00:00Z' }), tx({ id: 't2', amount: 250, at: '2026-10-29T10:00:00Z' })]
  const deHoy = tx({ id: 't3', amount: -20, at: '2026-10-31T08:00:00Z' })

  it('la primera lectura trae desde el día que pidió la persona HASTA HOY, con el saldo de ahora', async () => {
    const s = baseSimulada()
    const partes = await leer(s, [...antes, deHoy], cuentas(1000), '2026-10-31', '2026-10-25')
    expect(partes).toHaveLength(1) // la de dólares no se ofrece
    expect(partes[0]).toMatchObject({ estado: 'al_dia', desde: '2026-10-25', hasta: '2026-10-31', leidos: 3, nuevos: 3, repetidos: 0, saldoBancoCent: 100000, saldoFinalCent: 100000 })
    expect(s.apuntes[0]).toMatchObject({ p_proveedor: 'revolut', p_caduca: SIN_CADUCIDAD })
  })

  it('UN MOVIMIENTO DE HOY ENTRA HOY, y leerlo otra vez no lo duplica', async () => {
    const s = baseSimulada()
    // 09:00: entra el de las 08:00 de hoy (UTC; las 09:00 de Madrid).
    await leer(s, [...antes, deHoy], cuentas(1000), '2026-10-31', '2026-10-25')
    expect([...s.movimientos.values()].map((m) => m.ref2)).toContain('t3:l1')
    expect(s.extractos).toHaveLength(1)

    // 10:00, la lectura de cada hora (o un aviso repetido): nada nuevo. Ni movimientos ni extracto.
    const otra = await leer(s, [...antes, deHoy], cuentas(1000), '2026-10-31')
    expect(otra[0]).toMatchObject({ estado: 'sin_movimientos', nuevos: 0, repetidos: 1, saldoFinalCent: 100000 })
    expect(s.movimientos.size).toBe(3)
    expect(s.extractos).toHaveLength(1)

    // 12:00: llega otro de hoy (el pago de una factura). Entra solo él, al momento, y el saldo sigue.
    const pago = tx({ id: 't4', amount: -1028.5, at: '2026-10-31T11:30:00Z' })
    const tras = await leer(s, [...antes, deHoy, pago], cuentas(1000 - 1028.5), '2026-10-31')
    expect(tras[0]).toMatchObject({ estado: 'al_dia', desde: '2026-10-31', hasta: '2026-10-31', leidos: 2, nuevos: 1, repetidos: 1, continuidad: 'sigue' })
    expect(s.movimientos.size).toBe(4)
    expect(s.extractos.at(-1)).toMatchObject({ desde: '2026-10-31', hasta: '2026-10-31', inicial: 1000, final: -28.5 })

    // Mañana, la primera lectura vuelve a mirar hoy y no duplica nada.
    const manana = await leer(s, [...antes, deHoy, pago], cuentas(1000 - 1028.5), '2026-11-01')
    expect(manana[0]).toMatchObject({ estado: 'sin_movimientos', nuevos: 0, repetidos: 2 })
    expect(s.movimientos.size).toBe(4)
  })

  it('la huella de un movimiento es la misma leído solo o con el resto de su día', () => {
    const solo = paraImportar(movimientosDeRevolut([deHoy], CUENTA, '2026-10-31', '2026-10-31'))
    const conOtro = paraImportar(movimientosDeRevolut([deHoy, tx({ id: 't4', amount: -5, at: '2026-10-31T11:30:00Z' })], CUENTA, '2026-10-31', '2026-10-31'))
    expect(conOtro[0].huella).toBe(solo[0].huella)
  })

  it('SIN DUPLICADOS aunque la base no supiera qué tiene: la huella dura los rechaza', async () => {
    const s = baseSimulada()
    const sinConocidos = { ...s.base, conocidos: undefined }
    await sincronizarEmpresa(sinConocidos, proveedorRevolut(cliente(antes, cuentas(1150)), '2026-10-31'), empresa, '2026-10-31', '2026-10-31', { ...OPCIONES_REVOLUT, desdeInicial: '2026-10-25' })
    s.extractos.length = 0
    const otra = await sincronizarEmpresa(sinConocidos, proveedorRevolut(cliente(antes, cuentas(1150)), '2026-10-31'), empresa, '2026-10-31', '2026-10-31', { ...OPCIONES_REVOLUT, desdeInicial: '2026-10-25' })
    expect(otra[0]).toMatchObject({ nuevos: 0, repetidos: 2 })
    expect(s.movimientos.size).toBe(2)
  })
})
