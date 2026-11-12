/// <reference lib="dom" />
// tests/e2e/conta/s01p/cierre-socio.spec.ts
//
// S01p·18 · punto 4 (Julio, 12/11) · El correo «Cierre del mes de …» del socio
// de marca ya no entra en Compras: sus PDF esperan en Ventas › Liquidaciones ›
// Socios de marca y se leen con su liquidación, preguntando el local (sus PDF
// traen la dirección fiscal de la empresa, no la del local).
//
// Lo que la pantalla lee de la base (el mes, la bandeja, los locales) y lo que
// escribe (guardar y dejar los PDF con la liquidación) se contesta aquí y se
// mira con qué se ha llamado: la base la prueba su prueba de staging y la
// puerta del correo, sus unitarias. Los PDF del correo son los inventados con
// la forma de los de octubre (tests/conta/fixtures/socio), servidos como si
// salieran del almacén. El lector, la sesión y el marco son los de verdad.
//
//   1. El aviso en Socios de marca: «El cierre de octubre llegó por correo…»,
//      con «Leerlo» (sin local: le faltan dos).
//   2. «Leerlo»: pregunta el local; con él, lee los PDF del correo, pregunta la
//      línea nueva, guarda y deja los PDF con su liquidación (lo dice).
// Con sus capturas (docs/conta/capturas/s01p18), en ordenador y en móvil.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'
// @ts-expect-error: fixture en JS sin tipos
import { autofactura, suFactura, transaccion } from '../../../conta/fixtures/socio/pdfLiquidacionSocio.mjs'

const DIR = 'docs/conta/capturas/s01p18'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NORTE = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const SUR = 'c01a0000-0000-4000-8000-0000000000b9'
const SOCIO = 'p0000000-0000-4000-8000-0000000000c1'
const PROVEEDOR = enCarril('c0c00000-0000-4000-8000-000000000004')
const LIQ = 'c18a0000-0000-4000-8000-000000001898'
const CORREO = 'correo-cierre-octubre-prueba'
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const TECNICAS = /\b(document_inbox|licensed_settlement|email_id|null|undefined|NaN|liquidacion\b)/

const PDFS: Record<string, () => Buffer> = {
  'AutoFactura-oct.pdf': autofactura, 'Factura-oct.pdf': suFactura, 'Resumen-de-Transaccion-oct.pdf': transaccion,
}
const bandeja = Object.keys(PDFS).map((nombre, i) => ({
  id: `c18a0000-0000-4000-8000-00000000190${i}`, email_id: CORREO, email_subject: 'Fwd: Cierre del mes de octubre',
  email_received_at: '2026-11-05T09:12:00Z', created_at: '2026-11-05T09:12:03Z', file_name: nombre, file_bucket: 'receipt-uploads',
  file_path: `acc-prueba/_correo/${CORREO}/0${i + 1}-${nombre}`,
}))
const cedida = (local: string, localId: string) => ({
  socio: 'Socio Prueba', socio_id: SOCIO, local, local_id: localId, desde: '2026-10-01', hasta: '2026-10-31', marcas: ['Marca Cedida Prueba'],
  vendido: { pedidos: 120, total: 2410.5 }, liquidacion: null, estado: 'te_necesita', cuando: '2026-11-15', grupo: 'cedida', frase: 'Falta su liquidación del mes.',
})

