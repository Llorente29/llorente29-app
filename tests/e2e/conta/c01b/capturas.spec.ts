/// <reference lib="dom" />
// tests/e2e/conta/c01b/capturas.spec.ts
//
// C01b, tarea 4: la lista y la ficha de proveedor del estilo nuevo, en
// ordenador (1440) y en móvil (390), con las capturas junto a las maquetas
// (docs/conta/capturas/c01b/, COMPARACION.md). Las pruebas de flujo enteras
// (crear, completar al 100 %, NIF e IBAN inválidos, pagar…) son de la tarea 7.
//
// Datos: semillas de staging C01 y C01b (Hermanos Ruiz con su F-2026-0915 y
// la repetida; Mercados del Norte con la dirección vieja sin CP, ya movida por
// la 0110 a «por confirmar»). Cuenta B: sin el interruptor `conta`.
//
// Sustituye a c00/proveedores-de-siempre.spec.ts, que comprobaba justo lo
// contrario (que Cocina › Proveedores seguía siendo la pantalla vieja): la
// respuesta 1 del C01b la cambia para todas las cuentas.

import { test, expect, type Page } from '@playwright/test'
import { CARNES_SUR, CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c01b'
const MERCADOS_NORTE = 'c1b0a000-0000-4000-8000-0000000000a6'
const PANADERIA_LUNA = 'c01a0000-0000-4000-8000-0000000000a5'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// Lo que flota encima: en el ordenador, la barra «Pregunta o pide algo»; en el
// móvil la ficha vive dentro de Cocina, y lo que flota es la barra de abajo
// de Folvy (no la del módulo de contabilidad).
const BARRA_FOLVY_MOVIL = 'nav[aria-label="Navegacion principal"]'

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  const flotantes = lado(page) === 'movil' ? [BARRA_FOLVY_MOVIL] : FLOTANTES_CONTA
  expect(await loQueTapan(page, '.cx-incrustado', flotantes)).toEqual([])
}

test('lista de proveedores (cuenta A): ficha incompleta con lo que falta, y Archivados', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/kitchen/proveedores')
  await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible()
  const ruiz = page.getByRole('link', { name: /Hermanos Ruiz/ })
  await expect(ruiz).toBeVisible()
  await expect(ruiz.getByText(/Ficha incompleta/)).toBeVisible()
  await expect(ruiz.getByText(/^falta /)).toBeVisible()
  await capturar(page, 'lista')
  await page.getByRole('button', { name: 'Archivados' }).click()
  await expect(page.getByRole('button', { name: 'Archivados' })).toHaveAttribute('aria-pressed', 'true')
})

test('ficha de Hermanos Ruiz (cuenta A): la repetida en ámbar y fuera de las cifras', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Hermanos Ruiz' })).toBeVisible()
  await expect(page.getByText(/Ficha al \d+ %/).first()).toBeVisible()
  await expect(page.getByText('Lo que he aprendido de este proveedor').or(page.getByLabel('Lo que he aprendido de este proveedor')).first()).toBeVisible()
  if (lado(page) === 'ordenador') {
    await expect(page.getByText('¿Repetida?')).toBeVisible()
    await expect(page.getByText('Mismo número e importe que la de arriba. No la he apuntado.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Con quién hablas' })).toBeVisible()
    // «Le debes» cuenta la F-2026-0915 una vez: 1.283,15 €, no el doble.
    await expect(page.locator('.cxp-cifra').filter({ hasText: 'Le debes' })).not.toContainText('2.566,3')
    await expect(page.locator('#cxp-articulos')).toHaveText('Artículos que le compras')
  } else {
    await expect(page.getByRole('link', { name: /Datos fiscales/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Artículos que le compras/ })).toBeVisible()
  }
  await capturar(page, 'ficha')
})

test('lista: el «···» de una fila (Abrir, Subir factura, Archivar) sin entrar en la ficha', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/kitchen/proveedores')
  await page.getByRole('button', { name: 'Más acciones de Panadería Luna' }).click()
  const menu = page.getByRole('menu', { name: 'Acciones de Panadería Luna' })
  await expect(menu.getByRole('menuitem', { name: 'Abrir' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Subir factura' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Archivar proveedor' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/lista-menu-${lado(page)}.png`, fullPage: true })
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('Panadería Luna (respuesta 2): IBAN distinto al de la ficha y posible repetida', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/kitchen/proveedores/${PANADERIA_LUNA}`)
  await expect(page.getByRole('alert').filter({ hasText: 'IBAN distinto al de la ficha.' })).toBeVisible()
  await expect(page.getByText(/La factura L-0431 trae la cuenta …7890 y en la ficha tienes la …7892\./)).toBeVisible()
  await capturar(page, 'iban-distinto-ficha')
  await page.goto(`/kitchen/proveedores/${PANADERIA_LUNA}/facturas`)
  await expect(page.getByText('¿Posible repetida?')).toBeVisible()
  await expect(page.getByText('Misma fecha e importe que la L-0412, con otro número. No la he apuntado.')).toBeVisible()
  await expect(page.getByText('IBAN distinto', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ver la factura L-0431' }).click()
  await expect(page.getByRole('button', { name: 'Marcar como pagada' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Es el nuevo IBAN' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'No es suyo' })).toBeEnabled()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  // El diálogo flota sobre la ventana: la captura de página entera, en el
  // ordenador, salía sin él (e2e 37214203335). Se captura lo que se ve.
  await page.screenshot({ path: `${DIR}/iban-distinto-factura-${lado(page)}.png`, fullPage: false })
})

test('dirección «por confirmar» (Mercados del Norte): el reparto propuesto con «Es esta / Corregir»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/kitchen/proveedores/${MERCADOS_NORTE}/datos-fiscales`)
  await expect(page.getByText('Dirección fiscal: ¿es esta?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Es esta' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Corregir' })).toBeVisible()
  await expect(page.getByText('Se guarda al salir del campo.')).toBeVisible()
  await capturar(page, 'direccion-por-confirmar')
})

test('pestaña Pago (cuenta A): forma y plazo en píldoras, y «Cómo te factura»', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/pago`)
  await expect(page.getByRole('group', { name: 'Forma de pago' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Plazo' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Cómo te factura', exact: true })).toBeVisible()
  await capturar(page, 'pago')
})

test('cuenta B (sin `conta`): la ficha funciona entera, con Contabilidad plegado', async ({ page }) => {
  await entrarComo(page, CUENTA_B.email)
  await page.goto(`/kitchen/proveedores/${CARNES_SUR}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Carnes Sur' })).toBeVisible()
  await page.goto(`/kitchen/proveedores/${CARNES_SUR}/contabilidad`)
  const plegado = page.locator('details.cxp-plegable').first()
  await expect(plegado).toBeVisible()
  await expect(plegado).not.toHaveAttribute('open', '')
  // Plegado de verdad: lo de dentro no se ve (C02: dentro van las tarjetas de N7).
  await expect(plegado.getByText('Sus cuentas', { exact: true })).toBeHidden()
  await capturar(page, 'cuenta-b-contabilidad')
})
