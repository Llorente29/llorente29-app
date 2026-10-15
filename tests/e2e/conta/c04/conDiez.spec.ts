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
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c04b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
}

test('A · Validar y enviar a Diez: Glovo sale en la lista con su porqué, sin poder marcarse (15/10), y cancelar no toca nada', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { level: 1, name: 'Libro diario' })).toBeVisible()
  // Las ventas propuestas de A son de Glovo, que no se puede enviar todavía
  // (una factura por tienda de Glovo y día): el botón no las cuenta.
  const boton = page.getByRole('button', { name: /^Validar y enviar a Diez( · \d+)?$/ })
  await expect(boton).toBeVisible()
  const t = (await boton.textContent())!
  const n = /· (\d+)$/.test(t) ? Number(t.match(/(\d+)$/)![1]) : 0
  await boton.click()
  const dialogo = page.getByRole('dialog', { name: 'Validar y enviar a Diez' })
  await expect(dialogo).toBeVisible()
  await expect(dialogo.getByText(/Si uno se valida y no llega a Diez, se para ahí y los siguientes se quedan como están/)).toBeVisible()
  // Regla 7: Glovo sale (no se esconde), sin marcar, sin poder marcarse y con su porqué.
  const glovo = dialogo.getByRole('listitem').filter({ hasText: /Ventas Glovo · / })
  expect(await glovo.count()).toBeGreaterThan(0)
  await expect(glovo.first().getByRole('checkbox')).toBeDisabled()
  await expect(glovo.first().getByRole('checkbox')).not.toBeChecked()
  await expect(glovo.first().getByText(/No se puede enviar todavía: Glovo va en Diez con una factura por tienda de Glovo y día/)).toBeVisible()
  // Marcados, solo los que se pueden enviar: los que contaba el botón.
  await expect(dialogo.getByRole('checkbox', { checked: true })).toHaveCount(n)
  await expect(dialogo.getByRole('button', { name: `Validar y enviar ${n} a Diez` })).toBeVisible()
  if (n === 0) await expect(dialogo.getByRole('button', { name: 'Validar y enviar 0 a Diez' })).toBeDisabled()
  await capturar(page, 'validar-y-enviar')
  // Cancelar no valida nada: el botón sigue igual.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
  await expect(page.getByRole('button', { name: t })).toBeVisible()
})

test('A · un asiento de ventas de Glovo: «Con Diez» dice por qué no se puede enviar todavía, y solo se ofrece validar (15/10)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario?ver=revisar')
  await page.getByRole('button', { name: /Ventas Glovo · / }).first().click()
  if (lado(page) === 'ordenador') await page.getByRole('link', { name: 'Abrir el asiento' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Ventas Glovo · / })).toBeVisible()
  const tarjeta = page.getByRole('region', { name: 'Con Diez' })
  await expect(tarjeta).toBeVisible()
  await expect(tarjeta.getByRole('status')).toHaveText('Propuesto')
  await expect(tarjeta.getByText(/No se puede enviar a Diez todavía: Glovo va en Diez con una factura por tienda de Glovo y día/)).toBeVisible()
  await expect(tarjeta.getByText(/lo envía a Diez con la factura/)).toHaveCount(0)
  // Sin documento todavía: ni «Ver documento» ni «Reintentar».
  await expect(tarjeta.getByRole('button')).toHaveCount(0)
  // Validar sí; «Validar y enviar a Diez», no (validar no se deshace).
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar y enviar a Diez' })).toHaveCount(0)
  await capturar(page, 'asiento-con-diez')
})
