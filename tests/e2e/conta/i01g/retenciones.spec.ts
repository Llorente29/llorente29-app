// tests/e2e/conta/i01g/retenciones.spec.ts
//
// I01g · El 111 y el 115 calculados por Sumied, en Impuestos › Trimestre
// (maqueta v4), con la marca Sumied, en ordenador (1.440 y 1.900 px) y en
// móvil, contra staging-conta, en el carril de la cuenta A (una copia nueva en
// cada ejecución). Ningún dato real: cifras inventadas.
//
// La prueba deja en el 4T de 2026 de la empresa A del carril, si no están,
// cuatro asientos validados con retención, como los hace Sumied (la línea de
// la 4751 con su tipo, su base y su modelo):
//   · un administrador: 1.000,00 en la 640 y 350,00 retenidos (va con las nóminas);
//   · un profesional: 500,00 en la 623 y 75,00 retenidos;
//   · dos alquileres del mismo arrendador: 1.000,00 en la 621 y 190,00 retenidos cada uno.
// Y mira, en ordenador:
//   · el 111 sin calcular: qué falta y el botón «Calcular el 111 del 4T»;
//   · al calcular, lo dice con su cifra y lo que falta (regla 8); la liquidación
//     en palabras (nóminas y profesionales), el impreso calculado en el centro y
//     «Lo comprobado» casilla a casilla con el diario;
//   · sin la [01] no se puede dar por revisado; la [01] a mano con su motivo,
//     «Revisado: pasar a presentar» y el botón de presentar, apagado y explicado;
//   · el 115: un arrendador con dos facturas cuenta una vez.
// En móvil, la misma ficha en una columna.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, enCarril, entrarComo, pedirSesion, anonKey, STAGING_URL, correoDePrueba, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'El 111 y el 115 necesitan su carril: escriben asientos y declaraciones en la cuenta A.')

const DIR = 'docs/conta/capturas/i01g'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const PREFIJO = 'E2E I01g ·'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}

/** Enciende o apaga Impuestos en la cuenta A del carril (como trimestre.spec.ts). */
async function impuestos(encendido: boolean) {
  const plataforma = await pedirSesion(PLATAFORMA)
  const r = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: CUENTA_A.id, feature_key: 'conta_impuestos', enabled: encendido, source: 'manual_grant',
      grant_reason: encendido ? 'e2e I01g retenciones (carril)' : 'e2e I01g retenciones (carril): se apaga al acabar' }),
  })
  if (!r.ok) throw new Error(`feature_flags: HTTP ${r.status} · ${(await r.text()).slice(0, 200)}`)
}
test.beforeAll(() => impuestos(true))
test.afterAll(() => impuestos(false))

