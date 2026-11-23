/// <reference lib="dom" />
// tests/e2e/conta/e10/factura-larga.spec.ts
//
// E10 · La factura larga se lee entera. E10b (23/11): en SUMIED se ve igual que cualquier otra, SIN
// líneas de artículo (son de Folvy: Julio, «la versión larga no la veo útil en Sumied»). Contra staging,
// en la cuenta del núcleo, a 1366 × 768 y a 1920 × 1080. Cada prueba crea una empresa nueva
// («Prueba E10 …»). La factura es la inventada de 5 páginas y 34 líneas (scripts/conta/e10, T11), con su
// número de esta pasada.
//
// Llega por el camino de verdad de la base: el PDF se sube al almacén, se registra
// (conta_subida_registrar), su lectura se guarda como la guarda ocr-albaran y la factura sale de
// ella (conta_factura_desde_lectura). Lo único que no corre aquí es el modelo (staging no lee con
// él; la lectura de verdad la mide scripts/conta/e10/medir.mts).
//   1. La larga entra con su cabecera; sus 34 líneas llegan después (conta_lectura_lineas_guardar, como
//      las guarda ocr-albaran en una empresa con Folvy). La ficha de Sumied dice su total y no enseña
//      ninguna línea de artículo, ni «Leyendo…», ni «Leer las que faltan»: ni antes ni después.
//   2. La de una empresa sin Folvy (sus líneas sin leer, E10b) tampoco enseña nada de líneas.
// Escribe (empresas, facturas, lecturas): solo en un carril; sin carril se salta y lo dice.

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CARRIL, STAGING_URL, anonKey, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO } from '../k02/comun'
import { leerFactura, type LecturaModelo } from '../../../../supabase/functions/_shared/lecturaFactura'
import { estadoLineas, lineasSinLeer, type EstadoLineas, type LineaLeida, type TrozoLeido } from '../../../../supabase/functions/_shared/lecturaPorPartes'
// @ts-expect-error módulo .mjs sin tipos
import { pdfFacturaLarga } from '../../../../scripts/conta/e10/generar-facturas-largas.mjs'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
test.skip(CARRIL === null, 'Crea una empresa en la cuenta del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/e10'
const ficha = (page: Page) => page.locator('[data-prueba="ficha-recibida-nucleo"]')
const TECNICO = /\b(IA|tokens?|cortad[ao]|max_tokens|trozos?|dos pasos)\b/i

type Factura = { lineas: LineaLeida[]; tipos: { vat_pct: number; base: number; vat_amount: number }[]; base: number; cuota: number; total: number; proveedor: { nombre: string }; cliente: { nombre: string }; vence: string; formaPago: string }
type Pdf = { bytes: Uint8Array; paginas: number; factura: Factura }

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await ficha(page).innerText().catch(() => '(sin ficha)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

async function crearEmpresa(s: Sesion, que: string): Promise<{ id: string; nif: string }> {
  const nif = cifInventado()
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Prueba E10 ${que} ${Date.now()}`, tax_id: nif, tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e E10' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  return { id, nif }
}

/** Lo que guarda ocr-albaran de la cabecera (modo factura), con las líneas que se le den. */
function lectura(pdf: Pdf, numero: string, nifProveedor: string, nifEmpresa: string, lineas: LineaLeida[]) {
  const f = pdf.factura
  const modelo = {
    document: {
      supplier_name: f.proveedor.nombre, supplier_tax_id: nifProveedor, supplier_phone: null, supplier_email: null, supplier_address: null, supplier_health_registry: null,
      doc_number: numero, doc_date: '2026-10-31', doc_type: 'factura', ship_to: null, bill_to_name: f.cliente.nombre, bill_to_tax_id: nifEmpresa, handwritten: false,
      tax_base_total: f.base, tax_total: f.cuota, grand_total: f.total,
    },
    lines: lineas,
    factura: {
      invoice_kind: 'completa', corrects_number: null, due_date: f.vence,
      tax_breakdown: f.tipos.map((t) => ({ vat_pct: t.vat_pct, base: t.base, vat_amount: t.vat_amount, surcharge_pct: null, surcharge_amount: null })),
      withholding_pct: null, withholding_amount: null, iban: null, payment_terms_text: f.formaPago, payment_method: 'transfer',
    },
    confidence: 0.95,
  }
  return { modelo, factura: leerFactura(modelo as unknown as LecturaModelo, { hoy: '2026-11-23' }) }
}

/** Las líneas de cada página del PDF (siete por página), como trozos leídos; `sinLeer`, las que no. */
function trozos(lineas: LineaLeida[], paginas: number, sinLeer: number[] = []): TrozoLeido[] {
  return Array.from({ length: paginas }, (_, i) => ({ desde: i + 1, hasta: i + 1, lineas: sinLeer.includes(i + 1) ? null : lineas.slice(i * 7, i * 7 + 7) }))
}

/**
 * Llega la factura: el PDF al almacén, registrado, su lectura guardada (con `lineas` y, si se lee por
 * partes, `estado`) y la factura hecha de ella por la base. Devuelve la factura, su lectura y lo leído.
 */
async function llega(s: Sesion, empresa: { id: string; nif: string }, x: { albaranes: number; lineas: 'todas' | 'ninguna'; estado: EstadoLineas | null }) {
  const numero = `AV-E10-${Date.now()}`
  const pdf = pdfFacturaLarga({ albaranes: x.albaranes, numero }) as Pdf
  const ruta = `${NUCLEO.id}/e10/${numero}.pdf`
  const up = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' }, body: Buffer.from(pdf.bytes),
  })
  expect(up.ok, `se sube el PDF: ${up.status} ${(await up.text()).slice(0, 200)}`).toBe(true)
  const reg = await rest<{ id: string }>(s, 'POST', 'rpc/conta_subida_registrar', {
    p_company: empresa.id, p_ruta: ruta, p_nombre: `${numero}.pdf`, p_tipo: 'application/pdf', p_bytes: pdf.bytes.byteLength,
    p_sha256: createHash('sha256').update(pdf.bytes).digest('hex'), p_quien_nombre: 'Prueba e2e E10',
  })
  expect(reg.status, `se registra: ${JSON.stringify(reg.datos).slice(0, 300)}`).toBe(200)
  const nifProveedor = cifInventado()
  const { modelo, factura } = lectura(pdf, numero, nifProveedor, empresa.nif, x.lineas === 'todas' ? pdf.factura.lineas : [])
  const ses = await rest<{ id: string }[]>(s, 'POST', 'goods_receipt_ai_session', {
    account_id: NUCLEO.id, kind: 'pdf', input_files: [{ path: ruta, bucket: 'receipt-uploads' }], raw_response: null, parsed_result: modelo,
    validation: { cuadra: null, needs_review: false, reasons: [], factura, ...(x.estado ? { lineas: x.estado } : {}) }, ai_model: 'prueba-e2e-e10', ai_latency_ms: 0, status: 'pending_review',
  })
  expect(ses.status, `se guarda la lectura: ${JSON.stringify(ses.datos).slice(0, 300)}`).toBe(201)
  const sesion = ses.datos[0].id
  const fac = await rest<{ estado: string; factura_id: string }>(s, 'POST', 'rpc/conta_factura_desde_lectura', { p_inbox: reg.datos.id, p_session: sesion })
  expect(fac.status, `la factura sale de su lectura: ${JSON.stringify(fac.datos).slice(0, 300)}`).toBe(200)
  expect(fac.datos.estado, JSON.stringify(fac.datos)).toBe('factura')
  return { factura: fac.datos.factura_id, sesion, pdf, modelo, lecturaFactura: factura }
}

/** Las líneas llegan, como las guarda ocr-albaran al terminar (la función de verdad del E10). */
async function lleganLasLineas(s: Sesion, x: { sesion: string; modelo: unknown; lecturaFactura: unknown }, pdf: Pdf, sinLeer: number[] = []) {
  const r = estadoLineas({ trozos: trozos(pdf.factura.lineas, pdf.paginas, sinLeer), esperadas: pdf.factura.lineas.length, paginas: pdf.paginas, base: pdf.factura.base, desde: new Date().toISOString() })
  const g = await rest<{ facturas: number; lineas: number }>(s, 'POST', 'rpc/conta_lectura_lineas_guardar', {
    p_session: x.sesion, p_lineas: r.lineas, p_validacion: { cuadra: r.estado.cuadre?.cuadra ?? null, factura: x.lecturaFactura, lineas: r.estado },
  })
  expect(g.status, `se guardan las líneas: ${JSON.stringify(g.datos).slice(0, 300)}`).toBe(200)
  expect(g.datos.facturas, 'en su factura').toBe(1)
  return r
}

async function abrirFicha(page: Page, id: string) {
  await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar`, { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  // La ficha está cargada cuando el asiento ya dice algo: «Cuadra», «Falta…» o, con el proveedor recién dado de alta y
  // aún sin tipo de gasto, «Sin propuesta» (run 45141043810: la ficha estaba bien y la espera no lo contaba).
  await expect(page.locator('[data-prueba="cuadra"]')).toContainText(/Cuadra|Falta|Sin propuesta/, { timeout: 30_000 })
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}.png` })
}

const leyendo = (paginas: number, esperadas: number): EstadoLineas => ({ estado: 'leyendo', leidas: 0, esperadas, paginas, sin_leer: [], por_pagina: [], cuadre: null, desde: new Date().toISOString() })

/** Nada de líneas de artículo en la ficha de Sumied: ni la fila, ni su tabla, ni sus frases. */
async function sinLineas(page: Page) {
  await expect(page.locator('[data-prueba="lineas-factura"], [data-prueba="lineas-leidas"]')).toHaveCount(0)
  const texto = await ficha(page).innerText()
  expect(texto, 'la ficha de Sumied no habla de líneas de artículo').not.toMatch(/Leyendo las líneas|Leer las que faltan|Ver las líneas|\d+ líneas|Leídas \d+/)
  expect(texto).not.toMatch(TECNICO)
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`a ${ancho} × ${alto}: en Sumied, la larga se ve como cualquier otra, sin líneas de artículo`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(`${page.url()}: ${e.message}`); console.log(`[error de la página] ${e.message}`) })
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarComo(page, NUCLEO.email)
    const empresa = await crearEmpresa(s, String(ancho))
    await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa.id] as const)
    try {
      // 1 · Con Folvy: entra con su cabecera mientras se leen sus líneas; la ficha de Sumied no las nombra.
      const larga = await llega(s, empresa, { albaranes: 20, lineas: 'ninguna', estado: leyendo(5, 34) })
      expect(larga.pdf.paginas).toBe(5)
      expect(larga.pdf.factura.lineas).toHaveLength(34)
      await abrirFicha(page, larga.factura)
      await expect(page.locator('[data-prueba="total"]')).toContainText('1.367,75')
      await sinLineas(page)
      // Llegan las 34 (a la factura y a su lectura): la ficha de Sumied sigue igual.
      await lleganLasLineas(s, larga, larga.pdf)
      const n = await rest<{ id: string }[]>(s, 'GET', `supplier_invoice_line?supplier_invoice_id=eq.${larga.factura}&select=id`)
      expect(n.datos, 'la factura tiene sus 34 líneas (para Folvy)').toHaveLength(34)
      await page.reload()
      await abrirFicha(page, larga.factura)
      await expect(page.locator('[data-prueba="total"]')).toContainText('1.367,75')
      await sinLineas(page)
      if (ancho === 1366) expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), 'sin scroll horizontal').toBe(false)
      await capturar(page, `larga-sumied-${ancho}`)

      // 2 · Sin Folvy (E10b): sus líneas quedan sin leer; la ficha de Sumied, igual.
      const sinFolvy = await llega(s, empresa, { albaranes: 20, lineas: 'ninguna', estado: lineasSinLeer({ esperadas: 34, paginas: 5, desde: new Date().toISOString() }) })
      await abrirFicha(page, sinFolvy.factura)
      await expect(page.locator('[data-prueba="total"]')).toContainText('1.367,75')
      await sinLineas(page)
    } catch (e) {
      await contarPantalla(page, `a ${ancho}`)
      throw e
    }
    expect(errores).toEqual([])
  })
}
