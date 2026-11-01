/// <reference lib="dom" />
// tests/e2e/conta/s01n/recibidas.spec.ts
//
// S01n · Facturas recibidas cuando la lista no se puede leer (el 01/11 la base
// tardaba más de 8 s). Contra staging-conta (la cuenta A), en ordenador y
// móvil: con conta_documentos_recibidos devolviendo el error del límite de
// tiempo, la pantalla dice que no ha podido leer las facturas y las pestañas
// enseñan «—», nunca un 0 (reglas 7 y 8). Con «Reintentar» y la base
// contestando, vuelven sus números. Lo rápida que es la base lo prueba la
// prueba de staging (supabase/staging/sql/20261101_s01n_recibidas_prueba.sql).

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01n'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

test('S01n · si la lista no se puede leer, el aviso lo dice y las pestañas no dicen 0', async ({ page }) => {
  test.setTimeout(120_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)
  let falla = true
  await page.route('**/rest/v1/rpc/conta_documentos_recibidos', async (r) => {
    if (!falla) return r.fallback()
    await r.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' }) })
  })
  await page.goto('/conta/documentos', { timeout: 30_000 })

  await expect(page.getByRole('alert').filter({ hasText: 'No se han podido leer las facturas' })).toBeVisible({ timeout: 30_000 })
  const pestanas = page.getByRole('tablist', { name: 'Estado de las facturas' }).getByRole('tab')
  await expect(pestanas.first()).toBeVisible()
  const n = await pestanas.count()
  expect(n, 'hay pestañas').toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    await expect(pestanas.nth(i).locator('[data-prueba="pestana-sin-numero"]')).toHaveText('—')
    await expect(pestanas.nth(i), 'ninguna pestaña dice 0 sin haber leído la lista').not.toContainText(/\d/)
  }
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/sin-leer-${lado(page)}.png`, fullPage: true })

  falla = false
  await page.getByRole('alert').filter({ hasText: 'No se han podido leer las facturas' }).getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'No se han podido leer las facturas' })).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('[data-prueba="pestana-sin-numero"]')).toHaveCount(0)
  await expect(pestanas.first()).toContainText(/Todas\s*\d/)
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)
  expect(errores, 'sin errores en la página').toEqual([])
})
