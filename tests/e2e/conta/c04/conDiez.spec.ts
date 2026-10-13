/// <reference lib="dom" />
// tests/e2e/conta/c04/conDiez.spec.ts
//
// C04b · R15 · «Validar y enviar a Diez» y «Con Diez», contra staging-conta,
// en ordenador (1440) y móvil (390), como administrador de A.
//
// Datos: los días de Glovo de la empresa A propuestos por plataforma y local
// (los del R9: 24 y 25/09, que deja propuestos el real de la tanda en staging).
//
// Lo que esta prueba NO hace, a propósito: validar. Validar deja huella para
// siempre (lo dice libro.spec.ts) y, además, la bajada de la 0130 PARA si hay
// unidades validadas, así que rompería el siguiente real de la tanda en
// staging. El camino de escritura (validar → guardar el PDF → enlazarlo) lo
// prueba la tanda SQL 20261021_conta_documentos_prueba.sql, como usuario y
// dentro de un ROLLBACK; el envío, tests/conta/diez/enviar.test.ts, freno a freno.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c04b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

test('A · Validar y enviar a Diez: antes de enviar, cuántos y cuánto; y se puede cancelar sin tocar nada', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { level: 1, name: 'Libro diario' })).toBeVisible()
  // Las ventas de Glovo de A están propuestas: el botón dice cuántas.
  const boton = page.getByRole('button', { name: /^Validar y enviar a Diez · \d+$/ })
  await expect(boton).toBeVisible()
  const n = Number((await boton.textContent())!.match(/(\d+)$/)![1])
  expect(n).toBeGreaterThan(0)
  await boton.click()
  const dialogo = page.getByRole('dialog', { name: 'Validar y enviar a Diez' })
  await expect(dialogo).toBeVisible()
  // Una casilla por asiento, marcados los propuestos; el resumen con cuántos y el total.
  await expect(dialogo.getByRole('checkbox', { checked: true })).toHaveCount(n)
  await expect(dialogo.getByText(new RegExp(`^${n} asientos? · [\\d.]+,\\d{2}\\s€$`))).toBeVisible()
  await expect(dialogo.getByText(/Sin el documento adjunto en Diez no se da por enviado/)).toBeVisible()
  await expect(dialogo.getByRole('button', { name: `Validar y enviar ${n} a Diez` })).toBeEnabled()
  await capturar(page, 'validar-y-enviar')
  // Desmarcar uno cambia la cuenta (cuántos y cuánto, antes de enviar).
  await dialogo.getByRole('checkbox').first().uncheck()
  await expect(dialogo.getByRole('button', { name: `Validar y enviar ${n - 1} a Diez` })).toBeVisible()
  // Cancelar no valida nada: el botón sigue diciendo los mismos.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Validar y enviar a Diez · ${n}` })).toBeVisible()
})

test('A · un asiento de ventas de Glovo: «Con Diez» dice dónde está y qué pasará al validarlo', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario?ver=revisar')
  await page.getByRole('button', { name: /Ventas Glovo · / }).first().click()
  if (lado(page) === 'ordenador') await page.getByRole('link', { name: 'Abrir el asiento' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Ventas Glovo · / })).toBeVisible()
  const tarjeta = page.getByRole('region', { name: 'Con Diez' })
  await expect(tarjeta).toBeVisible()
  await expect(tarjeta.getByRole('status')).toHaveText('Propuesto')
  await expect(tarjeta.getByText(/Al validarlo, Folvy guarda su «Resumen de ventas» y lo envía a Diez con la factura/)).toBeVisible()
  // Sin documento todavía: ni «Ver documento» ni «Reintentar».
  await expect(tarjeta.getByRole('button')).toHaveCount(0)
  // Los dos botones de arriba: validar solo, o validar y enviar.
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar y enviar a Diez' })).toBeVisible()
  await capturar(page, 'asiento-con-diez')
})
