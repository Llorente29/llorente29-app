// tests/e2e/conta/v04/reabrir-iva.spec.ts
//
// V04 · Respuesta 5, punto 3 · «Reabrir para corregir», en pantalla, en el
// ordenador y en el móvil, en Impuestos › Trimestre del 2T de 2026 de la
// empresa A:
//   1. Presentado: «Más» › «Reabrir para corregir el 2T»; el diálogo dice
//      «¿Solo es una factura recibida? Se deduce en el 3T sin reabrir», pide un
//      motivo y la confirmación («La presentación del 20/07 se queda como
//      estaba…»), y no deja reabrir sin las dos. Al reabrir, lo dice (regla 8).
//   2. Reabierto: en rojo, «Reabierto para corregir, sin presentar ·
//      complementaria nº 2», con la original y la nueva juntas y «Apuntar la
//      nueva presentación».
// Lo de la base (conta_iva_presentados, conta_iva_reaperturas,
// conta_iva_puede_reabrir y conta_iva_reabrir, de la 1408) está SIMULADO en el
// navegador con la forma que devuelve: staging solo la ensaya en ROLLBACK hasta
// que se aplique en producción y se fusione. Quién puede reabrir y lo que pasa
// en la base lo prueba la prueba de staging de la tanda
// (supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion } from '../sesion'

test.skip(CARRIL === null, 'Reabrir mira la empresa A de su carril (Impuestos se enciende y se apaga en la cuenta A).')

const DIR = 'docs/conta/capturas/v04'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })

const T2 = { periodo: '2T', ejercicio: 2026, desde: '2026-04-01', hasta: '2026-06-30', presentado: '2026-07-20T08:06:28+00:00', declaracion: '00000000-0000-4000-8000-000000000302', nombre: '2T de 2026', siguiente: '3T' }
const REABIERTO = { id: '00000000-0000-4000-8000-0000000014a8', motivo: 'Falta una factura de junio de Suministros', desde: '2026-10-27T13:00:00+00:00', por: 'Admin Norte', tipo: 'complementary', secuencia: 2 }
const REAPERTURA = {
  id: REABIERTO.id, periodo: '2T', ejercicio: 2026, tipo: 'complementary', motivo: REABIERTO.motivo, abierta: REABIERTO.desde, por: 'Admin Norte', cerrada: null, cerrada_por: null, dias: 0, asientos: 2,
  original: { id: T2.declaracion, secuencia: 1, estado: 'filed', presentada: '2026-07-20T08:06:28+00:00', csv: 'PRUEBAV04REABRIR', importe: 21, resultado: 'to_pay' },
  nueva: { id: '00000000-0000-4000-8000-000000000312', secuencia: 2, estado: 'draft', presentada: null, csv: null, importe: null, resultado: null },
}

