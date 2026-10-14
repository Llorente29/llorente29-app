// tests/e2e/conta/c06/sinBarra.spec.ts
//
// C06b (respuesta 6 de Julio, tarea 2): la barra «Pregunta o pide algo» solo
// contestaba «Muy pronto», y lo que no funciona no se enseña. Ninguna pantalla
// de contabilidad la lleva, ni el botón central de la IA en el móvil. Se
// recorren las rutas del módulo que no llevan un id (las que sí, las miran las
// e2e de su pantalla, con loQueTapanSinPregunta), y las dos pantallas de
// proveedores que viven dentro de Cocina, en ordenador y en móvil.
//
// Cuenta A (con Folvy): es la que tenía la barra. La captura de «después» es
// la misma pantalla que la de «antes» (c00/marco, cuenta B, Ajustes), en
// docs/conta/capturas/c06b/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/c06b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

const RUTAS = [
  '/conta/ajustes', '/conta/ajustes/tablas', '/conta/ajustes/plan', '/conta/ajustes/plan/que-va-a-cada-sitio', '/conta/ajustes/impuestos',
  '/conta/clientes-y-proveedores', '/conta/plan/430',
  '/conta/libros', '/conta/libros/diario', '/conta/libros/diario/nuevo', '/conta/libros/diario/resumido', '/conta/libros/balances/balance',
  '/conta/compras', '/conta/ventas', '/conta/compras/liquidacion/nueva',
  '/kitchen/proveedores',
]

test('ninguna pantalla de contabilidad enseña la barra «Pregunta o pide algo» ni el botón de la IA', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  await entrarComo(page, CUENTA_A.email)
  const con: string[] = []
  for (const ruta of RUTAS) {
    await page.goto(ruta)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await expect(page.locator('.cx').first(), ruta).toBeVisible({ timeout: 20_000 })
    const n = await page.locator('.cx-pregunta, .cx-barra-ia').count()
    if (n) con.push(ruta)
  }
  expect(con, `con la barra o el botón de la IA (${lado(page)})`).toEqual([])
})

test('la captura de después: la misma pantalla que la de antes (Ajustes, cuenta B)', async ({ page }) => {
  await entrarComo(page, CUENTA_B.email)
  await page.goto('/conta')
  await expect(page).toHaveURL(/\/conta\/ajustes$/)
  await expect(page.getByText('Socios y cargos').first()).toBeVisible()
  await expect(page.locator('.cx-pregunta, .cx-barra-ia')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/sin-barra-despues-${lado(page)}.png`, fullPage: true })
})
