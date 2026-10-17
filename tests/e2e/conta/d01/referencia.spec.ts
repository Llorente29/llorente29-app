/// <reference lib="dom" />
// tests/e2e/conta/d01/referencia.spec.ts
//
// D01 · Cómo se ve en Libros una liquidación DE REFERENCIA y su motivo, contra
// staging-conta, en ordenador (1440) y móvil (390). Capturas en
// docs/conta/capturas/d01/.
//
// Datos: supabase/seeds/conta/seed_d01_liquidacion_referencia_staging.sql, en
// la cuenta A: la semana 22–28/12/2025 (antes de su corte, el 01/01/2026)
// pagada el 02/01/2026, entrada por el camino del correo. La base la dejó de
// referencia y sin factura.
//
// «Proponer lo pendiente» repasa todo lo de la cuenta A, y A la comparten los
// frentes: la prueba no escribe nada. Las dos llamadas que escriben al
// proponer se contestan aquí y no llegan a la base:
//   · journal_entry_proponer → «ya estaba» (así tampoco se valida nada solo);
//   · compras_fin_de_mes → nada (recalcula su cálculo de fin de mes).
// Lo demás se lee de verdad, también la liquidación y su motivo.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/d01'
const MOTIVO = 'De referencia: es de antes del cierre de la contabilidad; no lleva factura ni asiento, y su cobro sí se casa en Bancos.'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

test('A · Libros: una liquidación de referencia no se propone, y dice por qué', async ({ page }) => {
  test.setTimeout(180_000)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  const escritas: string[] = []
  await page.route('**/rest/v1/rpc/journal_entry_proponer', async (r) => {
    escritas.push('journal_entry_proponer')
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000000', existente: true }) })
  })
  await page.route('**/rest/v1/rpc/compras_fin_de_mes', async (r) => {
    escritas.push('compras_fin_de_mes')
    await r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  // Ninguna otra escritura: si el repaso escribiera algo más, la prueba lo dice en vez de hacerlo.
  await page.route('**/rest/v1/**', async (r) => {
    const m = r.request().method()
    if (m === 'GET' || m === 'HEAD' || (m === 'POST' && /\/rest\/v1\/rpc\//.test(r.request().url()))) return r.fallback()
    escritas.push(`${m} ${new URL(r.request().url()).pathname}`)
    await r.abort()
  })

  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  // M01: el título lo dicen las pestañas del marco; el encabezado, para el lector (como en c04/libro).
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  // M01: en el móvil, lo que no es la acción principal va en «⋯».
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Más acciones del libro diario' }).click()
  await page.getByRole('button', { name: 'Proponer lo pendiente' }).click()
  await expect(page.getByRole('button', { name: 'Repasando…' })).toHaveCount(0, { timeout: 150_000 })

  const lista = page.getByRole('region', { name: 'Lo que no he propuesto' })
  await expect(lista).toBeVisible()
  const linea = lista.getByRole('listitem').filter({ hasText: MOTIVO })
  await expect(linea).toHaveCount(1)
  await expect(linea).toContainText(/^Liquidación /)
  // Dice lo que ha hecho, con contenido (regla 8).
  await expect(page.getByText(/^Repasado del .* sin propuesta \(debajo, por qué\)/)).toBeVisible()
  // Lo de la marca no sale en lo nuevo.
  expect((await lista.innerText()).split('\n').filter((l) => /folvy|sumied/i.test(l))).toEqual([])

  await linea.scrollIntoViewIfNeeded()
  await capturar(page, 'libros-referencia')
  expect(escritas.filter((x) => !['journal_entry_proponer', 'compras_fin_de_mes'].includes(x)), 'escrituras que no se esperaban').toEqual([])
  expect(errores).toEqual([])
})
