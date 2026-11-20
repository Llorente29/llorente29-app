/// <reference lib="dom" />
// tests/e2e/conta/n09/pagadas.spec.ts
//
// N09 · Las facturas con pago parcial en ERP10: al traer, cada factura entra con lo que de verdad le
// queda, casando los pagos del diario con sus facturas (src/modules/conta/lib/traer/casarPagos.ts). En
// el ordenador, CONTRA STAGING DE VERDAD, con los Excel inventados del ejemplo de ERP10 del N04
// (tests/conta/fixtures/importar/erp10, T11), en el carril de la e2e y con la sesión del administrador
// de la cuenta A. Cada prueba crea su empresa (como el N07) y al acabar se deshace lo traído y se borra.
// Con los números de las recibidas cambiados (A-10 → N9A-10, B-7 → N9B-7, ALQ-3 → N9ALQ-3, en el libro y
// en los conceptos del diario), e2e 1549: el proveedor es de la cuenta, y una recibida que ya está en la
// cuenta con el mismo proveedor, número e importe no se trae otra vez. La prueba 4 del N07 da por bueno
// este mismo ejemplo en la cuenta A, en una empresa que se queda en el carril, y después entraban «10
// asientos y 2 facturas». Con otro número no coinciden; las cifras y las frases son las mismas.
// Las dos:
//   1. El ejemplo entero: el paso 3 dice «2 pagadas o cobradas y 3 pendientes» y que cuadra con el sumas
//      y saldos; en la base, lo que le queda a cada recibida (A-10 a 0, B-7 341,00 y ALQ-3 1.020,00, sin
//      la retención). Deshacer las quita todas.
//   2. Con un pago que no casa («Pago a cuenta» de 50,00 a la 40000002, en el diario y en el sumas y
//      saldos): «1 factura con pagos que no he podido casar: míralas.» con su frase; la B-7 entra
//      pendiente entera. Deshacer.

import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { CARRIL, CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'

test.skip(CARRIL === null, 'Traer de ERP10 escribe en una empresa de la cuenta A: necesita su carril.')

const NOMBRE = 'Pagadas N09 e2e'
const FIX = 'tests/conta/fixtures/importar/erp10'
const RUTA = '/conta/libros/diario/traer-erp10'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const fichero = (nombre: string) => ({ name: nombre, mimeType: XLSX_MIME, buffer: readFileSync(`${FIX}/${nombre}`) })
const TODOS = readdirSync(FIX).filter((f) => f.endsWith('.xlsx') && f !== 'inmovilizado.xlsx').sort()

/** Excel con la hoja cambiada por `cambiar`, en el mismo formato que lo saca ERP10. */
function cambiado(nombre: string, cambiar: (filas: unknown[][]) => unknown[][]) {
  // Celda a celda sobre la hoja de ERP10, con el formato de cada columna (la fecha es un número con
  // formato de fecha: rehacer la hoja entera lo pierde y el lector ya no la ve como fecha).
  const wb = XLSX.read(readFileSync(`${FIX}/${nombre}`), { cellNF: true })
  const h = wb.Sheets[wb.SheetNames[0]]
  const filas = XLSX.utils.sheet_to_json<unknown[]>(h, { header: 1, raw: true, defval: null, blankrows: true })
  const nuevas = cambiar(filas)
  const rango = XLSX.utils.decode_range(h['!ref'] as string)
  const modelo = rango.e.r
  nuevas.forEach((fila, r) => fila.forEach((v, c) => {
    const ref = XLSX.utils.encode_cell({ r, c })
    if (v === (filas[r]?.[c] ?? null)) return
    if (v === null) { delete h[ref]; return }
    const como = h[ref] ?? h[XLSX.utils.encode_cell({ r: modelo, c })]
    h[ref] = { ...(como ?? {}), t: typeof v === 'number' ? 'n' : 's', v } as XLSX.CellObject
    delete (h[ref] as { w?: string }).w
  }))
  rango.e.r = Math.max(rango.e.r, nuevas.length - 1)
  h['!ref'] = XLSX.utils.encode_range(rango)
  return { name: nombre, mimeType: XLSX_MIME, buffer: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })) }
}

