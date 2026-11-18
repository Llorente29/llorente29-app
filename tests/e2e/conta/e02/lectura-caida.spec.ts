/// <reference lib="dom" />
// tests/e2e/conta/e02/lectura-caida.spec.ts
//
// E02 · La lectura caída se ve: la franja de arriba en Documentos y en Facturas
// recibidas, y la ventana de una llegada sin leer con la frase de su clase.
// Contra staging-conta, cuenta A, a 1456 × 816 y en móvil.
//
//   · Sin caída: conta_lectura_estado DE VERDAD (la 20261118T0600 solo añade y va
//     de verdad a staging desde la rama, W05) dice que no y no hay franja.
//   · Con caída: la respuesta de conta_lectura_estado y una llegada sin leer de
//     clase «caída» se AÑADEN (page.route), como en s01g/soporte. No se siembra en
//     la base a propósito: la caída es común a todas las cuentas, y una de verdad en
//     staging pintaría la franja en las e2e de las otras ramas mientras dura esta.
//     Desde la rama, además, una e2e no puede escribir en document_inbox.
//   · La ventana: «este documento» y «caída», según document_inbox.read_failure;
//     y «Leerla» con la lectura caída dice su frase, nunca «non-2xx».
// Las capturas van a docs/conta/capturas/e02/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/e02'
const json = (r: Route, cuerpo: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1456) < 768 ? 'movil' : '1456')

const FRASE_CAIDA = 'Ahora mismo no puedo leer facturas. No has perdido ninguna: están guardadas. Cuando vuelva, léelas con «Leerla».'
const FRASE_DOCUMENTO = 'No he podido leer este documento. Escríbelo tú con el PDF al lado, o pulsa «Leerla» otra vez.'
const CAIDA = 'e2e0e020-0000-4000-8000-000000000001'
const DOCUMENTO = 'e2e0e020-0000-4000-8000-000000000002'
const llegada = (id: string, archivo: string, porque: string) => ({
  id, tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null }, numero: null, fecha: '2026-11-17', total: null, canal: 'correo', confianza: null,
  porque, entendido: null, recepcion: null, asiento: null, llego: '2026-11-17T18:18:00Z', archivo,
})
const FILAS = [
  llegada(CAIDA, 'factura-caida-inventada.pdf', 'No se ha podido leer: en ese momento no se podía leer ninguna factura. Está guardada.'),
  // Una de antes del E02, con el texto técnico de entonces: la ventana no lo enseña.
  llegada(DOCUMENTO, 'factura-cortada-inventada.pdf', 'No se ha podido leer: La IA no devolvió un albarán legible'),
]

async function ponerElTamano(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 768) await page.setViewportSize({ width: 1456, height: 816 })
}

async function conLecturaCaida(page: Page, esperando = 12) {
  await page.route(/\/rest\/v1\/rpc\/conta_lectura_estado(\?|$)/, (r) => json(r, { caida: true, esperando }))
  await page.route(/\/rest\/v1\/rpc\/conta_documentos_recibidos(\?|$)/, async (r) => {
    const real = await r.fetch()
    const d = await real.json() as { filas: unknown[]; cifras: Record<string, number> }
    await json(r, { ...d, filas: [...FILAS, ...d.filas] })
  })
  // La clase de cada llegada inventada: la de «caída» la tiene; la de antes del E02, no.
  await page.route(/\/rest\/v1\/document_inbox\?.*select=read_failure/, (r) => {
    const u = decodeURIComponent(r.request().url())
    return json(r, u.includes(CAIDA) ? [{ read_failure: 'caida' }] : [{ read_failure: null }])
  })
  // «Leerla» busca antes su fichero.
  await page.route(/\/rest\/v1\/document_inbox\?.*select=file_path/, (r) => json(r, [{ file_path: 'cuenta-prueba/_correo/prueba/01-factura-caida-inventada.pdf' }]))
  await page.route(/\/rest\/v1\/rpc\/conta_llegada_eliminable(\?|$)/, (r) => json(r, { puede: false, porque: 'es una llegada inventada de la prueba.' }))
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: lado(page) === 'movil' })
}

