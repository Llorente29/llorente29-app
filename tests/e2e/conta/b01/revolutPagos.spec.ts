/// <reference lib="dom" />
// tests/e2e/conta/b01/revolutPagos.spec.ts
//
// B01 Revolut · PR 2c-1 · ACTIVAR Y DEJAR DE PAGAR, en staging-conta, cuenta B,
// en ordenador (1440) y móvil (390). Las pantallas de verdad contra las
// respuestas de la base y de las funciones INTERCEPTADAS: esta prueba no
// conecta nada en staging, no manda correos y no pasa por Revolut (la página de
// autorizar se sustituye). Lo de verdad con el sandbox va en la e2e de pagar,
// con la conexión que autoriza Julio una vez.
//   1. Conectada para leer: «Pagos · puede leer · aún no paga» y «Activar pagos».
//   2. El asistente: paso 1 sin llave ni PIN no deja seguir; crear el PIN con el
//      código del correo; paso 2 los topes; paso 3 lleva a Revolut con
//      READ, WRITE y PAY.
//   3. La vuelta con PAY: el aviso con quién paga y los topes, sin abrir «ligar».
//   4. «Dejar de pagar»: dice qué hace en Sumied y en Revolut; lleva a Revolut
//      con READ y WRITE, sin PAY.
//   5. Cancelado en Revolut: «En Sumied ya están quitados los pagos…» y el
//      botón «Quitar el permiso en Revolut».
// Todo inventado (T11).

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_B, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/b01-revolut'
const REVOLUT = 'https://sandbox-business.revolut.com'
const ESTADO = 'e'.repeat(64)
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
}

interface Mundo { permisos: string; oauthPara: string | null; pin: boolean; pagan: string[]; llamadas: Record<string, unknown>[] }

