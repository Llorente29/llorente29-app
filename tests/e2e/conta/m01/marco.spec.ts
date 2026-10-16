/// <reference lib="dom" />
// tests/e2e/conta/m01/marco.spec.ts
//
// M01 · El marco nuevo (maqueta N30, decisiones de Julio sobre el F01), en la
// cuenta A de staging-conta (todo inventado):
//   · la barra de módulos plegada y desplegada, que se recuerda;
//   · Impuestos apagado con «Próximamente»;
//   · el «Te toca hoy» del Inicio;
//   · la densidad, que se recuerda;
//   · una pantalla vieja (Bancos) dentro del marco, con su estilo y sus pestañas;
//   · el buscador general (Ctrl K), que es del marco y no de Libros.
// Las capturas van a docs/conta/capturas/m01 (frente D).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/m01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

async function capturar(page: Page, nombre: string, medir = true) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
  if (medir) expect(await loQueTapanSinPregunta(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

const menu = (page: Page) => page.getByRole('navigation', { name: 'Menú de contabilidad' })

/** El «Te toca hoy» ya ha contado: la franja deja de estar ocupada y ningún número dice «…». */
async function esperarNumeros(page: Page) {
  const franja = page.getByRole('region', { name: 'Te toca hoy' })
  await expect(franja).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(franja.locator('.cxm-chip-numero', { hasText: '…' })).toHaveCount(0)
}

test('el marco: módulos plegados y desplegados, Impuestos apagado y el «Te toca hoy» del Inicio', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/inicio')
  await expect(page.locator('.cxm')).toBeVisible()
  // Letra Geist en el marco (Folvy) y fondo de N30, sin el degradado de antes.
  await page.evaluate(() => document.fonts.ready)
  const raiz = await page.locator('.cxm').evaluate((el) => { const s = getComputedStyle(el); return { fondo: s.backgroundColor, imagen: s.backgroundImage } })
  expect(raiz).toEqual({ fondo: 'rgb(238, 241, 245)', imagen: 'none' })

  // «Te toca hoy»: los cuatro, siempre, con su número. Mientras cuenta dice «…»
  // (y la franja está ocupada); «—» sería que no se ha podido contar.
  const franja = page.getByRole('region', { name: 'Te toca hoy' })
  await expect(franja.getByRole('link')).toHaveCount(4)
  await esperarNumeros(page)
  await expect(franja.locator('.cxm-chip-numero')).not.toContainText(['—'])

  if (lado(page) === 'movil') {
    // Abajo: Inicio, Compras, Bancos, Libros y «Más».
    await expect(menu(page).locator('.cxm-barra-item .cxm-modulo-nombre')).toHaveText(['Inicio', 'Compras', 'Bancos', 'Libros', 'Más'])
    await expect(menu(page).getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await capturar(page, 'marco-plegado')
    await menu(page).getByRole('button', { name: 'Más' }).click()
    const hoja = page.getByRole('dialog', { name: 'Menú' })
    await expect(hoja.locator('.cxm-modulo-nombre')).toHaveText(['Inicio', 'Ventas', 'Compras', 'Bancos', 'Libros', 'Impuestos', 'Clientes y proveedores', 'Ajustes', 'Volver a Folvy'])
    await expect(hoja.locator('.cxm-modulo-apagado')).toContainText('Próximamente')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/marco-mas-movil.png` })
    await hoja.getByRole('button', { name: 'Cerrar' }).click()
    return
  }

  // Plegada (de serie): 76 px, círculos con su letra y el nombre debajo.
  const barra = menu(page)
  await expect(barra.locator('.cxm-modulo-nombre')).toHaveText(['Inicio', 'Ventas', 'Compras', 'Bancos', 'Libros', 'Impuestos', 'Clientes y proveedores', 'Ajustes'])
  await expect(barra.locator('.cxm-circulo').nth(1)).toHaveText('V')
  expect(Math.round((await barra.boundingBox())!.width)).toBe(76)
  await expect(barra.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
  // Impuestos, apagado: no es un enlace que lleve a ningún sitio, y dice «Próximamente».
  const impuestos = barra.locator('.cxm-modulo-apagado')
  await expect(impuestos).toHaveAttribute('aria-disabled', 'true')
  await impuestos.hover()
  await expect(barra.getByRole('tooltip')).toHaveText('Próximamente')
  await capturar(page, 'marco-plegado')

  // Desplegada: 232 px; se recuerda al volver.
  await barra.getByRole('button', { name: 'Desplegar el menú' }).click()
  expect(Math.round((await barra.boundingBox())!.width)).toBe(232)
  await page.reload()
  await expect(menu(page).getByRole('button', { name: 'Plegar el menú' })).toBeVisible()
  expect(Math.round((await menu(page).boundingBox())!.width)).toBe(232)
  await expect(page.getByRole('region', { name: 'Te toca hoy' }).getByRole('link')).toHaveCount(4)
  // Al recargar, el navegador vuelve a donde estaba la página: arriba del todo
  // para la foto, y con los números ya contados (no «…»).
  await esperarNumeros(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capturar(page, 'marco-desplegado')
  await menu(page).getByRole('button', { name: 'Plegar el menú' }).click()
  expect(Math.round((await menu(page).boundingBox())!.width)).toBe(76)

  // La densidad: compacta de serie; se recuerda.
  const densidad = page.getByRole('group', { name: 'Densidad' })
  await expect(densidad.getByRole('button', { name: 'Compacta' })).toHaveAttribute('aria-pressed', 'true')
  await densidad.getByRole('button', { name: 'Cómoda' }).click()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Densidad' }).getByRole('button', { name: 'Cómoda' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.cxm')).toHaveAttribute('data-densidad', 'comoda')
  await page.getByRole('group', { name: 'Densidad' }).getByRole('button', { name: 'Compacta' }).click()

  // «Volver a Folvy», en el menú del usuario (con Folvy; en el producto solo no hay).
  await page.locator('.cxm-usuario-boton').click()
  await expect(page.getByRole('link', { name: 'Volver a Folvy' })).toBeVisible()
})

test('una pantalla vieja dentro del marco: Bancos, con su estilo y sus pestañas', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/bancos')
  await expect(page.locator('.cxm .cx-principal')).toBeVisible()
  if (lado(page) === 'ordenador') {
    // Sus pestañas las sigue pintando Bancos (hasta que el frente B la pase): arriba no se repiten.
    await expect(page.getByRole('navigation', { name: 'Pestañas de Bancos' })).toHaveCount(1)
    await expect(menu(page).getByRole('link', { name: 'Bancos', exact: true })).toHaveAttribute('aria-current', 'page')
    // Su estilo de hoy: las tarjetas con el radio de antes (no el de 8 px del marco).
    const tarjetas = page.locator('.cx-principal .cx-tarjeta')
    if (await tarjetas.count()) expect(await tarjetas.first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('8px')
  }
  if (lado(page) === 'movil') {
    // En el móvil, Bancos abre su portada por niveles (PortadaMovil), sin pestañas:
    // la pantalla de siempre, dentro del marco, con Bancos marcado abajo.
    await expect(page.getByRole('navigation', { name: 'Pestañas de Bancos' })).toHaveCount(0)
    await expect(menu(page).getByRole('link', { name: 'Bancos' })).toHaveAttribute('aria-current', 'page')
  }
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await capturar(page, 'pantalla-vieja')
})

test('las pestañas de Libros, arriba; las que no caben, en «Más ▾»', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'En el móvil Libros va por niveles y pinta sus áreas')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/balances/balance')
  const pestanas = page.getByRole('navigation', { name: 'Pestañas de Libros' })
  await expect(pestanas).toBeVisible()
  // La de la dirección, activa: si está dentro de «Más», el botón la nombra.
  const activa = pestanas.locator('[aria-current="page"], .cxm-pestana-activa')
  await expect(activa).toHaveText(/^Balances/)
  await expect(page.getByRole('navigation', { name: 'Áreas de Libros' })).toHaveCount(0)
  // La foto con el balance ya cargado, no con su esqueleto.
  await expect(page.getByRole('heading', { name: 'Balance de situación' })).toBeVisible({ timeout: 30_000 })
  await capturar(page, 'pestanas-libros')
})

test('el buscador general: Ctrl K es del marco, agrupa por tipo y abre con Intro', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await expect(page.locator('.cxm .cx-principal')).toBeVisible()
  if (lado(page) === 'movil') await page.getByRole('button', { name: 'Buscar todo' }).click()
  else await page.keyboard.press('Control+k')
  const dialogo = page.getByRole('dialog', { name: 'Buscar todo' })
  await expect(dialogo).toBeVisible()
  // Ctrl K ya no abre el de Libros: es del marco.
  await expect(page.getByRole('dialog', { name: 'Buscar en Libros' })).toHaveCount(0)

  // Un proveedor de la semilla: sale en su grupo (y las facturas suyas, en el de facturas).
  await dialogo.getByLabel('Qué buscas').fill('Prueba')
  const terceros = dialogo.getByRole('group', { name: 'Clientes y proveedores' })
  await expect(terceros.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  await expect(dialogo.getByText('buscando…')).toHaveCount(0, { timeout: 15_000 })
  await expect(dialogo.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/buscador-${lado(page)}.png` })

  // Una opción, con ↓ e Intro: «balance» lleva al Balance de situación.
  await dialogo.getByLabel('Qué buscas').fill('balance de situ')
  const opcion = dialogo.getByRole('group', { name: 'Opciones' }).getByRole('option', { name: /Balance de situación/ })
  await expect(opcion).toBeVisible()
  await expect(opcion).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/conta\/libros\/balances\/balance$/)
  await expect(dialogo).toHaveCount(0)

  // Escape cierra.
  if (lado(page) === 'ordenador') {
    await page.keyboard.press('Control+k')
    await expect(dialogo).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
  }
})
