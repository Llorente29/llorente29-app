/// <reference lib="dom" />
// tests/e2e/marcas/recetas-y-codigo.spec.ts
//
// F01 · PR 3 · Las recetas que faltan (tablero 3) y una marca que ya tienes con
// otro código (tablero 4), en staging-conta, en ordenador y en móvil, con la
// carta de Last de prueba (supabase/seeds/folvy/seed_f01c_recetas_y_codigo_staging.sql):
// «Pollería de Prueba» (dada de alta: 3 platos con receta, el agua del almacén,
// Alitas sin receta y Croquetas sin artículo) y, en Last, «Pollería Express»
// (otro código, carta idéntica) y «Pollos Nuevos» (otro código, se parece).
//
//   3. LA CARTA: «3 de 5 platos con receta», Alitas con su venta esperando.
//      «Subir mis recetas» con un Excel: Folvy lo lee (la lectura de Cocina; la
//      IA la pone la semilla, la prueba no la llama), dice de qué plato es,
//      enseña los ingredientes para confirmar y, al guardar, la venta de Alitas
//      se coloca sola y descuenta el pan. «Hacer receta» en Croquetas lleva a
//      su receta en Cocina.
//   4. EL CÓDIGO CAMBIADO: en Inicio, Pollos Nuevos se pregunta; Express, tras
//      la pasada de cada hora, se avisa como reconocida. En Marcas › Revisar,
//      las dos cartas una al lado de la otra; «Sí, es Pollería de Prueba» le pone
//      la marca a sus 2 ventas y lo dice; «Entendido» quita el aviso de Express.
//
// Capturas en docs/marcas/capturas/, con el número de su tablero delante (3 y 4).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const DIR = 'docs/marcas/capturas'
const MARCA = 'Pollería de Prueba'

async function preparar(que: 'empezar' | 'pasada' | 'limpiar') {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest<{ cuenta: string; marca: string; sesion: string | null; reconocidas_solas?: unknown[] }>(s, 'POST', 'rpc/e2e_f01c_preparar', { p_que: que })
  expect(r.status, `e2e_f01c_preparar(${que}): ${JSON.stringify(r.datos)}`).toBe(200)
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

/** Si algo no sale, el error dice lo que enseña la pantalla (Respuesta 7). */
async function esperarOContar(page: Page, errores: string[], esperar: () => Promise<void>) {
  try {
    await esperar()
  } catch (e) {
    const texto = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 400)
    const avisos = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [] as string[])).map((t) => t.trim()).filter(Boolean)
    throw new Error([
      (e as Error).message.split('\n')[0],
      `Dirección: ${page.url()}`,
      `Avisos en pantalla: ${avisos.length ? avisos.join(' | ') : 'ninguno'}`,
      `Pantalla (400 caracteres): ${texto || '(vacía)'}`,
      `pageerror: ${errores.length ? errores.join(' | ') : 'ninguno'}`,
    ].join('\n'), { cause: e })
  }
}

test.afterEach(async () => { await preparar('limpiar') })

