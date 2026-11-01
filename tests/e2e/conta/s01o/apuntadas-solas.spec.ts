/// <reference lib="dom" />
// tests/e2e/conta/s01o/apuntadas-solas.spec.ts
//
// S01o · Lo que Sumied sabe al 100 % se apunta solo, en ordenador y móvil,
// contra staging-conta, cuenta A. Las facturas, su porqué y su motivo son
// INVENTADOS y se AÑADEN a la respuesta de la base (page.route): la pantalla es
// la de verdad y no se escribe nada.
//   · arriba: «Sumied ha apuntado solo N facturas esta semana · Ver»;
//   · «Apuntadas solas»: su porqué y «Deshacer», que dice lo que ha hecho (regla 8);
//   · «Por revisar»: por qué la miras tú, y «Ponerla» si falta la cuenta de la ficha;
//   · Ajustes › Apuntar solo lo seguro: el interruptor, con lo que hace.
// Las capturas van a docs/conta/capturas/s01o/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01o'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

const SOLA = 'e2e01f0a-0000-4000-8000-000000000001'
const MIRAR = 'e2e01f0a-0000-4000-8000-000000000002'
const PROV = 'e2e01f0a-0000-4000-8000-0000000000bb'
const PORQUE = 'Factura de Plataforma Inventada de su liquidación del 1–15/10 de Local de prueba (mismo número); cuadra al céntimo.'
const MOTIVO = 'Falta la cuenta de gasto en la ficha de Plataforma Inventada.'
const DESHECHA = 'Devuelta a «Por revisar»: INV0000000001. Su asiento queda anulado con su contraasiento.'

const factura = (id: string, estado: string, numero: string, total: number) => ({
  id, tipo: 'factura', estado, proveedor: { id: PROV, nombre: 'Plataforma Inventada' }, numero, fecha: '2026-10-15', total, canal: 'correo', confianza: null,
  porque: null, entendido: null, recepcion: null, asiento: null, llego: '2026-10-16T08:00:00Z',
})

async function conDatosInventados(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/conta_documentos_recibidos/, async (r) => {
    const real = await r.fetch()
    const d = await real.json() as { filas: unknown[] }
    await json(r, { ...d, filas: [factura(SOLA, 'apuntada', 'INV0000000001', 43.23), factura(MIRAR, 'para_mirar', 'INV0000000002', 27.96), ...d.filas] })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_apuntadas_solas/, (r) => json(r, {
    semana: 1, filas: [{ id: SOLA, porque: PORQUE, regla: 'plataforma', asiento: null, at: '2026-11-01T18:07:00Z' }], motivos: { [MIRAR]: MOTIVO },
  }))
  await page.route(/\/rest\/v1\/rpc\/conta_apuntada_sola_deshacer/, (r) => json(r, { texto: DESHECHA }))
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

test.describe('S01o · lo que Sumied sabe al 100 % se apunta solo', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })
  // Las rutas inventadas se quitan al acabar: una lectura que sigue en vuelo no tumba la prueba («route.fetch: Test ended»).
  test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }) })

  test('arriba, cuántas apuntó sola; «Apuntadas solas» con su porqué y «Deshacer»', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await conDatosInventados(page)
    await page.goto('/conta/documentos')
    const arriba = page.locator('[data-prueba="apuntadas-solas-arriba"]')
    await expect(arriba).toContainText('Sumied ha apuntado solo 1 factura esta semana')
    await arriba.getByRole('button', { name: 'Ver' }).click()
    await expect(page).toHaveURL(/ver=solas/)
    await expect(page.getByText(PORQUE).first()).toBeVisible()
    await capturar(page, 'apuntadas-solas')
    await page.locator('[data-prueba="deshacer-sola"]').first().click()
    await expect(page.getByRole('status').filter({ hasText: DESHECHA })).toBeVisible()
  })

  test('«Por revisar» dice por qué la miras tú, y «Ponerla» lleva a la ficha', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await conDatosInventados(page)
    await page.goto('/conta/documentos?ver=por-revisar')
    const motivo = page.locator('[data-prueba="motivo-revisar"]').filter({ hasText: MOTIVO }).first()
    await expect(motivo).toBeVisible()
    await expect(motivo.getByRole('link', { name: 'Ponerla' })).toHaveAttribute('href', new RegExp(PROV))
    await capturar(page, 'por-revisar-motivo')
  })

  test('Ajustes › Apuntar solo lo seguro: el interruptor y lo que hace', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await page.goto('/conta/ajustes/apuntar-solo')
    await expect(page.locator('[data-prueba="apuntar-solo"]')).toBeVisible()
    await expect(page.getByText('Facturas recibidas › «Apuntadas solas»').first()).toBeVisible()
    await capturar(page, 'ajustes-apuntar-solo')
  })
})
