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
// Respuesta 10: ordenador y móvil corren A LA VEZ sobre la misma cuenta. Cada
// uno tiene su juego de la semilla (el del móvil, con « M» detrás de cada
// nombre) y cada prueba empieza desde su punto de partida: la preparación borra
// las ventas de la pasada anterior y pone las suyas. Lanzarla dos veces da lo
// mismo. Si una cifra no cuadra, el fallo dice lo que esperaba y lo que pone la
// pantalla.
//
//   3. LA CARTA: «3 de 5 platos con receta», Alitas con su venta esperando.
//      «Subir mis recetas» con un Excel: Folvy lo lee (la lectura de Cocina; la
//      IA la pone la semilla, la prueba no la llama: 6 ud de alitas de pollo),
//      dice de qué plato es, propone «Alitas de pollo» del almacén para
//      confirmar y, al guardar, la venta de Alitas se coloca sola y descuenta.
//      «Hacer receta» en Croquetas lleva a su receta en Cocina.
//   4. EL CÓDIGO CAMBIADO: en Inicio, Pollos Nuevos se pregunta; Express, tras
//      la pasada de cada hora, se avisa como reconocida. En Marcas › Revisar,
//      las dos cartas una al lado de la otra; «Sí, es Pollería de Prueba» le pone
//      la marca a sus 2 ventas y lo dice; «Entendido» quita el aviso de Express.
//
// Capturas en docs/marcas/capturas/, con el número de su tablero delante (3 y 4).