type Llamada = { f: string; cuerpo: Record<string, unknown> }
async function simular(page: Page): Promise<Llamada[]> {
  const llamadas: Llamada[] = []
  await page.route(/\/rest\/v1\/rpc\/conta_liquidaciones_mes(\?|$)/, (r) => json(r, {
    mes: '2026-10-01', desde: '2026-10-01', hasta: '2026-10-31', filas: [],
    cedidas: [cedida('Norte Centro', NORTE), cedida('Sur Prueba', SUR)],
    resumen: { total: 0, completa: 0, aun_no_toca: 0, te_necesita: 0, no_cuadra: 0 },
  }))
  await page.route(/\/rest\/v1\/party_role\?.*role=eq\.supplier/, (r) => json(r, [{ party_id: SOCIO, supplier_id: PROVEEDOR }]))
  await page.route(/\/rest\/v1\/document_inbox\?.*doc_kind=eq\.liquidacion/, (r) => json(r, bandeja))
  await page.route(/\/storage\/v1\/object\/(authenticated\/)?receipt-uploads\//, (r) => {
    const nombre = Object.keys(PDFS).find((n) => decodeURIComponent(r.request().url()).endsWith(n))
    return nombre ? r.fulfill({ status: 200, contentType: 'application/pdf', body: PDFS[nombre]() }) : r.fulfill({ status: 404, body: '{}' })
  })
  await page.route(/\/rest\/v1\/locations\?.*order=name/, (r) => json(r, [
    { id: NORTE, name: 'Norte Centro', active: true }, { id: SUR, name: 'Sur Prueba', active: true }, { id: 'c01a0000-0000-4000-8000-0000000000c0', name: 'Cerrado Prueba', active: false },
  ]))
  await page.route(new RegExp(`/rest/v1/supplier\\?.*id=eq\\.${PROVEEDOR}`), (r) =>
    new URL(r.request().url()).searchParams.get('select') === 'name' ? json(r, { name: 'Marcas de Prueba, SL' }) : r.fallback())
  await page.route(new RegExp(`/rest/v1/locations\\?.*id=eq\\.${NORTE}`), (r) =>
    new URL(r.request().url()).searchParams.get('select') === 'name' ? json(r, { name: 'Norte Centro' }) : r.fallback())
  await page.route(/\/rest\/v1\/rpc\/compras_socio_reglas(\?|$)/, (r) => json(r, []))
  await page.route(/\/rest\/v1\/rpc\/compras_socio_pendiente(\?|$)/, (r) => json(r, 0))
  await page.route(/\/rest\/v1\/rpc\/compras_socio_regla_guardar(\?|$)/, (r) => {
    const c = r.request().postDataJSON() as Record<string, unknown>
    return json(r, { concepto: c.p_concepto, clave: String(c.p_concepto).toLowerCase(), queEs: c.p_que_es, fecha: '2026-11-13T00:15:00Z', quien: 'Administración de Prueba' })
  })
  await page.route(/\/rest\/v1\/rpc\/compras_liquidacion_guardar(\?|$)/, (r) => { llamadas.push({ f: 'guardar', cuerpo: r.request().postDataJSON() }); return json(r, LIQ) })
  await page.route(/\/rest\/v1\/rpc\/compras_cierre_socio_usado(\?|$)/, (r) => {
    llamadas.push({ f: 'usado', cuerpo: r.request().postDataJSON() })
    return json(r, { pdf: 3, texto: 'Los 3 PDF del correo quedan con esta liquidación.' })
  })
  return llamadas
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('1 y 2 · el cierre del correo espera en Socios de marca, y se lee con su local', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)

  // 1 · El aviso.
  await page.goto('/conta/ventas/liquidaciones?mes=2026-10')
  const aviso = page.locator('[data-prueba="cierre-del-correo"]')
  await expect(aviso).toBeVisible({ timeout: 30_000 })
  await expect(aviso).toContainText('El cierre de octubre llegó por correo el 05/11, con sus 3 PDF. No son facturas de Compras: van a su liquidación de octubre')
  await expect(aviso).not.toContainText(TECNICAS)
  const leerlo = aviso.getByRole('link', { name: 'Leerlo' })
  const q = new URLSearchParams((await leerlo.getAttribute('href'))!.split('?')[1])
  // Le faltan las de dos locales: el local se pregunta al leerlo.
  expect([q.get('proveedor'), q.get('local'), q.get('mes'), q.get('correo')]).toEqual([PROVEEDOR, null, '2026-10-01', CORREO])
  await aviso.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/cierre-correo-aviso-${lado(page)}.png`, fullPage: true })

  // 2 · Leerlo: primero, de qué local es.
  await leerlo.click()
  const queLocal = page.locator('[data-prueba="cierre-que-local"]')
  await expect(queLocal).toContainText('¿De qué local es este cierre?', { timeout: 30_000 })
  await expect(queLocal.getByRole('button')).toHaveText(['Norte Centro', 'Sur Prueba'])
  await expect(page.getByLabel('Los PDF de la liquidación')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/cierre-correo-que-local-${lado(page)}.png`, fullPage: true })
  await queLocal.getByRole('button', { name: 'Norte Centro' }).click()
  await expect(page).toHaveURL(new RegExp(`local=${NORTE}`))

  // Con el local, lee los PDF del correo, y pregunta la línea nueva como siempre.
  await expect(page.locator('[data-prueba="cierre-leido"]')).toContainText('El cierre de octubre llegó por correo el 05/11, con sus 3 PDF. Los he leído aquí: AutoFactura-oct.pdf, Factura-oct.pdf, Resumen-de-Transaccion-oct.pdf.', { timeout: 30_000 })
  const pregunta = page.locator('[data-prueba="pregunta-linea"]')
  await expect(pregunta).toContainText('«Financiación inventario pendiente por pagar»')
  await pregunta.getByRole('button', { name: /Género que te cobrará el mes que viene/ }).click()
  const guardar = page.getByRole('button', { name: 'Guardar y comparar' })
  await expect(guardar).toBeEnabled()
  await expect(page.locator('main')).not.toContainText(TECNICAS)
  await page.screenshot({ path: `${DIR}/cierre-correo-leido-${lado(page)}.png`, fullPage: true })

  await guardar.click()
  await expect(page).toHaveURL(new RegExp(`/conta/compras/liquidacion/${LIQ}`), { timeout: 30_000 })
  expect(llamadas.find((x) => x.f === 'guardar')?.cuerpo).toMatchObject({ p_proveedor: PROVEEDOR, p_local: NORTE })
  expect(llamadas.find((x) => x.f === 'usado')?.cuerpo).toEqual({ p_liq: LIQ, p_email_id: CORREO })
  await expect(page.getByText('Los 3 PDF del correo quedan con esta liquidación.')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${DIR}/cierre-correo-guardado-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})
