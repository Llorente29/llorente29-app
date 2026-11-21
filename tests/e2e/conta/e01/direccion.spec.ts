/// <reference lib="dom" />
// tests/e2e/conta/e01/direccion.spec.ts
//
// E01 · La dirección de cada empresa, la de su marca. Contra staging-conta (la
// cuenta A), en ordenador y móvil, con lo que devuelve la base interceptado
// (inventado, T11): staging no tiene ninguna dirección en entrada.sumied.com
// hasta que la tanda se aplique desde main.
//   · Una sociedad que lleva un despacho de Sumied ve UNA dirección, la de
//     @entrada.sumied.com, con su «Copiar» y la línea de oficina, en Ajustes ›
//     Correo de facturas y en la tarjeta de Documentos; la de @entrada.folvy.app
//     que sigue viva no sale (ni línea ni aviso).
//   · Una de Folvy ve la suya, la de @entrada.folvy.app.
//   · Documentos lee la misma dirección que Correo de facturas (una sola
//     fuente): con la de facturas no dice «Aún no tienes tu dirección».
// La regla del dominio y lo que hace la base lo prueba
// supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/e01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const NOTA = 'Reenvía aquí las facturas de tus proveedores. Llegan solas a Compras.'
const TECNICAS = /\b(dominio|webhook|resend)\b/i

const SUMIED = 'facturas-taberna-de-prueba@entrada.sumied.com'
const FOLVY_VIVA = 'facturas-taberna-de-prueba@entrada.folvy.app'
const FOLVY = 'facturas-cocina-de-prueba@entrada.folvy.app'

const correo = (direccion: string) => ({ direccion, activa: true, ultimo: null, confirmacion: null, llegadas: [] })
const puerta = (direccion: string) => ({
  direcciones: [{ tipo: 'facturas', direccion, activa: true }],
  direccion: { tipo: 'facturas', direccion, activa: true },
  conectados: { bancos: [], uber_por_correo: false },
  ultimos: [],
})

async function simular(page: Page, direccion: string) {
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  await page.route('**/rest/v1/rpc/conta_correo_facturas', (r) => json(r, correo(direccion)))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta(\?|$)/, (r) => json(r, puerta(direccion)))
}

for (const caso of [
  { nombre: 'una sociedad de despacho Sumied ve su dirección de @entrada.sumied.com', direccion: SUMIED, captura: 'sumied' },
  { nombre: 'una sociedad de Folvy ve la suya, de @entrada.folvy.app', direccion: FOLVY, captura: 'folvy' },
]) {
  test(`E01 · ${caso.nombre}`, async ({ page }) => {
    test.setTimeout(120_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const movil = lado(page) === 'movil'
    await entrarComo(page, CUENTA_A.email)
    await simular(page, caso.direccion)

    // Ajustes › Correo de facturas: una sola dirección, su «Copiar» y la línea de oficina.
    await page.goto('/conta/ajustes/correo-facturas', { timeout: 30_000 })
    const tarjeta = page.locator('[data-prueba="correo-facturas"]')
    await expect(tarjeta.locator('[data-prueba="direccion"]')).toHaveText(caso.direccion, { timeout: 30_000 })
    await expect(tarjeta.getByRole('button', { name: 'Copiar' })).toBeVisible()
    await expect(tarjeta.locator('[data-prueba="direccion-nota"]')).toHaveText(NOTA)
    await expect(page.getByText(FOLVY_VIVA)).toHaveCount(0)
    expect(await tarjeta.innerText()).not.toMatch(TECNICAS)
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/correo-de-facturas-${caso.captura}-${lado(page)}.png`, fullPage: true })

    // Documentos: la misma dirección (la tarjeta sale en ordenador; en el móvil no la hay, como antes).
    await page.goto('/conta/inicio/documentos', { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible({ timeout: 30_000 })
    if (!movil) {
      const tuCorreo = page.getByRole('region', { name: 'Tu correo de documentos' })
      await expect(tuCorreo.locator('[data-prueba="direccion-documentos"]')).toHaveText(caso.direccion)
      await expect(tuCorreo.getByRole('button', { name: 'Copiar' })).toBeVisible()
      await expect(tuCorreo.locator('[data-prueba="direccion-nota"]')).toHaveText(NOTA)
      await expect(tuCorreo.getByText('Aún no tienes tu dirección')).toHaveCount(0)
      expect(await tuCorreo.innerText()).not.toMatch(TECNICAS)
      await tuCorreo.scrollIntoViewIfNeeded()
    }
    await expect(page.getByText(FOLVY_VIVA)).toHaveCount(0)
    await page.screenshot({ path: `${DIR}/documentos-${caso.captura}-${lado(page)}.png`, fullPage: true })

    const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(ancho, 'la página no se sale de la pantalla').toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1)
    expect(errores).toEqual([])
  })
}
