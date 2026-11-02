// B01 · Cola 1b (Julio, 02/11) · Releer los últimos 7 días, sin duplicar, y
// contar los pendientes. El caso es el del 30/10 con importes inventados: un
// cargo entra y el traspaso que lo cubría no; llega después, con su fecha.
// Todo inventado (el repositorio es público): ni IBAN, ni nombres, ni importes
// reales. El cliente de open-banking.io es simulado.
import { describe, expect, it } from 'vitest'
import {
  FORMATO_TARDE, quitarLoQueYaEsta, RELEER_DIAS_OBI, proveedorOpenBankingIo, sincronizarEmpresa,
  type BaseAgregador, type ClienteOpenBankingIo, type CuentaObi, type MovimientoEnFolvy, type TransaccionObi,
} from '../../../../supabase/functions/_shared/bancoAgregador.ts'
import { estadoHueco, textoHueco } from '@/modules/conta/lib/huecoBanco'

const IBAN = 'ES9101820000000000000001'
const tx = (id: string, fecha: string, amount: string, ind: 'DBIT' | 'CRDT', status = 'BOOK'): TransaccionObi => ({
  id, currency: 'EUR', creditDebitIndicator: ind, status, bookingDate: fecha, valueDate: fecha, transactionDate: null, bankTransactionCode: null,
  amount, creditorName: null, debtorName: null, remittanceInformation: 'CONCEPTO INVENTADO', note: null,
})
const cuenta = (saldo: string, fecha: string): CuentaObi => ({
  id: 'a', aspspName: 'BBVA', currency: 'EUR', needsReconnect: false, iban: IBAN, ownerName: 'TABERNA DE PRUEBA SL', displayName: null,
  balances: [{ type: 'ITBD', amount: saldo, currency: 'EUR', referenceDate: fecha }],
})
function cliente(movs: TransaccionObi[], c: CuentaObi): ClienteOpenBankingIo & { pedidos: string[] } {
  const pedidos: string[] = []
  return {
    pedidos,
    getAccounts: async () => [c],
    getTransactions: async (_id, q = {}) => {
      pedidos.push(`${q.from}..${q.to}`)
      const t = movs.filter((m) => (!q.from || (m.bookingDate ?? '') >= q.from) && (!q.to || (m.bookingDate ?? '') <= q.to))
      return { items: t.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50)), total: t.length }
    },
    getConnections: async () => [{ sessionId: 's1', aspspName: 'BBVA', validUntil: '2027-01-26T00:00:00Z', status: 'Active', isLive: true, accountIds: ['a'] }],
    syncAll: async () => ({ accounts: 1, newTransactions: 0, failures: [] }),
  }
}
function base(enFolvy: MovimientoEnFolvy[], extractos: { fuente: string; desde: string; hasta: string }[]) {
  const importados: Record<string, unknown>[] = [], registros: Record<string, unknown>[] = [], apuntes: Record<string, unknown>[] = []
  const b: BaseAgregador = {
    bancos: async () => [{ id: 'banco-a', nombre: 'BBVA ···0001', iban: IBAN }],
    extractos: async () => extractos,
    importar: async (a) => { importados.push(a); return { nuevos: (a.p_movs as unknown[]).length, repetidos: 0, posibles_repetidos: 0, continuidad: a.p_saldo_inicial === null ? 'sin_saldos' : 'sigue', hueco: null } },
    apuntar: async (a) => { apuntes.push(a) },
    movimientosEnFolvy: async (_t, desde, hasta) => enFolvy.filter((m) => m.fecha >= desde && m.fecha <= hasta),
    registrar: async (a) => { registros.push(a) },
  }
  return { b, importados, registros, apuntes }
}
const OBI = 'agregador:open-banking-io'
const leidos = [
  { fuente: 'fichero', desde: '2026-10-15', hasta: '2026-10-22' },
  { fuente: OBI, desde: '2026-10-15', hasta: '2026-10-28' },
  { fuente: OBI, desde: '2026-10-29', hasta: '2026-10-29' },
  { fuente: OBI, desde: '2026-10-30', hasta: '2026-10-30' },
]
// Lo que ya está en Folvy: el cargo del 30/10 y la tarjeta del 29/10 entraron por la conexión
// (con su referencia); un pago del 27/10 entró por un Norma 43 (sin referencia).
const enFolvy: MovimientoEnFolvy[] = [
  { fecha: '2026-10-27', importeCent: -3500, ref2: null },
  { fecha: '2026-10-29', importeCent: -10000, ref2: 'c1' },
  { fecha: '2026-10-30', importeCent: -330846, ref2: 'ss' },
]
// Lo que da el banco el 02/11: lo de antes, el traspaso del 30/10 (ya contabilizado), lo del 31/10 y un pendiente.
const delBanco = [
  tx('n43', '2026-10-27', '35.00', 'DBIT'), tx('c1', '2026-10-29', '100.00', 'DBIT'),
  tx('ss', '2026-10-30', '3308.46', 'DBIT'), tx('tr', '2026-10-30', '3308.46', 'CRDT'),
  tx('n1', '2026-10-31', '10.00', 'DBIT'), tx('p1', '2026-11-01', '5.00', 'DBIT', 'PDNG'),
]

