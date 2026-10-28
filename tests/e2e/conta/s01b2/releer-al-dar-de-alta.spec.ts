/// <reference lib="dom" />
// tests/e2e/conta/s01b2/releer-al-dar-de-alta.spec.ts
//
// S01b2 · Volver a leer la factura al darla de alta (Julio, 28/10), contra
// staging-conta, en ordenador (1440) y móvil (390).
//
// Una recibida «por revisar» SIN proveedor cuya lectura es de antes del 28/10:
// su proveedor guardado tiene nombre, NIF, correo y dirección, y no las claves
// «telefono» ni «web» (como la R0672 de Foodint y las 85 lecturas de antes).
//   1. «Dar de alta a …» va debajo, a lo ancho del bloque, y el nombre no se
//      parte (una línea);
//   2. al pulsarlo, «Leyendo la factura…» y, después, el formulario con nombre,
//      NIF, dirección, teléfono y web; lo que no trae, vacío y «No viene en la
//      factura»; y lo dice («He vuelto a leer la factura: añado …»);
//   3. la lectura guardada queda completada (con sus claves): otra vez no se
//      vuelve a leer.
//
// La relectura no llama a la IA: la sesión de lectura (goods_receipt_ai_session)
// se escribe aquí por la API, como la dejaría ocr-albaran con el PDF de la
// factura, y la llamada a ocr-albaran del navegador se contesta con su id. La
// función de la base (conta_lectura_proveedor_releida, 1555) es la de verdad.
// Si staging aún no la tiene (la e2e va antes del ensayo), se mira el otro
// camino: el formulario sale igual y dice que no ha podido volver a leerla.
// Solo en un carril (la sesión de lectura no se deja borrar a una persona: se
// va con el carril). Lanzarla dos veces da lo mismo: cada ejecución inventa su
// factura. Datos inventados.

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'

const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const LOCAL_A = enCarril('c01a0000-0000-4000-8000-0000000000a2')
const PDF = 'tests/conta/d01/facturas-inventadas/semilla-f-2026-1022.pdf'

const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const sello = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

async function subirPdf(s: Sesion, nombre: string): Promise<string> {
  const ruta = `${CUENTA_A.id}/s01b2-e2e/${nombre}.pdf`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' }, body: readFileSync(PDF),
  })
  const t = await r.text()
  expect(r.ok || /exists|duplicate/i.test(t), `subir el PDF de prueba: ${r.status} ${t.slice(0, 200)}`).toBe(true)
  return ruta
}

/** ¿Tiene ya staging la función de la 1555? (sin ella, PostgREST contesta 404 PGRST202). */
async function hayFuncion(s: Sesion): Promise<boolean> {
  const r = await rest(s, 'POST', 'rpc/conta_lectura_proveedor_releida', { p_invoice: '00000000-0000-4000-8000-000000000000', p_session: '00000000-0000-4000-8000-000000000000' })
  return r.status !== 404
}

