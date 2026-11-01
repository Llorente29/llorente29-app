/// <reference lib="dom" />
// tests/e2e/conta/b01/revolut.spec.ts
//
// B01 Revolut · El asistente «Conectar Revolut Business», en staging-conta,
// cuenta B, en ordenador (1440) y móvil (390), HASTA ANTES DE AUTORIZAR: lo que
// no necesita la cuenta de pruebas del sandbox (eso va en la e2e con el sandbox,
// con la conexión que autoriza Julio una vez).
//   1. Bancos › Cuentas y extractos: la tarjeta de Revolut, «Conectar Revolut».
//   2. Paso 1: el certificado PÚBLICO que ha hecho Sumied (la privada no sale).
//   3. Paso 2: la dirección de vuelta de la marca (app.sumied.com) y el Client
//      ID. Pegar el certificado en su sitio lo dice con palabras normales.
//   4. Paso 3: «Autorizar en Revolut», y la página que se abriría es la del
//      SANDBOX (staging no habla con producción, W10) y pide READ y WRITE,
//      nunca PAY (respuesta 5).
// La e2e corre en 127.0.0.1: la función solo acepta las direcciones de las
// marcas, así que la prueba entra como si fuera app.sumied.com (cambia el
// «origen» de la llamada). Al acabar, DESCONECTA: sin secretos ni conexión a
// medias en staging.
//
// Cuenta B y no A (01/11): la empresa A guarda la conexión de verdad con el
// sandbox, la que autoriza Julio una vez y usan las e2e de leer y de pagar.
// Esta prueba desconecta al empezar y al acabar: en A se la llevaría.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { CUENTA_B, STAGING_URL, anonKey, enCarril, entrarComo, pedirSesion } from '../sesion'
import { conLimpieza } from './datos'

const DIR = 'docs/conta/capturas/b01-revolut'
const ORIGEN_MARCA = 'https://app.sumied.com'
const CLIENT_ID = 'clientidinventadoe2e01'
/** La empresa de la cuenta B («Cocina de Prueba Sur»). */
const EMPRESA_B = enCarril('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
}

/** La función solo acepta las direcciones de las marcas: la prueba entra como app.sumied.com. */
async function comoLaMarca(page: Page) {
  await page.route('**/functions/v1/conta-revolut-conectar', async (route) => {
    const r = route.request()
    if (r.method() !== 'POST') return route.continue()
    const b = JSON.parse(r.postData() ?? '{}') as Record<string, unknown>
    if ('origen' in b) b.origen = ORIGEN_MARCA
    await route.continue({ postData: JSON.stringify(b) })
  })
}

async function clienteDeB() {
  const sesion = await pedirSesion(CUENTA_B.email)
  return createClient(STAGING_URL, anonKey(), { global: { headers: { Authorization: `Bearer ${sesion.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}

async function desconectar() {
  const cliente = await clienteDeB()
  const { data } = await cliente.from('revolut_conexion').select('estado').eq('company_id', EMPRESA_B).maybeSingle()
  if (!data || !['certificado', 'autorizar', 'conectada'].includes(String(data.estado))) return
  const { error } = await cliente.functions.invoke('conta-revolut-conectar', { body: { accion: 'desconectar', empresa: EMPRESA_B } })
  if (error) throw new Error(`No se ha podido desconectar Revolut al acabar: ${error.message}`)
}

test.describe('B01 Revolut · el asistente, hasta autorizar', () => {
  test.describe.configure({ timeout: 180_000 })
  // Cada acción, con su límite: sin él, un elemento que no aparece cuelga la prueba hasta el final (01/11).
  test.use({ actionTimeout: 20_000 })

  test('certificado, vuelta, Client ID y la página del sandbox con READ y WRITE', async ({ page }) => {
    await desconectar()
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_B.email)
      await comoLaMarca(page)
      await page.goto('/conta/bancos/cuentas')
      const tarjeta = page.locator('[data-prueba="revolut"]')
      await expect(tarjeta).toContainText('Revolut Business')
      await tarjeta.getByRole('button', { name: 'Conectar Revolut' }).click()

      // 1 · El certificado público.
      const dialogo = page.getByRole('dialog', { name: 'Conectar Revolut Business' })
      await expect(dialogo.getByRole('heading', { name: 'Copia este certificado' })).toBeVisible()
      const cert = dialogo.locator('[data-prueba="certificado"]')
      await expect(cert).toContainText('BEGIN CERTIFICATE', { timeout: 30_000 })
      await expect(cert).not.toContainText('PRIVATE')
      await expect(dialogo.locator('[aria-current="step"]')).toContainText('1 · Copia el certificado')
      await capturar(page, '1-certificado')
      // El texto, aquí: en el paso 2 el certificado ya no se enseña (y esperarlo colgaría la prueba).
      const textoDelCertificado = (await cert.textContent({ timeout: 10_000 })) ?? '-----BEGIN CERTIFICATE-----'
      await dialogo.getByRole('button', { name: 'Seguir' }).click()

      // 2 · La dirección de vuelta de la marca y el Client ID.
      await expect(dialogo.locator('[data-prueba="vuelta"]')).toHaveText(`${ORIGEN_MARCA}/bancos/revolut/vuelta`)
      const campo = dialogo.locator('[data-prueba="client-id"]')
      await campo.fill(textoDelCertificado)
      await dialogo.getByRole('button', { name: 'Seguir' }).click()
      await expect(dialogo.getByRole('alert')).toContainText('Eso es el certificado, no el Client ID.')
      await capturar(page, '2-client-id-equivocado')
      await campo.fill(CLIENT_ID)
      const respuesta = page.waitForResponse((r) => r.url().includes('conta-revolut-conectar') && (r.request().postData() ?? '').includes('"client_id"'), { timeout: 30_000 })
      await dialogo.getByRole('button', { name: 'Seguir' }).click()
      const cuerpo = await (await respuesta).json() as { ok: boolean; url?: string; texto?: string }
      expect(cuerpo.ok, cuerpo.texto).toBe(true)

      // 3 · Autorizar: el sandbox, con READ y WRITE, nunca PAY.
      const u = new URL(String(cuerpo.url))
      expect(u.origin).toBe('https://sandbox-business.revolut.com')
      expect(u.searchParams.get('scope')).toBe('READ,WRITE')
      expect(u.searchParams.get('scope')).not.toMatch(/PAY/)
      expect(u.searchParams.get('client_id')).toBe(CLIENT_ID)
      expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGEN_MARCA}/bancos/revolut/vuelta`)
      await expect(dialogo.getByRole('button', { name: 'Autorizar en Revolut' })).toBeVisible()
      await expect(dialogo).toContainText('No puede pagar')
      await capturar(page, '3-autorizar')
    }, desconectar)
  })
})