describe('Cola 1b · lo que ya está en Folvy', () => {
  it('por la referencia del proveedor, y lo demás por día e importe, uno a uno', () => {
    const m = (id: string, fecha: string, c: number) => ({ id, fecha, fechaValor: fecha, importeCent: c, concepto: 'x', contraparte: null })
    // Dos cafés iguales el mismo día: uno estaba (por Norma 43), el otro no.
    const fuera = quitarLoQueYaEsta([m('a', '2026-10-27', -120), m('b', '2026-10-27', -120), m('c', '2026-10-28', 500)],
      [{ fecha: '2026-10-27', importeCent: -120, ref2: null }, { fecha: '2026-10-28', importeCent: 500, ref2: 'c' }])
    expect(fuera.map((x) => x.id)).toEqual(['b'])
    // Un movimiento que entró por la conexión no cuenta dos veces como «del mismo día e importe».
    expect(quitarLoQueYaEsta([m('c', '2026-10-28', 500), m('d', '2026-10-28', 500)], [{ fecha: '2026-10-28', importeCent: 500, ref2: 'c' }]).map((x) => x.id)).toEqual(['d'])
  })
})

describe('Cola 1b · cada lectura vuelve a leer los últimos 7 días', () => {
  it('el traspaso que llegó tarde entra en su propio extracto, sin duplicar lo que ya estaba, y lo nuevo sigue como siempre', async () => {
    const { b, importados, registros, apuntes } = base(enFolvy, leidos)
    const c = cliente(delBanco, cuenta('65.55', '2026-11-02'))
    const [parte] = await sincronizarEmpresa(b, proveedorOpenBankingIo(c, '2026-11-02'), { accountId: 'cta', companyId: 'emp', banco: 'BBVA', renovar: null },
      '2026-11-02', '2026-11-01', { releerDias: RELEER_DIAS_OBI })
    expect(RELEER_DIAS_OBI).toBe(7)
    expect(c.pedidos[0]).toBe('2026-10-26..2026-11-02')
    expect(importados).toHaveLength(2)
    // 1 · Lo que llegó tarde: solo el traspaso, sin saldos, con su formato.
    expect(importados[0]).toMatchObject({ p_formato: FORMATO_TARDE('open-banking-io'), p_fuente: OBI, p_desde: '2026-10-30', p_hasta: '2026-10-30', p_saldo_inicial: null, p_saldo_final: null })
    expect((importados[0].p_movs as { importe: number; ref2: string }[]).map((m) => [m.ref2, m.importe])).toEqual([['tr', 3308.46]])
    expect(String(importados[0].p_sin_comprobar)).toContain('últimos 7 días')
    // 2 · Lo nuevo, desde el día siguiente al último leído: su saldo inicial es el de antes (75,55).
    expect(importados[1]).toMatchObject({ p_formato: OBI, p_desde: '2026-10-31', p_hasta: '2026-11-01', p_saldo_final: 65.55, p_saldo_inicial: 75.55 })
    expect((importados[1].p_movs as unknown[]).length).toBe(1)
    expect(parte).toMatchObject({ estado: 'al_dia', tarde: 1, tardeCent: 330846, pendientes: 1, pendientesCent: -500, desdeReleido: '2026-10-26' })
    expect(parte.mensaje).toContain('han llegado tarde 1 (3308,46 €)')
    expect(parte.mensaje).toContain('Hay 1 movimiento pendiente en el banco (-5,00 €)')
    // El registro de la lectura lleva los pendientes y lo que llegó tarde.
    expect(registros).toHaveLength(1)
    expect(registros[0]).toMatchObject({ p_treasury: 'banco-a', p_pendientes: 1, p_pendientes_importe: -5, p_tarde: 1, p_tarde_importe: 3308.46, p_releido_desde: '2026-10-26', p_estado: 'al_dia' })
    expect(apuntes).toHaveLength(1)
  })
  it('la noche siguiente no lo vuelve a meter', async () => {
    const yaTodo = [...enFolvy, { fecha: '2026-10-30', importeCent: 330846, ref2: 'tr' }, { fecha: '2026-10-31', importeCent: -1000, ref2: 'n1' }]
    const { b, importados, registros } = base(yaTodo, [...leidos, { fuente: OBI, desde: '2026-10-31', hasta: '2026-11-01' }])
    const c = cliente(delBanco.filter((t) => t.id !== 'p1'), cuenta('65.55', '2026-11-03'))
    const [parte] = await sincronizarEmpresa(b, proveedorOpenBankingIo(c, '2026-11-03'), { accountId: 'cta', companyId: 'emp', banco: 'BBVA', renovar: null },
      '2026-11-03', '2026-11-02', { releerDias: RELEER_DIAS_OBI })
    expect(importados).toHaveLength(0)
    expect(parte).toMatchObject({ estado: 'sin_movimientos', tarde: 0, pendientes: 0 })
    expect(registros[0]).toMatchObject({ p_tarde: 0, p_pendientes: 0, p_estado: 'sin_movimientos' })
  })
  it('sin opción (Revolut) o la primera vez, como antes: no relee', async () => {
    const { b, importados } = base(enFolvy, leidos)
    const c = cliente(delBanco, cuenta('65.55', '2026-11-02'))
    await sincronizarEmpresa(b, proveedorOpenBankingIo(c, '2026-11-02'), { accountId: 'cta', companyId: 'emp', banco: 'BBVA', renovar: null }, '2026-11-02', '2026-11-01')
    expect(c.pedidos[0]).toBe('2026-10-31..2026-11-02')
    expect(importados.map((i) => i.p_formato)).toEqual([OBI])
    const primera = base([], [{ fuente: 'fichero', desde: '2026-10-15', hasta: '2026-10-22' }])
    const c2 = cliente(delBanco, cuenta('65.55', '2026-11-02'))
    await sincronizarEmpresa(primera.b, proveedorOpenBankingIo(c2, '2026-11-02'), { accountId: 'cta', companyId: 'emp', banco: 'BBVA', renovar: null }, '2026-11-02', '2026-11-01', { releerDias: 7 })
    expect(c2.pedidos[0]).toBe('2026-10-15..2026-11-02')
    expect(primera.importados.map((i) => i.p_formato)).toEqual([OBI])
  })
})