/** Los asientos de la prueba, si no están ya (los dos lados los comparten). */
async function asientos(s: Sesion) {
  const ya = await api<{ id: string }[]>(s, 'GET', `journal_entry?select=id&company_id=eq.${EMPRESA_A}&concept=like.${encodeURIComponent(`${PREFIJO}*`)}&status=eq.validado`)
  if (ya.length >= 4) return
  const tipos = await api<{ id: string; code: string }[]>(s, 'GET', 'withholding_rate?select=id,code&is_system=is.true&valid_to=is.null&code=in.(administradores,profesional,alquiler)')
  const tipo = (c: string) => tipos.find((t) => t.code === c)!.id
  const uno = async (fecha: string, concepto: string, series: number, lineas: unknown[]) => {
    const p = await api<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
      p_company: EMPRESA_A, p_entry: { series, fecha, concepto: `${PREFIJO} ${concepto}`, source_type: 'manual', confianza: 'seguro', porque: 'Asiento de la prueba e2e del 111 y el 115.' },
      p_lines: lineas, p_quien_nombre: 'Prueba e2e',
    })
    await api(s, 'POST', 'rpc/journal_entry_validar', { p_entry: p.id, p_quien_nombre: 'Prueba e2e' })
  }
  await uno('2026-10-05', 'administrador', 4, [
    { cuenta: '64000000', debe: 1000, haber: 0, comun: true },
    { cuenta: '47510000', debe: 0, haber: 350, comun: true, retencion: { tipo_id: tipo('administradores'), base: 1000, modelo: '111' } },
    { cuenta: '46500000', debe: 0, haber: 650, comun: true },
  ])
  await uno('2026-10-06', 'profesional', 2, [
    { cuenta: '62300000', debe: 500, haber: 0, comun: true },
    { cuenta: '47510000', debe: 0, haber: 75, comun: true, retencion: { tipo_id: tipo('profesional'), base: 500, modelo: '111' } },
    { cuenta: '41000002', debe: 0, haber: 425, comun: true },
  ])
  for (const d of ['2026-10-01', '2026-11-01']) {
    await uno(d, `alquiler ${d.slice(5, 7)}`, 2, [
      { cuenta: '62100000', debe: 1000, haber: 0, comun: true },
      { cuenta: '47510000', debe: 0, haber: 190, comun: true, retencion: { tipo_id: tipo('alquiler'), base: 1000, modelo: '115' } },
      { cuenta: '41000001', debe: 0, haber: 810, comun: true },
    ])
  }
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  return errores
}
async function cargada(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
async function ir(page: Page, ruta: string) {
  await page.goto(`/conta/${ruta}?marca=sumied`)
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
/** A 1.440 y a 1.900 px. */
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

/** Lo que dice el estado de la pantalla tras una acción (role=status). */
const dice = (page: Page) => page.locator('.s-impuestos-hecho[role=status]')

test('El 111 y el 115 del 4T: calcular desde el diario, la [01] a mano, revisado y presentar cerrado', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'Escribe declaraciones: una vez, en el ordenador. El móvil mira la misma ficha.')
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  await asientos(s)
  // Lo que ya tenga el 4T de A en el carril se mide antes: la prueba no supone el trimestre vacío.
  const diario = await api<{ sumas: Record<string, { retenido: number; base: number; perceptores?: number }> }>(s, 'POST', 'rpc/conta_impuesto_retenciones_diario', { p_company: EMPRESA_A, p_year: 2026, p_period: '4T' })
  const r111 = Math.round((diario.sumas['111_nomina'].retenido + diario.sumas['111_profesional'].retenido) * 100) / 100
  const r115 = diario.sumas['115'].retenido
  expect(r111).toBeGreaterThanOrEqual(425)
  expect(r115).toBeGreaterThanOrEqual(380)
  const euros = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })

  await ir(page, 'impuestos/trimestre/2026/4T')
  const tira = page.getByRole('list', { name: /Modelos del 4/ })
  await tira.getByRole('button').filter({ hasText: 'Retenciones · 111' }).click()
  const ficha = page.locator('[data-prueba="ficha-modelo"]')

  // 1 · Sin calcular: qué falta y el botón.
  const falta = page.locator('[data-prueba="que-falta"]')
  if (await falta.isVisible()) {
    await expect(falta).toContainText('Falta calcular el 111 del 4T')
    await expect(falta).toContainText('las nóminas (la 640 y la 4751)')
    await fotos(page, 'retenciones-111-sin-calcular')
    await falta.getByRole('button', { name: 'Calcular el 111 del 4T' }).click()
    await expect(dice(page)).toHaveText(`Calculado el 111 del 4T desde el diario: ${euros(r111)} € a ingresar. Falta escribir cuántas personas cobraron nómina ([01]).`)
  }

  // 2 · Calculado: la liquidación en palabras, el impreso y lo comprobado.
  const liq = ficha.locator('[data-prueba="liquidacion"]')
  await expect(liq.getByRole('row', { name: /Nóminas/ })).toContainText(euros(diario.sumas['111_nomina'].base))
  await expect(liq.getByRole('row', { name: /Profesionales/ })).toContainText('75,00')
  await expect(liq.getByRole('row', { name: /Total retenido/ })).toContainText(euros(r111))
  await expect(page.locator('[data-prueba="impreso-calculado"]')).toContainText('Modelo 111 · Liquidación')
  const comp = page.locator('[data-prueba="comprobado"]')
  await expect(comp).toContainText('✓ El 111 del 4T casa con el diario, casilla a casilla')
  await expect(comp).toContainText('Falta cuántas personas cobraron nómina')

  // 3 · Sin la [01] no se revisa; se escribe con su motivo.
  const preparar = ficha.locator('[data-prueba="preparar"]')
  await expect(preparar.getByRole('button', { name: 'Revisado: pasar a presentar' })).toHaveCount(0)
  await expect(preparar).toContainText('Para darlo por revisado falta resolver')
  const perceptores = preparar.locator('[data-prueba="perceptores"]')
  await perceptores.getByLabel('Personas con nómina').fill('1')
  await perceptores.getByLabel('De dónde sale').fill('El administrador, una sola persona (prueba)')
  await fotos(page, 'retenciones-111-perceptores')
  await perceptores.getByRole('button', { name: 'Guardar la [01]' }).click()
  await expect(dice(page)).toHaveText(`Escrita la [01]: 1 persona con nómina. Vuelto a calcular el 111: ${euros(r111)} € a ingresar.`)
  await expect(liq.getByRole('row', { name: /Nóminas/ })).toContainText('1 persona')

  // 4 · Revisado: listo para presentar; presentar sigue cerrado y lo dice.
  await preparar.getByRole('button', { name: 'Revisado: pasar a presentar' }).click()
  await expect(dice(page)).toContainText('El 111 del 4T queda listo para presentar.')
  await expect(tira.getByRole('button').filter({ hasText: 'Retenciones · 111' })).toContainText('Revisado · para presentar')
  await expect(preparar.getByRole('button', { name: 'Presentar el 111' })).toBeDisabled()
  await expect(preparar).toContainText('Presentar desde Sumied sigue cerrado hasta que se abra la conexión con Hacienda')
  await sinDesbordar(page)
  await fotos(page, 'retenciones-111-revisado')

  // 5 · El 115: un arrendador con dos facturas cuenta una vez.
  await tira.getByRole('button').filter({ hasText: 'Alquiler · 115' }).click()
  const falta115 = page.locator('[data-prueba="que-falta"]')
  if (await falta115.isVisible()) {
    await falta115.getByRole('button', { name: 'Calcular el 115 del 4T' }).click()
    await expect(dice(page)).toHaveText(`Calculado el 115 del 4T desde el diario: ${euros(r115)} € a ingresar.`)
  }
  await expect(liq.getByRole('row', { name: /Alquileres de locales/ })).toContainText(`${diario.sumas['115'].perceptores} persona`)
  await expect(comp).toContainText('✓ El 115 del 4T casa con el diario, casilla a casilla')
  await expect(preparar.getByRole('button', { name: 'Revisado: pasar a presentar' })).toBeVisible()
  await sinDesbordar(page)
  await fotos(page, 'retenciones-115-calculado')
  expect(errores).toEqual([])
})

test('En el móvil: la ficha del 111 en una columna, sin salirse de lado', async ({ page }) => {
  test.skip(lado(page) !== 'movil', 'Lo del ordenador va en la prueba de arriba.')
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  await asientos(s)
  // Si el ordenador no lo calculó todavía en este carril, se calcula aquí (sin la [01]).
  const hay = await api<{ id: string }[]>(s, 'GET', `tax_return?select=id&company_id=eq.${EMPRESA_A}&form_code=eq.111&fiscal_year=eq.2026&period=eq.4T`)
  if (hay.length === 0) await api(s, 'POST', 'rpc/conta_impuesto_retenciones_calcular', { p_company: EMPRESA_A, p_year: 2026, p_period: '4T', p_form: '111' })
  await ir(page, 'impuestos/trimestre/2026/4T')
  await page.getByRole('list', { name: /Modelos del 4/ }).getByRole('button').filter({ hasText: 'Retenciones · 111' }).click()
  await expect(page.locator('[data-prueba="liquidacion"]')).toContainText('Profesionales')
  await expect(page.locator('[data-prueba="comprobado"]')).toContainText('casa con el diario')
  await sinDesbordar(page)
  await foto(page, 'retenciones-111')
  expect(errores).toEqual([])
})
