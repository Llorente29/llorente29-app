// tests/e2e/conta/i01h/en-vivo.spec.ts
//
// I01h · El 303 del 4T en vivo (Julio, 21/10): el Trimestre del 4T de 2026,
// abierto el 21/10/2026 (el reloj del navegador, fijo), calcula el 303 con lo
// que va de trimestre sin pulsar nada y lo dice en palabras: «Calculado hasta
// hoy (21/10/2026) … Se cierra el 31/12». La tarjeta dice «En curso», no «Para
// revisar», y la pantalla del IVA no deja revisarlo hasta que se cierre.
// En el carril de la cuenta A: su libro de IVA del 4T trae apuntes, y como su
// 3T no está presentado en staging, la [110] se escribe a mano (con su motivo)
// antes de abrir, como haría quien la sabe. Cifras inventadas.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, enCarril, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'El 303 en vivo necesita su carril: escribe el 4T de la cuenta A.')

const DIR = 'docs/conta/capturas/i01h'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const HOY = new Date('2026-10-21T10:00:00+02:00')

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}

async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e I01h 303 en vivo (carril)' : 'e2e I01h 303 en vivo (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

async function cargada(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
const foto = async (page: Page, nombre: string) => {
  const ancho = page.viewportSize()?.width ?? 1440
  const sufijo = ancho < 768 ? 'movil' : ancho >= 1800 ? '1900' : 'ordenador'
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(150)
  return page.screenshot({ path: `${DIR}/${nombre}-${sufijo}.jpg`, type: 'jpeg', quality: 75, fullPage: true })
}
async function sinDesbordar(page: Page) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, 'la página se sale de lado').toBeLessThanOrEqual(1)
}

/** La [110] del 4T de A, escrita a mano (su 3T no está presentado en staging): un borrador y la casilla con su motivo. */
async function con110(s: Sesion) {
  const c = await api<{ declaracion: string }>(s, 'POST', 'rpc/conta_impuesto_303_calcular', { p_company: EMPRESA_A, p_year: 2026, p_period: '4T' })
  await api(s, 'POST', 'rpc/conta_impuesto_casillas_poner', { p_return: c.declaracion, p_casillas: { '110': 1234.56 }, p_motivo: 'e2e I01h: lo que quedó por compensar del 3T' })
}

test('El 303 del 4T en vivo: se calcula al abrir, lo dice en palabras y no se revisa hasta que se cierre', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.clock.setFixedTime(HOY)
  const s = await entrarComo(page, CUENTA_A.email)
  await con110(s)

  await page.goto('/conta/impuestos/trimestre/2026/4T?marca=sumied')
  await cargada(page)
  const ficha = page.locator('[data-prueba="ficha-modelo"]')
  await expect(ficha.locator('[data-prueba="en-curso"]')).toHaveText(
    'Calculado hasta hoy (21/10/2026) con el libro de IVA de lo que va de trimestre. Se cierra el 31/12: hasta entonces cambia con cada factura.', { timeout: 20_000 })
  await expect(page.locator('.s-trimestre-tarjeta').filter({ hasText: 'IVA' }).first()).toContainText('En curso · se cierra el 31/12')
  const impreso = page.locator('[data-prueba="impreso-calculado"]')
  if (await impreso.count()) await expect(impreso).toContainText('calculado hasta hoy · se cierra el 31/12')
  // La [110] escrita a mano se queda al recalcular.
  await expect(page.locator('[data-prueba="todas-las-casillas"]')).toContainText('1.234,56')
  await sinDesbordar(page)
  await foto(page, 'trimestre-4t-en-vivo')
  if (lado(page) === 'ordenador') {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await cargada(page)
    await foto(page, 'trimestre-4t-en-vivo')
    await page.setViewportSize({ width: 1440, height: 900 })
  }

  // La pantalla del IVA: sin «Lo he revisado» mientras el trimestre está en curso.
  await page.goto('/conta/impuestos/iva/2026/4T?marca=sumied')
  await cargada(page)
  await expect(page.getByRole('button', { name: 'Lo he revisado' })).toHaveCount(0)
  await expect(page.locator('[data-prueba="se-revisa-al-cerrar"]')).toHaveText('Calculado con lo que va de trimestre. Se revisa cuando se cierre, a partir del 01/01.')
  expect(errores, 'errores de la página').toEqual([])
})

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
