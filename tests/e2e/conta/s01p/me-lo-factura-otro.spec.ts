// tests/e2e/conta/s01p/me-lo-factura-otro.spec.ts
//
// S01p·20·2 (Julio, 13/11) · «Cómo te factura» de un proveedor de la cuenta A, en el ordenador y en
// el móvil: la opción «Me lo factura otro», con quién (un contacto de Compras), y al guardar dice qué
// ha hecho (regla 8). La pantalla lee de verdad la ficha y los contactos (la columna
// supplier.invoiced_by_supplier_id es de la 1910, que solo añade y staging aplica desde la rama);
// lo que guarda (compras_lo_factura_otro) está SIMULADO en el navegador con la forma que devuelve,
// para no cambiar la ficha de staging. Lo que pasa en la base lo prueba
// supabase/staging/sql/20261113_s01p_me_lo_factura_otro_prueba.sql. Nombres inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'

const DIR = 'docs/conta/capturas/s01p20'
const VERDURAS = enCarril('c0c00000-0000-4000-8000-000000000001')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })

test('Me lo factura otro: la opción, con quién, y al guardar lo dice', async ({ page }) => {
  test.setTimeout(90_000)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  let pedido: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/compras_lo_factura_otro\b/, (r) => {
    pedido = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      proveedor: VERDURAS, otro: pedido.p_otro, otro_nombre: 'El que factura', recepciones: 1,
      mensaje: 'Guardado: lo de Verduras del Huerto Prueba, S.L. lo factura El que factura en su factura de género. No espero ninguna factura de Verduras del Huerto Prueba, S.L. He vuelto a mirar su recepción abierta.',
    }) })
  })
  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/conta/clientes-y-proveedores/proveedor/${VERDURAS}/como-te-factura`)

  const grupo = page.getByRole('radiogroup', { name: 'Cómo te factura' })
  await expect(grupo.getByRole('radio')).toHaveCount(4, { timeout: 30_000 })
  const otro = grupo.getByRole('radio', { name: /Me lo factura otro/ })
  await otro.click()
  await expect(otro).toBeChecked()
  const quien = page.locator('[data-prueba="lo-factura-quien"]')
  await expect(quien).toBeVisible()
  // Sin elegir quién, no se guarda.
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  // Los contactos de Compras de la cuenta, sin él mismo.
  const opciones = quien.locator('option')
  expect(await opciones.count()).toBeGreaterThan(1)
  await expect(quien.locator('option', { hasText: 'Verduras del Huerto Prueba' })).toHaveCount(0)
  const elegido = await opciones.nth(1).getAttribute('value')
  await quien.selectOption(elegido ?? '')
  await foto(page, 'me-lo-factura-otro')

  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText(/^Guardado: lo de Verduras del Huerto Prueba, S\.L\. lo factura El que factura en su factura de género\./)).toBeVisible({ timeout: 20_000 })
  expect(pedido).toMatchObject({ p_proveedor: VERDURAS, p_otro: elegido })
  // Ya guardado: es la de su ficha, y no hay «cuándo llegan sus facturas».
  await expect(grupo.getByText('La de su ficha')).toBeVisible()
  await expect(page.locator('[data-prueba="cuando-llegan"]')).toHaveCount(0)
  await foto(page, 'me-lo-factura-otro-guardado')
  expect(errores, 'errores de la página').toEqual([])
})
