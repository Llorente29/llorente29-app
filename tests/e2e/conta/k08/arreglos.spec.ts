/// <reference lib="dom" />
// tests/e2e/conta/k08/arreglos.spec.ts
//
// K08 · Cinco arreglos de la ficha, vistos grabando facturas de verdad (Julio, 21/11), contra staging, con
// la cuenta del núcleo (semilla K02) en su gestoría, a 1456 × 816 y a 1366 × 768. X31 · 0: cada pasada crea sus propias
// facturas (llega: NIF inventado y número que no se repite), en lugar de las dos de la semilla K08, que quedaban validadas:
//   1. una factura de un proveedor recién dado de alta enseña su asiento antes de validar, con la línea del
//      proveedor (X31 · 0: desde el R14 lo da de alta Sumied solo, con su subcuenta, y lo dice con «Proveedor nuevo»);
//   2. validada, la casilla «Proveedor» con su código (el nombre, en «Nombre»), y cada línea del asiento, el nombre de su cuenta
//      («Compras de mercaderías», nunca su explicación);
//   3. la barra de abajo, cuando la empresa espera su primera salida a ERP10: en gris, «Esperando la primera
//      salida a ERP10 · Mandarla». Esa empresa no se puede montar en staging sin un asiento validado hace más
//      de una hora (un asiento validado no se toca), así que las dos lecturas de ERP10 de la barra se
//      contestan desde la prueba (page.route): lo que se prueba es la pantalla con esos datos.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { cifInventado } from '../api'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k08'
/** La gestoría de la cuenta del núcleo (semilla K02), en el carril. */
const GESTORIA_ID = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const asiento = (page: Page) => ficha(page).locator('.kf-asiento')
const laDeAntes = (page: Page) => page.locator('.k-zona[data-activa="si"] .s-pagina')

async function rest<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json',
      // Un alta en una tabla devuelve la fila (su id); una función, lo suyo.
      ...(cuerpo !== undefined && !ruta.startsWith('rpc/') ? { Prefer: 'return=representation' } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${cuerpo === undefined ? 'GET' : 'POST'} ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return (texto ? JSON.parse(texto) : null) as T
}

