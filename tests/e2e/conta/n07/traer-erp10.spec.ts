/// <reference lib="dom" />
// tests/e2e/conta/n07/traer-erp10.spec.ts
//
// N07 · «Traer de ERP10», en el ordenador, CONTRA STAGING DE VERDAD, con los Excel inventados del
// ejemplo de ERP10 (tests/conta/fixtures/importar/erp10: datos inventados que se ven inventados, T11).
// En el carril de la e2e (se clona para el run y se borra al acabar), con la cuenta A y la sesión del
// administrador (la misma RLS que la pantalla, nunca la clave de servicio). CADA PRUEBA CREA SU EMPRESA
// (como C02c): pymes, 8 dígitos y el ejercicio 2026, sin día de inicio ni nada apuntado. Así no depende
// del orden ni de lo que dejó otra (e2e 1504: la empresa de pruebas del carril tenía día de inicio
// 2026-01-01 y el ejemplo, de enero a marzo, no entraba). Al acabar, se deshace lo que quedó en prueba
// y se borra la empresa; si la base no deja borrarla (lo dado por bueno), se queda en el carril.
// Las cuatro:
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
import { CARRIL, CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'

test.skip(CARRIL === null, 'Traer de ERP10 escribe en la empresa de la cuenta A (trae y lo da por bueno): necesita su carril.')
// Sin «serial»: cada prueba prepara su empresa, y si una cae las otras corren igual (e2e 1504).

const DIR = 'docs/conta/capturas/n07'
const NOMBRE = 'Traer ERP10 e2e'
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

/**
 * A 1366 × 768 cabe: la pantalla acaba dentro de la ventana y rueda la tabla (y el panel, si hace falta),
 * no la página. Se mide como «Salida a ERP10» (x06 y x07): el borde de abajo de la pantalla (.cxe), y no
 * lo que rueda la página, que en las builds de prueba lleva además la franja «BUILD LOCAL» (25 px).
 */
async function cabeA1366(page: Page, que: string) {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(300)
  const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo[0], `${que}: a 1366 × 768 la pantalla acaba dentro de la ventana`).toBeLessThanOrEqual(abajo[1])
  await page.setViewportSize({ width: 1456, height: 816 })
  await page.waitForTimeout(300)
}

/** Las cuentas como las dice la tabla «Lo traído» del paso 3: «0 cuentas nuevas (las 16 ya estaban)». */
async function cuentasComoLaTabla(page: Page): Promise<string> {
  const fila = (await page.getByRole('table', { name: 'Lo traído' }).getByRole('row', { name: /^Cuentas/ }).innerText()).replace(/\s+/g, ' ')
  const nuevas = Number(/(\d+) nuevas?/.exec(fila)?.[1] ?? NaN)
  const estaban = /La otra ya estaba/.test(fila) ? 1 : Number(/Las otras (\d+) ya estaban/.exec(fila)?.[1] ?? 0)
  expect(Number.isNaN(nuevas), `la fila de cuentas dice cuántas son nuevas: «${fila}»`).toBe(false)
  const cuentas = `${nuevas} ${nuevas === 1 ? 'cuenta nueva' : 'cuentas nuevas'}`
  if (!estaban) return cuentas
  return `${cuentas} (${nuevas === 0 ? (estaban === 1 ? 'la que había ya estaba' : `las ${estaban} ya estaban`) : (estaban === 1 ? 'la otra ya estaba' : `las otras ${estaban} ya estaban`)})`
}

async function soltar(page: Page, ficheros: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByLabel('Elegir ficheros', { exact: true }).setInputFiles(ficheros)
}

