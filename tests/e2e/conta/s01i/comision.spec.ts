/// <reference lib="dom" />
// tests/e2e/conta/s01i/comision.spec.ts
//
// S01i · La ficha de una factura de comisión de una plataforma, contra
// staging-conta (cuenta A), en ordenador (1440) y móvil (390). Prepara por la
// API una factura inventada de «Mayorista Prueba Alfa» (de la semilla de A) y
// la borra al acabar. Lo que dice la base de su liquidación
// (conta_comision_de_la_factura) y el ligar (conta_comision_ligar) se SIMULAN
// aquí, con números inventados: en staging no hay liquidaciones de plataforma
// de la cuenta A, y lo que elige la liquidación y la paga por compensación lo
// prueba la prueba de staging (supabase/staging/sql/20261101_s01i_comisiones_prueba.sql).
// La pantalla es la de verdad:
//
//   · ligada: «Se paga con la liquidación», su periodo, lo que suman sus
//     facturas contra lo que factura, y «Estado» sin prometer el banco;
//   · sin ligar: «No sé con qué liquidación va», el porqué y las que encajan;
//     se elige una con un toque y la ficha dice lo que ha pasado (regla 8).
// Las capturas van a docs/conta/capturas/s01i/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/s01i'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const PROVEEDOR = enCarril('d0100000-0000-4000-8000-000000000001')
const QUIEN = 'Prueba e2e S01i'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

async function preparar(s: Sesion, numero: string): Promise<string> {
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: PROVEEDOR, location_id: LOCAL_A, invoice_date: hoy(),
    status: 'en_revision', source: 'manual', created_by_name: QUIEN, doc_kind: 'invoice', invoice_number: numero,
    tax_base_total: 44.45, tax_total: 9.34, grand_total: 53.79,
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  return f.datos[0].id
}

const LIQ = { id: 'l0000000-0000-4000-8000-000000000001', desde: '2026-10-12', hasta: '2026-10-18' }
const ligada = (numero: string) => ({
  estado: 'ligada', plataforma: 'Plataforma de Prueba', liquidacion: LIQ.id,
  liq: { ...LIQ, tienda: 'Marca Uno', marca: 'Marca Uno', local: 'Local Norte', a_facturar: 53.79, te_pago: 66.78, referencia: false, fecha: '2026-10-20',
    facturas: [{ id: 'x', codigo: 'FAC-00001', numero, total: 53.79 }] },
})
const sinLigar = {
  estado: 'varias', plataforma: 'Plataforma de Prueba',
  porque: 'Hay 2 liquidaciones de Plataforma de Prueba del 12/10 al 18/10 de Marca Dos, y la factura no dice la dirección de la tienda.',
  candidatas: [
    { id: LIQ.id, desde: LIQ.desde, hasta: LIQ.hasta, tienda: 'Marca Dos', marca: 'Marca Dos', local: 'Local Norte', a_facturar: 82.72, ya_facturado: 0, te_pago: 216.92, referencia: false, coincide: false },
    { id: 'l0000000-0000-4000-8000-000000000002', desde: LIQ.desde, hasta: LIQ.hasta, tienda: 'Marca Dos', marca: 'Marca Dos', local: 'Local Sur', a_facturar: 63.66, ya_facturado: 0, te_pago: 66.94, referencia: false, coincide: false },
  ],
}

async function simular(page: Page, factura: string, inicial: unknown, despues: unknown) {
  let ligadaYa = false
  await page.route(/\/rest\/v1\/rpc\/conta_comision_de_la_factura/, async (r) => {
    const cuerpo = r.request().postDataJSON() as { p_invoice?: string }
    if (cuerpo?.p_invoice !== factura) return r.fulfill({ json: { estado: 'no' } })
    await r.fulfill({ json: ligadaYa ? despues : inicial })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_comision_ligar/, async (r) => {
    const cuerpo = r.request().postDataJSON() as { p_invoice?: string; p_settlement?: string }
    expect(cuerpo).toMatchObject({ p_invoice: factura, p_settlement: LIQ.id })
    ligadaYa = true
    await r.fulfill({ json: { liquidacion: LIQ.id, pagada: false, texto: 'Ligada con la liquidación del 12/10 al 18/10/2026: quedará pagada por compensación al validarla.' } })
  })
}

async function limpiar(s: Sesion, id: string | null) {
  if (!id) return
  const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
  if (d.status >= 300) console.log(`[limpieza] la factura ${id}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
}

const sinDesbordar = async (page: Page) => {
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)
}

test('S01i · una factura de comisión ligada: se paga con su liquidación, no por banco', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  const numero = `CM${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  let id: string | null = null
  try {
    id = await preparar(s, numero)
    await simular(page, id, ligada(numero), ligada(numero))
    await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`)
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
    const b = page.locator('[data-prueba="comision"]')
    await expect(b).toHaveAttribute('data-estado', 'ligada', { timeout: 30_000 })
    await expect(b).toContainText('SE PAGA CON LA LIQUIDACIÓN')
    await expect(b).toContainText('Liquidación de Plataforma de Prueba del 12/10 al 18/10/2026')
    await expect(b).toContainText('Marca Uno · Local Norte. La liquidación factura 53,79 € y te pagó 66,78 €')
    await expect(page.locator('[data-prueba="comision-cuadre"]')).toHaveText('Su factura de comisión: 53,79 €, lo mismo que factura la liquidación.')
    const estado = page.locator('[data-prueba="campo-estado-pago"] .s-campo-ficha-motivo')
    await expect(estado).toContainText('Se paga por compensación con su liquidación al validarla: no se paga por banco.')
    await expect(estado).not.toContainText('Se casará sola con el banco')
    await sinDesbordar(page)
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/ligada-${lado(page)}.png`, fullPage: true })
    expect(errores, 'errores de la página').toEqual([])
  } finally {
    await limpiar(s, id)
  }
})

test('S01i · una factura de comisión sin ligar: el porqué, las que encajan y elegir una con un toque', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  const numero = `CS${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  let id: string | null = null
  try {
    id = await preparar(s, numero)
    await simular(page, id, sinLigar, ligada(numero))
    await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`)
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
    const b = page.locator('[data-prueba="comision"]')
    await expect(b).toHaveAttribute('data-estado', 'varias', { timeout: 30_000 })
    await expect(b).toContainText('No sé con qué liquidación va')
    await expect(b).toContainText('la factura no dice la dirección de la tienda. Hasta que la elijas no sale en Pagos ni en Bancos.')
    const lista = b.getByRole('list', { name: 'Liquidaciones que encajan' })
    await expect(lista.getByRole('listitem')).toHaveCount(2)
    await expect(lista.getByRole('listitem').first()).toContainText('Marca Dos · Local Norte · del 12/10 al 18/10 · factura 82,72 €')
    await sinDesbordar(page)
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/sin-ligar-${lado(page)}.png`, fullPage: true })

    await lista.getByRole('listitem').first().getByRole('button', { name: 'Es esta' }).click()
    await expect(page.locator('[data-prueba="comision-mensaje"]')).toHaveText('Ligada con la liquidación del 12/10 al 18/10/2026: quedará pagada por compensación al validarla.', { timeout: 30_000 })
    await expect(b).toHaveAttribute('data-estado', 'ligada', { timeout: 30_000 })
    expect(errores, 'errores de la página').toEqual([])
  } finally {
    await limpiar(s, id)
  }
})
