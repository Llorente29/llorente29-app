// tests/e2e/conta/gb/alta-baja.spec.ts
//
// GB · Segunda parte (nº 9), punto 1 · Alta y baja de un trabajador desde la
// pestaña de Bitrix24 (maqueta «Trabajar desde Bitrix24», EnCRM2.dc.html).
// Lo que contesta conta-bitrix-pestana se simula (Bitrix24 no está al alcance
// de la e2e); la escritura de verdad la prueba la prueba de staging
// (supabase/staging/sql/20261109_gb_pestana_alta_baja_prueba.sql) y lo de
// Bitrix24, las unitarias (tests/unit/modules/conta/gb/escribir.test.ts).
//
//   1. Baja: el recibo nuevo antes de guardar (−24,20 €, con su porqué), «Dar
//      de baja» y la confirmación con lo hecho en Sumied y en Bitrix24.
//   2. Alta: el recibo nuevo al escribir el nombre (+24,20 €); si alguien cambió
//      la cuota en Bitrix24, no se pisa y lo dice.
//   3. Quien solo puede ver: lo dice y no cambia nada.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'
const MES = /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/

async function simular(page: Page, alHacer: (cuerpo: Record<string, unknown>) => Record<string, unknown>) {
  const hechos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'hacer') { hechos.push(cuerpo); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(alHacer(cuerpo)) }) }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  return hechos
}

test('baja: el recibo nuevo antes de guardar y la confirmación con Sumied y Bitrix24', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos = await simular(page, () => ({ estado: 'ok', frase: 'Baja de PERSONA PRUEBA 00 en gestión laboral de Cliente Prueba, S.L.: se cobra entero y ya no se cobra desde el mes que viene.',
    bitrix: { hecho: 'escrito', texto: 'Cuota del mes 471,90 €' }, pestana: respuesta() }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await expect(pestana.getByRole('heading', { level: 1, name: 'Cliente Prueba, S.L.' })).toBeVisible({ timeout: 30_000 })

  const fila = pestana.locator('.fila', { hasText: 'Persona Prueba 00' })
  await fila.getByRole('button', { name: 'Dar de baja' }).click()
  const form = pestana.getByRole('form', { name: 'Baja de un trabajador' })
  await expect(form).toContainText('Baja de Persona Prueba 00')
  await expect(form).toContainText(/se cobra entero: es la regla de tu gestoría \(mes entero\)/)
  await expect(form.locator('[data-prueba="previsto"]')).toHaveText(new RegExp(`El recibo de ${MES.source} pasa de 496,10 € a 471,90 € \\(−24,20 €\\)\\.−1 trabajador: Persona Prueba 00`))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/baja-antes-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Dar de baja' }).click()

  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('Baja hecha: Persona Prueba 00')
  await expect(hecho).toContainText('Baja de PERSONA PRUEBA 00 en gestión laboral')
  await expect(hecho).toContainText('Bitrix24 actualizado: Cuota del mes 471,90 €')
  expect(hechos).toHaveLength(1)
  expect(hechos[0]).toMatchObject({ paso: 'hacer', t: 'empresa', id: '99001', accion: 'baja', datos: { linea: 'w0', mes: expect.stringMatching(/^\d{4}-\d{2}-01$/) } })
  await page.screenshot({ path: `${DIR}/baja-hecha-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('alta: el recibo nuevo al escribir; si alguien cambió la cuota en Bitrix24, no se pisa', async ({ page }) => {
  test.setTimeout(60_000)
  const hechos = await simular(page, () => ({ estado: 'ok', frase: 'Alta de LUIS PRUEBA SOTO en gestión laboral de Cliente Prueba, S.L.: 24,20 € al mes.',
    bitrix: { hecho: 'choque', texto: 'En Bitrix24 alguien ha cambiado la cuota a 300,00: no se ha pisado. Sumied dice 520,30; queda en «Pendiente de revisar».' }, pestana: respuesta() }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('button', { name: '+ Dar de alta' }).click({ timeout: 30_000 })
  const form = pestana.getByRole('form', { name: 'Alta de un trabajador' })
  await expect(form.getByRole('button', { name: 'Dar de alta' })).toBeDisabled()
  await form.getByLabel('Nombre y apellidos').fill('Luis Prueba Soto')
  await expect(form.locator('[data-prueba="previsto"]')).toHaveText(new RegExp(`El recibo de ${MES.source} pasa de 496,10 € a 520,30 € \\(\\+24,20 €\\)\\.\\+1 trabajador: LUIS PRUEBA SOTO`))
  await page.screenshot({ path: `${DIR}/alta-antes-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Dar de alta' }).click()
  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('Alta hecha: LUIS PRUEBA SOTO')
  await expect(hecho).toContainText('no se ha pisado')
  await expect(hecho).toHaveAttribute('data-tono', 'aviso')
  expect(hechos[0]).toMatchObject({ accion: 'alta', datos: { servicio: 'lab', nombre: 'Luis Prueba Soto', empresa: 'emp-qbo', desde: expect.stringMatching(/^\d{4}-\d{2}-01$/) } })
})

test('quien solo puede ver: lo dice y no cambia nada', async ({ page }) => {
  test.setTimeout(60_000)
  await simular(page, () => ({ estado: 'sin_permiso', frase: 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('button', { name: '+ Dar de alta' }).click({ timeout: 30_000 })
  await pestana.getByLabel('Nombre y apellidos').fill('Intruso Prueba')
  await pestana.getByRole('form', { name: 'Alta de un trabajador' }).getByRole('button', { name: 'Dar de alta' }).click()
  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('No se ha dado de alta')
  await expect(hecho).toContainText('Puedes ver, pero no cambiar lo que se cobra')
  await expect(hecho).toContainText('No ha cambiado nada.')
  await expect(pestana.getByRole('heading', { name: 'Trabajadores · 18' })).toBeVisible()
})
