// B01·14 (03/11) · Mirar lo que da open-banking.io de unos días, sin importar
// nada, y apuntar en la lectura lo que dio de los días releídos. El caso es el
// del 30/10 con importes inventados (el repositorio es público): un traspaso
// que el banco tiene sin fecha contable, o con la contable fuera del filtro.
import { describe, expect, it } from 'vitest'
import {
  mirarCuenta, proveedorOpenBankingIo, sincronizarEmpresa, tocaLosDias, vistoDeObi,
  type BaseAgregador, type ClienteOpenBankingIo, type CuentaObi, type TransaccionObi,
} from '../../../../supabase/functions/_shared/bancoAgregador.ts'

const IBAN = 'ES9101820000000000000001'
const tx = (id: string, f: { contable?: string | null; valor?: string | null; operacion?: string | null }, amount: string, ind: 'DBIT' | 'CRDT', status: string | null = 'BOOK'): TransaccionObi => ({
  id, currency: 'EUR', creditDebitIndicator: ind, status, bookingDate: f.contable ?? null, valueDate: f.valor ?? null, transactionDate: f.operacion ?? null,
  bankTransactionCode: null, amount, creditorName: null, debtorName: null, remittanceInformation: 'CONCEPTO INVENTADO', note: null,
})
const cuenta: CuentaObi = { id: 'a', aspspName: 'BBVA', currency: 'EUR', needsReconnect: false, iban: IBAN, ownerName: null, displayName: null,
  balances: [{ type: 'ITBD', amount: '75.55', currency: 'EUR', referenceDate: '2026-11-03' }] }

/** Como open-banking.io: el filtro de fechas va por la contable. */
function cliente(movs: TransaccionObi[], nuevos = 0): ClienteOpenBankingIo & { pedidos: string[] } {
  const pedidos: string[] = []
  return {
    pedidos,
    getAccounts: async () => [cuenta],
    getTransactions: async (_id, q = {}) => {
      pedidos.push(`${q.from ?? '-'}..${q.to ?? '-'}`)
      const t = movs.filter((m) => (!q.from || (m.bookingDate ?? '') >= q.from) && (!q.to || (m.bookingDate ?? '') <= q.to))
      return { items: t.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50)), total: t.length }
    },
    getConnections: async () => [{ sessionId: 's1', aspspName: 'BBVA', validUntil: '2027-01-26T00:00:00Z', status: 'Active', isLive: true, accountIds: ['a'] }],
    syncAll: async () => ({ accounts: 1, newTransactions: nuevos, failures: [] }),
  }
}

describe('mirar lo que da open-banking.io (B01·14)', () => {
  const movs = [
    tx('ss', { contable: '2026-10-30', valor: '2026-10-30' }, '3308.46', 'DBIT'),
    // El traspaso que cubre el cargo, sin fecha contable (solo la de valor): el filtro no lo da.
    tx('traspaso', { contable: null, valor: '2026-10-30' }, '3308.46', 'CRDT', 'PDNG'),
    tx('nov', { contable: '2026-11-02', valor: '2026-11-02' }, '54.98', 'CRDT'),
  ]
  it('cada movimiento con sus tres fechas, el importe con su signo y el estado', () => {
    expect(vistoDeObi(movs[0])).toEqual({ id: 'ss', contable: '2026-10-30', valor: '2026-10-30', operacion: null, importeCent: -330846, estado: 'BOOK' })
    expect(vistoDeObi(movs[1]).importeCent).toBe(330846)
    expect(tocaLosDias(vistoDeObi(movs[1]), '2026-10-29', '2026-10-30')).toBe(true)
    expect(tocaLosDias(vistoDeObi(movs[2]), '2026-10-29', '2026-10-30')).toBe(false)
  })
  it('con el filtro, lo de la lectura; sin él, lo que tiene otra fecha en esos días y el filtro no ha dado', async () => {
    const c = cliente(movs)
    const r = await mirarCuenta(c, 'a', '2026-10-29', '2026-10-30')
    expect(r.conFiltro.map((v) => v.id)).toEqual(['ss'])
    expect(r.soloSinFiltro.map((v) => v.id)).toEqual(['traspaso'])
    expect(r.totalSinFiltro).toBe(3)
    // La primera con el filtro de la lectura; luego sin filtro.
    expect(c.pedidos).toEqual(['2026-10-29..2026-10-30', '-..-'])
  })
  it('sin nada fuera del filtro, lo dice vacío (el banco no lo tiene)', async () => {
    const r = await mirarCuenta(cliente([movs[0], movs[2]]), 'a', '2026-10-29', '2026-10-30')
    expect(r.soloSinFiltro).toEqual([])
  })
})

describe('la lectura apunta lo que dio el banco de los días releídos y lo que trajo al ponerse al día', () => {
  it('releídos del banco: los contabilizados de los días ya leídos, ya estuvieran o no', async () => {
    const movs = [
      tx('ss', { contable: '2026-10-30', valor: '2026-10-30' }, '3308.46', 'DBIT'),
      tx('nov', { contable: '2026-11-02', valor: '2026-11-02' }, '54.98', 'CRDT'),
    ]
    const p = proveedorOpenBankingIo(cliente(movs, 4), '2026-11-03')
    const base: BaseAgregador = {
      bancos: async () => [{ id: 'banco-a', nombre: 'BBVA ···0001', iban: IBAN }],
      extractos: async () => [{ fuente: 'agregador:open-banking-io', desde: '2026-10-30', hasta: '2026-10-30' }],
      importar: async (a) => ({ nuevos: (a.p_movs as unknown[]).length, repetidos: 0, posibles_repetidos: 0, continuidad: 'sigue', hueco: null }),
      apuntar: async () => {},
      movimientosEnFolvy: async () => [{ fecha: '2026-10-30', importeCent: -330846, ref2: 'ss' }],
      registrar: async () => {},
    }
    const [parte] = await sincronizarEmpresa(base, p, { accountId: 'x', companyId: 'y', banco: 'BBVA', renovar: null }, '2026-11-03', '2026-11-02', { releerDias: 7 })
    expect(parte.desdeReleido).toBe('2026-10-27')
    expect(parte.releidosDelBanco).toBe(1)
    expect(parte.releidosDelBancoCent).toBe(-330846)
    expect(parte.tarde).toBe(0)
    expect(p.ultimoRefresco()).toEqual({ cuentas: 1, nuevos: 4 })
  })
})
