/// <reference lib="dom" />
// tests/e2e/conta/n08/asiento.spec.ts
//
// N08 · La ficha del asiento del núcleo, CONTRA STAGING DE VERDAD, con la cuenta del núcleo (semilla
// del K02, `conta_nucleo` encendido). Cada prueba crea su empresa en esa cuenta (pymes, 8 cifras, el
// ejercicio 2026 y el plan activado con company_chart_activate, la función de la pantalla del plan):
// no depende del orden ni de lo que dejó otra.
//   1. A mano con el teclado: tres líneas, la tercera cuadra sola, F5 en una cuenta abre su mayor en
//      otra pestaña, Intro guarda y valida; y a 1366 × 768 cabe.
//   2. Uno propuesto (journal_entry_proponer, como lo propone Sumied) se valida con Intro.
//   3. Con el interruptor apagado (la cuenta A), la pantalla de hoy.
//   4. «Guarda lo mismo» (regla 31), en su prueba y con su tiempo: el mismo asiento con la ficha nueva
//      y con la de hoy (en el ordenador, la misma empresa, el interruptor apagado en esa página) deja
//      las mismas filas.
// A 1456 × 816 (las capturas) y a 1366 × 768 (que la página no ruede).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CARRIL, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO, noRueda, zonaActiva } from '../k02/comun'

test.skip(CARRIL === null, 'Escribe y valida asientos en una empresa de la cuenta del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/n08'
const NUEVO = '/conta/libros/diario/nuevo'

interface Empresa { id: string; gasto: string; otro: string; banco: string }

/** Una empresa de la cuenta del núcleo para esta prueba, con su plan activado; y tres cuentas de él. */
async function crearEmpresa(s: Sesion, que: string): Promise<Empresa> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Asiento N08 e2e ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e N08' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  const c = await rest<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${id}&order=code`)
  const codigos = (c.datos ?? []).map((x) => x.code)
  const deApunte = (pre: string) => codigos.find((k) => k.startsWith(pre) && !codigos.some((o) => o !== k && o.startsWith(k)))
  // Sin IVA: un apunte de la 472 pide base, tipo y libro registro para validarse (e2e 1523).
  const [gasto, banco] = ['621', '572'].map(deApunte)
  const otro = ['629', '623', '622', '628', '627'].map(deApunte).find(Boolean)
  expect([gasto, otro, banco], `el plan activado tiene una 621, una de servicios (629, 623, 622, 628 o 627) y una 572 de apunte: ${codigos.join(' ')}`).not.toContain(undefined)
  return { id, gasto: gasto!, otro: otro!, banco: banco! }
}

/** El atajo de ERP10 de una subcuenta: «621.0» para la 62100000, «572.1» para la 57200001. */
const atajo = (codigo: string) => `${codigo.slice(0, 3)}.${codigo.slice(3).replace(/^0+/, '') || '0'}`

/** Lo que guarda un asiento, sin lo que cambia de uno a otro (ids, número, quién y cuándo). */
async function filas(s: Sesion, entryId: string) {
  const r = await rest<Record<string, unknown>[]>(s, 'GET',
    `journal_entry?select=series,entry_date,concept,source_type,status,journal_line(position,debit,credit,concept,location_id,is_common,brand_id,company_account(code))&id=eq.${entryId}`)
  const e = r.datos[0]
  const lineas = ((e.journal_line ?? []) as Record<string, unknown>[]).sort((a, b) => Number(a.position) - Number(b.position))
    .map((l) => ({ ...l, cuenta: (l.company_account as { code: string }).code, company_account: undefined }))
  return { ...e, journal_line: lineas }
}

