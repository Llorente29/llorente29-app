/// <reference lib="dom" />
// tests/e2e/conta/c02/ficha.spec.ts
//
// C02, tarea 6: la pestaña «Contabilidad» de la ficha de proveedor (maqueta
// N7FichaConta) sobre el plan de la empresa de A, en ordenador y móvil. Lo
// que se cambia en la prueba se quita en la misma prueba. Capturas junto a la
// maqueta (docs/conta/capturas/c02/).

import { test, expect, type Page } from '@playwright/test'
import { CARNES_SUR, CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'

const DIR = 'docs/conta/capturas/c02'
const BARRA_FOLVY_MOVIL = 'nav[aria-label="Navegacion principal"]'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 700 ? 'movil' : 'ordenador')

/** El plan de la empresa de A, activado si aún no lo está (como en plan.spec.ts). */
async function planActivado(page: Page) {
  await page.goto('/conta/ajustes/plan')
  const activar = page.getByRole('button', { name: 'Activar el plan' })
  const tabla = page.getByRole('searchbox', { name: 'Buscar una cuenta' })
  await expect(activar.or(tabla)).toBeVisible()
  if (await activar.count()) {
    await activar.click()
    await expect(tabla).toBeVisible()
  }
}

test('cuenta A: Sus cuentas, le pagas desde su banco (y se quita), el 347 y el extracto vacío', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await planActivado(page)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/contabilidad`)

  const cuentas = page.getByRole('region', { name: 'Sus cuentas' })
  const saldo = page.getByRole('region', { name: 'Saldo y movimientos' })
  await expect(cuentas).toBeVisible()
  // Su cuenta: una subcuenta del 400 o del 410, con la longitud de la empresa.
  await expect(cuentas.locator('.cx-dato').filter({ hasText: 'Su cuenta' })).toContainText(/4[01]0\d{5} · /)
  await expect(cuentas.getByText('Sus facturas se apuntan en')).toBeVisible()
  // El IVA, con el tipo una sola vez («IVA soportado 21 %», no «21 % 21 %»).
  const iva = cuentas.locator('.cx-dato').filter({ hasText: 'IVA que te cobra' })
  await expect(iva).toContainText(/472\d{5} · IVA soportado/)
  await expect(iva).not.toContainText(/%\s*\d+(,\d+)?\s*%/)
  await expect(cuentas.getByText('Tipo de operación')).toBeVisible()
  // Respuesta 3: la pestaña es solo N7. Ni un desplegable ni un campo fuera de
  // las tarjetas, y «Sus facturas se apuntan en» una sola vez. Local habitual
  // y el registro sanitario editable ya no están aquí.
  const pestana = page.locator('.cxp-cuentas')
  await expect(pestana.locator('select, input, textarea')).toHaveCount(0)
  await expect(page.getByText('Sus facturas se apuntan en', { exact: true })).toHaveCount(1)
  await expect(page.getByLabel('Local habitual')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Qué tipos de gasto usa tu negocio' })).toBeVisible()
  // C04: el saldo sale del libro: la F-2026-0915 validada (seed_c04_staging.sql,
  // 1.283,15) menos su rectificativa AB-2026-031 (seed_c05_staging.sql, 55,00).
  await expect(saldo.locator('.cx-dato').filter({ hasText: 'Saldo con él' })).toContainText('1.228,15 € a tu cargo')
  await expect(saldo.locator('.cx-dato').filter({ hasText: 'Va al 347 este año' })).toContainText(/^Va al 347 este año(Sí|No|Tu empresa)/)

  if (lado(page) === 'ordenador') {
    // Le pagas desde: el banco de la empresa, con confirmación con contenido (regla 8)…
    await cuentas.getByRole('button', { name: 'Cambiar: Le pagas desde' }).click()
    await cuentas.getByRole('combobox', { name: 'Cuenta: Le pagas desde' }).selectOption({ index: 1 })
    await expect(cuentas.getByRole('status').getByText(/^Le pagas ahora desde 572\d{5} · .+\. Queda en el historial del plan\.$/)).toBeVisible()
    await expect(cuentas.locator('.cx-dato').filter({ hasText: 'Le pagas desde' })).toContainText(/572\d{5} · /)
    // …y se quita en la misma prueba.
    await cuentas.getByRole('button', { name: 'Cambiar: Le pagas desde' }).click()
    await cuentas.getByRole('button', { name: 'Quitar' }).click()
    await expect(cuentas.getByRole('status').getByText('Le pagas desde: quitado. Queda en el historial del plan.')).toBeVisible()
    await expect(cuentas.locator('.cx-dato').filter({ hasText: 'Le pagas desde' })).toContainText('Sin decir')
  }

  // El extracto lee del libro (C04): su factura, con enlace a su asiento.
  await saldo.getByRole('button', { name: 'Ver extracto' }).click()
  const ext = page.getByRole('region', { name: 'Extracto' })
  await expect(ext.getByRole('link', { name: 'Ver el asiento F-2026-0915' }).first()).toBeVisible()
  await ext.getByRole('button', { name: 'Saldos por mes' }).click()
  await expect(ext.getByRole('button', { name: 'Saldos por mes' })).toHaveAttribute('aria-pressed', 'true')
  // El extracto, en su propia captura (de elemento: no cambia el tamaño de la ventana).
  // Arriba de la ventana: pegado abajo lo tapa la barra flotante, que en uso real no tapa nada.
  await ext.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await ext.screenshot({ path: `${DIR}/ficha-extracto-${lado(page)}.png` })

  // Las dos tarjetas siguen ahí antes de la captura (no el esqueleto).
  await expect(cuentas.locator('.cx-dato').filter({ hasText: 'Su cuenta' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ficha-contabilidad-${lado(page)}.png`, fullPage: true })
  const flotantes = lado(page) === 'movil' ? [BARRA_FOLVY_MOVIL] : FLOTANTES_CONTA
  expect(await loQueTapan(page, '.cx-incrustado', flotantes)).toEqual([])
})

test('«Local habitual» va en el bloque de Cocina: en A sí (compra con Cocina), en B no existe', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Lee: basta un tamaño')
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}`)
  const cocina = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Artículos que le compras' }) })
  await expect(cocina.getByLabel('Local habitual')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await cocina.screenshot({ path: `${DIR}/ficha-cocina-local-habitual.png` })
  await entrarComo(page, CUENTA_B.email)
  await page.goto(`/kitchen/proveedores/${CARNES_SUR}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Carnes Sur' })).toBeVisible()
  await expect(page.getByLabel('Local habitual')).toHaveCount(0)
})

