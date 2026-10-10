/// <reference lib="dom" />
// tests/e2e/conta/compras/compras.spec.ts
//
// Compras (encargo «Contabilidad: las compras») contra staging-conta, en
// ordenador (1440) y móvil (390): la página (N18), la liquidación (N19),
// «Cómo te factura» en la ficha (N20) y el diálogo de subir una factura. Las
// capturas van junto a las maquetas (docs/conta/capturas/compras/).
//
// Datos: supabase/seeds/conta/seed_compras_staging.sql (todo inventado).
// No escribe nada: abre, mira y cierra.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/compras'
const VERDURAS = 'c0c00000-0000-4000-8000-000000000001'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string, contenedor = '.cx-principal') {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  if (contenedor === '.cx-principal') expect(await loQueTapan(page, contenedor, FLOTANTES_CONTA)).toEqual([])
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

test('Compras: lo que hay que mirar, lo que espera factura y las liquidaciones', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/compras')
  await expect(page.getByRole('heading', { level: 1, name: 'Compras' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Qué tienes que mirar' })).toBeVisible()
  // La semilla: sin forma de facturar, sin NIF (con el que trae el papel) y a nombre de «Contado».
  await expect(page.getByText('Verduras del Huerto Prueba, S.L. ha entregado con albarán, y su ficha no dice cómo factura.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Usar ese NIF' })).toBeVisible()
  await expect(page.getByText('va a nombre de «Contado», y no sé quién es.')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Qué está esperando factura' }).getByText('Carnes Prueba del Valle, S.L.').first()).toBeVisible()
  await expect(page.getByText('Ha llegado: falta mirarla y confirmarla.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Subir sus documentos' })).toBeVisible()
  await capturar(page, 'compras')

  // Subir una factura: el diálogo, sin subir nada.
  await page.getByRole('button', { name: 'Subir una factura' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Subir una factura' })
  await expect(dialogo.getByLabel('La factura (foto o PDF)')).toBeVisible()
  await capturar(page, 'subir-factura', 'dialogo')
  await dialogo.getByLabel('La factura (foto o PDF)').press('Escape')
  await expect(dialogo).toBeHidden()
})

test('La liquidación de septiembre y su contraste (N19)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/compras')
  await page.getByText('Ha llegado: falta mirarla y confirmarla.').locator('xpath=ancestor::div[contains(@class,"cxc-liq")]').getByRole('link', { name: 'Abrir' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Distribuciones Prueba Aurora, S\.L\. · septiembre de 2026/ })).toBeVisible()
  await expect(page.getByText('Lo que dice que te mandó coincide con lo que recibiste.')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Ventas por plataforma' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Decirle cuál es cuál' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Contabilizar' })).toBeEnabled()
  await capturar(page, 'liquidacion')
})

test('Cómo te factura, en la ficha (N20)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/kitchen/proveedores/${VERDURAS}/pago`)
  const grupo = page.getByRole('group', { name: 'Cómo te factura', exact: true })
  await expect(grupo).toBeVisible()
  await expect(grupo.getByRole('radio')).toHaveCount(3)
  await expect(grupo.getByText('Su última entrega vino con albarán.')).toBeVisible()
  await capturar(page, 'como-te-factura', 'ficha')
})
