/// <reference lib="dom" />
// tests/e2e/conta/s01p/correo-por-aclarar.spec.ts
//
// S01p·20 · punto 1 (Julio, 13/11) · El lector de correos no descarta en silencio
// (regla 8). Un correo de plataforma del que no salió nada queda en Documentos ›
// «Por aclarar», con el asunto del correo y el porqué en una frase, y con «Volver a
// leer» y «Subir el PDF a mano».
//
// Contra staging-conta, cuenta A. Desde la rama, la 1504 solo va en ROLLBACK a staging,
// así que la fila se AÑADE a la respuesta de conta_documentos_recibidos, con su correo y
// su asunto INVENTADOS (page.route), y «Volver a leer» contesta como lo hace la función de
// entrada. La pantalla es la de verdad; no se escribe nada.
// Con sus capturas (docs/conta/capturas/s01p20), en ordenador y en móvil.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01p20'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

const FILA = 'e2e01e0a-0000-4000-8000-0000000002a1'
const CORREO = 'e2e-s01p20-correo-0000001'
const ASUNTO = 'Fwd: Just-eat invoice: 0000001'
const PORQUE = 'No he encontrado la factura en el correo.'
const ENTRA = 'Liquidación registrada. Su factura de comisión está en «Por revisar».'

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function conElCorreo(page: Page) {
  const hoy = new Date().toISOString().slice(0, 10)
  await page.route(/\/rest\/v1\/rpc\/conta_documentos_recibidos/, async (r) => {
    const real = await r.fetch()
    const d = await real.json() as { filas: unknown[]; cifras: Record<string, number> }
    const fila = { id: FILA, tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null }, numero: null, fecha: hoy, total: null, canal: 'correo',
      confianza: null, porque: PORQUE, entendido: null, recepcion: null, asiento: null, llego: `${hoy}T08:00:00Z`, archivo: null }
    await json(r, { ...d, filas: [fila, ...d.filas], cifras: { ...d.cifras, por_aclarar: (d.cifras.por_aclarar ?? 0) + 1 } })
  })
  // El asunto lo lee la pantalla de la bandeja, por ids (leerCorreosDeLlegadas).
  await page.route(/\/rest\/v1\/document_inbox\?.*email_subject/, (r) => json(r, [{ id: FILA, email_id: CORREO, email_subject: ASUNTO }]))
  await page.route(/\/rest\/v1\/rpc\/conta_llegada_eliminable(\?|$)/, (r) => json(r, { puede: true, porque: null, archivo: null, bucket: null, ruta: null }))
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

test('«Por aclarar»: el correo sin factura con su asunto, su porqué, «Volver a leer» y «Subir el PDF a mano»; al volver a leer, lo dice', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await conElCorreo(page)
  await page.goto('/conta/documentos?ver=por-aclarar')
  // La fila: el asunto del correo y el porqué, en una frase.
  const fila = page.getByText(`«${ASUNTO}»`).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="porque-correo"]').filter({ hasText: PORQUE }).first()).toBeVisible()
  await capturar(page, 'por-aclarar-correo')

  await fila.click()
  const d = page.getByRole('dialog', { name: `«${ASUNTO}»` })
  await expect(d).toContainText(PORQUE)
  await expect(d.locator('[data-prueba="correo-sin-factura"]')).toContainText('«Volver a leer» lo pide otra vez a la entrada')
  await expect(d.getByRole('button', { name: 'Volver a leer' })).toBeVisible()
  await expect(d.getByRole('button', { name: 'Subir el PDF a mano' })).toBeVisible()
  // No tiene fichero: ni «Leerla» ni «Ver el documento».
  await expect(d.getByRole('button', { name: 'Leerla' })).toHaveCount(0)
  await expect(d.getByRole('button', { name: 'Ver el documento' })).toHaveCount(0)
  await capturar(page, 'por-aclarar-correo-acciones')

  // «Volver a leer»: pide ESE correo a la entrada (y solo ese) y dice qué ha pasado (regla 8).
  const pedidos: unknown[] = []
  await page.route(/\/functions\/v1\/conta-facturas-entrada/, (r) => {
    pedidos.push(r.request().postDataJSON())
    return json(r, { texto: `1 correo leído otra vez: ${ENTRA}`, correos: [{ emailId: CORREO, estado: 'leido', resultado: 'liquidacion', texto: ENTRA }] })
  })
  await d.getByRole('button', { name: 'Volver a leer' }).click()
  await expect(page.getByRole('status').filter({ hasText: ENTRA })).toBeVisible({ timeout: 20_000 })
  expect(pedidos).toHaveLength(1)
  expect(pedidos[0]).toMatchObject({ email_ids: [CORREO] })
  await capturar(page, 'por-aclarar-correo-releido')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  expect(errores).toEqual([])
})
