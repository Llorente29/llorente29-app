// tests/e2e/conta/v01/cierres.spec.ts
//
// V01 · Entrega 2 · Ventas › Cierres del día, en el ordenador y en el móvil,
// contra staging-conta. Datos: el cierre de Glovo del 24/09 en Norte Centro
// (cuenta A, en su carril): dos pedidos de Casa Lola (R9-2401 y R9-2402,
// 33,00 €) y uno de Brasa Prestada (R9-2403), cedida, que NO sale.
//
//   1. «Ventas» a secas lleva a Cierres del día; la lista con el resumen de
//      ayer, sus pestañas y el cierre por validar; en la barra, el bloque
//      «Hostelería».
//   2. La ficha: lo vendido por marca, los pedidos (sin la cedida), la factura
//      resumen, el cobro, el asiento y el PDF, y «Validar y siguiente».
//   3. Cambiar un pedido (ordenador, en su carril: escribe y lo deja como
//      estaba): «⋯ › Quitar de este cierre» con su motivo, la barra de cambios,
//      «Guardar cambios», QUITADO en la fila; y deshacerlo. No se valida aquí:
//      validar no tiene vuelta atrás en staging (lo prueba entero la prueba de
//      staging de la 1440 y la 1441, en su transacción).
// Las capturas, en docs/conta/capturas/v01 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'

const DIR = 'docs/conta/capturas/v01'
const CIERRE = enCarril('acebcda4-f03a-4f84-bfe4-062a941e60a2')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

test('la lista: Ventas lleva aquí, el resumen de ayer, las pestañas y el bloque Hostelería', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas')
  await expect(page).toHaveURL(/\/conta\/ventas\/cierres$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Cierres del día' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Ventas', 'Cierres del día'])
  const pestanas = page.getByRole('tablist', { name: 'Estado de los cierres' })
  for (const p of ['Por validar', 'En espera', 'Validados', 'Todos']) await expect(pestanas.getByRole('tab', { name: new RegExp(`^${p}`) })).toBeVisible()
  await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.s-bandeja-cifra-etiqueta', { hasText: /^Ayer · / })).toBeVisible()
  // El de Glovo del 24/09, por validar (en el ordenador, fila de la tabla; en el móvil, tarjeta).
  await page.getByRole('searchbox', { name: 'Buscar cierre' }).fill('2026-09-24')
  await expect(page.getByText('Glovo', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Validar los/ }).first()).toBeVisible()
  if (lado(page) === 'ordenador') {
    // La barra: Ventas desplegado, con el bloque «Hostelería» y «Cierres del día» marcada.
    const paginas = page.getByRole('list', { name: 'Páginas de Ventas' })
    await expect(paginas.getByText('Hostelería')).toBeVisible()
    await expect(paginas.getByRole('link', { name: 'Cierres del día' })).toHaveAttribute('aria-current', 'page')
  }
  await foto(page, 'cierres')
  expect(errores).toEqual([])
})

test('la ficha: por marca, los pedidos sin la cedida, la factura, el cobro, el asiento y el PDF', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/conta/ventas/cierres/${CIERRE}`)
  await expect(page.getByRole('heading', { level: 1, name: /^Glovo · Norte Centro/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/^Ventas del 24\/09\/2026 · /)).toBeVisible()
  const pedidos = page.getByRole('table', { name: 'Pedidos del cierre' })
  await expect(pedidos.getByRole('row').filter({ hasText: 'R9-2401' })).toHaveCount(1, { timeout: 30_000 })
  await expect(pedidos.getByRole('row').filter({ hasText: 'R9-2402' })).toHaveCount(1)
  // La cedida no sale (solo marcas propias).
  await expect(pedidos.getByText('R9-2403')).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'Lo vendido por marca' }).getByRole('row').filter({ hasText: 'Casa Lola' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Factura resumen' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Cobro' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar y siguiente' }).first()).toBeVisible()
  await expect(page.getByText('Cambiar un pedido aquí no toca el pedido en Pedidos: solo cómo cuenta en tu contabilidad.')).toBeVisible()
  await foto(page, 'cierre')
  expect(errores).toEqual([])
})

test('cambiar un pedido: quitarlo con su motivo, guardar y deshacer (nada se guarda solo)', async ({ page }) => {
  test.skip(lado(page) !== 'ordenador', 'Escribe: una vez, en el ordenador.')
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/conta/ventas/cierres/${CIERRE}`)
  const pedidos = page.getByRole('table', { name: 'Pedidos del cierre' })
  const fila = pedidos.getByRole('row').filter({ hasText: 'R9-2402' })
  await expect(fila).toHaveCount(1, { timeout: 30_000 })

  // Quitar, con su motivo: va a la barra de cambios, sin guardar.
  await fila.getByRole('button', { name: 'Más del pedido R9-2402' }).click()
  await page.getByRole('menuitem', { name: 'Quitar de este cierre' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Quitar el R9-2402 de este cierre' })
  await expect(dialogo.getByRole('button', { name: 'Quitar' })).toBeDisabled()
  await dialogo.getByLabel('Por qué').fill('Pedido de prueba del local')
  await dialogo.getByRole('button', { name: 'Quitar' }).click()
  const barra = page.getByRole('region', { name: 'Cambios sin guardar' })
  await expect(barra.getByText('1 cambio sin guardar')).toBeVisible()
  await expect(barra.getByText('R9-2402: 11,00 € → quitado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar y siguiente' }).first()).toBeDisabled()
  await foto(page, 'cierre-cambio')

  // Guardar: la barra dice lo que ha pasado (regla 8) y la fila queda QUITADA.
  await barra.getByRole('button', { name: /Guardar cambios/ }).click()
  await expect(page.getByText(/^Guardado: 1 cambio\. El cierre se ha rehecho: /)).toBeVisible({ timeout: 30_000 })
  await expect(fila.getByText('QUITADO')).toBeVisible({ timeout: 30_000 })
  await expect(fila.getByText('Pedido de prueba del local')).toBeVisible()
  await foto(page, 'cierre-guardado')

  // Y se deja como estaba.
  await fila.getByRole('button', { name: 'Más del pedido R9-2402' }).click()
  await page.getByRole('menuitem', { name: 'Deshacer lo cambiado' }).click()
  await page.getByRole('region', { name: 'Cambios sin guardar' }).getByRole('button', { name: /Guardar cambios/ }).click()
  await expect(page.getByText(/^Guardado: 1 cambio\./)).toBeVisible({ timeout: 30_000 })
  await expect(fila.getByText('QUITADO')).toHaveCount(0, { timeout: 30_000 })
  expect(errores).toEqual([])
})
