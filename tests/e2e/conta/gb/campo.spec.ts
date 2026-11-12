// tests/e2e/conta/gb/campo.spec.ts
//
// GBc · PRUEBA · El campo fijo «Cuota mensual (Sumied)» que Bitrix24 dibuja con
// la página de Sumied (bitrix-campo.html), en el ordenador y en el móvil.
//   1. Viendo: el importe guardado enseguida y, cuando contesta Sumied, lo de Sumied. Sin enlace.
//   2. Editando: «150,00 € · Cambiar en Sumied», sin caja para escribir; el enlace abre
//      Sumied (BX24.openApplication) con la empresa.
//   3. Sin datos de Bitrix24 (abierta a mano): lo guardado y nada más, sin llamar a Sumied.
// Lo que contesta conta-bitrix-pestana y el SDK de Bitrix24 se simulan (como en pestana.spec.ts).

import { test, expect, type Page } from '@playwright/test'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const DATOS = 'a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&id=12'

async function simular(page: Page, valor: string | null) {
  const pedidos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, async (r) => {
    pedidos.push(r.request().postDataJSON())
    await new Promise((f) => setTimeout(f, 300))
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', valor, hecho: 'nada' }) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: 'window.__bx = []; window.BX24 = { init: (f) => f(), fitWindow: () => window.__bx.push(["fitWindow"]), openApplication: (p) => window.__bx.push(["openApplication", p]) };' }))
  return pedidos
}

test('viendo: lo guardado enseguida y, al contestar Sumied, lo de Sumied; sin enlace ni caja', async ({ page }) => {
  const pedidos = await simular(page, '160,00 €')
  await page.goto(`/bitrix-campo.html#m=view&v=${encodeURIComponent('150,00 €')}&${DATOS}`)
  const campo = page.locator('#campo')
  await expect(campo.locator('[data-prueba=valor]')).toHaveText('150,00 €')
  await expect(campo.locator('[data-prueba=valor]')).toHaveText('160,00 €')
  await expect(campo.getByRole('link')).toHaveCount(0)
  await expect(page.locator('input, textarea, [contenteditable]')).toHaveCount(0)
  expect(pedidos).toEqual([{ paso: 'campo', a: 'tokendeprueba0000000000', p: 'b24-s3mr2y.bitrix24.es', id: '12' }])
  expect(page.url()).not.toContain('tokendeprueba')
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 36 })
  await campo.screenshot({ path: `${DIR}/gbc-campo-viendo-${lado(page)}.png` })
})

test('editando: «150,00 € · Cambiar en Sumied», sin caja para escribir, y el enlace abre Sumied con la empresa', async ({ page }) => {
  await simular(page, '150,00 €')
  await page.goto(`/bitrix-campo.html#m=edit&v=${encodeURIComponent('150,00 €')}&${DATOS}`)
  const campo = page.locator('#campo')
  await expect(campo).toHaveText('150,00 € · Cambiar en Sumied')
  await expect(page.locator('input, textarea, [contenteditable]')).toHaveCount(0)
  await expect(campo.getByRole('link', { name: 'Cambiar en Sumied' })).toHaveCSS('color', 'rgb(32, 103, 176)')
  await campo.getByRole('link', { name: 'Cambiar en Sumied' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bx: unknown[] }).__bx.filter((x) => (x as unknown[])[0] === 'openApplication')))
    .toEqual([['openApplication', { ID: '12', TIPO: 'empresa' }]])
  await campo.screenshot({ path: `${DIR}/gbc-campo-editando-${lado(page)}.png` })
})

test('abierta a mano, sin datos de Bitrix24: lo guardado y nada más', async ({ page }) => {
  const pedidos = await simular(page, '160,00 €')
  await page.goto('/bitrix-campo.html#m=view&v=')
  await expect(page.locator('[data-prueba=valor]')).toHaveText('Sin cuota')
  await page.waitForTimeout(500)
  expect(pedidos).toEqual([])
})
