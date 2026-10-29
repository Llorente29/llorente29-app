// B01c · Los movimientos del banco entran solos (open-banking.io). Todo
// inventado: ningún IBAN, nombre ni importe real (el repositorio es público,
// RGPD). El cliente de open-banking.io es SIMULADO: devuelve lo que devolvería
// la librería ya descifrado (dist/index.d.ts de @open-banking-io/client 1.3.0).
//
//   · la copia de extractoBanco.ts que usa la función es la misma, byte a byte;
//   · importes, signos, contraparte y concepto de un movimiento;
//   · los saldos del periodo: el del banco es de AHORA, el final del periodo
//     se saca quitando lo de después; solo lo contabilizado; todas las páginas;
//   · desde cuándo se lee cada cuenta;
//   · la huella suave de lo que entra por la conexión es la misma que la de un
//     Norma 43 del mismo día (por eso la base lo reconoce y no lo duplica);
//   · la noche entera contra una base simulada: empareja por IBAN, lo que no es
//     de la empresa no entra, el permiso caducado no lee, un fallo no para a las
//     demás, y sin movimientos no se crea un extracto vacío;
//   · lo que dice Bancos de cada cuenta.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  centimos, desdeCuando, movimientoDeOpenBankingIo, paraImportar, proveedorOpenBankingIo, saldoAlCerrar, saldoDelBanco, sincronizarEmpresa,
  type BaseAgregador, type ClienteOpenBankingIo, type CuentaObi, type TransaccionObi,
} from '../../../../supabase/functions/_shared/bancoAgregador.ts'
import { huellasSuaves } from '@/modules/conta/lib/extractoBanco'
import { leerNorma43, escribirNorma43 } from '@/modules/conta/lib/norma43'
import { lineaConexion, proveedorOpenBankingIo as proveedorDeLaApp, type ConexionCuenta } from '@/modules/conta/lib/agregadorBanco'
import { leerDesdeAgregador } from '@/modules/conta/lib/fuentesBanco'

const IBAN_A = 'ES9101820000000000000001'
const IBAN_B = 'ES9101820000000000000002'

const tx = (id: string, fecha: string, amount: string, ind: 'DBIT' | 'CRDT', extra: Partial<TransaccionObi> = {}): TransaccionObi => ({
  id, currency: 'EUR', creditDebitIndicator: ind, status: 'BOOK', bookingDate: fecha, valueDate: fecha, transactionDate: null, bankTransactionCode: null,
  amount, creditorName: ind === 'DBIT' ? 'PROVEEDOR INVENTADO' : null, debtorName: ind === 'CRDT' ? 'CLIENTE INVENTADO' : null,
  remittanceInformation: 'CONCEPTO INVENTADO', note: null, ...extra,
})

function clienteSimulado(o: {
  cuentas: CuentaObi[]; movs: Record<string, TransaccionObi[]>; conexiones?: { sessionId: string; validUntil: string; isLive?: boolean; accountIds: string[] }[]
  fallos?: { accountId: string; reason: string }[]; porPagina?: number
}): ClienteOpenBankingIo & { llamadas: string[] } {
  const llamadas: string[] = []
  return {
    llamadas,
    getAccounts: async () => { llamadas.push('cuentas'); return o.cuentas },
    getTransactions: async (id, q = {}) => {
      llamadas.push(`movimientos ${id} ${q.from}..${q.to} +${q.offset ?? 0}`)
      // Como la API: lo más nuevo primero, por páginas.
      const todos = [...(o.movs[id] ?? [])].filter((t) => (!q.from || (t.bookingDate ?? '') >= q.from) && (!q.to || (t.bookingDate ?? '') <= q.to))
        .sort((a, b) => (b.bookingDate ?? '').localeCompare(a.bookingDate ?? ''))
      const n = Math.min(q.limit ?? 50, o.porPagina ?? 1000)
      return { items: todos.slice(q.offset ?? 0, (q.offset ?? 0) + n), total: todos.length }
    },
    getConnections: async () => (o.conexiones ?? []).map((c) => ({ sessionId: c.sessionId, aspspName: 'BBVA', validUntil: c.validUntil, status: 'Active', isLive: c.isLive ?? true, accountIds: c.accountIds })),
    syncAll: async () => { llamadas.push('sincronizar'); return { accounts: o.cuentas.length, newTransactions: 0, failures: (o.fallos ?? []).map((f) => ({ ...f, bankErrorCode: null })) } },
  }
}

