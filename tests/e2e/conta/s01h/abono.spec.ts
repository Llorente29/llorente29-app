/// <reference lib="dom" />
// tests/e2e/conta/s01h/abono.spec.ts
//
// S01h · La ficha de un abono de proveedor en «Por revisar», contra
// staging-conta (cuenta A), en ordenador (1440) y móvil (390). Prepara por la
// API, con la sesión de la persona administradora de A y nombres y números
// inventados y únicos por ejecución: un proveedor, la factura que se anula, la
// que la sustituye (mismo importe) y el abono, ligado a la primera, con sus
// importes en negativo (10 % y 21 %). Lo borra al acabar. No valida nada: el
// enlace solo y la compensación los prueba la prueba de staging (desde la
// rama, la 1851 solo va a staging en ROLLBACK).
//
//   · el chip «Abono · a tu favor» y la miga «Por revisar»;
//   · ANULA: la factura, entera, y la que la sustituye;
//   · las cifras sin signo, y aparte «Total a tu favor 176,00 €», sin «sobran»;
//   · IVA (resta en el 303 del 4.º trimestre) y Pago (compensa la anulada).
// Las capturas van a docs/conta/capturas/s01h/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/s01h'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const QUIEN = 'Prueba e2e S01h'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()

interface Preparado { proveedor: string; facturas: string[] }

async function preparar(s: Sesion, nombre: string, marca: string): Promise<Preparado & { abono: string; anulada: string }> {
  const p = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, name: nombre })
  expect(p.status, `el proveedor de prueba: ${JSON.stringify(p.datos).slice(0, 300)}`).toBe(201)
  const proveedor = p.datos[0].id
  const factura = async (o: Record<string, unknown>) => {
    const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
      account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: proveedor, location_id: LOCAL_A,
      status: 'en_revision', source: 'manual', created_by_name: QUIEN, ...o,
    })
    expect(f.status, `una factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
    return f.datos[0].id
  }
  const anulada = await factura({ doc_kind: 'invoice', invoice_number: `${marca}-A`, invoice_date: '2026-10-12', tax_base_total: 150, tax_total: 26, grand_total: 176 })
  const sustituta = await factura({ doc_kind: 'invoice', invoice_number: `${marca}-S`, invoice_date: '2026-10-14', tax_base_total: 150, tax_total: 26, grand_total: 176 })
  const abono = await factura({
    doc_kind: 'credit_note', invoice_number: `${marca}-AB`, invoice_date: '2026-10-13', tax_base_total: -150, tax_total: -26, grand_total: -176,
    corrects_invoice_id: anulada, reading: { factura: { clase: 'rectificativa', rectificaA: `${marca}-A` } },
  })
  const t = await rest(s, 'POST', 'supplier_invoice_tax', [
    { account_id: CUENTA_A.id, supplier_invoice_id: abono, vat_pct: 21, base: -100, vat_amount: -21, surcharge_amount: 0 },
    { account_id: CUENTA_A.id, supplier_invoice_id: abono, vat_pct: 10, base: -50, vat_amount: -5, surcharge_amount: 0 },
  ])
  expect(t.status, `el IVA del abono: ${JSON.stringify(t.datos).slice(0, 300)}`).toBe(201)
  return { proveedor, facturas: [abono, sustituta, anulada], abono, anulada }
}

async function limpiar(s: Sesion, x: Preparado | null) {
  if (!x) return
  for (const id of x.facturas) {
    const d = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
    if (d.status >= 300) console.log(`[limpieza] la factura ${id}: HTTP ${d.status} ${JSON.stringify(d.datos).slice(0, 200)}`)
  }
  const d2 = await rest(s, 'DELETE', `supplier?account_id=eq.${CUENTA_A.id}&id=eq.${x.proveedor}`)
  if (d2.status >= 300) console.log(`[limpieza] el proveedor: HTTP ${d2.status} ${JSON.stringify(d2.datos).slice(0, 200)}`)
}

test('S01h · la ficha de un abono: sin signo, lo que anula, el IVA que resta y el pago que compensa', async ({ page }) => {
  test.setTimeout(150_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  const marca = `AB${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const nombre = `Proveedor de prueba ${marca}`
  let x: (Preparado & { abono: string; anulada: string }) | null = null
  try {
    x = await preparar(s, nombre, marca)
    await page.goto(`/conta/documentos/recibidas/${x.abono}?ver=por-revisar`)
    const ficha = page.locator('[data-prueba="ficha-recibida"]')
    await expect(ficha).toBeVisible({ timeout: 30_000 })

    await expect(page.locator('.s-encabezado').getByText('Abono · a tu favor')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-encabezado').getByRole('link', { name: 'Por revisar' })).toBeVisible()

    const anula = page.locator('[data-prueba="abono-anula"]')
    await expect(anula).toContainText('ANULA', { timeout: 30_000 })
    await expect(anula).toContainText(`La factura ${marca}-A · FAC-`)
    await expect(anula).toContainText('12/10/2026 · 176,00 € · lo anula entero.')
    await expect(anula).toContainText(`Lo sustituye la factura ${marca}-S (FAC-`)

    const totales = page.locator('[data-prueba="totales-iva"]')
    await expect(totales).toContainText('Total a tu favor')
    await expect(totales).toContainText('176,00 €')
    await expect(totales).not.toContainText('−')
    await expect(ficha).not.toContainText('sobran')

    await expect(page.locator('[data-prueba="abono-iva"]')).toContainText('IVA: resta en el 303 del 4.º trimestre')
    await expect(page.locator('[data-prueba="abono-iva"]')).toContainText('base −150,00 € y cuota −26,00 €')
    const pago = page.locator('[data-prueba="abono-pago"]')
    await expect(pago).toContainText('Pago: compensa la FAC-')
    await expect(pago).toContainText('al validar el asiento, las dos quedan saldadas, sin movimiento de banco.')

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
