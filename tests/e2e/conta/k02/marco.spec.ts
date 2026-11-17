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
// Las capturas, con la pantalla cargada y la empresa de gestoría abierta (la
// que tiene datos): a 1456 × 816, Inicio, una lista (Recibidas), los botones
// plegados, los dos menús de arriba, los módulos plegados y «Más ▾»; a 1366 ×
// 768, el marco con los botones desplegados (respuesta K02 · 1).

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

/**
 * Arreglo 1 (respuesta K02 · 1): la captura, con la pantalla CARGADA. Sin
 * peticiones en vuelo y, si es una lista, con sus filas o con su frase de que
 * no hay ninguna (nunca a medias: las pestañas con «—» y la tabla en gris).
 */
async function cargada(page: Page, donde: string) {
  await abierta(page, donde)
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => { /* lo que siga abierto (un canal en vivo) no cuenta */ })
  const zona = page.locator('.k-zona')
  if (await zona.locator('table').count()) {
    await expect(zona.locator('tbody tr').first().or(zona.getByText(/no hay|ninguna|todavía no/i).first())).toBeVisible({ timeout: 30_000 })
  }
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
    const modulos = page.getByRole('navigation', { name: 'Módulos' })

    // El ejercicio, arriba, en la empresa general (la que tiene 2025 y 2026): se cambia y queda escrito en la dirección.
    await elegirEnArriba(page, /^Ejercicio 2025/)
    await expect(page).toHaveURL(/ejercicio=2025/)
    await expect(page.getByRole('button', { name: new RegExp(`^${EMPRESA}, ejercicio 2025`) })).toBeVisible()
    await elegirEnArriba(page, /^Ejercicio 2026/)
    await expect(page).toHaveURL(/ejercicio=2026/)
    // En la general no hay Despacho: lo enciende el sector de la empresa (o una cuenta que es asesoría).
    await expect(modulos.locator('.k-modulo')).toHaveText(['Contabilidad', 'Facturación', 'Impuestos', 'Personal'])

    // Cambiar de empresa: la de gestoría, como la verá una gestoría. Trae Despacho (arreglo 4) y los datos de la semilla.
    await elegirEnArriba(page, new RegExp(`^${GESTORIA}`))
    await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
    await expect(modulos.locator('.k-modulo')).toHaveText(['Contabilidad', 'Facturación', 'Impuestos', 'Personal', 'Despacho'], { timeout: 30_000 })
    await cargada(page, 'Inicio')

    // Por debajo de 800 de alto, los botones nacen plegados (decisión 13).
    if (alto < 800) await expect(page.getByRole('button', { name: 'Ver los botones' })).toBeVisible()
    await verBotones(page)

    // Los contadores de la cinta y la línea de estado, con número (arreglos 2 y 3).
    await expect(page.locator('[data-boton="recibidas"] .k-contador')).toHaveText('9', { timeout: 30_000 })
    await expect(page.locator('[data-boton="bancos"] .k-contador')).toHaveText('14', { timeout: 30_000 })
    const estado = page.getByRole('contentinfo', { name: 'Cómo va la empresa' })
    await expect(estado).toContainText('14 movimientos del banco por revisar')
    await expect(estado).toContainText('Asientos al día')
    await expect(estado).toContainText('9 facturas por revisar')
    // A 1366 × 768, además, es la del marco con los botones desplegados (arreglo 5).
    await page.screenshot({ path: `${DIR}/marco-inicio-${ancho}.png` })

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
    await cargada(page, 'Recibidas')
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
      await cargada(page, 'Recibidas, recargada')
    }
    await verBotones(page)

    // Arreglo 5 · lo diseñado sin maqueta, a 1456 × 816: los dos menús de arriba, los módulos plegados y «Más ▾».
    if (alto >= 800) {
      await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
      await expect(page.getByRole('group', { name: 'Empresa y ejercicio' })).toBeVisible()
      await page.screenshot({ path: `${DIR}/marco-menu-empresa-${ancho}.png` })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /Ajustes, Novedades, Favoritos y tus preferencias/ }).click()
      await expect(page.getByRole('list', { name: 'Ajustes' })).toBeVisible()
      await page.screenshot({ path: `${DIR}/marco-menu-persona-${ancho}.png` })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Plegar los módulos' }).click()
      await expect(page.getByRole('button', { name: 'Desplegar los módulos' })).toBeVisible()
      await page.screenshot({ path: `${DIR}/marco-modulos-plegados-${ancho}.png` })
      await page.getByRole('button', { name: 'Desplegar los módulos' }).click()
      await expect(page.getByRole('button', { name: 'Plegar los módulos' })).toBeVisible()
      await cinta.getByRole('tab', { name: 'Listados' }).click()
      await page.getByRole('button', { name: 'Más', exact: true }).click()
      await expect(page.getByRole('group', { name: 'Más botones' })).toBeVisible()
      await page.screenshot({ path: `${DIR}/marco-mas-listados-${ancho}.png` })
      await page.keyboard.press('Escape')
      await cinta.getByRole('tab', { name: 'Asientos' }).click()
    }

    // Una pantalla de cada módulo (en la gestoría, Despacho lleva a Clientes y cuotas).
    for (const [modulo, url] of [['Facturación', /\/conta\/ventas\/facturas/], ['Impuestos', /\/conta\/impuestos/], ['Personal', /\/conta\/laboral/], ['Despacho', /\/conta\/ventas\/clientes-y-cuotas/], ['Contabilidad', /\/conta\/libros\/diario/]] as const) {
      await modulos.getByRole('button', { name: modulo }).click()
      await expect(page).toHaveURL(url)
      await expect(modulos.getByRole('button', { name: modulo })).toHaveAttribute('aria-current', 'true')
      await abierta(page, modulo)
    }

    // Y se vuelve a la general.
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