const cuenta = (id: string, iban: string, saldo: string | null, fecha = '2026-10-29'): CuentaObi => ({
  id, aspspName: 'BBVA', currency: 'EUR', needsReconnect: false, iban, ownerName: 'TABERNA DE PRUEBA SL', displayName: null,
  balances: saldo === null ? [{ type: 'ITAV', amount: '99999.00', currency: 'EUR', referenceDate: fecha }] : [{ type: 'ITBD', amount: saldo, currency: 'EUR', referenceDate: fecha }],
})

describe('B01c · la copia de extractoBanco.ts que usa la función', () => {
  it('es la misma que la de la app, byte a byte (salvo su primera línea)', () => {
    const app = readFileSync('src/modules/conta/lib/extractoBanco.ts', 'utf8').split('\n').slice(1).join('\n')
    const funcion = readFileSync('supabase/functions/_shared/extractoBanco.ts', 'utf8').split('\n').slice(1).join('\n')
    expect(funcion).toBe(app)
  })
})

describe('B01c · un movimiento de open-banking.io', () => {
  it('importes en texto, sin coma flotante', () => {
    expect([centimos('45.10'), centimos('-45.1'), centimos('0.07'), centimos('1234,50'), centimos('+3'), centimos('12.300')]).toEqual([4510, -4510, 7, 123450, 300, 1230])
    expect(() => centimos('12.345')).toThrow(/más de dos decimales/)
    expect(() => centimos('doce')).toThrow(/no se entiende/)
  })
  it('el signo lo dice el indicador; la contraparte, quien no eres tú', () => {
    const sale = movimientoDeOpenBankingIo(tx('t1', '2026-10-27', '45.10', 'DBIT'))
    expect(sale).toEqual({ id: 't1', fecha: '2026-10-27', fechaValor: '2026-10-27', importeCent: -4510, concepto: 'CONCEPTO INVENTADO', contraparte: 'PROVEEDOR INVENTADO' })
    // Aunque el importe venga con signo, manda el indicador.
    expect(movimientoDeOpenBankingIo(tx('t2', '2026-10-27', '-45.10', 'DBIT')).importeCent).toBe(-4510)
    const entra = movimientoDeOpenBankingIo(tx('t3', '2026-10-27T10:00:00Z', '100', 'CRDT', { remittanceInformation: null, note: null }))
    expect(entra).toMatchObject({ fecha: '2026-10-27', importeCent: 10000, concepto: 'CLIENTE INVENTADO', contraparte: 'CLIENTE INVENTADO' })
    expect(() => movimientoDeOpenBankingIo(tx('t4', '', '1', 'DBIT', { bookingDate: null, valueDate: null }))).toThrow(/sin fecha/)
  })
})

