// tests/e2e/conta/gb/suelto.spec.ts
//
// GB · nº 17, B · «Trabajos fuera de la cuota» en la pestaña de Bitrix24
// (maqueta «Trabajar desde Bitrix24»), en Cuotas y cobros: «Facturar un
// trabajo» con el precio de la tarifa, el recibo nuevo antes de guardar y solo
// «Sumarlo al recibo» (lo de Code 1). Lo que contesta conta-bitrix-pestana se
// simula; la base de verdad la prueba
// supabase/staging/sql/20261110_gb_pestana_suelto_prueba.sql.

import { test, expect, type Page } from '@playwright/test'
import { respuesta, Q } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'

test('facturar un trabajo suelto: precio de la tarifa, recibo nuevo y lo ya sumado', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const pedidos: Record<string, unknown>[] = []
  let hecho = false
  const sueltos = () => ({ estado: 'ok', mes: '2026-12',
    servicios: [{ servicio_id: 'renta', nombre: 'Declaración de la renta', importe: 60, de: 'tarifa' }, { servicio_id: 'escr', nombre: 'Escritura', importe: 120, de: 'su_precio' }],
    hechos: hecho ? [{ linea_id: 'l9', concepto: 'Renta 2025 de la socia', importe: 75, mes: '2026-12', servicio: 'Declaración de la renta', recibo: null }] : [] })
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'portal') { pedidos.push(cuerpo); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', accesos: [], solicitudes: [], mensajes_sin_leer: 0, devueltos: null, sueltos: sueltos() }) }) }
    if (cuerpo.paso === 'hacer') {
      pedidos.push(cuerpo); hecho = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', frase: 'Sumado al recibo de diciembre de Cliente Prueba, S.L.: Renta 2025 de la socia, 75,00 €.',
        bitrix: { hecho: 'escrito', texto: 'Cuota mensual 571,10 € · Nota en el historial de la ficha.' }, pestana: respuesta(), deshacer: { cuando: '2026-11-10T09:00:00Z', frase: 'x' }, sueltos: sueltos() }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('tab', { name: /^Cuotas y cobros/ }).click({ timeout: 30_000 })
  const caja = pestana.getByRole('region', { name: 'Trabajos fuera de la cuota' })
  await expect(caja).toContainText('Ninguno sin cobrar.')
  // La pestaña pide los sueltos de SU empresa.
  expect(pedidos.find((x) => x.paso === 'portal')).toMatchObject({ empresa: Q })
  await caja.getByRole('button', { name: 'Facturar un trabajo' }).click()
  const form = pestana.getByRole('form', { name: 'Facturar un trabajo' })
  await expect(form.locator('input[name="importe"]')).toHaveValue('60,00')
  await expect(form.locator('[data-prueba="previsto"]')).toContainText('El recibo de diciembre pasa de 496,10 € a 556,10 € (+60,00 €).')
  await expect(form.getByRole('radio', { name: 'Sumarlo al recibo de diciembre' })).toHaveAttribute('aria-checked', 'true')
  await expect(form.getByRole('radio', { name: 'Cobrarlo aparte ahora' })).toBeDisabled()
  await form.locator('input[name="concepto"]').fill('Renta 2025 de la socia')
  await form.locator('input[name="importe"]').fill('75')
  await expect(form.locator('[data-prueba="previsto"]')).toContainText('pasa de 496,10 € a 571,10 € (+75,00 €)')
  await expect(form.locator('[data-prueba="previsto"]')).toContainText('importe cambiado a mano')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/suelto-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Facturarlo' }).click()
  const aviso = pestana.locator('[data-prueba="hecho"]')
  await expect(aviso).toContainText('Trabajo facturado')
  await expect(aviso).toContainText('Sumado al recibo de diciembre de Cliente Prueba, S.L.: Renta 2025 de la socia, 75,00 €.')
  await expect(aviso).toContainText('Bitrix24 actualizado: Cuota mensual 571,10 €')
  await expect(aviso.getByRole('button', { name: 'Deshacer' })).toBeVisible()
  await expect(caja.locator('[data-prueba="suelto"]')).toContainText('Renta 2025 de la socia')
  await expect(caja.locator('[data-prueba="suelto"]')).toContainText('En el recibo de diciembre de 2026')
  expect(pedidos.find((x) => x.paso === 'hacer')).toMatchObject({ paso: 'hacer', t: 'empresa', id: '99001', accion: 'suelto',
    datos: { empresa: Q, servicio: 'renta', concepto: 'Renta 2025 de la socia', importe: 75 } })
  expect(errores).toEqual([])
})
