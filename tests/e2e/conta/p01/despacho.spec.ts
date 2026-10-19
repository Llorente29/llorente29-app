/// <reference lib="dom" />
// tests/e2e/conta/p01/despacho.spec.ts
//
// P01 · «Impuestos de tus clientes» (maqueta_despacho.png), con la marca
// Sumied, en ordenador (1440) y móvil (390), solo con la asesoría de demo de
// SU carril (seed_p01_despacho_staging.sql, copiada por el carril): todo
// inventado. «Hoy» = 13/10/2026 con ?hoy= (solo vale contra una base de
// pruebas), para que el 3T se vea como en la maqueta.
//
// Las seis capturas del encargo:
//   1. la vista con todos los filtros apagados;
//   2. el filtro «con avisos»;
//   3. dos clientes elegidos y la barra de lotes;
//   4. la confirmación de presentar con la puerta cerrada (la de staging lo
//      está de verdad: no se presenta nada ni se llama a Hacienda);
//   5. asignar responsable;
//   6. un cliente sin consentimiento, que no sale.
// Y en cada una: nada se sale por la derecha.

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, STAGING_URL, anonKey, correoDePrueba, enCarril, entrarComo, pedirSesion, type Sesion } from '../sesion'

test.skip(CARRIL === null, 'La asesoría de demo vive en el carril: sin él habría que tocar la plantilla, que es de todos.')

const DIR = 'docs/conta/capturas/p01'
const LAURA = correoDePrueba('p01.laura@p01-prueba.test')
const PLATAFORMA = correoDePrueba('c06.plataforma@c06-prueba.test')
const ASESORIA = enCarril('d5ac0000-0000-4000-8000-0000000000a0')
const RUTA = 'impuestos/clientes?hoy=2026-10-13'
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

// Impuestos encendido para la asesoría de ESTE carril (la semilla lo pone en la
// plantilla; si la plantilla es de antes, aquí no falta), como la plataforma.
test.beforeAll(async () => {
  const plataforma = await pedirSesion(PLATAFORMA)
  await api(plataforma, 'POST', 'feature_flags?on_conflict=account_id,feature_key',
    { account_id: ASESORIA, feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e P01 (carril)' },
    'resolution=merge-duplicates,return=minimal')
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
async function abrir(page: Page) {
  await entrarComo(page, LAURA)
  await page.goto(`/conta/${RUTA}&marca=sumied`)
  await cargada(page)
  await expect(page.getByRole('heading', { name: 'Impuestos de tus clientes' })).toBeVisible()
  await expect(page.getByText('3.er trimestre 2026 · domiciliados hasta el 15/10 · el resto hasta el 20/10 · hoy 13/10', { exact: false })).toBeVisible()
}
const foto = (page: Page, nombre: string, entera = true) =>
  page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75, fullPage: entera })

async function sinDesbordar(page: Page, donde: string) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(sobra, `${donde}: la página se sale ${sobra} px por la derecha`).toBeLessThanOrEqual(1)
}
/** La lista que se ve: la tabla en el ordenador, las tarjetas en el móvil. */
const lista = (page: Page) => (esMovil(page) ? page.locator('.s-despacho-tarjetas') : page.getByRole('table', { name: 'Impuestos de tus clientes' }))
const elegir = (page: Page, nombre: string) => lista(page).getByRole('checkbox', { name: `Elegir ${nombre}` })

test('1 · Todos los filtros apagados: las cifras, los 8 clientes y lo que vence primero', async ({ page }) => {
  const errores = vigilar(page)
  await abrir(page)
  const cifras = page.getByRole('region', { name: 'Cifras del trimestre' })
  await expect(cifras.getByText('Modelos del trimestre')).toBeVisible()
  for (const [etiqueta, n] of [['Modelos del trimestre', '21'], ['Presentados', '7'], ['Revisados, listos para presentar', '6'], ['Para revisar', '8'], ['De ellos, vencen en 2 días', '1']] as const) {
    await expect(cifras.locator('.s-tarjeta-cifra', { hasText: etiqueta }).locator('.s-tarjeta-cifra-valor')).toHaveText(n)
  }
  await expect(page.getByRole('button', { name: 'Todos', pressed: true })).toBeVisible()
  await expect(lista(page).getByText('Ana Prueba Gómez')).toBeVisible()
  await expect(lista(page).getByText('303 vence en 2 días')).toBeVisible()
  await expect(lista(page).getByText('Certificado caduca en', { exact: false })).toBeVisible()
  await expect(page.getByText('8 clientes con permiso')).toBeVisible()
  await sinDesbordar(page, 'Todos')
  await foto(page, '1-todos')
  expect(errores).toEqual([])
})

test('2 · Filtro «con avisos»: dos clientes, y el pie dice de cuántos', async ({ page }) => {
  const errores = vigilar(page)
  await abrir(page)
  await page.getByRole('button', { name: 'Con avisos · 2' }).click()
  await expect(page.getByRole('button', { name: 'Con avisos · 2', pressed: true })).toBeVisible()
  await expect(lista(page).getByText('Clínica Dental de Prueba Sol, S.L.P.')).toBeVisible()
  await expect(lista(page).getByText('Talleres de Prueba Ruiz, S.L.')).toHaveCount(0)
  await expect(page.getByText('2 de 8 clientes')).toBeVisible()
  await sinDesbordar(page, 'Con avisos')
  await foto(page, '2-con-avisos')
  expect(errores).toEqual([])
})

