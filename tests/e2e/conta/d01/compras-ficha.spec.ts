/// <reference lib="dom" />
// tests/e2e/conta/d01/compras-ficha.spec.ts
//
// D01 · Los fallos de Compras y de la ficha de proveedor que vio Julio el
// 16/10, contra staging-conta, en ordenador (1440) y móvil (390). Capturas en
// docs/conta/capturas/d01-compras/.
//
// ANTES (esta versión, sobre el código de main): lo que se ve hoy, sin
// arreglar nada. No escribe: abre, mira y captura.
//
// Datos: supabase/seeds/conta/seed_d01_compras_ficha_staging.sql (inventados):
//   · Lácteos Prueba Ocho — el caso de COHELDI: su ficha ya dice cómo factura,
//     pero su factura del 07/10 llegó antes y su pregunta se quedó abierta.
//   · Marca Prueba Cedida — el caso de Cloudtown Brands: sin tipo de gasto,
//     y sus facturas ya tienen su cuenta (60000000).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/d01-compras'
const LACTEOS = 'd1c00000-0000-4000-8000-000000000001'
const CEDIDA = 'd1c00000-0000-4000-8000-000000000002'
const ficha = (id: string, ap?: string) => `/conta/clientes-y-proveedores/proveedor/${id}${ap ? `/${ap}` : ''}`
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
  await page.setViewportSize(ventana)
}

test('ANTES · Compras pregunta lo que ya está contestado, y la ficha pregunta dos veces lo mismo', async ({ page }) => {
  test.setTimeout(180_000)
  await entrarComo(page, CUENTA_A.email)

  // 1 y 5 · Compras: a Lácteos (como a COHELDI) «le falta cómo te factura», aunque su ficha ya lo dice.
  await page.goto('/conta/compras')
  await expect(page.getByRole('heading', { name: 'Qué tienes que mirar' })).toBeVisible()
  await expect(page.locator('.cxc-cosa', { hasText: 'A Lácteos Prueba Ocho, S.L. le falta cómo te factura.' })).toBeVisible()
  // 4 · y a Marca Prueba Cedida «le falta el tipo de gasto», aunque sus facturas ya tienen su cuenta.
  await expect(page.locator('.cxc-cosa', { hasText: 'A Marca Prueba Cedida, S.L. le falta el tipo de gasto.' })).toBeVisible()
  await capturar(page, 'compras-antes')

  // 2 · «Cómo te factura» de Lácteos: con la opción que ya tiene, «Guardar» en gris y sin decir nada.
  await page.goto(`${ficha(LACTEOS)}/como-te-factura`)
  await expect(page.getByRole('radio', { name: /Entrega con albarán/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await capturar(page, 'como-te-factura-antes')

  if (lado(page) === 'movil') {
    // 4 · En el móvil, la portada de la ficha: «Contabilidad» dice que falta el tipo de gasto.
    await page.goto(ficha(CEDIDA))
    await expect(page.getByRole('heading', { level: 1, name: 'Marca Prueba Cedida, S.L.' })).toBeVisible()
    await capturar(page, 'ficha-antes')
    return
  }
  // 3 y 4 · La ficha de Marca Prueba Cedida: «Falta: … tipo de gasto», y en Contabilidad «Sus facturas se apuntan en 60000000».
  await page.goto(ficha(CEDIDA))
  const falta = page.locator('.cxp-falta')
  await expect(falta.getByRole('link', { name: 'tipo de gasto' })).toBeVisible()
  await capturar(page, 'ficha-antes')
  await falta.getByRole('link', { name: 'tipo de gasto' }).click()
  await expect(page).toHaveURL(/\/contabilidad#campo-expenseCategoryId$/)
  await expect(page.getByText(/Sus facturas se apuntan en/).first()).toBeVisible()
  await page.waitForTimeout(2500)
  await capturar(page, 'ficha-contabilidad-antes')
})
