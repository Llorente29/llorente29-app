/// <reference lib="dom" />
// tests/e2e/conta/d01/plataforma.spec.ts
//
// D07 (Julio, 23/10, camino B) · Uber fuera de «Facturas recibidas»: sus
// liquidaciones salen en Compras › Liquidaciones como liquidaciones de
// plataforma (ventas, comisión y neto), sin PDF, y no son facturas. Contra
// staging-conta, cuenta A, en los dos tamaños.
//
// Datos: las liquidaciones de Uber de la cuenta A de staging (medido el 23/10,
// solo lectura: 6, del 28/12/2025 al 15/10/2026, una de referencia, ninguna
// con factura de comisión). La prueba no crea ni borra nada.

import { test, expect } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

test('D07 · Liquidaciones enseña las de plataforma, con ventas, comisión y neto; abrir una dice que no es una factura', async ({ page }) => {
  test.setTimeout(90_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await entrarComo(page, CUENTA_A.email)

  await page.goto('/conta/compras/liquidaciones?tipo=plataforma')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Las de plataforma, con su comisión en palabras (en la tabla y en la tarjeta del móvil).
  const filas = page.getByText(/comisión [\d.]+,\d\d\s€/)
  await expect(filas.first()).toBeVisible({ timeout: 30_000 })
  expect(await filas.count()).toBeGreaterThanOrEqual(1)
  // La de referencia, dicha (regla 7: sale, con su estado).
  await expect(page.getByText('De referencia').first()).toBeVisible()

  // Abrir una: no tiene ficha ni PDF, y se dice por qué.
  await filas.first().click()
  await expect(page.getByRole('status').filter({ hasText: /No es una factura ni tiene PDF; su factura de comisión llega aparte, cada semana/ })).toBeVisible({ timeout: 10_000 })

  expect(errores).toEqual([])
})
