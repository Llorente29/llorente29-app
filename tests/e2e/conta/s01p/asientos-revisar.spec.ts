/// <reference lib="dom" />
// tests/e2e/conta/s01p/asientos-revisar.spec.ts
//
// S01p·18 · punto 2 (Julio, 12/11), en Contabilidad › Asientos, con la cuenta A
// de staging y el código de verdad:
//   1. «Para revisar» enseña todo lo propuesto, sea cual sea su origen: la
//      liquidación de la semilla dice que también espera en Ventas › Liquidaciones.
//   2. El filtro de Estado tiene «Propuesto», y deja solo lo que espera revisión.
//   3. El filtro de fechas filtra: «04/10» escrito sin año se completa al salir
//      del campo (04/10/2026), y con 04/10–04/10 solo quedan los del 04/10.
// Con sus capturas (docs/conta/capturas/s01p18).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01p18'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function abrir(page: Page) {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  await expect(page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: /^Para revisar · [\d.]+$/ })).toBeVisible({ timeout: 45_000 })
}
/** Los filtros: en el móvil, dentro de su «Filtros» plegado. */
async function filtros(page: Page) {
  if (lado(page) === 'movil') {
    const d = page.locator('details.cxt-filtros-movil')
    if (!(await d.evaluate((x) => (x as HTMLDetailsElement).open))) await d.locator('summary').click()
  }
  return page.getByRole('group', { name: 'Filtros' })
}
const filas = (page: Page) => (lado(page) === 'ordenador'
  ? page.getByRole('grid', { name: 'Asientos del libro diario' }).getByRole('row').filter({ has: page.locator('.cxd-fecha') })
  : page.getByRole('list', { name: 'Asientos del libro diario' }).getByRole('button'))

test('1 y 2 · «Para revisar» con todo lo propuesto, y el filtro de Estado con «Propuesto»', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await abrir(page)
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: /^Para revisar · [\d.]+$/ }).click()
  const liq = (lado(page) === 'ordenador'
    ? page.getByRole('grid', { name: 'Asientos del libro diario' }).getByRole('row', { name: /Liquidación Plataforma Norte/ })
    : page.getByRole('list', { name: 'Asientos del libro diario' }).getByRole('button', { name: /Liquidación Plataforma Norte/ })).first()
  await expect(liq).toContainText('También en Ventas › Liquidaciones', { timeout: 30_000 })
  await page.screenshot({ path: `${DIR}/asientos-para-revisar-${lado(page)}.png`, fullPage: true })

  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: /^Todos( · [\d.]+)?$/ }).click()
  const f = await filtros(page)
  const estado = f.getByLabel('Estado')
  await expect(estado.locator('option', { hasText: /^Propuesto$/ })).toHaveCount(1)
  await estado.selectOption({ label: 'Propuesto' })
  const n = await filas(page).count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < Math.min(n, 20); i++) await expect(filas(page).nth(i)).toContainText('Para revisar')
  await page.screenshot({ path: `${DIR}/asientos-estado-propuesto-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('3 · el filtro de fechas: «04/10» se completa al salir y deja solo lo del 04/10', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await abrir(page)
  const f = await filtros(page)
  const desde = f.getByLabel('Desde', { exact: true })
  const hasta = f.getByLabel('Hasta', { exact: true })
  await desde.fill('04/10')
  await desde.press('Tab')
  await expect(desde).toHaveValue(`04/10/${new Date().getFullYear()}`)
  await hasta.fill('04/10')
  await hasta.press('Tab')
  await expect(hasta).toHaveValue(`04/10/${new Date().getFullYear()}`)
  // Lo que queda es del 04/10 (o nada, y el pie lo dice): ni una fila de otro día.
  const fechas = page.locator('.cxd-fecha')
  const n = await fechas.count()
  for (let i = 0; i < n; i++) await expect(fechas.nth(i)).toHaveText(/^04\/10/)
  await expect(page.locator('.cxt-pie')).toContainText(/\d+ de \d+ asientos/)
  await page.screenshot({ path: `${DIR}/asientos-fechas-${lado(page)}.png`, fullPage: true })
  // Escrita a medias y sin poder completarse, lo dice.
  await desde.fill('04')
  await desde.press('Tab')
  await expect(desde).toHaveAttribute('aria-invalid', 'true')
  await expect(desde).toHaveAttribute('title', 'Escribe la fecha entera: dd/mm/aaaa')
  expect(errores).toEqual([])
})
