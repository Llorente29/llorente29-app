/// <reference lib="dom" />
// tests/e2e/conta/compras/auditoria.spec.ts
//
// AUDITORÍA de Compras y gastos (Julio, 21/10: «es muy complicado ver o hacer
// algo»). SOLO CAPTURAS, a 1440 px, con la marca de contabilidad (Sumied) y la
// cuenta de pruebas A: cada pantalla por la que pasa una factura, para hacer
// la maqueta del rediseño. No escribe nada: abre, mira y cierra. Vive en la
// rama conta/compras-auditoria, que no se fusiona.
//
// Si una pantalla no se puede abrir, la captura de lo que hay en su lugar
// sirve igual (y lo dice el nombre): no para el resto.

import { test, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo, enCarril } from '../sesion'

const DIR = 'docs/conta/capturas/compras/auditoria'
const VERDURAS = enCarril('c0c00000-0000-4000-8000-000000000001')

async function capturar(page: Page, nombre: string) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
  await page.evaluate(() => document.fonts.ready)
  const ventana = page.viewportSize() ?? { width: 1440, height: 900 }
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: ventana.width, height: Math.min(Math.max(ventana.height, alto), 6000) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/${nombre}.png` })
  await page.setViewportSize(ventana)
}

/** Un paso que no tumba a los demás: si falla, captura lo que haya con «-no-se-pudo». */
async function paso(page: Page, nombre: string, hacer: () => Promise<void>) {
  try {
    await hacer()
    await capturar(page, nombre)
  } catch (e) {
    console.log(`[auditoría] ${nombre}: ${(e as Error).message.split('\n')[0]}`)
    await capturar(page, `${nombre}-no-se-pudo`).catch(() => {})
  }
}

test('Auditoría de Compras y gastos: todas sus pantallas, a 1440', async ({ page }, info) => {
  test.skip(info.project.name !== 'ordenador', 'solo a 1440')
  test.setTimeout(240_000)
  await entrarComo(page, CUENTA_A.email)

  await paso(page, '01-por-revisar', async () => {
    await page.goto('/conta/compras?marca=contabilidad')
    await page.getByRole('heading', { name: 'Qué tienes que mirar' }).waitFor()
  })
  await paso(page, '02-subir-una-factura', async () => {
    await page.getByRole('button', { name: 'Subir una factura' }).last().click()
    await page.getByRole('dialog').waitFor()
  })
  await page.keyboard.press('Escape')
  await paso(page, '03-por-revisar-ver-los-albaranes', async () => {
    await page.goto('/conta/compras')
    await page.getByText(/^Ver los \d+ albaranes$/).first().click()
  })
  await paso(page, '04-ver-un-albaran', async () => {
    await page.getByRole('button', { name: /^Ver (el albarán|la factura|el documento)$/ }).first().click()
    await page.getByRole('dialog').waitFor()
    await page.waitForTimeout(1500)
  })
  await page.keyboard.press('Escape')
  await paso(page, '05-ficha-desde-por-revisar-abrir-su-ficha', async () => {
    await page.goto('/conta/compras')
    await page.locator('.cxc-cosa', { hasText: /le falta|le faltan/ }).first().getByRole('link', { name: 'Abrir su ficha' }).click()
    await page.waitForURL(/proveedor/)
  })
  await paso(page, '06-ficha-proveedor-datos', async () => {
    await page.goto(`/conta/clientes-y-proveedores/proveedor/${VERDURAS}`)
  })
  await paso(page, '07-ficha-proveedor-como-te-factura', async () => {
    await page.goto(`/conta/clientes-y-proveedores/proveedor/${VERDURAS}/como-te-factura`)
  })
  await paso(page, '08-ficha-proveedor-contabilidad', async () => {
    await page.goto(`/conta/clientes-y-proveedores/proveedor/${VERDURAS}/contabilidad`)
  })
  await paso(page, '09-facturas-recibidas', async () => {
    await page.goto('/conta/documentos?mes=2026-10')
    await page.getByRole('heading', { level: 1, name: 'Facturas recibidas' }).waitFor()
  })
  await paso(page, '10-facturas-recibidas-todas', async () => {
    await page.getByRole('group', { name: 'Qué facturas ver' }).getByRole('button', { name: 'Todas' }).click()
  })
  await paso(page, '11-revisar-una-factura', async () => {
    await page.getByRole('group', { name: 'Qué facturas ver' }).getByRole('button', { name: 'Para mirar' }).click()
    await page.getByRole('button', { name: /^(Mirar|Aclarar)/ }).first().click()
    await page.waitForURL(/documentos\/recibidas\//)
  })
  await paso(page, '12-liquidaciones', async () => {
    await page.goto('/conta/compras/liquidacion/nueva')
  })
  await paso(page, '13-una-liquidacion', async () => {
    await page.goto('/conta/compras')
    await page.getByRole('link', { name: 'Abrir' }).first().click()
    await page.waitForURL(/liquidacion\//)
  })
  await paso(page, '14-recibida-a-mano-desde-asientos', async () => {
    await page.goto('/conta/libros/diario/recibidas')
  })
  // El camino desde la recepción en el local (Cocina): lo que ve la oficina.
  await paso(page, '15-cocina-recepciones', async () => {
    await page.goto('/supply/recepciones')
  })
  await paso(page, '16-cocina-facturas-de-proveedor', async () => {
    await page.goto('/supply/facturas')
  })
  await paso(page, '17-cocina-pendientes-de-recibir', async () => {
    await page.goto('/supply/pendientes')
  })
})
