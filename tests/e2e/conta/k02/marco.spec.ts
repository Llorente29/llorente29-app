// tests/e2e/conta/k02/marco.spec.ts
//
// K02 · El marco del núcleo, en staging (encargo K02, 17/11). Con la cuenta
// del núcleo (semilla supabase/seeds/conta/seed_k02_nucleo_staging.sql: una
// persona inventada, el interruptor `conta_nucleo` encendido y dos empresas):
//   · en el ordenador, a 1456 × 816 (la maqueta) y a 1366 × 768 (el mínimo,
//     decisión 13): se ve la cinta con las palabras de la maqueta, se cambia de
//     pestaña, se pliegan los botones (y se recuerda), se cambia de ejercicio
//     y de empresa, se abre una pantalla de cada módulo y LA PÁGINA NO RUEDA
//     (el alto del documento es el de la ventana);
//   · por debajo de 800 de alto, los botones nacen plegados;
//   · en el móvil sale el marco de hoy.
// Las capturas, a 1456 × 816: con Inicio, con una lista (Recibidas) y con los
// botones plegados.

import { test, expect, type Page } from '@playwright/test'
import { correoDePrueba, enCarril, entrarComo } from '../sesion'

const NUCLEO = { id: enCarril('c0e20000-0000-4000-8000-0000000000e0'), email: correoDePrueba('nucleo@prueba.folvy.test') }
const EMPRESA = 'Empresa de Ejemplo Núcleo, S.L.'
const GESTORIA = 'Gestoría de Ejemplo Núcleo, S.L.'
const DIR = 'docs/conta/capturas/k02'

/** La página no rueda: el documento mide lo que la ventana (como mucho 1 px de redondeo). */
async function noRueda(page: Page, donde: string) {
  const m = await page.evaluate(() => ({ alto: document.documentElement.scrollHeight, ventana: window.innerHeight, y: window.scrollY }))
  expect(m.alto, `${donde}: el documento mide ${m.alto} y la ventana ${m.ventana}`).toBeLessThanOrEqual(m.ventana + 1)
  expect(m.y, `${donde}: la página se ha movido`).toBe(0)
}

