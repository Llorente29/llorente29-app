/// <reference lib="dom" />
// tests/e2e/conta/s01l/retencion.spec.ts
//
// S01l · Una factura leída cuya retención no encajaba con ningún tipo entra sin
// ella, en revisión (conta_factura_desde_lectura, 0920). La ficha lo dice («La
// factura trae una retención de 123,45 €: elige su tipo.») y deja ponerla y
// elegir su tipo. Contra staging-conta (cuenta A), en ordenador y móvil: una
// factura inventada de «Mayorista Prueba Alfa» con su lectura hecha por el mismo
// lector de siempre (leerFactura), que se borra al acabar. No guarda nada.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'
import { leerFactura } from '../../../../supabase/functions/_shared/lecturaFactura'

const DIR = 'docs/conta/capturas/s01l'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const PROVEEDOR = enCarril('d0100000-0000-4000-8000-000000000001')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

async function preparar(s: Sesion, numero: string): Promise<string> {
  const lectura = leerFactura({
    document: { supplier_name: 'Mayorista Prueba Alfa', doc_number: numero, doc_date: hoy(), grand_total: 1086.55, tax_base_total: 1000, tax_total: 210 },
    factura: { invoice_kind: 'completa', tax_breakdown: [{ vat_pct: 21, base: 1000, vat_amount: 210 }], withholding_amount: 123.45 },
  }, { hoy: hoy() })
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: PROVEEDOR, invoice_date: hoy(), status: 'en_revision', source: 'manual',
    created_by_name: 'Prueba e2e S01l', doc_kind: 'invoice', invoice_number: numero, tax_base_total: 1000, tax_total: 210, grand_total: 1086.55,
    needs_review: true, notes: 'La factura trae una retención de 123,45 €: elige su tipo.', reading: lectura,
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  return f.datos[0].id
}

test('S01l · la retención leída que no encajaba: la ficha la propone y deja elegir su tipo', async ({ page }) => {
  test.setTimeout(120_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  let id: string | null = null
  try {
    id = await preparar(s, `RET${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`)
    await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`)
    await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })
    const aviso = page.locator('[data-prueba="retencion-sin-tipo"]')
    await expect(aviso).toContainText('La factura trae una retención de 123,45 €: elige su tipo.', { timeout: 30_000 })
    await expect(page.locator('[data-prueba="linea-retencion"]')).toHaveCount(0)
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/sin-tipo-${lado(page)}.png`, fullPage: true })

    await aviso.getByRole('button', { name: 'Ponerla y elegir su tipo' }).click()
    const linea = page.locator('[data-prueba="linea-retencion"]')
    await expect(linea).toBeVisible()
    await expect(linea.getByLabel('Importe de la retención')).toHaveValue('123,45')
    await expect(page.locator('[data-prueba="retencion-elige-tipo"]')).toContainText('Elige el tipo de la retención')
    await linea.getByLabel('Tipo de la retención').selectOption('15')
    await expect(page.locator('[data-prueba="retencion-elige-tipo"]')).toHaveCount(0)
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)
    expect(errores, 'errores de la página').toEqual([])
  } finally {
    if (id) await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
  }
})