import { test, expect, type Locator, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const DIR = 'docs/marcas/capturas'
type Juego = 'ordenador' | 'movil'

/** Los nombres del juego: el del móvil lleva « M» detrás. */
const nombres = (juego: Juego) => {
  const m = juego === 'movil' ? ' M' : ''
  return {
    marca: `Pollería de Prueba${m}`, express: `Pollería Express${m}`, nuevos: `Pollos Nuevos${m}`,
    alitas: `Alitas de Prueba${m}`, croquetas: `Croquetas de Prueba${m}`, pollo: `Pollo asado de Prueba${m}`, wrap: `Wrap de Pollo${m}`,
  }
}
const juegoDe = (proyecto: string): Juego => (proyecto === 'movil' ? 'movil' : 'ordenador')

async function preparar(que: 'empezar' | 'pasada' | 'limpiar', juego: Juego) {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest<{ cuenta: string; marca: string; sesion: string | null; ventas?: number; borradas?: number; reconocidas_solas?: unknown[] }>(
    s, 'POST', 'rpc/e2e_f01c_preparar', { p_que: que, p_juego: juego })
  expect(r.status, `e2e_f01c_preparar(${que}, ${juego}): ${JSON.stringify(r.datos)}`).toBe(200)
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

/**
 * Respuesta 10: espera a que el sitio diga ESE texto; si no lo dice, el fallo
 * lo cuenta en claro: «esperaba «1 venta esperando» y la pantalla dice «3 ventas
 * esperando…»».
 */
async function dice(sitio: Locator, esperado: string, que: string, timeout = 20_000) {
  let visto = ''
  try {
    await expect.poll(async () => { visto = (await sitio.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(); return visto.includes(esperado) },
      { timeout }).toBe(true)
  } catch (e) {
    throw new Error(`${que}: esperaba «${esperado}» y la pantalla dice «${visto.slice(0, 300) || '(nada)'}».`, { cause: e })
  }
}

test.afterEach(async () => { await preparar('limpiar', juegoDe(test.info().project.name)) })

test('tablero 3 · las recetas que faltan: subir la de Alitas coloca su venta; «Hacer receta» abre Cocina', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const juego = juegoDe(info.project.name)
  const n = nombres(juego)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const { cuenta, marca, sesion, ventas } = await preparar('empezar', juego)
  expect(sesion, 'la lectura de Alitas que deja la semilla').toBeTruthy()
  expect(ventas, 'las ventas de la prueba, puestas desde cero').toBe(4)

  // La lectura de Cocina (extract-recipe) devuelve la sesión que ha dejado la
  // semilla: lo de después (de qué plato es, confirmar, guardar, colocar) es real.
  await page.route('**/functions/v1/extract-recipe', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors })
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({
      session_id: sesion, status: 'pending_review', lines_extracted: 1, lines_mapped: 0, proposal_error: null,
      parsed: { dish: { name: n.alitas, brand: n.marca }, lines: [{ raw_text: 'Alitas de pollo', quantity: 6, unit: 'ud', cost: null, note: null }] },
    }) })
  })

  await entrarComo(page, CUENTA_A.email)
  await page.goto(`/configuracion/marcas?marca=${marca}&pestana=carta`)
  const carta = page.locator('[data-prueba="carta-marca"]')
  await esperarOContar(page, errores, () => dice(carta.locator('[data-prueba="carta-progreso"]'), '3 de 5 platos con receta', 'La carta'))
  await expect(page.getByRole('tab', { name: 'Carta' })).toHaveAttribute('aria-selected', 'true')
  await dice(carta, 'Propia · Norte Centro · Uber Eats y Glovo', 'La cabecera de la carta')
  await dice(carta, 'El artículo del almacén (bebida o postre) ya está enlazado con tu almacén. 1 venta espera a su receta: descontará almacén en cuanto la pongas.',
    'Lo que espera su receta')
  const filas = carta.locator('table tbody tr')
  await expect(filas).toHaveCount(6)
  // Primero las que faltan; el del almacén, al final.
  await dice(filas.nth(0), `${n.alitas}`, 'La primera fila')
  await dice(filas.nth(0), 'Sin receta', `La fila de ${n.alitas}`)
  await dice(filas.nth(0), '1 venta esperando', `La fila de ${n.alitas}`)
  await dice(filas.nth(1), n.croquetas, 'La segunda fila')
  await dice(filas.last(), 'Agua mineral 50 cl', 'La última fila')
  await dice(filas.last(), 'Del almacén', 'La fila del agua')
  await dice(filas.filter({ hasText: n.pollo }), 'Con receta', `La fila de ${n.pollo}`)
  await dice(filas.filter({ hasText: n.pollo }), '12,50 €', `La fila de ${n.pollo}`)
  await foto(page, '3-carta', sufijo)

  // ── «Subir mis recetas» con un Excel ───────────────────────────────────────
  await carta.locator('[data-prueba="subir-recetas"]').setInputFiles({
    name: 'alitas.csv', mimeType: 'text/csv', buffer: Buffer.from(`Plato;Ingrediente;Cantidad;Unidad\n${n.alitas};Alitas de pollo;6;ud\n`),
  })
  const leida = carta.locator('[data-prueba="receta-leida"]')
  await esperarOContar(page, errores, () => dice(leida, `He leído «${n.alitas}» en alitas.csv: 1 ingrediente.`, 'La lectura'))
  await expect(leida.locator('select option:checked')).toHaveText(n.alitas)
  await foto(page, '3-receta-leida', sufijo)
  await leida.getByRole('button', { name: 'Revisar y guardar' }).click()

  // La revisión de Cocina: cuando acaba de buscar, propone «Alitas de pollo» del
  // almacén (es el mismo nombre) y la línea queda resuelta. Se confirma eso.
  const ventana = page.locator('div.fixed').filter({ has: page.getByRole('heading', { name: 'Revisar receta importada' }) })
  await expect(ventana).toBeVisible({ timeout: 20_000 })
  await esperarOContar(page, errores, () => dice(ventana, '1 de 1 resueltos', 'La revisión de la receta', 30_000))
  await dice(ventana, 'Usando Alitas de pollo', 'Lo que propone la revisión')
  await foto(page, '3-receta-confirmar', sufijo)
  await ventana.getByRole('button', { name: 'Terminar y crear' }).click()

  const hecho = carta.locator('[data-prueba="carta-hecho"]').first()
  await esperarOContar(page, errores, () => dice(hecho,
    `Receta de ${n.alitas} guardada (1 ingrediente). 1 venta colocada y descontada del almacén.`, 'La confirmación', 30_000))
  await dice(carta.locator('[data-prueba="carta-progreso"]'), '4 de 5 platos con receta', 'La carta después de guardar')
  await dice(filas.filter({ hasText: n.alitas }), 'Con receta', `La fila de ${n.alitas}`)
  await foto(page, '3-receta-guardada', sufijo)

  // En la base: la venta de Alitas ya descuenta las alitas de pollo.
  const s = await pedirSesion(CUENTA_A.email)
  const v = await rest<{ id: string }[]>(s, 'GET', `sale?account_id=eq.${cuenta}&external_ref=eq.f01c-e2e-${juego}-1&select=id`)
  expect(v.datos, 'la venta de Alitas de esta pasada, una sola').toHaveLength(1)
  const consumo = await rest<{ recipe_item_id: string }[]>(s, 'GET',
    `stock_movement?source_id=eq.${v.datos[0].id}&movement_type=eq.consumo&select=recipe_item_id`)
  expect(consumo.datos.length, 'la venta de Alitas descuenta lo de su receta').toBeGreaterThan(0)

  // ── «Hacer receta» en Croquetas (sin artículo todavía) ────────────────────
  await filas.filter({ hasText: n.croquetas }).getByRole('button', { name: `Hacer receta: ${n.croquetas}` }).click()
  await expect(page).toHaveURL(/\/kitchen\/recetas/, { timeout: 20_000 })
  const mi = await rest<{ recipe_item_id: string | null }[]>(s, 'GET',
    `menu_item?brand_id=eq.${marca}&name=eq.${encodeURIComponent(n.croquetas)}&archived_at=is.null&select=recipe_item_id`)
  expect(mi.datos[0]?.recipe_item_id, 'Croquetas ya tiene su artículo, vacío, donde escribir la receta').toBeTruthy()
  await page.waitForTimeout(1500)
  await foto(page, '3-hacer-receta', sufijo)
})