/** Los números de las recibidas del ejemplo, con «N9» delante (ver la cabecera). */
const PROPIO = (x: unknown) => (typeof x === 'string' ? x.replace(/(^|[^A-Za-z0-9])(A-10|B-7|ALQ-3)(?=$|[^A-Za-z0-9])/g, '$1N9$2') : x)
const conNumerosPropios = (nombre: string, cambiar: (filas: unknown[][]) => unknown[][] = (f) => f) =>
  cambiado(nombre, (f) => cambiar(f).map((fila) => fila.map(PROPIO)))

/** El ejemplo entero, con los números propios. */
function elEjemplo(diario = conNumerosPropios('diario.xlsx'), sumas = fichero('sumas_y_saldos.xlsx')) {
  return [...TODOS.filter((x) => !['diario.xlsx', 'sumas_y_saldos.xlsx', 'libro_recibidas.xlsx'].includes(x)).map(fichero), conNumerosPropios('libro_recibidas.xlsx'), diario, sumas]
}

/**
 * El ejemplo con un pago más a la 40000002 que no nombra ninguna factura y no es lo que le queda a
 * ninguna: «Pago a cuenta» de 50,00 el 04/03/2026 (46085 en Excel), contra el banco. En el diario, su
 * asiento; en el sumas y saldos, 50,00 más al debe de la 40000002 y al haber de la 57200001, para que
 * siga cuadrando con el diario.
 */
function conPagoACuenta() {
  const diario = conNumerosPropios('diario.xlsx', (f) => [...f,
    ['3.6', 46085, '0', null, '40000002', 'Proveedor Ejemplo Dos, S.A.', 'Pago a cuenta', 50, 0],
    ['3.6', 46085, '0', null, '57200001', 'Banco de ejemplo', 'Pago a cuenta', 0, 50]])
  const sumas = cambiado('sumas_y_saldos.xlsx', (f) => f.map((x) => {
    const c = String(x[0] ?? '').trim()
    if (c === '40000002') return [x[0], x[1], x[2], 50, x[4], 0, 291]
    if (c === '57200001') return [x[0], x[1], x[2], x[3], 1734, 4366, 0]
    if (x[2] === 'TOTALES:') return [x[0], x[1], x[2], 11549, 11549, 8181, 8181]
    return x
  }))
  return elEjemplo(diario, sumas)
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Una empresa nueva de la cuenta A, solo para esta prueba: pymes, 8 dígitos y el ejercicio 2026 (como el N07). */
async function crearEmpresa(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `${NOMBRE} ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa de la prueba: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `y su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: CUENTA_A.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `y el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  return id
}

async function limpiar(s: Sesion, id: string) {
  const enPrueba = await rest<{ id: string }[]>(s, 'GET', `import_run?select=id&company_id=eq.${id}&kind=eq.carga&status=eq.en_prueba`)
  for (const c of enPrueba.datos ?? []) await rest(s, 'POST', 'rpc/conta_traer_deshacer', { p_carga: c.id, p_quien_nombre: 'Prueba e2e N09' })
  const b = await rest<unknown>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (b.status >= 300) console.log(`[N09] la empresa ${id} se queda en el carril (${b.status}): ${JSON.stringify(b.datos).slice(0, 200)}`)
}

/** Lo que le queda a cada recibida traída a esta empresa, de la base (import_pending), por número. */
async function pendienteDeLasRecibidas(s: Sesion, id: string): Promise<Record<string, number>> {
  const r = await rest<{ invoice_number: string; import_pending: number | null }[]>(s, 'GET',
    `supplier_invoice?select=invoice_number,import_pending&account_id=eq.${CUENTA_A.id}&company_id=eq.${id}&source=eq.traida&order=invoice_number`)
  expect(r.status, `leer las recibidas traídas: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(200)
  return Object.fromEntries(r.datos.map((x) => [x.invoice_number, Number(x.import_pending)]))
}

async function traer(page: Page, ficheros: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto(RUTA, { waitUntil: 'load' })
  await expect(page.locator('h1#cxt-titulo')).toHaveText('Traer de ERP10', { timeout: 40_000 })
  await page.getByLabel('Elegir ficheros', { exact: true }).setInputFiles(ficheros)
  await expect(page.getByRole('table', { name: 'Los ficheros' }).getByRole('row', { name: /Sumas y saldos/ })).toContainText('Cuadra con el diario')
  await page.getByRole('button', { name: 'Ver lo que entra' }).click()
  await expect(page.getByRole('table', { name: 'Qué entra' }).getByRole('row', { name: /Asientos/ })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Traerlo' }).click()
  await expect(page.getByText('Cuadra con el sumas y saldos', { exact: true })).toBeVisible({ timeout: 60_000 })
}

async function deshacer(page: Page) {
  await page.getByRole('button', { name: 'Deshacer el traspaso' }).first().click()
  await page.getByRole('dialog', { name: 'Deshacer el traspaso' }).getByRole('button', { name: 'Deshacer el traspaso' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Deshecho el .*: se ha quitado todo lo traído/ })).toBeVisible({ timeout: 60_000 })
}

let s: Sesion
let empresa: string

test.beforeEach(async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (la pantalla del N07).')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  s = await entrarComo(page, CUENTA_A.email)
  empresa = await crearEmpresa(s, info.title.slice(6, 7))
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
})

