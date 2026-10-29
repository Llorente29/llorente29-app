/// <reference lib="dom" />
// tests/e2e/conta/b01/agregador.spec.ts
//
// B01c · Los movimientos del banco entran solos. En staging-conta, cuenta A,
// banco «B01 · Mercado», en ordenador (1440) y móvil (390), con un PROVEEDOR
// SIMULADO: el núcleo de la noche de verdad (sincronizarEmpresa, el mismo que
// corre conta-banco-agregador) con un cliente de open-banking.io inventado que
// devuelve lo que daría la librería ya descifrada.
//   1. Un Norma 43 INVENTADO del 10/01/2030 (dos movimientos), subido por la
//      persona como siempre.
//   2. La noche: la conexión trae esos dos (con otras referencias) y uno más del
//      11/01. La base reconoce los dos por la huella suave: 1 nuevo y 2 que ya
//      estaban, ninguno duplicado.
//   3. Bancos › Cuentas y extractos dice, en la tarjeta de Mercado, «Conectada
//      con BBVA · actualizada hoy a las HH:MM».
//   4. Con el permiso a 5 días de caducar: «Caduca el permiso en 5 días», con
//      su botón «Renovar» que lleva a donde se renueva.
// Las capturas van a docs/conta/capturas/b01c/ (el artefacto del run). Al
// acabar DESHACE todo: los dos extractos y la conexión.

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import { proveedorOpenBankingIo, sincronizarEmpresa } from '@/modules/conta/lib/agregadorBanco'
import type { BaseAgregador, ClienteOpenBankingIo, TransaccionObi } from '../../../../supabase/functions/_shared/bancoAgregador.ts'
import { BANCOS_B01, EMPRESA_A, baseDeA, conLimpieza } from './datos'

const DIR = 'docs/conta/capturas/b01c'
const MERCADO = BANCOS_B01[2]
const IBAN_MERCADO = 'ES6401829103210000000013'
const FICHERO_2030 = 'b01c-mercado-2030.n43'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

const N43 = escribirNorma43([
  { entidad: '0182', oficina: '9103', cuenta: '0000000013', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2030-01-10', hasta: '2030-01-10', saldoInicialCent: 100_000, movimientos: [
    { fecha: '2030-01-10', importeCent: -3_000, comun: '03', concepto: 'RECIBO INVENTADO B01C' },
    { fecha: '2030-01-10', importeCent: -2_000, comun: '12', concepto: 'COMPRA TARJ. CAFE INVENTADO B01C' },
  ] },
])

const tx = (id: string, fecha: string, amount: string, concepto: string): TransaccionObi => ({
  id, currency: 'EUR', creditDebitIndicator: 'DBIT', status: 'BOOK', bookingDate: fecha, valueDate: fecha, transactionDate: null, bankTransactionCode: null,
  amount, creditorName: 'COMERCIO INVENTADO B01C', debtorName: null, remittanceInformation: concepto, note: null,
})

/** open-banking.io, simulado: la cuenta de Mercado, su saldo de ahora y tres movimientos. */
function clienteSimulado(caduca: string): ClienteOpenBankingIo {
  const movs = [tx('obi-1', '2030-01-10', '30.00', 'Recibo inventado'), tx('obi-2', '2030-01-10', '20.00', 'Cafe inventado'), tx('obi-3', '2030-01-11', '15.00', 'Nuevo inventado')]
  return {
    getAccounts: async () => [{ id: 'obi-mercado', aspspName: 'BBVA', currency: 'EUR', needsReconnect: false, iban: IBAN_MERCADO, ownerName: 'TABERNA DE PRUEBA', displayName: null,
      balances: [{ type: 'ITBD', amount: '935.00', currency: 'EUR', referenceDate: '2030-01-13' }] }],
    getTransactions: async (_id, q = {}) => {
      const items = movs.filter((t) => (!q.from || t.bookingDate! >= q.from) && (!q.to || t.bookingDate! <= q.to))
      return { items: items.slice(q.offset ?? 0), total: items.length }
    },
    getConnections: async () => [{ sessionId: 'sesion-b01c', aspspName: 'BBVA', validUntil: caduca, status: 'Active', isLive: true, accountIds: ['obi-mercado'] }],
    syncAll: async () => ({ accounts: 1, newTransactions: 1, failures: [] }),
  }
}

async function baseDeLaNoche() {
  const base = await baseDeA()
  const b: BaseAgregador = {
    bancos: async (accountId, companyId) => {
      const { data, error } = await base.cliente.from('treasury_account').select('id, name, iban').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true)
      if (error) throw new Error(error.message)
      return (data ?? []).map((t) => ({ id: String(t.id), nombre: String(t.name), iban: t.iban ? String(t.iban) : null }))
    },
    extractos: async (id) => {
      const { data, error } = await base.cliente.from('bank_statement').select('source, period_from, period_to').eq('treasury_account_id', id)
      if (error) throw new Error(error.message)
      return (data ?? []).map((e) => ({ fuente: String(e.source), desde: String(e.period_from), hasta: String(e.period_to) }))
    },
    importar: (a) => base.bd.rpc<Record<string, unknown>>('bank_importar', a),
    apuntar: async (a) => { await base.bd.rpc('bank_agregador_apuntar', a) },
  }
  return { ...base, noche: b }
}

