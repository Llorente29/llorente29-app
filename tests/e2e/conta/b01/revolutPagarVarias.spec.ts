/// <reference lib="dom" />
// tests/e2e/conta/b01/revolutPagarVarias.spec.ts
//
// B01 Revolut · PR 3b · PAGAR VARIAS FACTURAS A LA VEZ CON REVOLUT, desde
// Compras › Pagos (maqueta v2, pantalla 4), en staging-conta, cuenta A, en
// ordenador (1440) y móvil (390).
//
// Como la e2e de Pagos del PC01 (pc01/pagos.spec.ts): la lista de Pagos
// (conta_pagos_lista) se simula con la forma de la base; los bancos de la
// empresa son los de staging, y uno de ellos hace de cuenta de Revolut (se
// intercepta su enlace con el banco). Lo del pago va INTERCEPTADO: quién paga,
// lo que prepara la base, el titular, la aprobación, la segunda y el envío.
// No se manda nada a ningún banco ni se escribe ningún pago.
//   1. Marcar dos facturas y elegir la cuenta de Revolut en «Desde»: el botón
//      principal es «Pagar las 2 con Revolut» y el fichero queda como segunda.
//   2. La ventana: cada factura con su IBAN y su titular; la que no coincide
//      no sale hasta «pagar igual» con su porqué; una sola segunda aprobación.
//   3. «Aprobar y pagar las 2» → la segunda con el PIN → salen a Revolut, y
//      Pagos lo dice. Se mandó una sola aprobación con las dos, y el porqué.
// Todo inventado (T11).

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, enCarril, entrarComo } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/b01-revolut'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOTE = 'e2e0b01c-0000-4000-8000-0000000000d3'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (route: Route, cuerpo: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
const dia = (d: number) => { const x = new Date(`${hoy()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
}

const fila = (x: Record<string, unknown>) => ({
  id: 'x', supplier_id: 's', proveedor: 'Proveedor', numero: 'N-1', fecha: dia(-30), vence: dia(5), total: 100, pagado: 0, pendiente: 100,
  estado: 'vence_semana', dias_vencida: null, forma: 'transfer', location_id: null, local: null, iban4: '1234', con_iban: true, con_cuenta: true, remesa: null, ...x,
})
const FACTURAS = [
  { id: 'e2e0b01c-0000-4000-8000-0000000000f1', proveedor: 'Suministros Varias Prueba SL', numero: 'SV-2026/11', importe: 1028.5, iban4: '1234', titular: 'coincide' },
  { id: 'e2e0b01c-0000-4000-8000-0000000000f2', proveedor: 'Carnes Varias Prueba SA', numero: 'CV-2026/22', importe: 310, iban4: '7788', titular: 'no_coincide' },
]

interface Mundo { pago: boolean; llamadas: Record<string, unknown>[] }

async function interceptar(page: Page, m: Mundo, cuentaRevolut: string) {
  await page.route(/\/rest\/v1\/rpc\/conta_pagos_lista(\?|$)/, (r) => json(r, {
    filas: FACTURAS.map((f) => fila({ id: f.id, supplier_id: `s-${f.iban4}`, proveedor: f.proveedor, numero: f.numero, total: f.importe, pendiente: f.importe, iban4: f.iban4 })),
    pagado_mes: 0, pagadas_mes: 0, sin_plazo: [],
  }))
  await page.route('**/rest/v1/bank_aggregator_link?*', (r) =>
    r.request().url().includes('provider=eq.revolut') ? json(r, [{ treasury_account_id: cuentaRevolut }]) : r.continue())
  await page.route('**/rest/v1/rpc/conta_pago_quien', (r) => json(r, { yo_puedo: true, soy_admin: true, n: 1, segunda: 'la_misma', personas: [{ nombre: 'Persona Prueba', yo: true }] }))
  await page.route('**/rest/v1/rpc/conta_pago_para_mi', (r) => json(r, []))
  await page.route('**/rest/v1/rpc/conta_pago_preparar', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}') as { p_invoice: string }
    const f = FACTURAS.find((x) => x.id === b.p_invoice)!
    await json(r, { se_puede: true, porque: null, numero: f.numero, beneficiario: f.proveedor, iban4: f.iban4, iban_check: f.titular === 'coincide' ? 'comprobado' : 'primer_pago',
      importe: f.importe, concepto: f.numero, motivos: f.titular === 'coincide' ? [] : ['iban_nuevo'], motivos_texto: f.titular === 'coincide' ? [] : ['IBAN nuevo'],
      salida: { proveedor: 'revolut', banco: 'Revolut', puede: true, porque: null },
      quien: { yo_puedo: true, soy_admin: true, n: 1, segunda: 'la_misma', personas: [{ nombre: 'Persona Prueba', yo: true }] } })
  })
  await page.route('**/rest/v1/rpc/conta_pago_aprobar', async (r) => {
    m.llamadas.push({ rpc: 'conta_pago_aprobar', ...(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>) })
    await json(r, { lote: LOTE, huella: 'b'.repeat(64), pagos: 2, total: 1338.5, estado: 'esperando_segunda',
      segunda: { quien: 'la_misma', motivos: ['iban_nuevo', 'pagar_igual'], motivos_texto: ['IBAN nuevo', 'pagar igual con un titular que no coincide'], personas: [] },
      frase: 'Aprobado por ti. Confírmalo con tu llave (IBAN nuevo, pagar igual con un titular que no coincide). Hasta entonces no sale nada.' })
  })
  await page.route('**/rest/v1/rpc/conta_pago_lote_ver', (r) => json(r, {
    lote: LOTE, estado: m.pago ? 'enviado' : 'esperando_segunda', huella: 'b'.repeat(64), creado: new Date().toISOString(), aprobado_por: 'Persona Prueba',
    desde: { nombre: 'Revolut · Principal', iban4: '5678', banco: 'Revolut' }, motivos: ['iban_nuevo', 'pagar_igual'], motivos_texto: ['IBAN nuevo', 'pagar igual con un titular que no coincide'],
    puedo_dar: true, no_puedo_porque: null, segunda: null, total: 1338.5,
    pagos: FACTURAS.map((f, i) => ({ id: `s-${i}`, factura: f.id, concepto: f.numero, beneficiario: f.proveedor, iban4: f.iban4, iban_check: f.titular === 'coincide' ? 'comprobado' : 'primer_pago',
      importe: f.importe, estado: 'esperando_segunda', motivos_texto: f.titular === 'coincide' ? [] : ['IBAN nuevo', 'pagar igual con un titular que no coincide'] })),
    historial: [] }))
  await page.route('**/functions/v1/conta-pagar', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>
    m.llamadas.push({ funcion: 'conta-pagar', ...b, pin: b.pin ? '······' : undefined })
    if (b.accion === 'titular') {
      const f = FACTURAS.find((x) => x.id === b.factura)!
      return json(r, { ok: true, titular: { resultado: f.titular } })
    }
    if (b.accion === 'pin_confirmar') return json(r, { ok: true, lote: LOTE, pagos: 2, texto: 'Confirmado con tu PIN de pago: 2 pagos para mandar.' })
    if (b.accion === 'mandar') { m.pago = true; return json(r, { ok: true, texto: 'Enviado a Revolut: 2 pagos. Te avisamos cuando lo confirme.', bien: 2, rechazados: 0, sin_saber: 0 }) }
    return json(r, { ok: false, texto: 'No interceptado.' })
  })
}

test.describe('B01 Revolut · pagar varias facturas con Revolut', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('dos facturas, una sola aprobación: la que no coincide sale con «pagar igual», y salen juntas a Revolut', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_A.email)
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(e.message) })
    // Un banco de verdad de la empresa A, con IBAN, hace de cuenta de Revolut.
    const b = await rest<{ id: string }[]>(s, 'GET', `treasury_account?select=id&company_id=eq.${EMPRESA_A}&kind=eq.bank&is_active=eq.true&iban=not.is.null&order=name&limit=1`)
    expect(b.status, JSON.stringify(b.datos).slice(0, 200)).toBe(200)
    expect(b.datos.length, 'la empresa A no tiene ningún banco con IBAN').toBe(1)
    const cuentaRevolut = b.datos[0].id
    const m: Mundo = { pago: false, llamadas: [] }
    await interceptar(page, m, cuentaRevolut)

    // 1 · Marcar las dos y elegir la cuenta de Revolut.
    await page.goto('/conta/compras/pagos')
    await expect(page.getByRole('heading', { level: 1, name: 'Pagos' })).toBeVisible({ timeout: 30_000 })
    for (const f of FACTURAS) await page.getByRole('checkbox', { name: new RegExp(`^Marcar ${f.proveedor}`) }).check()
    const barra = page.getByRole('region', { name: 'Pagar las seleccionadas' })
    await barra.getByLabel('Desde qué banco se paga').selectOption(cuentaRevolut)
    await expect(barra.locator('[data-prueba="pagar-con-banco"]')).toContainText('Pagar las 2 con Revolut', { timeout: 30_000 })
    await expect(barra.locator('[data-prueba="preparar-fichero"]')).toHaveText('Preparar el fichero SEPA')
    await capturar(page, 'v1-pagar-las-2')

    // 2 · La ventana: el titular de la segunda no coincide.
    await barra.locator('[data-prueba="pagar-con-banco"]').click()
    const dialogo = page.getByRole('dialog', { name: 'Pagar con Revolut' })
    const filas = dialogo.locator('[data-prueba="fila-varias"]')
    await expect(filas.nth(0)).toHaveAttribute('data-sale', 'si', { timeout: 30_000 })
    await expect(filas.nth(0)).toContainText('✓ Revolut dice que coincide')
    await expect(filas.nth(1)).toHaveAttribute('data-sale', 'no')
    await expect(filas.nth(1)).toContainText('No sale: El titular no coincide')
    await expect(dialogo.locator('[data-prueba="resumen-varias"]')).toContainText('Salen 1 pago, 1.028,50 €, con una sola aprobación. 1 se queda por pagar.')
    await capturar(page, 'v2-titular-no-coincide')
    await filas.nth(1).getByLabel('Lo he comprobado con el proveedor: pagar igual').check()
    await filas.nth(1).getByRole('textbox', { name: `Por qué pagar igual a ${FACTURAS[1].proveedor}` }).fill('Confirmado por teléfono con el proveedor.')
    await expect(filas.nth(1)).toHaveAttribute('data-sale', 'si')
    await expect(dialogo.locator('[data-prueba="resumen-varias"]')).toContainText('Salen 2 pagos, 1.338,50 €, con una sola aprobación.')
    await expect(dialogo.locator('[data-prueba="pide-segunda-varias"]')).toContainText('IBAN nuevo, pagar igual con un titular que no coincide')
    await expect(dialogo.locator('[data-prueba="pide-segunda-varias"]')).toContainText('una sola para todos')
    await capturar(page, 'v3-salen-las-2')

    // 3 · Aprobar las dos, la segunda con el PIN, y a Revolut.
    await dialogo.locator('[data-prueba="aprobar-y-pagar-varias"]').click()
    const segunda = page.getByRole('dialog', { name: 'Confirma con tu llave los 2 pagos que salen ahora' })
    await expect(segunda.locator('[data-prueba="lista-segunda"] li')).toHaveCount(2)
    await segunda.getByRole('button', { name: 'Usar mi PIN de pago' }).click()
    const conPin = page.getByRole('dialog', { name: 'Confirma con tu PIN de pago los 2 pagos que salen ahora' })
    await conPin.locator('[data-prueba="pin-pago"]').fill('407219')
    await conPin.locator('[data-prueba="confirmar-pin"]').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('[data-prueba="aviso-pagos"]')).toContainText('Enviado a Revolut: 2 pagos. Te avisamos cuando lo confirme.')
    await capturar(page, 'v4-enviadas')

    // Una sola aprobación con las dos facturas, desde la cuenta de Revolut, y el porqué de «pagar igual» en la que no coincidía.
    const aprobaciones = m.llamadas.filter((l) => l.rpc === 'conta_pago_aprobar')
    expect(aprobaciones).toHaveLength(1)
    expect(aprobaciones[0]).toMatchObject({ p_company: EMPRESA_A, p_treasury: cuentaRevolut,
      p_facturas: [{ id: FACTURAS[0].id }, { id: FACTURAS[1].id, pagar_igual_porque: 'Confirmado por teléfono con el proveedor.' }] })
    expect((aprobaciones[0].p_facturas as Record<string, unknown>[])[0]).not.toHaveProperty('pagar_igual_porque')
    expect(m.llamadas.filter((l) => l.accion === 'titular')).toHaveLength(2)
    expect(m.llamadas.some((l) => l.accion === 'mandar' && l.lote === LOTE)).toBe(true)
    expect(errores, errores.join('\n')).toEqual([])
  })
})
