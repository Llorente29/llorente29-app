/// <reference lib="dom" />
// tests/e2e/conta/s01p/linea-socio.spec.ts
//
// S01p·18 · punto 1 · «¿Qué es esta línea?» en la liquidación del socio, contra
// la maqueta aprobada (Respuesta S01p·18.1, docs/conta/s01p18/maqueta-linea-socio.html),
// en el ordenador (1440) y en el móvil (390).
//
// Se sueltan los tres PDF inventados con la forma de los de octubre de Alcalá
// (tests/conta/fixtures/socio): la autofactura, su factura y la transacción con
// «Financiación inventario pendiente por pagar», 770,00. Lo que la pantalla lee
// de la base (lo recordado, lo pendiente, el nombre del socio y del local) y lo
// que escribe (la regla) se contesta aquí y se mira con qué se ha llamado: la
// base la prueba su prueba de staging. El lector, la sesión y el marco son los
// de verdad.
//
//   1. La pregunta en el sitio del aviso rojo; «Guardar y comparar» espera.
//   2. «Género que te cobrará el mes que viene»: confirma con contenido, se
//      recuerda, y se puede guardar; «Cambiar lo que es» vuelve a preguntar.
//   3. Lo recordado: ya no pregunta y dice qué sabe y desde cuándo.
//   4. La ficha del socio: lo que sé de sus líneas, y «Cambiar» desde ahí.
// Cada uno con su captura al lado del estado de la maqueta (docs/conta/capturas/s01p18).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo } from '../sesion'
// @ts-expect-error: fixture en JS sin tipos
import { autofactura, suFactura, transaccion } from '../../../conta/fixtures/socio/pdfLiquidacionSocio.mjs'

const DIR = 'docs/conta/capturas/s01p18'
const SOCIO = enCarril('c0c00000-0000-4000-8000-000000000004')
const LOCAL = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const TECNICAS = /\b(queEs|pendiente_facturar|cancela_pendiente|a_mano|null|undefined|NaN|4009|40090000|43000\d+)\b/