/** Un PDF pequeño de verdad, para que la factura se pueda validar (como en el K07). */
function pdfDe(texto: string): Uint8Array<ArrayBuffer> {
  const flujo = `BT /F1 18 Tf 60 760 Td (${texto}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const sitios: number[] = []
  objetos.forEach((o, i) => { sitios.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${sitios.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

/**
 * X31 · 0 · La factura de ESTA pasada (antes, las dos de la semilla K08, que quedaban validadas y la siguiente pasada ya no
 * las encontraba por revisar): leída de un emisor que la cuenta no tiene, con un NIF inventado y un número que no se repite,
 * al 21 % y a la 60000000, como la semilla (la cabecera y una línea, como el S01b: el IVA lo saca la ficha de la línea). Al
 * crearla, el disparador del R14 (1120) da de alta solo al proveedor.
 */
async function llega(s: Sesion, t: number): Promise<{ id: string; emisor: string }> {
  const sello = `${Date.now()}`.slice(-8)
  const numero = `K08-${t}-${sello}`
  const emisor = `Emisor Nuevo K08 ${t}-${sello}, S.L.`
  const base = t === 1 ? 331.10 : 337.30
  const cuota = Math.round(base * 21) / 100
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date())
  const [empresa] = await rest<{ tax_id: string; legal_name: string }[]>(s, `company?select=tax_id,legal_name&id=eq.${GESTORIA_ID()}`)
  const f = await rest<{ id: string }[]>(s, 'supplier_invoice', {
    account_id: NUCLEO.id, company_id: GESTORIA_ID(), supplier_id: null, invoice_number: numero, invoice_date: hoy, status: 'en_revision', source: 'ocr',
    grand_total: base + cuota, tax_base_total: base, tax_total: cuota, needs_review: true, created_by_name: 'Prueba e2e K08', arrival_channel: 'correo',
    reading_confidence: 'probable',
    reading: {
      porque: ['Leída de su PDF (prueba e2e K08).'], comprobaciones: [], confianza: 'probable',
      factura: { proveedor: { nombre: emisor, nif: cifInventado() }, destinatario: { nombre: empresa.legal_name, nif: empresa.tax_id },
        numero, fecha: hoy, base, cuota, total: base + cuota, desgloseDe: 'papel' },
    },
  })
  const id = f[0].id
  await rest(s, 'supplier_invoice_line', { supplier_invoice_id: id, raw_text: 'Material de prueba K08', qty: 1, unit_price: null, line_amount: base, vat_pct: 21, position: 1, expense_account_code: '60000000' })
  return { id, emisor }
}

async function ponerDocumento(s: Sesion, facturaId: string, nombre: string) {
  const ruta = `${NUCLEO.id}/k08-e2e/${Date.now()}-${nombre}`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: pdfDe(`K08 - ${nombre}`),
  })
  expect(r.status, `subir ${nombre}: ${(await r.text()).slice(0, 200)}`).toBeLessThan(300)
  await rest(s, 'rpc/conta_recibida_papel_poner', { p_invoice: facturaId, p_ruta: ruta, p_nombre: nombre, p_quien_nombre: 'Prueba e2e K08' })
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

async function fichaLista(page: Page) {
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(ficha(page).locator('[data-prueba="cuadra"]')).toBeVisible({ timeout: 30_000 })
  await expect(laDeAntes(page)).toHaveCount(0)
}

async function introFuera(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true)
  await page.keyboard.press('Enter')
}

/** Las dos lecturas de ERP10 de la barra: un asiento atascado, la salida encendida y ninguna primera salida hecha. */
async function esperandoLaPrimeraSalida(page: Page) {
  await page.route('**/rest/v1/rpc/conta_erp10_atascados*', (r) => r.fulfill({ json: { encendida: true, sin_salir: 1, parados: 0 } }))
  await page.route('**/rest/v1/conta_erp10_salida_empresa*', (r) => r.fulfill({ json: [{ encendida: true }] }))
  await page.route('**/rest/v1/conta_erp10_envio*', (r) => r.fulfill({ json: [] }))
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`los arreglos de la ficha a ${ancho} × ${alto}: «Será la…», el nombre del proveedor y de las cuentas, y la barra en gris`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    await esperandoLaPrimeraSalida(page)
    const s = await entrarEnLaGestoria(page)

    // ── 3 · La barra de abajo: esperando la primera salida, en gris y con «Mandarla»; nada en ámbar de ERP10. ──
    const erp10 = page.locator('.k-estado-frase', { hasText: 'ERP10' })
    await expect(erp10).toHaveAttribute('data-tono', 'gris', { timeout: 30_000 })
    await expect(erp10).toContainText('Esperando la primera salida a ERP10 · Mandarla')
    await expect(page.locator('.k-estado-frase[data-tono="mira"]', { hasText: 'sin salir a ERP10' })).toHaveCount(0)
    if (t === 1) await page.screenshot({ path: `${DIR}/barra-primera-salida-${ancho}.png` })
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    const { id: factura, emisor: EMISOR } = await llega(s, t)
    await ponerDocumento(s, factura, 'k08.pdf')
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1 · Un proveedor recién dado de alta: el asiento se pinta con su subcuenta. Desde el R14 lo da de alta Sumied solo
    // con lo que trae la factura («Proveedor nuevo: …», con «Deshacer»), y la subcuenta ya existe antes de validar: no hay
    // «Darlo de alta» ni «Será la…» (puesto al día en el X31 · 0, como el K11b hizo con las demás). ──
    await page.goto(`/conta/documentos/recibidas/${factura}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(ficha(page).locator('.kf-duda', { hasText: 'Proveedor nuevo:' })).toContainText('lo ha dado de alta Sumied con lo que trae la factura.', { timeout: 30_000 })
    await expect(ficha(page).locator('.kf-duda', { hasText: 'Proveedor nuevo:' }).getByRole('button', { name: 'Deshacer' })).toBeVisible()
    const gasto = ficha(page).locator('#kf-cuenta-0')
    if (!(await gasto.inputValue()).trim()) {
      await gasto.fill('600')
      await page.getByRole('option', { name: /^60000000 · / }).click()
    }
    await expect(ficha(page).locator('#kf-proveedor')).toHaveValue(/^4[01]\d{6}$/, { timeout: 30_000 })
    const numero = await ficha(page).locator('#kf-proveedor').inputValue()
    await expect(asiento(page), 'la subcuenta del proveedor, en el asiento').toContainText(`(${numero})`, { timeout: 30_000 })
    await expect(asiento(page)).not.toContainText('Será la')
    await expect(asiento(page).locator('tr', { hasText: '60000000' })).toContainText('Compras de mercaderías')
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    expect(await loQueSeCorta(page, FICHA), `lo que se corta antes de validar a ${ancho}`).toEqual([])
    if (t === 1) { await cargada(page, 'antes de validar'); await page.screenshot({ path: `${DIR}/proveedor-nuevo-antes-${ancho}.png` }) }
    await introFuera(page)
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })

    // ── 2 · Validada: la casilla dice el nombre; cada línea, el nombre de su cuenta. ──
    await page.goto(`/conta/documentos/recibidas/${factura}`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(ficha(page).locator('.kf-estado')).toContainText(/Contabilizada · asiento \d+\./, { timeout: 30_000 })
    // La casilla «Proveedor», con su código (la maqueta); el nombre, entero, en «Nombre» (Julio, 21/11).
    await expect(ficha(page).locator('#kf-proveedor')).toHaveValue(numero)
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue(EMISOR)
    await expect(asiento(page).locator('tr', { hasText: '60000000' })).toContainText('Compras de mercaderías')
    await expect(asiento(page)).not.toContainText('Bebidas y producto')
    await expect(asiento(page)).not.toContainText('Será la')
    // La subcuenta del proveedor, la misma que antes de validar, con su nombre.
    await expect(asiento(page).locator('tr', { hasText: numero })).toContainText(EMISOR)
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, validada, a ${ancho}`).toEqual([])
    if (t === 1) { await cargada(page, 'validada'); await page.screenshot({ path: `${DIR}/proveedor-nuevo-validada-${ancho}.png` }) }

    expect(errores, 'errores de la página').toEqual([])
  })
}