async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e V04 reabrir (carril)' : 'e2e V04 reabrir (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test('Reabrir para corregir el 2T: escondido en «Más», con motivo y confirmación; reabierto, en rojo y con las dos presentaciones', async ({ page }) => {
  const errores = vigilar(page)
  let reabierto = false
  let pedido: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/conta_iva_presentados\b/, (r) => json(r, [{ ...T2, reabierto: reabierto ? REABIERTO : null }]))
  await page.route(/\/rest\/v1\/rpc\/conta_iva_reaperturas\b/, (r) => json(r, reabierto ? [REAPERTURA] : []))
  await page.route(/\/rest\/v1\/rpc\/conta_iva_puede_reabrir\b/, (r) => json(r, true))
  await page.route(/\/rest\/v1\/rpc\/conta_iva_reabrir\b/, (r) => {
    pedido = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    reabierto = true
    return json(r, { id: REABIERTO.id, nueva: REAPERTURA.nueva.id, secuencia: 2,
      texto: 'Reabierto el 2T de 2026 para corregir. La presentación del 20/07 se queda como estaba: lo que cambies irá en la complementaria nº 2.' })
  })
  // El trimestre de verdad, con su 303 del 2T presentado el 20/07 (la empresa A del carril puede no tenerlo apuntado).
  await page.route(/\/rest\/v1\/rpc\/conta_impuesto_trimestre\b/, async (r) => {
    const real = await r.fetch()
    const d = (await real.json()) as { modelos?: Record<string, unknown>[] }
    const decl = { id: T2.declaracion, cuenta: CUENTA_A.id, estado: 'filed', estado_texto: 'Presentada', resultado: 'to_pay', importe: 21,
      presentada: T2.presentado, presentada_por: 'Admin Norte', por: 'outside', csv: 'PRUEBAV04REABRIR', justificante: null, justificante_pdf: null,
      traido: false, expediente: null, presentador: null, casillas: [] }
    const otros = (d.modelos ?? []).filter((m) => m.modelo !== '303')
    d.modelos = [{ modelo: '303', nombre: 'IVA trimestral', cadencia: 'quarterly', periodo: '2T', no_toca: false, presentacion: '2026-07-20', domiciliacion: null, declaracion: decl }, ...otros]
    return r.fulfill({ response: real, json: d })
  })
  await entrarComo(page, CUENTA_A.email)

  // 1 · Presentado: el candado, y «Más» › «Reabrir para corregir el 2T».
  await page.goto('/conta/impuestos/trimestre/2026/2T?marca=sumied')
  await expect(page.locator('[data-prueba="trimestre-iva-presentado"]')).toBeVisible({ timeout: 30_000 })
  const ficha = page.locator('[data-prueba="ficha-modelo"]')
  await expect(ficha).toBeVisible({ timeout: 30_000 })
  const mas = ficha.locator('[data-prueba="mas-303"]')
  await expect(mas).toBeVisible({ timeout: 20_000 })
  await expect(mas.getByRole('button', { name: 'Reabrir para corregir el 2T' })).toBeHidden()
  await mas.locator('summary').click()
  await mas.getByRole('button', { name: 'Reabrir para corregir el 2T' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Reabrir para corregir el 2T de 2026' })
  await expect(dialogo).toBeVisible()
  await expect(dialogo).toContainText('La presentación del 20/07 se queda como estaba. Lo que cambies irá en una nueva presentación.')
  await expect(dialogo.locator('[data-prueba="solo-una-recibida"]')).toContainText('¿Solo es una factura recibida? Se deduce en el 3T sin reabrir')
  const boton = dialogo.getByRole('button', { name: 'Reabrir el 2T' })
  await expect(boton).toBeDisabled()
  await dialogo.getByLabel('Por qué se reabre').fill('Falta una factura de junio de Suministros')
  await expect(boton).toBeDisabled()
  await dialogo.getByRole('checkbox').check()
  await foto(page, 'reabrir-dialogo')
  await boton.click()
  await expect(page.getByText('Reabierto el 2T de 2026 para corregir. La presentación del 20/07 se queda como estaba: lo que cambies irá en la complementaria nº 2.')).toBeVisible()
  expect(pedido).toMatchObject({ p_motivo: 'Falta una factura de junio de Suministros', p_tipo: 'complementary' })

  // 2 · Reabierto: en rojo, con la original y la nueva juntas.
  await page.reload()
  await expect(page.locator('[data-prueba="trimestre-reabierto-cabeza"]')).toHaveText('Reabierto para corregir, sin presentar · complementaria nº 2', { timeout: 30_000 })
  const caja = page.locator('[data-prueba="trimestre-reabierto"]')
  await expect(caja).toContainText('Reabierto para corregir, sin presentar')
  await expect(caja.locator('[data-prueba="presentaciones"] li')).toHaveCount(2)
  await expect(caja.locator('[data-prueba="presentaciones"] li').first()).toContainText('Nº 1 · la original, se queda como estaba')
  await expect(caja.locator('[data-prueba="presentaciones"] li').nth(1)).toContainText('Nº 2 · complementaria')
  await expect(caja.getByRole('button', { name: 'Apuntar la nueva presentación' })).toBeVisible()
  await expect(page.locator('[data-prueba="mas-303"]')).toHaveCount(0)
  await foto(page, 'reabrir-reabierto')
  expect(errores, 'errores de la página').toEqual([])
})
