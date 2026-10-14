/// <reference lib="dom" />
// tests/e2e/conta/c06/marcaEnFolvy.spec.ts
//
// C06b · Respuesta 7, tarea 2: dentro de Folvy, el logo y las letras de Sumied
// sustituyen a «Folvy Conta». Las capturas de la barra de Folvy (donde sale el
// módulo) y de la cabecera de contabilidad, en ordenador y móvil, en
// docs/conta/capturas/c06b/. La misma prueba sacó el «antes» (con «Folvy
// Conta») y saca el «después» (con Sumied): no comprueba la marca, solo
// fotografía; lo que se comprueba va en marcaSumiedEnFolvy.spec.ts.
//
// Cuenta A (con el interruptor de contabilidad). Solo lee.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/c06b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
// «antes» la primera vez (con «Folvy Conta»), «despues» con Sumied.
const ETIQUETA = 'antes'

test('la marca de contabilidad dentro de Folvy: la barra y la cabecera', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/')
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  // En el ordenador, la entrada del módulo en la barra de Folvy; en el móvil,
  // la barra de abajo tal como sale (el módulo trae su propio marco).
  const entrada = page.getByRole('button', { name: /Folvy Conta|Sumied/ }).first()
  if (lado(page) === 'ordenador') await expect(entrada).toBeVisible({ timeout: 20_000 })
  else await expect(page.getByRole('navigation', { name: 'Navegacion principal' })).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/marca-barra-folvy-${ETIQUETA}-${lado(page)}.png` })

  await page.goto('/conta/ajustes')
  await expect(page.getByText('Socios y cargos').first()).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/marca-ajustes-${ETIQUETA}-${lado(page)}.png` })
  console.log(`[marca] título de la pestaña (${lado(page)}): «${await page.title()}»`)
})
