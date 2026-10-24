/// <reference lib="dom" />
// tests/e2e/conta/d01/plataforma.spec.ts
//
// D07 (Julio, 23/10, camino B) · Uber fuera de «Facturas recibidas». V01 ·
// Entrega 3 (24/10): sus liquidaciones ya no están en Compras › Liquidaciones,
// sino en Ventas › Liquidaciones › Plataformas, por periodo, plataforma y
// local (ventas, comisión, otros, pagan, banco y su factura), y cada fila abre
// su ficha. Contra staging-conta, cuenta A, en los dos tamaños.
//
// Datos: las liquidaciones de Uber de la cuenta A de staging. Se mira lo que
// hay (regla 31): el 23/10 eran 6; el 24/10, una sola, del 22 al 28/12/2025, y
// su plataforma se llama «Uber Eats». La prueba no crea ni borra nada.

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

test('D07 · Ventas › Liquidaciones enseña las de plataforma, con ventas, comisión y lo que pagan; la ficha de una, con la de referencia dicha', async ({ page }) => {
  test.setTimeout(90_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)

  // Lo de antes (Compras › Liquidaciones de plataforma) dice dónde están ahora.
  await page.goto('/conta/compras/liquidaciones?tipo=plataforma')
  await expect(page.locator('[data-prueba="liquidaciones-en-ventas"]')).toBeVisible({ timeout: 30_000 })

  await page.goto('/conta/ventas/liquidaciones?desde=todas')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  // Las de Uber (en la tabla y en la tarjeta del móvil).
  const uber = page.getByText(/^Uber( Eats)? · /)
  await expect(uber.first()).toBeVisible({ timeout: 30_000 })

  // La ficha de una: lo que liquida, comparado con tus cierres, sus diferencias y sus liquidaciones.
  await uber.first().click()
  const ficha = page.locator('[data-prueba="ficha-liquidacion-plataforma"]')
  await expect(ficha).toBeVisible({ timeout: 30_000 })
  for (const t of ['Lo que liquida', 'Comparado con tus cierres', 'Diferencias']) await expect(ficha.getByRole('region', { name: new RegExp(`^${t}`) })).toBeVisible()
  await expect(ficha.getByRole('table', { name: 'Liquidaciones' })).toBeVisible()
  expect(errores).toEqual([])
})
