/// <reference lib="dom" />
// tests/e2e/conta/i01b/plazo.spec.ts
//
// I01b · El recuadro «Presentar hasta…» del Calendario (Julio, 20/10: salía en
// rojo aunque faltaran 61 días). El color, por los días que quedan: rojo con 2
// o menos, ámbar con 15 o menos, neutro con más. Si hay algo fuera de plazo, el
// recuadro lo dice PRIMERO («N fuera de plazo: 202 · 2P…»), en rojo, y el
// siguiente plazo debajo. Con la cuenta A y Sumied, forzando el día con ?hoy=
// (solo contra staging), en ordenador y en móvil.
// Capturas en docs/conta/capturas/i01b.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/i01b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** El primero de los tres recuadros del Calendario. */
const recuadro = (page: Page) => page.locator('.s-impuestos-cifras .s-tarjeta-cifra').first()

async function abrir(page: Page, hoy: string) {
  await page.goto(`/conta/impuestos?marca=sumied&hoy=${hoy}`)
  // S02: el botón de empresa es `.s-empresa` (antes `.s-cab-empresa`); se espera al botón ya
  // cargado, por su nombre, y no a la caja vacía que pinta mientras carga.
  await expect(page.getByRole('button', { name: /Cambiar de empresa/ })).toBeVisible({ timeout: 30_000 })
  await expect(recuadro(page)).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
}

test.beforeEach(async ({ page }) => { await entrarComo(page, CUENTA_A.email) })

test('el 21/10, con el 3T y el 202 · 2P fuera de plazo: lo dice primero, en rojo, y el siguiente (21/12) debajo', async ({ page }) => {
  await abrir(page, '2026-10-21')
  const r = recuadro(page)
  await expect(r.locator('.s-tarjeta-cifra-etiqueta')).toHaveText('Fuera de plazo')
  await expect(r.locator('.s-tarjeta-cifra-valor')).toContainText(/^\d+ fuera de plazo: .*202 · 2P/)
  await expect(r.locator('.s-tarjeta-cifra-valor')).toContainText('el siguiente, hasta el 21/12 · dentro de 61 días')
  await expect(r).toHaveAttribute('data-tono', 'falta')
  // Nada se sale de la pantalla.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await r.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/plazo-fuera-${lado(page)}.png` })
})

test('el color, por los días que quedan hasta el 20/10: 2 o menos rojo, 15 o menos ámbar, más neutro', async ({ page }) => {
  // Sin nada fuera de plazo antes del 20/10.
  for (const [hoy, tono, nombre] of [['2026-10-18', 'falta', 'rojo'], ['2026-10-05', 'duda', 'ambar'], ['2026-10-01', null, 'neutro']] as const) {
    await abrir(page, hoy)
    const r = recuadro(page)
    await expect(r.locator('.s-tarjeta-cifra-etiqueta')).toHaveText(/^Presentar hasta el 20\/10 · /)
    if (tono) await expect(r).toHaveAttribute('data-tono', tono)
    else await expect(r).not.toHaveAttribute('data-tono', /.+/)
    await page.screenshot({ path: `${DIR}/plazo-${nombre}-${lado(page)}.png` })
  }
})