test.afterEach(async () => {
  if (empresa) await limpiar(s, empresa)
})

test('N09 · 1 · el ejemplo entero: 2 pagadas y 3 pendientes, cuadra con el sumas y saldos, y Deshacer lo quita', async ({ page }) => {
  const errores = vigilar(page)
  await traer(page, elEjemplo())
  await expect(page.getByText('Pagadas y cobradas: 2 pagadas o cobradas y 3 pendientes. Lo que le queda a cada proveedor y cliente da igual que su saldo en ERP10.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/que no he podido casar/)).toHaveCount(0)
  // En la base: lo que le queda a cada recibida, casado con sus pagos (ALQ-3, sin la retención de 190,00).
  expect(await pendienteDeLasRecibidas(s, empresa)).toEqual({ 'N9A-10': 0, 'N9ALQ-3': 1020, 'N9B-7': 341 })
  // Y lo pendiente de cada proveedor da su saldo del sumas y saldos: 40000001 a 0, 40000002 341,00 y 41000001 1.020,00.
  await deshacer(page)
  expect(await pendienteDeLasRecibidas(s, empresa), 'Deshacer quita las recibidas traídas').toEqual({})
  expect(errores).toEqual([])
})

test('N09 · 2 · un pago que no casa: la B-7 entra pendiente entera, marcada, y el paso 3 lo cuenta', async ({ page }) => {
  const errores = vigilar(page)
  await traer(page, conPagoACuenta())
  const aviso = page.getByRole('note').filter({ hasText: '1 factura con pagos que no he podido casar: míralas.' })
  await expect(aviso).toBeVisible({ timeout: 30_000 })
  await expect(aviso.getByRole('listitem')).toHaveText(['40000002 · Proveedor Ejemplo Dos, S.A.: un pago que no he podido casar (50,00 del 04/03/2026: no nombra ninguna factura suya y no es lo que le queda a ninguna); y lo que le queda por pagar de sus facturas, 341,00, no da igual que su saldo en el sumas y saldos, 291,00. Míralas.'])
  expect(await pendienteDeLasRecibidas(s, empresa)).toEqual({ 'N9A-10': 0, 'N9ALQ-3': 1020, 'N9B-7': 341 })
  await deshacer(page)
  expect(await pendienteDeLasRecibidas(s, empresa), 'Deshacer quita las recibidas traídas').toEqual({})
  expect(errores).toEqual([])
})
