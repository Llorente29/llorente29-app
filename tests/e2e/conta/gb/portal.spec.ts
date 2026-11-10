// tests/e2e/conta/gb/portal.spec.ts
//
// GB · Segunda parte (nº 9), punto 5 · «Su portal» en la pestaña de Bitrix24
// (maqueta EnCRM2.dc.html): quién entra, lo que pide el cliente con «Hacerla»
// y los mensajes sin leer. Lo que contesta conta-bitrix-pestana se simula; la
// base de verdad la prueba supabase/staging/sql/20261109_gb_pestana_portal_prueba.sql.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'
const MES = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'

test('su portal: quién entra, lo que pide el cliente con «Hacerla» y los mensajes sin leer', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos: Record<string, unknown>[] = []
  let hecha = false
  const conPortal = () => ({ estado: 'ok',
    accesos: [{ nombre: 'Persona Prueba Portal', correo: 'persona@ejemplo.test', permiso: 'todo', entro: '2026-11-05T10:00:00Z' }],
    solicitudes: hecha ? [] : [{ id: 's1', tipo: 'alta', nombre: 'Diego Prueba Ferrer', empresa: 'emp-qbo', fecha: '2026-11-16', desde_el_portal: true }],
    mensajes_sin_leer: 1 })
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'portal') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conPortal()) })
    if (cuerpo.paso === 'hacer') {
      hechos.push(cuerpo); hecha = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok',
        frase: 'Alta de DIEGO PRUEBA FERRER en gestión laboral de Cliente Prueba, S.L. desde noviembre: 24,20 € al mes. Al cliente le sale como hecha en su portal.',
        bitrix: { hecho: 'escrito', texto: 'Cuota del mes 520,30 €' }, pestana: respuesta() }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  // nº 10 · Resumen: lo que pide el cliente sale en «Lo pendiente» y lleva a la pestaña «Portal», con su aviso.
  const pendiente = page.locator('#pestana').getByRole('region', { name: 'Lo pendiente con este cliente' })
  const pide = pendiente.locator('[data-prueba="pendiente"]', { hasText: 'Pide un alta: Diego Prueba Ferrer' })
  await expect(pide).toBeVisible({ timeout: 30_000 })
  await expect(pendiente.locator('[data-prueba="pendiente"]', { hasText: '1 mensaje sin contestar' })).toBeVisible()
  await expect(page.locator('#pestana').getByRole('tab', { name: /^Portal/ })).toHaveText('Portal2')
  await pide.getByRole('button', { name: 'Ver →' }).click()
  await expect(page.locator('#pestana').getByRole('tab', { name: /^Portal/ })).toHaveAttribute('aria-selected', 'true')
  const portal = page.locator('#pestana').getByRole('region', { name: 'Su portal' })
  await expect(portal).toContainText('Persona Prueba Portal')
  await expect(portal).toContainText('Todo')
  await expect(portal.getByRole('link', { name: 'Invitar, en Sumied ↗' })).toHaveAttribute('href', /pestana=portal$/)
  await expect(portal).toContainText('1 mensaje sin leer')
  const sol = portal.locator('[data-prueba="solicitud"]')
  await expect(sol).toHaveText(/Pide un alta: Diego Prueba Ferrer, desde el 16\/11/)
  await sol.getByRole('button', { name: 'Hacerla' }).click()
  const form = portal.getByRole('form', { name: 'Hacer lo que pide' })
  await expect(form.locator('[data-prueba="previsto"]')).toHaveText(new RegExp(`El recibo de ${MES} (pasa de 496,10 € a 520,30 € \\(\\+24,20 €\\)|no cambia: 496,10 €)\\.\\+1 trabajador: DIEGO PRUEBA FERRER, lo pide el cliente en su portal\\.`))
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/portal-hacerla-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Hacerla' }).click()
  const hecho = page.locator('#pestana [data-prueba="hecho"]')
  await expect(hecho).toContainText('Alta hecha desde la petición del portal: DIEGO PRUEBA FERRER')
  await expect(hecho).toContainText('Al cliente le sale como hecha en su portal.')
  await expect(hecho).toContainText('Bitrix24 actualizado: Cuota del mes 520,30 €')
  expect(hechos[0]).toMatchObject({ paso: 'hacer', accion: 'solicitud', datos: { solicitud: 's1', servicio: 'lab' } })
  await expect(portal.locator('[data-prueba="solicitud"]')).toHaveCount(0)
  expect(errores).toEqual([])
})
