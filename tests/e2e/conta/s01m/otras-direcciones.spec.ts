/// <reference lib="dom" />
// tests/e2e/conta/s01m/otras-direcciones.spec.ts
//
// S01m · En la ficha del centro (Laboral › Centros): «Otras direcciones con las
// que lo nombran las plataformas». Contra staging-conta (la cuenta de una sola
// empresa del C06), en ordenador y móvil: da de alta un centro con una dirección
// inventada, le escribe otra dirección (y una repetida, que no cuenta), la
// guarda y dice qué ha hecho, y la tarjeta del centro la enseña. Lo que hace la
// otra dirección con las liquidaciones lo prueba la prueba de staging
// (supabase/staging/sql/20261101_s01m_direcciones_prueba.sql).

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { correoDelCarril, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01m'
const SOLA = correoDelCarril('sola.admin@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const marca = () => Array.from({ length: 6 }, () => 'bcdfghjklmnprstvz'[Math.floor(Math.random() * 17)]).join('')

test('S01m · un centro con otras direcciones con las que lo nombran las plataformas', async ({ page }) => {
  test.setTimeout(120_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.addInitScript(() => { window.sessionStorage.setItem('producto.marca', 'sumied') })
  await entrarComo(page, SOLA)
  const centro = `Local ${marca()} S01m`
  await page.goto('/conta/laboral/centros', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="laboral-centros"]')).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-prueba="centro-nuevo"]').click()
  // Un centro nuevo aún no tiene otras direcciones: se escriben al editarlo.
  await expect(page.locator('[data-prueba="otras-direcciones"]')).toHaveCount(0)
  await page.locator('[data-prueba="centro-nombre"]').fill(centro)
  await page.locator('[data-prueba="centro-direccion"]').fill('Calle Inventada, 4, Madrid')
  await page.locator('[data-prueba="centro-guardar"]').click()
  await expect(page.locator('[data-prueba="centro-hecho"]')).toContainText(`Dado de alta: ${centro}`, { timeout: 20_000 })

  const tarjeta = page.locator('[data-prueba="centro"]').filter({ hasText: centro })
  await tarjeta.getByRole('button', { name: 'Editar' }).click()
  const bloque = page.locator('[data-prueba="otras-direcciones"]')
  await expect(bloque).toBeVisible({ timeout: 20_000 })
  await bloque.locator('[data-prueba="otras-direcciones-texto"]').fill('Avenida Vieja de Prueba, 106\n\navenida vieja de prueba, 106')
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/otras-direcciones-${lado(page)}.png`, fullPage: true })
  await bloque.locator('[data-prueba="otras-direcciones-guardar"]').click()
  await expect(page.locator('[data-prueba="otras-direcciones-hecho"]')).toContainText(`${centro}: guardada 1 otra dirección.`, { timeout: 20_000 })
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(tarjeta.locator('[data-prueba="centro-otras"]')).toContainText('También: Avenida Vieja de Prueba, 106', { timeout: 20_000 })
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)
  expect(errores, 'errores de la página').toEqual([])
})
