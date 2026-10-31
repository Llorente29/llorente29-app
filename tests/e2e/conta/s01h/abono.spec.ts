/// <reference lib="dom" />
// tests/e2e/conta/s01h/abono.spec.ts
//
// S01h · La ficha de un abono de proveedor en «Por revisar», contra
// staging-conta (cuenta A), en ordenador (1440) y móvil (390). Prepara por la
// API, con la sesión de la persona administradora de A y números inventados y
// únicos por ejecución, tres documentos de «Mayorista Prueba Alfa» (proveedor
// de la semilla de A, con NIF, su 40000006 y la 60000000 de gasto: el mismo
// plan que Europastry en Foodint): la factura que se anula, la que la
// sustituye y el abono, ligado a la primera, con las cifras del 1506416 (4 %
// sobre 26,58 y 10 % sobre 134,38; 175,46). Los borra al acabar. Las cuotas
// del abono se AÑADEN a las dos lecturas que las usan (la de la ficha,
// conta_factura_para_revisar, y la de la propuesta, supplier_invoice): la
// persona no escribe en supplier_invoice_tax (RLS). No valida nada: el enlace
// solo y la compensación los prueba la prueba de staging.
//
//   · el chip «Abono · a tu favor» y la miga «Por revisar»;
//   · ANULA: la factura, entera, y la que la sustituye;
//   · las cifras sin signo, y aparte «Total a tu favor 175,46 €», sin «sobran»;
//   · S01h · 1 · EL ASIENTO, línea a línea con su cuenta y su columna: Debe
//     40000006 175,46; Haber 60800000 160,96, 47200004 1,06 y 47200010 13,44
//     (en producción salía la 60000000 y el IVA sin cuenta al Debe);
//   · IVA (resta en el 303) y Pago, y el «Estado» del pago dice lo mismo que
//     el bloque, sin prometer el banco.
// Las capturas van a docs/conta/capturas/s01h/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/s01h'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const PROVEEDOR = enCarril('d0100000-0000-4000-8000-000000000001')
const QUIEN = 'Prueba e2e S01h'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const es = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

interface Preparado { facturas: string[]; abono: string }

async function preparar(s: Sesion, marca: string, dia: string): Promise<Preparado> {
  const factura = async (o: Record<string, unknown>) => {
    const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
      account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: PROVEEDOR, location_id: LOCAL_A, invoice_date: dia,
      status: 'en_revision', source: 'manual', created_by_name: QUIEN, ...o,
    })
    expect(f.status, `una factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
    return f.datos[0].id
  }
  const anulada = await factura({ doc_kind: 'invoice', invoice_number: `${marca}-A`, tax_base_total: 160.96, tax_total: 14.5, grand_total: 175.46 })
  const sustituta = await factura({ doc_kind: 'invoice', invoice_number: `${marca}-S`, tax_base_total: 160.96, tax_total: 14.5, grand_total: 175.46 })
  const abono = await factura({
    doc_kind: 'credit_note', invoice_number: `${marca}-AB`, tax_base_total: -160.96, tax_total: -14.5, grand_total: -175.46,
    corrects_invoice_id: anulada, reading: { factura: { clase: 'rectificativa', rectificaA: `${marca}-A` } },
  })
  return { facturas: [abono, sustituta, anulada], abono }
}

const CUOTAS_FICHA = [{ tipo: 10, base: -134.38, cuota: -13.44, recargo: 0 }, { tipo: 4, base: -26.58, cuota: -1.06, recargo: 0 }]
const CUOTAS_BASE = [{ vat_pct: 4, base: -26.58, vat_amount: -1.06 }, { vat_pct: 10, base: -134.38, vat_amount: -13.44 }]

/**
 * Las cuotas del abono, en negativo como las guarda la base: la persona no
 * escribe en supplier_invoice_tax (RLS, 42501), así que se AÑADEN a las dos
 * lecturas que las usan. La pantalla y la propuesta son las de verdad.
 */
async function conSusCuotas(page: Page, abono: string) {
  await page.route(/\/rest\/v1\/rpc\/conta_factura_para_revisar/, async (r) => {
    const real = await r.fetch()
    const cuerpo = await real.json() as { id?: string; tipos?: unknown[] }
    if (cuerpo?.id === abono) cuerpo.tipos = CUOTAS_FICHA
    await r.fulfill({ response: real, json: cuerpo })
  })
  await page.route((u) => u.pathname.endsWith('/rest/v1/supplier_invoice') && decodeURIComponent(u.search).includes('supplier_invoice_tax('), async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const real = await r.fetch()
    const cuerpo = await real.json() as unknown
    const poner = (x: { id?: string; supplier_invoice_tax?: unknown }) => { if (x?.id === abono) x.supplier_invoice_tax = CUOTAS_BASE }
    if (Array.isArray(cuerpo)) cuerpo.forEach(poner); else if (cuerpo && typeof cuerpo === 'object') poner(cuerpo as { id?: string })
    await r.fulfill({ response: real, json: cuerpo })
  })
}

/** Las líneas del asiento de la ficha: cuenta, Debe y Haber (las dos últimas cifras de cada fila). */
async function lineasDelAsiento(page: Page): Promise<string[][]> {
  const filas = page.locator('details.s-asiento-ficha tbody tr[data-linea]:not(.s-asiento-debajo)')
  const n = await filas.count()
  const out: string[][] = []
  for (let i = 0; i < n; i++) {
    const f = filas.nth(i)
    const codigo = (await f.locator('td.s-asiento-codigo').innerText()).trim()
    const cifras = (await f.locator('td.s-lista-cifra').allInnerTexts()).map((x) => x.replace(/[^\d,.-]/g, ''))
    out.push([codigo, ...cifras.slice(-2)])
  }
  return out
}

async function limpiar(s: Sesion, x: Preparado | null) {
  if (!x) return
  for (const id of x.facturas) {
    const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
    if (d.status >= 300) console.log(`[limpieza] la factura ${id}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
  }
}

