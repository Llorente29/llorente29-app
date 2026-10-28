/// <reference lib="dom" />
// tests/e2e/conta/d01/referencia.spec.ts
//
// D01 · Cómo se ve una liquidación DE REFERENCIA y su motivo, contra
// staging-conta, en ordenador (1440) y móvil (390). Capturas en
// docs/conta/capturas/d01/.
//
// Datos: supabase/seeds/conta/seed_d01_liquidacion_referencia_staging.sql, en
// la cuenta A: la semana 22–28/12/2025 (antes de su corte, el 01/01/2026)
// pagada el 02/01/2026, entrada por el camino del correo. La base la dejó de
// referencia y sin factura.
//
// S01 · PR 3 (entrega 5): ya no hay «Proponer lo pendiente» en Asientos. La
// liquidación se propone sola al leerse y en la pasada de las 03:40; la que
// no se puede proponer queda, con su porqué, en «Lo que no he podido proponer»
// de Ventas › Liquidaciones. Que la regla la deja fuera con ESTE motivo lo prueba
// la de staging (20261028_s01_propuestas_plataforma_prueba.sql, «la de
// referencia»). Aquí, la pantalla: la fila que la base escribe para ella en
// conta_propuesta_pendiente se contesta tal cual (la cuenta A la comparten los
// frentes y la pasada no corre en la prueba), y se mira que sale, entera, en su
// apartado, y que no la tapa nada. La prueba no escribe nada.

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

test('A · Ventas › Liquidaciones: una liquidación de referencia no se propone, y dice por qué', async ({ page }) => {
  test.setTimeout(120_000)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  // Lo que escribe la base para ella (_conta_no_propuesta, donde = 'Ventas › Liquidaciones').
  await page.route(/\/rest\/v1\/conta_propuesta_pendiente\?/, async (r) => {
    const donde = new URL(r.request().url()).searchParams.get('donde')
    const filas = donde === 'eq.Ventas › Liquidaciones'
      ? [{ id: '00000000-0000-4000-8000-0000000000d1', origen: 'channel_settlement', que: 'Liquidación Glovo · semana del 22/12/2025', porque: MOTIVO, at: '2026-10-29T02:40:00Z' }]
      : []
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filas) })
  })
  const escritas: string[] = []
  await page.route('**/rest/v1/**', async (r) => {
    const m = r.request().method()
    if (m === 'GET' || m === 'HEAD' || (m === 'POST' && /\/rest\/v1\/rpc\//.test(r.request().url()))) return r.fallback()
    escritas.push(`${m} ${new URL(r.request().url()).pathname}`)
    await r.abort()
  })

  await entrarComo(page, CUENTA_A.email)
  // Asientos ya no ofrece «Proponer lo pendiente».
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Proponer lo pendiente' })).toHaveCount(0)

  await page.goto('/conta/ventas/liquidaciones')
  const lista = page.getByRole('region', { name: 'Lo que no he podido proponer' })
  await expect(lista).toBeVisible({ timeout: 30_000 })
  await expect(lista.getByRole('heading', { name: 'Lo que no he podido proponer, y por qué · 1' })).toBeVisible()
  const linea = lista.getByRole('listitem').filter({ hasText: MOTIVO })
  await expect(linea).toHaveCount(1)
  await expect(linea).toContainText(/^Liquidación /)
  // Lo de la marca no sale en lo nuevo.
  expect((await lista.innerText()).split('\n').filter((l) => /folvy|sumied/i.test(l))).toEqual([])

  await linea.scrollIntoViewIfNeeded()
  await capturar(page, 'liquidaciones-referencia')
  expect(escritas, 'escrituras que no se esperaban').toEqual([])
  expect(errores).toEqual([])
})
