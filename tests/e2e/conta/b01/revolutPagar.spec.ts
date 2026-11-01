/// <reference lib="dom" />
// tests/e2e/conta/b01/revolutPagar.spec.ts
//
// B01 Revolut · PR 2c-2 · PAGAR UNA FACTURA CON REVOLUT, desde su ficha, en
// staging-conta, cuenta B, en ordenador (1440) y móvil (390).
//
// La factura y su proveedor son DE VERDAD: se crean por la API con la sesión
// de la administradora de B (nombres inventados y únicos por ejecución) y se
// borran al acabar. Lo del pago va INTERCEPTADO: las cuentas con las que se
// paga, quién paga, el panel, el titular, la aprobación, la segunda y el envío
// a Revolut. Esta prueba no manda nada a ningún banco ni escribe ningún pago.
// Lo de verdad con el sandbox va en la e2e de pagar con la conexión que
// autoriza Julio.
//   1. Quien no puede pagar: «Pídeselo a …, que puede pagar», sin botón.
//   2. Quien puede: «Pagar con Revolut» → el panel (importe, a quién, IBAN
//      nuevo, desde, concepto, «✓ Revolut dice que coincide») y por qué hace
//      falta la segunda aprobación.
//   3. «Aprobar y pagar» → la segunda aprobación con la lista exacta → «Usar mi
//      PIN de pago» → un PIN equivocado lo dice (quedan 4) → el bueno manda a
//      Revolut y la ficha lo dice: «Enviado a Revolut».
// Todo inventado (T11).

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_B, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/b01-revolut'
/** La empresa de la cuenta B («Cocina de Prueba Sur»). */
const EMPRESA_B = enCarril('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6')
/** Una cuenta de Revolut que no existe en staging: solo la ven las respuestas interceptadas. */
const CUENTA_REVOLUT = 'e2e0b01c-0000-4000-8000-0000000000c1'
const LOTE = 'e2e0b01c-0000-4000-8000-0000000000d1'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const json = (route: Route, cuerpo: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
}

async function preparar(s: Sesion, nombre: string, numero: string): Promise<{ proveedor: string; factura: string }> {
  const p = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_B.id, name: nombre, payment_method: 'transfer' })
  expect(p.status, `el proveedor de prueba: ${JSON.stringify(p.datos).slice(0, 300)}`).toBe(201)
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_B.id, company_id: EMPRESA_B, supplier_id: p.datos[0].id, doc_kind: 'invoice', invoice_number: numero, invoice_date: hoy(),
    due_date: hoy(), status: 'aprobada', source: 'manual', payment_method: 'transfer', tax_base_total: 850, tax_total: 178.5, grand_total: 1028.5,
    created_by_name: 'Prueba e2e B01 2c-2',
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  return { proveedor: p.datos[0].id, factura: f.datos[0].id }
}

