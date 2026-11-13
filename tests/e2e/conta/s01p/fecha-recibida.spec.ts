/// <reference lib="dom" />
// tests/e2e/conta/s01p/fecha-recibida.spec.ts
//
// S01p·18.2 · punto 2 (Julio, 13/11) · El asiento de una factura recibida, con
// la fecha de la factura. En la ficha de la factura, antes de validar, la fecha
// con la que se va a apuntar, en una frase (regla 8).
//
// La factura es la de la semilla del carril: F-2026-1022 de «Mayorista Prueba
// Alfa», del 11/10, que entró el 13/10. Con la regla de antes (V04: «nunca antes
// del día en que entró») se apuntaba el 13/10; ahora, el 11/10.
//   1. Con el trimestre sin presentar: «Se apunta con fecha 11/10/2026, la de la factura.»
//   2. Si la base dice que va con otra (el 303 presentado, contestado aquí como lo
//      contesta conta_recibida_fecha), la frase dice cuál y por qué.
// Con sus capturas (docs/conta/capturas/s01p18), en ordenador y en móvil.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'

const DIR = 'docs/conta/capturas/s01p18'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const FACTURA = enCarril('d0100000-0000-4000-8000-0000000000f1')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function abrir(page: Page) {
  await page.goto(`/conta/documentos/recibidas/${FACTURA}`)
  const asiento = page.locator('details.s-asiento-ficha')
  await expect(asiento.locator('summary')).toHaveText('El asiento que se crea', { timeout: 30_000 })
  if (!(await asiento.evaluate((d) => (d as HTMLDetailsElement).open))) await asiento.locator('summary').click()
  return asiento
}

test('1 · con el trimestre sin presentar, la fecha de la factura, dicha antes de validar', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const asiento = await abrir(page)
  const frase = asiento.locator('[data-prueba="fecha-del-asiento"]')
  await expect(frase).toHaveText('Se apunta con fecha 11/10/2026, la de la factura.', { timeout: 30_000 })
  // Ni el día en que entró (13/10) ni «entró el…».
  await expect(asiento).not.toContainText('13/10/2026')
  await expect(asiento).not.toContainText('entró el')
  await asiento.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/fecha-recibida-su-fecha-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('2 · si la base dice que va con otra fecha, la frase dice cuál y por qué', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const aviso = 'El IVA del 4T de 2026 ya está presentado: esta factura del 11/10/2026 se contabiliza el 01/01/2027, el primer día abierto.'
  await page.route(/\/rest\/v1\/rpc\/conta_recibida_fecha(\?|$)/, (r) => json(r, { fecha: '2027-01-01', factura: '2026-10-11', aviso }))
  const asiento = await abrir(page)
  const frase = asiento.locator('[data-prueba="fecha-del-asiento"]')
  await expect(frase).toHaveText(`Se apunta con fecha 01/01/2027, no la de la factura (11/10/2026): ${aviso.replace(/\.$/, '')}.`, { timeout: 30_000 })
  await asiento.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/fecha-recibida-otra-fecha-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
