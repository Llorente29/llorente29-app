// tests/e2e/conta/i01e/ficha-libro.spec.ts
//
// I01e · La ficha de un proveedor traído de Diez enseña sus facturas del libro
// de IVA y los asientos de su cuenta, con su origen, en ordenador y en móvil,
// contra staging-conta. Antes decía «Aún no hay facturas suyas» (Julio, 20/10,
// Anthropic y HubRise, con 2 y 3 facturas en el libro del 3T).
//
// El proveedor es INVENTADO y de verdad (de la cuenta A, se borra al acabar),
// con su NIF-IVA ya comprobado en VIES (así la ficha no pregunta a VIES: un
// NIF inventado no existe). Lo de Diez —su 410, sus tres asientos traídos
// (dos facturas y el pago de la primera) y sus dos filas del libro— lo pone la red de la
// prueba: staging no tiene nada traído de Diez en A, y un asiento validado no
// se puede borrar después (deja huella para siempre). La forma es la medida en
// producción: source_type 'migrated', external_program 'diez', inversión del
// sujeto pasivo, total = base + cuota. Importes inventados.
//
// Y los dos detalles de la ficha: «✓ Comprobado en VIES…» en verde (no en el
// ámbar de los avisos) y la razón social sin nombre de ejemplo.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'La ficha del proveedor de Diez escribe un proveedor en la cuenta A: necesita su carril.')

const DIR = 'docs/conta/capturas/i01e'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = async (page: Page, nombre: string) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })
}

const CUENTA_410 = 'e2e10e00-0000-4000-8000-000000000001'
const ASIENTO = (n: number) => `e2e10e01-0000-4000-8000-00000000000${n}`
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

/** Lo de Diez de este proveedor: su 410, sus asientos traídos y su libro de IVA. */
async function conSuLibro(page: Page, supplierId: string) {
  await page.route(new RegExp(`/rest/v1/company_account_link\\?.*entity_id=eq\\.${supplierId}`), (r) => json(r, [{ company_account_id: CUENTA_410 }]))
  await page.route(new RegExp(`/rest/v1/company_account\\?.*${CUENTA_410}`), (r) => json(r, [{ id: CUENTA_410, code: '41000099', is_common: false }]))
  const diez = { status: 'validado', source_type: 'migrated', external_program: 'diez', voided_by_entry_id: null }
  await page.route(new RegExp(`/rest/v1/journal_ledger\\?.*${CUENTA_410}`), (r) => json(r, [
    { ...diez, entry_id: ASIENTO(1), series: 2, number: 901, entry_date: '2026-09-03', concept: 'Factura INV-E2E-0901', document_ref: 'INV-E2E-0901', debit: 0, credit: 18.5 },
    { ...diez, entry_id: ASIENTO(2), series: 1, number: 902, entry_date: '2026-09-04', concept: 'Pago INV-E2E-0901', document_ref: null, debit: 18.5, credit: 0 },
    { ...diez, entry_id: ASIENTO(3), series: 2, number: 1001, entry_date: '2026-10-03', concept: 'Factura INV-E2E-1001', document_ref: 'INV-E2E-1001', debit: 0, credit: 20 },
  ]))
  await page.route(/\/rest\/v1\/vat_book_entry\?.*e2e10e01/, (r) => json(r, [
    { entry_id: ASIENTO(1), series: null, number: 'INV-E2E-0901', issue_date: '2026-09-03', tax_base: 18.5, tax_amount: 3.89, total: 22.39, reverse_charge: true, source_type: 'migrated', source_id: null },
    { entry_id: ASIENTO(3), series: null, number: 'INV-E2E-1001', issue_date: '2026-10-03', tax_base: 20, tax_amount: 4.2, total: 24.2, reverse_charge: true, source_type: 'migrated', source_id: null },
  ]))
}

async function alta(s: Sesion, f: Record<string, unknown>): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, is_active: true, created_by_name: 'e2e I01e', ...f })
  if (r.status >= 300) throw new Error(`alta del proveedor: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos[0].id
}
async function fuera(s: Sesion, id: string) {
  const r = await rest(s, 'DELETE', `supplier?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (r.status >= 300) await rest(s, 'PATCH', `supplier?id=eq.${id}&account_id=eq.${CUENTA_A.id}`, { archived_at: new Date().toISOString(), is_active: false })
}

