/// <reference lib="dom" />
// tests/e2e/conta/c04/conDiez.spec.ts
//
// C04b · R15 · «Validar y enviar a Diez» y «Con Diez», contra staging-conta,
// en ordenador (1440) y móvil (390), como administrador de A.
//
// Datos: los días de Glovo de la empresa A propuestos por plataforma y local
// (los del R9: 24 y 25/09, que deja propuestos el real de la tanda en staging).
//
// C07 (Julio, 22/10): todo esto solo existe con «Enviar a Diez» encendido. A lo
// tiene apagado en staging, así que la red lo contesta encendido
// (conta_diez_envio_empresa); apagado, ni el botón ni nada de Diez.
//
// Lo que esta prueba NO hace, a propósito: validar. Validar deja huella para
// siempre (lo dice libro.spec.ts) y, además, la bajada de la 0130 PARA si hay
// unidades validadas, así que rompería el siguiente real de la tanda en
// staging. El camino de escritura (validar → guardar el PDF → enlazarlo) lo
// prueba la tanda SQL 20261021_conta_documentos_prueba.sql, como usuario y
// dentro de un ROLLBACK; el envío, tests/conta/diez/enviar.test.ts, freno a freno.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c04b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
}

/** «Enviar a Diez» encendido, como lo contesta la base (C07). */
async function encendido(page: Page) {
  await page.route(/\/rest\/v1\/conta_diez_envio_empresa\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ enviar: true, desde: '2026-09-01', cambiado_por_nombre: null, cambiado_en: null }) }))
}

test('A · apagado (como está en staging): el libro no ofrece «Validar y enviar a Diez»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  // S01 · PR 3: «Proponer lo pendiente» ya no existe; apagado, solo queda «+ Nuevo asiento» (sin «⋯» en el móvil).
  await expect(page.getByRole('button', { name: '+ Nuevo asiento' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Más acciones del libro diario' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Validar y enviar a Diez/ })).toHaveCount(0)
})

test('A · las ventas de Glovo propuestas ya no se validan desde el libro: esperan en Ventas › Cierres del día', async ({ page }) => {
  // V01 · Entrega 2 (Julio, 24/10): las propuestas de ventas de un canal se validan en
  // Cierres del día, con su factura resumen y su PDF; el libro ya no las ofrece ni las
  // envía a Diez al validar (entran en el traspaso del mes). Las del día entero «a la
  // antigua» (sin canal) sí siguen aquí.
  await encendido(page)
  await entrarComo(page, CUENTA_A.email)
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  await page.goto('/conta/libros/diario?ver=revisar')
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  const asientos = lado(page) === 'ordenador'
    ? page.getByRole('grid', { name: 'Asientos del libro diario' })
    : page.getByRole('list', { name: 'Asientos del libro diario' })
  await expect(asientos).toBeVisible({ timeout: 30_000 })
  await expect(asientos.getByText(/Ventas Glovo · /)).toHaveCount(0)
  await capturar(page, 'validar-y-enviar')
})

test('A · un asiento de ventas de Glovo propuesto: se valida en Cierres del día, y nada de Diez junto al número hasta validarlo', async ({ page }) => {
  await encendido(page)
  await entrarComo(page, CUENTA_A.email)
  // El de Glovo del 25/09 en Norte Centro (la e2e de Cierres no lo toca: su asiento no cambia).
  await page.goto(`/conta/libros/diario/${enCarril('a6f75b0c-6e5c-4106-88b3-5659e6ca9618')}`)
  await expect(page.getByRole('heading', { level: 1, name: /^Ventas Glovo · / })).toBeVisible({ timeout: 30_000 })
  // C07: no hay sección «Con Diez» ni botón aparte; lo propuesto no lleva detalle de Diez.
  await expect(page.getByRole('region', { name: 'Con Diez' })).toHaveCount(0)
  await expect(page.locator('[data-prueba="detalle-diez"]')).toHaveCount(0)
  // V01 · Entrega 2: no se valida aquí; lleva a su cierre, que lo valida con su factura y su PDF.
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Validar y enviar a Diez' })).toHaveCount(0)
  const ir = page.getByRole('link', { name: 'Validar en Cierres del día' })
  await expect(ir).toBeVisible()
  await capturar(page, 'asiento-con-diez')
  await ir.click()
  await expect(page).toHaveURL(/\/conta\/ventas\/cierres\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: /^Glovo · / })).toBeVisible({ timeout: 30_000 })
})
