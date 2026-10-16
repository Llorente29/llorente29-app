/// <reference lib="dom" />
// tests/e2e/conta/c06/promociones.spec.ts
//
// C06b (16/10) · Cómo se ve en Libros el asiento de ventas del día con su
// línea de promoción y su línea de envío, y uno «Por aclarar» que no se valida.
// Capturas en docs/conta/capturas/c06b/, en ordenador y móvil.
//
// El asiento lo da la RED, no staging: Playwright contesta la lectura de ESTE
// asiento (ids inventados c06b9000-…) y, en el «Por aclarar», el intento de
// validar con lo que dice la base (el freno de la 20261116T0100, probado en
// supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql). Así no se
// siembra nada en la cuenta A, que comparten los frentes. Las líneas y las
// razones son las que sacan la base y el espejo del front con el ejemplo del
// diseño (tests/unit/modules/conta/promocionesEnvios.test.ts). Todo inventado.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c06b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const CON = enCarril('c06b9000-0000-4000-8000-000000000001')
const ACLARAR = enCarril('c06b9000-0000-4000-8000-000000000002')
const LOC = enCarril('c01a0000-0000-4000-8000-0000000000a2')

const cuenta = (code: string, name: string) => ({ code, name, kind: 'own', plain_name: null, template_code: code.slice(0, 3), plan: 'pymes' })
const linea = (position: number, code: string, name: string, debit: number, credit: number, concept: string, extra: Record<string, unknown> = {}) => ({
  position, company_account_id: enCarril(`c06b9100-0000-4000-8000-00000000000${position}`), debit, credit, concept, location_id: LOC, is_common: false,
  brand_id: null, document_ref: null, tax_rate_id: null, tax_base: null, vat_book: null, withholding_base: null, withholding_model: null, external_negative_side: null,
  company_account: cuenta(code, name), locations: { name: 'Local de prueba' }, brand: null, tax_rate: null, ...extra,
})
const RAZONES_BASE = [
  { decision: '2 tickets de tus marcas, 43,50 €', porque: 'una factura simplificada por pedido, anotadas juntas en un asiento resumen del día con base y cuota por tipo', cita: 'Código de Comercio, art. 28.2; RD 1624/1992 (Reglamento del IVA), art. 63.4' },
  { decision: 'IVA al 10 %', porque: 'reparto de comida = servicio de restauración: criterio de tu empresa', cita: 'Ley 37/1992, art. 91.Uno.2.2.º' },
  { decision: 'Promociones: 1 pedido, 10,00 € con el IVA dentro', porque: 'la venta va a precio de carta en su marca y la promoción, en su subcuenta (70009002), resta; el IVA va sobre lo que paga el cliente', cita: 'Ley 37/1992, art. 78.Tres.2.º' },
  { decision: 'Envíos cobrados: 1 pedido, 3,50 € con el IVA dentro', porque: 'lo repartimos nosotros: el envío es del restaurante y va a su subcuenta (70500001), con su local; forma parte de la base, al tipo de la venta', cita: 'Ley 37/1992, art. 78.Dos.1.º' },
  { decision: 'Base calculada', porque: 'algún pedido no trae la base imponible: la calculo del total al 10 % (el tipo de tus ventas); no la invento, la deduzco y lo digo' },
]
const asiento = (id: string, o: { total: number; venta: number; cuota: number; base: number; tickets: number; confianza: string; razones: unknown[]; porque: string }) => ({
  id, series: 1, number: null, entry_date: '2026-10-21', concept: 'Ventas Glovo · Local de prueba', source_type: 'sales_day', source_id: null, status: 'propuesto',
  confidence: o.confianza, reason: o.porque, reasons: o.razones, party_id: null, document_ref: null,
  external_program: null, external_series: null, external_number: null, validated_at: null, validated_by_name: null, chain_seq: null, prev_hash: null, hash: null,
  reverses_entry_id: null, voided_by_entry_id: null, voided_at: null, voided_by_name: null, void_reason: null, created_at: '2026-10-22T00:07:00Z', created_by_name: 'Folvy (cierre del día)',
  company_id: enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  journal_line: [
    linea(1, '43000001', 'GLOVO', o.total, 0, 'Cobra Glovo'),
    linea(2, '70009002', 'PROMOCIONES GLOVO', 9.09, 0, 'Promociones Glovo · 1 pedido'),
    linea(3, '70000001', 'VENTAS CASA LOLA', 0, o.venta, 'Ventas Casa Lola', { brand_id: enCarril('7e000000-0000-4000-8000-000000000b01'), brand: { name: 'Casa Lola', ownership_type: 'own' } }),
    linea(4, '70500001', 'ENVÍOS COBRADOS', 0, 3.18, 'Envíos cobrados · 1 pedido'),
    linea(5, '47700010', 'H.P. IVA REPERCUTIDO 10%', 0, o.cuota, 'IVA repercutido 10 %', { tax_rate_id: enCarril('c06b9200-0000-4000-8000-000000000001'), tax_base: o.base, vat_book: 'issued', tax_rate: { rate: 10 } }),
  ],
})
const ASIENTOS: Record<string, unknown> = {
  [CON]: asiento(CON, { total: 43.5, venta: 45.45, cuota: 3.96, base: 39.54, tickets: 2, confianza: 'probable', razones: RAZONES_BASE,
    porque: '2 tickets de tus marcas en Glovo cuadran con lo que cobra, al céntimo; base calculada al 10 %.' }),
  [ACLARAR]: asiento(ACLARAR, { total: 55.5, venta: 56.36, cuota: 5.05, base: 50.45, tickets: 3, confianza: 'duda',
    razones: [{ ...RAZONES_BASE[0], decision: '3 tickets de tus marcas, 55,50 €' }, ...RAZONES_BASE.slice(1), { decision: 'Mira esto',
      porque: 'Por aclarar: 1 pedido con envío y sin saber si es del restaurante (PR-3 · Casa Lola · envío 2,00 € · repartió la plataforma). Se resuelve con la liquidación de esa semana: si la plataforma lo paga, va a Envíos cobrados; si no, sale de la venta y del cobro. Hasta entonces no se valida.' }],
    porque: '3 tickets de tus marcas en Glovo cuadran con lo que cobra, al céntimo; base calculada al 10 %.' }),
}
const FRENO = 'No se valida: 1 pedido con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma). Se resuelve con la liquidación de esa semana.'

