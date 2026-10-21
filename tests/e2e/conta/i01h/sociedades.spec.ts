// tests/e2e/conta/i01h/sociedades.spec.ts
//
// I01h · Impuestos › Impuesto de sociedades: el 202 calculado desde el último
// 200 (art. 40.2), con la marca Sumied, en ordenador (1.440 y 1.900 px) y en
// móvil, contra staging-conta, en el carril de la cuenta A. Ningún dato real:
// cifras inventadas.
//
// La prueba crea su propia empresa en la cuenta A (y la borra al acabar): la
// e2e del plazo (i01b/plazo.spec.ts) cuenta con que el 202 · 2P de la empresa A
// esté fuera de plazo, y escribir aquí sus 200 se lo cambiaría.
// En ordenador:
//   · sin ningún 200, el 2P de 2026 pide el Impuesto de sociedades de 2025;
//   · el 200 de 2025 escrito a mano (a cero, 300,00 a devolver), con su
//     motivo: la pantalla lo dice con lo que ha recalculado (regla 8); el 2P,
//     el 3P y el 1P de 2027 «No hay que presentarlo: el impuesto de 2025 salió
//     a cero»; los 300,00 a devolver, pendientes de cobrar;
//   · con el 200 de 2024 (cuota 2.000,00), el 1P de 2026 da 360,00;
//   · el Calendario del 21/10 dice que el 2P no hace falta y no lo cuenta
//     fuera de plazo.
// En móvil, la misma pestaña en una columna.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, correoDePrueba, entrarComo, pedirSesion, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'

test.skip(CARRIL === null, 'El 202 necesita su carril: escribe una empresa, sus 200 y sus 202 en la cuenta A.')

const DIR = 'docs/conta/capturas/i01h'
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}

/** Una empresa nueva de la cuenta A que presenta el 200 y el 202 (como trimestre.spec.ts). */
async function crearEmpresa(s: Sesion, l: string): Promise<{ id: string }> {
  const [c] = await api<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `Sociedades e2e ${l}, S.L.`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  await api(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: c.id, tax_territory: 'peninsula_baleares', tax_forms: ['303', '200', '202'] })
  await api(s, 'POST', 'rpc/conta_impuesto_obligaciones_calcular', { p_company: c.id })
  const hay = (await api<{ form_code: string }[]>(s, 'GET', `tax_obligation?company_id=eq.${c.id}&valid_to=is.null&active=is.true&select=form_code`)).map((o) => o.form_code)
  for (const m of ['200', '202'].filter((x) => !hay.includes(x))) {
    await api(s, 'POST', 'rpc/conta_impuesto_obligacion_decidir', { p_company: c.id, p_form: m, p_presenta: true, p_motivo: 'Prueba e2e del 202.' })
  }
  return { id: c.id }
}

const DOSCIENTOS = {
  2024: { presentado: '2025-07-20', base_imponible: 20000, cuota: 2000, resultado: 'to_pay', importe: 2000 },
  2025: { presentado: '2026-07-14', base_imponible: -5000, cuota: 0, resultado: 'to_refund', importe: 300 },
} as const
const poner = (s: Sesion, empresa: string, y: 2024 | 2025) =>
  api(s, 'POST', 'rpc/conta_impuesto_200_poner', { p_company: empresa, p_year: y, p_datos: DOSCIENTOS[y], p_motivo: 'Prueba e2e del 202' })

/** Enciende o apaga Impuestos en la cuenta A del carril (como trimestre.spec.ts). */
async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e I01h sociedades (carril)' : 'e2e I01h sociedades (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

async function cargada(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
async function ir(page: Page, ruta: string, extra = '') {
  await page.goto(`/conta/${ruta}?marca=sumied${extra}`)
  await cargada(page)
}
/** La captura: en el móvil, `-movil`; en ordenador, `-ordenador` a 1.440 px y `-1900` a 1.900 px. */
const foto = async (page: Page, nombre: string) => {
  const ancho = page.viewportSize()?.width ?? 1440
  const sufijo = ancho < 768 ? 'movil' : ancho >= 1800 ? '1900' : 'ordenador'
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(150)
  return page.screenshot({ path: `${DIR}/${nombre}-${sufijo}.jpg`, type: 'jpeg', quality: 75, fullPage: true })
}
async function fotos(page: Page, nombre: string) {
  await foto(page, nombre)
  await page.setViewportSize({ width: 1900, height: 1000 })
  await cargada(page)
  await foto(page, nombre)
  await page.setViewportSize({ width: 1440, height: 900 })
  await cargada(page)
}
async function sinDesbordar(page: Page) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, 'la página se sale de lado').toBeLessThanOrEqual(1)
}
const dice = (page: Page) => page.locator('.s-impuestos-hecho[role=status]')
const pago = (page: Page, p: string, y: number) => page.locator(`[data-prueba="pago-${p}-${y}"]`)

