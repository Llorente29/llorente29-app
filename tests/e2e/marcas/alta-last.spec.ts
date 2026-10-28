/// <reference lib="dom" />
// tests/e2e/marcas/alta-last.spec.ts
//
// F01 · PR 1 · Una marca nueva de Last, de aviso a dada de alta, en staging-conta,
// en ordenador y en móvil, con la carta de Last de prueba
// (supabase/seeds/folvy/seed_f01_marcas_last_staging.sql): «Latina de Prueba»,
// la misma carta en Uber y en Glovo, un plato con dos nombres, los tequeños más
// caros en Glovo y el agua, que ya está en el almacén.
//
//   1. INICIO (tablero 1): «Lo que necesita tu atención» trae «Marca nueva:
//      Latina de Prueba», dónde está (Norte Centro y Norte Mercado; la tienda de
//      Last sin local no cuenta), con qué plataformas, cuántos platos (3: los
//      dos nombres de la arepa son uno) y que no ha vendido, con un botón.
//   2. EL ALTA (tablero 2): el botón lleva a Marcas con el panel abierto. Folvy
//      propone «Cedida por un socio» y el socio por la cuenta de Last; dice dónde
//      se vende y lo que hará con la carta: una sola carta para Uber y Glovo, la
//      arepa juntada, el agua del almacén y 2 platos sin receta.
//      La e2e la da de alta como «Mía»: desde la rama, staging no tiene la 1322
//      (el porcentaje del socio, opcional, «cambia» y solo va en ROLLBACK), y una
//      cedida sin porcentaje no se puede guardar todavía. Lo cedido lo prueba la
//      prueba de staging (20261027_f01_marcas_last_prueba.sql).
//   (Respuesta 1) «Vieja de Prueba» (su plato apagado, sin ventas) sale abajo,
//   «Sin ventas registradas», sin destacar. Y la segunda prueba: «No la uso» en
//   Inicio pide confirmación en una línea, el aviso se va y la marca sale en
//   Marcas › Ocultas (1), de donde «Volver a mostrar» la devuelve.
//   3. LA CONFIRMACIÓN (regla 8): «Dada de alta Latina de Prueba: 2 locales,
//      3 platos. Faltan 2 recetas.», la marca en la lista y, en la base, sus 4
//      platos (la arepa con un solo artículo, el agua con el del almacén), sus
//      2 locales y sus 2 vínculos de Last. Y en Inicio ya no sale.
//
// Capturas en docs/marcas/capturas/, con el número de su tablero delante.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, pedirSesion } from '../conta/sesion'
import { rest } from '../conta/api'

const DIR = 'docs/marcas/capturas'
const MARCA = 'Latina de Prueba'

async function preparar(que: 'empezar' | 'limpiar') {
  const s = await pedirSesion(CUENTA_A.email)
  const r = await rest<{ cuenta: string }>(s, 'POST', 'rpc/e2e_f01_preparar', { p_que: que })
  expect(r.status, `e2e_f01_preparar(${que}): ${JSON.stringify(r.datos)}`).toBe(200)
  return r.datos
}

/** Inicio, aunque al entrar la aplicación aterrice en Pendientes (una vez por carga). */
async function irAInicio(page: Page) {
  await page.goto('/')
  const saludo = page.locator('h1').filter({ hasText: /^(Buenos días|Buenas tardes|Buenas noches)/ })
  // El aterrizaje decide cuando sabe si hay pendientes: se espera a que decida
  // y, si se ha ido a Pendientes, se vuelve a Inicio sin recargar (como el menú).
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500)
    if (new URL(page.url()).pathname !== '/') {
      await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
    } else if (await saludo.isVisible()) break
  }
  await expect(saludo).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
}

