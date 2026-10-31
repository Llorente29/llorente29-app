/// <reference lib="dom" />
// tests/e2e/conta/s01g/soporte.spec.ts
//
// S01g · Las recepciones de soporte de la liquidación y «Por aclarar» con su
// acción, en ordenador y móvil, contra staging-conta, cuenta A. Desde la rama,
// la 0931 (la que pone «soporte») solo va en ROLLBACK a staging, así que las
// filas de soporte y la llegada sin leer se AÑADEN a la respuesta de
// conta_documentos_recibidos, con sus líneas, su liquidación y su Relación
// INVENTADAS (page.route). La pantalla es la de verdad; no se escribe nada.
//
//   · «Otras»: la fila con su etiqueta y el filtro «Qué es»;
//   · la ficha sin liquidación todavía: el aviso y «Subir la liquidación»;
//   · la ficha con su liquidación: con cuál cuadra y el cruce;
//   · «Por aclarar»: la llegada sin leer abre sus acciones (regla 8).
// Las capturas van a docs/conta/capturas/s01g/documentos/.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01g/documentos'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })

const REC_SIN = 'e2e01e0a-0000-4000-8000-000000000001'
const REC_CON = 'e2e01e0a-0000-4000-8000-000000000002'
const REC_OTRA = 'e2e01e0a-0000-4000-8000-000000000003'
const LLEGADA = 'e2e01e0a-0000-4000-8000-000000000004'
const REPETIDA = 'e2e01e0a-0000-4000-8000-000000000005'
const LIQ = 'e2e01e0a-0000-4000-8000-0000000000aa'
const PROV = 'SOCIO INVENTADO BRANDS, S.L.'
const ETIQUETA = 'Soporte · Socio Inventado Brands · oct 2026 · Local de prueba'

const soporte = (codigo: string, liquidacion: unknown) => ({ proveedor_id: 'e2e01e0a-0000-4000-8000-0000000000bb', proveedor: PROV, mes: '2026-10', local: 'Local de prueba', local_id: 'e2e01e0a-0000-4000-8000-0000000000cc', codigo, liquidacion })
const filaSoporte = (id: string, codigo: string, numero: string, total: number, liquidacion: unknown) => ({
  id, tipo: 'recepcion', estado: 'soporte', proveedor: { id: 'e2e01e0a-0000-4000-8000-0000000000bb', nombre: PROV }, numero, fecha: '2026-10-20', total, canal: 'cocina', confianza: null,
  porque: 'No se apunta como compra: entra en la contabilidad con la liquidación mensual de SOCIO INVENTADO BRANDS, S.L..', entendido: null,
  recepcion: { fecha: '2026-10-20', local: 'Local de prueba' }, soporte: soporte(codigo, liquidacion), asiento: null, diez: null, papel: null, llego: '2026-10-20T09:00:00Z',
})
const FILAS = [
  filaSoporte(REC_SIN, 'ALB-E2E01', 'FV00000001', 163.32, null),
  filaSoporte(REC_CON, 'ALB-E2E02', 'FV00000002', 88.5, { id: LIQ, desde: '2026-10-01', hasta: '2026-10-31' }),
  { id: LLEGADA, tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null }, numero: null, fecha: '2026-10-28', total: null, canal: 'correo', confianza: null,
    porque: 'Recibida, sin leer todavía.', entendido: null, recepcion: null, asiento: null, llego: '2026-10-28T08:00:00Z', archivo: 'factura-inventada.pdf' },
  // Una repetida, para que «Otras» tenga dos tipos y salga el filtro «Qué es» (sale con dos o más).
  { id: REPETIDA, tipo: 'factura', estado: 'repetida', proveedor: { id: null, nombre: 'Proveedor inventado' }, numero: 'F-00000009', fecha: '2026-10-21', total: 12.1, canal: 'correo', confianza: null,
    porque: 'Ya está la misma factura.', entendido: null, recepcion: null, asiento: null, llego: '2026-10-21T08:00:00Z' },
]
const LINEAS = [
  { goods_receipt_id: REC_SIN, recipe_item_id: 'a-pan', product_name: 'Pan inventado', qty_in_base: 48, qty_received: 48, doc_amount: 29.76, unit_cost: 0.62, not_goods: false },
  { goods_receipt_id: REC_SIN, recipe_item_id: 'a-salsa', product_name: 'Salsa inventada', qty_in_base: 3000, qty_received: 3, doc_amount: 14.7, unit_cost: 4.9, not_goods: false },
  { goods_receipt_id: REC_CON, recipe_item_id: 'a-pan', product_name: 'Pan inventado', qty_in_base: 48, qty_received: 48, doc_amount: 29.76, unit_cost: 0.62, not_goods: false },
  { goods_receipt_id: REC_CON, recipe_item_id: 'a-salsa', product_name: 'Salsa inventada', qty_in_base: 3000, qty_received: 3, doc_amount: 14.7, unit_cost: 4.9, not_goods: false },
  { goods_receipt_id: REC_CON, recipe_item_id: 'a-carne', product_name: 'Carne inventada', qty_in_base: 6000, qty_received: 6, doc_amount: 58.8, unit_cost: 9.8, not_goods: false },
  { goods_receipt_id: REC_OTRA, recipe_item_id: 'a-pan', product_name: 'Pan inventado', qty_in_base: 2, qty_received: 2, doc_amount: 1.24, unit_cost: 0.62, not_goods: false },
]