test('S01b2 · una factura leída antes del 28/10: «Dar de alta a …» la vuelve a leer y el formulario sale con teléfono y web', async ({ page }) => {
  test.skip(CARRIL === null, 'Escribe una sesión de lectura (no se deja borrar): solo en un carril, que se borra entero al acabar.')
  test.setTimeout(180_000)
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const marca = `PS01B2${lado(page) === 'movil' ? 'M' : 'O'}${sello()}`
  const nombre = `Rollos Inventados ${marca.slice(-6)} S.L.U.`
  const nif = cifInventado()
  const direccion = 'Pol. Ind. Inventado, C/ Ejemplo 9, Nave 9, 11160 Barbate (Cádiz)'
  const telefono = '956 000 000'
  const web = `www.${marca.toLowerCase()}.es`
  const conFuncion = await hayFuncion(s)
  console.log(`[S01b2] Staging ${conFuncion ? 'con' : 'SIN'} la 1555 (conta_lectura_proveedor_releida).`)

  const ruta = await subirPdf(s, marca)
  // La factura, con su lectura «de antes»: sin las claves telefono ni web.
  const f = await rest<{ id: string }[]>(s, 'POST', 'supplier_invoice', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, supplier_id: null, location_id: LOCAL_A, doc_kind: 'invoice',
    invoice_number: marca, invoice_date: hoy(), status: 'en_revision', source: 'ocr', tax_base_total: 100, tax_total: 21, grand_total: 121,
    created_by_name: 'Prueba e2e S01b2', raw_document_url: ruta, needs_review: true, reading_confidence: 'probable',
    reading: { porque: ['Prueba e2e S01b2.'], comprobaciones: [], confianza: 'probable', factura: { proveedor: { nombre, nif, email: null, direccion } } },
  })
  expect(f.status, `la factura de prueba: ${JSON.stringify(f.datos).slice(0, 300)}`).toBe(201)
  const id = f.datos[0].id
  // La sesión que dejaría ocr-albaran al volver a leer ESE PDF con el lector de hoy.
  const sesion = await rest<{ id: string }[]>(s, 'POST', 'goods_receipt_ai_session', {
    account_id: CUENTA_A.id, kind: 'pdf', input_files: [{ path: ruta, bucket: 'receipt-uploads' }], status: 'pending_review',
    validation: { factura: { factura: { proveedor: { nombre, nif, email: null, direccion, telefono, web } } } },
  })
  expect(sesion.status, `la sesión de lectura: ${JSON.stringify(sesion.datos).slice(0, 300)}`).toBe(201)
  let llamadas = 0
  await page.route('**/functions/v1/ocr-albaran', async (r) => {
    llamadas++
    const cuerpo = r.request().postDataJSON() as { file_paths?: string[]; modo?: string }
    expect(cuerpo.modo, 'la relectura, en modo factura').toBe('factura')
    expect(cuerpo.file_paths, 'la relectura, de SU PDF').toEqual([ruta])
    await new Promise((x) => setTimeout(x, 1200))
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session_id: sesion.datos[0].id }) })
  })

  await page.goto(`/conta/documentos/recibidas/${id}?ver=por-revisar&q=${encodeURIComponent(marca)}`)
  await expect(page.locator('[data-prueba="ficha-recibida"]')).toBeVisible({ timeout: 30_000 })

  // 1 · El enlace, a lo ancho, con el nombre de una pieza.
  const enlace = page.locator('[data-prueba="alta-desde-factura"]').getByRole('button', { name: `Dar de alta a ${nombre}` })
  await expect(enlace).toBeVisible({ timeout: 30_000 })
  const lineas = await page.locator('[data-prueba="alta-desde-factura"] .cxf-nombre-entero').first()
    .evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size })
  expect(lineas, 'el nombre del proveedor, en una sola línea').toBe(1)

  // 2 · «Leyendo la factura…» y el formulario.
  await enlace.click()
  await expect(page.locator('[data-prueba="leyendo-factura"]')).toBeVisible()
  const form = page.locator('[data-prueba="formulario-alta-factura"]')
  await expect(form.getByLabel('Teléfono')).toBeVisible({ timeout: 30_000 })
  expect(llamadas, 'una relectura').toBe(1)
  await expect(form.getByLabel('Nombre con el que lo conocéis')).toHaveValue(nombre)
  await expect(form.getByLabel(/^NIF/)).toHaveValue(nif)
  await expect(form.getByLabel('Dirección fiscal')).toHaveValue(direccion)
  await expect(form.getByLabel('Correo')).toHaveValue('')
  for (const campo of ['Nombre con el que lo conocéis', /^NIF/, 'Dirección fiscal', 'Correo', 'Teléfono', 'Web']) await expect(form.getByLabel(campo), `${campo} sin ejemplo en gris`).not.toHaveAttribute('placeholder', /.+/)
  if (conFuncion) {
    await expect(page.locator('[data-prueba="relectura"]')).toHaveText('He vuelto a leer la factura: añado el teléfono y la web.')
    await expect(form.getByLabel('Teléfono')).toHaveValue(telefono)
    await expect(form.getByLabel('Web')).toHaveValue(web)
    await expect(form).toContainText('No viene en la factura.')
    // 3 · Queda guardado: la lectura ya tiene sus claves (otra vez no se vuelve a leer).
    const g = await rest<{ reading: { factura: { proveedor: Record<string, string | null> } } }[]>(s, 'GET', `supplier_invoice?select=reading&account_id=eq.${CUENTA_A.id}&id=eq.${id}`)
    expect(g.datos[0].reading.factura.proveedor).toMatchObject({ nombre, nif, telefono, web })
  } else {
    await expect(page.locator('[data-prueba="relectura"]')).toContainText('No he podido volver a leer la factura')
    await expect(form.getByLabel('Teléfono')).toHaveValue('')
    await expect(form).toContainText('No viene en la factura.')
  }
  expect(errores).toEqual([])
})
