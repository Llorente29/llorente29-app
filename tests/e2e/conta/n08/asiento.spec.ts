/// <reference lib="dom" />
// tests/e2e/conta/n08/asiento.spec.ts
//
// K12 · La ficha del N08 la sustituye el asiento general (tests/e2e/conta/k12/asiento.spec.ts): de aquí se quitan la
// 1 (a mano con el teclado) y la 4 (guarda lo mismo), que hace allí la K12 · 1 y la K12 · 6. Quedan la 2 (el propuesto
// se valida con Intro, ya en el asiento general) y la 3 (con el interruptor apagado, la pantalla de hoy).
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
import { NUCLEO, zonaActiva } from '../k02/comun'

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

const elegirEmpresa = (page: Page, cuenta: string, empresa: string) =>
  page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${cuenta}`, empresa] as const)

async function abrirAsientos(page: Page) {
  await page.goto('/conta', { waitUntil: 'load' })
  await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Asientos' }).click()
  await page.locator('[data-boton="asientos"]').click()
  await expect(zonaActiva(page).getByRole('heading', { name: 'Asiento general', exact: true })).toBeVisible({ timeout: 40_000 })
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
  await expect(zona.getByRole('status').filter({ hasText: 'Propuesto: Intro lo valida.' })).toBeVisible({ timeout: 40_000 })
  await expect(zona.locator('#ag-descuadre')).toHaveValue('0,00')
  await page.screenshot({ path: `${DIR}/propuesto.png` })
  await zona.getByRole('heading', { name: 'Asiento general' }).click()
  await page.keyboard.press('Enter')
  await expect(zonaActiva(page).getByRole('status').filter({ hasText: /^Validado: 4 \/ \d{4} · Alquiler de julio · 1\.210,00 al debe y al haber\./ })).toBeVisible({ timeout: 60_000 })
  const v = await rest<{ status: string; number: number }[]>(s, 'GET', `journal_entry?select=status,number&id=eq.${p.datos.id}`)
  expect(v.datos[0].status).toBe('validado')
  await page.goto(`/conta/libros/diario/${p.datos.id}`, { waitUntil: 'load' })
  await expect(zonaActiva(page).locator('#ag-documento')).toHaveValue(String(v.datos[0].number), { timeout: 40_000 })
  await page.screenshot({ path: `${DIR}/validado.png` })
  expect(errores).toEqual([])
})

test('N08 · 3 · con el interruptor apagado (la cuenta A), la pantalla de hoy', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(NUEVO, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Nuevo asiento' }).first()).toBeVisible({ timeout: 40_000 })
  await expect(page.locator('.cxa')).toHaveCount(0)
})
