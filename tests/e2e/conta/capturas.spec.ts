/// <reference lib="dom" />
// tests/e2e/conta/capturas.spec.ts
//
// Las capturas de la ficha para el PR, al lado de las maquetas: Hermanos Ruiz
// de la cuenta A, preparado como en la maqueta por
// supabase/seeds/conta/seed_c01_capturas.sql. Ordenador 1440 × 900 y móvil
// 390 × 844. Se guardan en docs/conta/capturas/.

import { test, expect } from '@playwright/test'
import { CUENTA_A, HERMANOS_RUIZ, entrarComo } from './sesion'

const DIR = 'docs/conta/capturas'

test.beforeEach(async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
})

test('ficha de Hermanos Ruiz', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Hermanos Ruiz' })).toBeVisible()
  await expect(page.getByText(/Ficha al \d+ %/).first()).toBeVisible()
  // Las fuentes y las cifras ya están: nada de capturar un esqueleto.
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/ficha-${movil ? 'movil' : 'ordenador'}.png`, fullPage: !movil })
  if (movil) await page.screenshot({ path: `${DIR}/ficha-movil-entera.png`, fullPage: true })
})

test('un apartado de la ficha', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/pago`)
  await expect(page.getByLabel('IBAN', { exact: true })).toHaveValue('ES91 2100 0418 4502 0005 1332')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/pago-${movil ? 'movil' : 'ordenador'}.png`, fullPage: true })
})

test('lista de proveedores', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await page.goto('/kitchen/proveedores')
  await expect(page.getByRole('link', { name: /Hermanos Ruiz/ })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/lista-${movil ? 'movil' : 'ordenador'}.png`, fullPage: true })
})
