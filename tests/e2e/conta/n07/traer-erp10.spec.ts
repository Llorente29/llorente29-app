/// <reference lib="dom" />
// tests/e2e/conta/n07/traer-erp10.spec.ts
//
// N07 · «Traer de ERP10», en el ordenador, CONTRA STAGING DE VERDAD, con los Excel inventados del
// ejemplo de ERP10 (tests/conta/fixtures/importar/erp10: datos inventados que se ven inventados, T11).
// En el carril de la e2e (se clona para el run y se borra al acabar: darlo por bueno de verdad no deja
// nada para la siguiente), con la cuenta A, su empresa de pruebas y la sesión del administrador (la
// misma RLS que la pantalla, nunca la clave de servicio). En orden, porque cada uno deja la empresa
// como la necesita el siguiente:
//   1. Solo cuentas y proveedores: soltar el plan y los dos listados, ver, traer, «Solo has traído las
//      cuentas y los proveedores. No hay saldos que comparar.», darlo por bueno, y una recibida que
//      entró sin proveedor (preparada por la API) lo encuentra por su NIF.
//   2. Deshacer una carga en prueba: el ejemplo entero, traer, «Deshacer el traspaso».
//   3. Con un sumas y saldos que no cuadra (el del ejemplo con 10,00 más al debe de la 57200001): no
//      deja darlo por bueno, y enseña la cuenta. Se deshace.
//   4. El ejemplo entero: soltar, ver, traer, comparar (cuadra), darlo por bueno.
// A 1456 × 816 (las capturas) y a 1366 × 768 (que la página no ruede: rueda la tabla).
// Navegador en español (playwright.config.ts).

import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { CARRIL, CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'Traer de ERP10 escribe en la empresa de la cuenta A (trae y lo da por bueno): necesita su carril.')
test.describe.configure({ mode: 'serial' })

const DIR = 'docs/conta/capturas/n07'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const FIX = 'tests/conta/fixtures/importar/erp10'
const RUTA = '/conta/libros/diario/traer-erp10'
const fichero = (nombre: string) => ({ name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(`${FIX}/${nombre}`) })
const TODOS = readdirSync(FIX).filter((f) => f.endsWith('.xlsx') && f !== 'inmovilizado.xlsx').sort()
const SOLO_PLAN = ['plan_de_cuentas.xlsx', 'proveedores.xlsx', 'clientes.xlsx']

/** El sumas y saldos del ejemplo con 10,00 más al debe de la 57200001: no cuadra con el diario. */
function sumasQueNoCuadra() {
  const wb = XLSX.read(readFileSync(`${FIX}/sumas_y_saldos.xlsx`))
  const h = wb.Sheets[wb.SheetNames[0]]
  const rango = XLSX.utils.decode_range(h['!ref'] as string)
  for (let r = rango.s.r; r <= rango.e.r; r++) {
    const a = h[XLSX.utils.encode_cell({ r, c: 0 })]
    if (String(a?.v ?? '').trim() !== '57200001') continue
    const d = h[XLSX.utils.encode_cell({ r, c: 3 })]
    d.v = Number(d.v) + 10; delete d.w
    return { name: 'sumas_y_saldos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })) }
  }
  throw new Error('El sumas y saldos del ejemplo no tiene la 57200001.')
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** A 1366 × 768 la página no rueda: rueda la tabla (y el panel, si hace falta). */
async function cabeA1366(page: Page, que: string) {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(300)
  const rueda = await page.evaluate(() => (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight)
  expect(rueda, `${que}: a 1366 × 768 la página no rueda`).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 1456, height: 816 })
  await page.waitForTimeout(300)
}

async function soltar(page: Page, ficheros: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByLabel('Elegir ficheros', { exact: true }).setInputFiles(ficheros)
}

let s: Sesion

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo N07).')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  s = await entrarComo(page, CUENTA_A.email)
})