test('3 y 4 · Dos clientes elegidos, la barra de lotes y la confirmación con la puerta cerrada', async ({ page }) => {
  const errores = vigilar(page)
  await abrir(page)
  await elegir(page, 'Talleres de Prueba Ruiz').check()
  await elegir(page, 'Bar de Prueba Esquina').check()
  const barra = page.getByRole('region', { name: 'Lo elegido' })
  await expect(barra.getByText('2 clientes elegidos · 4 modelos listos · 6.106,60 € a ingresar')).toBeVisible()
  await expect(barra.getByRole('button', { name: 'Presentar los 2 a Hacienda' })).toBeVisible()
  await sinDesbordar(page, 'Lote')
  await foto(page, '3-lote', !esMovil(page))
  // La confirmación: la lista con sus importes, el 111 y el 115 fuera, y por qué no presenta.
  await barra.getByRole('button', { name: 'Presentar los 2 a Hacienda' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Presentar a Hacienda' })
  await expect(dialogo).toBeVisible()
  await expect(dialogo.getByRole('list', { name: 'Lo que se presenta', exact: true }).getByRole('listitem')).toHaveCount(2)
  await expect(dialogo.getByText('3.104,60 € a ingresar')).toBeVisible()
  await expect(dialogo.getByText('El 111 y el 115 se presentan todavía fuera de Sumied', { exact: false })).toBeVisible()
  await expect(dialogo.getByRole('alert')).toContainText(/no está abierta|cerrad/i)
  await expect(dialogo.getByRole('button', { name: 'Presentar los 2 a Hacienda' })).toBeDisabled()
  await page.waitForTimeout(300)
  await foto(page, '4-confirmar-puerta-cerrada', false)
  await dialogo.getByRole('button', { name: 'Volver' }).click()
  // El resumen a los clientes: preparado y cerrado, y lo dice.
  await barra.getByRole('button', { name: 'Enviar resumen a los clientes' }).click()
  await expect(page.getByRole('dialog', { name: 'Enviar el resumen a los clientes' }).getByText('No se ha mandado nada', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Entendido' }).click()
  expect(errores).toEqual([])
})

test('5 · Asignar responsable: las personas de la asesoría, y dice qué ha pasado', async ({ page }) => {
  const errores = vigilar(page)
  await abrir(page)
  await lista(page).getByRole('button', { name: 'Panadería de Prueba Norte sin responsable. Asignar' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Responsable de Panadería de Prueba Norte, S.L.' })
  await expect(dialogo).toBeVisible()
  for (const p of ['Jorge Sanz', 'Laura Ortega', 'Marta Gil', 'Sin responsable']) await expect(dialogo.getByLabel(p)).toBeVisible()
  await dialogo.getByLabel('Jorge Sanz').check()
  await page.waitForTimeout(300)
  await foto(page, '5-responsable', false)
  // Guardar escribe: solo en el ordenador (el móvil corre a la vez en el mismo carril), y se deja como estaba.
  if (!esMovil(page)) {
    await dialogo.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.locator('.s-despacho-aviso')).toContainText('Jorge Sanz lleva ahora Panadería de Prueba Norte.')
    await lista(page).getByRole('button', { name: /Responsable de Panadería de Prueba Norte: Jorge Sanz/ }).click()
    await page.getByRole('dialog').getByLabel('Sin responsable').check()
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click()
    await expect(page.locator('.s-despacho-aviso')).toContainText('Panadería de Prueba Norte se queda sin responsable.')
  } else {
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  }
  expect(errores).toEqual([])
})

test('6 · Un cliente sin consentimiento no sale (ni el que lo retiró ni el que aún no ha aceptado)', async ({ page }) => {
  const errores = vigilar(page)
  await abrir(page)
  await expect(lista(page).getByText('Hostal de Prueba Mayor, S.L.')).toBeVisible()
  await expect(page.getByText('Fontanería de Prueba Retirada')).toHaveCount(0)
  await expect(page.getByText('Ferretería de Prueba Pendiente')).toHaveCount(0)
  // Tampoco por la base: como la asesoría, sus declaraciones no se leen.
  const laura = await pedirSesion(LAURA)
  const r = await api(laura, 'GET', `tax_return?company_id=in.(${enCarril('d5ac0000-0000-4000-8000-00000000c09e')},${enCarril('d5ac0000-0000-4000-8000-00000000c10e')})&select=id`) as unknown[]
  expect(r).toHaveLength(0)
  await page.getByRole('combobox', { name: 'Modelo' }).selectOption('303')
  await expect(page.getByText('8 de 8 clientes')).toBeVisible()
  await sinDesbordar(page, 'Sin consentimiento')
  await foto(page, '6-sin-consentimiento')
  expect(errores).toEqual([])
})
