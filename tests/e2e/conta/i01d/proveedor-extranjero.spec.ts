// tests/e2e/conta/i01d/proveedor-extranjero.spec.ts
//
// I01d · La ficha de un proveedor extranjero dice su país y cómo va su IVA,
// en palabras de oficina, en ordenador y en móvil, contra staging-conta. Dos
// proveedores INVENTADOS de la cuenta A (se borran al acabar):
//   · uno de Francia con su NIF-IVA ya comprobado en VIES (así la ficha no
//     pregunta a VIES de verdad: un NIF inventado no existe): «Compra en otro
//     país de la UE (Francia)», «Comprobado en VIES el …»;
//   · uno de Estados Unidos: «De fuera de la UE (Estados Unidos)», con el
//     país en palabras debajo de su código.
// Lo de «sin comprobar» (VIES no contesta) lo prueban las unitarias: aquí
// haría falta que VIES no contestara.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'La ficha del proveedor extranjero escribe proveedores en la cuenta A: necesita su carril.')

const DIR = 'docs/conta/capturas/i01d'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = async (page: Page, nombre: string) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })
}

async function alta(s: Sesion, f: Record<string, unknown>): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_A.id, is_active: true, created_by_name: 'e2e I01d', ...f })
  if (r.status >= 300) throw new Error(`alta del proveedor: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos[0].id
}
async function fuera(s: Sesion, id: string) {
  const r = await rest(s, 'DELETE', `supplier?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (r.status >= 300) await rest(s, 'PATCH', `supplier?id=eq.${id}&account_id=eq.${CUENTA_A.id}`, { archived_at: new Date().toISOString(), is_active: false })
}
async function ficha(page: Page, id: string) {
  await page.goto(`/kitchen/proveedores/${id}/datos-fiscales`)
  await expect(page.locator('[data-prueba="iva-clase"]')).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}

test('La ficha de un proveedor extranjero dice su país y cómo va su IVA (Francia con NIF-IVA comprobado; Estados Unidos)', async ({ page }) => {
  const l = lado(page)
  const s = await pedirSesion(CUENTA_A.email)
  const sufijo = `${l} ${Date.now().toString(36)}`
  const ahora = new Date().toISOString()
  const fr = await alta(s, { name: `Francesa e2e ${sufijo}`, legal_name: 'Francesa e2e SAS', tax_id: 'FR00123456789', tax_id_type: 'vat_eu', country_code: 'FR',
    tax_id_check_status: 'valid', tax_id_verified_at: ahora, tax_id_checked_at: ahora })
  const us = await alta(s, { name: `Americana e2e ${sufijo}`, legal_name: 'Americana e2e Inc.', tax_id: 'US-0000001', tax_id_type: 'foreign', country_code: 'US' })
  try {
    await entrarComo(page, CUENTA_A.email)

    await ficha(page, fr)
    // La cabecera, en el ordenador (en el móvil esta pantalla va sin ella).
    if (l === 'ordenador') await expect(page.locator('[data-prueba="pildora-iva"]').first()).toHaveText('Compra en otro país de la UE (Francia)')
    await expect(page.locator('[data-prueba="pais"]')).toContainText('País: Francia (sale de las dos letras de su NIF-IVA)')
    await expect(page.locator('[data-prueba="iva-clase"]')).toContainText('Su IVA: Compra en otro país de la UE (Francia)')
    await expect(page.locator('[data-prueba="iva-clase"]')).toContainText('472 y 477 por la misma cuota')
    // Comprobado: en verde de ayuda, no en el ámbar de los avisos.
    await expect(page.getByText(/^✓ Comprobado en VIES el \d{2}\/\d{2}\/\d{4}: el NIF-IVA está dado de alta\.$/)).toBeVisible()
    await foto(page, 'proveedor-ue')

    await ficha(page, us)
    if (l === 'ordenador') await expect(page.locator('[data-prueba="pildora-iva"]').first()).toHaveText('De fuera de la UE (Estados Unidos)')
    await expect(page.getByText('Estados Unidos.', { exact: true })).toBeVisible()
    await expect(page.locator('[data-prueba="iva-clase"]')).toContainText('Su IVA: De fuera de la UE (Estados Unidos)')
    await expect(page.locator('[data-prueba="iva-clase"]')).toContainText('inversión del sujeto pasivo')
    await foto(page, 'proveedor-fuera-ue')
  } finally {
    await fuera(s, fr)
    await fuera(s, us)
  }
})