describe('Cola 1b · lo que dice Bancos de un hueco', () => {
  const ext = { desde: '2026-10-30', hasta: '2026-10-30', formato: OBI, huecoCent: 330846, subido: '2026-10-31T02:02:13Z' }
  it('rellenado con lo que llegó tarde', () => {
    const h = estadoHueco(ext, [{ fecha: '2026-10-30', importeCent: 330846, subido: '2026-11-03T02:02:00Z' }], '2026-11-03')
    expect(h).toEqual({ tipo: 'rellenado', rellenoCent: 330846 })
    expect(textoHueco(ext.huecoCent, h)).toEqual({ aviso: false, texto: 'Rellenado: el banco dio tarde 3308,46 € de estos días y ya está en Sumied.' })
  })
  it('abierto: se relee durante 7 días; después, es el proveedor y se dice', () => {
    expect(estadoHueco(ext, [], '2026-11-06')).toEqual({ tipo: 'releyendo', rellenoCent: 0, hasta: '2026-11-06' })
    expect(textoHueco(ext.huecoCent, estadoHueco(ext, [], '2026-11-06')).texto).toBe('Falta un trozo: 3308,46 €. Cada noche se vuelven a leer estos días, hasta el 06/11.')
    const p = estadoHueco(ext, [], '2026-11-07')
    expect(p).toEqual({ tipo: 'proveedor', rellenoCent: 0 })
    expect(textoHueco(ext.huecoCent, p).texto).toContain('falta en lo que da el proveedor (open-banking.io), no en Sumied. Sube el extracto de esos días.')
    // Lo que llegó antes del extracto no cuenta; un hueco de fichero, como siempre.
    expect(estadoHueco(ext, [{ fecha: '2026-10-30', importeCent: 330846, subido: '2026-10-30T02:00:00Z' }], '2026-11-03').tipo).toBe('releyendo')
    expect(textoHueco(500, estadoHueco({ ...ext, formato: 'norma43' }, [], '2026-11-03'))).toEqual({ texto: 'Falta un trozo: 5,00 €', aviso: true })
  })
})
