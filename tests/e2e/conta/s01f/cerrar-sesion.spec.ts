/// <reference lib="dom" />
// tests/e2e/conta/s01f/cerrar-sesion.spec.ts
//
// S01f (31/10) · «Cerrar sesión» en Sumied: al final del menú del usuario,
// separado (en el móvil, dentro del cajón). Cierra la sesión de verdad y lleva
// a la pantalla de entrada; al volver atrás, sin sesión, no se entra.
// Ordenador y móvil. Capturas en docs/conta/capturas/s01f/interruptores.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01f/interruptores'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

test('«Cerrar sesión» lleva a la entrada y, al volver atrás, no deja entrar sin sesión', async ({ page }) => {
  test.setTimeout(120_000)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta')
  if (lado(page) === 'movil') {
    await page.getByRole('button', { name: 'Abrir el menú' }).click()
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible()
  }
  await page.getByRole('button', { name: /\. Tus preferencias$/ }).click()
  const salir = page.getByRole('button', { name: 'Cerrar sesión' })
  await expect(salir).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/cerrar-sesion-${lado(page)}.png` })
  await salir.click()

  const entrar = page.getByRole('button', { name: 'Entrar' })
  await expect(entrar).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/login/)

  await page.goBack()
  await expect(entrar).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /\. Tus preferencias$/ })).toHaveCount(0)
})
