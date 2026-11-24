/// <reference lib="dom" />
// tests/e2e/conta/s01p/pdf-just-eat.spec.ts
//
// S01p·20 · 1b (Julio, 13/11) · El PDF de las facturas de Just Eat, hecho del cuerpo del correo.
// Ajustes › Correo de facturas, con correos de Just Eat: «Poner el PDF a las facturas de Just Eat
// que no lo tienen» pide a la entrada que lo haga y dice en pantalla qué ha hecho (regla 8).
// Contra staging-conta (la cuenta A), en ordenador y móvil, con lo que devuelven la base y la
// función interceptado (inventado, T11: staging no tiene correos de Just Eat). Lo que hace la base
// lo prueba supabase/staging/sql/20261113_s01p_pdf_del_correo_prueba.sql; el PDF, sus unitarias.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01p20'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(cuerpo) })
const DICE = '2 facturas de Just Eat tienen ya su PDF, hecho de su correo; 1 ya lo tenía.'

const correo = () => ({
  direccion: 'facturas-prueba@entrada.prueba.test', activa: true, ultimo: hace(5), confirmacion: null,
  llegadas: [
    { fecha: hace(5), de: 'reenvio@prueba.test', asunto: 'Fwd: Just-eat invoice: 0000001', resultado: 'liquidacion', llegada: null, motivo: null, dicho: null,
      factura: null, email_id: 'correo-prueba-je-1', plataforma: 'justeat', excel: null,
      factura_comision: { id: '0e1a0000-0000-4000-8000-0000000002f1', codigo: 'FAC-00001', numero: '0000001', total: 4.36, en_revision: true, nota: null },
      liquidaciones: [{ id: '0e1a0000-0000-4000-8000-0000000002a1', plataforma: 'Just Eat', tienda: 'Marca Inventada', local: 'Local Inventado', desde: '2026-08-01', hasta: '2026-08-15', neto: -4.36, pago_el: null, otro_correo: false }] },
  ],
})

test('S01p·20 · 1b · «Poner el PDF a las facturas de Just Eat que no lo tienen» lo pide y dice qué ha hecho', async ({ page }) => {
  test.setTimeout(90_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const pedidos: { url: string; cuerpo: unknown }[] = []
  await page.route('**/rest/v1/rpc/conta_correo_facturas', (r) => json(r, correo()))
  await page.route('**/functions/v1/conta-facturas-entrada**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: 'ok' })
    pedidos.push({ url: r.request().url(), cuerpo: r.request().postDataJSON() })
    await json(r, { texto: DICE, facturas: [
      { emailId: 'a', facturaId: 'f1', estado: 'puesto', texto: 'La factura 0000001 tiene ya su PDF, hecho de su correo.' },
      { emailId: 'b', facturaId: 'f2', estado: 'puesto', texto: 'La factura 0000002 tiene ya su PDF, hecho de su correo.' },
      { emailId: 'c', facturaId: 'f3', estado: 'ya_tenia', texto: 'La factura 0000003 ya tenía su PDF: no lo cambio.' },
    ] })
  })
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ajustes/correo-facturas', { timeout: 30_000 })

  const boton = page.locator('[data-prueba="poner-pdfs"]').first()
  await expect(boton).toHaveText('Poner el PDF a las facturas de Just Eat que no lo tienen', { timeout: 30_000 })
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/pdf-just-eat-boton-${lado(page)}.png`, fullPage: true })

  await boton.click()
  const aviso = page.locator('[data-prueba="releer-aviso"]').first()
  await expect(aviso).toHaveText(DICE, { timeout: 20_000 })
  // Lo pide a la entrada, con la empresa, y por su ruta (?pdfs=1): no relee ni registra nada más.
  expect(pedidos).toHaveLength(1)
  expect(pedidos[0].url).toContain('pdfs=1')
  expect(pedidos[0].cuerpo).toMatchObject({ company_id: expect.any(String) })
  await page.screenshot({ path: `${DIR}/pdf-just-eat-hecho-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
