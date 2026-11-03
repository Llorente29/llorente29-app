/// <reference lib="dom" />
// tests/e2e/conta/b01/justificante.spec.ts
//
// B01 · Cola 1e · EL JUSTIFICANTE DE UN PAGO, en la ficha de la factura y por
// su enlace público, en staging-conta, cuenta B, en ordenador (1440) y móvil (390).
//
// La factura y su proveedor son DE VERDAD (se crean por la API con la sesión
// de la administradora de B, nombres inventados y únicos, y se borran al
// acabar). Los justificantes de la ficha van INTERCEPTADOS: los hace el
// servidor cuando Revolut confirma un pago, y eso se prueba de punta a punta
// con el sandbox (docs/conta/b01-revolut/pagar_parte.md). El enlace público va
// contra la función conta-justificante DE VERDAD, desplegada en staging.
//   1. La ficha: «Justificante del pago», con lo pagado y cuánto le queda al enlace.
//      · Con teléfono: «Enviar por WhatsApp» abre wa.me con su número y el enlace.
//      · Sin teléfono: el botón lo dice y lleva a ponerlo en sus contactos.
//      · «Mandar al proveedor»: solo con la casilla de su ficha; si no, lleva a
//        marcarla. Con la casilla, pulsar dice qué ha pasado (regla 8).
//      · El que ha caducado: sin «Ver» ni WhatsApp, y lo dice.
//   2. El enlace público: una clave que no es de nadie, o mal escrita, dice
//      «Este enlace no vale» (404), sin sesión.
// Todo inventado (T11): el teléfono, todo ceros.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_B, STAGING_URL, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/b01-revolut'
const EMPRESA_B = enCarril('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const json = (route: Route, cuerpo: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const CLAVE_1 = 'e2eJustificanteUnoAAAAAAAAAAAAAAAAAAAAAAAA1'
const CLAVE_2 = 'e2eJustificanteDosAAAAAAAAAAAAAAAAAAAAAAAA2'
const CLAVE_3 = 'e2eJustificanteTresAAAAAAAAAAAAAAAAAAAAAAA3'

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: false })
}

async function preparar(s: Sesion, nombre: string, numero: string): Promise<{ proveedor: string; factura: string }> {
  const p = await rest<{ id: string }[]>(s, 'POST', 'supplier', { account_id: CUENTA_B.id, name: nombre, payment_method: 'transfer' })
  expect(p.status, `el proveedor de prueba: ${JSON.stringify(p.datos).slice(0, 300)}`).toBe(201)
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_B.id, company_id: EMPRESA_B, supplier_id: p.datos[0].id, doc_kind: 'invoice', invoice_number: numero, invoice_date: hoy(),
    due_date: hoy(), status: 'aprobada', source: 'manual', payment_method: 'transfer', tax_base_total: 300, tax_total: 63, grand_total: 363,
    created_by_name: 'Prueba e2e B01 justificante',
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  return { proveedor: p.datos[0].id, factura: f.datos[0].id }
}

async function limpiar(s: Sesion, x: { proveedor: string; factura: string } | null) {
  if (!x) return
  const d1 = await rest(s, 'DELETE', `supplier_invoice?account_id=eq.${CUENTA_B.id}&id=eq.${x.factura}`)
  if (d1.status >= 300) console.log(`[limpieza] la factura: HTTP ${d1.status} ${JSON.stringify(d1.datos).slice(0, 200)}`)
  const d2 = await rest(s, 'DELETE', `supplier?account_id=eq.${CUENTA_B.id}&id=eq.${x.proveedor}`)
  if (d2.status >= 300) console.log(`[limpieza] el proveedor: HTTP ${d2.status} ${JSON.stringify(d2.datos).slice(0, 200)}`)
}

