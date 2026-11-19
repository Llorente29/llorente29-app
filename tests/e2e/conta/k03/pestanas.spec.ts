// tests/e2e/conta/k03/pestanas.spec.ts
//
// K03 · Las pestañas vivas, F5 y el teclado común, en staging (encargo K03,
// 17/11). Con la cuenta del núcleo (semilla del K02), en la empresa de
// gestoría (la de los datos), a 1456 × 816 y a 1366 × 768:
//   · se abren tres pantallas, se escribe en una, se va a otra y se vuelve:
//     sigue lo escrito, y la pantalla no se ha vuelto a montar;
//   · F5 desde una fila con cuenta (el plan contable) abre su mayor en otra
//     pestaña, y la página NO recarga;
//   · una factura con un cambio sin guardar: su pestaña lo enseña (el punto) y
//     el aspa pregunta; «Seguir aquí» la deja, «Cerrar sin guardar» la cierra;
//   · recargar: siguen las pestañas.
// Y con el interruptor apagado (la cuenta A), todo como hoy.
// Las capturas, con la pantalla cargada (cargada, en ../k02/comun.ts).

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { abierta, cargada, GESTORIA, noRueda, NUCLEO, zonaActiva } from '../k02/comun'

const DIR = 'docs/conta/capturas/k03'
/** La casilla del número en la ficha de la recibida: «N.º de factura» (la del núcleo, K04) o «Nº de factura» (la de hoy). */
const NUMERO_FACTURA = /^N\.?º de factura$/

/** Los nombres de las pestañas de trabajo, en su orden (también las que van a «N más»). */
const nombres = (page: Page) => page.locator('[data-pestana-trabajo] .k-trabajo-nombre').allTextContents()
const pestana = (page: Page, nombre: string | RegExp) => page.getByRole('tab', { name: nombre, exact: typeof nombre === 'string' })

async function verBotones(page: Page) {
  const ver = page.getByRole('button', { name: 'Ver los botones' })
  if (await ver.isVisible()) await ver.click()
  await expect(page.locator('#k-cinta-botones')).toBeVisible()
}

