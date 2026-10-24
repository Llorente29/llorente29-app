// tests/e2e/conta/v01/liquidaciones.spec.ts
//
// V01 · Entrega 3 · Ventas › Liquidaciones, en el ordenador y en el móvil,
// contra staging-conta. No escribe nada (resolver una diferencia hace un
// asiento validado, que no tiene vuelta atrás en staging: lo prueba entero la
// prueba de staging de la 1650, en su transacción).
//
//   1. Plataformas (cuenta A, de hostelería): la lista con sus pestañas, que
//      suman «Todas», sus filtros y, en la barra, «Liquidaciones» en el bloque
//      «Hostelería» de Ventas. Las de Uber de staging (D07: 6, ninguna con
//      factura de comisión) salen, y su ficha se abre.
//   2. Socios de marca: la vista de las mensuales del socio, y la ficha de
//      la que trae su «Relación Compras y Ventas» (semilla de compras: 3
//      productos, 2 con compras): sus albaranes contra la Relación, producto a
//      producto (Julio, 24/10, opción A). Se mira lo que hay, no lo que había
//      (regla 31): el estado lo da la pantalla, y la Patata y el Aceite salen.
//   3. Compras › Liquidaciones dice que las de plataforma y las del socio
//      están en Ventas.
//   4. La cuenta D (sin hostelería): la pantalla lo dice y no enseña nada.
// Las capturas, en docs/conta/capturas/v01 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_D, entrarComo } from '../sesion'
import { rest } from '../api'
import { barraAbiertaSiPlegada } from '../barra'

const DIR = 'docs/conta/capturas/v01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

test('Plataformas: la lista por periodo, plataforma y local, sus pestañas y la ficha de una', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/liquidaciones?desde=todas')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Ventas', 'Liquidaciones'])
  const pestanas = page.getByRole('tablist', { name: 'Estado de las liquidaciones' })
  for (const p of ['Diferencia', 'Falta su factura', 'Por cobrar', 'Cuadra', 'Todas']) await expect(pestanas.getByRole('tab', { name: new RegExp(`^${p}`) })).toBeVisible()
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  if (lado(page) === 'ordenador') {
    await barraAbiertaSiPlegada(page)
    const paginas = page.getByRole('list', { name: 'Páginas de Ventas' })
    await expect(paginas.locator('.s-barra-bloque', { hasText: 'Hostelería' })).toBeVisible()
    await expect(paginas.getByRole('link', { name: 'Liquidaciones' })).toHaveAttribute('aria-current', 'page')
    const cabeza = page.getByRole('table').first().getByRole('columnheader')
    for (const c of ['Plataforma', 'Ventas', 'Pagan', 'Estado']) await expect(cabeza.filter({ hasText: new RegExp(`^${c}`) })).toBeVisible()
  }
  // La plataforma de staging se llama «Uber Eats» (24/10).
  const uber = page.getByText(/^Uber( Eats)? · /)
  await expect(uber.first()).toBeVisible({ timeout: 30_000 })
  await foto(page, 'liquidaciones')

  await uber.first().click()
  const ficha = page.locator('[data-prueba="ficha-liquidacion-plataforma"]')
  await expect(ficha).toBeVisible({ timeout: 30_000 })
  await expect(ficha.getByRole('region', { name: 'Lo que liquida' })).toContainText('Pagan')
  await expect(ficha.getByRole('region', { name: /^Diferencias/ })).toBeVisible()
  await foto(page, 'liquidacion-plataforma')
  expect(errores).toEqual([])
})

test('Socios de marca: las mensuales del socio, y Compras › Liquidaciones dice dónde están', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/liquidaciones?ver=socios')
  await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Lo que liquidas cada mes con el socio de las marcas cedidas/)).toBeVisible()
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await foto(page, 'liquidaciones-socios')

  // La ficha de la mensual que trae su Relación: el cruce de sus albaranes, producto a producto.
  const liq = await rest<{ id: string }[]>(s, 'GET', 'licensed_settlement?select=id&detail->inventario=not.is.null&order=period_from.desc&limit=1')
  expect(liq.status, JSON.stringify(liq.datos)).toBe(200)
  expect(liq.datos.length, 'la semilla de compras trae una mensual con su Relación').toBe(1)
  await page.goto(`/conta/compras/liquidacion/${liq.datos[0].id}`)
  const cruce = page.locator('[data-prueba="cruce-relacion"]')
  await expect(cruce).toBeVisible({ timeout: 30_000 })
  await expect(cruce).toHaveAttribute('data-estado', /^(coincide|no-coincide|sin-albaranes)$/)
  const tabla = page.locator('[data-prueba="cruce-productos"]')
  await expect(tabla.getByText('Patata Prueba kg', { exact: true })).toBeVisible()
  await expect(tabla.getByText('Aceite Prueba lt', { exact: true })).toBeVisible()
  // Sin compras en la Relación ni en los albaranes: no es una compra del mes.
  await expect(tabla.getByText('Salsa Prueba Rara', { exact: true })).toHaveCount(0)
  await foto(page, 'socio-relacion')

  await page.goto('/conta/compras/liquidaciones')
  await expect(page.locator('[data-prueba="liquidaciones-en-ventas"]')).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('D (sin hostelería): Liquidaciones lo dice y no enseña nada', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_D.email)
  await page.goto('/conta/ventas/liquidaciones')
  await expect(page.getByText(/^Las liquidaciones de plataformas y de socios de marca son de las empresas que venden en hostelería/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('tablist', { name: 'Estado de las liquidaciones' })).toHaveCount(0)
  expect(errores).toEqual([])
})
