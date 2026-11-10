// tests/e2e/conta/gb/pestana.spec.ts
//
// GB · La pestaña «Sumied» dentro de la ficha de Bitrix24 (bitrix-pestana.html),
// en el ordenador y en el móvil, fiel a la maqueta «Sumied dentro de Bitrix24»
// (EnCRM.dc.html).
//
// Bitrix24 no está al alcance de la e2e: su token solo vale dentro del portal.
// Por eso lo que contesta conta-bitrix-pestana se simula aquí con la forma de
// la 1905 (respuesta.ts); la comprobación de verdad del usuario y la lectura
// como la persona las prueban la prueba de staging
// (supabase/staging/sql/20261109_gb_bitrix_pestana_prueba.sql) y las
// unitarias (tests/unit/modules/conta/gb). La captura dentro del Bitrix24 de
// pruebas se saca a mano, después del real.
//
//   1. Con acceso: el cliente y su situación, el recibo de diciembre línea a
//      línea con su porqué, los cobros con el devuelto, los servicios, los
//      trabajadores, lo pendiente de revisar y «Abrir en Sumied ↗». Pintada en
//      menos de 1 s. El token sale de la dirección. Ningún código interno.
//   2. Sin acceso: «Pide acceso a Sumied a tu administrador» y nada más.
//   3. Una ficha sin enlazar, y abierta fuera de Bitrix24: lo dicen.
//   4. La instalación: lo dice y termina la instalación en Bitrix24.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const TOKEN = 'tokendeprueba0000000000'
const ALMOHADILLA = `#a=${TOKEN}&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001`
const TECNICAS = /\b(null|undefined|NaN|token|uuid|rpc|jwt|placement|sin_acceso|sin_enlazar|estado)\b|_[a-z]/i

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function simular(page: Page, contesta: Record<string, unknown>) {
  const pedidos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    pedidos.push(r.request().postDataJSON())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contesta) })
  })
  // El SDK de Bitrix24: uno de mentira que apunta lo que se le pide.
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: 'window.__bx = []; window.BX24 = { init: (f) => f(), installFinish: () => window.__bx.push("installFinish"), fitWindow: () => window.__bx.push("fitWindow") };' }))
  return pedidos
}

test('con acceso: el cliente, el recibo línea a línea, los cobros, los servicios y los trabajadores, en menos de 1 s', async ({ page }) => {
  test.setTimeout(60_000)
  const errores = vigilar(page)
  const pedidos = await simular(page, respuesta())
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await expect(pestana.getByRole('heading', { level: 1, name: 'Cliente Prueba, S.L.' })).toBeVisible({ timeout: 30_000 })

  // Una sola lectura, con lo que mandó Bitrix24; y el token ya no está en la dirección.
  expect(pedidos[0]).toEqual({ paso: 'leer', a: TOKEN, p: 'b24-s3mr2y.bitrix24.es', t: 'empresa', id: '99001' })
  // nº 9 · Después de pintar, y solo entonces, «Su portal».
  await expect.poll(() => pedidos.map((x) => x.paso)).toEqual(['leer', 'portal'])
  expect(page.url()).not.toContain(TOKEN)
  const ms = await page.evaluate(() => performance.getEntriesByName('gb-pintada')[0]?.startTime ?? -1)
  console.log(`[GB] pintada a los ${Math.round(ms)} ms (${lado(page)})`)
  expect(ms).toBeGreaterThan(0)
  expect(ms).toBeLessThan(1000)

  // La cabecera: quién le factura y su situación.
  await expect(pestana.locator('.cabeza')).toContainText('Cuotas, recibos y facturas · le factura QBO Prueba')
  await expect(pestana.locator('.chip')).toHaveText('Activo')
  // nº 29 · En Resumen, una sola vez: «Cliente desde» en los datos, no «Cobra desde» junto al nombre.
  await expect(pestana.locator('.cliente')).not.toContainText('Cobra desde')
  // El recibo del mes que viene, línea a línea, con el porqué.
  const recibo = pestana.getByRole('region', { name: 'Recibo de diciembre de 2026' })
  await expect(recibo.locator('.total')).toHaveText('496,10 €')
  await expect(recibo.locator('.linea')).toHaveCount(2)
  await expect(recibo.locator('.linea').nth(0)).toContainText('Gestoría mensual')
  await expect(recibo.locator('.linea').nth(0)).toContainText('60,50 €')
  await expect(recibo.locator('.linea').nth(1)).toContainText('Gestión laboral · 18 trabajadores')
  await expect(recibo.locator('.linea').nth(1)).toContainText('18 × 24,20 € · este mes: ninguna alta, ninguna baja')
  // Los cobros: el mandato, cuatro a la vista y el devuelto en rojo.
  const cobros = pestana.getByRole('region', { name: 'Cobros' })
  await expect(cobros.locator('.cobro').first()).toHaveText(/Mandato SEPA\s*Firmado/)
  await expect(cobros.locator('.cobro')).toHaveCount(5)
  await expect(cobros.locator('.estado-mal')).toHaveText('Devuelto')
  await expect(cobros.getByRole('link', { name: 'Ver los 5 cobros →' })).toBeVisible()
  // nº 10 · Las pestañas por área: abre en Resumen, con su aviso en la que tiene algo pendiente.
  const areas = pestana.getByRole('tablist', { name: 'Áreas de Sumied' })
  await expect(areas.getByRole('tab')).toHaveText(['Resumen', 'Cuotas y cobros2', 'Laboral18', 'Portal'])
  await expect(areas.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true')
  // Resumen: lo pendiente con este cliente, cada línea lleva a su pestaña.
  const pendiente = pestana.getByRole('region', { name: 'Lo pendiente con este cliente' })
  await expect(pendiente.locator('[data-prueba="pendiente"]')).toHaveCount(2)
  await expect(pendiente.locator('[data-prueba="pendiente"]').nth(0)).toContainText('Recibo del 4 oct. 2026 devuelto · 496,10 €')
  await expect(pendiente.locator('[data-prueba="pendiente"]').nth(1)).toContainText('GoCardless cobra 496,10 € y Sumied calcula otra cifra.')
  await expect(pestana.getByRole('region', { name: 'Servicios que tiene' })).toHaveCount(0)
  // nº 17, E · «Cliente desde», como dato.
  await expect(pestana.locator('.datos')).toContainText('Cliente desdeEnero de 2020')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/pestana-${lado(page)}.png`, fullPage: true })

  // Cuotas y cobros (desde lo pendiente): los servicios. Cambiar de pestaña no lee nada y es al momento.
  const t0 = await page.evaluate(() => performance.now())
  await pendiente.getByRole('button', { name: 'Resolver →' }).first().click()
  await expect(areas.getByRole('tab', { name: /Cuotas y cobros/ })).toHaveAttribute('aria-selected', 'true')
  // nº 29 · En las otras pestañas, «Cobra desde» junto al nombre (allí no está el dato).
  await expect(pestana.locator('.cliente')).toContainText('Cobra desde enero de 2020')
  const servicios = pestana.getByRole('region', { name: 'Servicios que tiene' })
  await expect(servicios.locator('.fila')).toHaveCount(2)
  expect(await page.evaluate((t) => performance.now() - t, t0)).toBeLessThan(1000)
  await expect(servicios.locator('.fila').nth(1)).toContainText('435,60 €')
  await expect(pestana.getByRole('region', { name: 'Cobros' })).toBeVisible()
  // Laboral: los trabajadores.
  await areas.getByRole('tab', { name: /Laboral/ }).click()
  await expect(pestana.getByRole('heading', { name: 'Trabajadores · 18' })).toBeVisible()
  await expect(pestana.getByRole('link', { name: 'Ver los 18 en Sumied →' })).toBeVisible()
  await expect(pestana.getByRole('region', { name: 'Cobros' })).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/pestana-laboral-${lado(page)}.png`, fullPage: true })
  // Portal: quién entra (aquí, nadie).
  await areas.getByRole('tab', { name: 'Portal' }).click()
  await expect(pestana.getByRole('region', { name: 'Su portal' })).toContainText('Todavía no entra nadie de este cliente.')
  expect(pedidos.map((x) => x.paso)).toEqual(['leer', 'portal'])
  // «Abrir en Sumied ↗», a la ficha del cliente, en otra pestaña.
  const abrir = pestana.getByRole('link', { name: 'Abrir en Sumied ↗' })
  await expect(abrir).toHaveAttribute('href', /\/conta\/ventas\/clientes-y-cuotas\/cliente\/1\?empresa=emp-qbo$/)
  await expect(abrir).toHaveAttribute('target', '_blank')

  expect(await pestana.innerText()).not.toMatch(TECNICAS)
  expect(errores).toEqual([])
})