async function conEmpresa(page: Page, l: string, cuerpo: (s: Sesion, empresa: string) => Promise<void>) {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const s = await pedirSesion(CUENTA_A.email)
  const e = await crearEmpresa(s, l)
  try {
    await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, e.id] as const)
    await entrarComo(page, CUENTA_A.email)
    await cuerpo(s, e.id)
    expect(errores, 'errores de la página').toEqual([])
  } finally {
    const b = await rest<unknown[]>(s, 'DELETE', `company?id=eq.${e.id}&account_id=eq.${CUENTA_A.id}`)
    expect(b.status, `Borrar la empresa de prueba: ${JSON.stringify(b.datos)}`).toBeLessThan(300)
    expect((b.datos ?? []).length, 'la empresa de prueba no se ha borrado (RLS)').toBe(1)
  }
}

test('El 202 desde el último 200: el 200 a mano, «No hay que presentarlo» con su porqué, lo que queda por cobrar y el calendario', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'Escribe un 200: una vez, en el ordenador. El móvil mira la misma pestaña.')
  await conEmpresa(page, 'ordenador', async (s, empresa) => {
    await ir(page, 'impuestos/sociedades')
    // Sin ningún 200: el 2P de 2026 pide el de 2025, y no inventa la base.
    await expect(pago(page, '2P', 2026)).toContainText('Falta el Impuesto de sociedades del 2025: escribe su cuota abajo y Sumied lo calcula.')
    await expect(page.getByText('Aún no hay ninguno.')).toBeVisible()
    await sinDesbordar(page)
    await fotos(page, 'sociedades-sin-200')

    // El 200 de 2025 a mano, con su motivo.
    await page.getByRole('button', { name: 'Escribir un 200' }).click()
    const form = page.locator('[data-prueba="escribir-200"]')
    await form.getByLabel('Ejercicio').fill('2025')
    await form.getByLabel('Presentado el').fill('14/07/2026')
    await form.getByLabel('Base imponible (€)').fill('-5.000,00')
    await form.getByLabel('Cuota (€)').fill('0')
    await form.getByLabel('Resultado').selectOption('to_refund')
    await form.getByLabel('Importe (€)').fill('300,00')
    await form.getByLabel('De dónde salen').fill('El justificante de la gestoría (prueba)')
    await fotos(page, 'sociedades-escribir-200')
    await form.getByRole('button', { name: 'Guardar el 200' }).click()
    await expect(dice(page)).toHaveText('Guardado el Impuesto de sociedades de 2025: cuota 0,00 €, 300,00 € a devolver. Vueltos a calcular los 202 que salen de él: el 2P/2026, no hay que presentarlo; el 3P/2026, no hay que presentarlo; el 1P/2027, no hay que presentarlo.', { timeout: 20_000 })
    for (const p of ['2P', '3P']) await expect(pago(page, p, 2026)).toContainText('No hay que presentarlo: el impuesto de 2025 salió a cero.')
    await expect(page.locator('[data-prueba="devolucion"]')).toHaveText('300,00 € a devolver del 2025, pendientes de cobrar: Sumied lo da por cobrado cuando llegue al banco.')
    await expect(page.locator('[data-prueba="declaracion-200-2025"]')).toContainText('Impuesto de sociedades de 2025 · 300,00 € a devolver')
    await expect(page.locator('[data-prueba="declaracion-200-2025"]')).toContainText('Escrito a mano: El justificante de la gestoría (prueba)')

    // Con el 200 de 2024, el 1P de 2026 sale del 18 % de su cuota.
    await poner(s, empresa, 2024)
    await ir(page, 'impuestos/sociedades')
    await expect(pago(page, '1P', 2026)).toContainText('360,00 € a ingresar (el 18 % de 2.000,00 €, la cuota del 2024).')
    await sinDesbordar(page)
    await fotos(page, 'sociedades-con-200')

    // El Calendario del 21/10: el 2P no hace falta, con su porqué, y no está fuera de plazo.
    await ir(page, 'impuestos', '&hoy=2026-10-21')
    // Dos filas: el 2P, que venció ayer, y el 3P, que es el plazo siguiente (diciembre). Las dos, con su porqué.
    await expect(page.locator('.s-impuestos-calendario tr').filter({ hasText: 'No hay que presentarlo: el impuesto de 2025 salió a cero' })).toHaveCount(2)
    await expect(page.locator('.s-impuestos-cifras .s-tarjeta-cifra').first()).not.toContainText('202 · 2P')
    await fotos(page, 'calendario-202-no-hace-falta')
  })
})

test('En el móvil: la pestaña del Impuesto de sociedades en una columna', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'El ordenador ya la recorre entera.')
  await conEmpresa(page, 'movil', async (s, empresa) => {
    await poner(s, empresa, 2025)
    await poner(s, empresa, 2024)
    await ir(page, 'impuestos/sociedades')
    await expect(pago(page, '2P', 2026)).toContainText('No hay que presentarlo: el impuesto de 2025 salió a cero.')
    await expect(pago(page, '1P', 2026)).toContainText('360,00 € a ingresar')
    await expect(page.locator('[data-prueba="devolucion"]')).toContainText('pendientes de cobrar')
    await sinDesbordar(page)
    await foto(page, 'sociedades')
  })
})
