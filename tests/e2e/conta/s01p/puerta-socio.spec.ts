/// <reference lib="dom" />
// tests/e2e/conta/s01p/puerta-socio.spec.ts
//
// S01p·18 · punto 3 (Julio, 12/11) · Ventas › Liquidaciones, el socio de marca:
//   1. «El mes» de sus filas lleva a subir sus documentos si su liquidación falta
//      (compras/liquidacion/nueva con su proveedor, local y mes) y a su ficha si ya
//      está. Lo que la pantalla lee del mes (conta_liquidaciones_mes) se contesta
//      aquí, con nombres inventados (T11); el marco y la sesión son staging.
//   2. La ficha de Ventas › Liquidaciones con el id de una liquidación del socio
//      ya no dice «no está en tu cuenta»: abre la suya (compras/liquidacion/:id).
//      Las cuentas de los carriles no traen liquidaciones del socio: lo que lee
//      la ficha se contesta aquí. Con sus capturas (docs/conta/capturas/s01p18).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'

const DIR = 'docs/conta/capturas/s01p18'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NORTE = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const SOCIO = 'p0000000-0000-4000-8000-0000000000c1'
const PROVEEDOR = 'c0c00000-0000-4000-8000-0000000000c1'
const LIQ = 'c18a0000-0000-4000-8000-000000001899'
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

const cedida = (marca: string, local: string, localId: string, liquidacion: { id: string; total: number } | null) => ({
  socio: 'Socio Prueba', socio_id: SOCIO, local, local_id: localId, desde: '2026-10-01', hasta: '2026-10-31', marcas: [marca],
  vendido: { pedidos: 120, total: 2410.5 }, liquidacion, estado: liquidacion ? 'completa' : 'te_necesita', cuando: '2026-11-15', grupo: 'cedida',
  frase: liquidacion ? 'Su liquidación del mes, guardada.' : 'Falta su liquidación del mes.',
})

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('1 · «El mes» del socio: a subir sus documentos si falta, a su ficha si está', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await page.route(/\/rest\/v1\/rpc\/conta_liquidaciones_mes(\?|$)/, (r) => json(r, {
    mes: '2026-10-01', desde: '2026-10-01', hasta: '2026-10-31', filas: [],
    cedidas: [cedida('Marca Cedida Prueba', 'Norte Centro', NORTE, null), cedida('Otra Cedida Prueba', 'Sur Prueba', 'c01a0000-0000-4000-8000-0000000000b9', { id: LIQ, total: 1234.56 })],
    resumen: { total: 0, completa: 0, aun_no_toca: 0, te_necesita: 0, no_cuadra: 0 },
  }))
  await page.route(/\/rest\/v1\/party_role\?.*role=eq\.supplier/, (r) => json(r, [{ party_id: SOCIO, supplier_id: PROVEEDOR }]))
  await page.goto('/conta/ventas/liquidaciones?mes=2026-10')
  const grupo = page.locator('[data-prueba="grupo-cedidas"]')
  await expect(grupo).toBeVisible({ timeout: 30_000 })
  const meses = grupo.locator('[data-prueba="el-mes-cedida"]')
  await expect(meses).toHaveCount(2)
  const falta = await meses.nth(0).getAttribute('href')
  expect(falta).toContain('/conta/compras/liquidacion/nueva?')
  const q = new URLSearchParams(falta!.split('?')[1])
  expect([q.get('proveedor'), q.get('local'), q.get('mes')]).toEqual([PROVEEDOR, NORTE, '2026-10-01'])
  expect(await meses.nth(1).getAttribute('href')).toContain(`/conta/compras/liquidacion/${LIQ}`)
  await page.screenshot({ path: `${DIR}/socio-el-mes-${lado(page)}.png`, fullPage: true })
  await meses.nth(0).click()
  await expect(page).toHaveURL(/\/conta\/compras\/liquidacion\/nueva\?/)
  await expect(page.getByLabel('Los PDF de la liquidación')).toBeVisible({ timeout: 30_000 })
  expect(errores).toEqual([])
})

test('2 · la ficha de Ventas con el id de una liquidación del socio abre la suya', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  // Lo que contesta la base hoy: la ficha de plataforma no la conoce, y sí es una del socio.
  await page.route(/\/rest\/v1\/rpc\/conta_liquidacion_ficha(\?|$)/, (r) => r.fulfill({ status: 400, contentType: 'application/json',
    body: JSON.stringify({ code: 'P0002', message: 'Esa liquidación no está en tu cuenta.' }) }))
  await page.route(new RegExp(`/rest/v1/licensed_settlement\\?.*id=eq\\.${LIQ}`), (r) => json(r, { id: LIQ }))
  await page.goto(`/conta/ventas/liquidaciones/liquidacion/${LIQ}`)
  await expect(page).toHaveURL(new RegExp(`/conta/compras/liquidacion/${LIQ}`), { timeout: 30_000 })
  await expect(page.getByText('Esa liquidación no está en tu cuenta')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/socio-ficha-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
