// tests/e2e/conta/x14/dia-de-inicio.spec.ts
//
// X14 · 2 (Julio, 25/11): el día de inicio se fija dentro de «Traer de ERP10», antes de traer el año en curso, que es donde
// se espera (lo mismo que Ajustes › Ejercicio › «Cambiar»). Sin fijar, lo dice; al fijarlo, dice el día y hasta cuándo se
// trae de ERP10 (regla 8), y la caja pasa a decirlo. Una empresa nueva de la cuenta A, conectada con ERP10 (código 101). Lo
// de ERP10 no se lee: la prueba no pulsa «Traerlo todo». Datos inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'

test.skip(CARRIL === null, 'Fija el día de inicio de una empresa de la cuenta A: necesita su carril.')
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x14'
const RUTA = '/conta/libros/diario/traer-erp10'
const QUIEN = 'Prueba e2e X14 día de inicio'
const ANIO = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(new Date()))

async function crearEmpresa(s: Sesion): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `Día de inicio e2e ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: CUENTA_A.id, company_id: id, code: String(ANIO), starts_on: `${ANIO}-01-01`, ends_on: `${ANIO}-12-31`, created_by: s.user.id })
  expect(y.status, `el ejercicio ${ANIO}: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
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
  await rest(s, 'DELETE', `account_connector?company_id=eq.${id}&account_id=eq.${CUENTA_A.id}`, undefined, 'return=minimal')
  const b = await rest<unknown>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (b.status >= 300) console.log(`[X14] la empresa ${id} se queda en el carril (${b.status}): ${JSON.stringify(b.datos).slice(0, 200)}`)
}

const caja = (page: Page) => page.getByRole('region', { name: 'Traer de ERP10' }).getByRole('region', { name: 'Día de inicio en Sumied' })

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'Traer de ERP10 es de ordenador.')
  test.setTimeout(180_000)
})

test(`X14 · día de inicio: se fija en «Traer de ERP10», antes de traer ${ANIO}, y dice hasta cuándo se trae`, async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  const s = await entrarComo(page, CUENTA_A.email)
  const empresa = await crearEmpresa(s)
  try {
    await conectar(s, empresa)
    await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))
    await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto(RUTA, { waitUntil: 'load' })
    await expect(caja(page).getByTestId('inicio-sin-fijar')).toContainText(`Sin fijar: se trae todo lo que tenga ERP10 de ${ANIO}.`, { timeout: 40_000 })
    await page.screenshot({ path: `${DIR}/dia-de-inicio-sin-fijar-1366.png` })
    await caja(page).getByLabel('Día de inicio').fill(`${ANIO}-11-01`)
    await caja(page).getByRole('button', { name: 'Fijar el día de inicio' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Fijado: desde el 01/11/${ANIO} contabiliza Sumied; de ERP10 se trae hasta el 31/10/${ANIO}.` })).toBeVisible({ timeout: 30_000 })
    await expect(caja(page).getByTestId('inicio-fijado')).toContainText(`Desde el 01/11/${ANIO} contabiliza Sumied: de ${ANIO} se trae hasta el 31/10/${ANIO}.`, { timeout: 30_000 })
    await expect(caja(page).getByRole('link', { name: 'Cambiarlo en Ajustes › Ejercicio' })).toBeVisible()
    // Y en la base, el mismo día (el que leen la carga y las paradas).
    const dia = await rest<string>(s, 'POST', 'rpc/conta_empresa_dia_de_inicio', { p_company: empresa })
    expect(dia.datos).toBe(`${ANIO}-11-01`)
    await page.screenshot({ path: `${DIR}/dia-de-inicio-fijado-1366.png` })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.screenshot({ path: `${DIR}/dia-de-inicio-fijado-1920.png` })
    expect(errores).toEqual([])
  } finally {
    await limpiar(s, empresa)
  }
})
