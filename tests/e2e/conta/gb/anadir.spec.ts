// tests/e2e/conta/gb/anadir.spec.ts
//
// GB · nº 17, G · «+ Añadir servicio o paquete» en la pestaña de Bitrix24
// (maqueta «Trabajar desde Bitrix24»), en Cuotas y cobros, con la función de la
// ficha del G04 (conta_tarifa_servicio_anadir): qué y desde cuándo, el recibo
// nuevo antes de guardar y la confirmación con «Deshacer». Lo que contesta
// conta-bitrix-pestana se simula; la base de verdad la prueba
// supabase/staging/sql/20261110_gb_pestana_anadir_prueba.sql.

import { test, expect, type Page } from '@playwright/test'
import { conNiveles, Q } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'
const MES = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'

test('añadir un servicio con su nivel: el recibo nuevo antes de guardar y la confirmación', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos: Record<string, unknown>[] = []
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'portal') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', accesos: [], solicitudes: [], mensajes_sin_leer: 0 }) })
    if (cuerpo.paso === 'hacer') {
      hechos.push(cuerpo)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok',
        frase: 'Añadido Gestoría mensual · Premium para Cliente Prueba, S.L. desde diciembre de 2026, a precio de tarifa.',
        bitrix: { hecho: 'escrito', texto: 'Cuota mensual 735,60 € · Nota en el historial de la ficha.' }, pestana: conNiveles(), deshacer: { cuando: '2026-11-10T10:00:00Z', frase: 'x' } }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conNiveles()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('tab', { name: /^Cuotas y cobros/ }).click({ timeout: 30_000 })
  const servicios = pestana.getByRole('region', { name: 'Servicios que tiene' })
  await servicios.getByRole('button', { name: '+ Añadir servicio o paquete' }).click()
  const form = servicios.getByRole('form', { name: 'Añadir servicio o paquete' })
  await form.locator('select[name="que"]').selectOption({ label: 'Gestoría mensual · Premium' })
  await expect(form.locator('[data-prueba="previsto"]')).toHaveText(new RegExp(`El recibo de ${MES} pasa de 585,60 € a 735,60 € \\(\\+150,00 €\\)\\.\\+ Gestoría mensual · Premium, a precio de tarifa, desde ${MES}\\.`))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/anadir-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Añadirlo' }).click()
  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('Añadido: Gestoría mensual · Premium')
  await expect(hecho).toContainText('a precio de tarifa.')
  await expect(hecho).toContainText('Bitrix24 actualizado: Cuota mensual 735,60 €')
  await expect(hecho.getByRole('button', { name: 'Deshacer' })).toBeVisible()
  expect(hechos[0]).toMatchObject({ paso: 'hacer', t: 'empresa', id: '99001', accion: 'servicio',
    datos: { empresa: Q, servicio: 'ges', nivel: 'premium', paquete: null, ensayo: false } })
  expect(String((hechos[0].datos as { desde: string }).desde)).toMatch(/^\d{4}-\d{2}-01$/)
  expect(errores).toEqual([])
})