describe('B01c · los saldos del periodo', () => {
  it('el saldo contable, nunca el disponible', () => {
    expect(saldoDelBanco([{ type: 'ITAV', amount: '900', currency: 'EUR', referenceDate: null }, { type: 'CLBD', amount: '100.50', currency: 'EUR', referenceDate: '2026-10-28' }], '2026-10-29'))
      .toEqual({ cent: 10050, fecha: '2026-10-28', tipo: 'CLBD' })
    expect(saldoDelBanco([{ type: 'ITAV', amount: '900', currency: 'EUR', referenceDate: null }], '2026-10-29')).toBeNull()
  })
  it('al cerrar un día: el de ahora menos lo de después (y más lo de después del saldo si es más viejo)', () => {
    const movs = [{ fecha: '2026-10-27', importeCent: -1000 }, { fecha: '2026-10-28', importeCent: 2500 }, { fecha: '2026-10-29', importeCent: -300 }]
    expect(saldoAlCerrar({ cent: 50_000, fecha: '2026-10-29' }, movs, '2026-10-28')).toBe(50_300)
    expect(saldoAlCerrar({ cent: 50_000, fecha: '2026-10-29' }, movs, '2026-10-26')).toBe(48_800)
    expect(saldoAlCerrar({ cent: 50_000, fecha: '2026-10-27' }, movs, '2026-10-28')).toBe(52_500)
  })
  it('el proveedor: solo lo contabilizado, todas las páginas, y el periodo cuadra con el saldo del banco', async () => {
    const c = clienteSimulado({
      cuentas: [cuenta('a', 'ES91 0182 0000 0000 0000 0001', '1000.00')], porPagina: 2,
      movs: { a: [tx('1', '2026-10-25', '10.00', 'DBIT'), tx('2', '2026-10-26', '5.00', 'CRDT'), tx('3', '2026-10-27', '3.00', 'DBIT'),
        tx('4', '2026-10-28', '1.00', 'DBIT', { status: 'PDNG' }), tx('5', '2026-10-29', '7.00', 'DBIT')] },
    })
    const p = proveedorOpenBankingIo(c, '2026-10-29')
    expect(await p.cuentas('')).toEqual([{ id: 'a', iban: IBAN_A, titular: 'TABERNA DE PRUEBA SL', divisa: 'EUR' }])
    const pag = await p.movimientos('', 'a', '2026-10-25', '2026-10-28')
    expect(pag.movimientos.map((m) => m.id)).toEqual(['1', '2', '3'])
    // Final del 28: 1000 + 7 (el del 29 aún no estaba). Inicial: final − (−10 + 5 − 3).
    expect(pag.saldoFinalCent).toBe(100_700)
    expect(pag.saldoInicialCent).toBe(101_500)
    expect(c.llamadas.filter((l) => l.startsWith('movimientos')).length).toBe(3)
  })
  it('sin saldo contable, el extracto entra «sin comprobar»', async () => {
    const p = proveedorOpenBankingIo(clienteSimulado({ cuentas: [cuenta('a', IBAN_A, null)], movs: { a: [tx('1', '2026-10-27', '1', 'DBIT')] } }), '2026-10-29')
    expect(await p.movimientos('', 'a', '2026-10-27', '2026-10-28')).toMatchObject({ saldoInicialCent: null, saldoFinalCent: null })
  })
  it('la pieza de la app cumple el contrato de siempre (leerDesdeAgregador)', async () => {
    const p = proveedorDeLaApp(clienteSimulado({ cuentas: [cuenta('a', IBAN_A, '10.00')], movs: { a: [tx('1', '2026-10-27', '1.00', 'DBIT')] } }), '2026-10-29')
    const e = await leerDesdeAgregador(p, '', '2026-10-27', '2026-10-28')
    expect(e.formato).toBe('agregador:open-banking-io')
    expect(e.cuentas[0]).toMatchObject({ iban: IBAN_A, saldoFinalCent: 1000, saldoInicialCent: 1100 })
  })
})

describe('B01c · desde cuándo se lee', () => {
  const hoy = '2026-10-29'
  it('la primera vez, desde el principio del último extracto subido; luego, desde el día siguiente al último que trajo', () => {
    const n43 = [{ fuente: 'fichero', desde: '2026-10-01', hasta: '2026-10-14' }, { fuente: 'fichero', desde: '2026-10-15', hasta: '2026-10-22' }]
    expect(desdeCuando(n43, hoy)).toBe('2026-10-15')
    expect(desdeCuando([...n43, { fuente: 'agregador:open-banking-io', desde: '2026-10-15', hasta: '2026-10-28' }], hoy)).toBe('2026-10-29')
    expect(desdeCuando([], hoy)).toBe('2026-09-29')
  })
  it('nunca más de 89 días atrás', () => {
    expect(desdeCuando([{ fuente: 'fichero', desde: '2026-07-29', hasta: '2026-10-21' }], hoy)).toBe('2026-08-01')
  })
})

