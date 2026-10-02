/// <reference lib="dom" />
// tests/e2e/conta/c00/marco.spec.ts
//
// Tarea 2 del C00: el marco del módulo de contabilidad (menú flotante o barra
// inferior, barra «Pregunta o pide algo», letras y colores) en la cuenta B:
// SIN interruptor `conta` y SIN módulos de Cocina (respuesta 1 de Julio,
// «Fuera de Folvy»). Si algo falla aquí, está mal.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c00'

test('cuenta B (sin interruptor ni Cocina): el módulo carga y funciona solo', async ({ page }, info) => {
  const movil = info.project.name === 'movil'
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/conta')
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Tu empresa' })).toBeVisible()

  // El marco es el del módulo, no el de Folvy: ni barra de módulos ni burbuja.
  await expect(page.getByRole('navigation', { name: 'Menú de contabilidad' })).toBeVisible()
  await expect(page.locator('button[aria-label$="Folvy Copiloto"]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navegacion principal' })).toHaveCount(0)

  // Ajustes activo; las entradas sin pantalla no salen.
  await expect(page.getByRole('link', { name: 'Ajustes', exact: true })).toHaveAttribute('aria-current', 'page')
  for (const sinPantalla of ['Documentos', 'Bancos', 'Libros', 'Por hacer']) {
    await expect(page.getByRole('link', { name: sinPantalla, exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('link', { name: 'Tablas generales' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Personas y asesor' })).toHaveCount(0)

  // Letra Geist dentro del módulo.
  await page.evaluate(() => document.fonts.ready)
  const letra = await page.locator('.cx').first().evaluate((el) => getComputedStyle(el).fontFamily)
  expect(letra).toContain('Geist Variable')
  expect(await page.evaluate(() => document.fonts.check('16px "Geist Variable"'))).toBe(true)

  // La IA aún no contesta: lo dice, no simula.
  if (movil) {
    await page.getByRole('button', { name: 'Preguntar a Folvy' }).click()
  } else {
    await page.keyboard.press('Control+k')
    const barra = page.getByRole('textbox', { name: 'Pregunta a Folvy' })
    await expect(barra).toBeFocused()
    await barra.fill('¿Qué IVA lleva el pan?')
    await page.keyboard.press('Enter')
  }
  await expect(page.getByRole('status').getByText(/Muy pronto/)).toBeVisible()

  await page.screenshot({ path: `${DIR}/marco-${movil ? 'movil' : 'ordenador'}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
})

test('cuenta A (con interruptor): «Folvy Conta» sale en la barra de Folvy', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La barra de módulos es la misma lógica en los dos tamaños')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Folvy Conta' })).toBeVisible()
  await page.getByRole('button', { name: 'Folvy Conta' }).click()
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
})

test('cuenta B (sin interruptor): «Folvy Conta» NO sale en la barra de Folvy', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La barra de módulos es la misma lógica en los dos tamaños')
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Menú de usuario' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Folvy Conta' })).toHaveCount(0)
})