const elegirEmpresa = (page: Page, cuenta: string, empresa: string) =>
  page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${cuenta}`, empresa] as const)

async function abrirAsientos(page: Page) {
  await page.goto('/conta', { waitUntil: 'load' })
  await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Asientos' }).click()
  await page.locator('[data-boton="asientos"]').click()
  await expect(zonaActiva(page).getByRole('heading', { name: 'Asiento', exact: true })).toBeVisible({ timeout: 40_000 })
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'El núcleo es de ordenador (reglas comunes).')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1456, height: 816 })
})

/**
 * Escribe con la ficha nueva, con el teclado, el asiento de las pruebas: «Alquiler de octubre», la 621
 * con 1.000,00, la de servicios con 210 y la del banco sola (la cuadra Sumied). Con varios locales,
 * el primero en cada línea (la columna «Local»). Devuelve el local elegido (o null).
 */
async function escribirConLaNueva(page: Page, e: Empresa): Promise<string | null> {
  const zona = zonaActiva(page)
  await zona.getByLabel('Concepto del asiento').fill('Alquiler de octubre')
  await page.keyboard.press('Enter')
  const escribe = async (t: string) => { await page.keyboard.type(t); await page.keyboard.press('Enter') }
  // Línea 1: la cuenta con su atajo, Intro (concepto, que ya trae el de la cabecera), el debe.
  await escribe(atajo(e.gasto)); await page.keyboard.press('Enter'); await escribe('1.000,00')
  await escribe(atajo(e.otro)); await page.keyboard.press('Enter'); await escribe('210')
  // La tercera: solo la cuenta. El haber lo pone Sumied.
  await escribe(atajo(e.banco))
  await expect(zona.getByLabel('Haber de la línea 3')).toHaveValue('1.210,00')
  let local: string | null = null
  if (await zona.getByLabel('Local de la línea 1').count()) {
    local = await zona.getByLabel('Local de la línea 1').locator('option').nth(1).getAttribute('value')
    for (let n = 1; n <= 3; n++) await zona.getByLabel(`Local de la línea ${n}`).selectOption(local!)
  }
  return local
}

/** Intro hasta la línea nueva vacía, y otra vez: guarda y valida. Devuelve el id del asiento. */
async function guardarConIntro(page: Page): Promise<string> {
  await zonaActiva(page).getByLabel('Concepto de la línea 3').focus()
  for (let k = 0; k < 3; k++) await page.keyboard.press('Enter')
  await expect(zonaActiva(page).getByLabel('Cuenta de la línea 4')).toBeFocused()
  await page.keyboard.press('Enter')
  const hecho = zonaActiva(page).getByRole('status').filter({ hasText: /^Guardado y validado: 4 \/ \d{4} · Alquiler de octubre · 1\.210,00 al debe y al haber\./ })
  await expect(hecho).toBeVisible({ timeout: 60_000 })
  return (await hecho.getByRole('link', { name: 'Verlo' }).getAttribute('href'))!.split('/').pop()!
}

test('N08 · 1 · a mano con el teclado: la tercera cuadra sola, F5, e Intro guarda y valida', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '1')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await abrirAsientos(page)
  const zona = zonaActiva(page)
  await expect(zona.getByText('Nuevo', { exact: true })).toBeVisible()
  await page.screenshot({ path: `${DIR}/nuevo-vacio.png` })

  await escribirConLaNueva(page, e)
  await expect(zona.getByLabel('Total')).toContainText('Cuadra')
  await expect(zona.getByLabel('Total')).toContainText('1.210,00')
  await expect(zona.getByLabel('Concepto de la línea 2')).toHaveValue('Alquiler de octubre')
  await page.screenshot({ path: `${DIR}/nuevo-escrito.png` })
  await noRueda(page, 'el asiento escrito a 1456 × 816')

  // F5 en la cuenta de la línea 1: su mayor, en otra pestaña; y se vuelve al asiento, con lo escrito.
  await zona.getByLabel('Cuenta de la línea 1').focus()
  await page.keyboard.press('F5')
  await expect(page.getByRole('tab', { name: `Mayor · ${e.gasto}`, exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
  await page.getByRole('tab', { name: 'Asiento · Alquiler de octubre' }).click()
  await expect(zonaActiva(page).getByLabel('Haber de la línea 3')).toHaveValue('1.210,00')

  // Intro: guarda, valida y pasa al siguiente.
  const id = await guardarConIntro(page)
  await expect(zonaActiva(page).getByLabel('Concepto del asiento')).toHaveValue('')
  await page.screenshot({ path: `${DIR}/nuevo-guardado.png` })
  const v = await rest<{ status: string }[]>(s, 'GET', `journal_entry?select=status&id=eq.${id}`)
  expect(v.datos[0]?.status, 'el asiento queda validado en la base').toBe('validado')

  // A 1366 × 768, con la cinta plegada: cabe.
  await page.setViewportSize({ width: 1366, height: 768 })
  const plegar = page.getByRole('button', { name: /Plegar los botones/ })
  if (await plegar.isVisible()) await plegar.click()
  await page.waitForTimeout(300)
  await noRueda(page, 'el asiento a 1366 × 768 con la cinta plegada')
  expect(errores).toEqual([])
})

test('N08 · 2 · uno propuesto por Sumied se valida con Intro', async ({ page }) => {
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '2')
  const p = await rest<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
    p_company: e.id, p_quien_nombre: 'Prueba e2e N08',
    p_entry: { series: 4, fecha: '2026-07-31', concepto: 'Alquiler de julio', source_type: 'manual', confianza: 'seguro', porque: 'El alquiler de cada mes, con las cuentas del de junio.', razones: [] },
    p_lines: [
      { cuenta: e.gasto, debe: 1000, haber: 0, concepto: null, local_id: null, comun: true },
      { cuenta: e.otro, debe: 210, haber: 0, concepto: null, local_id: null, comun: true },
      { cuenta: e.banco, debe: 0, haber: 1210, concepto: null, local_id: null, comun: true },
    ],
  })
  expect(p.status, `se propone: ${JSON.stringify(p.datos).slice(0, 300)}`).toBeLessThan(300)
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await abrirAsientos(page)
  await page.goto(`/conta/libros/diario/${p.datos.id}`, { waitUntil: 'load' })
  const zona = zonaActiva(page)
  await expect(zona.getByText('Propuesto', { exact: true })).toBeVisible({ timeout: 40_000 })
  await expect(zona.getByRole('status')).toContainText('Lo propone Sumied.')
  await expect(zona.getByLabel('Total')).toContainText('Cuadra')
  await page.screenshot({ path: `${DIR}/propuesto.png` })
  await zona.getByRole('table', { name: 'Apuntes' }).getByRole('row').nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(zonaActiva(page).getByRole('status').filter({ hasText: /^Validado: 4 \/ \d{4} · Alquiler de julio · 1\.210,00 al debe y al haber\./ })).toBeVisible({ timeout: 60_000 })
  const v = await rest<{ status: string; number: number }[]>(s, 'GET', `journal_entry?select=status,number&id=eq.${p.datos.id}`)
  expect(v.datos[0].status).toBe('validado')
  await page.goto(`/conta/libros/diario/${p.datos.id}`, { waitUntil: 'load' })
  await expect(zonaActiva(page).getByText('Validado', { exact: true })).toBeVisible({ timeout: 40_000 })
  await zonaActiva(page).getByRole('tab', { name: 'El mayor de la cuenta' }).click()
  await expect(zonaActiva(page).getByRole('table', { name: `Mayor de la ${e.gasto}` })).toContainText('1.000,00')
  await page.screenshot({ path: `${DIR}/validado.png` })
  expect(errores).toEqual([])
})

test('N08 · 3 · con el interruptor apagado (la cuenta A), la pantalla de hoy', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(NUEVO, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Nuevo asiento' }).first()).toBeVisible({ timeout: 40_000 })
  await expect(page.locator('.cxa')).toHaveCount(0)
})

test('N08 · 4 · guarda lo mismo: el mismo asiento con la ficha nueva y con la de hoy deja las mismas filas', async ({ page }) => {
  // Regla 31, decisión de Julio (respuesta N08 · 1): en el ordenador, la misma empresa, la de hoy con
  // el interruptor apagado. Apagado SOLO en esta página: se quita conta_nucleo de lo que la app lee
  // de feature_flags al arrancar (lo mismo que ve una cuenta sin el interruptor); la cuenta no cambia.
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const e = await crearEmpresa(s, '4')
  await elegirEmpresa(page, NUCLEO.id, e.id)
  await abrirAsientos(page)
  const local = await escribirConLaNueva(page, e)
  const nuevoId = await guardarConIntro(page)

  await page.route(/\/rest\/v1\/feature_flags/, async (r) => {
    const res = await r.fetch()
    const filas = (await res.json()) as { feature_key: string }[]
    await r.fulfill({ response: res, json: filas.filter((f) => f.feature_key !== 'conta_nucleo') })
  })
  await page.goto(NUEVO, { waitUntil: 'load' })
  await expect(page.getByPlaceholder('Ej.: Alquiler del local de octubre')).toBeVisible({ timeout: 40_000 })
  await expect(page.locator('.cxa'), 'con el interruptor apagado, la pantalla de hoy').toHaveCount(0)
  // Que la pantalla de hoy haya leído la analítica de la empresa antes de escribir: mientras no la
  // sabe, pide el local (useAnalitica, «como antes del S01») y la prueba elegía «común» en una empresa
  // con el eje apagado (e2e 1531: la de hoy guardó is_common true y la nueva, false).
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { /* lo que siga abierto no cuenta */ })
  await page.waitForTimeout(500)
  await page.getByPlaceholder('Ej.: Alquiler del local de octubre').fill('Alquiler de octubre')
  const hoy: [string, string, string][] = [[e.gasto, '1.000,00', ''], [e.otro, '210', ''], [e.banco, '', '1.210,00']]
  for (let i = 0; i < hoy.length; i++) {
    const n = i + 1
    if (i >= 2) await page.getByRole('button', { name: 'Añadir línea' }).click()
    await page.getByLabel(`Cuenta del apunte ${n}`).fill(hoy[i][0])
    await page.getByLabel(`Concepto del apunte ${n}`).fill('Alquiler de octubre')
    if (hoy[i][1]) await page.getByLabel(`Debe del apunte ${n}`).fill(hoy[i][1])
    if (hoy[i][2]) await page.getByLabel(`Haber del apunte ${n}`).fill(hoy[i][2])
    const sel = page.locator(`select[aria-label$="del apunte ${n}"]`)
    if (await sel.count()) { const v = await sel.inputValue(); if (!v || local) await sel.selectOption(local ?? 'comun') }
  }
  await page.getByRole('button', { name: 'Guardar y validar' }).first().click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\/[0-9a-f-]{36}/, { timeout: 60_000 })
  const deHoyId = page.url().split('/').pop()!.split('?')[0]
  const [a, b] = [await filas(s, nuevoId), await filas(s, deHoyId)]
  console.log(`[N08] guarda lo mismo · la nueva ${nuevoId}: ${JSON.stringify(a)}`)
  console.log(`[N08] guarda lo mismo · la de hoy ${deHoyId}: ${JSON.stringify(b)}`)
  expect(a, 'el mismo asiento con las dos pantallas deja las mismas filas').toEqual(b)
  expect(errores).toEqual([])
})
