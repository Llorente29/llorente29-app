// tests/e2e/conta/v01/liquidaciones.spec.ts
//
// V01 · Entrega 3 · Ventas › Liquidaciones, en el ordenador y en el móvil,
// contra staging-conta. No escribe nada (resolver una diferencia hace un
// asiento validado, que no tiene vuelta atrás en staging: lo prueba entero la
// prueba de staging de la 1650, en su transacción).
//
//   1. Plataformas (cuenta A, de hostelería): la ficha de una, por local, se
//      abre (V02 · Pantallas: la lista la sustituyen los tableros 28 y 29, con
//      su e2e en v02/liquidaciones.spec.ts, también la de la cuenta D).
//   2. Socios de marca: la vista de las mensuales del socio, y la ficha de
//      la que trae su «Relación Compras y Ventas» (semilla de compras: 3
//      productos, 2 con compras): sus albaranes contra la Relación, producto a
//      producto (Julio, 24/10, opción A). Se mira lo que hay, no lo que había
//      (regla 31): el estado lo da la pantalla, y la Patata y el Aceite salen.
//   3. Compras › Liquidaciones dice que las de plataforma y las del socio
//      están en Ventas.
// Las capturas, en docs/conta/capturas/v01 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/v01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

test('Plataformas: la ficha de una, por local (la del cobro con el banco), se sigue abriendo', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  // V02 · Pantallas: la lista de antes la sustituyen los tableros 28 y 29 (e2e en
  // v02/liquidaciones.spec.ts); su ficha por local sigue, para casar el cobro.
  const emp = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&limit=1`)
  expect(emp.status, JSON.stringify(emp.datos)).toBe(200)
  const filas = await rest<{ canal_id: string; local_id: string | null; desde: string; hasta: string }[]>(s, 'POST', 'rpc/conta_plataformas', { p_company: emp.datos[0].id, p_desde: null, p_hasta: null })
  expect(filas.status, JSON.stringify(filas.datos)).toBe(200)
  // Las de Uber de staging (D07: 6, ninguna con factura de comisión).
  expect(filas.datos.length, 'staging tiene liquidaciones de plataforma').toBeGreaterThan(0)
  const f = filas.datos[0]
  await page.goto(`/conta/ventas/liquidaciones/plataforma/${encodeURIComponent(`${f.canal_id}:${f.local_id ?? 'sin'}:${f.desde}:${f.hasta}`)}`)
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
