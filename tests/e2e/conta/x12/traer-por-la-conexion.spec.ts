/// <reference lib="dom" />
// tests/e2e/conta/x12/traer-por-la-conexion.spec.ts
//
// X12 · «Traer de ERP10» POR LA CONEXIÓN, en el ordenador a 1456 × 816 y a 1366 × 768, CONTRA STAGING con un
// ERP10 SIMULADO: nunca el de verdad. La función (conta-erp10-leer, accion traer) se sustituye en el
// navegador por el mismo código del servidor (_shared/erp10Traer.ts con el cliente de ERP10: lista
// cerrada y NIF) hablando con el ERP10 simulado de las unitarias, con los Excel de ejemplo del N07 puestos
// como los daría la API (tests/conta/x12/deFicheros.ts; datos inventados, T11).
//
// Como el N07, cada prueba crea su empresa (pymes, 8 dígitos, 2026) en el carril de la cuenta A, con la
// sesión del administrador, y al acabar deshace lo traído y la borra. La conexión: las claves de la
// cuenta (la función que las guarda, simulada) y el código 101 de la empresa, probado.
//   1. «Traerlo de ERP10», al lado de «Elegir ficheros», en «Empresa nueva».
//   2. Mientras lee, cada fila dice por dónde va («Leyendo asientos: febrero, 2 de 11» (o de 12, en diciembre)).
//   3. A mitad de febrero se recarga la página (como cerrar la pestaña): al volver, la fila dice «Se ha
//      cortado en febrero: sigue donde se quedó», y «Seguir trayendo de ERP10» sigue en febrero, sin
//      volver a pedir las cuentas ni enero.
//   4. Lleno: las filas como con los ficheros, el sumas y saldos calculado, cómo han venido las facturas
//      y «Lo traído da lo mismo que ERP10, mes a mes».
//   5. Los pasos 2 y 3, los de siempre: 10 asientos y 5 facturas, en prueba.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { ClienteErp10, type AlmacenToken } from '../../../../supabase/functions/_shared/erp10Cliente'
import { traerUnaPagina, type PedirPagina } from '../../../../supabase/functions/_shared/erp10Traer'
import { erp10Simulado } from '../../../conta/erp10/simulado'
import { readFileSync } from 'node:fs'
import type { EmpresaSimulada } from '../../../conta/erp10/simulado'

test.skip(CARRIL === null, 'Traer de ERP10 escribe en una empresa de la cuenta A (trae en prueba): necesita su carril.')

const DIR = 'docs/conta/capturas/x12'
const RUTA = '/conta/libros/diario/traer-erp10'
const QUIEN = 'Prueba e2e X12'
const TAMANOS = [{ width: 1456, height: 816 }, { width: 1366, height: 768 }] as const
const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Una empresa nueva de la cuenta A, solo para esta prueba (como el N07): pymes, 8 dígitos y el ejercicio 2026. */
async function crearEmpresa(s: Sesion, nif: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `Traer por la conexión e2e ${Date.now()}`, tax_id: nif, tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa de la prueba: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `y su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: CUENTA_A.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `y el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  return id
}