test('S01h · la ficha de un abono: sin signo, lo que anula, el asiento al revés línea a línea, el IVA que resta y el pago que compensa', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  const marca = `AB${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const dia = hoy()
  let x: Preparado | null = null
  try {
    x = await preparar(s, marca, dia)
    await conSusCuotas(page, x.abono)
    await page.goto(`/conta/documentos/recibidas/${x.abono}?ver=por-revisar`)
    const ficha = page.locator('[data-prueba="ficha-recibida"]')
    await expect(ficha).toBeVisible({ timeout: 30_000 })

    await expect(page.locator('.s-encabezado').getByText('Abono · a tu favor').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-migas').getByRole('link', { name: 'Por revisar', exact: true }).first()).toBeVisible()

    const anula = page.locator('[data-prueba="abono-anula"]')
    await expect(anula).toContainText('ANULA', { timeout: 30_000 })
    await expect(anula).toContainText(`La factura ${marca}-A · FAC-`)
    await expect(anula).toContainText(`${es(dia)} · 175,46 € · lo anula entero.`)
    await expect(anula).toContainText(`Lo sustituye la factura ${marca}-S (FAC-`)

    const totales = page.locator('[data-prueba="totales-iva"]')
    await expect(totales).toContainText('Total a tu favor')
    await expect(totales).toContainText('175,46 €')
    await expect(totales).not.toContainText('−')
    await expect(ficha).not.toContainText('sobran')

    // S01h · 1 · El asiento, línea a línea: cuenta, columna e importe.
    const asiento = page.locator('details.s-asiento-ficha')
    await expect(asiento.locator('tbody tr[data-linea]:not(.s-asiento-debajo)')).toHaveCount(4, { timeout: 40_000 })
    expect(await lineasDelAsiento(page)).toEqual([
      ['40000006', '175,46', ''],
      ['60800000', '', '160,96'],
      ['47200004', '', '1,06'],
      ['47200010', '', '13,44'],
    ])
    await expect(asiento.locator('tfoot tr')).toHaveAttribute('data-cuadra', 'si')
    await expect(asiento).not.toContainText('Falta la cuenta')

    const tri = Math.ceil(Number(dia.slice(5, 7)) / 3)
    await expect(page.locator('[data-prueba="abono-iva"]')).toContainText(`IVA: resta en el 303 del ${tri}.º trimestre`)
    await expect(page.locator('[data-prueba="abono-iva"]')).toContainText('base −160,96 € y cuota −14,50 €')
    const pago = page.locator('[data-prueba="abono-pago"]')
    await expect(pago).toContainText('Pago: compensa la FAC-')
    await expect(pago).toContainText('al validar el asiento, las dos quedan saldadas, sin movimiento de banco.')
    // El «Estado» del bloque Pago dice lo mismo, sin prometer el banco (regla 8).
    const estado = page.locator('[data-prueba="campo-estado-pago"] .s-campo-ficha-motivo')
    await expect(estado).toContainText('Se compensa con la FAC-')
    await expect(estado).toContainText('al validar.')
    await expect(estado).not.toContainText('banco')

    // Sin desbordar en el móvil.
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)

    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/abono-${lado(page)}.png`, fullPage: true })
    expect(errores, 'errores de la página').toEqual([])
  } finally {
    await limpiar(s, x)
  }
})