async function alLado(page: Page, estado: 'pregunta' | 'contestada' | 'recordada', nombre: string) {
  const l = lado(page)
  await page.evaluate(() => document.fonts.ready)
  const pantalla = await page.screenshot({ path: `${DIR}/${nombre}-${l}.png`, fullPage: true })
  const ancho = l === 'movil' ? 390 : 1440
  const maqueta = await page.context().newPage()
  await maqueta.setViewportSize({ width: ancho, height: 900 })
  await maqueta.goto(`file://${process.cwd()}/docs/conta/s01p18/maqueta-linea-socio.html`)
  await maqueta.locator(`[data-e="${estado}"]`).click()
  const dibujo = await maqueta.screenshot({ fullPage: true })
  await maqueta.close()
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">Maqueta aprobada · ${estado}</figcaption><img style="width:100%" src="data:image/png;base64,${dibujo.toString('base64')}"></figure>
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">La pantalla (staging)</figcaption><img style="width:100%" src="data:image/png;base64,${pantalla.toString('base64')}"></figure>
    </div></body>`)
  await otra.screenshot({ path: `${DIR}/al-lado-${nombre}-${l}.png`, fullPage: true })
  await otra.close()
}

type Llamada = { f: string; cuerpo: Record<string, unknown> }
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const REGLA = { concepto: 'Financiación inventario pendiente por pagar', clave: 'financiación inventario pendiente por pagar', queEs: 'pendiente_facturar', fecha: '2026-11-12T17:35:00Z', quien: 'Administración de Prueba' }

async function simular(page: Page, reglas: unknown[]): Promise<Llamada[]> {
  const llamadas: Llamada[] = []
  await page.route(/\/rest\/v1\/rpc\/compras_socio_reglas(\?|$)/, (r) => json(r, reglas))
  await page.route(/\/rest\/v1\/rpc\/compras_socio_pendiente(\?|$)/, (r) => json(r, 0))
  await page.route(/\/rest\/v1\/rpc\/compras_socio_regla_guardar(\?|$)/, (r) => {
    const c = r.request().postDataJSON() as Record<string, unknown>
    llamadas.push({ f: 'regla', cuerpo: c })
    return json(r, c.p_que_es ? { ...REGLA, queEs: c.p_que_es } : null)
  })
  await page.route(new RegExp(`/rest/v1/supplier\\?.*id=eq\\.${SOCIO}`), (r) => {
    const u = new URL(r.request().url()).searchParams.get('select')
    if (u === 'name') return json(r, { name: 'Marcas de Prueba, SL' })
    if (u === 'invoicing_mode') return json(r, { invoicing_mode: 'monthly_settlement' })
    return r.fallback()
  })
  await page.route(new RegExp(`/rest/v1/locations\\?.*id=eq\\.${LOCAL}`), (r) =>
    new URL(r.request().url()).searchParams.get('select') === 'name' ? json(r, { name: 'Norte Centro' }) : r.fallback())
  return llamadas
}

async function soltar(page: Page) {
  await page.goto(`/conta/compras/liquidacion/nueva?proveedor=${SOCIO}&local=${LOCAL}&mes=2026-10`)
  const input = page.getByLabel('Los PDF de la liquidación')
  await expect(input).toBeEnabled({ timeout: 30_000 })
  await input.setInputFiles([
    { name: 'AutoFactura oct.pdf', mimeType: 'application/pdf', buffer: autofactura() },
    { name: 'Factura oct.pdf', mimeType: 'application/pdf', buffer: suFactura() },
    { name: 'Resumen de Transaccion oct.pdf', mimeType: 'application/pdf', buffer: transaccion() },
  ])
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('1 y 2 · la pregunta en el sitio del aviso rojo, contestarla, y «Cambiar lo que es»', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page, [])
  await soltar(page)
  const pregunta = page.locator('[data-prueba="pregunta-linea"]')
  await expect(pregunta).toBeVisible({ timeout: 30_000 })
  await expect(pregunta.getByText('¿Qué es esta línea?')).toBeVisible()
  await expect(pregunta).toContainText('«Financiación inventario pendiente por pagar»')
  await expect(pregunta).toContainText('+770,00 €')
  await expect(page.getByText('no sabe qué es: dímelo')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Guardar y comparar' })).toBeDisabled()
  await expect(page.getByText('Contesta la pregunta de arriba para guardar.')).toBeVisible()
  // «Del mes pasado» no se puede: no hay nada pendiente con él en este local.
  await expect(pregunta.getByRole('button', { name: /Género del mes pasado que ya te cobra/ })).toBeDisabled()
  await expect(pregunta).not.toContainText(TECNICAS)
  await alLado(page, 'pregunta', 'pregunta')

  await pregunta.getByRole('button', { name: /Género que te cobrará el mes que viene/ }).click()
  const hecho = page.locator('[data-prueba="linea-contestada"]')
  await expect(hecho).toContainText('Apuntado: 770,00 € de género que Marcas de Prueba, SL te facturará en noviembre.')
  await expect(hecho).toContainText('Queda como deuda pendiente de facturar con Marcas de Prueba, SL, de Norte Centro.')
  await expect(hecho).toContainText('La próxima vez que Marcas de Prueba, SL traiga esta línea, la apunto igual sin preguntar.')
  expect(llamadas.find((x) => x.f === 'regla')?.cuerpo).toMatchObject({ p_proveedor: SOCIO, p_concepto: 'Financiación inventario pendiente por pagar', p_que_es: 'pendiente_facturar' })
  await expect(page.getByText('Lo que apuntará al contabilizar')).toBeVisible()
  await expect(page.getByText('770,00 € más que te paga, a cuenta de su factura de noviembre')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar y comparar' })).toBeEnabled()
  await expect(page.locator('main')).not.toContainText(TECNICAS)
  await alLado(page, 'contestada', 'contestada')

  await hecho.getByRole('button', { name: 'Cambiar lo que es' }).click()
  await expect(page.locator('[data-prueba="pregunta-linea"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar y comparar' })).toBeDisabled()
  expect(errores).toEqual([])
})

test('3 · lo recordado: ya no pregunta, dice qué sabe y desde cuándo', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await simular(page, [REGLA])
  await soltar(page)
  const hecho = page.locator('[data-prueba="linea-contestada"]')
  await expect(hecho).toContainText('Ya sé qué es: «Financiación inventario pendiente por pagar» es género que te cobrará el mes que viene (lo dijiste el 12/11).', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="pregunta-linea"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Guardar y comparar' })).toBeEnabled()
  await alLado(page, 'recordada', 'recordada')
  expect(errores).toEqual([])
})

test('4 · la ficha del socio: lo que sé de sus líneas, y cambiarlo desde ahí', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page, [REGLA])
  await page.goto(`/conta/clientes-y-proveedores/proveedor/${SOCIO}`)
  const bloque = page.locator('[data-prueba="lineas-de-su-liquidacion"]').first()
  await expect(bloque).toBeVisible({ timeout: 30_000 })
  await expect(bloque).toContainText('«Financiación inventario pendiente por pagar» es género que te cobrará el mes que viene')
  await expect(bloque).toContainText('Lo dijo Administración de Prueba el 12/11 al leer su liquidación.')
  await bloque.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/ficha-socio-${lado(page)}.png`, fullPage: true })
  await bloque.getByRole('button', { name: 'Cambiar: «Financiación inventario pendiente por pagar»' }).click()
  await bloque.getByRole('button', { name: 'Otra cosa: la apunto yo a mano' }).click()
  await expect(bloque).toContainText('Cambiado: «Financiación inventario pendiente por pagar» ahora la apuntas tú a mano.')
  expect(llamadas.find((x) => x.f === 'regla')?.cuerpo).toMatchObject({ p_proveedor: SOCIO, p_que_es: 'a_mano' })
  await page.screenshot({ path: `${DIR}/ficha-socio-cambiada-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
