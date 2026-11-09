// tests/e2e/conta/gb/tarifa.spec.ts
//
// GB · Segunda parte (nº 9), punto 2 · Cambiar el nivel o poner un precio
// especial (con su motivo) desde la pestaña de Bitrix24 (maqueta EnCRM2.dc.html).
// Lo que contesta conta-bitrix-pestana se simula; la escritura de verdad la
// prueba supabase/staging/sql/20261109_gb_pestana_tarifa_prueba.sql.
//
//   1. «Cambiar» la gestoría mensual: de Premium a Básica, el recibo nuevo
//      antes de guardar (−60,00 €) y la confirmación.
//   2. Precio especial: sin motivo no se puede guardar; con él, el recibo
//      nuevo (−15,00 €) y lo que se manda.

import { test, expect, type Page } from '@playwright/test'
import { conNiveles } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'
const MES = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'

async function simular(page: Page, alHacer: Record<string, unknown>) {
  const hechos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'hacer') { hechos.push(cuerpo); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(alHacer) }) }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conNiveles()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  return hechos
}

test('cambiar de nivel: el recibo nuevo antes de guardar y la confirmación', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos = await simular(page, { estado: 'ok', frase: 'Cliente Prueba, S.L. pasa de Gestoría mensual · Premium a Gestoría mensual · Básica desde diciembre de 2026.',
    bitrix: { hecho: 'escrito', texto: 'Cuota del mes 525,60 €' }, pestana: conNiveles() })
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  // nº 10 · Nivel y precio, en la pestaña «Cuotas y cobros».
  await pestana.getByRole('tab', { name: /^Cuotas y cobros/ }).click({ timeout: 30_000 })
  const fila = pestana.locator('.fila', { hasText: 'Gestoría mensual · Premium' })
  await fila.getByRole('button', { name: 'Cambiar' }).click()
  const form = pestana.getByRole('form', { name: 'Cambiar un servicio' })
  await expect(form.getByRole('radio', { name: 'Premium' })).toHaveAttribute('aria-checked', 'true')
  await expect(form.getByRole('button', { name: 'Guardar el cambio' })).toBeDisabled()
  await form.getByRole('radio', { name: 'Básica' }).click()
  await expect(form.locator('[data-prueba="previsto"]')).toHaveText(new RegExp(`El recibo de ${MES} pasa de 585,60 € a 525,60 € \\(−60,00 €\\)\\.Cambia a Básica\\.`))
  await expect(form).toContainText('Si el recibo sube más de un 30 %, al cobrar te pedirá «Lo he mirado, aprobar».')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/nivel-antes-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Guardar el cambio' }).click()
  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('Nivel cambiado')
  await expect(hecho).toContainText('pasa de Gestoría mensual · Premium a Gestoría mensual · Básica')
  await expect(hecho).toContainText('Bitrix24 actualizado: Cuota del mes 525,60 €')
  expect(hechos[0]).toMatchObject({ accion: 'tarifa', datos: { linea: 'l1', nivel: 'basica', desde: expect.stringMatching(/^\d{4}-\d{2}-01$/) } })
  expect(hechos[0].datos).not.toHaveProperty('precio')
  expect(errores).toEqual([])
})

test('precio especial: sin motivo no se guarda; con él, el recibo nuevo y lo que se manda', async ({ page }) => {
  test.setTimeout(60_000)
  const hechos = await simular(page, { estado: 'ok', frase: 'Guardado Gestoría mensual · Premium para Cliente Prueba, S.L.: 135,00 € al mes desde diciembre de 2026.',
    bitrix: { hecho: 'escrito', texto: 'Cuota del mes 570,60 €' }, pestana: conNiveles() })
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('tab', { name: /^Cuotas y cobros/ }).click({ timeout: 30_000 })
  await pestana.locator('.fila', { hasText: 'Gestoría mensual · Premium' }).getByRole('button', { name: 'Cambiar' }).click()
  const form = pestana.getByRole('form', { name: 'Cambiar un servicio' })
  await form.getByLabel('Precio especial para este cliente').check()
  await form.getByLabel('Precio al mes').fill('135')
  await expect(form.getByRole('button', { name: 'Guardar el cambio' })).toBeDisabled()
  await form.getByLabel('Por qué (lo verá tu equipo)').fill('Cliente desde 2015')
  await expect(form.locator('[data-prueba="previsto"]')).toHaveText(new RegExp(`El recibo de ${MES} pasa de 585,60 € a 570,60 € \\(−15,00 €\\)\\.Precio especial: 135,00 € al mes\\. Por qué: Cliente desde 2015\\.`))
  await page.screenshot({ path: `${DIR}/precio-especial-antes-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Guardar el cambio' }).click()
  await expect(pestana.locator('[data-prueba="hecho"]')).toContainText('Precio especial guardado')
  expect(hechos[0]).toMatchObject({ accion: 'tarifa', datos: { linea: 'l1', nivel: 'premium', precio: 135, motivo: 'Cliente desde 2015' } })
})