/** Espera a que la pantalla de dentro haya cargado (sin el esqueleto de carga) y que el marco siga sin rodar. */
async function abierta(page: Page, donde: string) {
  await expect(page.locator('.k-zona')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.k-zona .cx-hueso').first()).toHaveCount(0, { timeout: 30_000 })
  await noRueda(page, donde)
}

async function verBotones(page: Page) {
  const ver = page.getByRole('button', { name: 'Ver los botones' })
  if (await ver.isVisible()) await ver.click()
  await expect(page.locator('#k-cinta-botones')).toBeVisible()
}

async function elegirEnArriba(page: Page, nombre: RegExp) {
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: nombre }).click()
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`el marco del núcleo a ${ancho} × ${alto}: cinta, pestañas, plegar, empresa, ejercicio y un módulo de cada`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador; en el móvil, el de hoy (la otra prueba)')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    await entrarComo(page, NUCLEO.email)
    // Con la marca Sumied (fuera de producción se pide con ?marca=, y se recuerda en la sesión):
    // así lo ve una gestoría en app.sumied.com, y así salen las capturas.
    await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })

    // El marco del núcleo, no el de hoy.
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-barra')).toHaveCount(0)
    const cinta = page.getByRole('tablist', { name: 'La cinta' })
    await expect(cinta.getByRole('tab')).toHaveText(['Definiciones', 'Asientos', 'Importaciones', 'Listados', 'Utilidades', 'Impuestos'])
    // exact: «Inicio» está dentro de «Definiciones», y Playwright busca por trozo.
    await expect(page.getByRole('tab', { name: 'Inicio', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.k-marca')).toHaveText('Sumied')
    await expect(page.getByRole('button', { name: new RegExp(`^${EMPRESA}, ejercicio 2026`) })).toBeVisible()
    await abierta(page, 'Inicio')

    // Por debajo de 800 de alto, los botones nacen plegados (decisión 13).
    if (alto < 800) await expect(page.getByRole('button', { name: 'Ver los botones' })).toBeVisible()
    await verBotones(page)
    if (alto >= 800) await page.screenshot({ path: `${DIR}/marco-inicio-${ancho}.png` })

    // Cambiar de pestaña de la cinta enseña sus botones, sin cambiar de pantalla.
    await cinta.getByRole('tab', { name: 'Listados' }).click()
    await expect(page.locator('[data-boton="mayor"]')).toBeVisible()
    await expect(page).toHaveURL(/\/conta\/inicio/)
    await cinta.getByRole('tab', { name: 'Asientos' }).click()

    // Un botón abre su pantalla en la pestaña de trabajo.
    await page.locator('[data-boton="recibidas"]').click()
    await expect(page).toHaveURL(/\/conta\/documentos/)
    await expect(page.getByRole('tab', { name: /Facturas recibidas/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-boton="recibidas"]')).toHaveAttribute('aria-current', 'page')
    await abierta(page, 'Recibidas')
    if (alto >= 800) await page.screenshot({ path: `${DIR}/marco-recibidas-${ancho}.png` })

    // Plegar los botones, y se recuerda (a 816 de alto; por debajo de 800 nacen plegados siempre).
    await page.getByRole('button', { name: 'Plegar los botones' }).click()
    await expect(page.locator('#k-cinta-botones')).toHaveCount(0)
    await noRueda(page, 'con los botones plegados')
    if (alto >= 800) {
      await page.screenshot({ path: `${DIR}/marco-plegado-${ancho}.png` })
      await page.reload()
      await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'Ver los botones' })).toBeVisible({ timeout: 30_000 })
    }
    await verBotones(page)

    // El ejercicio, arriba: se cambia y queda escrito en la dirección.
    await elegirEnArriba(page, /^Ejercicio 2025/)
    await expect(page).toHaveURL(/ejercicio=2025/)
    await expect(page.getByRole('button', { name: new RegExp(`^${EMPRESA}, ejercicio 2025`) })).toBeVisible()
    await elegirEnArriba(page, /^Ejercicio 2026/)
    await expect(page).toHaveURL(/ejercicio=2026/)

    // Una pantalla de cada módulo (los de la empresa general).
    for (const [modulo, url] of [['Facturación', /\/conta\/ventas\/facturas/], ['Impuestos', /\/conta\/impuestos/], ['Personal', /\/conta\/laboral/], ['Contabilidad', /\/conta\/libros\/diario/]] as const) {
      await page.getByRole('navigation', { name: 'Módulos' }).getByRole('button', { name: modulo }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole('navigation', { name: 'Módulos' }).getByRole('button', { name: modulo })).toHaveAttribute('aria-current', 'true')
      await abierta(page, modulo)
    }

    // Cambiar de empresa: la de gestoría trae el módulo Despacho; se abre y se vuelve.
    await elegirEnArriba(page, new RegExp(`^${GESTORIA}`))
    await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
    const despacho = page.getByRole('navigation', { name: 'Módulos' }).getByRole('button', { name: 'Despacho' })
    await expect(despacho).toBeVisible({ timeout: 30_000 })
    await despacho.click()
    await expect(page).toHaveURL(/\/conta\/ventas\/clientes-y-cuotas/)
    await abierta(page, 'Despacho')
    await elegirEnArriba(page, new RegExp(`^${EMPRESA}`))
    await expect(page.getByRole('button', { name: new RegExp(`^${EMPRESA}`) })).toBeVisible({ timeout: 30_000 })

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('en el móvil sale el marco de hoy aunque el núcleo esté encendido', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'Es la prueba del móvil')
  await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio', { timeout: 30_000 })
  await expect(page.locator('.s-marco')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toHaveCount(0)
})
