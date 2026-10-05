/// <reference lib="dom" />
// tests/e2e/conta/c02/ficha.spec.ts
//
// C02, tarea 6: la pestaña «Contabilidad» de la ficha de proveedor (maqueta
// N7FichaConta) sobre el plan de la empresa de A, en ordenador y móvil. Lo
// que se cambia en la prueba se quita en la misma prueba. Capturas junto a la
// maqueta (docs/conta/capturas/c02/).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, HERMANOS_RUIZ, entrarComo } from '../sesion'
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
  await expect(saldo.locator('.cx-dato').filter({ hasText: 'Saldo con él' })).toContainText('Sin apuntes todavía')
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

  // El extracto existe y dice claro que aún no hay apuntes (llegan con el C04).
  await saldo.getByRole('button', { name: 'Ver extracto' }).click()
  const ext = page.getByRole('region', { name: 'Extracto' })
  await expect(ext.getByText('Aún no hay apuntes con este proveedor.')).toBeVisible()
  await ext.getByRole('button', { name: 'Saldos por mes' }).click()
  await expect(ext.getByRole('button', { name: 'Saldos por mes' })).toHaveAttribute('aria-pressed', 'true')

  // Las dos tarjetas siguen ahí antes de la captura (no el esqueleto).
  await expect(cuentas.locator('.cx-dato').filter({ hasText: 'Su cuenta' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ficha-contabilidad-${lado(page)}.png`, fullPage: true })
  const flotantes = lado(page) === 'movil' ? [BARRA_FOLVY_MOVIL] : FLOTANTES_CONTA
  expect(await loQueTapan(page, '.cx-incrustado', flotantes)).toEqual([])
})
