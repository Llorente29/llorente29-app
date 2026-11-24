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
import { STAGING_URL, anonKey, entrarComo, type Sesion } from '../sesion'
import { abierta, cargada, EMPRESA, GESTORIA, noRueda, NUCLEO } from './comun'

const DIR = 'docs/conta/capturas/k02'

async function verBotones(page: Page) {
  const ver = page.getByRole('button', { name: 'Ver los botones' })
  if (await ver.isVisible()) await ver.click()
  await expect(page.locator('#k-cinta-botones')).toBeVisible()
}

/**
 * K13 · Los asientos por revisar de una empresa, como los cuenta la base para la línea de estado (conta_pendientes).
 * null era el fallo de la 20261124T0720: «no se ha podido contar» y la frase de los asientos no salía.
 */
async function asientosPorRevisar(s: Sesion, empresa: string): Promise<number | null> {
  const cab = { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }
  const r = await fetch(`${STAGING_URL}/rest/v1/company?select=id&account_id=eq.${NUCLEO.id}&legal_name=eq.${encodeURIComponent(empresa)}`, { headers: cab })
  const [c] = (await r.json()) as { id: string }[]
  expect(c?.id, `la empresa «${empresa}»`).toBeTruthy()
  const p = await fetch(`${STAGING_URL}/rest/v1/rpc/conta_pendientes`, { method: 'POST', headers: cab, body: JSON.stringify({ p_company: c.id }) })
  expect(p.status, 'conta_pendientes').toBeLessThan(300)
  const v = ((await p.json()) as Record<string, unknown>).asientos_por_validar
  return typeof v === 'number' ? v : null
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
    const sesion = await entrarComo(page, NUCLEO.email)
    // Con la marca Sumied (fuera de producción se pide con ?marca=, y se recuerda en la sesión):
    // así lo ve una gestoría en app.sumied.com, y así salen las capturas.
    await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })

    // El marco del núcleo, no el de hoy.
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-barra')).toHaveCount(0)
    const cinta = page.getByRole('tablist', { name: 'La cinta' })
    // Con Tesorería (X28), como la fila del menú de la maqueta 17b.
    await expect(cinta.getByRole('tab')).toHaveText(['Definiciones', 'Asientos', 'Tesorería', 'Importaciones', 'Listados', 'Utilidades', 'Impuestos'])
    // exact: «Inicio» está dentro de «Definiciones», y Playwright busca por trozo.
    await expect(page.getByRole('tab', { name: 'Inicio', exact: true })).toHaveAttribute('aria-selected', 'true')
    // El logo (K10, #773): una imagen; se comprueba por su nombre.
    await expect(page.getByRole('link', { name: 'Sumied: al inicio' })).toBeVisible()
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
    // K13: el número, el que haya (desde el K02, las semillas K04, K04b, K07 y K11b añadieron facturas a la gestoría);
    // lo que se prueba es que el contador lleva número y que la línea de estado dice el mismo.
    // Los movimientos del banco, desde el X28, en la pestaña Tesorería («Conciliar»): aquí, su frase en la línea de estado.
    const recibidas = page.locator('[data-boton="recibidas"] .k-contador').first()
    await expect(recibidas).toHaveText(/^\d+$/, { timeout: 30_000 })
    const nRecibidas = Number(await recibidas.textContent())
    const estado = page.getByRole('contentinfo', { name: 'Cómo va la empresa' })
    await expect(estado).toContainText(/\d+ movimientos? del banco por revisar|Bancos al día/)
    // La regla (nucleo/estado.ts): los asientos salen siempre que se puedan contar; con 0, «Asientos al día»; si no,
    // «N asientos por revisar». En la gestoría no se podían contar (la 20261124T0720): que la base dé un número, y la frase.
    const nAsientos = await asientosPorRevisar(sesion, GESTORIA)
    expect(nAsientos, 'los asientos por revisar de la gestoría, contados (no null)').not.toBeNull()
    await expect(estado).toContainText(nAsientos === 0 ? 'Asientos al día' : `${nAsientos} asiento${nAsientos === 1 ? '' : 's'} por revisar`)
    await expect(estado).toContainText(`${nRecibidas} factura${nRecibidas === 1 ? '' : 's'} por revisar`)
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
