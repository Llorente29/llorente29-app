/// <reference lib="dom" />
// tests/e2e/conta/n5/anchos-compras.spec.ts
//
// N5 · La regla de anchos (Julio, aprobada el 23/10), en Compras y gastos,
// contra staging-conta, cuenta A, a 1920, 1366 y 390 px:
//   · 1920 (1600 o más): la barra abierta (como la deja la persona: de serie,
//     abierta) y el PDF al lado de los datos;
//   · 1366 (1280–1599): la barra plegada sola, y el PDF al lado;
//   · 390 (menos de 768): una sola columna.
// Y en las listas (Facturas recibidas y Liquidaciones), ni la página ni la
// tabla se desplazan de lado: las columnas se quitan por prioridad.
// Solo lee; no crea ni borra nada. Corre en el proyecto «ordenador» y pone el
// ancho a mano (a 390, también); en el «móvil» se salta, para no repetirlo.
// Capturas en docs/conta/capturas/n5.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/n5'
const ANCHOS = [1920, 1366, 390] as const

async function sinDesplazamientoLateral(page: Page, donde: string) {
  const m = await page.evaluate(() => {
    const lista = document.querySelector<HTMLElement>('.s-lista')
    const tabla = lista?.querySelector<HTMLElement>('table')
    return {
      pagina: document.documentElement.scrollWidth, ventana: window.innerWidth,
      lista: lista?.clientWidth ?? null, tabla: tabla?.scrollWidth ?? null,
    }
  })
  expect(m.pagina, `${donde}: la página se desplaza de lado (${m.pagina} > ${m.ventana})`).toBeLessThanOrEqual(m.ventana)
  if (m.lista !== null && m.tabla !== null) expect(m.tabla, `${donde}: la tabla no cabe en su lista (${m.tabla} > ${m.lista})`).toBeLessThanOrEqual(m.lista + 1)
}

const barra = (page: Page) => page.getByRole('navigation', { name: 'Menú de contabilidad' })

for (const ancho of ANCHOS) {
  test(`N5 · Compras y gastos a ${ancho} px: la barra, el PDF y las listas sin desplazarse de lado`, async ({ page }, info) => {
    test.skip(info.project.name !== 'ordenador', 'El ancho se pone a mano: con un proyecto basta.')
    test.setTimeout(150_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    await page.setViewportSize({ width: ancho, height: ancho === 390 ? 844 : 1000 })
    await entrarComo(page, CUENTA_A.email)

    // 1 · Facturas recibidas.
    await page.goto('/conta/documentos?ver=todas')
    await expect(page.getByRole('heading', { level: 1, name: 'Facturas recibidas' })).toBeVisible({ timeout: 30_000 })
    // La F-2026-1022 de Mayorista Prueba Alfa (semilla D01), que lleva su PDF: la primera
    // de «Todas» depende de lo que hayan creado otras pruebas y puede no tenerlo.
    const fila = page.locator('[data-fila]').filter({ hasText: 'F-2026-1022' }).first()
    await expect(fila).toBeVisible({ timeout: 30_000 })
    if (ancho === 390) await expect(barra(page)).toHaveCount(0)
    else await expect(barra(page)).toHaveAttribute('data-desplegada', ancho >= 1600 ? 'si' : 'no')
    await sinDesplazamientoLateral(page, `Facturas recibidas a ${ancho}`)
    await page.screenshot({ path: `${DIR}/recibidas-${ancho}.png` })

    // 2 · Una ficha: el PDF al lado (1280 o más) o una sola columna (390).
    await fila.click()
    const ficha = page.locator('.s-ficha')
    await expect(ficha).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-documento').first()).toBeVisible({ timeout: 30_000 })
    const caja = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('.s-ficha-datos')?.getBoundingClientRect()
      const p = document.querySelector<HTMLElement>('.s-ficha-documento')?.getBoundingClientRect()
      return d && p ? { datosDerecha: d.right, docIzquierda: p.left, datosAbajo: d.bottom, docArriba: p.top, docAbajo: p.bottom, datosArriba: d.top } : null
    })
    expect(caja, 'la ficha tiene sus datos y su documento').not.toBeNull()
    if (ancho === 390) {
      // Una sola columna: uno encima del otro, no al lado.
      expect(caja!.docAbajo <= caja!.datosArriba + 1 || caja!.docArriba >= caja!.datosAbajo - 1, 'a 390, datos y documento en una sola columna').toBe(true)
    } else {
      expect(caja!.docIzquierda, `a ${ancho}, el documento va al lado de los datos`).toBeGreaterThanOrEqual(caja!.datosDerecha - 1)
      await expect(ficha).toHaveAttribute('data-documento', /si|oculto/)
      await expect(barra(page)).toHaveAttribute('data-desplegada', ancho >= 1600 ? 'si' : 'no')
    }
    await sinDesplazamientoLateral(page, `la ficha a ${ancho}`)
    await page.screenshot({ path: `${DIR}/ficha-${ancho}.png` })

    // 3 · Liquidaciones.
    await page.goto('/conta/compras/liquidaciones')
    await expect(page.getByRole('heading', { level: 1, name: 'Liquidaciones' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-fila]').first()).toBeVisible({ timeout: 30_000 })
    await sinDesplazamientoLateral(page, `Liquidaciones a ${ancho}`)
    await page.screenshot({ path: `${DIR}/liquidaciones-${ancho}.png` })

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('N5 · a 1366 la barra plegada se abre a mano y no cambia la preferencia: a 1920 sigue como estaba', async ({ page }, info) => {
  test.skip(info.project.name !== 'ordenador', 'El ancho se pone a mano: con un proyecto basta.')
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1366, height: 1000 })
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/documentos?ver=todas')
  await expect(barra(page)).toHaveAttribute('data-desplegada', 'no', { timeout: 30_000 })
  await barra(page).getByRole('button', { name: 'Desplegar el menú' }).click()
  await expect(barra(page)).toHaveAttribute('data-desplegada', 'si')
  await page.setViewportSize({ width: 1920, height: 1000 })
  await expect(barra(page)).toHaveAttribute('data-desplegada', 'si')
  await page.setViewportSize({ width: 1366, height: 1000 })
  // Al volver al tramo, plegada otra vez: lo de a mano vale mientras no se cambia de tramo.
  await expect(barra(page)).toHaveAttribute('data-desplegada', 'no')
})
