// tests/e2e/conta/s01p/liquidacion-repetida.spec.ts
//
// S01p·21 (Julio, 13/11) · Impuestos › Trimestre del 2T de 2026 de la empresa A, en el ordenador y
// en el móvil: la liquidación de IVA apuntada dos veces sale arriba de la columna del 303, con las
// dos y «Dejar solo esta»; al pulsar, dice qué asiento ha creado y con qué fecha (regla 8), y queda
// resuelta. Lo de la base (conta_liquidaciones_repetidas y conta_liquidacion_dejar_esta, de la 1822)
// está SIMULADO en el navegador con la forma que devuelve: staging solo la ensaya en ROLLBACK hasta
// que se aplique y se fusione. Lo que pasa en la base lo prueba
// supabase/staging/sql/20261113_s01p_liquidacion_repetida_prueba.sql. Números inventados (T11).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion } from '../sesion'

test.skip(CARRIL === null, 'Mira la empresa A de su carril (Impuestos se enciende y se apaga en la cuenta A).')

const DIR = 'docs/conta/capturas/s01p21'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: true })

const DECL = '00000000-0000-4000-8000-000000002121'
const BUENA = '00000000-0000-4000-8000-0000000021a1'
const OTRA = '00000000-0000-4000-8000-0000000021a2'
const CONTRA = '00000000-0000-4000-8000-0000000021a3'
const DICE = 'Se deja la liquidación 4/1: la 9/3 queda sin efecto con el contraasiento 9/7 del 01/10/2026. Ningún libro de IVA cambia.'
const fila = (o: Record<string, unknown>) => ({ asiento: BUENA, serie: 4, numero: 1, fecha: '2026-06-30', concepto: 'Liquidación I.V.A. Trimestre 2', importe: 21, traida: true,
  enlazada: false, repetida: false, contraasiento: null, contra_serie: null, contra_numero: null, contra_fecha: null, ...o })

async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e S01p·21 liquidación repetida (carril)' : 'e2e S01p·21 liquidación repetida (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

test('Liquidación apuntada dos veces: las dos, «Dejar solo esta», y dice qué asiento creó y con qué fecha', async ({ page }) => {
  test.setTimeout(90_000)
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  let hecho = false
  let pedido: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/conta_impuesto_trimestre\b/, async (r) => {
    const real = await r.fetch()
    const d = (await real.json()) as { modelos?: Record<string, unknown>[] }
    const decl = { id: DECL, cuenta: CUENTA_A.id, estado: 'filed', estado_texto: 'Presentada', resultado: 'to_pay', importe: 10,
      presentada: '2026-07-20T08:06:28+00:00', presentada_por: 'Admin Norte', por: 'outside', csv: 'PRUEBAS01P21', justificante: null, justificante_pdf: null,
      traido: false, expediente: null, presentador: null, casillas: [] }
    const otros = (d.modelos ?? []).filter((m) => m.modelo !== '303')
    d.modelos = [{ modelo: '303', nombre: 'IVA trimestral', cadencia: 'quarterly', periodo: '2T', no_toca: false, presentacion: '2026-07-20', domiciliacion: null, declaracion: decl }, ...otros]
    return r.fulfill({ response: real, json: d })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_liquidaciones_repetidas\b/, (r) => json(r, hecho
    ? [fila({ enlazada: true }), fila({ asiento: OTRA, serie: 9, numero: 3, repetida: true, contraasiento: CONTRA, contra_serie: 9, contra_numero: 7, contra_fecha: '2026-10-01' })]
    : [fila({}), fila({ asiento: OTRA, serie: 9, numero: 3 })]))
  await page.route(/\/rest\/v1\/rpc\/conta_liquidacion_dejar_esta\b/, (r) => {
    pedido = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    hecho = true
    return json(r, { ok: true, buena: BUENA, fecha: '2026-10-01', mensaje: DICE })
  })
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/impuestos/trimestre/2026/2T?marca=sumied')

  const caja = page.locator('[data-prueba="liquidacion-repetida"]')
  await expect(caja).toBeVisible({ timeout: 30_000 })
  await expect(caja.getByRole('heading', { name: 'Liquidación apuntada dos veces' })).toBeVisible()
  await expect(caja.locator('[data-prueba="repetida-fila"]')).toHaveCount(2)
  await expect(caja.locator('[data-prueba="repetida-fila"]').first()).toContainText('4/1 · 30/06/2026 · traída de Diez · Liquidación I.V.A. Trimestre 2 · 477 21,00 €')
  await expect(caja.getByRole('button', { name: 'Dejar solo esta' })).toHaveCount(2)
  await foto(page, 'liquidacion-repetida')

  await caja.getByRole('button', { name: 'Dejar solo esta' }).first().click()
  await expect(caja.locator('[data-prueba="repetida-hecho"]')).toHaveText(DICE, { timeout: 20_000 })
  expect(pedido).toMatchObject({ p_return: DECL, p_buena: BUENA })
  // Resuelta: sin botones, con cuál se dejó y el contraasiento de la otra.
  await expect(caja.locator('[data-prueba="repetida-frase"]')).toHaveText('Resuelta: se deja la 4/1; la 9/3 con el contraasiento 9/7 del 01/10/2026 queda sin efecto. Ningún libro de IVA cambió.')
  await expect(caja.getByRole('button', { name: 'Dejar solo esta' })).toHaveCount(0)
  await expect(caja).toContainText('Sin efecto: contraasiento 9/7 del 01/10/2026')
  await foto(page, 'liquidacion-repetida-resuelta')
  expect(errores, 'errores de la página').toEqual([])
})
