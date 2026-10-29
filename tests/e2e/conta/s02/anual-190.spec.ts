// tests/e2e/conta/s02/anual-190.spec.ts
//
// S02 · Impuestos › El año, con el 190, contra staging-conta, en el carril de
// la cuenta A, en ordenador (1.440) y en móvil (390). Ningún dato real.
//
// Staging recibe la 1950 de verdad solo desde main (W04: desde la rama va en
// ROLLBACK), y la e2e va antes que el ensayo. Así que la prueba lo mide:
//   · sin las funciones del año en staging, la pantalla lo DICE («No se han
//     podido leer los modelos del año» con «Volver a intentar»), no se queda
//     en blanco (regla 8), y el resto se salta con su porqué;
//   · con ellas: la tira del año con el 190; sin calcular, qué falta y el
//     botón; al calcular, la frase con su cifra; los perceptores en el
//     centro; «Lo comprobado» con sus frases; el fichero dice por qué no se
//     baja si hay algo por resolver; y «Ya lo presenté fuera» pide un CSV que
//     valga. En móvil, la misma ficha sin salirse de lado.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, enCarril, entrarComo, pedirSesion, anonKey, STAGING_URL, correoDePrueba, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'El 190 necesita su carril: escribe la declaración del año en la cuenta A.')

const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** Enciende o apaga Impuestos en la cuenta A del carril (como i01g/retenciones.spec.ts). */
async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e S02 el año (carril)' : 'e2e S02 el año (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

/** ¿Tiene staging las funciones del año (la 1950)? */
async function hayAnual(s: Sesion): Promise<boolean> {
  const r = await rest(s, 'POST', 'rpc/conta_impuesto_anual', { p_company: EMPRESA_A, p_year: 2026 })
  return r.status < 300
}

/** El 190 en los modelos de A (si no estaba), como lo hace una persona: con su motivo. */
async function con190(s: Sesion) {
  const ya = await rest<{ form_code: string }[]>(s, 'GET', `tax_obligation?select=form_code&company_id=eq.${EMPRESA_A}&form_code=eq.190&valid_to=is.null&active=is.true`)
  if (ya.status < 300 && ya.datos.length > 0) return
  const r = await rest(s, 'POST', 'rpc/conta_impuesto_obligacion_decidir', { p_company: EMPRESA_A, p_form: '190', p_presenta: true, p_motivo: 'Prueba e2e S02: el resumen anual de retenciones.' })
  if (r.status >= 300) throw new Error(`obligacion_decidir: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 200)}`)
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  return errores
}
async function cargada(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}
async function sinDesbordar(page: Page) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, 'la página se sale de lado').toBeLessThanOrEqual(1)
}

test('El 190 de 2026: la tira del año, calcular desde los 111, lo comprobado y el fichero', async ({ page }) => {
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hay = await hayAnual(s)
  await page.goto('/conta/impuestos/anual/2026/190?marca=sumied')
  await cargada(page)

  if (!hay) {
    // Sin la 1950 en staging: la pantalla lo dice, con su botón, y no se queda en blanco.
    await expect(page.getByText('No se han podido leer los modelos del año')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Volver a intentar' })).toBeVisible()
    await sinDesbordar(page)
    expect(errores).toEqual([])
    test.info().annotations.push({ type: 'salto', description: 'Staging aún no tiene la 1950 (llega desde main): se ha mirado que la pantalla lo dice; el camino entero, cuando esté.' })
    return
  }

  await con190(s)
  await page.reload()
  await cargada(page)
  const tira = page.getByRole('list', { name: 'Modelos de 2026' })
  await expect(tira.getByRole('button').filter({ hasText: 'Retenciones del año · 190' })).toBeVisible()
  const ficha = page.locator('[data-prueba="ficha-modelo"]')
  await expect(ficha).toContainText('Es informativo: no se paga.')

  if (lado(page) === 'ordenador') {
    const calcular = ficha.getByRole('button', { name: 'Calcular el 190 de 2026' })
    const volver = ficha.getByRole('button', { name: /Volver a calcular/ })
    await (await calcular.isVisible() ? calcular : volver).click()
    await expect(page.locator('[data-prueba="anual-hecho"]')).toContainText(/Calculado el 190 de 2026: \d+ líneas? de perceptor y [\d.,]+ € retenidos/)
    await expect(page.locator('[data-prueba="perceptores-190"]')).toContainText('Los perceptores del 2026')
    const comprobado = page.locator('[data-prueba="comprobado"]')
    await expect(comprobado).toContainText(/111 del año/)
    await expect(comprobado).toContainText(/NIF/)
    // El fichero: si queda algo por resolver o un aviso sin mirar, lo dice.
    const porQue = page.locator('[data-prueba="por-que-no-fichero"]')
    if (await porQue.isVisible()) await expect(porQue).toContainText(/Para bajar el fichero falta resolver|Antes, mira/)
    // «Ya lo presenté fuera»: sin un CSV que valga, no deja apuntarlo.
    await ficha.getByRole('button', { name: 'Ya lo presenté fuera · pegar CSV' }).click()
    const fuera = page.locator('[data-prueba="fuera"]')
    await fuera.getByLabel('CSV del justificante').fill('corto')
    await expect(fuera.getByText('16 letras y números, como lo da Hacienda.')).toBeVisible()
    await expect(fuera.getByRole('button', { name: 'Apuntar como presentado' })).toBeDisabled()
    await fuera.getByRole('button', { name: 'Cancelar' }).click()
  } else {
    // En el móvil, la misma ficha en una columna.
    await expect(ficha.getByText('Plazo')).toBeVisible()
  }
  await sinDesbordar(page)
  expect(errores).toEqual([])
})