test.describe('B01 · el justificante de un pago', () => {
  test.describe.configure({ timeout: 120_000 })
  test.use({ actionTimeout: 20_000 })

  test('la ficha: verlo, WhatsApp con y sin teléfono, el correo según la casilla, y el caducado', async ({ page }) => {
    const s = await entrarComo(page, CUENTA_B.email)
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(e.message) })
    const marca = `JUS${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
    const nombre = `Envases Prueba ${marca}`
    const numero = `${marca}-1`
    let x: { proveedor: string; factura: string } | null = null
    const correos: Record<string, unknown>[] = []
    try {
      x = await preparar(s, nombre, numero)
      const ahora = Date.now()
      const j = (id: string, clave: string, o: Record<string, unknown>) => ({
        id, clave, creado: new Date(ahora - 2 * 86_400_000).toISOString(), caduca: new Date(ahora + 28 * 86_400_000).toISOString(),
        importe: 363, pagado_at: new Date(ahora - 2 * 86_400_000).toISOString(), correo_a: null, correo_at: null, correo_texto: null,
        proveedor: nombre, supplier_id: x!.proveedor, al_pagar: false, telefono: null, correo: null, ...o,
      })
      await page.route('**/rest/v1/rpc/conta_factura_justificantes', (r) => json(r, [
        j('e2e0b01c-0000-4000-8000-0000000000e1', CLAVE_1, { telefono: '600 000 000', al_pagar: true, correo: 'pagos@ejemplo.invalid' }),
        j('e2e0b01c-0000-4000-8000-0000000000e2', CLAVE_2, {}),
        j('e2e0b01c-0000-4000-8000-0000000000e3', CLAVE_3, { caduca: new Date(ahora - 86_400_000).toISOString(), telefono: '600000000' }),
      ]))
      await page.route('**/functions/v1/conta-justificante', async (r) => {
        correos.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>)
        await json(r, { enviado: false, texto: `No se ha mandado el justificante de ${numero} a pagos@ejemplo.invalid: los correos de justificantes aún están cerrados (los abre Julio).` })
      })

      await page.goto(`/conta/documentos/recibidas/${x.factura}`)
      const bloque = page.getByRole('region', { name: 'Justificante del pago' })
      await expect(bloque).toBeVisible({ timeout: 30_000 })
      const js = bloque.locator('[data-prueba="justificante"]')
      await expect(js).toHaveCount(3)
      await expect(js.nth(0)).toContainText(`363,00 € pagados a ${nombre}`)
      await expect(js.nth(0)).toContainText('El enlace caduca en 27 días')

      // Con teléfono: «Ver» va al enlace público y WhatsApp a wa.me con su número, el enlace y la factura.
      const enlace = `${STAGING_URL}/functions/v1/conta-justificante?c=${CLAVE_1}`
      await expect(js.nth(0).locator('[data-prueba="justificante-ver"]')).toHaveAttribute('href', enlace)
      const wa = await js.nth(0).locator('[data-prueba="justificante-whatsapp"]').getAttribute('href')
      expect(wa).toMatch(/^https:\/\/wa\.me\/34600000000\?text=/)
      const texto = decodeURIComponent(wa!.split('?text=')[1])
      expect(texto).toContain(`la factura ${numero} (363,00 €)`)
      expect(texto).toContain(enlace)

      // Sin teléfono: lo dice y lleva a sus contactos. Sin la casilla: lleva a su ficha a marcarla.
      const sinTel = js.nth(1).locator('[data-prueba="justificante-whatsapp-sin-telefono"]')
      await expect(sinTel).toHaveText('Enviar por WhatsApp: falta su teléfono, ponlo')
      await expect(sinTel).toHaveAttribute('href', new RegExp(`/proveedor/${x.proveedor}/contactos\\?nuevo=1$`))
      const marcar = js.nth(1).locator('[data-prueba="justificante-correo-marcar"]')
      await expect(marcar).toHaveText('Mandar al proveedor: márcalo en su ficha')
      await expect(marcar).toHaveAttribute('href', new RegExp(`/proveedor/${x.proveedor}/contabilidad$`))

      // El caducado: sin «Ver» ni WhatsApp, y lo dice.
      await expect(js.nth(2)).toContainText('El enlace ha caducado')
      await expect(js.nth(2).locator('[data-prueba="justificante-ver"]')).toHaveCount(0)
      await expect(js.nth(2)).toContainText('El enlace para WhatsApp ha caducado.')
      await capturar(page, 'b01-justificante-ficha')

      // Con la casilla: «Mandar al proveedor» dice qué ha pasado (cerrado, hoy).
      await js.nth(0).locator('[data-prueba="justificante-correo"]').click()
      await expect(bloque.locator('[data-prueba="justificante-aviso"]')).toHaveText(
        `No se ha mandado el justificante de ${numero} a pagos@ejemplo.invalid: los correos de justificantes aún están cerrados (los abre Julio).`)
      expect(correos).toHaveLength(1)
      expect(correos[0]).toMatchObject({ accion: 'correo', justificante: 'e2e0b01c-0000-4000-8000-0000000000e1' })
      expect(errores).toEqual([])
    } finally {
      await limpiar(s, x)
    }
  })

  test('el enlace público: una clave que no es de nadie, o mal escrita, no enseña nada', async ({ page }) => {
    // Sin sesión: es lo que abre el proveedor desde WhatsApp.
    for (const c of ['e2eNoEsDeNadieAAAAAAAAAAAAAAAAAAAAAAAAAAAA0', 'corta', "'; select 1 --"]) {
      const r = await page.goto(`${STAGING_URL}/functions/v1/conta-justificante?c=${encodeURIComponent(c)}`)
      expect(r?.status(), `la clave «${c}»`).toBe(404)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Este enlace no vale')
      await expect(page.locator('main')).toContainText('No es el enlace de ningún justificante. Pídelo a quien te pagó.')
    }
  })
})
