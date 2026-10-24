// tests/e2e/conta/v01/facturas.spec.ts
//
// V01 · Entrega 1 · Ventas › Facturas, en el ordenador y en el móvil:
//   1. La lista (tablero 10): «Facturas» con sus cuatro cifras, sus pestañas y
//      sus columnas; la dirección de antes (Facturación › Facturas emitidas)
//      lleva aquí; y la regla de anchos: a 1366 la barra se pliega sola y la
//      tabla no se sale de lado.
//   2. Nueva factura a mano (ordenador, en su carril: escribe): un cliente
//      nuevo con su NIF comprobado (uno mal escrito se dice), dos líneas (21 % y
//      10 % con descuento), los totales (1.259,50 €), «Guardar cambios» (nada
//      se guarda solo) y el borrador en la lista. Y emitir: número, asiento,
//      PDF y Diez; un cobro en parte; y corregir con una rectificativa de
//      importes (de 10 a 8), que se emite por la diferencia.
//      Emitir pide la 0836 (el CHECK de los orígenes de un asiento), que solo
//      entra en staging cuando está en producción y se fusiona: hasta entonces
//      staging la ensaya en ROLLBACK y esta parte lo dice y se salta (lo
//      prueba entero la prueba de staging de la 0835 y la 0836, en su
//      transacción). Con la 0836 en staging, corre entera.
//   3. Un borrador se borra (no tiene número: no deja hueco).
//   4. En el móvil: la lista en tarjetas y la ficha nueva, sin escribir.
// Las capturas, en docs/conta/capturas/v01 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/v01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

/** Un DNI que pasa la letra de control, distinto en cada pasada (el carril se borra al acabar). */
function dniValido(): string {
  const n = 10_000_000 + Math.floor(Math.random() * 89_999_999)
  return `${n}${'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}`
}

test('la lista: cifras, pestañas, columnas y la dirección de antes', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  // Lo de antes lleva aquí, con sus filtros.
  await page.goto('/conta/facturacion/emitidas?ver=todas')
  await expect(page).toHaveURL(/\/conta\/ventas\/facturas\?ver=todas$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Ventas', 'Facturas'])
  for (const c of ['Por cobrar', 'Vencido', 'Cobrado en el mes', 'Borradores']) await expect(page.locator('.s-bandeja-cifra-etiqueta', { hasText: c })).toBeVisible()
  const pestanas = page.getByRole('tablist', { name: 'Estado de las facturas' })
  for (const p of ['Todas', 'Borradores', 'Por cobrar', 'Vencidas', 'Cobradas', 'Anuladas']) await expect(pestanas.getByRole('tab', { name: new RegExp(`^${p}`) })).toBeVisible()
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  if (lado(page) === 'ordenador') {
    const cabeza = page.getByRole('table').first().getByRole('columnheader')
    await expect(cabeza.filter({ hasText: /^Número/ })).toBeVisible()
    await expect(cabeza.filter({ hasText: /^Cliente/ })).toBeVisible()
    await expect(cabeza.filter({ hasText: /^Total/ })).toBeVisible()
    // La regla de anchos (N5, también en Ventas): a 1366 la barra se pliega sola y nada se sale de lado.
    await page.setViewportSize({ width: 1366, height: 900 })
    await expect(page.getByRole('navigation', { name: 'Menú de contabilidad' })).toHaveAttribute('data-desplegada', 'no', { timeout: 10_000 })
    const sale = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(sale, 'la página no se desplaza de lado a 1366').toBeLessThanOrEqual(1)
    await page.setViewportSize({ width: 1920, height: 1080 })
  }
  await foto(page, 'lista')
  expect(errores).toEqual([])
})