async function conDatosInventados(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/conta_documentos_recibidos/, async (r) => {
    const real = await r.fetch()
    const d = await real.json() as { filas: unknown[]; cifras: Record<string, number> }
    await json(r, { ...d, filas: [...FILAS, ...d.filas], cifras: { ...d.cifras, soporte: 2 } })
  })
  await page.route(/\/rest\/v1\/rpc\/compras_liquidacion_recepciones/, (r) => json(r, [{ recepcion: REC_CON, codigo: 'ALB-E2E02' }, { recepcion: REC_OTRA, codigo: 'ALB-E2E03' }]))
  await page.route(/\/rest\/v1\/rpc\/compras_liquidacion_productos/, (r) => json(r, []))
  await page.route(/\/rest\/v1\/licensed_settlement\?.*select=detail/, (r) => json(r, { detail: { inventario: { productos: [
    { nombre: 'Pan inventado', precio: 0.62, compras: 50, unidad: 'Uni' },
    { nombre: 'Salsa inventada', precio: 4.75, compras: 3, unidad: 'Lt' },
    { nombre: 'Carne inventada', precio: 9.8, compras: 6, unidad: 'Kg' },
  ] } } }))
  await page.route(/\/rest\/v1\/goods_receipt_line\?/, (r) => {
    const u = decodeURIComponent(r.request().url())
    return json(r, LINEAS.filter((l) => u.includes(l.goods_receipt_id)))
  })
  await page.route(/\/rest\/v1\/recipe_item\?.*a-pan|\/rest\/v1\/recipe_item\?.*a-salsa/, (r) => json(r, [
    { id: 'a-pan', name: 'Pan inventado', base_unit_id: 'u-ud' }, { id: 'a-salsa', name: 'Salsa inventada', base_unit_id: 'u-ml' }, { id: 'a-carne', name: 'Carne inventada', base_unit_id: 'u-g' },
  ]))
  await page.route(/\/rest\/v1\/kitchen_unit\?/, (r) => json(r, [
    { id: 'u-ud', dimension: 'unit', factor_to_base: 1 }, { id: 'u-ml', dimension: 'volume', factor_to_base: 1 }, { id: 'u-g', dimension: 'weight', factor_to_base: 1 },
  ]))
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

test.describe('S01g · las recepciones de soporte y «Por aclarar» con su acción', () => {
  test.describe.configure({ timeout: 180_000 })
  test.use({ actionTimeout: 20_000 })

  test('«Otras»: la fila de soporte con su etiqueta, y el filtro «Qué es»', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await conDatosInventados(page)
    await page.goto('/conta/documentos?ver=otras')
    await expect(page.getByRole('heading', { name: 'Facturas recibidas', level: 1 })).toBeVisible()
    const que = page.getByRole('group', { name: 'Qué es' })
    await expect(que.getByRole('button', { name: `${ETIQUETA} · 2` })).toBeVisible()
    await que.getByRole('button', { name: `${ETIQUETA} · 2` }).click()
    await expect(que.getByRole('button', { name: `${ETIQUETA} · 2` })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(ETIQUETA).first()).toBeVisible()
    await expect(page.getByText('F-00000009')).toHaveCount(0)
    await capturar(page, 'otras-soporte')
  })

  test('la ficha sin liquidación todavía: el aviso, lo que trae y «Subir la liquidación de octubre»', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await conDatosInventados(page)
    await page.goto(`/conta/documentos?ver=otras&recepcion=${REC_SIN}`)
    await expect(page.getByRole('heading', { name: `Recepción ALB-E2E01 · ${PROV}`, level: 1 })).toBeVisible()
    await expect(page.getByText('No se apunta como compra: entra en la contabilidad con la liquidación mensual de Socio Inventado Brands.')).toBeVisible()
    await expect(page.locator('[data-prueba="esperando-liquidacion"]')).toContainText('aún no ha llegado')
    await expect(page.getByRole('link', { name: 'Subir la liquidación de octubre' }).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Lo que trae esta recepción' })).toContainText('Salsa inventada')
    await capturar(page, 'ficha-sin-liquidacion')
  })

  test('la ficha con su liquidación: con cuál cuadra y el cruce, lo que no coincide primero', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await conDatosInventados(page)
    await page.goto(`/conta/documentos?ver=otras&recepcion=${REC_CON}`)
    const cuadra = page.locator('[data-prueba="cuadra-con"]')
    await expect(cuadra).toContainText('Liquidación de Socio Inventado Brands · octubre 2026 · Local de prueba')
    await expect(cuadra).toContainText('2 de 3 coinciden · 1 por aclarar')
    await expect(page.getByRole('link', { name: 'Ver la liquidación de octubre' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Aclarar el 1 en la liquidación' })).toBeVisible()
    await capturar(page, 'ficha-con-liquidacion')
  })

  test('«Por aclarar»: la llegada sin leer abre sus acciones (regla 8)', async ({ page }) => {
    await entrarComo(page, CUENTA_A.email)
    await conDatosInventados(page)
    await page.goto('/conta/documentos?ver=por-aclarar')
    await page.getByText('Documento sin leer').first().click()
    const d = page.getByRole('dialog', { name: '«factura-inventada.pdf»' })
    await expect(d).toContainText('Recibida, sin leer todavía.')
    await expect(d.getByRole('button', { name: 'Leerla' })).toBeVisible()
    await expect(d.getByRole('button', { name: 'No es una factura' })).toBeVisible()
    await capturar(page, 'por-aclarar-acciones')
  })
})
