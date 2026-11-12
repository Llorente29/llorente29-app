// tests/e2e/conta/gb/dia-dni.spec.ts
//
// GB · nº 17, D · El alta y la baja de un trabajador desde la pestaña de
// Bitrix24 con su día exacto y su DNI o NIE (maqueta «Trabajar desde Bitrix24»),
// con las funciones de Code 1 (1108). Lo que contesta conta-bitrix-pestana se
// simula; la base de verdad la prueba
// supabase/staging/sql/20261110_gb_pestana_dia_dni_prueba.sql.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'

async function simular(page: Page, frase: string) {
  const hechos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'hacer') { hechos.push(cuerpo); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', frase, bitrix: { hecho: 'escrito', texto: 'Trabajadores 19 · Nota en el historial de la ficha.' }, pestana: respuesta() }) }) }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  return hechos
}

test('alta con su día y su DNI: la letra mal no deja guardar; bien, lo manda', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos = await simular(page, 'Alta de LUIS PRUEBA SOTO (12345678Z) en gestión laboral de Cliente Prueba, S.L. el 15/12/2026: 24,20 € al mes.')
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('tab', { name: /^Laboral/ }).click({ timeout: 30_000 })
  await pestana.getByRole('button', { name: '+ Dar de alta' }).click()
  const form = pestana.getByRole('form', { name: 'Alta de un trabajador' })
  const dia = await form.getByLabel('Día de alta').inputValue()
  const siguiente = (() => { const a = Number(dia.slice(0, 4)); const m = Number(dia.slice(5, 7)); return m === 12 ? `${a + 1}-01-15` : `${a}-${String(m + 1).padStart(2, '0')}-15` })()
  await form.getByLabel('Nombre y apellidos').fill('Luis Prueba Soto')
  await form.getByLabel('Día de alta').fill(siguiente)
  await form.getByLabel('DNI o NIE').fill('12345678A')
  await expect(form.getByRole('alert')).toContainText('El DNI o NIE 12345678A no es válido: revisa la letra.')
  await expect(form.getByRole('button', { name: 'Dar de alta' })).toBeDisabled()
  await form.getByLabel('DNI o NIE').fill('1234 5678-z')
  await expect(form.getByRole('alert')).toHaveText('')
  await expect(form.locator('[data-prueba="previsto"]')).toContainText(`+1 trabajador: LUIS PRUEBA SOTO (12345678Z), alta el ${siguiente.slice(8, 10)}/${siguiente.slice(5, 7)}/${siguiente.slice(0, 4)}`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/alta-dia-dni-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Dar de alta' }).click()
  await expect(pestana.locator('[data-prueba="hecho"]')).toContainText('(12345678Z)')
  expect(hechos[0]).toMatchObject({ accion: 'alta', datos: { servicio: 'lab', nombre: 'Luis Prueba Soto', dia: siguiente, documento: '12345678Z', desde: `${siguiente.slice(0, 7)}-01` } })
  expect(errores).toEqual([])
})

test('baja con su día: se cobra hasta su mes y lo manda', async ({ page }) => {
  test.setTimeout(60_000)
  const hechos = await simular(page, 'Baja de PERSONA PRUEBA 00 el 20/11/2026: se cobra hasta noviembre.')
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('tab', { name: /^Laboral/ }).click({ timeout: 30_000 })
  await pestana.getByRole('button', { name: 'Dar de baja' }).first().click()
  const form = pestana.locator('form.formulario')
  const dia = await form.getByLabel('Día de baja').inputValue()
  await expect(form.locator('[data-prueba="previsto"]')).toContainText(`baja el ${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`)
  await form.getByRole('button', { name: 'Dar de baja' }).click()
  await expect(pestana.locator('[data-prueba="hecho"]')).toContainText('Baja hecha')
  expect(hechos[0]).toMatchObject({ accion: 'baja', datos: { dia, mes: `${dia.slice(0, 7)}-01` } })
})
