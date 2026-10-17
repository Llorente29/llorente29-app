/// <reference lib="dom" />
// tests/e2e/conta/s01/esqueleto.spec.ts
//
// S01 · El esqueleto, en staging-conta, en ordenador y en móvil:
//   · la cuenta A (hostelería): la barra de productos, la cabecera de UNA fila
//     de 48 px, las pestañas de Contabilidad y la cinta de Asientos; en
//     Compras y gastos, Liquidaciones;
//   · la cuenta D (sin hostelería, Julio 17/10): ni Liquidaciones ni nada de
//     hostelería en el esqueleto;
//   · el nivel cambia las palabras y nunca las posiciones (mismas cajas);
//   · Favoritos se guarda en la base: sigue al recargar y en otro navegador;
//   · la cinta se oculta, se recuerda y vuelve;
//   · Sumied (?marca=sumied): la barra azul noche, como la maqueta 1.
// Cada prueba deja las preferencias como estaban (van en la base y las
// pruebas corren de una en una, en el mismo carril).
// Capturas en docs/conta/capturas/s01.

import { test, expect, type Browser, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_D, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

function vigilar(page: Page, errores: string[]) {
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
}
async function capturar(page: Page, nombre: string) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
}

const barra = (page: Page) => page.getByRole('navigation', { name: 'Menú de contabilidad' })
const pestanas = (page: Page, producto: string) => page.getByRole('navigation', { name: `Pestañas de ${producto}` })
const cinta = (page: Page) => page.getByRole('toolbar', { name: 'Acciones de Asientos' })
const aviso = (page: Page, texto: string | RegExp) => page.getByRole('status').filter({ hasText: texto })

async function abrirUsuario(page: Page) { await page.getByRole('button', { name: /\. Tus preferencias$/ }).click() }
async function abrirFavoritos(page: Page) { await page.getByRole('button', { name: 'Favoritos' }).click() }
async function nivel(page: Page, cual: 'Sin experiencia' | 'Medio' | 'Experto') {
  await abrirUsuario(page)
  await page.getByRole('group', { name: 'Tu nivel' }).getByRole('button', { name: new RegExp(`^${cual}`) }).click()
  await expect(aviso(page, `Nivel: ${cual.toLowerCase()}.`)).toBeVisible()
}

