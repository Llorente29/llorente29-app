/// <reference lib="dom" />
// tests/e2e/conta/d01/tiendas.spec.ts
//
// D01 · «Sus tiendas» en Liquidaciones de la ficha de una plataforma (Julio,
// 16/10), contra staging-conta, en ordenador (1440) y móvil (390). Capturas en
// docs/conta/capturas/d01/.
//
// Datos: supabase/seeds/conta/seed_d01_tiendas_staging.sql (inventados), en la
// cuenta A: Reparto Rápido Inventado, plataforma en Uber Eats, con tres tiendas
// sin asignar. La cuenta A la comparten los frentes: la prueba no escribe
// nada. «Guardar» llama a conta_tienda_plataforma_asignar y la respuesta se da
// aquí; cualquier otra escritura se corta y la prueba lo dice.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'
import { FLOTANTES_CONTA, loQueTapanSinPregunta } from '../solapes'

// Desde el W02 cada e2e corre en su carril, con las cuentas clonadas: los id de la semilla, por enCarril (24/10).
const DIR = 'docs/conta/capturas/d01'
const PLATAFORMA = enCarril('d1d00000-0000-4000-8000-000000000001')
const BURGER = enCarril('d1d00000-0000-4000-8000-000000000011')
const RARA = enCarril('d1d00000-0000-4000-8000-000000000013')
const MARCA_BURGER = enCarril('e0200000-0000-4000-8000-00000000a0b1')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

test('A · Sus tiendas: cada tienda con su marca, su local y su cuenta de cobro; «Guardar» dice qué ha quedado', async ({ page }) => {
  test.setTimeout(180_000)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  const asignadas: Record<string, unknown>[] = []
  const otras: string[] = []
  await page.route('**/rest/v1/rpc/conta_tienda_plataforma_asignar', async (r) => {
    asignadas.push(r.request().postDataJSON() as Record<string, unknown>)
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: BURGER }) })
  })
  // Como no se escribe, la lectura de después de «Guardar» devuelve la tienda tal como la dejaría la base.
  await page.route('**/rest/v1/platform_store?*', async (r) => {
    if (!asignadas.length || r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch()
    const filas = (await res.json()) as Record<string, unknown>[]
    const a = asignadas[asignadas.length - 1]
    await r.fulfill({ response: res, json: filas.map((f) => (f.id === a.p_store ? { ...f, brand_id: a.p_marca, location_id: a.p_local, treasury_account_id: a.p_banco } : f)) })
  })
  await page.route('**/rest/v1/**', async (r) => {
    const m = r.request().method()
    if (m === 'GET' || m === 'HEAD' || (m === 'POST' && /\/rest\/v1\/rpc\//.test(r.request().url()))) return r.fallback()
    otras.push(`${m} ${new URL(r.request().url()).pathname}`)
    await r.abort()
  })

  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/conta/clientes-y-proveedores/${PLATAFORMA}/liquidaciones`)
  const tarjeta = page.getByRole('region', { name: 'Sus tiendas' })
  await expect(tarjeta).toBeVisible({ timeout: 30_000 })
  await expect(tarjeta.getByRole('status')).toContainText(/no tienen marca y local: sus liquidaciones no se comparan ni se asientan hasta que se lo digas/)

  // La que se llama como una marca sale con esa marca propuesta; la que no, sin ninguna.
  // exact: «Guardar Marca Rara…» también se llama «Marca» (run 453).
  const burger = page.getByTestId(`tienda-${BURGER}`)
  await expect(burger.getByText('Burger Norte (Calle Inventada 7, Madrid, ES, 28001)', { exact: true })).toBeVisible()
  await expect(burger.getByText('Sin marca ni local')).toBeVisible()
  await expect(burger.getByLabel('Marca', { exact: true })).toHaveValue(MARCA_BURGER)
  await expect(burger.getByText(/marca propuesta por el nombre: guárdala si es esa/)).toBeVisible()
  await expect(page.getByTestId(`tienda-${RARA}`).getByLabel('Marca', { exact: true })).toHaveValue('')
  await capturar(page, 'tiendas-antes')

  // Solo la marca, sin local: no se guarda, y se dice por qué.
  await burger.getByRole('button', { name: /^Guardar / }).click()
  await expect(burger.getByRole('alert')).toHaveText('Elige la marca y el local, los dos: con uno solo no se sabe de qué asientos es.')
  expect(asignadas).toEqual([])

  // Con su local y su cuenta: se guarda y se dice qué ha quedado.
  await burger.getByLabel('Local', { exact: true }).selectOption({ label: 'Norte Centro' })
  await burger.getByLabel('Cuenta de cobro', { exact: true }).selectOption({ label: 'Cuenta principal ···1332' })
  await burger.getByRole('button', { name: /^Guardar / }).click()
  await expect(page.getByText('Guardado: «Burger Norte (Calle Inventada 7, Madrid, ES, 28001)» es Burger Norte en Norte Centro; cobra en Cuenta principal ···1332.', { exact: true })).toBeVisible()
  expect(asignadas).toEqual([expect.objectContaining({ p_store: BURGER, p_marca: MARCA_BURGER, p_local: enCarril('c01a0000-0000-4000-8000-0000000000a2'), p_banco: enCarril('3315cb3a-ad30-44ea-958b-253b1ae8811f') })])
  await expect(burger.getByText('Asignada')).toBeVisible()
  // La captura, con la lista ya leída de nuevo (la de 674ef9b salió en «Leyendo sus tiendas…»).
  await expect(tarjeta.getByText('Leyendo sus tiendas…')).toHaveCount(0)
  await expect(tarjeta.getByTestId(`tienda-${BURGER}`).getByText('Asignada')).toBeVisible()
  await capturar(page, 'tiendas-guardada')

  expect(otras).toEqual([])
  expect(errores).toEqual([])
})
