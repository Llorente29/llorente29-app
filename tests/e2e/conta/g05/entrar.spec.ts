/// <reference lib="dom" />
// tests/e2e/conta/g05/entrar.spec.ts
//
// G05 · La gestoría entra en su cliente y lo lleva entero, con la marca Sumied,
// en ordenador (1440) y móvil (390), solo con la asesoría de demo de SU carril
// (seed_p01_despacho_staging.sql): todo inventado (T11).
//
//   1. «Tus clientes» con «Entrar» en cada fila; entrar en Hostal de Prueba
//      Mayor: se aterriza en su Inicio, con la franja del despacho (razón social
//      y «cliente de …»), en cómoda y en compacta;
//   2. dentro: Contabilidad y Laboral son las del cliente (la franja y la
//      empresa de la cabecera siguen diciendo Hostal), y Ajustes no enseña
//      «Usuarios»;
//   3. el selector de la cabecera, con «Tus empresas» y «Clientes de …»;
//   4. «Cambiar de cliente»: el buscador, y entrar en Talleres sin pasar por el
//      despacho;
//   5. «Volver al despacho»: otra vez en Impuestos › Tus clientes, sin franja.
// Y en cada una: nada se sale por la derecha. Las capturas, en
// docs/conta/capturas/g05/.
//
// La semilla de las dos sociedades del mismo nombre comercial
// (seed_g05_entrar_staging.sql) llega a staging al fusionar: hasta que el carril
// la copie, ese caso lo prueban la prueba de staging y las unitarias.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, STAGING_URL, anonKey, correoDePrueba, enCarril, entrarComo, pedirSesion, type Sesion } from '../sesion'

test.skip(CARRIL === null, 'La asesoría de demo vive en el carril: sin él habría que tocar la plantilla, que es de todos.')

const DIR = 'docs/conta/capturas/g05'
const LAURA = correoDePrueba('p01.laura@p01-prueba.test')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const ASESORIA = enCarril('d5ac0000-0000-4000-8000-0000000000a0')
const HOSTAL = 'Hostal de Prueba Mayor, S.L.'
const TALLERES = 'Talleres de Prueba Ruiz, S.L.'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const esMovil = (page: Page) => lado(page) === 'movil'

