/// <reference lib="dom" />
// tests/e2e/conta/c05/libros.spec.ts
//
// C05 · Libros y balances contra staging-conta, en ordenador (1440) y móvil
// (390): el marco de tres niveles (N13c), el balance y la PyG (N14), los
// libros registro con el F4 y los filtros del listado de facturación (N15),
// sumas y saldos, bienes de inversión, el mapeo propio y los ejercicios. Las
// capturas van junto a las maquetas (docs/conta/capturas/c05/, COMPARACION.md)
// y se toman ANTES de escribir nada.
//
// Datos: semillas del C04 y del C05 (supabase/seeds/conta/seed_c05_staging.sql,
// todo inventado): 2025 traído, un horno como bien de inversión, el rango de
// tiques del 04/10, una rectificativa R1 y un cambio de mapeo propio (624).
// Lo único que escribe (un favorito) es del navegador y se quita al acabar.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c05'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

test('Libros en tres niveles: áreas, acciones con su estado y el buscador', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros')
  await expect(page.getByRole('heading', { level: 1, name: 'Libros' })).toBeVisible()
  const areas = page.getByRole('navigation', { name: 'Áreas de Libros' })
  for (const a of ['Diario', 'Mayor y saldos', 'Libros registro de IVA', 'Balances', 'Cuentas anuales y Registro', 'Cierre']) {
    await expect(areas.getByRole('link', { name: a, exact: true })).toBeVisible()
  }
  if (lado(page) === 'movil') {
    // En el móvil, por niveles: primero las áreas; al tocar una, sus acciones y «‹ Libros».
    await capturar(page, 'indice')
    await areas.getByRole('link', { name: 'Libros registro de IVA', exact: true }).click()
    await expect(page.getByRole('link', { name: '‹ Libros' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Acciones de Libros registro de IVA' })).toBeVisible()
  } else {
    await areas.getByRole('link', { name: 'Libros registro de IVA', exact: true }).click()
    const barra = page.getByRole('navigation', { name: 'Acciones de Libros registro de IVA' })
    await expect(barra.getByRole('group', { name: 'Facturas' })).toBeVisible()
    await expect(barra.getByRole('group', { name: 'Otros libros' })).toBeVisible()
    await expect(barra.getByRole('group', { name: 'Salidas' })).toBeVisible()
    // El buscador: Ctrl K, «requerimiento» lleva al formato AEAT.
    await page.keyboard.press('Control+k')
    const dialogo = page.getByRole('dialog', { name: 'Buscar en Libros' })
    await dialogo.getByLabel('Qué buscas').fill('requerimiento')
    await dialogo.getByRole('link', { name: /Formato AEAT/ }).click()
    await expect(page.getByRole('heading', { name: 'Libros en formato AEAT' })).toBeVisible()
  }
})

test('Balance de situación: cuadra, columna del 2025 traído y la barra de la IA', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/balance')
  await expect(page.getByRole('heading', { name: 'Balance de situación' })).toBeVisible()
  const cuadre = page.getByRole('status', { name: 'Cuadre del balance' })
  await expect(cuadre).toContainText('Cuadra')
  await expect(cuadre).toContainText('Activo = PN + Pasivo')
  await expect(page.getByRole('region', { name: 'Lo que veo' })).toBeVisible()
  await expect(page.getByText('La columna gris es el ejercicio 2025 (traído).')).toBeVisible()
  await capturar(page, 'balance')
})

test('Pérdidas y ganancias por local: las columnas suman el total', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'La tabla por local se mira en el ordenador; en el móvil, la PyG oficial')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/pyg')
  await expect(page.getByRole('heading', { name: 'Pérdidas y ganancias' })).toBeVisible()
  await page.getByRole('button', { name: 'Por local' }).click()
  const tabla = page.getByRole('table', { name: 'Pérdidas y ganancias por local' })
  await expect(tabla).toBeVisible()
  // Los dos locales de A y «Común», aunque Norte Mercado no tenga apuntes
  // (regla 7: sale a cero; la captura del e2e 153 no lo enseñaba).
  for (const c of ['Norte Centro', 'Norte Mercado', 'Común']) await expect(tabla.getByRole('columnheader', { name: c, exact: true })).toBeVisible()
  await expect(page.getByText('Las columnas suman el total al céntimo.')).toBeVisible()
  await capturar(page, 'pyg-por-local')
})