test('La ficha de un proveedor traído de Diez enseña sus facturas del libro y los asientos de su cuenta, con su origen', async ({ page }) => {
  const l = lado(page)
  const s = await pedirSesion(CUENTA_A.email)
  const ahora = new Date().toISOString()
  const id = await alta(s, { name: `De Diez e2e ${l} ${Date.now().toString(36)}`, legal_name: 'De Diez e2e SAS', tax_id: 'FR00123456789', tax_id_type: 'vat_eu', country_code: 'FR',
    tax_id_check_status: 'valid', tax_id_verified_at: ahora, tax_id_checked_at: ahora })
  try {
    await entrarComo(page, CUENTA_A.email)
    await conSuLibro(page, id)

    // La portada: las cifras ya no dicen «Aún no hay facturas suyas».
    await page.goto(`/kitchen/proveedores/${id}`)
    const cifras = page.locator(l === 'ordenador' ? '.cxp-cifras' : '.cxm-cifras')
    await expect(cifras).toContainText('2 facturas, del libro de IVA', { timeout: 20_000 })
    await expect(cifras).toContainText('Saldo de su cuenta 41000099')
    // Le debe la segunda: 18,50 + 20 − 18,50 de su cuenta.
    await expect(cifras).toContainText(l === 'ordenador' ? '20 €' : '20,00 €')
    await expect(page.getByText('Aún no hay facturas suyas')).toHaveCount(0)
    if (l === 'ordenador') {
      // La tarjeta «Facturas»: las dos de Diez, la más reciente primero.
      const filas = page.locator('[data-prueba="factura-libro"]')
      await expect(filas).toHaveCount(2)
      await expect(filas.first()).toContainText('INV-E2E-1001')
      await expect(filas.first()).toContainText('asiento 2/1001')
      await expect(filas.first()).toContainText('inversión del sujeto pasivo')
      await expect(filas.first().locator('[data-prueba="origen"]')).toHaveText('Traída de Diez')
    } else {
      await expect(page.getByRole('link', { name: /Facturas.*Última: 03\/10 · 20,00 €/ })).toBeVisible()
    }
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await foto(page, 'ficha-de-diez')

    // Facturas: las dos, con «Ver» a su asiento, y debajo los asientos de su cuenta con su origen.
    await page.goto(`/kitchen/proveedores/${id}/facturas`)
    await expect(page.locator('[data-prueba="factura-libro"]')).toHaveCount(2, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Ver el asiento de la factura INV-E2E-0901' })).toHaveAttribute('href', new RegExp(ASIENTO(1)))
    const asientos = page.locator('[data-prueba="asientos-cuenta"]')
    await expect(asientos.getByText('Asientos de su cuenta 41000099')).toBeVisible()
    await expect(asientos.locator('[data-prueba="origen-apunte"]')).toHaveText(['Traído de Diez', 'Traído de Diez', 'Traído de Diez'])
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await foto(page, 'facturas-de-diez')

    // Datos fiscales: comprobado en VIES, en verde; la razón social, sin ejemplo.
    await page.goto(`/kitchen/proveedores/${id}/datos-fiscales`)
    const bien = page.locator('[data-prueba="bien"]')
    await expect(bien).toHaveText(/^✓ Comprobado en VIES el \d{2}\/\d{2}\/\d{4}: el NIF-IVA está dado de alta\.$/, { timeout: 20_000 })
    // Los colores del módulo viven en su raíz, no en la del documento: se leen en el propio elemento.
    const { color, verde, ambar } = await bien.evaluate((e) => {
      const enRgb = (x: string) => { const d = document.createElement('i'); d.style.color = x; e.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r }
      const s = getComputedStyle(e)
      return { color: s.color, verde: enRgb(s.getPropertyValue('--cx-verde-oscuro').trim()), ambar: enRgb(s.getPropertyValue('--cx-ambar').trim()) }
    })
    expect(verde).not.toBe(ambar)
    expect(color).toBe(verde)
    expect(color).not.toBe(ambar)
    await expect(page.locator('#campo-taxId').locator('..').locator('.cx-aviso')).toHaveCount(0)
    await expect(page.getByText('Tal como sale en sus facturas', { exact: true })).toBeVisible()
    await expect(page.getByText(/Hermanos Ruiz/)).toHaveCount(0)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await foto(page, 'datos-fiscales')
  } finally {
    await fuera(s, id)
  }
})
