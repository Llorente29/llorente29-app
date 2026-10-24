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
import { CUENTA_A, entrarComo } from '../sesion'
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
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Más acciones del libro diario' }).click()
  await expect(page.getByRole('button', { name: /^Proponer lo pendiente/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Validar y enviar a Diez/ })).toHaveCount(0)
})

test('A · Validar y enviar a Diez: antes de enviar, cuántos y cuánto; y se puede cancelar sin tocar nada', async ({ page }) => {
  await encendido(page)
  await entrarComo(page, CUENTA_A.email)
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  await page.goto('/conta/libros/diario')
  // M01: el diario va en el marco; su encabezado es para el lector.
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  // M01 (Julio, 16/10): en el móvil solo «+ Nuevo asiento» está a la vista; lo demás, en «⋯».
  const abrirMas = async () => { if (lado(page) === 'movil') await page.getByRole('button', { name: 'Más acciones del libro diario' }).click() }
  await abrirMas()
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
  await expect(dialogo.getByText(/Si uno se valida y no llega a Diez, se para ahí y los siguientes se quedan como están/)).toBeVisible()
  await expect(dialogo.getByRole('button', { name: `Validar y enviar ${n} a Diez` })).toBeEnabled()
  await capturar(page, 'validar-y-enviar')
  // Desmarcar uno cambia la cuenta (cuántos y cuánto, antes de enviar).
  await dialogo.getByRole('checkbox').first().uncheck()
  await expect(dialogo.getByRole('button', { name: `Validar y enviar ${n - 1} a Diez` })).toBeVisible()
  // Cancelar no valida nada: el botón sigue diciendo los mismos.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
  await abrirMas()
  await expect(page.getByRole('button', { name: `Validar y enviar a Diez · ${n}` })).toBeVisible()
})

test('A · un asiento de ventas de Glovo propuesto: un solo «Validar asiento», que envía; y nada de Diez junto al número hasta validarlo', async ({ page }) => {
  await encendido(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario?ver=revisar')
  // M01: en el ordenador, una fila de la tabla densa; en el móvil, su tarjeta.
  const filas = lado(page) === 'ordenador'
    ? page.getByRole('grid', { name: 'Asientos del libro diario' }).getByRole('row', { name: /Ventas Glovo · / })
    : page.getByRole('list', { name: 'Asientos del libro diario' }).getByRole('button', { name: /Ventas Glovo · / })
  await filas.first().click()
  if (lado(page) === 'ordenador') await page.getByRole('link', { name: 'Abrir el asiento' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Ventas Glovo · / })).toBeVisible()
  // C07: no hay sección «Con Diez» ni botón aparte; lo propuesto no lleva detalle de Diez.
  await expect(page.getByRole('region', { name: 'Con Diez' })).toHaveCount(0)
  await expect(page.locator('[data-prueba="detalle-diez"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar y enviar a Diez' })).toHaveCount(0)
  await capturar(page, 'asiento-con-diez')
})