async function api(s: Sesion, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown, prefer = 'return=representation') {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: metodo,
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${texto.slice(0, 300)}`)
  return texto ? JSON.parse(texto) : null
}

test.beforeAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: ASESORIA, feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e G05 (carril)' },
    'resolution=merge-duplicates,return=minimal')
})

// Laura vuelve SIEMPRE a su asesoría al acabar: las demás pruebas del carril
// (la del P01) entran con ella y esperan su despacho abierto.
test.afterEach(async () => {
  const laura = await pedirSesion(LAURA)
  await api(laura, 'POST', 'rpc/cambiar_empresa', { p_account_id: ASESORIA })
})

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
const foto = (page: Page, nombre: string, entera = false) =>
  page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: entera })

async function sinDesbordar(page: Page, donde: string) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, `${donde}: la página se sale ${sobra} px por la derecha`).toBeLessThanOrEqual(1)
}
const franja = (page: Page) => page.getByRole('region', { name: 'Estás en un cliente de tu despacho' })

async function abrirUsuario(page: Page) {
  if (esMovil(page) && await page.getByRole('dialog', { name: 'Menú' }).count() === 0) {
    await page.getByRole('button', { name: 'Abrir el menú' }).click()
  }
  await page.getByRole('button', { name: /\. Tus preferencias$/ }).click()
}
async function densidad(page: Page, cual: 'Cómoda' | 'Compacta') {
  await abrirUsuario(page)
  await page.getByRole('group', { name: 'Densidad' }).getByRole('button', { name: new RegExp(`^${cual}`) }).click()
  await expect(page.getByRole('status').filter({ hasText: `Densidad: ${cual.toLowerCase()}` })).toBeVisible()
  if (await page.getByRole('dialog', { name: 'Menú' }).count()) await page.getByRole('button', { name: 'Cerrar el menú' }).click()
  await page.keyboard.press('Escape')
}

async function entrarEnHostal(page: Page) {
  await entrarComo(page, LAURA)
  await page.goto('/conta/impuestos/clientes?hoy=2026-10-13&marca=sumied')
  await cargada(page)
  await expect(page.getByRole('heading', { name: 'Impuestos de tus clientes' })).toBeVisible()
  const lista = esMovil(page) ? page.locator('.s-despacho-tarjetas') : page.getByRole('table', { name: 'Impuestos de tus clientes' })
  const entrar = lista.getByRole('button', { name: `Entrar en ${HOSTAL}` })
  await expect(entrar).toBeVisible()
  await expect(entrar).toHaveText('Entrar')
  return entrar
}

test('1 · «Entrar» desde Tus clientes: el Inicio del cliente, con la franja del despacho', async ({ page }) => {
  const errores = vigilar(page)
  const entrar = await entrarEnHostal(page)
  await sinDesbordar(page, 'Tus clientes')
  await foto(page, 'despacho-entrar', true)

  await entrar.click()
  await page.waitForURL(/\/conta\/inicio/, { timeout: 30_000 })
  await cargada(page)
  await expect(franja(page)).toBeVisible()
  await expect(franja(page).getByText(HOSTAL, { exact: true })).toBeVisible()
  await expect(franja(page)).toContainText('cliente de ')
  await expect(franja(page).getByRole('button', { name: /Cambiar de cliente/ })).toBeVisible()
  await expect(franja(page).getByRole('button', { name: 'Volver al despacho' })).toBeVisible()
  await expect(page.locator('[data-prueba="inicio-titulo"]')).toHaveText(HOSTAL)
  // La franja no se puede cerrar: no tiene botón de cerrar.
  await expect(franja(page).getByRole('button', { name: /cerrar/i })).toHaveCount(0)
  await sinDesbordar(page, 'el Inicio del cliente')
  await foto(page, 'franja-comoda')
  await densidad(page, 'Compacta')
  await foto(page, 'franja-compacta')
  await densidad(page, 'Cómoda')
  expect(errores).toEqual([])
})

test('2 · Dentro: Contabilidad y Laboral son del cliente, y Ajustes no enseña Usuarios', async ({ page }) => {
  const errores = vigilar(page)
  await (await entrarEnHostal(page)).click()
  await page.waitForURL(/\/conta\/inicio/, { timeout: 30_000 })
  await cargada(page)

  for (const ruta of ['/conta/libros/diario', '/conta/laboral']) {
    await page.goto(`${ruta}?marca=sumied`)
    await cargada(page)
    await expect(franja(page).getByText(HOSTAL, { exact: true }), `${ruta}: la franja dice el cliente`).toBeVisible()
    await expect(page.getByRole('button', { name: /Cambiar de empresa$/ }).first(), `${ruta}: la cabecera dice el cliente`).toContainText('Hostal de Prueba Mayor')
    await sinDesbordar(page, ruta)
  }
  await page.goto('/conta/ajustes/personas?marca=sumied')
  await cargada(page)
  await expect(page.getByText('Los usuarios los lleva el cliente.')).toBeVisible()
  expect(errores).toEqual([])
})

test('3 y 4 · El selector con los dos grupos, y «Cambiar de cliente» entra en otro sin pasar por el despacho', async ({ page }) => {
  const errores = vigilar(page)
  await (await entrarEnHostal(page)).click()
  await page.waitForURL(/\/conta\/inicio/, { timeout: 30_000 })
  await cargada(page)

  // El selector de la cabecera: «Tus empresas» y «Clientes de …», con la razón social en cada fila.
  await page.getByRole('button', { name: /Cambiar de empresa$/ }).first().click()
  const selector = page.locator('[data-prueba="varias-empresas"]')
  await expect(selector.getByRole('group', { name: 'Tus empresas' })).toBeVisible()
  const clientes = selector.locator('[data-prueba="selector-clientes"]')
  await expect(clientes).toBeVisible()
  await expect(clientes.getByText(TALLERES, { exact: true })).toBeVisible()
  await foto(page, 'selector-dos-grupos')
  await page.keyboard.press('Escape')
  if (await selector.count()) await page.getByRole('button', { name: /Cambiar de empresa$/ }).first().click()

  // «Cambiar de cliente»: el buscador por razón social.
  await franja(page).getByRole('button', { name: /Cambiar de cliente/ }).click()
  const menu = page.getByRole('group', { name: 'Cambiar de cliente' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: new RegExp(HOSTAL.replace(/[.,]/g, '.')) })).toHaveAttribute('aria-current', 'true')
  await foto(page, 'cambiar-de-cliente')
  await menu.getByRole('searchbox', { name: 'Buscar cliente' }).fill('talleres')
  await expect(menu.locator('[data-prueba="cliente-fila"]')).toHaveCount(1)
  await menu.getByRole('button', { name: new RegExp(TALLERES.replace(/[.,]/g, '.')) }).click()
  await page.waitForURL(/\/conta\/inicio/, { timeout: 30_000 })
  await cargada(page)
  await expect(franja(page).getByText(TALLERES, { exact: true })).toBeVisible()
  expect(errores).toEqual([])
})

test('5 · «Volver al despacho»: Impuestos › Tus clientes, sin franja', async ({ page }) => {
  const errores = vigilar(page)
  await (await entrarEnHostal(page)).click()
  await page.waitForURL(/\/conta\/inicio/, { timeout: 30_000 })
  await cargada(page)
  await franja(page).getByRole('button', { name: 'Volver al despacho' }).click()
  await page.waitForURL(/\/conta\/impuestos\/clientes/, { timeout: 30_000 })
  await cargada(page)
  await expect(page.getByRole('heading', { name: 'Impuestos de tus clientes' })).toBeVisible()
  await expect(franja(page)).toHaveCount(0)
  expect(errores).toEqual([])
})
