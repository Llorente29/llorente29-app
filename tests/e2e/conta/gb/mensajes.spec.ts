// tests/e2e/conta/gb/mensajes.spec.ts
//
// GB · nº 17, C · «Su portal» en la pestaña de Bitrix24 (maqueta «Trabajar
// desde Bitrix24»): «Invitar a su portal» aquí mismo y los mensajes con su
// texto y «Contestar» (lo de Code 3). Lo que contesta conta-bitrix-pestana se
// simula; la base de verdad la prueba
// supabase/staging/sql/20261110_gb_pestana_mensajes_prueba.sql.

import { test, expect, type Page } from '@playwright/test'
import { respuesta } from './respuesta'

const DIR = 'docs/conta/capturas/gb'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const ALMOHADILLA = '#a=tokendeprueba0000000000&p=b24-s3mr2y.bitrix24.es&t=empresa&id=99001'

test('su portal: invitar aquí mismo, los mensajes con su texto y «Contestar»', async ({ page }) => {
  test.setTimeout(60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const hechos: Record<string, unknown>[] = []
  let invitada = false
  let contestado = false
  const accesos = () => [{ nombre: 'Persona Prueba Portal', correo: 'persona@ejemplo.test', permiso: 'todo', entro: '2026-11-05T10:00:00Z' },
    ...(invitada ? [{ nombre: 'Otra Persona Prueba', correo: 'otra@ejemplo.test', permiso: 'facturas_documentos', entro: null }] : [])]
  const mensajes = () => ({ total: contestado ? 3 : 2, lista: [
    { id: 'm1', de: 'gestoria', autor: 'Gestoría Prueba', texto: 'Te mando el modelo 303 para que lo revises.', adjuntos: 0, cuando: '2026-11-09T10:00:00Z', leido: true },
    { id: 'm2', de: 'cliente', autor: 'Persona Prueba Portal', texto: '¿Cuándo se presenta el trimestre?', adjuntos: 0, cuando: '2026-11-10T08:05:00Z', leido: contestado },
    ...(contestado ? [{ id: 'm3', de: 'gestoria', autor: 'Gestoría Prueba', texto: 'Antes del día 20.', adjuntos: 0, cuando: '2026-11-10T09:00:00Z', leido: false }] : []),
  ] })
  const portal = () => ({ estado: 'ok', accesos: accesos(), solicitudes: [], mensajes_sin_leer: contestado ? 0 : 1 })
  await page.route(/\/functions\/v1\/conta-bitrix-pestana(\?|$)/, (r) => {
    const cuerpo = r.request().postDataJSON() as Record<string, unknown>
    if (cuerpo.paso === 'portal') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...portal(), devueltos: null, sueltos: null, mensajes: mensajes() }) })
    if (cuerpo.paso === 'hacer') {
      hechos.push(cuerpo)
      if (cuerpo.accion === 'invitar') {
        invitada = true
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', frase: 'Invitada otra@ejemplo.test al portal de Cliente Prueba, S.L.: le llega el enlace por correo.', portal: portal() }) })
      }
      contestado = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok', frase: 'Mandado. Le llega un aviso de que tiene respuesta en su portal.', mensajes: mensajes(), portal: portal() }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta()) })
  })
  await page.route('https://api.bitrix24.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.BX24 = { init: (f) => f() };' }))
  await page.goto(`/bitrix-pestana.html${ALMOHADILLA}`)
  const pestana = page.locator('#pestana')
  await pestana.getByRole('tab', { name: /^Portal/ }).click({ timeout: 30_000 })
  const caja = pestana.getByRole('region', { name: 'Su portal' })
  // Los mensajes, con su texto, quién y la hora de Madrid.
  const ms = caja.getByRole('region', { name: 'Mensajes' })
  await expect(ms.locator('[data-prueba="mensaje"]')).toHaveCount(2)
  await expect(ms.locator('[data-prueba="mensaje"]').nth(1)).toContainText('¿Cuándo se presenta el trimestre?')
  await expect(ms.locator('[data-prueba="mensaje"]').nth(1)).toContainText('Persona Prueba Portal · 10/11 · 09:05')
  await expect(ms.locator('[data-prueba="mensaje"]').nth(1)).toContainText('Sin leer')
  // «Invitar a su portal»: sin un correo que valga, no se puede.
  await caja.getByRole('button', { name: 'Invitar a su portal' }).click()
  const inv = caja.getByRole('form', { name: 'Invitar a su portal' })
  await expect(inv.getByRole('button', { name: 'Invitar' })).toBeDisabled()
  await inv.locator('input[name="correo"]').fill('otra@ejemplo.test')
  await inv.locator('input[name="nombre"]').fill('Otra Persona Prueba')
  await inv.getByRole('radio', { name: 'Solo facturas y documentos' }).click()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/portal-invitar-${lado(page)}.png`, fullPage: true })
  await inv.getByRole('button', { name: 'Invitar' }).click()
  const hecho = pestana.locator('[data-prueba="hecho"]')
  await expect(hecho).toContainText('Invitación enviada')
  await expect(hecho).toContainText('Invitada otra@ejemplo.test al portal de Cliente Prueba, S.L.')
  await expect(caja).toContainText('Otra Persona Prueba')
  expect(hechos[0]).toMatchObject({ paso: 'hacer', accion: 'invitar', datos: { correo: 'otra@ejemplo.test', nombre: 'Otra Persona Prueba', permiso: 'facturas_documentos' } })
  // «Contestar».
  await ms.getByRole('button', { name: 'Contestar' }).click()
  const form = ms.getByRole('form', { name: 'Contestar' })
  await expect(form.getByRole('button', { name: 'Mandar' })).toBeDisabled()
  await form.locator('textarea').fill('Antes del día 20.')
  await page.screenshot({ path: `${DIR}/portal-contestar-${lado(page)}.png`, fullPage: true })
  await form.getByRole('button', { name: 'Mandar' }).click()
  await expect(hecho).toContainText('Respuesta mandada')
  await expect(ms.locator('[data-prueba="mensaje"]')).toHaveCount(3)
  await expect(ms.locator('[data-prueba="mensaje"]').nth(2)).toContainText('Antes del día 20.')
  await expect(ms).not.toContainText('Sin leer')
  expect(hechos[1]).toMatchObject({ paso: 'hacer', accion: 'contestar', datos: { texto: 'Antes del día 20.' } })
  expect(errores).toEqual([])
})
