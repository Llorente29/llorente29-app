/// <reference lib="dom" />
// tests/e2e/conta/s01j2/correo-y-liquidacion.spec.ts
//
// S01j·2 · Ajustes › Correo de facturas dice qué salió de cada correo, y la
// ficha de la liquidación (maquetas 1 a 4). Contra staging-conta (la cuenta A),
// en ordenador y móvil, con lo que devuelve la base interceptado (inventado,
// T11: staging no tiene correos de Glovo ni de Just Eat):
//   · cada llegada con lo que salió y su estado: la factura y la liquidación
//     ligadas, el Excel que se quedó sin leer, el correo que solo traía el PDF;
//   · su ⋯: «Volver a leer este correo» dice en pantalla lo que ha hecho
//     (regla 8), también si el correo ya no está en el buzón;
//   · «Ver la liquidación» lleva a su ficha, con sus cifras, su factura y el
//     correo del que salió; la que no suma lo dice con los números (regla 7).
// Lo que hace la base lo prueba supabase/staging/sql/20261101_s01j2_correo_prueba.sql.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01j2'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const LIQ = '0e1a0000-0000-4000-8000-000000000001'
const MAL = '0e1a0000-0000-4000-8000-000000000002'

const correo = () => ({
  direccion: 'facturas-prueba@entrada.prueba.test', activa: true, ultimo: hace(5), confirmacion: null,
  llegadas: [
    { fecha: hace(5), de: 'facturas@glovoapp.test', asunto: 'Factura de prueba 1', resultado: 'recibido', llegada: 'leida', motivo: null, dicho: null,
      factura: { id: '0e1a0000-0000-4000-8000-0000000000f1', codigo: 'FAC-00001', numero: 'FAC-00001', total: 43.23, proveedor: 'Plataforma Inventada', casada: false },
      email_id: 'correo-prueba-1', plataforma: 'glovo', excel: 'leido', factura_comision: null,
      liquidaciones: [{ id: LIQ, plataforma: 'Glovo', tienda: 'Marca Inventada', local: 'Local Inventado', desde: '2026-10-01', hasta: '2026-10-15', neto: 236.27, pago_el: '2026-10-22', otro_correo: false }] },
    { fecha: hace(10), de: 'facturas@glovoapp.test', asunto: 'Factura de prueba 2', resultado: 'recibido', llegada: 'leida', motivo: null, dicho: null,
      factura: { id: '0e1a0000-0000-4000-8000-0000000000f2', codigo: 'FAC-00002', numero: 'FAC-00002', total: 12.1, proveedor: 'Plataforma Inventada', casada: false },
      email_id: 'correo-prueba-2', plataforma: 'glovo', excel: 'sin_leer', factura_comision: null, liquidaciones: [] },
    { fecha: hace(15), de: 'facturas@glovoapp.test', asunto: 'Factura de prueba 3', resultado: 'recibido', llegada: 'leida', motivo: null, dicho: null,
      factura: { id: '0e1a0000-0000-4000-8000-0000000000f3', codigo: 'FAC-00003', numero: 'FAC-00003', total: 9.9, proveedor: 'Plataforma Inventada', casada: false },
      email_id: 'correo-prueba-3', plataforma: 'glovo', excel: 'no_traia', factura_comision: null, liquidaciones: [] },
  ],
})

const ficha = (id: string) => (id === MAL
  ? { id: MAL, plataforma: 'Just Eat', canal_id: '0e1a0000-0000-4000-8000-0000000000c1', marca: null, local: 'Local Inventado', local_id: null, tienda: 'Marca Inventada',
      referencia: '0000001', desde: '2026-10-01', hasta: '2026-10-15', sin_periodo: false, origen: 'correo_justeat',
      pedidos: 0, ventas: 0, comision: -5.98, otros: -5.98, neto: 0, pago_el: '2026-10-22', cobrado_el: null, cobrado: null,
      factura: null, correo: null, revisar: null }
  : { id: LIQ, plataforma: 'Glovo', canal_id: '0e1a0000-0000-4000-8000-0000000000c1', marca: 'Marca Inventada', local: 'Local Inventado', local_id: '0e1a0000-0000-4000-8000-0000000000a1',
      tienda: 'Marca Inventada', referencia: null, desde: '2026-10-01', hasta: '2026-10-15', sin_periodo: false, origen: 'excel_glovo',
      pedidos: 31, ventas: 218, comision: -43.23, otros: 61.5, neto: 236.27, pago_el: '2026-10-22', cobrado_el: null, cobrado: null,
      factura: { id: '0e1a0000-0000-4000-8000-0000000000f1', codigo: 'FAC-00001', numero: 'FAC-00001', fecha: '2026-10-15', base: 35.73, iva: 7.5, total: 43.23, estado: 'pendiente', en_revision: false },
      correo: { email_id: 'correo-prueba-1', fecha: hace(5), de: 'facturas@glovoapp.test', asunto: 'Factura de prueba 1', a: 'facturas-prueba@entrada.prueba.test', adjuntos: [], company_id: null },
      revisar: null })