test('tablero 3 · las recetas que faltan: subir la de Alitas coloca su venta; «Hacer receta» abre Cocina', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const { cuenta, marca, sesion } = await preparar('empezar')
  expect(sesion, 'la lectura de Alitas que deja la semilla').toBeTruthy()

  // La lectura de Cocina (extract-recipe) devuelve la sesión que ha dejado la
  // semilla: lo de después (de qué plato es, confirmar, guardar, colocar) es real.
  await page.route('**/functions/v1/extract-recipe', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors })
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({
      session_id: sesion, status: 'pending_review', lines_extracted: 1, lines_mapped: 0, proposal_error: null,
      parsed: { dish: { name: 'Alitas de Prueba', brand: MARCA }, lines: [{ raw_text: 'Pan de hamburguesa', quantity: 1, unit: 'ud', cost: null, note: null }] },
    }) })
  })

  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/configuracion/marcas?marca=${marca}&pestana=carta`)
  const carta = page.locator('[data-prueba="carta-marca"]')
  await esperarOContar(page, errores, () => expect(carta.locator('[data-prueba="carta-progreso"]')).toHaveText('3 de 5 platos con receta', { timeout: 20_000 }))
  await expect(page.getByRole('tab', { name: 'Carta' })).toHaveAttribute('aria-selected', 'true')
  await expect(carta).toContainText('Propia · Norte Centro · Uber Eats y Glovo')
  await expect(carta).toContainText('El artículo del almacén (bebida o postre) ya está enlazado con tu almacén. 1 venta espera a su receta: descontará almacén en cuanto la pongas.')
  const filas = carta.locator('table tbody tr')
  await expect(filas).toHaveCount(6)
  // Primero las que faltan; el del almacén, al final.
  await expect(filas.nth(0)).toContainText('Alitas de Prueba')
  await expect(filas.nth(0)).toContainText('Sin receta')
  await expect(filas.nth(0)).toContainText('1 venta esperando')
  await expect(filas.nth(1)).toContainText('Croquetas de Prueba')
  await expect(filas.last()).toContainText('Agua mineral 50 cl')
  await expect(filas.last()).toContainText('Del almacén')
  await expect(filas.filter({ hasText: 'Pollo asado de Prueba' })).toContainText('Con receta')
  await expect(filas.filter({ hasText: 'Pollo asado de Prueba' })).toContainText('12,50 €')
  await foto(page, '3-carta', sufijo)

  // ── «Subir mis recetas» con un Excel ───────────────────────────────────────
  await carta.locator('[data-prueba="subir-recetas"]').setInputFiles({
    name: 'alitas.csv', mimeType: 'text/csv', buffer: Buffer.from('Plato;Ingrediente;Cantidad;Unidad\nAlitas de Prueba;Pan de hamburguesa;1;ud\n'),
  })
  const leida = carta.locator('[data-prueba="receta-leida"]')
  await esperarOContar(page, errores, () => expect(leida).toContainText('He leído «Alitas de Prueba» en alitas.csv: 1 ingrediente.', { timeout: 20_000 }))
  await expect(leida.locator('select option:checked')).toHaveText('Alitas de Prueba')
  await foto(page, '3-receta-leida', sufijo)
  await leida.getByRole('button', { name: 'Revisar y guardar' }).click()

  const revisar = page.getByRole('heading', { name: 'Revisar receta importada' })
  await expect(revisar).toBeVisible({ timeout: 20_000 })
  const terminar = page.getByRole('button', { name: 'Terminar y crear' })
  // Si Folvy no lo propone solo, se elige el pan de la despensa (lo que haría Julio).
  if (!(await terminar.isEnabled({ timeout: 10_000 }).catch(() => false))) {
    await page.getByRole('button', { name: /^Pan de hamburguesa/ }).first().click()
  }
  await foto(page, '3-receta-confirmar', sufijo)
  await terminar.click()

  const hecho = carta.locator('[data-prueba="carta-hecho"]')
  await esperarOContar(page, errores, () => expect(hecho.first()).toHaveText(
    'Receta de Alitas de Prueba guardada (1 ingrediente). 1 venta colocada y descontada del almacén.', { timeout: 30_000 }))
  await expect(carta.locator('[data-prueba="carta-progreso"]')).toHaveText('4 de 5 platos con receta')
  await expect(filas.filter({ hasText: 'Alitas de Prueba' })).toContainText('Con receta')
  await foto(page, '3-receta-guardada', sufijo)

  // En la base: la venta de Alitas ya descuenta el pan.
  const s = await pedirSesion(CUENTA_A.email)
  const v = await rest<{ id: string }[]>(s, 'GET', `sale?account_id=eq.${cuenta}&external_ref=eq.f01c-e2e-1&is_active=eq.true&select=id`)
  expect(v.datos).toHaveLength(1)
  const pan = await rest<{ recipe_item_id: string }[]>(s, 'GET',
    `stock_movement?source_id=eq.${v.datos[0].id}&movement_type=eq.consumo&select=recipe_item_id`)
  expect(pan.datos.length, 'la venta de Alitas descuenta lo de su receta').toBeGreaterThan(0)

  // ── «Hacer receta» en Croquetas (sin artículo todavía) ────────────────────
  await filas.filter({ hasText: 'Croquetas de Prueba' }).getByRole('button', { name: 'Hacer receta: Croquetas de Prueba' }).click()
  await expect(page).toHaveURL(/\/kitchen\/recetas\?recipe=[0-9a-f-]{36}&tab=escandallo|\/kitchen\/recetas/, { timeout: 20_000 })
  const mi = await rest<{ recipe_item_id: string | null }[]>(s, 'GET',
    `menu_item?brand_id=eq.${marca}&name=eq.${encodeURIComponent('Croquetas de Prueba')}&archived_at=is.null&select=recipe_item_id`)
  expect(mi.datos[0]?.recipe_item_id, 'Croquetas ya tiene su artículo, vacío, donde escribir la receta').toBeTruthy()
  await page.waitForTimeout(1500)
  await foto(page, '3-hacer-receta', sufijo)
})

test('tablero 4 · el código cambiado: idéntica se une sola y avisa; la que se parece se pregunta y «Sí, es…» coloca', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const { cuenta, marca } = await preparar('empezar')

  // ── Inicio: antes de la pasada, las dos se preguntan ──────────────────────
  await entrarComo(page, CUENTA_A.email)
  await irAInicio(page)
  const atencion = page.locator('[data-prueba="atencion"]')
  const nuevos = atencion.locator('li[data-tipo="revisar"]').filter({ hasText: 'Pollos Nuevos llega con otro código en Norte Mercado' })
  await esperarOContar(page, errores, () => expect(nuevos).toHaveCount(1, { timeout: 20_000 }))
  await expect(nuevos).toContainText(`¿Es tu ${MARCA}? Su carta se parece: 3 de 6 platos coinciden.`)
  await expect(nuevos).toContainText('2 ventas esperando')

  // La pasada de cada hora: Express (carta idéntica) se une sola.
  const p = await preparar('pasada')
  expect(p.reconocidas_solas, 'la pasada une Express sola').toHaveLength(1)
  await irAInicio(page)
  const express = atencion.locator('li[data-tipo="reconocida"]').filter({ hasText: 'Pollería Express en Norte Mercado: reconocida, 1 venta colocada' })
  await esperarOContar(page, errores, () => expect(express).toHaveCount(1, { timeout: 20_000 }))
  await expect(express).toContainText(`Llegó de Last con otro código y la misma carta que tu ${MARCA}: Folvy la ha unido sola.`)
  await expect(atencion.locator('li[data-tipo="revisar"]').filter({ hasText: 'Pollería Express' })).toHaveCount(0)
  await nuevos.scrollIntoViewIfNeeded()
  await foto(page, '4-inicio', sufijo)

  // ── Marcas › Revisar: las dos cartas, una al lado de la otra ──────────────
  await nuevos.getByRole('button', { name: /^Revisar/ }).click()
  await expect(page).toHaveURL(/\/configuracion\/revisar-last\?marca=/)
  const pregunta = page.locator('[data-prueba="revisar-pregunta"]').filter({ hasText: 'Pollos Nuevos' })
  await esperarOContar(page, errores, () => expect(pregunta.getByRole('heading', { name: `¿Es tu ${MARCA}?` })).toBeVisible({ timeout: 20_000 }))
  await expect(pregunta).toContainText('2 ventas esperando')
  await expect(pregunta).toContainText(`Llegan pedidos de Norte Mercado con una marca «Pollos Nuevos» que Folvy no conocía. Su carta se parece a la de tu ${MARCA}.`)
  await expect(pregunta.locator('[data-prueba="carta-last"]')).toContainText('Wrap de Pollo · no está en tu carta')
  await expect(pregunta.locator('[data-prueba="carta-folvy"]')).toContainText(`${MARCA} · Norte Centro y Norte Mercado`)
  await expect(pregunta.locator('[data-prueba="carta-folvy"]')).toContainText('6 platos, 4 con receta. 3 de 6 coinciden.')
  await expect(pregunta).toContainText(`Al confirmar, las 2 ventas pasan a ${MARCA} y descuentan almacén con sus recetas.`)
  await expect(page.locator('[data-prueba="revisar-reconocidas"]')).toContainText('Pollería Express en Norte Mercado: reconocida, 1 venta colocada')
  await foto(page, '4-revisar', sufijo)

  await pregunta.getByRole('button', { name: `Sí, es ${MARCA}` }).click()
  const hecho = page.locator('[data-prueba="revisar-hecho"]')
  await esperarOContar(page, errores, () => expect(hecho).toHaveText(
    `Hecho: Pollos Nuevos de Norte Mercado es tu ${MARCA}. 2 ventas colocadas. Falta la receta de Wrap de Pollo: descontará en cuanto la pongas.`, { timeout: 30_000 }))
  await expect(page.locator('[data-prueba="revisar-pregunta"]').filter({ hasText: 'Pollos Nuevos' })).toHaveCount(0)
  await foto(page, '4-revisar-hecho', sufijo)

  // En la base: las ventas de Express y de Pollos Nuevos tienen ya la marca.
  const s = await pedirSesion(CUENTA_A.email)
  const ventas = await rest<{ external_ref: string; brand_id: string | null }[]>(s, 'GET',
    `sale?account_id=eq.${cuenta}&external_ref=in.(f01c-e2e-2,f01c-e2e-3,f01c-e2e-4)&is_active=eq.true&select=external_ref,brand_id&order=external_ref`)
  expect(ventas.datos.map((x) => `${x.external_ref} ${x.brand_id === marca ? 'con marca' : 'sin marca'}`))
    .toEqual(['f01c-e2e-2 con marca', 'f01c-e2e-3 con marca', 'f01c-e2e-4 con marca'])

  // «Entendido» en lo que Folvy hizo solo.
  const solas = page.locator('[data-prueba="revisar-reconocidas"]')
  await solas.getByRole('button', { name: /^Entendido: Pollería Express/ }).click()
  await expect(hecho).toHaveText('Entendido: no volverá a avisar.')
  await expect(solas).toHaveCount(0)
})