describe('B01c · lo de la conexión y lo de Norma 43 tienen la misma huella suave', () => {
  it('el mismo día y los mismos importes (dos iguales en el mismo día incluidos) dan las mismas huellas suaves, aunque las referencias no se parezcan', () => {
    const n43 = leerNorma43(escribirNorma43([{ entidad: '0182', oficina: '0000', cuenta: '0000000001', nombre: 'TABERNA DE PRUEBA', desde: '2026-10-27', hasta: '2026-10-27',
      saldoInicialCent: 100_000, movimientos: [
        { fecha: '2026-10-27', importeCent: -120, comun: '12', concepto: 'COMPRA TARJ CAFE INVENTADO' },
        { fecha: '2026-10-27', importeCent: -120, comun: '12', concepto: 'COMPRA TARJ CAFE INVENTADO' },
        { fecha: '2026-10-27', importeCent: 25_000, comun: '02', ref1: '000123', concepto: 'TRANSFERENCIA INVENTADA' },
      ] }]))
    const suavesN43 = huellasSuaves(n43.cuentas[0].movimientos)
    const porLaConexion = paraImportar([
      movimientoDeOpenBankingIo(tx('x9', '2026-10-27', '250.00', 'CRDT')),
      movimientoDeOpenBankingIo(tx('x7', '2026-10-27', '1.20', 'DBIT')),
      movimientoDeOpenBankingIo(tx('x8', '2026-10-27', '1.20', 'DBIT')),
    ])
    expect(porLaConexion.map((m) => m.huella_suave).sort()).toEqual([...suavesN43].sort())
    // La huella entera lleva la referencia del proveedor: no choca con la del Norma 43.
    expect(porLaConexion.map((m) => m.ref2)).toEqual(['x9', 'x7', 'x8'])
    expect(new Set(porLaConexion.map((m) => m.huella)).size).toBe(3)
  })
  it('nunca una tarjeta entera, tampoco por aquí', () => {
    const [m] = paraImportar([movimientoDeOpenBankingIo(tx('t', '2026-10-27', '1.00', 'DBIT', { remittanceInformation: 'COMPRA 4111111111111111 KIOSCO' }))])
    expect(String(m.concepto_banco)).not.toContain('4111111111111111')
  })
})

describe('B01c · la noche entera', () => {
  function base(o: { extractos?: Record<string, { fuente: string; desde: string; hasta: string }[]>; rompeImportar?: string } = {}) {
    const importados: Record<string, unknown>[] = [], apuntes: Record<string, unknown>[] = []
    const b: BaseAgregador = {
      bancos: async () => [{ id: 'banco-a', nombre: 'BBVA ···0001', iban: IBAN_A }, { id: 'banco-b', nombre: 'BBVA ···0002', iban: 'ES91 0182 0000 0000 0000 0002' }],
      extractos: async (id) => o.extractos?.[id] ?? [],
      importar: async (a) => {
        if (a.p_treasury === o.rompeImportar) throw new Error('No cuadra')
        importados.push(a)
        const movs = a.p_movs as unknown[]
        return { nuevos: movs.length - 1, repetidos: 1, posibles_repetidos: 0, continuidad: 'sigue', hueco: null }
      },
      apuntar: async (a) => { apuntes.push(a) },
    }
    return { b, importados, apuntes }
  }
  const conexiones = [{ sessionId: 's1', validUntil: '2027-01-26T00:00:00Z', accountIds: ['a', 'b', 'z'] }]

  it('empareja por IBAN, lee hasta ayer, mete por bank_importar con la fuente del proveedor y apunta cómo ha ido', async () => {
    const { b, importados, apuntes } = base({ extractos: { 'banco-a': [{ fuente: 'fichero', desde: '2026-10-15', hasta: '2026-10-22' }] } })
    const c = clienteSimulado({
      cuentas: [cuenta('a', IBAN_A, '500.00'), cuenta('b', IBAN_B, '20.00'), cuenta('z', 'ES9101820000000000000099', '1.00')], conexiones,
      movs: { a: [tx('1', '2026-10-20', '10.00', 'DBIT'), tx('2', '2026-10-27', '30.00', 'CRDT'), tx('3', '2026-10-29', '1.00', 'DBIT')], b: [] },
    })
    const parte = await sincronizarEmpresa(b, proveedorOpenBankingIo(c, '2026-10-29'), { accountId: 'cta', companyId: 'emp', banco: 'BBVA', renovar: 'https://open-banking.io/app' }, '2026-10-29', '2026-10-28')
    expect(c.llamadas[0]).toBe('sincronizar')
    expect(importados).toHaveLength(1)
    expect(importados[0]).toMatchObject({ p_treasury: 'banco-a', p_fuente: 'agregador:open-banking-io', p_desde: '2026-10-15', p_hasta: '2026-10-28', p_saldo_final: 501, p_saldo_inicial: 481, p_sha256: null })
    expect((importados[0].p_movs as unknown[]).length).toBe(2)
    expect(parte.map((p) => [p.iban4, p.estado])).toEqual([['0001', 'al_dia'], ['0002', 'sin_movimientos'], ['0099', 'sin_banco_en_folvy']])
    expect(parte[0]).toMatchObject({ nuevos: 1, repetidos: 1, saldoBancoCent: 50_000, caduca: '2027-01-26T00:00:00Z' })
    expect(apuntes.map((a) => [a.p_treasury, a.p_estado, a.p_conexion, a.p_banco])).toEqual([['banco-a', 'al_dia', 's1', 'BBVA'], ['banco-b', 'sin_movimientos', 's1', 'BBVA']])
  })
  it('el permiso caducado no lee y lo dice; un fallo en una cuenta no para a la otra', async () => {
    const { b, importados, apuntes } = base({ rompeImportar: 'banco-b' })
    const c = clienteSimulado({
      cuentas: [cuenta('a', IBAN_A, '5.00'), cuenta('b', IBAN_B, '5.00')], conexiones, fallos: [{ accountId: 'a', reason: 'reconnect_needed' }],
      movs: { a: [tx('1', '2026-10-27', '1.00', 'DBIT')], b: [tx('2', '2026-10-27', '1.00', 'DBIT')] },
    })
    const parte = await sincronizarEmpresa(b, proveedorOpenBankingIo(c, '2026-10-29'), { accountId: 'cta', companyId: 'emp', banco: 'BBVA', renovar: null }, '2026-10-29', '2026-10-28')
    expect(parte.map((p) => p.estado)).toEqual(['permiso_caducado', 'fallo'])
    expect(parte[1].mensaje).toContain('No cuadra')
    expect(importados).toHaveLength(0)
    expect(apuntes.map((a) => a.p_estado)).toEqual(['permiso_caducado', 'fallo'])
    expect(apuntes.every((a) => String(a.p_mensaje).length > 0)).toBe(true)
  })
})