const json = (route: Route, cuerpo: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

/** La base y las funciones, interceptadas: lo que contestarían, sin tocar staging. */
async function interceptar(page: Page, m: Mundo) {
  await page.route('**/rest/v1/revolut_conexion?*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const fila = { estado: 'conectada', entorno: 'sandbox', certificado: '-----BEGIN CERTIFICATE-----', vuelta: 'https://app.sumied.com/bancos/revolut/vuelta',
      desde_historico: '2026-08-01', conectada_at: '2026-10-31T10:00:00Z', conectada_por_nombre: 'Persona Prueba', last_ok_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      last_error: null, permisos: m.permisos, oauth_para: m.oauthPara }
    const objeto = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
    await json(route, objeto ? fila : [fila])
  })
  await page.route('**/rest/v1/rpc/conta_pago_quien', (route) => json(route, { yo_puedo: m.pagan.length > 0, soy_admin: true, n: m.pagan.length, segunda: 'la_misma',
    personas: m.pagan.map((nombre) => ({ nombre, yo: true })) }))
  await page.route('**/rest/v1/rpc/conta_llaves_mias', (route) => json(route, []))
  await page.route('**/rest/v1/rpc/conta_pago_pin_mio', (route) => json(route, { tiene: m.pin, bloqueado: false, quedan: m.pin ? 5 : null }))
  await page.route('**/rest/v1/rpc/conta_pago_topes', (route) => json(route, { tope_pago: 3000, tope_dia: 10000, aprobado_hoy: 0 }))
  await page.route('**/functions/v1/conta-pagar', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    m.llamadas.push({ funcion: 'conta-pagar', ...b, pin: b.pin ? '······' : undefined })
    if (b.accion === 'codigo_pedir') return json(route, { ok: true, reto: '00000000-0000-4000-8000-0000000000aa', texto: 'Te hemos mandado un código a p•••@ejemplo.test. Vale 10 minutos y una sola vez.' })
    if (b.accion === 'codigo_usar') return json(route, { ok: true, texto: 'Código bueno.' })
    if (b.accion === 'pin_crear') { m.pin = true; return json(route, { ok: true, texto: 'PIN de pago guardado. Lo usarás cuando no tengas tu llave a mano.' }) }
    return json(route, { ok: false, texto: 'No interceptado.' })
  })
  await page.route('**/functions/v1/conta-revolut-conectar', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    m.llamadas.push({ funcion: 'conta-revolut-conectar', ...b })
    const autorizar = (scope: string) => `${REVOLUT}/app-confirm?client_id=inventado&redirect_uri=x&response_type=code&scope=${encodeURIComponent(scope)}&state=${ESTADO}`
    if (b.accion === 'activar_pagos') { m.oauthPara = 'activar_pagos'; return json(route, { ok: true, url: autorizar('READ,WRITE,PAY') }) }
    if (b.accion === 'vuelta' && m.oauthPara === 'activar_pagos') {
      m.permisos = 'READ,WRITE,PAY'; m.oauthPara = null; m.pagan = ['Persona Prueba']
      return json(route, { ok: true, pagos: true, personas: m.pagan, texto: 'Pagos activados con Revolut. Puede pagar: Persona Prueba. Topes: 3.000 € por pago y 10.000 € al día.' })
    }
    if (b.accion === 'dejar_de_pagar') {
      m.permisos = 'READ,WRITE'; m.oauthPara = 'dejar_de_pagar'; m.pagan = []
      const frase = 'Ya no se puede pagar con Revolut desde Sumied. Quitado el permiso de pagar a 1 persona.'
      return json(route, { ok: true, frase, texto: frase, url: autorizar('READ,WRITE') })
    }
    if (b.accion === 'cancelada' && m.oauthPara === 'dejar_de_pagar') {
      return json(route, { ok: false, texto: 'En Sumied ya están quitados los pagos: nadie puede pagar con Revolut desde aquí. En Revolut no has cambiado el permiso: para quitárselo también allí, vuelve a pulsar «Quitar el permiso en Revolut».' })
    }
    return json(route, { ok: false, texto: 'No interceptado.' })
  })
  // La página de autorizar de Revolut no se abre: se sustituye por una vacía.
  await page.route(`${REVOLUT}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Revolut (sustituida)</title><p>Revolut</p>' }))
}

test.describe('B01 Revolut · activar y dejar de pagar', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('activar pagos, la vuelta con PAY, dejar de pagar y cancelar en Revolut', async ({ page }) => {
    const m: Mundo = { permisos: 'READ,WRITE', oauthPara: null, pin: false, pagan: [], llamadas: [] }
    await entrarComo(page, CUENTA_B.email)
    await interceptar(page, m)

    // 1 · Conectada para leer.
    await page.goto('/conta/bancos/cuentas')
    const pagos = page.locator('[data-prueba="revolut-pagos"]')
    await expect(pagos).toContainText('Pagos · puede leer · aún no paga')
    await capturar(page, 'p1-aun-no-paga')

    // 2 · El asistente.
    await pagos.getByRole('button', { name: 'Activar pagos' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Activar pagos con Revolut' })
    await expect(dialogo.locator('[aria-current="step"]')).toContainText('1 · Tu llave y tu PIN')
    await expect(dialogo).toContainText('Sumied nunca paga solo.')
    await expect(dialogo).toContainText('Hace falta al menos uno de los dos.')
    await expect(dialogo.getByRole('button', { name: 'Seguir', exact: true })).toBeDisabled()
    await capturar(page, 'p2-sin-llave-ni-pin')
    await dialogo.locator('[data-prueba="tu-llave-y-pin"]').getByRole('button', { name: 'Crear' }).click()
    await expect(dialogo.getByRole('status').filter({ hasText: 'Te hemos mandado un código' })).toBeVisible()
    await dialogo.locator('[data-prueba="codigo"] input').fill('000000')
    await dialogo.locator('[data-prueba="codigo"]').getByRole('button', { name: 'Seguir' }).click()
    const pinNuevo = dialogo.locator('[data-prueba="pin-nuevo"]')
    await pinNuevo.locator('input').nth(0).fill('123456')
    await pinNuevo.locator('input').nth(1).fill('123456')
    await pinNuevo.getByRole('button', { name: 'Guardar el PIN' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('No sirven cifras seguidas, como 123456.')
    await pinNuevo.locator('input').nth(0).fill('407219')
    await pinNuevo.locator('input').nth(1).fill('407219')
    await pinNuevo.getByRole('button', { name: 'Guardar el PIN' }).click()
    await expect(dialogo.getByRole('status').filter({ hasText: 'PIN de pago guardado' })).toBeVisible()
    await expect(dialogo.locator('[data-prueba="tu-llave-y-pin"]')).toContainText('creado · 6 cifras')
    await dialogo.getByRole('button', { name: 'Seguir', exact: true }).click()
    await expect(dialogo.locator('[aria-current="step"]')).toContainText('2 · Topes y quién paga')
    await expect(dialogo).toContainText('3.000 € por pago y 10.000 € al día')
    await capturar(page, 'p3-topes')
    await dialogo.getByRole('button', { name: 'Seguir', exact: true }).click()
    await expect(dialogo).toContainText('«Pagar» (PAY)')
    await capturar(page, 'p4-autorizar-pagos')
    await dialogo.getByRole('button', { name: 'Autorizar en Revolut' }).click()
    await page.waitForURL(`${REVOLUT}/**`)
    expect(new URL(page.url()).searchParams.get('scope')).toBe('READ,WRITE,PAY')

    // 3 · La vuelta con PAY: el aviso, sin «ligar».
    await page.goto(`/conta/bancos/cuentas?revolut_code=codigo-inventado&revolut_state=${ESTADO}`)
    const tarjeta = page.locator('[data-prueba="revolut"]')
    await expect(tarjeta.getByRole('status').filter({ hasText: 'Pagos activados con Revolut. Puede pagar: Persona Prueba.' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pagos).toContainText('Pagos · lee y paga · puede pagar: Persona Prueba')
    await expect(pagos.getByRole('button', { name: 'Topes y permisos' })).toBeVisible()
    await capturar(page, 'p5-lee-y-paga')

    // 4 · Dejar de pagar.
    await pagos.getByRole('button', { name: 'Dejar de pagar' }).click()
    const dejar = page.getByRole('dialog', { name: '¿Dejar de pagar con Revolut?' })
    await expect(dejar).toContainText('Primero, en Sumied y al momento:')
    await expect(dejar).toContainText('solo leer (READ y WRITE)')
    await capturar(page, 'p6-dejar-de-pagar')
    await dejar.getByRole('button', { name: 'Dejar de pagar' }).click()
    await page.waitForURL(`${REVOLUT}/**`)
    expect(new URL(page.url()).searchParams.get('scope')).toBe('READ,WRITE')
    expect(m.llamadas.some((x) => x.accion === 'dejar_de_pagar')).toBe(true)

    // 5 · Cancelado en Revolut: en Sumied ya está quitado, y se dice.
    await page.goto(`/conta/bancos/cuentas?revolut_error=access_denied&revolut_state=${ESTADO}`)
    await expect(tarjeta.getByRole('alert').filter({ hasText: 'En Sumied ya están quitados los pagos' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pagos).toContainText('Revolut aún tiene el permiso de pagar')
    await expect(pagos.getByRole('button', { name: 'Quitar el permiso en Revolut' })).toBeVisible()
    await capturar(page, 'p7-cancelado-en-revolut')
    expect(m.llamadas.some((x) => x.accion === 'cancelada' && x.state === ESTADO)).toBe(true)
  })
})