test('sin acceso, sin enlazar o fuera de Bitrix24: lo dice y no enseña nada', async ({ page }) => {
  test.setTimeout(60_000)
  const errores = vigilar(page)
  const pestana = page.locator('#pestana')

  await simular(page, { estado: 'sin_acceso', frase: 'Pide acceso a Sumied a tu administrador.' })
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  await expect(pestana.getByRole('status')).toHaveText(/Sin acceso a Sumied\s*Pide acceso a Sumied a tu administrador\./, { timeout: 30_000 })
  await expect(pestana.locator('.recibo, .bloque')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/sin-acceso-${lado(page)}.png`, fullPage: true })

  // Solo cambia lo de detrás del «#»: sin pasar por otra página, el navegador no la vuelve a abrir.
  await page.goto('about:blank')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await simular(page, { estado: 'sin_enlazar', frase: 'Esta ficha no está enlazada con ningún cliente de Sumied.', cuenta_nombre: 'Gestoría Demo' })
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA.replace('99001', '99999')}`)
  await expect(pestana.getByRole('status')).toHaveText(/Ficha sin enlazar\s*Esta ficha no está enlazada con ningún cliente de Sumied\./, { timeout: 30_000 })
  await expect(pestana.locator('.recibo, .bloque')).toHaveCount(0)

  // Abierta a mano, sin lo que manda Bitrix24: ni siquiera pregunta.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  const pedidos = await simular(page, respuesta())
  await page.goto('/bitrix-pestana.html')
  await expect(pestana.getByRole('status')).toHaveText(/Abre la pestaña desde Bitrix24/, { timeout: 30_000 })
  expect(pedidos).toEqual([])
  expect(errores).toEqual([])
})

test('la instalación: lo dice y la termina en Bitrix24', async ({ page }) => {
  test.setTimeout(60_000)
  const errores = vigilar(page)
  const pedidos = await simular(page, respuesta())
  await page.goto(`/bitrix-pestana.html#instalar=1&a=${TOKEN}&p=b24-s3mr2y.bitrix24.es`)
  await expect(page.locator('#pestana').getByRole('status')).toHaveText(/Sumied, instalado\s*Abre la ficha de una empresa o de un contacto: tienes la pestaña «Sumied»\./, { timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bx?: string[] }).__bx ?? [])).toEqual(['installFinish'])
  expect(pedidos).toEqual([])
  expect(page.url()).not.toContain(TOKEN)
  expect(errores).toEqual([])
})