test('tablero 4 · el código cambiado: idéntica se une sola y avisa; la que se parece se pregunta y «Sí, es…» coloca', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const juego = juegoDe(info.project.name)
  const n = nombres(juego)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const { cuenta, marca } = await preparar('empezar', juego)

  // ── Inicio: antes de la pasada, las dos se preguntan ──────────────────────
  await entrarComo(page, CUENTA_A.email)
  await irAInicio(page)
  const atencion = page.locator('[data-prueba="atencion"]')
  // «Pollos Nuevos llega…» no es «Pollos Nuevos M llega…»: cada juego, el suyo.
  const nuevos = atencion.locator('li[data-tipo="revisar"]').filter({ hasText: `${n.nuevos} llega con otro código en Norte Mercado` })
  await esperarOContar(page, errores, () => expect(nuevos, `el aviso de ${n.nuevos} en Inicio`).toHaveCount(1, { timeout: 20_000 }))
  await dice(nuevos, `¿Es tu ${n.marca}? Su carta se parece: 3 de 6 platos coinciden.`, `El aviso de ${n.nuevos}`)
  await dice(nuevos, '2 ventas esperando', `El aviso de ${n.nuevos}`)

  // La pasada de cada hora (la de este juego): Express, de carta idéntica, se une sola.
  const p = await preparar('pasada', juego)
  expect(p.reconocidas_solas, `la pasada une ${n.express} sola`).toHaveLength(1)
  await irAInicio(page)
  const express = atencion.locator('li[data-tipo="reconocida"]').filter({ hasText: `${n.express} en Norte Mercado: reconocida` })
  await esperarOContar(page, errores, () => expect(express, `el aviso de ${n.express} reconocida`).toHaveCount(1, { timeout: 20_000 }))
  await dice(express, `${n.express} en Norte Mercado: reconocida, 1 venta colocada`, `El aviso de ${n.express}`)
  await dice(express, `Llegó de Last con otro código y la misma carta que tu ${n.marca}: Folvy la ha unido sola.`, `El aviso de ${n.express}`)
  await expect(atencion.locator('li[data-tipo="revisar"]').filter({ hasText: `${n.express} llega con otro código` })).toHaveCount(0)
  await nuevos.scrollIntoViewIfNeeded()
  await foto(page, '4-inicio', sufijo)

  // ── Marcas › Revisar: las dos cartas, una al lado de la otra ──────────────
  await nuevos.getByRole('button', { name: /^Revisar/ }).click()
  await expect(page).toHaveURL(/\/configuracion\/revisar-last\?marca=/)
  const pregunta = page.locator('[data-prueba="revisar-pregunta"]')
    .filter({ has: page.getByRole('heading', { name: `¿Es tu ${n.marca}?`, exact: true }) })
    .filter({ hasText: `«${n.nuevos}»` })
  await esperarOContar(page, errores, () => expect(pregunta, `la pregunta de ${n.nuevos}`).toHaveCount(1, { timeout: 20_000 }))
  await dice(pregunta, '2 ventas esperando', `La pregunta de ${n.nuevos}`)
  await dice(pregunta, `Llegan pedidos de Norte Mercado con una marca «${n.nuevos}» que Folvy no conocía. Su carta se parece a la de tu ${n.marca}.`,
    `La pregunta de ${n.nuevos}`)
  await dice(pregunta.locator('[data-prueba="carta-last"]'), `${n.wrap} · no está en tu carta`, 'Lo que llega de Last')
  await dice(pregunta.locator('[data-prueba="carta-folvy"]'), `${n.marca} · Norte Centro y Norte Mercado`, 'Tu marca en Folvy')
  await dice(pregunta.locator('[data-prueba="carta-folvy"]'), '6 platos, 4 con receta. 3 de 6 coinciden.', 'Tu marca en Folvy')
  await dice(pregunta, `Al confirmar, las 2 ventas pasan a ${n.marca} y descuentan almacén con sus recetas.`, `La pregunta de ${n.nuevos}`)
  await dice(page.locator('[data-prueba="revisar-reconocidas"]'), `${n.express} en Norte Mercado: reconocida, 1 venta colocada`, 'Lo que Folvy ha hecho solo')
  await foto(page, '4-revisar', sufijo)

  await pregunta.getByRole('button', { name: `Sí, es ${n.marca}` }).click()
  const hecho = page.locator('[data-prueba="revisar-hecho"]')
  await esperarOContar(page, errores, () => dice(hecho,
    `Hecho: ${n.nuevos} de Norte Mercado es tu ${n.marca}. 2 ventas colocadas. Falta la receta de ${n.wrap}: descontará en cuanto la pongas.`,
    'La confirmación', 30_000))
  await expect(pregunta).toHaveCount(0)
  await foto(page, '4-revisar-hecho', sufijo)

  // En la base: las ventas de Express y de Pollos Nuevos tienen ya la marca.
  const s = await pedirSesion(CUENTA_A.email)
  const refs = [2, 3, 4].map((i) => `f01c-e2e-${juego}-${i}`)
  const ventas = await rest<{ external_ref: string; brand_id: string | null }[]>(s, 'GET',
    `sale?account_id=eq.${cuenta}&external_ref=in.(${refs.join(',')})&select=external_ref,brand_id&order=external_ref`)
  expect(ventas.datos.map((x) => `${x.external_ref} ${x.brand_id === marca ? 'con marca' : 'sin marca'}`))
    .toEqual(refs.map((r) => `${r} con marca`))

  // «Entendido» en lo que Folvy hizo solo.
  const solas = page.locator('[data-prueba="revisar-reconocidas"]')
  await solas.getByRole('button', { name: `Entendido: ${n.express} en Norte Mercado: reconocida, 1 venta colocada` }).click()
  await dice(hecho, 'Entendido: no volverá a avisar.', 'La confirmación de «Entendido»')
  await expect(solas.getByRole('button', { name: new RegExp(`^Entendido: ${n.express} en `) })).toHaveCount(0)
})