/** Los dos extractos de la prueba y la conexión, fuera. */
async function quitarLoMio(base: Awaited<ReturnType<typeof baseDeA>>) {
  await base.deshacerTodo('Limpieza de la prueba B01c')
  const { data: ext } = await base.cliente.from('bank_statement').select('id, file_name, source').eq('treasury_account_id', MERCADO).gte('period_from', '2030-01-01')
  for (const e of ext ?? []) await base.bd.rpc('bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de la prueba B01c' })
  await base.bd.rpc('bank_agregador_quitar', { p_treasury: MERCADO })
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

test.describe('B01c · los movimientos del banco entran solos (proveedor simulado)', () => {
  test.describe.configure({ timeout: 180_000 })

  test('la noche reconoce lo subido por Norma 43, y Bancos dice cómo está la conexión', async ({ page }) => {
    // Una sola vez (los datos son de la cuenta A): en el ordenador. El móvil pinta la misma línea.
    test.skip(lado(page) !== 'ordenador', 'Una vez basta: la misma base para los dos tamaños.')
    const base = await baseDeLaNoche()
    await quitarLoMio(base)
    await conLimpieza(page, async () => {
      // 1 · El Norma 43 de la persona.
      const bancos = crearBancos(base.bd)
      const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
      const a = { nombre: FICHERO_2030, sha256: createHash('sha256').update(N43).digest('hex'), contenido: { texto: N43 } }
      const { extracto, cuadre } = leerYCuadrar(a)
      const [subido] = await bancos.importar(a, extracto, cuadre, emparejar(extracto, mios))
      expect(subido.nuevos).toBe(2)

      // 2 · La noche, con el proveedor simulado (id «simulado»: la fuente es agregador:simulado).
      const p = { ...proveedorOpenBankingIo(clienteSimulado('2030-04-10T00:00:00Z'), '2030-01-13'), id: 'simulado', nombre: 'Simulado' }
      const parte = await sincronizarEmpresa(base.noche, p, { accountId: CUENTA_A.id, companyId: EMPRESA_A, banco: 'BBVA', renovar: 'https://open-banking.io/app' }, '2030-01-13', '2030-01-12')
      const mercado = parte.find((x) => x.iban4 === '0013')
      expect(mercado, JSON.stringify(parte)).toMatchObject({ estado: 'al_dia', leidos: 3, nuevos: 1, repetidos: 2, desde: '2030-01-10', hasta: '2030-01-12', saldoBancoCent: 93_500 })
      const { count } = await base.cliente.from('bank_movement').select('id', { count: 'exact', head: true }).eq('treasury_account_id', MERCADO).gte('op_date', '2030-01-10').lte('op_date', '2030-01-11')
      expect(count).toBe(3)

      // 3 · Lo que dice Bancos.
      await entrarComo(page, CUENTA_A.email)
      await page.goto(`/conta/bancos/cuentas?banco=${MERCADO}&mes=2030-01`)
      const linea = page.locator(`article[aria-label] [data-prueba="conexion-banco"]`)
      await expect(linea).toHaveCount(1)
      await expect(linea).toHaveText(/^Conectada con BBVA · actualizada hoy a las \d\d:\d\d$/)
      await linea.scrollIntoViewIfNeeded()
      await capturar(page, 'conectada')

      // 4 · A 5 días de caducar: el aviso y «Renovar».
      const caduca = new Date(Date.now() + 5 * 86_400_000).toISOString()
      await base.bd.rpc('bank_agregador_apuntar', { p_treasury: MERCADO, p_proveedor: 'simulado', p_cuenta_proveedor: 'obi-mercado', p_conexion: 'sesion-b01c', p_banco: 'BBVA',
        p_caduca: caduca, p_renovar: 'https://open-banking.io/app', p_estado: 'sin_movimientos', p_mensaje: 'Ya estaba al día.', p_saldo_banco: null, p_saldo_fecha: null,
        p_nuevos: 0, p_repetidos: 0, p_desde: null, p_hasta: null })
      await page.reload()
      await expect(linea).toContainText('Caduca el permiso en 5 días · actualizada hoy a las')
      await expect(linea.getByRole('link', { name: 'Renovar' })).toHaveAttribute('href', 'https://open-banking.io/app')
      await linea.scrollIntoViewIfNeeded()
      await capturar(page, 'caduca-en-5-dias')
    }, () => quitarLoMio(base))
  })
})
