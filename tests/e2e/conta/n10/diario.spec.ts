// tests/e2e/conta/n10/diario.spec.ts
//
// N10 · Parte 1. Libros › Diario por su área y su acción (libros/diario/libro-diario y
// libros/diario/diario-resumido) caían en la ruta del asiento y se pintaban como un asiento que no
// existe, en la pestaña «Asiento». En staging:
//   · con el núcleo encendido (la cuenta del núcleo, semilla del K02), a 1456 × 816 y a 1366 × 768:
//     la primera lleva al Libro diario (libros/diario, la pestaña del botón Asientos, como el N08) y la
//     segunda al Diario resumido, cada una en su pestaña, sin la ficha del asiento (un asiento de
//     verdad sigue abriéndose en «Asiento»: lo prueba la e2e del N08);
//   · con el interruptor apagado (la cuenta A), todo como hoy: la dirección no cambia.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { abierta, NUCLEO, zonaActiva } from '../k02/comun'

const pestana = (page: Page, nombre: string) => page.getByRole('tab', { name: nombre, exact: true })

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`con el núcleo, a ${ancho} × ${alto}: libro-diario y diario-resumido abren su pantalla, no un asiento`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(180_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    await entrarComo(page, NUCLEO.email)
    await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))

    // El Libro diario: la dirección pasa a libros/diario, en su pestaña, y no hay ficha de asiento.
    await page.goto('/conta/libros/diario/libro-diario', { timeout: 30_000 })
    await expect(page).toHaveURL(/\/conta\/libros\/diario(\?|$)/, { timeout: 30_000 })
    await expect(pestana(page, 'Asiento')).toHaveAttribute('aria-selected', 'true')
    await abierta(page, 'Libro diario')
    await expect(zonaActiva(page).locator('.cxa-izq')).toHaveCount(0)
    // Por debajo de 800 de alto, los botones de la cinta nacen plegados (K02, decisión 13): se despliegan para mirar el suyo (e2e 1583).
    const ver = page.getByRole('button', { name: 'Ver los botones' })
    if (await ver.isVisible()) await ver.click()
    await expect(page.locator('[data-boton="asientos"]')).toHaveAttribute('aria-current', 'page')

    // El Diario resumido: a libros/diario/resumido, en su pestaña, con su título.
    await page.goto('/conta/libros/diario/diario-resumido', { timeout: 30_000 })
    await expect(page).toHaveURL(/\/conta\/libros\/diario\/resumido(\?|$)/, { timeout: 30_000 })
    await expect(pestana(page, 'Diario resumido')).toHaveAttribute('aria-selected', 'true')
    await expect(zonaActiva(page).getByRole('heading', { name: 'Diario resumido', level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(zonaActiva(page).locator('.cxa-izq')).toHaveCount(0)
    await abierta(page, 'Diario resumido')

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('con el interruptor apagado, todo como hoy (la cuenta A: la dirección no cambia)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'De ordenador: en el móvil, el de hoy siempre')
  await entrarComo(page, CUENTA_A.email)
  for (const d of ['/conta/libros/diario/libro-diario', '/conta/libros/diario/diario-resumido']) {
    await page.goto(d, { timeout: 30_000 })
    await expect(page.locator('.s-barra')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.k-nucleo')).toHaveCount(0)
    await page.waitForTimeout(1500)
    await expect(page, `${d}: sin el núcleo, la dirección se queda como hoy`).toHaveURL(new RegExp(`${d.replace(/\//g, '\\/')}$`))
  }
})