test('A (hostelería): barra de productos, cabecera de una fila de 48 px, pestañas de Contabilidad y la cinta de Asientos', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_A.email)
  vigilar(page, errores)
  await page.goto('/conta/libros/diario')
  const cabecera = page.locator('.s-cabecera')
  await expect(cabecera).toBeVisible()

  // UNA fila de 48 px (Julio, respuesta 3): todo lo de la cabecera dentro de esa altura.
  const caja = (await cabecera.boundingBox())!
  expect(Math.round(caja.height)).toBe(48)
  const fuera = await cabecera.locator('a, button').evaluateAll((xs, alto) => xs.filter((x) => {
    const r = x.getBoundingClientRect()
    return r.height > 0 && (r.top < 0 || r.bottom > (alto as number) + 1)
  }).map((x) => x.textContent), caja.y + caja.height)
  expect(fuera).toEqual([])

  // Buscar · Ctrl K y Favoritos, en la cabecera.
  if (lado(page) === 'ordenador') await expect(cabecera.getByRole('button', { name: 'Buscar', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Control+K')
  await expect(cabecera.getByRole('button', { name: 'Favoritos' })).toBeVisible()

  // Las pestañas de Contabilidad, con Asientos marcada.
  const tabs = pestanas(page, 'Contabilidad')
  if (lado(page) === 'ordenador') {
    const mas = tabs.getByRole('button', { name: /▾$/ })
    if (await mas.count()) await mas.click()
  }
  const nombres = await tabs.getByRole('link').allTextContents()
  expect(nombres.slice(0, 4)).toEqual(['Asientos', 'Libros y listados', 'Definiciones', 'Cierre y Registro'])
  expect(nombres.slice(4).every((n) => n === 'Importar')).toBe(true)
  await expect(tabs.getByRole('link', { name: 'Asientos' })).toHaveAttribute('aria-current', 'page')
  if (lado(page) === 'ordenador') await page.keyboard.press('Escape')

  // La cinta de la maqueta 1: NUEVO · REVISAR · UTILIDADES.
  const c = cinta(page)
  await expect(c.getByRole('group', { name: 'Nuevo' }).getByRole('link')).toHaveText(['Expedida', 'Recibida', 'Tesorería', 'General', 'Predefinidos'])
  await expect(c.getByRole('group', { name: 'Revisar' }).getByRole('link')).toHaveText(['Para revisar', 'Libro diario'])
  await expect(c.getByRole('group', { name: 'Utilidades' }).getByRole('button', { name: 'Búsqueda' })).toBeVisible()
  await expect(c.getByRole('link', { name: 'Libro diario' })).toHaveAttribute('aria-current', 'page')
  await capturar(page, 'esqueleto-asientos')
  await c.getByRole('link', { name: 'Para revisar' }).click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\?ver=revisar/)
  await expect(cinta(page).getByRole('link', { name: 'Para revisar' })).toHaveAttribute('aria-current', 'page')

  // La barra de productos: lo que tiene pantalla, con Contabilidad marcada.
  if (lado(page) === 'ordenador') {
    await expect(barra(page).locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Contactos', 'Ajustes'])
    await expect(barra(page).getByRole('link', { name: 'Contabilidad' })).toHaveAttribute('aria-current', 'page')
  } else {
    await expect(barra(page).locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Más'])
  }

  // Compras y gastos en una empresa de hostelería: con Liquidaciones.
  await page.goto('/conta/compras')
  await expect(pestanas(page, 'Compras y gastos').getByRole('link')).toHaveText(['Por revisar', 'Facturas recibidas', 'Liquidaciones'])
  await expect(pestanas(page, 'Compras y gastos').getByRole('link', { name: 'Por revisar' })).toHaveAttribute('aria-current', 'page')
  await capturar(page, 'esqueleto-compras-hosteleria')
  expect(errores).toEqual([])
})

test('D (sin hostelería): ni Liquidaciones ni nada de hostelería en el esqueleto', async ({ page }) => {
  const errores: string[] = []
  await entrarComo(page, CUENTA_D.email)
  vigilar(page, errores)
  await page.goto('/conta/compras')
  const tabs = pestanas(page, 'Compras y gastos')
  await expect(tabs.getByRole('link')).toHaveText(['Por revisar', 'Facturas recibidas'])
  await expect(page.locator('.s-cabecera, .s-barra, .s-barra-inferior, .s-cinta').getByText(/Liquidaci|plataforma|Catcher|socio/i)).toHaveCount(0)
  // La misma barra que A: el esqueleto es uno; lo que cambia es lo de hostelería.
  if (lado(page) === 'ordenador') await expect(barra(page).locator('.s-barra-nombre')).toHaveText(['Inicio', 'Contabilidad', 'Compras y gastos', 'Bancos', 'Contactos', 'Ajustes'])
  // Ni por la dirección: una liquidación no marca ninguna pestaña.
  await page.goto('/conta/compras/liquidacion/nueva')
  await expect(pestanas(page, 'Compras y gastos').locator('[aria-current="page"]')).toHaveCount(0)
  await page.goto('/conta/compras')
  await capturar(page, 'esqueleto-compras-sin-hosteleria')
  expect(errores).toEqual([])
})

test('el nivel cambia las palabras y nunca las posiciones', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(cinta(page)).toBeVisible()
  const cajas = async () => page.locator('.s-barra a, .s-barra-inferior a, .s-pestanas a, .s-cinta a, .s-cinta button, .s-cab-empresa')
    .evaluateAll((xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') }))
  const antes = await cajas()
  expect(antes.length).toBeGreaterThan(8)

  await nivel(page, 'Experto')
  await expect(page.getByRole('button', { name: /nivel experto\. Tus preferencias$/ })).toBeVisible()
  expect(await cajas()).toEqual(antes)
  // Se guarda en la base: sigue al recargar.
  await page.reload()
  await expect(page.getByRole('button', { name: /nivel experto\. Tus preferencias$/ })).toBeVisible()
  expect(await cajas()).toEqual(antes)
  await capturar(page, 'esqueleto-nivel-experto')

  await nivel(page, 'Sin experiencia')
  expect(await cajas()).toEqual(antes)
  await nivel(page, 'Medio')
  expect(await cajas()).toEqual(antes)
})

async function favoritosEnOtroNavegador(browser: Browser, email: string): Promise<string[]> {
  const contexto = await browser.newContext()
  const otra = await contexto.newPage()
  await entrarComo(otra, email)
  await otra.goto('/conta/inicio')
  await abrirFavoritos(otra)
  const fav = otra.getByRole('group', { name: 'Favoritos' })
  await expect(fav).toBeVisible()
  const lista = await fav.locator('.s-menu-fila .s-menu-item').allTextContents()
  await contexto.close()
  return lista
}

test('Favoritos: se fija desde el menú, se guarda en la base y sigue en otro navegador', async ({ page, browser }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await expect(cinta(page)).toBeVisible()
  await abrirFavoritos(page)
  const fav = page.getByRole('group', { name: 'Favoritos' })
  await expect(fav.getByText('Aún no tienes ninguno. Fija abajo lo que más uses y saldrá aquí.')).toBeVisible()
  // Lo que se puede fijar desde aquí: esta pantalla y lo de su cinta.
  await expect(fav.getByRole('button', { name: /^Contabilidad › Asientos/ })).toBeVisible()
  await fav.getByRole('button', { name: /^Expedida/ }).click()
  // Fijar lo dice (regla 8).
  await expect(aviso(page, 'Fijado en Favoritos: «Expedida». Lo tienes arriba, en Favoritos.')).toBeVisible()

  await page.reload()
  await abrirFavoritos(page)
  const tras = page.getByRole('group', { name: 'Favoritos' })
  await expect(tras.getByRole('link', { name: 'Expedida' })).toHaveAttribute('href', '/conta/libros/diario/nuevo?tipo=expedida')
  await capturar(page, 'esqueleto-favoritos')

  // Otro navegador (otro ordenador): la misma lista, porque está en la base.
  expect(await favoritosEnOtroNavegador(browser, CUENTA_A.email)).toEqual(['Expedida'])

  // Quitar también lo dice; y la lista queda vacía.
  await tras.getByRole('button', { name: 'Quitar «Expedida» de Favoritos' }).click()
  await expect(aviso(page, 'Quitado de Favoritos: «Expedida».')).toBeVisible()
  expect(await favoritosEnOtroNavegador(browser, CUENTA_A.email)).toEqual([])
})

test('la cinta se oculta, se recuerda y vuelve (nunca desaparece sin decir dónde está)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario')
  await cinta(page).getByRole('button', { name: 'Ocultar' }).click()
  await expect(cinta(page)).toHaveCount(0)
  await expect(aviso(page, 'Cinta oculta: «Mostrar la cinta» la saca otra vez.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Mostrar la cinta' })).toBeVisible()
  await expect(cinta(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Mostrar la cinta' }).click()
  await expect(cinta(page)).toBeVisible()
  await expect(aviso(page, 'La cinta vuelve a estar a la vista.')).toBeVisible()
})

test('Sumied: la barra azul noche, la cabecera de 48 px y la cinta, como la maqueta 1', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario?marca=sumied')
  await expect(page.locator('.s-cabecera')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const fondoBarra = await page.locator(lado(page) === 'ordenador' ? '.s-barra' : '.s-barra-inferior').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(fondoBarra).toBe('rgb(11, 31, 59)')
  expect(Math.round((await page.locator('.s-cabecera').boundingBox())!.height)).toBe(48)
  await expect(page.locator('.s-cabecera')).toHaveCSS('font-family', /Inter Variable/)
  await capturar(page, 'esqueleto-sumied')
})
