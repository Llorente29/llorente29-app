// tests/e2e/conta/gb/mandato.spec.ts
//
// GB · nº 31 · El mandato SEPA en la pestaña «Sumied» de Bitrix24, en el
// ordenador y en el móvil. Un mandato en «pending_submission» ya lo ha firmado
// el cliente (va al banco con el primer cobro): la pestaña no avisa de nada y
// dice «Firmado, se envía al banco con el primer cobro». «Por firmar», con su
// aviso, solo para el que aún no ha aprobado el cliente. Lo decide el modelo de
// la ficha de Sumied (nº 90 de Code 1); aquí se mira lo que se ve.
// Lo que contesta conta-bitrix-pestana se simula (respuesta.ts), como en pestana.spec.ts.

import { test, expect, type Page } from '@playwright/test'
import { conMandato } from './respuesta'

const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'

async function abrir(page: Page, estado: string) {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message) })
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conMandato(estado)) }))
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: 'window.BX24 = { init: (f) => f(), installFinish: () => {}, fitWindow: () => {} };' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await expect(pestana.getByRole('heading', { level: 1, name: 'Cliente Prueba, S.L.' })).toBeVisible({ timeout: 30_000 })
  return { pestana, errores }
}

test('pending_submission: sin aviso, y «Mandato: Firmado, se envía al banco con el primer cobro»', async ({ page }) => {
  test.setTimeout(60_000)
  const { pestana, errores } = await abrir(page, 'pending_submission')
  await expect(pestana).toContainText('Firmado, se envía al banco con el primer cobro')
  await expect(pestana).not.toContainText('sin firmar')
  await expect(pestana).not.toContainText('En curso')
  await expect(pestana).not.toContainText('Por firmar')
  await expect(pestana.locator('.aviso')).toHaveCount(0)
  expect(errores).toEqual([])
})

test('pending_customer_approval: «Por firmar», con su aviso', async ({ page }) => {
  test.setTimeout(60_000)
  const { pestana, errores } = await abrir(page, 'pending_customer_approval')
  await expect(pestana).toContainText('Por firmar')
  await expect(pestana.locator('.aviso')).toContainText('El mandato SEPA está sin firmar')
  expect(errores).toEqual([])
})