async function boton(page: Page, pestanaDeCinta: string, id: string) {
  await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: pestanaDeCinta }).click()
  await page.locator(`[data-boton="${id}"]`).click()
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`pestañas vivas a ${ancho} × ${alto}: volver sin perder, F5, cerrar con cambios y recargar`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    await entrarComo(page, NUCLEO.email)
    await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    // Que no quede nada de una prueba anterior en la sesión del navegador.
    await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
    await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
    await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
    await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
    await abierta(page, 'Inicio')
    await verBotones(page)

    // 1 · Tres pantallas, y se escribe en una.
    await boton(page, 'Asientos', 'recibidas')
    await cargada(page, 'Recibidas')
    const buscar = zonaActiva(page).getByLabel('Buscar factura').first()
    await buscar.fill('Distribuciones')
    await boton(page, 'Asientos', 'bancos')
    await abierta(page, 'Bancos')
    await boton(page, 'Listados', 'sumas')
    await abierta(page, 'Sumas y saldos')
    await expect.poll(() => nombres(page)).toEqual(['Inicio', 'Facturas recibidas', 'Bancos', 'Sumas y saldos'])
    // Se marca la pantalla de Recibidas, para saber si al volver es LA MISMA (no una montada de nuevo).
    await page.locator('.k-zona[data-pestana="boton:recibidas"]').evaluate((el) => { el.setAttribute('data-k03-viva', 'si') })

    // 2 · Se vuelve: sigue lo escrito, y es la misma pantalla.
    await pestana(page, 'Facturas recibidas').click()
    await expect(page).toHaveURL(/\/conta\/documentos/)
    await expect(zonaActiva(page)).toHaveAttribute('data-k03-viva', 'si')
    await expect(zonaActiva(page).getByLabel('Buscar factura').first()).toHaveValue('Distribuciones')
    await noRueda(page, 'de vuelta en Recibidas')
    if (alto >= 800) {
      await cargada(page, 'Recibidas, de vuelta')
      await page.screenshot({ path: `${DIR}/pestanas-vuelta-${ancho}.png` })
    }
    await zonaActiva(page).getByLabel('Buscar factura').first().fill('')

    // 3 · F5 desde una fila con cuenta: el plan contable (cada fila enlaza con su mayor).
    // El plan abre con «Las que usas» y con el grupo 4 elegido, y la gestoría de prueba
    // no tiene asientos y solo tiene la 57200001 (la cuenta del banco que le da la
    // semilla del K02), en el grupo 5: se pasa a «Todas», se elige el grupo 5 y se
    // abren 57 y 572 hasta su fila.
    await boton(page, 'Definiciones', 'plan')
    await abierta(page, 'Plan contable')
    const plan = zonaActiva(page)
    const codigo = '57200001'
    await plan.getByRole('button', { name: 'Todas', exact: true }).first().click()
    await expect(plan.getByRole('button', { name: 'Todas', exact: true }).first()).toHaveAttribute('aria-pressed', 'true')
    const grupo5 = plan.getByRole('group', { name: 'Grupo del plan' }).getByRole('button', { name: /^5 · Cuentas financieras/ })
    await grupo5.click()
    await expect(grupo5).toHaveAttribute('aria-pressed', 'true')
    const fila = plan.locator(`[role="row"]:has(a[href*="/conta/plan/${codigo}"])`).first()
    for (const grupo of ['57', '572']) {
      const abrir = plan.getByRole('button', { name: new RegExp(`^Abrir ${grupo} · `) }).first()
      // O el grupo por abrir, o ya la fila (si el árbol no tiene ese nivel).
      await expect(abrir.or(fila).first()).toBeVisible({ timeout: 30_000 })
      if (await fila.isVisible()) break
      await abrir.click()
    }
    await expect(fila).toBeVisible({ timeout: 15_000 })
    await page.evaluate(() => { (window as unknown as { k03SinRecargar: boolean }).k03SinRecargar = true })
    await plan.locator(`[role="row"]:has(a[href*="/conta/plan/${codigo}"])`).first().focus()
    await expect(page.locator('.k-trabajo-mayor')).toContainText(codigo)
    await page.keyboard.press('F5')
    await expect(page).toHaveURL(new RegExp(`/conta/plan/${codigo}`))
    await expect(pestana(page, `Mayor · ${codigo}`)).toHaveAttribute('aria-selected', 'true')
    // La página no ha recargado: lo puesto en la ventana sigue ahí.
    expect(await page.evaluate(() => (window as unknown as { k03SinRecargar?: boolean }).k03SinRecargar)).toBe(true)
    await abierta(page, 'el mayor')
    // F5 sin cuenta elegida: nada, y no recarga.
    await pestana(page, 'Bancos').click()
    await zonaActiva(page).focus()
    await page.keyboard.press('F5')
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/\/conta\/bancos/)
    expect(await page.evaluate(() => (window as unknown as { k03SinRecargar?: boolean }).k03SinRecargar)).toBe(true)

    // 4 · Una factura con un cambio sin guardar: el punto, y el aspa pregunta.
    await pestana(page, 'Facturas recibidas').click()
    await cargada(page, 'Recibidas')
    // El «›» de la primera fila (vale a cualquier ancho: la columna del número no sale siempre).
    await zonaActiva(page).locator('tbody .s-lista-abrir-boton').first().click()
    await expect(page).toHaveURL(/\/conta\/documentos\/recibidas\//)
    await abierta(page, 'la factura')
    // K04: en el núcleo, la ficha nueva («N.º de factura», como la maqueta); la de hoy («Nº de factura») sigue
    // saliendo dentro de la pestaña para una validada o un abono. La casilla, con cualquiera de las dos.
    const numero = zonaActiva(page).getByRole('textbox', { name: NUMERO_FACTURA })
    await expect(numero).toBeVisible({ timeout: 30_000 })
    await numero.fill('F-2026/0411-B')
    const ficha = page.locator('[data-pestana-trabajo="ficha:recibida"]')
    await expect(ficha).toHaveAttribute('data-cambios', 'si')
    await expect(ficha.getByRole('tab')).toHaveAccessibleName(/con cambios sin guardar/)
    // Se va a otra pestaña: la factura sigue con su cambio (y su punto).
    await pestana(page, 'Bancos').click()
    await expect(ficha).toHaveAttribute('data-cambios', 'si')
    if (alto >= 800) {
      await cargada(page, 'Bancos, con la factura cambiada al lado')
      await page.screenshot({ path: `${DIR}/pestanas-con-cambios-${ancho}.png` })
    }
    await ficha.getByRole('button', { name: /^Cerrar Factura recibida/ }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('Tienes cambios sin guardar en')
    for (const b of ['Guardar y cerrar', 'Cerrar sin guardar', 'Seguir aquí']) await expect(dialogo.getByRole('button', { name: b })).toBeVisible()
    if (alto >= 800) await page.screenshot({ path: `${DIR}/pestanas-cerrar-${ancho}.png` })
    await dialogo.getByRole('button', { name: 'Seguir aquí' }).click()
    await expect(ficha).toHaveCount(1)
    await pestana(page, /^Factura recibida/).click()
    await expect(zonaActiva(page).getByRole('textbox', { name: NUMERO_FACTURA })).toHaveValue('F-2026/0411-B')
    await ficha.getByRole('button', { name: /^Cerrar Factura recibida/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin guardar' }).click()
    await expect(ficha).toHaveCount(0)

    // 5 · Recargar: siguen las pestañas.
    const antes = await nombres(page)
    await page.reload()
    await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => nombres(page), { timeout: 30_000 }).toEqual(antes)
    await abierta(page, 'tras recargar')
    if (alto >= 800) {
      await cargada(page, 'tras recargar')
      await page.screenshot({ path: `${DIR}/pestanas-recargada-${ancho}.png` })
    }

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('con el interruptor apagado, todo como hoy (la cuenta A: el marco de hoy, sin pestañas)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'De ordenador: en el móvil, el de hoy siempre (lo prueba k02)')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/libros/diario', { timeout: 30_000 })
  await expect(page.locator('.s-barra')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toHaveCount(0)
  await expect(page.locator('[data-pestana-trabajo]')).toHaveCount(0)
})
