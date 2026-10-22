/// <reference lib="dom" />
// tests/e2e/conta/c06/diezTodo.spec.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10), en ordenador y móvil,
// como administrador de A, con sus capturas en docs/conta/capturas/c06c/.
//
//   1. Ajustes › Ejercicio › «Enviar a Diez»: sin conexión con Diez no se
//      enciende, y lo dice (la base de verdad: A no tiene conexión); con ella,
//      se enciende y dice qué ha hecho.
//   2. Encendido: junto al número, «En Diez · 9/5» (la nómina) o «No enviado ·
//      motivo · Reintentar» (el contraasiento); «Reintentar» dice lo que ha
//      pasado; y el libro con su columna de Diez.
//   3. Apagado (como está A en staging): ni una palabra de Diez.
//
// Lo que NO hace, a propósito: escribir en Diez ni en staging. A comparte la
// cuenta con otros frentes: el estado de Diez lo da la RED (Playwright contesta
// conta_diez_envio_empresa, external_send, conta_diez_envio_poner y
// conta-diez-enviar), sobre asientos de A que ya existen. El camino de la base
// lo prueba la de staging (20261201_c07_diez_todo_prueba.sql) y el envío,
// tests/conta/diez/apunte.test.ts, freno a freno. Todo inventado.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c06c'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  mkdirSync(DIR, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
}
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

function filaDe(page: Page, nombre: RegExp) {
  return lado(page) === 'ordenador'
    ? page.getByRole('grid', { name: 'Asientos del libro diario' }).getByRole('row', { name: nombre })
    : page.getByRole('list', { name: 'Asientos del libro diario' }).getByRole('button', { name: nombre })
}
async function abrirAsiento(page: Page, concepto: RegExp): Promise<string> {
  await page.goto('/conta/libros/diario')
  await filaDe(page, concepto).first().click()
  if (lado(page) === 'ordenador') await page.getByRole('link', { name: 'Abrir el asiento' }).click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\/[0-9a-f-]{36}/)
  return page.url().match(/([0-9a-f-]{36})(?:\?|$)/)![1]
}

