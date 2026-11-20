/// <reference lib="dom" />
// tests/e2e/conta/x13/traer-un-boton.spec.ts
//
// X13 · «Traer de ERP10» EN UN BOTÓN (la maqueta nucleo_11 del 20/11), a 1456 × 816 y a 1366 × 768, CONTRA STAGING
// con el ERP10 SIMULADO del X12 (los Excel de ejemplo del N07 como los daría la API, tests/conta/x12/
// erp10DeLosFicheros.json; datos inventados, T11). La función conta-erp10-leer se sustituye en el navegador por el
// mismo código del servidor (_shared/erp10Traer.ts con el cliente de ERP10). Lo de la base es de verdad: lo traído
// entra en prueba (conta_traer_cargar), se da por bueno o se descarta (conta_traer_deshacer).
//
// Cada prueba crea su empresa (pymes, 8 dígitos, 2026) en el carril de la cuenta A, conectada con el código 101, y
// al acabar deshace lo que quede en prueba y la borra (si lo dado por bueno no deja, se queda en el carril).
//   1. Llegar: Inicio dice «Esta empresa está en ERP10» y lleva a la pantalla. Antes: siete filas, nada en ámbar.
//   2. «Traerlo todo de ERP10»: el progreso («Leyendo febrero · 2 de 11 meses»); «Pararlo»; «Seguir trayendo».
//   3. Al acabar: «✓ Leído y cuadra con ERP10», cada fila con su cifra; «Verlos» abre la lista en el panel.
//   4. «Darlo por bueno», con su confirmación: «Dado por bueno el …».
//   5. Otra empresa: traerla y «Descartar lo traído», con la frase de lo que quita: «Deshecho el …».