test.describe('E02 · la lectura caída se ve', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('sin caída no hay franja (conta_lectura_estado de verdad)', async ({ page }) => {
    await ponerElTamano(page)
    await entrarComo(page, CUENTA_A.email)
    const respuesta = page.waitForResponse(/\/rest\/v1\/rpc\/conta_lectura_estado/)
    await page.goto('/conta/documentos')
    await expect(page.getByRole('heading', { name: 'Facturas recibidas', level: 1 })).toBeVisible()
    const r = await respuesta
    expect(r.status(), 'conta_lectura_estado existe en staging y contesta').toBe(200)
    expect(await r.json()).toMatchObject({ caida: false })
    await expect(page.locator('[data-prueba="aviso-lectura-caida"]')).toHaveCount(0)
  })

  test('con la lectura caída: la franja arriba en Facturas recibidas y en Documentos', async ({ page }) => {
    await ponerElTamano(page)
    await entrarComo(page, CUENTA_A.email)
    await conLecturaCaida(page)
    await page.goto('/conta/documentos')
    await expect(page.getByRole('heading', { name: 'Facturas recibidas', level: 1 })).toBeVisible()
    const franja = page.locator('[data-prueba="aviso-lectura-caida"]')
    await expect(franja).toHaveText(`${FRASE_CAIDA} Van 12 esperando.`)
    // Sin aspa ni botón, y debajo del encabezado.
    await expect(franja.locator('button')).toHaveCount(0)
    const cabeza = await page.getByRole('heading', { name: 'Facturas recibidas', level: 1 }).boundingBox()
    const caja = await franja.boundingBox()
    expect(caja!.y).toBeGreaterThan(cabeza!.y)
    // En el móvil no se queda fija: al bajar, se va con la página.
    if (lado(page) === 'movil') expect(await franja.evaluate((e) => getComputedStyle(e).position)).not.toMatch(/fixed|sticky/)
    await capturar(page, 'facturas-recibidas-caida')

    await page.goto('/conta/inicio/documentos')
    await expect(page.getByRole('heading', { name: 'Documentos', level: 1 })).toBeVisible()
    await expect(page.locator('[data-prueba="aviso-lectura-caida"]')).toHaveText(`${FRASE_CAIDA} Van 12 esperando.`)
    await capturar(page, 'documentos-caida')
  })

  test('la ventana de una llegada sin leer: la frase de su clase, nunca «albarán» ni «non-2xx»', async ({ page }) => {
    await ponerElTamano(page)
    await entrarComo(page, CUENTA_A.email)
    await conLecturaCaida(page)
    await page.goto('/conta/documentos?ver=por-aclarar')
    // La de clase «caída».
    await page.getByText('«factura-caida-inventada.pdf»').first().click()
    let d = page.getByRole('dialog', { name: '«factura-caida-inventada.pdf»' })
    await expect(d).toContainText(FRASE_CAIDA)
    await expect(d).not.toContainText(/albar[aá]n|non-2xx|Edge Function/)
    await capturar(page, 'ventana-caida')
    // «Leerla» con la lectura caída: la función contesta 502 con su clase; la ventana dice la frase.
    await page.route(/\/functions\/v1\/ocr-albaran/, (r) => r.request().method() === 'OPTIONS' ? r.fallback()
      : json(r, { error: 'Error del servicio de IA', clase: 'caida', causa: 'tope_gasto', sesion_fallo: null }, 502))
    await d.getByRole('button', { name: 'Leerla' }).click()
    await expect(d.getByRole('alert')).toHaveText(FRASE_CAIDA)
    await expect(d).not.toContainText(/non-2xx|Edge Function/)
    await capturar(page, 'ventana-leerla-caida')
    await page.keyboard.press('Escape')
    // La de antes del E02, con «albarán» en su porqué: la frase de «este documento».
    await page.getByText('«factura-cortada-inventada.pdf»').first().click()
    d = page.getByRole('dialog', { name: '«factura-cortada-inventada.pdf»' })
    await expect(d).toContainText(FRASE_DOCUMENTO)
    await expect(d).not.toContainText(/albar[aá]n|non-2xx|Edge Function/)
    await capturar(page, 'ventana-documento')
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
