/// <reference lib="dom" />
// tests/e2e/conta/d01/compras-ficha.spec.ts
//
// D01 · Los fallos de Compras y de la ficha de proveedor que vio Julio el
// 16/10, contra staging-conta, en ordenador (1440) y móvil (390). Capturas en
// docs/conta/capturas/d01-compras/: las «-antes» se sacaron con el código de
// main (2664d9fa, run con fijar_capturas) y se quedan; esta versión saca las
// «-despues».
//
// Datos: supabase/seeds/conta/seed_d01_compras_ficha_staging.sql (inventados):
//   · Lácteos Prueba Ocho: su ficha ya dice cómo factura, pero su factura del
//     07/10 llegó antes y su pregunta se quedó abierta.
//   · Marca Prueba Cedida: sin tipo de gasto, y sus facturas ya tienen su
//     cuenta (60000000).
//   · Verduras del Huerto Prueba (seed_compras_staging.sql): sin tipo de gasto
//     ni cuenta para sus facturas.
// Escribe una sola cosa: «Guardar» en «Cómo te factura» de Lácteos con la
// misma opción que ya tiene (vuelve a mirar sus recepciones abiertas: ninguna).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/d01-compras'
const LACTEOS = 'd1c00000-0000-4000-8000-000000000001'
const CEDIDA = 'd1c00000-0000-4000-8000-000000000002'
const VERDURAS = 'c0c00000-0000-4000-8000-000000000001'
const ficha = (id: string, ap?: string) => `/conta/clientes-y-proveedores/proveedor/${id}${ap ? `/${ap}` : ''}`
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string, contenedor: string | null = '.cx-principal') {
  await page.evaluate(() => document.fonts.ready)
  if (contenedor) expect(await loQueTapan(page, contenedor, FLOTANTES_CONTA)).toEqual([])
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.max(ventana.height, alto) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
  await page.setViewportSize(ventana)
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('DESPUÉS · Compras no pregunta lo contestado, «Guardar» dice que ya estaba, y la ficha pregunta una vez y lleva al campo', async ({ page }) => {
  test.setTimeout(180_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)

  // 1 y 5 · Compras: Lácteos ya no sale (su ficha dice cómo factura y su factura está hecha);
  // Marca Prueba Cedida tampoco (sus facturas tienen su cuenta). Verduras sí, con la pregunta en palabras de oficina.
  await page.goto('/conta/compras')
  await expect(page.getByRole('heading', { name: 'Qué tienes que mirar' })).toBeVisible()
  const verduras = page.locator('.cxc-cosa', { hasText: /^A Verduras del Huerto Prueba, S\.L\. le faltan/ })
  await expect(verduras.getByText('A Verduras del Huerto Prueba, S.L. le faltan el NIF, dónde se apuntan sus facturas y cómo te factura.', { exact: true })).toBeVisible()
  await expect(verduras.getByText(/sin saber a qué cuenta van sus facturas no las puedo apuntar; no sé si trae la factura con cada entrega o si manda albaranes y la factura después, así que no sé si tengo que esperar su factura/)).toBeVisible()
  await expect(page.locator('.cxc-cosa', { hasText: 'Lácteos Prueba Ocho' })).toHaveCount(0)
  await expect(page.locator('.cxc-cosa', { hasText: 'Marca Prueba Cedida' })).toHaveCount(0)
  await capturar(page, 'compras-despues')

  // 2 · «Cómo te factura» de Lácteos: con la misma opción, «Guardar» se puede pulsar y dice que ya estaba.
  await page.goto(`${ficha(LACTEOS)}/como-te-factura`)
  await expect(page.getByRole('radio', { name: /Entrega con albarán/ })).toHaveAttribute('aria-checked', 'true')
  const guardar = page.getByRole('button', { name: 'Guardar' })
  await expect(guardar).toBeEnabled()
  await guardar.click()
  await expect(page.getByText('Ya estaba guardado: Lácteos Prueba Ocho, S.L. factura «Entrega con albarán y factura después». No tiene recepciones abiertas que volver a mirar.')).toBeVisible()
  await capturar(page, 'como-te-factura-despues', null)

  if (lado(page) === 'movil') {
    // 4 · En el móvil, la portada de Marca Prueba Cedida: «Contabilidad» no dice que falte nada de sus facturas.
    await page.goto(ficha(CEDIDA))
    await expect(page.getByRole('heading', { level: 1, name: 'Marca Prueba Cedida, S.L.' })).toBeVisible()
    await expect(page.getByText(/Falta dónde se apuntan sus facturas|Falta el tipo de gasto/)).toHaveCount(0)
    await capturar(page, 'ficha-despues', null)
    expect(errores).toEqual([])
    return
  }

  // 4 · Marca Prueba Cedida: «Falta» ya no pregunta por sus facturas; en Contabilidad, una sola línea con su cuenta.
  await page.goto(ficha(CEDIDA))
  const falta = page.locator('.cxp-falta')
  await expect(falta).toBeVisible()
  await expect(falta.getByRole('link', { name: /tipo de gasto|dónde se apuntan sus facturas/ })).toHaveCount(0)
  await capturar(page, 'ficha-despues', null)
  await page.goto(ficha(CEDIDA, 'contabilidad'))
  await expect(page.getByText('Sus facturas se apuntan en', { exact: true })).toHaveCount(1)
  await expect(page.locator('#campo-expenseCategoryId')).toContainText('60000000')

  // 3 · Verduras: el enlace de «Falta» lleva al campo, con el buscador abierto para elegir.
  await page.goto(ficha(VERDURAS))
  const enlace = page.locator('.cxp-falta').getByRole('link', { name: 'dónde se apuntan sus facturas' })
  await expect(enlace).toBeVisible()
  await enlace.click()
  await expect(page).toHaveURL(/\/contabilidad#campo-expenseCategoryId$/)
  await expect(page.getByRole('combobox', { name: 'Cuenta: Sus facturas se apuntan en' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#campo-expenseCategoryId')).toBeFocused()
  await capturar(page, 'ficha-contabilidad-despues', null)
  expect(errores).toEqual([])
})