type Envio = { status: string; ext_series: string | null; ext_number: number | null; attempts: number; last_error: string | null; next_try_at: string | null }
/** «Enviar a Diez» encendido y los envíos de unos asientos, por la red (los demás, sin envío). */
async function porLaRed(page: Page, envios: Map<string, Envio>) {
  await page.route(/\/rest\/v1\/conta_diez_envio_empresa\?/, (r) => json(r, { enviar: true, desde: '2026-09-01', cambiado_por_nombre: 'Admin Norte', cambiado_en: '2026-10-22T08:00:00Z' }))
  await page.route(/\/rest\/v1\/conta_diez_base\?/, (r) => json(r, { company_id: 'empresa-de-la-prueba' }))
  await page.route(/\/rest\/v1\/external_send\?/, (r) => {
    if (r.request().method() === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range', 'access-control-allow-origin': '*' }, body: '' })
    const pedidos = decodeURIComponent(r.request().url()).match(/entry_id=in\.\(([^)]*)\)/)?.[1].split(',').map((x) => x.replace(/"/g, '')) ?? []
    return json(r, pedidos.filter((id) => envios.has(id)).map((id) => ({
      entry_id: id, ext_invoice_number: null, document_status: null, document_error: null, ...envios.get(id)!,
    })))
  })
}

test('A · Ajustes › «Enviar a Diez»: sin conexión no se enciende y lo dice; con ella, se enciende y dice qué ha hecho', async ({ page }) => {
  // A trabaja con Diez (la red lo dice) y aún no tiene interruptor: apagado.
  let encendido = false
  await page.route(/\/rest\/v1\/conta_diez_base\?/, (r) => json(r, { company_id: 'empresa-de-la-prueba' }))
  await page.route(/\/rest\/v1\/conta_diez_envio_empresa\?/, (r) => (encendido
    ? json(r, { enviar: true, desde: '2026-10-22', cambiado_por_nombre: 'Admin Norte', cambiado_en: '2026-10-22T08:00:00Z' })
    : json(r, null)))
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/ejercicio')
  const tarjeta = page.getByRole('region', { name: 'Enviar a Diez' })
  await expect(tarjeta).toBeVisible()
  const llave = tarjeta.getByRole('switch')
  await expect(llave).not.toBeChecked()
  await expect(tarjeta.getByText(/^Apagado$/)).toBeVisible()
  await expect(tarjeta.getByText(/No se envía nada a Diez y las pantallas no hablan de Diez/)).toBeVisible()

  // 1 · La base de verdad: A no tiene conexión con Diez, así que no se enciende, y se dice por qué.
  await llave.click()
  await expect(tarjeta.getByRole('alert')).toHaveText(/^No se ha cambiado: .*no está conectada con Diez/)
  await expect(llave).not.toBeChecked()

  // 2 · Con la conexión (la red contesta como la base): encendido, y lo que ha hecho.
  await page.route(/\/rest\/v1\/rpc\/conta_diez_envio_poner/, (r) => {
    encendido = true
    return json(r, { enviar: true, desde: '2026-10-22', sin_enviar: 2, texto: 'Encendido: todo lo que se valide sale solo a Diez. 2 asientos validados desde el 22/10/2026 salen ahora.' })
  })
  await llave.click()
  await expect(tarjeta.getByRole('status')).toHaveText('Encendido: todo lo que se valide sale solo a Diez. 2 asientos validados desde el 22/10/2026 salen ahora.')
  await expect(llave).toBeChecked()
  await expect(tarjeta.getByText(/Todo asiento que se valide sale solo a Diez: ventas, banco, facturas recibidas, manuales, liquidaciones y sus anulaciones/)).toBeVisible()
  await expect(tarjeta.getByText(/^Lo cambió Admin Norte el /)).toBeVisible()
  await capturar(page, 'ajustes-enviar-diez')
})

test('A · encendido: junto al número, «En Diez · 9/5» o «No enviado · motivo · Reintentar»; Reintentar dice lo que pasa', async ({ page }) => {
  const envios = new Map<string, Envio>()
  await porLaRed(page, envios)
  await entrarComo(page, CUENTA_A.email)

  // La nómina, en Diez.
  const nomina = await abrirAsiento(page, /Nóminas de septiembre/)
  envios.set(nomina, { status: 'enviado', ext_series: '9', ext_number: 5, attempts: 1, last_error: null, next_try_at: null })
  await page.reload()
  const detalle = page.locator('[data-prueba="detalle-diez"]')
  await expect(detalle).toHaveCount(1)
  await expect(detalle.getByText('En Diez · 9/5')).toBeVisible()
  await expect(detalle.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  // Un detalle junto al número, no una sección.
  await expect(page.getByRole('region', { name: 'Con Diez' })).toHaveCount(0)
  await capturar(page, 'asiento-en-diez')

  // El contraasiento, sin llegar: el motivo, cuándo se reintenta, y «Reintentar».
  const contra = await abrirAsiento(page, /Anula General nº 2: Estaba repetido/)
  envios.set(contra, { status: 'pendiente', ext_series: null, ext_number: null, attempts: 1, last_error: 'la subcuenta 43000099 no está en Diez: no se inventa. Créala allí con el mismo código y reintenta', next_try_at: '2099-01-01T08:15:00Z' })
  await page.reload()
  await expect(detalle.getByText('No enviado', { exact: true })).toBeVisible()
  await expect(detalle).toContainText('la subcuenta 43000099 no está en Diez')
  await expect(detalle).toContainText('se vuelve a intentar a las')
  await capturar(page, 'asiento-no-enviado')
  let pedido: string | null = null
  await page.route(/\/functions\/v1\/conta-diez-enviar/, (r) => {
    pedido = (r.request().postDataJSON() as { entry_id: string }).entry_id
    envios.set(contra, { status: 'enviado', ext_series: '4', ext_number: 3158, attempts: 2, last_error: null, next_try_at: null })
    return json(r, { estado: 'en_diez', serie: '4', documento: 3158, enlazada: false, pdfPendiente: false, texto: 'Anulado también en Diez: 4/3100 con 4/3158.' })
  })
  await detalle.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByText('Anulado también en Diez: 4/3100 con 4/3158.')).toBeVisible()
  expect(pedido).toBe(contra)
  await expect(detalle.getByText('En Diez · 4/3.158')).toBeVisible()

  // El libro: la columna de Diez y el detalle de la fila (el motivo, en su title).
  await page.goto('/conta/libros/diario')
  if (lado(page) === 'ordenador') {
    await expect(page.getByRole('columnheader', { name: 'Diez' })).toBeVisible()
    await expect(filaDe(page, /Nóminas de septiembre/).locator('.cxd-diez')).toHaveText(/^9\/5/)
  }
  await expect(filaDe(page, /Nóminas de septiembre/).locator('[data-prueba="detalle-diez"]')).toContainText('En Diez · 9/5')
  await capturar(page, 'libro-diez')
})

test('A · apagado (como está en staging): ni una palabra de Diez junto al número ni en Ajustes', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await abrirAsiento(page, /Nóminas de septiembre/)
  await expect(page.locator('[data-prueba="detalle-diez"]')).toHaveCount(0)
  await expect(page.locator('.cx-principal').getByText(/Diez/)).toHaveCount(0)
  // A no trabaja con Diez en staging (sin conta_diez_base): la tarjeta no sale.
  await page.goto('/conta/ajustes/ejercicio')
  await expect(page.getByRole('region', { name: /^Desde cuándo asienta/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Enviar a Diez' })).toHaveCount(0)
})