/** Una empresa nueva de la cuenta A, solo para esta prueba: pymes, 8 dígitos y el ejercicio 2026. */
async function crearEmpresa(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `${NOMBRE} ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa de la prueba: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `y su perfil fiscal, pymes y 8 dígitos: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: CUENTA_A.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `y el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const inicio = await rest<string | null>(s, 'POST', 'rpc/conta_empresa_dia_de_inicio', { p_company: id })
  expect(inicio.datos, 'la empresa nueva no tiene día de inicio').toBeNull()
  return id
}

/** Lo que quedó en prueba se deshace y la empresa se borra; si no se deja (lo dado por bueno), se queda en el carril. */
async function limpiar(s: Sesion, id: string) {
  const enPrueba = await rest<{ id: string }[]>(s, 'GET', `import_run?select=id&company_id=eq.${id}&kind=eq.carga&status=eq.en_prueba`)
  for (const c of enPrueba.datos ?? []) await rest(s, 'POST', 'rpc/conta_traer_deshacer', { p_carga: c.id, p_quien_nombre: 'Prueba e2e N07' })
  const b = await rest<unknown>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (b.status >= 300) console.log(`[N07] la empresa ${id} se queda en el carril (${b.status}): ${JSON.stringify(b.datos).slice(0, 200)}`)
}

let s: Sesion
let empresa: string

test.beforeEach(async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo N07).')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  s = await entrarComo(page, CUENTA_A.email)
  empresa = await crearEmpresa(s, info.title.slice(6, 7))
  // La pantalla abre la empresa elegida, que se guarda por cuenta en el navegador (como C02c).
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
})

test.afterEach(async () => {
  if (empresa) await limpiar(s, empresa)
})

test('N07 · 1 · solo cuentas y proveedores: soltar, ver, traer, darlo por bueno; la recibida sin proveedor lo encuentra', async ({ page }) => {
  const errores = vigilar(page)
  // Lo que la pantalla no crea sola: una recibida que entró por correo sin proveedor, con el NIF inventado del 40000001 del ejemplo.
  const r = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: empresa, invoice_number: `N07-SIN-${Date.now() % 100000}`, invoice_date: '2026-11-10', status: 'en_revision',
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
  await expect(page.getByText('Solo has traído las cuentas y los proveedores. No hay saldos que comparar.')).toBeVisible({ timeout: 60_000 })
  // Las frases dicen las cuentas como la tabla «Lo traído» (las nuevas, y las que ya estaban).
  const que = `${await cuentasComoLaTabla(page)}, 4 proveedores y 1 cliente`
  // La confirmación de «Traerlo» (regla 8) es la línea del paso 3: «Traído en prueba el … por …: …» (e2e 1496).
  await expect(page.getByText(`: ${que}. Lo traído no se puede pagar ni cobrar hasta darlo por bueno.`)).toBeVisible()
  await page.screenshot({ path: `${DIR}/solo-cuentas-paso3.png` })
  await cabeA1366(page, 'solo cuentas · paso 3')

  await page.getByRole('button', { name: 'Darlo por bueno' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Darlo por bueno' })
  await expect(dialogo).toContainText(`Vas a dar por bueno lo traído de ERP10: ${que}. Después ya no se podrá deshacer.`)
  const [b1, b2] = [dialogo.getByRole('button', { name: 'Darlo por bueno' }), dialogo.getByRole('button', { name: 'Todavía no' })]
  expect((await b1.boundingBox())?.width, 'los dos botones del mismo tamaño').toBe((await b2.boundingBox())?.width)
  await b1.click()
  // La confirmación de «Darlo por bueno»: lo que enseña después, arriba del paso 1, leído de la base.
  const dado = page.getByRole('status').filter({ hasText: /^Dado por bueno el \d\d\/\d\d a las \d\d:\d\d por / })
  await expect(dado).toContainText(`Lo traído de ERP10 ya es parte de tu contabilidad: ${que}. 1 factura que había entrado sin proveedor ya lo tiene.`, { timeout: 60_000 })
  await expect(dado).toContainText('La primera factura de cada proveedor te pedirá a qué cuenta de gasto va: ERP10 no la da en su listado.')
  const f = await rest<{ supplier_id: string | null }[]>(s, 'GET', `supplier_invoice?select=supplier_id&id=eq.${sinProveedor}`)
  expect(f.datos[0]?.supplier_id, 'la recibida sin proveedor ya lo tiene').not.toBeNull()
  expect(errores).toEqual([])
})

test('N07 · 2 · deshacer lo traído en prueba', async ({ page }) => {
  const errores = vigilar(page)
  await page.goto(RUTA, { waitUntil: 'load' })
  await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
  await soltar(page, TODOS.map(fichero))
  await page.getByRole('button', { name: 'Ver lo que entra' }).click()
  await expect(page.getByRole('table', { name: 'Qué entra' }).getByRole('row', { name: /Asientos/ })).toContainText('11.499,00', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Traerlo' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Traído en prueba el .*: 10 asientos y 5 facturas\. Lo traído no se puede pagar ni cobrar hasta darlo por bueno\.$/ })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Deshacer el traspaso' }).first().click()
  const dialogo = page.getByRole('dialog', { name: 'Deshacer el traspaso' })
  await dialogo.getByRole('button', { name: 'Deshacer el traspaso' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Deshecho el .*: se ha quitado todo lo traído \(10 asientos, 5 facturas, .*\)\. La empresa queda como estaba antes de traerlo\.$/ })).toBeVisible({ timeout: 60_000 })
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
  await expect(page.getByRole('status').filter({ hasText: /^Deshecho el .*: se ha quitado todo lo traído/ })).toBeVisible({ timeout: 60_000 })
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
  await expect(page.getByRole('status').filter({ hasText: /^Dado por bueno el .*\. 10 asientos de antes del .* ya están en tu contabilidad, y 3 facturas pendientes han pasado: 2 a Pagos y 1 a Cobros\.$/ })).toBeVisible({ timeout: 90_000 })
  expect(errores).toEqual([])
})
