// tests/e2e/conta/r09/subir-sin-interruptor.spec.ts
//
// R09 · «Subir las ventas del TPV» sin interruptor, contra staging. Cada prueba crea en la cuenta
// del núcleo (semilla del K02) una empresa de HOSTELERÍA (company.sector) y NO toca
// company_tax_profile.ventas_por_dia: ni la prueba ni la semilla encienden nada a mano.
//   1. A 1456 × 816: por el menú (Facturación › Ventas › Ventas del día) se ve «Subir las ventas
//      del TPV»; se sueltan los cuatro CSV INVENTADOS de tests/e2e/conta/r06/ficheros (T11), se
//      guardan los días que cuadran y «Decir a qué cuenta va» abre «A qué cuenta va cada forma de pago».
//   2. A 1366 × 768, lo mismo hasta el botón, y la página no rueda.

import { test, expect, type Page } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { CARRIL, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO, abierta } from '../k02/comun'

test.skip(CARRIL === null, 'Crea una empresa en la cuenta del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/r09'
const FICHEROS = resolve('tests/e2e/conta/r06/ficheros')
const csv = () => readdirSync(FICHEROS).filter((n) => n.endsWith('.csv')).map((n) => resolve(FICHEROS, n))

/** Una empresa de hostelería recién creada, con su plan y su ejercicio. «ventas_por_dia» no se toca: queda como lo deja la base. */
async function crearHosteleria(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Bar de prueba R09 ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    sector: 'hosteleria', setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e R09' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  // Lo que se prueba: hostelería y el campo como lo deja la base, sin encenderlo.
  const t = await rest<{ ventas_por_dia: boolean | null }[]>(s, 'GET', `company_tax_profile?select=ventas_por_dia&company_id=eq.${id}`)
  expect(t.datos[0]?.ventas_por_dia ?? false, '«ventas por día» sigue apagado').toBe(false)
  return id
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Por el menú, hasta Ventas del día: Facturación › Ventas › Ventas del día. */
async function irAVentasDelDia(page: Page, empresa: string) {
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
  await page.goto('/conta', { waitUntil: 'load' })
  await page.getByRole('navigation', { name: 'Módulos' }).getByRole('button', { name: 'Facturación' }).click({ timeout: 40_000 })
  await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Ventas' }).click()
  await page.locator('[data-boton="ventasDia"]').click()
  await expect(page).toHaveURL(/\/conta\/ventas\/cierres/)
  await abierta(page, 'Ventas del día')
}

test('una empresa de hostelería recién creada sube las ventas del TPV sin encender nada', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1456')
  await irAVentasDelDia(page, empresa)
  const subir = page.getByRole('button', { name: 'Subir las ventas del TPV' })
  await expect(subir).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${DIR}/ventas-del-dia-1456.png` })

  await subir.click()
  const v = page.getByRole('dialog', { name: 'Subir las ventas del TPV' })
  await v.locator('input[type=file]').setInputFiles(csv())
  await expect(v.getByRole('heading', { name: 'Lo que he leído · 3 días' })).toBeVisible({ timeout: 30_000 })
  const guardar = v.getByRole('button', { name: /^Guardar \d+ días?$/ })
  await expect(guardar).toBeEnabled({ timeout: 30_000 })
  await guardar.click()
  await expect(v.locator('[data-prueba="resultado-subir"]')).toContainText(/^Guardados? \d+ días?/, { timeout: 60_000 })
  await v.getByRole('button', { name: 'Decir a qué cuenta va' }).click()
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await expect(f.getByRole('table', { name: 'A qué cuenta va cada forma de pago' })).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${DIR}/formas-1456.png` })
  expect(errores).toEqual([])
})

test('a 1366 × 768, el botón sale y la página no rueda', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1366')
  await irAVentasDelDia(page, empresa)
  await expect(page.getByRole('button', { name: 'Subir las ventas del TPV' })).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${DIR}/ventas-del-dia-1366.png` })
  expect(errores).toEqual([])
})
