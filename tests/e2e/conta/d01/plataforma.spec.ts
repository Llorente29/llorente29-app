/// <reference lib="dom" />
// tests/e2e/conta/d01/plataforma.spec.ts
//
// D07 (Julio, 23/10, camino B) · Uber fuera de «Facturas recibidas». V01 ·
// Entrega 3 (24/10): sus liquidaciones ya no están en Compras › Liquidaciones,
// sino en Ventas › Liquidaciones (V02: los tableros 28 y 29). Contra
// staging-conta, cuenta A, en los dos tamaños.
//
// Datos: las liquidaciones de Uber de la cuenta A de staging. Se mira lo que
// hay (regla 31): el 23/10 eran 6; el 24/10, una sola, del 22 al 28/12/2025, y
// su plataforma se llama «Uber Eats». La prueba no crea ni borra nada.

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

test('D07 · Compras › Liquidaciones dice que las de plataforma están en Ventas, y Ventas › Liquidaciones abre', async ({ page }) => {
  test.setTimeout(90_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)

  // Lo de antes (Compras › Liquidaciones de plataforma) dice dónde están ahora.
  await page.goto('/conta/compras/liquidaciones?tipo=plataforma')
  await expect(page.locator('[data-prueba="liquidaciones-en-ventas"]')).toBeVisible({ timeout: 30_000 })

  // V02 · Pantallas: Ventas › Liquidaciones es la de los tableros 28 y 29 (su e2e, en
  // v02/liquidaciones.spec.ts). Aquí, que abre con su banda y sin errores; la ficha de
  // una de plataforma, por local, la abre v01/liquidaciones.spec.ts.
  await page.goto('/conta/ventas/liquidaciones')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="banda-liquidaciones"] h2')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errores).toEqual([])
})
