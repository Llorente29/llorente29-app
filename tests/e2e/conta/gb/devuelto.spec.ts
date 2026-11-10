// tests/e2e/conta/gb/devuelto.spec.ts
//
// GB · nº 17, A · El recibo devuelto en la pestaña de Bitrix24 (maqueta
// «Trabajar desde Bitrix24»): en Resumen y en Cuotas y cobros, con
// «Enviarle el enlace para pagar» y «Que lo pasen de nuevo» (lo de Code 1). Lo
// que contesta conta-bitrix-pestana se simula; la base de verdad la prueba
// supabase/staging/sql/20261110_gb_pestana_devuelto_prueba.sql.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'

test('el recibo devuelto: lo que se puede hacer, por qué no, y «Que lo pasen de nuevo»', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos: Record<string, unknown>[] = []
  let pasado = false
  const devueltos = () => ({ puede: true, lista: pasado ? [] : [{ recibo: 'r-oct', mes: '2026-10', importe_cent: 49610, estado: 'devuelto',
    enlace: { puede: false, porque: 'Nadie de este cliente puede pagar en su espacio: invítalo primero.' }, pasar: { puede: true, porque: null } }] })
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'portal') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', accesos: [], solicitudes: [], mensajes_sin_leer: 0, devueltos: devueltos() }) })
    if (cuerpo.paso === 'hacer') {
      hechos.push(cuerpo); pasado = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', frase: 'Pasado de nuevo en GoCardless, para el 14/11/2026. Cliente Prueba, S.L.: 496,10 €.',
        bitrix: { hecho: 'escrito', texto: 'Estado del cobro En curso · Nota en el historial de la ficha.' }, pestana: respuesta(), devueltos: devueltos() }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  // Resumen: el recuadro, con lo que se puede y por qué no.
  const caja = pestana.getByRole('region', { name: 'Recibo devuelto' })
  await expect(caja).toContainText('RECIBO DEVUELTO', { timeout: 30_000 })
  await expect(caja.locator('[data-prueba="devuelto"]')).toContainText('Octubre de 2026 · 496,10 € · devuelto')
  await expect(caja.getByRole('button', { name: 'Enviarle el enlace para pagar' })).toBeDisabled()
  await expect(caja).toContainText('Nadie de este cliente puede pagar en su espacio: invítalo primero.')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/devuelto-${lado(page)}.png`, fullPage: true })
  // «Resolver →» lleva a Cuotas y cobros, donde está también.
  await pestana.getByRole('region', { name: 'Lo pendiente con este cliente' }).getByRole('button', { name: 'Resolver →' }).first().click()
  await expect(pestana.getByRole('tab', { name: /^Cuotas y cobros/ })).toHaveAttribute('aria-selected', 'true')
  await pestana.getByRole('region', { name: 'Recibo devuelto' }).getByRole('button', { name: 'Que lo pasen de nuevo' }).click()
  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('Se pasa de nuevo')
  await expect(hecho).toContainText('Pasado de nuevo en GoCardless, para el 14/11/2026.')
  await expect(hecho).toContainText('Bitrix24 actualizado: Estado del cobro En curso')
  await expect(pestana.getByRole('region', { name: 'Recibo devuelto' })).toHaveCount(0)
  expect(hechos[0]).toMatchObject({ paso: 'hacer', t: 'empresa', id: '99001', accion: 'devuelto', datos: { recibo: 'r-oct', que: 'pasar' } })
  expect(errores).toEqual([])
})