/** La conexión: las claves de la cuenta (con su base) y el código 101 de la empresa, probado. */
async function conectar(s: Sesion, empresa: string) {
  const c = await rest<{ id: string }[]>(s, 'GET', 'connector?select=id&code=eq.erp10')
  const con = c.datos?.[0]
  if (!con) throw new Error('Staging no tiene el conector erp10.')
  const ya = await rest<{ id: string }[]>(s, 'GET', `account_connector?select=id&account_id=eq.${CUENTA_A.id}&connector_id=eq.${con.id}&scope=eq.account`)
  if (!ya.datos?.length) {
    const a = await rest(s, 'POST', 'account_connector', { account_id: CUENTA_A.id, connector_id: con.id, scope: 'account', status: 'connected', config: { nombre_bd: 'DESPACHO_INVENTADO' }, created_by_name: QUIEN })
    expect(a.status, `las claves de la cuenta: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  }
  const b = await rest(s, 'POST', 'account_connector', { account_id: CUENTA_A.id, connector_id: con.id, scope: 'company', company_id: empresa, external_account_id: '101', status: 'connected', config: {}, created_by_name: QUIEN })
  expect(b.status, `el código de la empresa: ${JSON.stringify(b.datos).slice(0, 200)}`).toBeLessThan(300)
}

async function limpiar(s: Sesion, id: string) {
  const enPrueba = await rest<{ id: string }[]>(s, 'GET', `import_run?select=id&company_id=eq.${id}&kind=eq.carga&status=eq.en_prueba`)
  for (const c of enPrueba.datos ?? []) await rest(s, 'POST', 'rpc/conta_traer_deshacer', { p_carga: c.id, p_quien_nombre: QUIEN })
  await rest(s, 'DELETE', `account_connector?company_id=eq.${id}&account_id=eq.${CUENTA_A.id}`, undefined, 'return=minimal')
  const b = await rest<unknown>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (b.status >= 300) console.log(`[X12] la empresa ${id} se queda en el carril (${b.status}): ${JSON.stringify(b.datos).slice(0, 200)}`)
}

/**
 * conta-erp10-leer, sustituida: cada «traer» es una página leída por el cliente de verdad del ERP10 simulado.
 * `lentas` hace esperar las de ese mes (para ver el progreso y cortar a mitad). Apunta lo que se pide.
 */
async function erp10DeMentira(page: Page, nif: string, pedidas: PedirPagina[], lentas: { mes: string; ms: number } | null) {
  // Los Excel del N07 ya puestos como los daría la API (tests/conta/x12/erp10DeLosFicheros.json: lo vigila
  // tests/conta/x12/traer.test.ts). No se abren aquí: en el proceso de Playwright, xlsx llega sin SSF (e2e 44704885134).
  const empresa: EmpresaSimulada = { ...JSON.parse(readFileSync('tests/conta/x12/erp10DeLosFicheros.json', 'utf8')), cif: nif }
  await page.route('**/functions/v1/conta-erp10-leer', async (route: Route) => {
    const b = route.request().postDataJSON() as { accion: string } & PedirPagina
    const responder = (status: number, cuerpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) }).catch(() => undefined)
    if (b.accion !== 'traer') return responder(400, { error: 'en esta prueba solo se trae' })
    const p: PedirPagina = { que: b.que, ejercicio: b.ejercicio, mes: b.mes ?? null, pagina: b.pagina ?? 0 }
    pedidas.push(p)
    if (lentas && p.mes === lentas.mes) await new Promise((r) => setTimeout(r, lentas.ms))
    try {
      const sim = erp10Simulado({ empresas: { 101: structuredClone(empresa) } })
      const c = new ClienteErp10({
        base: 'https://erp10.invalid', nombreBd: 'DESPACHO_INVENTADO', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
        lista: [{ companyId: 'la-de-la-prueba', codEmpresa: '101', nif }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch,
      })
      return responder(200, { ok: true, pagina: await traerUnaPagina((r) => c.get(r), p) })
    } catch (e) {
      return responder(502, { error: e instanceof Error ? e.message : String(e) })
    }
  })
  await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))
}

for (const tam of TAMANOS) {
  test(`X12 · ${tam.width} × ${tam.height}: traer una empresa nueva de ERP10 por la conexión, con su progreso; cortada a mitad, sigue donde se quedó`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X12).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const nif = cifInventado()
    const empresa = await crearEmpresa(s, nif)
    try {
      await conectar(s, empresa)
      await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
      const pedidas: PedirPagina[] = []
      await erp10DeMentira(page, nif, pedidas, { mes: '2026-02', ms: 12_000 })

      // 1 · «Traerlo de ERP10», al lado de «Elegir ficheros», con el mismo peso, en «Empresa nueva».
      await page.goto(RUTA, { waitUntil: 'load' })
      await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
      const traerlo = page.getByRole('button', { name: 'Traerlo de ERP10' })
      await expect(traerlo).toBeVisible({ timeout: 30_000 })
      const elegir = page.getByRole('button', { name: 'Elegir ficheros' })
      expect((await traerlo.getAttribute('class')), 'el mismo peso que «Elegir ficheros»').toBe(await elegir.getAttribute('class'))
      // El de la pantalla de Traer: la cabecera de Sumied lleva otro «Ejercicio» (e2e 44706072179).
      await expect(page.getByRole('region', { name: 'Traer de ERP10' }).getByRole('combobox', { name: 'Ejercicio' })).toHaveValue('2026')
      await traerlo.click()

      // 2 · Mientras lee, cada fila dice por dónde va.
      const tabla = page.getByRole('table', { name: 'Los ficheros' })
      const diario = tabla.getByRole('row', { name: /^Diario/ })
      await expect(diario).toContainText(/Leyendo asientos: febrero, 2 de 1[12]/, { timeout: 30_000 })
      await expect(diario).toContainText('Traído de ERP10')
      await expect(tabla.getByRole('row', { name: /^Plan de cuentas/ })).toContainText('Leído; esperando a lo demás')
      await expect(tabla.getByRole('row', { name: /^Proveedores/ })).toContainText('4 fichas')
      await expect(tabla.getByRole('row', { name: /^Sumas y saldos/ })).toContainText('Se calcula al acabar los asientos')
      await expect(page.getByRole('button', { name: 'Ver lo que entra' })).toBeDisabled()
      await expect(page.locator('.cxe')).not.toContainText(/\bAPI\b|página/)
      await page.screenshot({ path: `${DIR}/leyendo-${tam.width}.png` })

      // 3 · A mitad de febrero, la página se recarga (como cerrar la pestaña).
      const antes = pedidas.length
      await page.reload({ waitUntil: 'load' })
      await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
      await expect(tabla.getByRole('row', { name: /^Diario/ })).toContainText('Se ha cortado en febrero: sigue donde se quedó', { timeout: 30_000 })
      // En ámbar solo lo cortado: lo ya leído entero espera en gris; y el panel lo dice.
      await expect(tabla.getByRole('row', { name: /^Plan de cuentas/ })).toContainText('Leyendo')
      await expect(page.getByRole('alert').filter({ hasText: 'Se ha cortado al traer de ERP10.' })).toContainText('«Seguir trayendo de ERP10» sigue donde se quedó')
      await page.screenshot({ path: `${DIR}/cortado-${tam.width}.png` })
      await page.getByRole('button', { name: 'Seguir trayendo de ERP10' }).click()
      await expect(tabla.getByRole('row', { name: /^Diario/ })).toContainText('Todos cuadran · igual que ERP10', { timeout: 90_000 })
      const despues = pedidas.slice(antes)
      expect(despues.filter((p) => p.que === 'subcuentas' || p.que === 'resumen' || (p.mes ?? '9999') < '2026-02'), 'al seguir, no vuelve a pedir lo leído').toEqual([])

      // 4 · Lleno: como con los ficheros.
      await expect(tabla.getByRole('row', { name: /^Plan de cuentas/ })).toContainText('16 cuentas')
      await expect(tabla.getByRole('row', { name: /^Proveedores/ })).toContainText('4 fichas')
      await expect(tabla.getByRole('row', { name: /^Clientes/ })).toContainText('1 ficha')
      await expect(diario).toContainText('10 asientos · 26 apuntes')
      await expect(tabla.getByRole('row', { name: /^Facturas emitidas/ })).toContainText('2 facturas')
      await expect(tabla.getByRole('row', { name: /^Facturas recibidas/ })).toContainText('3 facturas')
      await expect(tabla.getByRole('row', { name: /^Sumas y saldos/ })).toContainText('Calculado de los asientos')
      await expect(page.getByRole('list', { name: 'Comprobaciones' })).toContainText('Lo traído da lo mismo que ERP10, mes a mes')
      await expect(page.locator('.cxe-der')).toContainText('Las facturas de ERP10: 2 emitidas, 3 recibidas y 0 sin saber.')
      await expect(page.locator('.cxe')).not.toContainText(/\bAPI\b|página/)
      await page.screenshot({ path: `${DIR}/traido-${tam.width}.png` })

      // 5 · Los pasos 2 y 3 de siempre.
      await page.getByRole('button', { name: 'Ver lo que entra' }).click()
      const entra = page.getByRole('table', { name: 'Qué entra' })
      await expect(entra.getByRole('row', { name: /^Asientos/ })).toContainText('11.499,00', { timeout: 30_000 })
      await page.screenshot({ path: `${DIR}/paso2-${tam.width}.png` })
      await page.getByRole('button', { name: 'Traerlo', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: /^Traído en prueba el .*: 10 asientos y 5 facturas\. Lo traído no se puede pagar ni cobrar hasta darlo por bueno\.$/ })).toBeVisible({ timeout: 60_000 })
      await page.screenshot({ path: `${DIR}/paso3-${tam.width}.png` })
      expect(errores).toEqual([])
    } finally {
      await limpiar(s, empresa)
    }
  })
}
