/// <reference lib="dom" />
// tests/e2e/conta/k02/comun.ts
//
// Lo común de las e2e del marco del núcleo (K02 y K03): la cuenta de prueba,
// la zona de la pestaña que se ve, «la página no rueda» y «la pantalla está
// cargada» antes de una captura.
//
// K03 (respuesta K02 · 2, arreglo 1): la espera de antes no esperaba. Miraba si
// había una tabla, y mientras carga, la lista de Recibidas no pinta tabla: pinta
// un hueco con aria-busy y sus pestañas con «—» (data-prueba
// pestana-sin-numero). Ahora se espera a que la pantalla haya empezado a pedir
// lo suyo, a que no quede nada en vuelo y a que no quede NINGUNA de esas
// marcas de «cargando», dos veces seguidas con medio segundo entre medias
// (una pantalla que pinta por partes no engaña con un hueco entre dos
// lecturas).

import { expect, type Locator, type Page } from '@playwright/test'
import { correoDePrueba, enCarril } from '../sesion'

export const NUCLEO = { id: enCarril('c0e20000-0000-4000-8000-0000000000e0'), email: correoDePrueba('nucleo@prueba.folvy.test') }
export const EMPRESA = 'Empresa de Ejemplo Núcleo, S.L.'
export const GESTORIA = 'Gestoría de Ejemplo Núcleo, S.L.'

/** La zona de la pestaña de trabajo que se ve (las demás siguen montadas, escondidas). */
export const zonaActiva = (page: Page): Locator => page.locator('.k-zona[data-activa="si"]')

/** Lo que dice «todavía cargando»: el hueco de una lista, el esqueleto y la pestaña de una lista sin contar. */
const CARGANDO = '[aria-busy="true"], .cx-hueso, [data-prueba="pestana-sin-numero"], .s-lista-cargando'

/** La página no rueda: el documento mide lo que la ventana (como mucho 1 px de redondeo). */
export async function noRueda(page: Page, donde: string) {
  const m = await page.evaluate(() => ({ alto: document.documentElement.scrollHeight, ventana: window.innerHeight, y: window.scrollY }))
  expect(m.alto, `${donde}: el documento mide ${m.alto} y la ventana ${m.ventana}`).toBeLessThanOrEqual(m.ventana + 1)
  expect(m.y, `${donde}: la página se ha movido`).toBe(0)
}

/** La pantalla de la pestaña que se ve, abierta, sin el esqueleto de carga, y el marco sin rodar. */
export async function abierta(page: Page, donde: string) {
  await expect(zonaActiva(page)).toBeVisible({ timeout: 30_000 })
  await expect(zonaActiva(page).locator('.cx-hueso')).toHaveCount(0, { timeout: 30_000 })
  await noRueda(page, donde)
}

/** La pantalla CARGADA, para una captura (arreglo 1). */
export async function cargada(page: Page, donde: string) {
  await abierta(page, donde)
  const zona = zonaActiva(page)
  // Que empiece a pedir lo suyo (una pantalla recién montada aún no ha pintado su «cargando»).
  await page.waitForTimeout(400)
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => { /* lo que siga abierto (un canal en vivo) no cuenta */ })
  for (let vez = 0; vez < 2; vez++) {
    await expect(zona.locator(CARGANDO), `${donde}: sigue cargando`).toHaveCount(0, { timeout: 30_000 })
    await page.waitForTimeout(500)
  }
  await expect(zona.locator(CARGANDO), `${donde}: sigue cargando`).toHaveCount(0, { timeout: 30_000 })
}
