/// <reference lib="dom" />
// tests/e2e/conta/d01/sin-plataformas.spec.ts
//
// D01 · Regla de Julio (17/10): «Sus tiendas», «Liquidaciones» y todo lo de
// plataformas es para quien vende por Uber, Glovo o Just Eat. En la cuenta C
// —solo contabilidad: sin empresa, sin Cocina, sin canales de venta— no sale
// nada de eso: ni el apartado, ni la tarjeta, ni un hueco, ni la palabra
// «plataforma». En ordenador (1440) y móvil (390). Capturas en
// docs/conta/capturas/d01/.
//
// Datos: supabase/seeds/conta/seed_d01_cuenta_c_cliente_staging.sql (un cliente
// inventado en cada cuenta C, para tener una ficha que abrir). La prueba no
// escribe nada: cualquier escritura se corta y la prueba lo dice.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_C, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/d01'
// El de la semilla: los 30 primeros caracteres del id de su cuenta y «0000d1».
const CLIENTE = `${CUENTA_C.id.slice(0, 30)}0000d1`
const NOMBRE = 'Cliente Inventado de la Cuenta C'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** Lo que se ve, entero: si dice «plataforma» en cualquier sitio, falla y dice dónde. */
async function sinPlataforma(page: Page, donde: string) {
  const texto = await page.locator('body').innerText()
  const frases = texto.split('\n').filter((l) => /plataforma/i.test(l))
  expect(frases, `${donde}: dice «plataforma»`).toEqual([])
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

test('C · cuenta solo de contabilidad: ni Liquidaciones, ni «Sus tiendas», ni la palabra «plataforma»', async ({ page }) => {
  test.setTimeout(180_000)
  const movil = lado(page) === 'movil'
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  const escrituras: string[] = []
  await page.route('**/rest/v1/**', async (r) => {
    const m = r.request().method()
    if (m === 'GET' || m === 'HEAD' || (m === 'POST' && /\/rest\/v1\/rpc\//.test(r.request().url()))) return r.fallback()
    escrituras.push(`${m} ${new URL(r.request().url()).pathname}`)
    await r.abort()
  })

  await entrarComo(page, CUENTA_C.email)

  // 1 · Clientes y proveedores: la lista, sus filtros y el menú de la contabilidad.
  await page.goto('/conta/clientes-y-proveedores')
  await expect(page.getByRole('link', { name: new RegExp(NOMBRE) }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Plataformas' })).toHaveCount(0)
  await sinPlataforma(page, 'la lista')
  if (movil) {
    await page.getByRole('navigation', { name: 'Menú de contabilidad' }).getByRole('button', { name: 'Más' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await sinPlataforma(page, 'la hoja «Más» del menú')
    await page.keyboard.press('Escape')
  } else {
    const mas = page.getByRole('button', { name: /Más ▾/ })
    if (await mas.count()) { await mas.first().click(); await sinPlataforma(page, 'el «Más ▾» del menú'); await page.keyboard.press('Escape') }
  }

  // 2 · Su ficha: sin pestaña ni apartado Liquidaciones, y el menú de la ficha sin «plataforma de reparto».
  await page.goto(`/conta/clientes-y-proveedores/${CLIENTE}`)
  await expect(page.getByRole('heading', { level: 1, name: NOMBRE }).or(page.getByText(NOMBRE).first())).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: /Liquidaciones/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Sus tiendas' })).toHaveCount(0)
  await sinPlataforma(page, 'la ficha')
  await capturar(page, 'sin-plataformas-ficha')
  if (!movil) {
    await page.getByRole('button', { name: 'Más acciones' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem').first()).toBeVisible()
    expect(await menu.innerText(), 'el menú «Más acciones» de la ficha').not.toMatch(/plataforma/i)
    await capturar(page, 'sin-plataformas-menu')
    await page.getByRole('button', { name: 'Más acciones' }).click()
  }

  // 3 · Liquidaciones por su dirección: vuelve a la ficha, sin tarjeta ni hueco.
  await page.goto(`/conta/clientes-y-proveedores/${CLIENTE}/liquidaciones`)
  await expect(page).toHaveURL(new RegExp(`/conta/clientes-y-proveedores/${CLIENTE}$`))
  await expect(page.getByRole('region', { name: 'Sus tiendas' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Liquidaciones' })).toHaveCount(0)
  await sinPlataforma(page, 'la ficha, entrando por /liquidaciones')

  // 4 · Ventas, que sí está en el menú de esta cuenta.
  await page.goto('/conta/ventas')
  await expect(page.getByRole('heading', { level: 1, name: 'Ventas' })).toBeVisible({ timeout: 30_000 })
  await sinPlataforma(page, 'Ventas')

  expect(escrituras).toEqual([])
  expect(errores).toEqual([])
})
