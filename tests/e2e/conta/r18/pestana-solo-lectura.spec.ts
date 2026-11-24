/// <reference lib="dom" />
// tests/e2e/conta/r18/pestana-solo-lectura.spec.ts
//
// R18d · La pestaña de Sumied en Bitrix24 para TODAS las personas del portal, sin usuario de Sumied (Julio, 24/11).
// La función (conta-bitrix-pestana) está simulada con la forma que devuelve conta_bitrix_pestana_leer_portal; la
// base la prueba su prueba de staging, en ROLLBACK. Datos inventados (T11), como en la de la pestaña (gb/respuesta).
//   1. Sin usuario de Sumied: ve el cliente, con «Desde aquí solo se puede mirar…», sin un solo botón que cambie algo,
//      y sin pedir «Su portal» (lo que necesita usuario). Una sola lectura.
//   2. Portal aún sin unir: lo dice con su título y a quién avisar; nunca «Sin acceso a Sumied» a secas.
// Sin palabras de dentro.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from '../gb/respuesta'

const DIR = 'docs/conta/capturas/r18'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const TOKEN = 'tokendeprueba0000000000'
const ALMOHADILLA = `#a=${TOKEN}&p=crm.asesoriaqbo.es&t=empresa&id=99001`
const TECNICAS = /\b(null|undefined|NaN|token|uuid|rpc|jwt|placement|solo_lectura|portal_sin_unir|estado)\b|_[a-z]/i
const SOLO = 'Desde aquí solo se puede mirar. Para cambiar algo, entra en Sumied.'

async function simular(page: Page, contesta: Record<string, unknown>) {
  const pedidos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    pedidos.push(r.request().postDataJSON())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contesta) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: 'window.BX24 = { init: (f) => f(), installFinish: () => {}, fitWindow: () => {} };' }))
  return pedidos
}

test('sin usuario de Sumied: ve el cliente solo mirando, sin botones de cambiar y sin pedir su portal', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const pedidos = await simular(page, respuesta({ solo_lectura: true, quien: 'Persona de Bitrix24' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await expect(pestana.getByRole('heading', { level: 1, name: 'Cliente Prueba, S.L.' })).toBeVisible({ timeout: 30_000 })
  await expect(pestana.locator('[data-prueba="solo-lectura"]')).toHaveText(SOLO)
  // Lo que se ve, se ve: el recibo y los cobros.
  await expect(pestana.getByRole('region', { name: 'Recibo de diciembre de 2026' }).locator('.total')).toHaveText('496,10 €')
  await expect(pestana.getByRole('region', { name: 'Cobros' })).toBeVisible()
  // Ningún botón que cambie algo, a la vista.
  await expect(pestana.locator('button.boton:visible, .botones:visible, button.enlace:visible')).toHaveCount(0)
  // Una sola lectura: «Su portal» necesita usuario de Sumied y no se pide.
  await page.waitForTimeout(500)
  expect(pedidos.map((x) => x.paso)).toEqual(['leer'])
  expect(await pestana.innerText()).not.toMatch(TECNICAS)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/pestana-solo-lectura-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('portal aún sin unir: lo dice y a quién avisar, sin «Sin acceso a Sumied» a secas', async ({ page }) => {
  test.setTimeout(60_000)
  const frase = 'La pestaña de Sumied aún no está activada para todo este Bitrix24. Quien administra Bitrix24 tiene que reinstalar la aplicación «Sumied».'
  await simular(page, { estado: 'portal_sin_unir', frase })
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await expect(pestana.getByRole('status')).toHaveText(/No puedes ver Sumied desde aquí\s*La pestaña de Sumied aún no está activada para todo este Bitrix24\./, { timeout: 30_000 })
  expect(await pestana.innerText()).not.toMatch(/Sin acceso a Sumied/)
  expect(await pestana.innerText()).not.toMatch(TECNICAS)
  await expect(pestana.locator('.recibo, .bloque')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/pestana-sin-unir-${lado(page)}.png`, fullPage: true })
})