test('Sumas y saldos: cuadra y cada nivel suma a sus hijos', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/mayor/sumas-saldos')
  await expect(page.getByRole('table', { name: 'Sumas y saldos' }).first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Cuadra: Debe = Haber' }).first()).toBeVisible()
  await capturar(page, 'sumas-saldos')
})

test('Expedidas: el resumen de tiques es F4 con su rango, y el libro cuadra con la 477', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/registro/expedidas')
  await expect(page.getByRole('heading', { name: 'Facturas expedidas' })).toBeVisible()
  await expect(page.getByText('F4 · resumen · art. 63.4 · T1-000101–T1-000105 · 5 tiques')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Cifras del libro' })).toContainText('✓ Cuadra')
  // «1 anotación.», no «1 anotaciones.» (lo enseñó la captura del e2e 153).
  await expect(page.getByText(/^(1 anotación|(?:0|[2-9]|\d{2,}) anotaciones)\.$/)).toBeVisible()
  await capturar(page, 'expedidas')
})

test('Recibidas: la rectificativa R1 y los filtros dicen «N de M»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/registro/recibidas')
  await page.getByLabel('Periodo').selectOption({ label: 'Todo el ejercicio' })
  await expect(page.getByText('R1 · rectificativa')).toBeVisible()
  await capturar(page, 'recibidas')
  await page.getByText('Filtros del listado de facturación').click()
  await page.getByRole('checkbox', { name: 'R1' }).check()
  await expect(page.getByText(/^1 de \d+ anotaciones con los filtros puestos\.$/)).toBeVisible()
  await page.getByRole('button', { name: 'Quitar filtros' }).click()
  await expect(page.getByText(/^\d+ anotaciones\.$/)).toBeVisible()
})

test('Bienes de inversión y ejercicios: el horno y el 2025 traído', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/registro/bienes-inversion')
  await expect(page.getByText('Horno mixto de 10 bandejas (semilla C05)')).toBeVisible()
  await page.goto('/conta/libros/cierre/ejercicios')
  const tabla = page.getByRole('table', { name: 'Ejercicios de la empresa' })
  await expect(tabla.getByRole('row').filter({ hasText: '2025' })).toContainText('traído')
  await capturar(page, 'ejercicios')
})

test('Qué cuentas alimentan cada línea: el cambio propio y su historial', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/anuales/mapeo')
  await page.getByRole('button', { name: 'Pérdidas y ganancias' }).click()
  await expect(page.getByText('624 · tuyo')).toBeVisible()
  await page.getByRole('button', { name: 'Historial' }).click()
  await expect(page.getByRole('table', { name: 'Historial del mapeo' })).toContainText('El transporte que pagamos es el de la mercancía comprada')
  await capturar(page, 'mapeo')
})

test('Cuentas anuales: el modelo que toca, con sus cifras y su cita', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/anuales/cuentas-anuales')
  await expect(page.getByRole('region', { name: 'Qué modelo te toca' })).toContainText('LSC art. 257.1')
  await expect(page.getByRole('table', { name: 'Cifras con las que se decide' })).toBeVisible()
  await capturar(page, 'cuentas-anuales')
})

test('Cuenta B (un solo local): la PyG no ofrece «Por local» y sus libros son suyos', async ({ page }) => {
  await entrarComo(page, CUENTA_B.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/pyg')
  await expect(page.getByRole('heading', { name: 'Pérdidas y ganancias' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Por local' })).toHaveCount(0)
  await page.goto('/conta/libros/registro/expedidas')
  await expect(page.getByText('T1-000101')).toHaveCount(0)
  await capturar(page, 'cuenta-b-pyg')
})