test('nueva a mano: cliente nuevo, líneas, guardar; emitir, cobrar y corregir', async ({ page }) => {
  test.skip(CARRIL === null, 'Escribe facturas y clientes: solo en un carril, que se borra entero al acabar.')
  test.skip(lado(page) === 'movil', 'Escribe en la base: en un tamaño; en el móvil se mira sin escribir.')
  test.setTimeout(180_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/facturas')
  await page.getByRole('link', { name: 'Nueva factura' }).first().click()
  await expect(page).toHaveURL(/\/conta\/ventas\/facturas\/nueva$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura' })).toBeVisible({ timeout: 30_000 })

  // Un cliente nuevo sin salir: el NIF mal escrito se dice; el bueno, «Comprobado».
  const nombre = `Colegio e2e V01 ${Date.now().toString(36)}`
  await page.getByRole('region', { name: 'Cliente' }).getByRole('button', { name: 'Cliente nuevo' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Cliente nuevo' })
  await dialogo.getByLabel('Nombre o razón social').fill(nombre)
  await dialogo.getByLabel('NIF').fill('12345678A')
  await expect(dialogo.getByRole('alert')).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Guardar el cliente' })).toBeDisabled()
  await dialogo.getByLabel('NIF').fill(dniValido())
  await expect(dialogo.getByText(/^Comprobado:/)).toBeVisible()
  await dialogo.getByLabel('Dirección').fill('Calle del Colegio 1')
  await foto(page, 'cliente-nuevo')
  await dialogo.getByRole('button', { name: 'Guardar el cliente' }).click()
  await expect(dialogo).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Cliente' }).getByLabel('Cliente', { exact: true })).toHaveValue(/[0-9a-f-]{36}/, { timeout: 30_000 })

  // Dos líneas: 10 × 100 al 21 % y 1 × 50 con un 10 % de descuento al 10 %.
  await page.getByLabel('Concepto de la línea 1').fill('Menú del día')
  await page.getByLabel('Cantidad de la línea 1').fill('10')
  await page.getByLabel('Precio de la línea 1').fill('100')
  await page.getByRole('button', { name: 'Añadir línea' }).click()
  await page.getByLabel('Concepto de la línea 2').fill('Café')
  await page.getByLabel('Cantidad de la línea 2').fill('1')
  await page.getByLabel('Precio de la línea 2').fill('50')
  await page.getByLabel('Descuento de la línea 2').fill('10')
  await page.getByLabel('IVA de la línea 2').selectOption({ label: '10 %' })
  const totales = page.getByRole('region', { name: 'Líneas' }).locator('dl[aria-label="Totales"]')
  // La base y el IVA, por tipo (1.000 al 21 % y 45 al 10 %), y el total.
  await expect(totales).toContainText('Base 21 %1.000,00 €')
  await expect(totales).toContainText('IVA 21 %210,00 €')
  await expect(totales).toContainText('Base 10 %45,00 €')
  await expect(totales).toContainText('IVA 10 %4,50 €')
  await expect(totales).toContainText('Total1.259,50 €')
  // Nada se guarda solo: la barra de cambios lo dice.
  await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /asiento/i }).first()).toContainText('430')
  await foto(page, 'nueva')
  await page.getByRole('button', { name: /Guardar cambios/ }).click()
  await expect(page.getByText(/^Guardado el borrador: 2 líneas, 1\.259,50 €\./)).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/conta\/ventas\/facturas\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  const url = page.url()

  // El borrador sale en la lista, arriba, en «Borradores».
  await page.goto('/conta/ventas/facturas?ver=borradores')
  await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 30_000 })
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Factura sin emitir' })).toBeVisible({ timeout: 30_000 })

  // Emitir: número, asiento, PDF y Diez, y lo dice paso a paso.
  await page.getByRole('button', { name: 'Emitir', exact: true }).first().click()
  const emitir = page.getByRole('dialog', { name: 'Emitir la factura' })
  await expect(emitir).toContainText('1.259,50 €')
  await foto(page, 'emitir')
  await emitir.getByRole('button', { name: 'Emitir' }).click()
  const resultado = page.locator('[data-prueba="resultado-emitir"]')
  await expect(resultado).toBeVisible({ timeout: 60_000 })
  const texto = (await resultado.textContent()) ?? ''
  // La 0836 aún no está en staging (solo llega cuando está en producción): se dice y se para aquí.
  test.skip(/journal_entry_source_type_check/.test(texto), 'Staging aún no tiene la 0836 (el CHECK de los orígenes de un asiento): emitir se prueba en la prueba de staging de la tanda, en ROLLBACK, hasta que se fusione.')
  await expect(resultado).toContainText(/Emitida la F-\d{4}\/\d+ · 1\.259,50 €\./)
  await expect(resultado).toContainText('Su PDF, hecho y guardado.')
  await expect(page.locator('[data-prueba="ficha-venta"]')).toHaveAttribute('data-estado', 'emitida', { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Su asiento' })).toContainText(/Cuadra|1\.259,50/)
  await foto(page, 'emitida')

  // Un cobro en parte.
  await page.getByRole('button', { name: 'Registrar cobro' }).first().click()
  const cobro = page.getByRole('dialog', { name: /^Registrar cobro de la F-/ })
  await cobro.getByLabel('Importe').fill('500')
  await cobro.getByRole('button', { name: 'Registrar cobro' }).click()
  await expect(page.getByText('Cobro registrado: 500,00 €. Quedan 759,50 €.')).toBeVisible({ timeout: 30_000 })

  // Corregir: importes (eran 10 menús, fueron 8): la rectificativa por la diferencia.
  await page.getByRole('button', { name: 'Corregir' }).click()
  const corregir = page.getByRole('dialog', { name: /^Corregir la F-/ })
  await corregir.getByLabel('Motivo').fill('Eran 10 menús y fueron 8')
  await foto(page, 'corregir')
  await corregir.getByRole('button', { name: 'Preparar la rectificativa' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Rectificativa de la F-/ })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Cantidad de la línea 1').fill('8')
  await expect(page.getByRole('region', { name: /^Líneas/ }).locator('dl[aria-label="La diferencia"]')).toContainText('−242,00 €')
  await page.getByRole('button', { name: 'Emitir', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'Emitir la rectificativa' }).getByRole('button', { name: 'Emitir' }).click()
  await expect(page.locator('[data-prueba="resultado-emitir"]')).toContainText(/Emitida la R-\d{4}\/\d+ · −242,00 €\./, { timeout: 60_000 })
  await foto(page, 'rectificativa')
  expect(errores).toEqual([])
})

test('un borrador se borra, sin dejar hueco', async ({ page }) => {
  test.skip(CARRIL === null, 'Escribe: solo en un carril.')
  test.skip(lado(page) === 'movil', 'Escribe en la base: en un tamaño.')
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/facturas/nueva')
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Concepto de la línea 1').fill('Para borrar')
  await page.getByLabel('Precio de la línea 1').fill('10')
  await page.getByRole('button', { name: /Guardar cambios/ }).click()
  await expect(page).toHaveURL(/\/conta\/ventas\/facturas\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  await page.locator('header.s-encabezado').getByRole('button', { name: 'Más acciones' }).click()
  await page.getByRole('group', { name: 'Más acciones' }).getByRole('button', { name: /Borrar el borrador/ }).click()
  await page.getByRole('dialog', { name: 'Borrar el borrador' }).getByRole('button', { name: 'Borrar' }).click()
  await expect(page.getByText(/^Borrado el borrador/)).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('en el móvil: la lista en tarjetas y la ficha nueva', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'Solo en el móvil.')
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/facturas')
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  const sale = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sale, 'la lista no se desplaza de lado en el móvil').toBeLessThanOrEqual(1)
  await page.goto('/conta/ventas/facturas/nueva')
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva factura' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Concepto de la línea 1')).toBeVisible()
  const sale2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sale2, 'la ficha no se desplaza de lado en el móvil').toBeLessThanOrEqual(1)
  await foto(page, 'nueva')
  expect(errores).toEqual([])
})