test('N07 · 1 · solo cuentas y proveedores: soltar, ver, traer, darlo por bueno; la recibida sin proveedor lo encuentra', async ({ page }) => {
  const errores = vigilar(page)
  // Lo que la pantalla no crea sola: una recibida que entró por correo sin proveedor, con el NIF inventado del 40000001 del ejemplo.
  const r = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, invoice_number: `N07-SIN-${Date.now() % 100000}`, invoice_date: '2026-11-10', status: 'en_revision',
    source: 'ocr', grand_total: 121, tax_base_total: 100, tax_total: 21, created_by_name: 'Prueba e2e N07',
    reading: { factura: { proveedor: { nif: 'B00000000', nombre: 'Proveedor Ejemplo Uno' } } },
  })
  expect(r.status, `crear la recibida sin proveedor: ${JSON.stringify(r.datos).slice(0, 200)}`).toBeLessThan(300)
  const sinProveedor = r.datos[0].id

  await page.goto(RUTA, { waitUntil: 'load' })
  await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
  await soltar(page, SOLO_PLAN.map(fichero))
  const tabla = page.getByRole('table', { name: 'Los ficheros' })
  await expect(tabla.getByRole('row', { name: /Plan de cuentas/ })).toContainText('16 cuentas')
  await expect(tabla.getByRole('row', { name: /Proveedores/ })).toContainText('Mira esto')
  await expect(tabla.getByRole('row', { name: /Diario/ })).toContainText('Falta')
  await expect(tabla).toContainText('Todavía no se trae por aquí: el inmovilizado, los PDF de las facturas y los 303 presentados.')
  await page.screenshot({ path: `${DIR}/solo-cuentas-paso1.png` })
  await cabeA1366(page, 'solo cuentas · paso 1')

  await page.getByRole('button', { name: 'Ver lo que entra' }).click()
  const entra = page.getByRole('table', { name: 'Qué entra' })
  await expect(entra.getByRole('row', { name: /Cuentas/ })).toBeVisible({ timeout: 30_000 })
  await expect(entra.getByRole('row', { name: /Asientos/ })).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/solo-cuentas-paso2.png` })
  await cabeA1366(page, 'solo cuentas · paso 2')

  await page.getByRole('button', { name: 'Traerlo' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'He traído 16 cuentas, 4 proveedores y 1 cliente.' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Solo has traído las cuentas y los proveedores. No hay saldos que comparar.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/^Traído en prueba el .*: 16 cuentas, 4 proveedores y 1 cliente\. Lo traído no se puede pagar ni cobrar hasta darlo por bueno\.$/)).toBeVisible()
  await page.screenshot({ path: `${DIR}/solo-cuentas-paso3.png` })
  await cabeA1366(page, 'solo cuentas · paso 3')

  await page.getByRole('button', { name: 'Darlo por bueno' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Darlo por bueno' })
  await expect(dialogo).toContainText('Vas a dar por bueno lo traído de ERP10: 16 cuentas, 4 proveedores y 1 cliente. Después ya no se podrá deshacer.')
  const [b1, b2] = [dialogo.getByRole('button', { name: 'Darlo por bueno' }), dialogo.getByRole('button', { name: 'Todavía no' })]
  expect((await b1.boundingBox())?.width, 'los dos botones del mismo tamaño').toBe((await b2.boundingBox())?.width)
  await b1.click()
  await expect(page.getByText(/^Hecho\. Lo traído de ERP10 ya es parte de tu contabilidad: 16 cuentas, 4 proveedores y 1 cliente\. 1 factura que había entrado sin proveedor ya lo tiene\.$/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('La primera factura de cada proveedor te pedirá a qué cuenta de gasto va: ERP10 no la da en su listado.')).toBeVisible()
  const f = await rest<{ supplier_id: string | null }[]>(s, 'GET', `supplier_invoice?select=supplier_id&id=eq.${sinProveedor}`)
  expect(f.datos[0]?.supplier_id, 'la recibida sin proveedor ya lo tiene').not.toBeNull()
  expect(errores).toEqual([])
})

test('N07 · 2 · deshacer lo traído en prueba', async ({ page }) => {
  const errores = vigilar(page)
  const inicio = await rest<string | null>(s, 'POST', 'rpc/conta_empresa_dia_de_inicio', { p_company: EMPRESA_A })
  expect(inicio.datos === null || inicio.datos > '2026-03-31', `la empresa de pruebas tiene día de inicio ${inicio.datos}: el ejemplo (enero a marzo de 2026) no entraría entero`).toBe(true)
  await page.goto(RUTA, { waitUntil: 'load' })
  await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
  await soltar(page, TODOS.map(fichero))
  await page.getByRole('button', { name: 'Ver lo que entra' }).click()
  await expect(page.getByRole('table', { name: 'Qué entra' }).getByRole('row', { name: /Asientos/ })).toContainText('11.499,00', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Traerlo' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Traído en prueba: 10 asientos \(26 apuntes, 11\.499,00 al debe y al haber\)/ })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Deshacer el traspaso' }).first().click()
  const dialogo = page.getByRole('dialog', { name: 'Deshacer el traspaso' })
  await dialogo.getByRole('button', { name: 'Deshacer el traspaso' }).click()
  await expect(page.getByText(/^Deshecho: se han quitado 10 asientos, 5 facturas/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Ver lo que entra' })).toBeVisible()
  expect(errores).toEqual([])
})

test('N07 · 3 · con un sumas y saldos que no cuadra no deja, y enseña la cuenta', async ({ page }) => {
  const errores = vigilar(page)
  await page.goto(RUTA, { waitUntil: 'load' })
  await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
  await soltar(page, [...TODOS.filter((x) => x !== 'sumas_y_saldos.xlsx').map(fichero), sumasQueNoCuadra()])
  await expect(page.getByRole('table', { name: 'Los ficheros' }).getByRole('row', { name: /Sumas y saldos/ })).toContainText('no cuadran con el diario')
  await page.getByRole('button', { name: 'Ver lo que entra' }).click()
  await page.getByRole('button', { name: 'Traerlo' }).click()
  await expect(page.getByText('1 cuenta con diferencia', { exact: true })).toBeVisible({ timeout: 60_000 })
  const fila = page.getByRole('table', { name: 'Cuenta a cuenta' }).getByRole('row', { name: /57200001/ })
  await expect(fila).toContainText('4.426,00')
  await expect(fila).toContainText('4.416,00')
  await expect(fila).toContainText('-10,00')
  await expect(page.getByRole('button', { name: 'Darlo por bueno' })).toBeDisabled()
  await expect(page.getByRole('alert').filter({ hasText: 'No cuadra con el sumas y saldos de ERP10 en 1 cuenta. Míralas antes de darlo por bueno.' })).toBeVisible()
  await page.screenshot({ path: `${DIR}/no-cuadra.png` })
  await cabeA1366(page, 'no cuadra')
  await page.getByRole('button', { name: 'Deshacer el traspaso' }).first().click()
  await page.getByRole('dialog', { name: 'Deshacer el traspaso' }).getByRole('button', { name: 'Deshacer el traspaso' }).click()
  await expect(page.getByText(/^Deshecho:/)).toBeVisible({ timeout: 60_000 })
  expect(errores).toEqual([])
})

test('N07 · 4 · el ejemplo entero: soltar, ver, traer, comparar (cuadra) y darlo por bueno', async ({ page }) => {
  const errores = vigilar(page)
  await page.goto(RUTA, { waitUntil: 'load' })
  await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
  await soltar(page, TODOS.map(fichero))
  const tabla = page.getByRole('table', { name: 'Los ficheros' })
  await expect(tabla.getByRole('row', { name: /Diario/ })).toContainText('10 asientos · 26 apuntes')
  await expect(tabla.getByRole('row', { name: /Sumas y saldos/ })).toContainText('Cuadra con el diario')
  await expect(page.getByRole('list', { name: 'Comprobaciones' })).toContainText('Todos los asientos cuadran')
  await page.screenshot({ path: `${DIR}/entero-paso1.png` })
  await cabeA1366(page, 'entero · paso 1')

  await page.getByRole('button', { name: 'Ver lo que entra' }).click()
  const entra = page.getByRole('table', { name: 'Qué entra' })
  await expect(entra.getByRole('row', { name: /Asientos/ })).toContainText('11.499,00', { timeout: 30_000 })
  await expect(entra.getByRole('row', { name: /Por pagar y por cobrar/ })).toContainText('1.911,00')
  await page.screenshot({ path: `${DIR}/entero-paso2.png` })
  await cabeA1366(page, 'entero · paso 2')

  await page.getByRole('button', { name: 'Traerlo' }).click()
  await expect(page.getByText('Cuadra con el sumas y saldos', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('table', { name: 'Cuenta a cuenta' })).toContainText('15 cuentas quedan igual')
  await expect(page.getByText(/Si alguna factura quedó pagada a medias en ERP10, aquí sale como pendiente entera\. Revísalas en Pagos\./)).toBeVisible()
  await page.screenshot({ path: `${DIR}/entero-paso3.png` })
  await cabeA1366(page, 'entero · paso 3')

  await page.getByRole('button', { name: 'Darlo por bueno' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Darlo por bueno' })
  await expect(dialogo).toContainText('Vas a dar por bueno lo traído de ERP10: 10 asientos y 5 facturas, hasta el 31/03/2026. Cuadra con el sumas y saldos. Después ya no se podrá deshacer.')
  await dialogo.getByRole('button', { name: 'Darlo por bueno' }).click()
  await expect(page.getByText(/^Hecho\. 10 asientos de antes del .* ya están en tu contabilidad, y 3 facturas pendientes han pasado: 2 a Pagos y 1 a Cobros\.$/)).toBeVisible({ timeout: 90_000 })
  expect(errores).toEqual([])
})