test('S01j·2 · qué salió de cada correo, su ⋯ y la ficha de la liquidación', async ({ page }) => {
  test.setTimeout(120_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const releidos: unknown[] = []
  await page.route('**/rest/v1/rpc/conta_correo_facturas', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(correo()) }))
  await page.route('**/rest/v1/rpc/conta_liquidacion_ficha', async (r) => {
    const { p_id } = r.request().postDataJSON() as { p_id: string }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ficha(p_id)) })
  })
  await page.route('**/functions/v1/conta-facturas-entrada**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: 'ok' })
    releidos.push(r.request().postDataJSON())
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ texto: '1 ya no está en el buzón: reenvíalos desde Gmail.', correos: [{ emailId: 'correo-prueba-2', estado: 'ya_no_esta', texto: 'Este correo ya no está en el buzón: reenvíalo desde Gmail.' }] }) })
  })
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/correo-facturas', { timeout: 30_000 })

  const llegadas = page.locator('[data-prueba="llegada"]')
  await expect(llegadas).toHaveCount(3, { timeout: 30_000 })
  await expect(llegadas.nth(0)).toContainText('Factura FAC-00001 y liquidación de Glovo · Marca Inventada · Local Inventado · 1–15/10')
  await expect(llegadas.nth(0).locator('[data-prueba="llegada-estado"]')).toHaveText('Ligadas · se paga el 22/10')
  await expect(llegadas.nth(1).locator('[data-prueba="llegada-estado"]')).toHaveText('Falta leer el Excel')
  await expect(llegadas.nth(2).locator('[data-prueba="llegada-estado"]')).toHaveText('Falta la liquidación')
  await expect(page.getByRole('button', { name: 'Volver a leer todo lo de Glovo' }).first()).toBeVisible()
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/correo-${lado(page)}.png`, fullPage: true })

  // El ⋯ del correo cuyo Excel se quedó sin leer: volver a leerlo dice lo que ha pasado.
  await llegadas.nth(1).getByRole('button', { name: 'Más acciones de esta llegada' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Volver a leer este correo' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Ver la factura' })).toBeVisible()
  await page.screenshot({ path: `${DIR}/menu-${lado(page)}.png`, fullPage: true })
  await menu.getByRole('menuitem', { name: 'Volver a leer este correo' }).click()
  await expect(page.locator('[data-prueba="releer-aviso"]')).toHaveText('1 ya no está en el buzón: reenvíalos desde Gmail.', { timeout: 20_000 })
  expect(releidos).toEqual([expect.objectContaining({ email_ids: ['correo-prueba-2'] })])

  // «Ver la liquidación» lleva a su ficha.
  await llegadas.nth(0).getByRole('button', { name: 'Más acciones de esta llegada' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Ver la liquidación' }).click()
  const f = page.locator('[data-prueba="ficha-liquidacion"]')
  await expect(f).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Glovo · Marca Inventada · Local Inventado · del 01/10 al 15/10/2026')
  await expect(f).toContainText('Factura de comisión · recibida')
  await expect(f).toContainText('31 pedidos')
  await expect(f).toContainText('236,27 €')
  await expect(f.locator('[data-prueba="ver-factura"]')).toHaveText('FAC-00001')
  await expect(f.locator('[data-prueba="de-donde"]')).toContainText('Del correo «Factura de prueba 1»')
  await expect(f.locator('[data-prueba="ver-llegada"]')).toBeVisible()
  await expect(f.locator('[data-prueba="no-suman"]')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/ficha-${lado(page)}.png`, fullPage: true })

  // La que no suma (Just Eat con saldo negativo): lo dice con los números, no se esconde.
  await page.goto(`/conta/ventas/liquidaciones/liquidacion/${MAL}`, { timeout: 30_000 })
  await expect(page.locator('[data-prueba="no-suman"]')).toContainText('Las cifras no suman', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="ficha-liquidacion"]')).toContainText('Falta su factura de comisión')

  const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)
  expect(errores, 'sin errores en la página').toEqual([])
})