import { test, expect, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CARRIL, CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { ClienteErp10, type AlmacenToken } from '../../../../supabase/functions/_shared/erp10Cliente'
import { traerUnaPagina, type PedirPagina } from '../../../../supabase/functions/_shared/erp10Traer'
import { erp10Simulado, type EmpresaSimulada } from '../../../conta/erp10/simulado'

test.skip(CARRIL === null, 'Traer de ERP10 escribe en una empresa de la cuenta A (trae en prueba): necesita su carril.')

const DIR = 'docs/conta/capturas/x13'
const RUTA = '/conta/libros/diario/traer-erp10'
const QUIEN = 'Prueba e2e X13'
const TAMANOS = [{ width: 1456, height: 816 }, { width: 1366, height: 768 }] as const
const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function crearEmpresa(s: Sesion, nif: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `Traer un botón e2e ${Date.now()}`, tax_id: nif, tax_id_type: 'nif_es', entity_kind: 'company',
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
  if (b.status >= 300) console.log(`[X13] la empresa ${id} se queda en el carril (${b.status}): ${JSON.stringify(b.datos).slice(0, 200)}`)
}

/** conta-erp10-leer, sustituida: cada «traer» es una página leída por el cliente de verdad del ERP10 simulado. */
async function erp10DeMentira(page: Page, nif: string, lentas: { que: string; mes: string; ms: number } | null) {
  const empresa: EmpresaSimulada = { ...JSON.parse(readFileSync('tests/conta/x12/erp10DeLosFicheros.json', 'utf8')), cif: nif }
  await page.route('**/functions/v1/conta-erp10-leer', async (route: Route) => {
    const b = route.request().postDataJSON() as { accion: string } & PedirPagina
    const responder = (status: number, cuerpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) }).catch(() => undefined)
    if (b.accion !== 'traer') return responder(400, { error: 'en esta prueba solo se trae' })
    const p: PedirPagina = { que: b.que, ejercicio: b.ejercicio, mes: b.mes ?? null, pagina: b.pagina ?? 0 }
    if (lentas && p.que === lentas.que && p.mes === lentas.mes) await new Promise((r) => setTimeout(r, lentas.ms))
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

/** La empresa de la prueba, abierta en Sumied (como el N07: se guarda por cuenta en el navegador). */
async function abrirEmpresa(page: Page, empresa: string) {
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
}

const pantalla = (page: Page) => page.getByRole('region', { name: 'Traer de ERP10' })
const fila = (page: Page, que: string) => pantalla(page).getByRole('list', { name: 'Lo que se trae' }).getByRole('listitem').filter({ hasText: que })

for (const tam of TAMANOS) {
  test(`X13 · ${tam.width} × ${tam.height}: llegar desde Inicio, traerlo todo, pararlo y seguir, «Verlos» y darlo por bueno`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X13).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const nif = cifInventado()
    const empresa = await crearEmpresa(s, nif)
    try {
      await conectar(s, empresa)
      await abrirEmpresa(page, empresa)
      await erp10DeMentira(page, nif, { que: 'apuntes', mes: '2026-02', ms: 8000 })

      // 1 · Llegar fácil: Inicio, con la empresa conectada y nada contabilizado del año.
      await page.goto('/conta/inicio', { waitUntil: 'load' })
      const linea = page.getByRole('status', { name: 'Traer de ERP10' })
      await expect(linea).toContainText('Esta empresa está en ERP10.', { timeout: 40_000 })
      await linea.getByRole('link', { name: 'Traer de ERP10' }).click()
      await expect(page.locator('h1#cxu-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
      const p = pantalla(page)
      await expect(p).toContainText('Conectada con ERP10 · empresa 101')
      await expect(fila(page, 'Diario')).toContainText('todos los asientos del ejercicio')
      await expect(p.getByRole('list', { name: 'Lo que se trae' }).getByRole('listitem')).toHaveCount(7)
      await expect(p).not.toContainText(/Falta|Mira esto|\bAPI\b|página/)
      await expect(p.locator('.cxe-botones button')).toHaveText(['Traerlo todo de ERP10'])
      await expect(p).toContainText('Entra en prueba: hasta que lo des por bueno, se deshace entero.')
      await page.screenshot({ path: `${DIR}/antes-${tam.width}.png` })

      // 2 · Traerlo todo: el progreso, y «Pararlo», el único botón, secundario.
      await p.getByRole('button', { name: 'Traerlo todo de ERP10' }).click()
      await expect(fila(page, 'Diario')).toContainText(/Leyendo febrero · 2 de 1[12] meses/, { timeout: 30_000 })
      await expect(fila(page, 'Plan de cuentas')).toContainText('16 cuentas')
      await expect(fila(page, 'Facturas emitidas')).toContainText('Después del diario')
      await expect(p.getByRole('status').filter({ hasText: /^Trayendo/ })).toBeVisible()
      await expect(p.locator('.cxe-botones button')).toHaveText(['Pararlo'])
      await page.screenshot({ path: `${DIR}/trayendo-${tam.width}.png` })
      await p.getByRole('button', { name: 'Pararlo' }).click()
      await expect(p.getByRole('status').filter({ hasText: 'Parado · sigue donde se quedó' })).toBeVisible({ timeout: 30_000 })
      await expect(fila(page, 'Diario')).toContainText(/Parado en marzo · 3 de 1[12] meses/)
      await expect(p.locator('.cxe-botones button')).toHaveText(['Descartar lo leído', 'Seguir trayendo de ERP10'])
      await page.screenshot({ path: `${DIR}/parado-${tam.width}.png` })
      await p.getByRole('button', { name: 'Seguir trayendo de ERP10' }).click()

      // 3 · Al acabar: entra en prueba solo, y cuadra.
      await expect(p.getByRole('status').filter({ hasText: '✓ Leído y cuadra con ERP10' })).toBeVisible({ timeout: 90_000 })
      await expect(fila(page, 'Diario')).toContainText('10 asientos')
      await expect(fila(page, 'Diario')).toContainText('igual que en ERP10, mes a mes')
      await expect(fila(page, 'Facturas emitidas')).toContainText('2 facturas')
      await expect(fila(page, 'Facturas recibidas')).toContainText('3 facturas')
      await expect(fila(page, 'Sumas y saldos')).toContainText('Cuadra', { timeout: 30_000 })
      await expect(fila(page, 'Proveedores y acreedores')).toContainText('1 sin NIF')
      await expect(p.locator('.cxe-botones button')).toHaveText(['Descartar lo traído', 'Darlo por bueno'])
      await fila(page, 'Proveedores y acreedores').getByRole('button', { name: 'Verlos' }).click()
      const verlos = p.getByRole('region', { name: 'Lo que hay que mirar' })
      await expect(verlos).toContainText('40000000 · Proveedores varios')
      await expect(p).not.toContainText(/\bAPI\b|página/)
      await page.screenshot({ path: `${DIR}/acabado-${tam.width}.png` })
      await verlos.getByRole('button', { name: 'Cerrar' }).click()

      // 4 · Darlo por bueno, con su confirmación.
      await p.getByRole('button', { name: 'Darlo por bueno' }).click()
      const dialogo = page.getByRole('dialog', { name: 'Darlo por bueno' })
      await expect(dialogo).toContainText('Vas a dar por bueno lo traído de ERP10: 10 asientos y 5 facturas')
      await dialogo.getByRole('button', { name: 'Darlo por bueno' }).click()
      await expect(page.getByRole('status').filter({ hasText: /^Dado por bueno el \d\d\/\d\d a las \d\d:\d\d por / })).toContainText('10 asientos de antes del', { timeout: 60_000 })
      await expect(p.locator('.cxe-botones button')).toHaveText(['Traerlo todo de ERP10'])
      expect(errores).toEqual([])
    } finally {
      await limpiar(s, empresa)
    }
  })

  test(`X13 · ${tam.width} × ${tam.height}: otra empresa, traerla y descartar lo traído`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X13).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const nif = cifInventado()
    const empresa = await crearEmpresa(s, nif)
    try {
      await conectar(s, empresa)
      await abrirEmpresa(page, empresa)
      await erp10DeMentira(page, nif, null)
      await page.goto(RUTA, { waitUntil: 'load' })
      const p = pantalla(page)
      await p.getByRole('button', { name: 'Traerlo todo de ERP10' }).click({ timeout: 40_000 })
      await expect(p.getByRole('status').filter({ hasText: '✓ Leído y cuadra con ERP10' })).toBeVisible({ timeout: 90_000 })
      await p.getByRole('button', { name: 'Descartar lo traído' }).click()
      const dialogo = page.getByRole('dialog', { name: 'Descartar lo traído' })
      await expect(dialogo).toContainText('Vas a descartar lo traído: se quita todo lo que entró en prueba (10 asientos, 5 facturas')
      await expect(dialogo).toContainText('En ERP10 no cambia nada.')
      await page.screenshot({ path: `${DIR}/descartar-${tam.width}.png` })
      await dialogo.getByRole('button', { name: 'Descartar lo traído' }).click()
      await expect(page.getByRole('status').filter({ hasText: /^Deshecho el .*: se ha quitado todo lo traído \(10 asientos, 5 facturas, .*\)\. La empresa queda como estaba antes de traerlo\.$/ })).toBeVisible({ timeout: 60_000 })
      await expect(fila(page, 'Diario')).toContainText('todos los asientos del ejercicio')
      // Y la de los ficheros sigue ahí, igual.
      await p.getByRole('button', { name: 'Súbelo en ficheros' }).click()
      await expect(page.getByRole('button', { name: 'Elegir ficheros' })).toBeVisible()
      expect(errores).toEqual([])
    } finally {
      await limpiar(s, empresa)
    }
  })
}