async function limpiar(s: Sesion, x: { proveedor: string; factura: string } | null) {
  if (!x) return
  const d1 = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_B.id}&id=eq.${x.factura}`)
  if (d1.status >= 300) console.log(`[limpieza] la factura: HTTP ${d1.status} ${JSON.stringify(d1.datos).slice(0, 200)}`)
  const d2 = await rest(s, 'DELETE', `supplier?account_id=eq.${CUENTA_B.id}&id=eq.${x.proveedor}`)
  if (d2.status >= 300) console.log(`[limpieza] el proveedor: HTTP ${d2.status} ${JSON.stringify(d2.datos).slice(0, 200)}`)
}

interface Mundo { yoPuedo: boolean; pago: null | 'esperando_segunda' | 'enviando'; pinMal: number; llamadas: Record<string, unknown>[] }

/** Lo del pago, interceptado. Lo demás de la ficha va a staging de verdad. */
async function interceptar(page: Page, m: Mundo, beneficiario: string, numero: string) {
  await page.route('**/rest/v1/bank_aggregator_link?*', (route) =>
    route.request().url().includes('provider=eq.revolut') ? json(route, [{ treasury_account_id: CUENTA_REVOLUT }]) : route.continue())
  await page.route('**/rest/v1/treasury_account?*', (route) =>
    route.request().url().includes(CUENTA_REVOLUT) ? json(route, [{ id: CUENTA_REVOLUT, name: 'Revolut · Principal', iban: 'ES0099990000000000005678', is_active: true }]) : route.continue())
  await page.route('**/rest/v1/conta_pago_salida?*', (route) => json(route, m.pago
    ? [{ lote_id: LOTE, estado: m.pago, estado_porque: null, amount: 1028.5, created_at: new Date().toISOString() }] : []))
  await page.route('**/rest/v1/rpc/conta_pago_quien', (route) => json(route, {
    yo_puedo: m.yoPuedo, soy_admin: m.yoPuedo, n: 1, segunda: 'la_misma', personas: [{ nombre: 'Persona Prueba', yo: m.yoPuedo }] }))
  await page.route('**/rest/v1/rpc/conta_pago_preparar', (route) => json(route, {
    se_puede: true, porque: null, numero, beneficiario, iban4: '1234', iban_check: 'primer_pago', iban_nota: null, importe: 1028.5, pendiente: 1028.5,
    concepto: numero, motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'], tope_pago: 3000, tope_dia: 10000, aprobado_hoy: 0,
    salida: { proveedor: 'revolut', banco: 'Revolut', puede: true, porque: null },
    quien: { yo_puedo: true, soy_admin: true, n: 1, segunda: 'la_misma', personas: [{ nombre: 'Persona Prueba', yo: true }] } }))
  await page.route('**/rest/v1/rpc/conta_pago_aprobar', async (route) => {
    m.llamadas.push({ rpc: 'conta_pago_aprobar', ...(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>) })
    m.pago = 'esperando_segunda'
    await json(route, { lote: LOTE, huella: 'a'.repeat(64), pagos: 1, total: 1028.5, estado: 'esperando_segunda',
      segunda: { quien: 'la_misma', motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'], personas: [] },
      frase: 'Aprobado por ti. Confírmalo con tu llave (IBAN nuevo). Hasta entonces no sale nada.' })
  })
  await page.route('**/rest/v1/rpc/conta_pago_lote_ver', (route) => json(route, {
    lote: LOTE, estado: m.pago === 'esperando_segunda' ? 'esperando_segunda' : 'enviado', huella: 'a'.repeat(64), creado: new Date().toISOString(), aprobado_por: 'Persona Prueba',
    desde: { nombre: 'Revolut · Principal', iban4: '5678', banco: 'Revolut' }, motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'],
    puedo_dar: true, no_puedo_porque: null, segunda: null, total: 1028.5,
    pagos: [{ id: 'e2e-s1', factura: 'f', concepto: numero, beneficiario, iban4: '1234', iban_check: 'primer_pago', importe: 1028.5, estado: 'esperando_segunda', motivos_texto: ['IBAN nuevo'] }],
    historial: [] }))
  await page.route('**/functions/v1/conta-pagar', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    m.llamadas.push({ funcion: 'conta-pagar', ...b, pin: b.pin ? '······' : undefined })
    if (b.accion === 'titular') return json(route, { ok: true, titular: { resultado: 'coincide' } })
    if (b.accion === 'pin_confirmar') {
      if (m.pinMal === 0) { m.pinMal++; return json(route, { ok: false, quedan: 4, texto: 'Ese no es tu PIN de pago. Te quedan 4 intentos. Con 5 fallos se bloquea y tendrás que recuperarlo con el código del correo. Los pagos siguen aprobados y esperando.' }) }
      return json(route, { ok: true, lote: LOTE, pagos: 1, texto: 'Confirmado con tu PIN de pago: 1 pago para mandar.' })
    }
    if (b.accion === 'mandar') { m.pago = 'enviando'; return json(route, { ok: true, texto: 'Enviado a Revolut: 1 pago. Te avisamos cuando lo confirme.', bien: 1, rechazados: 0, sin_saber: 0 }) }
    return json(route, { ok: false, texto: 'No interceptado.' })
  })
}

test.describe('B01 Revolut · pagar una factura con Revolut', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('quien no puede pagar lo pide; quien puede aprueba, confirma con su PIN y sale a Revolut', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_B.email)
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(e.message) })
    const marca = `PR2${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
    const beneficiario = `Suministros Prueba ${marca}`
    const numero = `${marca}-1`
    const m: Mundo = { yoPuedo: false, pago: null, pinMal: 0, llamadas: [] }
    let x: { proveedor: string; factura: string } | null = null
    try {
      x = await preparar(s, beneficiario, numero)
      await interceptar(page, m, beneficiario, numero)

      // 1 · Quien no puede pagar.
      await page.goto(`/conta/documentos/recibidas/${x.factura}`)
      await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
      const bloque = page.locator('[data-prueba="pagar-con-banco"]')
      await expect(bloque.locator('[data-prueba="pideselo"]')).toHaveText('Pídeselo a Persona Prueba, que puede pagar.', { timeout: 30_000 })
      await expect(bloque.getByRole('button', { name: 'Pagar con Revolut' })).toHaveCount(0)

      // 2 · Quien puede: el panel.
      m.yoPuedo = true
      await page.reload()
      await bloque.getByRole('button', { name: 'Pagar con Revolut' }).click({ timeout: 30_000 })
      const resumen = bloque.locator('[data-prueba="resumen-pago"]')
      await expect(resumen).toContainText('1.028,50 €')
      await expect(resumen).toContainText(beneficiario)
      await expect(resumen).toContainText('···1234 · nuevo')
      await expect(resumen).toContainText(numero)
      await expect(bloque.locator('[data-prueba="titular"]')).toHaveText('✓ Revolut dice que coincide')
      await expect(bloque.locator('[data-prueba="pide-segunda"]')).toContainText('Hace falta una segunda aprobación (IBAN nuevo).')
      await capturar(page, 'q1-pagar-con-revolut')

      // 3 · Aprobar, la segunda con el PIN, y a Revolut.
      await bloque.locator('[data-prueba="aprobar-y-pagar"]').click()
      const segunda = page.getByRole('dialog', { name: 'Confirma con tu llave el pago que sale ahora' })
      await expect(segunda.locator('[data-prueba="lista-segunda"]')).toContainText(`${beneficiario} · ${numero} · IBAN ···1234 · IBAN nuevo · 1.028,50 €`)
      await capturar(page, 'q2-segunda-con-llave')
      await segunda.getByRole('button', { name: 'Usar mi PIN de pago' }).click()
      const conPin = page.getByRole('dialog', { name: 'Confirma con tu PIN de pago el pago que sale ahora' })
      await conPin.locator('[data-prueba="pin-pago"]').fill('000000')
      await conPin.locator('[data-prueba="confirmar-pin"]').click()
      await expect(conPin.getByRole('alert')).toContainText('Ese no es tu PIN de pago. Te quedan 4 intentos.')
      await capturar(page, 'q3-pin-equivocado')
      await conPin.locator('[data-prueba="pin-pago"]').fill('407219')
      await conPin.locator('[data-prueba="confirmar-pin"]').click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(bloque.getByRole('status').filter({ hasText: 'Enviado a Revolut: 1 pago. Te avisamos cuando lo confirme.' })).toBeVisible()
      await expect(bloque.locator('[data-prueba="pago-estado"]')).toContainText('Enviado a Revolut. Te avisamos cuando lo confirme. · 1.028,50 €')
      await expect(bloque.getByRole('button', { name: 'Pagar con Revolut' })).toHaveCount(0)
      await capturar(page, 'q4-enviado-a-revolut')

      // Lo que se mandó: una aprobación de esta factura desde la cuenta de Revolut, el PIN con la huella de la lista, y el envío del lote.
      const aprobar = m.llamadas.find((l) => l.rpc === 'conta_pago_aprobar')!
      expect(aprobar).toMatchObject({ p_company: EMPRESA_B, p_treasury: CUENTA_REVOLUT, p_facturas: [{ id: x.factura }] })
      expect(m.llamadas.filter((l) => l.accion === 'pin_confirmar').every((l) => l.lote === LOTE && l.huella === 'a'.repeat(64))).toBe(true)
      expect(m.llamadas.some((l) => l.accion === 'mandar' && l.lote === LOTE)).toBe(true)
      expect(errores, errores.join('\n')).toEqual([])
    } finally {
      await page.close().catch(() => {})
      await limpiar(s, x)
    }
  })
})