async function porLaRed(page: Page) {
  const json = (r: Route, cuerpo: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  await page.route(/\/rest\/v1\/journal_entry\?.*c06b9000/, (r) => {
    const id = Object.keys(ASIENTOS).find((k) => r.request().url().includes(k))
    const a = id ? ASIENTOS[id] : null
    // maybeSingle pide un objeto; si no, una lista.
    return (r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? json(r, a) : json(r, a ? [a] : [])
  })
  await page.route(/\/rest\/v1\/rpc\/journal_entry_validar/, (r) => json(r, { code: '23514', details: null, hint: null, message: FRENO }, 400))
}

test('Libros: el asiento del día con su promoción (al debe) y su envío cobrado, con sus razones y sus citas', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await porLaRed(page)
  await page.goto(`/conta/libros/diario/${CON}`)
  const apuntes = page.getByRole('region', { name: 'Apuntes' })
  await expect(apuntes).toContainText('PROMOCIONES GLOVO', { timeout: 20_000 })
  await expect(apuntes).toContainText('70009002')
  await expect(apuntes).toContainText('ENVÍOS COBRADOS')
  await expect(apuntes).toContainText('70500001')
  await expect(apuntes).toContainText('45,45')
  await expect(apuntes).toContainText('9,09')
  await expect(apuntes).toContainText('3,18')
  const ia = page.getByRole('region', { name: 'Por qué lo propongo así' })
  await expect(ia).toContainText('Promociones: 1 pedido, 10,00 € con el IVA dentro')
  await expect(ia).toContainText('Ley 37/1992, art. 78.Tres.2.º')
  await expect(ia).toContainText('Envíos cobrados: 1 pedido, 3,50 € con el IVA dentro')
  await expect(ia).toContainText('Ley 37/1992, art. 78.Dos.1.º')
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/promociones-asiento-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
})

test('Libros: un asiento «Por aclarar» dice qué pedido y por qué, y al validar no se valida y lo dice (regla 8)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await porLaRed(page)
  await page.goto(`/conta/libros/diario/${ACLARAR}`)
  const ia = page.getByRole('region', { name: 'Por qué lo propongo así' })
  await expect(ia).toContainText('Por aclarar: 1 pedido con envío', { timeout: 20_000 })
  await expect(ia).toContainText('PR-3 · Casa Lola · envío 2,00 € · repartió la plataforma')
  await page.getByRole('button', { name: 'Validar asiento' }).click()
  await expect(page.getByText(FRENO)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/promociones-por-aclarar-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
})