describe('B01c · lo que dice Bancos de una cuenta conectada', () => {
  const ahora = new Date('2026-10-29T08:00:00Z')
  const base: ConexionCuenta = { banco: 'BBVA', estado: 'al_dia', mensaje: null, leida: '2026-10-29T02:00:00Z', intentada: '2026-10-29T02:00:00Z', caduca: '2027-01-26T00:00:00Z', renovar: 'https://open-banking.io/app' }
  it('al día: «Conectada con BBVA · actualizada hoy a las 03:00» (hora de Madrid)', () => {
    expect(lineaConexion(base, ahora)).toEqual({ nivel: 'ok', renovar: null, texto: 'Conectada con BBVA · actualizada hoy a las 03:00' })
    expect(lineaConexion({ ...base, leida: '2026-10-28T02:00:00Z' }, ahora)?.texto).toBe('Conectada con BBVA · actualizada ayer a las 03:00')
    expect(lineaConexion(null, ahora)).toBeNull()
  })
  it('a 7 días de caducar, el aviso con su botón «Renovar»', () => {
    expect(lineaConexion({ ...base, caduca: '2026-11-05T10:00:00Z' }, ahora)).toEqual({ nivel: 'aviso', renovar: 'https://open-banking.io/app', texto: 'Caduca el permiso en 7 días · actualizada hoy a las 03:00' })
    expect(lineaConexion({ ...base, caduca: '2026-11-06T10:00:00Z' }, ahora)?.nivel).toBe('ok')
    expect(lineaConexion({ ...base, caduca: '2026-10-30T10:00:00Z' }, ahora)?.texto).toBe('Caduca el permiso mañana · actualizada hoy a las 03:00')
  })
  it('caducado o fallado: qué pasa y desde cuándo, nunca un «al día» callado', () => {
    const cad = lineaConexion({ ...base, estado: 'permiso_caducado', leida: '2026-10-20T02:00:00Z' }, ahora)
    expect(cad).toMatchObject({ nivel: 'error', renovar: 'https://open-banking.io/app' })
    expect(cad?.texto).toBe('El permiso para leer BBVA ha caducado: no llegan sus movimientos (actualizada el 20/10 a las 04:00). Renuévalo y confirma en tu banco.')
    const mal = lineaConexion({ ...base, estado: 'fallo', mensaje: 'el banco no contesta', leida: '2026-10-28T02:00:00Z' }, ahora)
    expect(mal?.texto).toBe('Conectada con BBVA · la última vez (hoy a las 03:00) no se pudo leer: el banco no contesta. Sigue actualizada ayer a las 03:00.')
  })
})
