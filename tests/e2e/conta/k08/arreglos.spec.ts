/// <reference lib="dom" />
// tests/e2e/conta/k08/arreglos.spec.ts
//
// K08 · Cinco arreglos de la ficha, vistos grabando facturas de verdad (Julio, 21/11), contra staging, con
// la cuenta del núcleo (semilla K02) en su gestoría y la semilla K08, a 1456 × 816 y a 1366 × 768:
//   1. una factura de un proveedor recién dado de alta enseña su asiento antes de validar, con la línea del
//      proveedor «Será la 4000000N · Proveedores · …» (aún no tiene subcuenta: se la crea la base al validar);
//   2. validada, la casilla «Proveedor» con su código (el nombre, en «Nombre»), y cada línea del asiento, el nombre de su cuenta
//      («Compras de mercaderías», nunca su explicación);
//   3. la barra de abajo, cuando la empresa espera su primera salida a ERP10: en gris, «Esperando la primera
//      salida a ERP10 · Mandarla». Esa empresa no se puede montar en staging sin un asiento validado hace más
//      de una hora (un asiento validado no se toca), así que las dos lecturas de ERP10 de la barra se
//      contestan desde la prueba (page.route): lo que se prueba es la pantalla con esos datos.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k08'
const factura = (t: number) => enCarril(`c0e80000-0000-4000-8000-000000000d${t}1`)
const EMISOR = (t: number) => `Emisor Nuevo K08 de Prueba ${t}, S.L.`
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const aviso = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="aviso-ficha"]')
const asiento = (page: Page) => ficha(page).locator('.kf-asiento')
const laDeAntes = (page: Page) => page.locator('.k-zona[data-activa="si"] .s-pagina')

async function rest<T>(s: Sesion, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
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

    // ── 3 · La barra de abajo: en gris y sin ámbar de ERP10. X31 · 0: con la salida a ERP10 parada, sin «Mandarla»
    // y con el motivo al pasar el ratón. ──
    const erp10 = page.locator('.k-estado-frase', { hasText: 'ERP10' })
    await expect(erp10).toHaveAttribute('data-tono', 'gris', { timeout: 30_000 })
    await expect(erp10).toContainText('La salida a ERP10 está parada')
    await expect(erp10).not.toContainText('Mandarla')
    await expect(erp10).toHaveAttribute('title', 'Falta la comprobación de lo que ya hay en ERP10.')
    await expect(page.locator('.k-estado-frase[data-tono="mira"]', { hasText: 'sin salir a ERP10' })).toHaveCount(0)
    if (t === 1) await page.screenshot({ path: `${DIR}/barra-primera-salida-${ancho}.png` })
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    await ponerDocumento(s, factura(t), 'k08.pdf')
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1 · Un proveedor recién dado de alta: el asiento se pinta, con «Será la 4000000N». ──
    await page.goto(`/conta/documentos/recibidas/${factura(t)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await ficha(page).locator('.kf-duda').getByRole('button', { name: 'Darlo de alta' }).click()
    const form = page.locator('[data-prueba="formulario-alta-factura"]')
    await expect(form).toBeVisible()
    await form.getByRole('button', { name: 'Darlo de alta y elegirlo' }).click()
    await expect(aviso(page)).toContainText('dado de alta y elegido', { timeout: 30_000 })
    const gasto = ficha(page).locator('#kf-cuenta-0')
    if (!(await gasto.inputValue()).trim()) {
      await gasto.fill('600')
      await page.getByRole('option', { name: /^60000000 · / }).click()
    }
    await expect(ficha(page).locator('#kf-proveedor')).toHaveValue(/^4000\d{4}$/, { timeout: 30_000 })
    const sera = new RegExp(`Será la 4000\\d{4} · Proveedores · ${EMISOR(t).replace(/[.,]/g, '\\$&')}`)
    await expect(asiento(page)).toContainText(sera, { timeout: 30_000 })
    await expect(asiento(page).locator('tr', { hasText: '60000000' })).toContainText('Compras de mercaderías')
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    expect(await loQueSeCorta(page, FICHA), `lo que se corta antes de validar a ${ancho}`).toEqual([])
    if (t === 1) { await cargada(page, 'antes de validar'); await page.screenshot({ path: `${DIR}/proveedor-nuevo-antes-${ancho}.png` }) }
    const numero = (await asiento(page).textContent())?.match(/Será la (4000\d{4})/)?.[1]
    await introFuera(page)
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })

    // ── 2 · Validada: la casilla dice el nombre; cada línea, el nombre de su cuenta. ──
    await page.goto(`/conta/documentos/recibidas/${factura(t)}`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(ficha(page).locator('.kf-estado')).toContainText(/Contabilizada · asiento \d+\./, { timeout: 30_000 })
    // La casilla «Proveedor», con su código (la maqueta); el nombre, entero, en «Nombre» (Julio, 21/11).
    await expect(ficha(page).locator('#kf-proveedor')).toHaveValue(/^4000\d{4}$/)
    if (numero) await expect(ficha(page).locator('#kf-proveedor')).toHaveValue(numero)
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue(EMISOR(t))
    await expect(asiento(page).locator('tr', { hasText: '60000000' })).toContainText('Compras de mercaderías')
    await expect(asiento(page)).not.toContainText('Bebidas y producto')
    await expect(asiento(page)).not.toContainText('Será la')
    // La subcuenta que se creó al validar es la que dijo antes.
    if (numero) await expect(asiento(page).locator('tr', { hasText: numero })).toContainText(`Proveedores · ${EMISOR(t)}`)
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, validada, a ${ancho}`).toEqual([])
    if (t === 1) { await cargada(page, 'validada'); await page.screenshot({ path: `${DIR}/proveedor-nuevo-validada-${ancho}.png` }) }

    expect(errores, 'errores de la página').toEqual([])
  })
}