async function foto(page: Page, nombre: string, sufijo: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}${sufijo}.png`, fullPage: true })
}

test.afterEach(async () => { await preparar('limpiar') })

/**
 * Respuesta 7 (28/10): si la confirmación no sale, el error dice lo que enseña
 * la pantalla (la dirección, los primeros 400 caracteres y los errores de la
 * página), porque la captura del fallo no se puede bajar desde fuera de Actions.
 */
async function esperarOContar(page: Page, errores: string[], esperar: () => Promise<void>) {
  try {
    await esperar()
  } catch (e) {
    const texto = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 400)
    throw new Error([
      (e as Error).message.split('\n')[0],
      `Dirección: ${page.url()}`,
      `Pantalla (400 caracteres): ${texto || '(vacía)'}`,
      `pageerror: ${errores.length ? errores.join(' | ') : 'ninguno'}`,
    ].join('\n'))
  }
}

test('una marca nueva de Last: el aviso en Inicio y el alta en una sola pantalla', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const { cuenta } = await preparar('empezar')

  // ── 1 · Inicio: el aviso ──────────────────────────────────────────────────
  await entrarComo(page, CUENTA_A.email)
  await irAInicio(page)
  const atencion = page.locator('[data-prueba="atencion"]')
  await expect(atencion.getByText('Lo que necesita tu atención', { exact: true })).toBeVisible({ timeout: 20_000 })
  const fila = atencion.locator('li[data-tipo="marca"]').filter({ hasText: `Marca nueva: ${MARCA}` })
  await expect(fila).toHaveCount(1)
  await expect(fila).toContainText('Ha aparecido en Last, en Norte Centro y Norte Mercado, con Uber Eats y Glovo. 3 platos. Todavía no ha vendido.')
  await expect(fila).toContainText('Sin dar de alta')
  await expect(fila.locator('.at-ico')).toHaveText('LP')
  // La vieja: después de la nueva, sin destacar, con su chip.
  const marcas = atencion.locator('li[data-tipo="marca"]')
  await expect(marcas.filter({ hasText: 'Vieja de Prueba' })).toHaveAttribute('data-apagada', 'si')
  await expect(marcas.filter({ hasText: 'Vieja de Prueba' })).toContainText('Sin ventas registradas')
  const textos = await marcas.allTextContents()
  expect(textos.findIndex((t) => t.includes(MARCA)), 'la nueva va antes que la vieja').toBeLessThan(textos.findIndex((t) => t.includes('Vieja de Prueba')))
  await fila.scrollIntoViewIfNeeded()
  await foto(page, '1-inicio-aviso', sufijo)

  // ── 2 · El alta, en una sola pantalla ─────────────────────────────────────
  await fila.getByRole('button', { name: `Dar de alta: Marca nueva: ${MARCA}` }).click()
  await expect(page).toHaveURL(/\/configuracion\/marcas\?alta=/)
  const panel = page.getByRole('dialog', { name: MARCA })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Encontrada en Last · cuenta de Cocinas de Prueba')
  await expect(panel.getByRole('button', { name: 'Cedida por un socio' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByLabel('Socio')).toHaveValue('Cocinas de Prueba')
  await expect(panel).toContainText('Lo proponemos porque viene de la cuenta de Last de Cocinas de Prueba. Si no es así, cámbialo.')
  await expect(panel.locator('.ml-local')).toHaveText([/Norte Centro\s*Uber Eats · Glovo/, /Norte Mercado\s*Uber Eats · Glovo/])
  const carta = panel.locator('[data-prueba="alta-carta"] li')
  await expect(carta).toHaveText([
    '✓3 platos. Uber Eats y Glovo tienen la misma carta: queda una sola, con el precio de cada plataforma.',
    '✓«AREPA REINA (LP)» y «AREPA REINA LP» son el mismo plato con dos nombres: se juntan en uno.',
    '✓1 producto que ya tienes en el almacén (Agua mineral 50 cl): se enlaza solo.',
    '!2 platos sin receta. Se venden igual; lo vendido descuenta almacén cuando pongas la receta.',
  ], { timeout: 15_000 })
  await foto(page, '2-alta-panel', sufijo)

  // Mía (ver la cabecera: la cedida sin porcentaje necesita la 1322 en staging).
  await panel.getByRole('button', { name: 'Mía' }).click()
  await panel.getByRole('button', { name: `Dar de alta ${MARCA}` }).click()

  // ── 3 · La confirmación, con contenido ────────────────────────────────────
  const hecho = page.locator('[data-prueba="alta-hecha"]')
  await esperarOContar(page, errores, () =>
    expect(hecho).toHaveText(`Dada de alta ${MARCA}: 2 locales, 3 platos. Faltan 2 recetas.`, { timeout: 30_000 }))
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-prueba="marcas-nuevas-last"]').getByText(`Marca nueva: ${MARCA}`)).toHaveCount(0)
  await foto(page, '2-alta-hecha', sufijo)

  // En la base: la marca, sus platos, sus locales y sus vínculos de Last.
  const s = await pedirSesion(CUENTA_A.email)
  const b = await rest<{ id: string; ownership_type: string }[]>(s, 'GET',
    `brand?account_id=eq.${cuenta}&name=eq.${encodeURIComponent(MARCA)}&archived_at=is.null&select=id,ownership_type`)
  expect(b.datos).toHaveLength(1)
  expect(b.datos[0].ownership_type).toBe('own')
  const platos = await rest<{ name: string; recipe_item_id: string | null }[]>(s, 'GET',
    `menu_item?brand_id=eq.${b.datos[0].id}&archived_at=is.null&select=name,recipe_item_id&order=name`)
  expect(platos.datos.map((p) => p.name)).toEqual(['AREPA REINA (LP)', 'AREPA REINA LP', 'Agua mineral 50 cl', 'TEQUEÑOS LP'])
  expect(platos.datos.every((p) => p.recipe_item_id)).toBe(true)
  expect(platos.datos[0].recipe_item_id, 'los dos nombres de la arepa, un solo artículo').toBe(platos.datos[1].recipe_item_id)
  const locales = await rest<unknown[]>(s, 'GET', `brand_location_availability?brand_id=eq.${b.datos[0].id}&is_active=eq.true&select=id`)
  expect(locales.datos).toHaveLength(2)
  const vinculos = await rest<unknown[]>(s, 'GET', `external_brand_map?brand_id=eq.${b.datos[0].id}&select=id`)
  expect(vinculos.datos, 'la tienda de Last sin local no se vincula').toHaveLength(2)

  // Y en Inicio ya no sale.
  await irAInicio(page)
  await expect(page.locator('li[data-tipo="marca"]').filter({ hasText: MARCA })).toHaveCount(0)
})

test('«No la uso»: el aviso se va, sale en Marcas › Ocultas y se recupera', async ({ page }, info) => {
  const sufijo = info.project.name === 'movil' ? '-movil' : ''
  await preparar('empezar')
  await entrarComo(page, CUENTA_A.email)
  await irAInicio(page)
  const atencion = page.locator('[data-prueba="atencion"]')
  const fila = atencion.locator('li[data-tipo="marca"]').filter({ hasText: `Marca nueva: ${MARCA}` })
  await expect(fila).toHaveCount(1, { timeout: 20_000 })

  // Botón secundario, sin color de alerta, con su confirmación en una línea.
  const noLaUso = fila.getByRole('button', { name: `No la uso: Marca nueva: ${MARCA}` })
  await expect(noLaUso).toHaveAttribute('data-principal', 'no')
  await noLaUso.click()
  const confirmar = fila.getByRole('group', { name: 'Confirmar: No la uso' })
  await expect(confirmar).toContainText(`${MARCA} no volverá a avisar. Puedes recuperarla en Marcas › Ocultas.`)
  await fila.scrollIntoViewIfNeeded()
  await foto(page, '1-inicio-no-la-uso', sufijo)
  await confirmar.getByRole('button', { name: 'Sí, no la uso' }).click()
  await expect(atencion.getByRole('status')).toHaveText(`${MARCA} no volverá a avisar. Puedes recuperarla en Marcas › Ocultas.`)
  await expect(atencion.locator('li[data-tipo="marca"]').filter({ hasText: MARCA })).toHaveCount(0)

  // Y al volver a entrar tampoco avisa.
  await irAInicio(page)
  await expect(page.locator('li[data-tipo="marca"]').filter({ hasText: `Marca nueva: ${MARCA}` })).toHaveCount(0)

  // Marcas › Ocultas, plegada, con el número.
  await page.goto('/configuracion/marcas')
  const seccion = page.locator('[data-prueba="marcas-ocultas"]')
  await expect(seccion.locator('summary')).toHaveText('Ocultas (1)', { timeout: 20_000 })
  await expect(seccion).not.toHaveAttribute('open', '')
  await seccion.locator('summary').click()
  const oculta = seccion.locator('li').filter({ hasText: MARCA })
  await expect(oculta).toContainText(/Oculta por .+ el \d{2}\/\d{2}\/\d{4}/)
  await seccion.scrollIntoViewIfNeeded()
  await foto(page, '2-marcas-ocultas', sufijo)

  // «Volver a mostrar»: vuelve a las nuevas, y en la base no se ha creado nada.
  await oculta.getByRole('button', { name: `Volver a mostrar ${MARCA}` }).click()
  await expect(seccion.getByRole('status')).toHaveText(`${MARCA} vuelve a salir entre las marcas nuevas de Last.`)
  await expect(page.locator('[data-prueba="marcas-nuevas-last"]').getByText(`Marca nueva: ${MARCA}`)).toBeVisible()
  const s = await pedirSesion(CUENTA_A.email)
  const b = await rest<unknown[]>(s, 'GET', `brand?name=eq.${encodeURIComponent(MARCA)}&archived_at=is.null&select=id`)
  expect(b.datos, '«No la uso» no crea la marca').toHaveLength(0)
})
