/// <reference lib="dom" />
// tests/e2e/marcas/cambios-last.spec.ts
//
// F01 · PR 2 · Cambios en la carta de una marca de Last (tablero 5), en
// staging-conta, en ordenador y en móvil, con la carta de Last de prueba
// (supabase/seeds/folvy/seed_f01_marcas_last_staging.sql y
// seed_f01b_cambios_carta_staging.sql): «Latina de Prueba», dada de alta, y dos
// extras de Last en sus tequeños que nadie ha dicho qué descuentan.
//
//   1. INICIO: «Cambios en la carta de Latina de Prueba · 2 extras sin decidir»,
//      con su botón «Revisar».
//   2. LA PANTALLA: los dos extras nuevos, en palabras de cocina: «Pan de
//      hamburguesa extra» → Añade Pan de hamburguesa · 1 ud (Propuesto);
//      «Salsa de la casa» → No sé qué es (Falta), con «Revisar uno a uno».
//   3. GUARDAR: «Guardar el propuesto» confirma con contenido (regla 8), el
//      extra deja de salir y en la base queda su opción con lo que descuenta.
//
// Capturas en docs/marcas/capturas/, con el número de su tablero delante (5).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const DIR = 'docs/marcas/capturas'
const MARCA = 'Latina de Prueba'

async function rpc(nombre: string, cuerpo: unknown = {}) {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest<{ brand_id?: string }>(s, 'POST', `rpc/${nombre}`, cuerpo)
  expect(r.status, `${nombre}: ${JSON.stringify(r.datos)}`).toBe(200)
  return r.datos
}

async function irAInicio(page: Page) {
  await page.goto('/')
  const saludo = page.locator('h1').filter({ hasText: /^(Buenos días|Buenas tardes|Buenas noches)/ })
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500)
    if (new URL(page.url()).pathname !== '/') {
      await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
    } else if (await saludo.isVisible()) break
  }
  await expect(saludo).toBeVisible()
}

async function foto(page: Page, nombre: string, sufijo: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}${sufijo}.png`, fullPage: true })
}

test.afterEach(async () => { await rpc('e2e_f01_preparar', { p_que: 'limpiar' }) })

test('cambios de carta de Last: el aviso, los extras en palabras de cocina y guardar el propuesto', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const { brand_id } = await rpc('e2e_f01b_preparar')
  expect(brand_id).toBeTruthy()

  // ── 1 · Inicio ─────────────────────────────────────────────────────────────
  await entrarComo(page, CUENTA_A.email)
  await irAInicio(page)
  const fila = page.locator('[data-prueba="atencion"] li[data-tipo="carta"]').filter({ hasText: `Cambios en la carta de ${MARCA}` })
  await expect(fila).toHaveCount(1, { timeout: 20_000 })
  await expect(fila).toContainText('2 extras sin decidir')
  await fila.scrollIntoViewIfNeeded()
  await foto(page, '5-inicio-cambios', sufijo)

  // ── 2 · La pantalla ────────────────────────────────────────────────────────
  await fila.getByRole('button', { name: `Revisar: Cambios en la carta de ${MARCA}` }).click()
  await expect(page).toHaveURL(new RegExp(`/configuracion/cambios-last\\?marca=${brand_id}`))
  const pantalla = page.locator('[data-prueba="cambios-last"]')
  await expect(pantalla.getByRole('heading', { name: `Cambios en la carta de ${MARCA}` })).toBeVisible({ timeout: 20_000 })
  await expect(pantalla.locator('li[data-tipo="extras"]')).toContainText('2 extras nuevos')
  await expect(pantalla.locator('li[data-tipo="extras"]')).toContainText('Sin decidir')
  const filas = pantalla.locator('table tbody tr')
  await expect(filas).toHaveCount(2)
  await expect(filas.filter({ hasText: 'Pan de hamburguesa extra' })).toContainText('Añade Pan de hamburguesa · 1 ud')
  await expect(filas.filter({ hasText: 'Pan de hamburguesa extra' })).toContainText('Propuesto')
  await expect(filas.filter({ hasText: 'Salsa de la casa' })).toContainText('No sé qué es. Elígelo del almacén.')
  await expect(filas.filter({ hasText: 'Salsa de la casa' })).toContainText('Falta')
  await expect(pantalla.getByRole('link', { name: 'Revisar uno a uno' })).toHaveAttribute('href', '/kitchen/extras')
  await foto(page, '5-cambios-last', sufijo)

  // ── 3 · Guardar el propuesto ───────────────────────────────────────────────
  await pantalla.getByRole('button', { name: 'Guardar el propuesto' }).click()
  await expect(pantalla.getByRole('status')).toHaveText('Guardado 1 extra: ya dice qué descuenta del almacén.')
  await expect(filas).toHaveCount(1)
  await expect(filas.first()).toContainText('Salsa de la casa')
  await foto(page, '5-cambios-guardado', sufijo)

  const s = await pedirSesion(CUENTA_A.email)
  const o = await rest<{ id: string }[]>(s, 'GET', 'modifier_option?pos_modifier_id=eq.f01e2e-extra-1&select=id')
  expect(o.datos, 'la opción, creada como la crearía la importación').toHaveLength(1)
  const i = await rest<{ impact_type: string; quantity: number; status: string }[]>(s, 'GET',
    `modifier_recipe_impact?modifier_option_id=eq.${o.datos[0].id}&select=impact_type,quantity,status`)
  expect(i.datos).toEqual([expect.objectContaining({ impact_type: 'add_item', quantity: 1, status: 'confirmed' })])
})
