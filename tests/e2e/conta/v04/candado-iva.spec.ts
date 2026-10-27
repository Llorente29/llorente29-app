// tests/e2e/conta/v04/candado-iva.spec.ts
//
// V04 · Respuesta 5 · El candado del IVA presentado, en pantalla, en el
// ordenador y en el móvil, con el 3T de 2026 presentado el 20/10 (como Foodint):
//   1. La ficha de F-2026-0915 (Hermanos Ruiz, asiento del 24/09, validado y con
//      IVA): la franja con el mensaje de la base («El IVA del 3T de 2026 ya está
//      presentado (20/10). No se puede cambiar. Lo que haya que corregir va al
//      4T.») y SIN el botón «Anular», que llevaría a algo prohibido.
//   2. El libro diario: el candado junto a su fecha.
//   3. Impuestos › Trimestre: el candado en el 3T del selector y la línea de la
//      cabecera («IVA presentado 20/10 · Su IVA ya no se cambia…»).
// Lo que dice la base (conta_iva_presentados, de la 1233) está SIMULADO en el
// navegador con la forma que devuelve: staging solo la ensaya en ROLLBACK
// hasta que se aplique en producción y se fusione. Que la base PARA cada
// operación lo prueba la prueba de staging de la tanda
// (supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'El candado mira la empresa A de su carril (Impuestos se enciende y se apaga en la cuenta A).')

const DIR = 'docs/conta/capturas/v04'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

// Lo que devolvería conta_iva_presentados (1233) con el 3T de 2026 presentado el 20/10.
const TERCERO_2026 = [{
  periodo: '3T', ejercicio: 2026, desde: '2026-07-01', hasta: '2026-09-30', presentado: '2026-10-20T06:57:01+00:00',
  declaracion: '00000000-0000-4000-8000-000000000303', nombre: '3T de 2026', siguiente: '4T',
}]

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}
async function cargada(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}
async function entrar(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/conta_iva_presentados\b/, (r) => {
    const p = (r.request().postDataJSON() ?? {}) as { p_year?: number }
    return json(r, p.p_year === 2026 ? TERCERO_2026 : [])
  })
  await entrarComo(page, CUENTA_A.email)
}
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })

/** Enciende o apaga Impuestos en la cuenta A (como trimestre.spec.ts: la plataforma, y sin duplicar). */
async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e V04 candado del IVA (carril)' : 'e2e V04 candado del IVA (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

/** El asiento de F-2026-0915 en el carril (la semilla del C04: validado, del 24/09, con IVA). */
async function asientoDe0915(): Promise<string> {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest<{ id: string; entry_date: string; status: string }[]>(s, 'GET',
    `journal_entry?account_id=eq.${CUENTA_A.id}&document_ref=eq.F-2026-0915&source_type=eq.supplier_invoice&status=eq.validado&select=id,entry_date,status&limit=1`)
  expect(r.status, 'leer el asiento de F-2026-0915').toBeLessThan(300)
  expect(r.datos.length, 'la semilla del C04 deja F-2026-0915 validada en la cuenta A').toBe(1)
  expect(r.datos[0].entry_date).toBe('2026-09-24')
  return r.datos[0].id
}

test('El candado del IVA presentado: la ficha sin «Anular» y con el mensaje, el diario y el trimestre', async ({ page }) => {
  const errores = vigilar(page)
  const id = await asientoDe0915()
  await entrar(page)

  // 1 · La ficha: el mensaje de la base, y sin «Anular».
  await page.goto(`/conta/libros/diario/${id}?marca=sumied`)
  await cargada(page)
  const franja = page.locator('[data-prueba="iva-presentado"]')
  await expect(franja).toBeVisible({ timeout: 20_000 })
  await expect(franja).toHaveText('El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar. Lo que haya que corregir va al 4T.')
  await expect(page.getByRole('button', { name: 'Anular', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toHaveCount(0)
  await foto(page, 'candado-asiento')

  // 2 · El diario (en el ordenador, donde va la columna de la fecha): el candado junto a su fecha (24/09).
  if (lado(page) === 'ordenador') {
    await page.goto('/conta/libros/diario?marca=sumied')
    await cargada(page)
    const candado = page.locator('[data-prueba="candado-iva"]').first()
    await expect(candado).toBeAttached({ timeout: 20_000 })
    await expect(candado).toHaveAttribute('title', 'El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar.')
  }

  // 3 · Impuestos › Trimestre: el 3T con su candado, y la línea de la cabecera.
  await page.goto('/conta/impuestos/trimestre/2026/3T?marca=sumied')
  await expect(page.locator('[data-prueba="trimestre-iva-presentado"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-prueba="trimestre-iva-presentado"]')).toContainText('IVA presentado 20/10 · Su IVA ya no se cambia: lo que llegue tarde va al 4T.')
  await expect(page.getByRole('radio', { name: /3T/ }).locator('[data-prueba="candado-iva"]')).toHaveCount(1)
  await expect(page.getByRole('radio', { name: /4T/ }).locator('[data-prueba="candado-iva"]')).toHaveCount(0)
  await foto(page, 'candado-trimestre')

  expect(errores, 'errores de la página').toEqual([])
})
