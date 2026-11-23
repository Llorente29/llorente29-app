/// <reference lib="dom" />
// tests/e2e/conta/k07/una-ficha.spec.ts
//
// K07 · Una factura, una sola ficha, y cambiar su documento, contra staging,
// con la cuenta del núcleo (semilla K02) en su gestoría y la semilla K07, a
// 1456 × 816 y a 1366 × 768, con el navegador en español:
//   1. una de por revisar, con su documento: se escribe en ella y se le cambia
//      el documento («Cambiar el documento»), sin perder lo escrito; se valida
//      con Intro y pasa a la siguiente;
//   2. ‹ vuelve a ella, ya validada, en la ficha nueva (nunca la de antes): la
//      franja «Contabilizada · asiento N», las casillas sin poder escribir y el
//      asiento validado con su número; nada cortado;
//   3. se le cambia el documento otra vez, ya contabilizada: pide confirmar, lo
//      cambia (el asiento no cambia) y en «Más › Ver el historial» están los
//      dos cambios, con el de antes;
//   4. el recorrido de Julio (20/11): una leída de un emisor que no existe,
//      «Darlo de alta», la cuenta de gasto, Intro, y abrirla otra vez: todo en
//      la ficha nueva, sin pasar nunca por la de antes.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k07'
const factura = (t: number, n: number) => enCarril(`c0e70000-0000-4000-8000-000000000d${t}${n}`)
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const franja = (page: Page) => ficha(page).locator('.kf-estado')
const aviso = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="aviso-ficha"]')
/** La pantalla de antes (RevisarFacturaPage): no puede salir nunca en la pestaña que se ve. */
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

/** Un PDF pequeño de verdad (una página con su texto), para subirlo y para cambiarlo. */
function pdfDe(texto: string): Buffer {
  const flujo = `BT /F1 18 Tf 60 760 Td (${texto}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const sitios: number[] = []
  objetos.forEach((o, i) => { sitios.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${sitios.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Sube un PDF a la carpeta de la cuenta y se lo pone a la factura, como «Subir el PDF» (conta_recibida_papel_poner). */
async function ponerDocumento(s: Sesion, facturaId: string, nombre: string) {
  const ruta = `${NUCLEO.id}/k07-e2e/${Date.now()}-${nombre}`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: new Uint8Array(pdfDe(`K07 - ${nombre}`)),
  })
  expect(r.status, `subir ${nombre}: ${(await r.text()).slice(0, 200)}`).toBeLessThan(300)
  await rest(s, 'rpc/conta_recibida_papel_poner', { p_invoice: facturaId, p_ruta: ruta, p_nombre: nombre, p_quien_nombre: 'Prueba e2e K07' })
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

/**
 * Intro fuera de una casilla: «Guardar y siguiente» (decisión 11). Dentro de una casilla, Intro pasa a la siguiente;
 * por eso primero se saca el foco de donde se ha escrito (el body no se enfoca: pulsar sobre él no lo saca; e2e 44807111244).
 */
async function introFuera(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true)
  await page.keyboard.press('Enter')
}

/** Si sale la duda del gasto, se deja la propuesta (no es lo que se prueba aquí). */
async function sinDudaDeGasto(page: Page) {
  const dejar = ficha(page).locator('.kf-duda').getByRole('button', { name: /^Dejar / })
  if (await dejar.count()) await dejar.first().click()
}

/** La validada en la ficha nueva: franja verde, casillas sin escribir, el asiento con su número, nada cortado, nunca la de antes. */
async function laValidada(page: Page, donde: string) {
  await fichaLista(page)
  await expect(franja(page)).toContainText(/Contabilizada · asiento \d+\./, { timeout: 30_000 })
  await expect(franja(page)).toContainText(/Por pagar|Pagada/)
  await expect(ficha(page).locator('#kf-numero')).toBeDisabled()
  await expect(ficha(page).locator('#kf-proveedor')).toBeDisabled()
  await expect(ficha(page).locator('[data-guardar-y-siguiente]')).toBeDisabled()
  await expect(ficha(page).locator('[data-prueba="cuadra"]')).toHaveText(/^Validado · asiento \d+$/, { timeout: 30_000 })
  await expect(ficha(page).locator('.kf-asiento tbody tr').first()).toBeVisible({ timeout: 30_000 })
  expect(await loQueSeCorta(page, FICHA), `lo que se corta, ${donde}`).toEqual([])
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`una sola ficha a ${ancho} × ${alto}: cambiar el documento sin perder lo escrito, validar con Intro, ‹ y la validada en la nueva`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(360_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    await ponerDocumento(s, factura(t, 1), 'k07-a.pdf')
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1 · Por revisar: se escribe, se cambia el documento y lo escrito sigue. ──
    await page.goto(`/conta/documentos/recibidas/${factura(t, 1)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(franja(page)).not.toContainText('Contabilizada')
    const cambiar = ficha(page).getByRole('button', { name: 'Cambiar el documento' })
    await expect(cambiar).toBeVisible({ timeout: 30_000 })
    const numero = ficha(page).locator('#kf-numero')
    await numero.fill(`K07-${t}-1-B`)
    await ficha(page).locator('[data-prueba="cambiar-documento"]').setInputFiles({ name: 'k07-b.pdf', mimeType: 'application/pdf', buffer: pdfDe('K07 - k07-b.pdf') })
    await expect(aviso(page)).toContainText('Documento nuevo: «k07-b.pdf». Se pone al guardar, sin perder lo escrito; el de antes queda en su historial.')
    await expect(numero).toHaveValue(`K07-${t}-1-B`)
    await expect(ficha(page).locator('.kf-hoja')).toBeVisible()
    await sinDudaDeGasto(page)
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    // Intro fuera de una casilla: «Guardar y siguiente» guarda (el documento nuevo y el número), valida y pasa a la siguiente.
    await introFuera(page)
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    await expect(page).not.toHaveURL(new RegExp(factura(t, 1)), { timeout: 30_000 })
    await fichaLista(page)

    // ── 2 · ‹ vuelve a la validada, en la ficha nueva. ──
    await ficha(page).getByRole('button', { name: 'El anterior' }).click()
    await expect(page).toHaveURL(new RegExp(factura(t, 1)), { timeout: 30_000 })
    await laValidada(page, `la validada a ${ancho}`)
    await expect(ficha(page).locator('#kf-numero')).toHaveValue(`K07-${t}-1-B`)
    await cargada(page, 'la validada')
    await page.screenshot({ path: `${DIR}/validada-${ancho}.png` })

    // ── 3 · Cambiar el documento de la contabilizada: confirma, lo cambia y el historial tiene el de antes. ──
    await ficha(page).locator('[data-prueba="cambiar-documento"]').setInputFiles({ name: 'k07-c.pdf', mimeType: 'application/pdf', buffer: pdfDe('K07 - k07-c.pdf') })
    const confirma = ficha(page).locator('[data-prueba="confirmar-documento"]')
    await expect(confirma).toContainText('Cambias el documento de una factura contabilizada. El de antes queda en su historial.')
    await expect(confirma).toContainText('«k07-c.pdf»')
    if (t === 1) await page.screenshot({ path: `${DIR}/cambiar-documento-contabilizada-${ancho}.png` })
    await confirma.getByRole('button', { name: 'Cambiarlo' }).click()
    await expect(aviso(page)).toContainText('Documento cambiado: «k07-c.pdf». El de antes queda en su historial; el asiento no cambia.', { timeout: 60_000 })
    await laValidada(page, `después de cambiar el documento a ${ancho}`)
    const [f] = await rest<{ raw_document_url: string; status: string }[]>(s, `supplier_invoice?select=raw_document_url,status&account_id=eq.${NUCLEO.id}&id=eq.${factura(t, 1)}`)
    expect(f.raw_document_url).toMatch(/k07-c\.pdf$/)
    await ficha(page).getByRole('button', { name: 'Más' }).click()
    await page.locator('[data-mas="historial"]').click()
    const historial = page.locator('[data-prueba="historial"]')
    await expect(historial).toContainText(/Documento cambiado: «.*» → «k07-c\.pdf» \(ya contabilizada; el asiento no cambió\)\. El de antes sigue guardado\./, { timeout: 30_000 })
    await expect(historial).toContainText(/Documento cambiado: «.*k07-a\.pdf» → «k07-b\.pdf»\. El de antes sigue guardado\./)
    await expect(historial).toContainText(/Contabilizada: asiento \d+\./)
    if (t === 1) { await cargada(page, 'el historial'); await page.screenshot({ path: `${DIR}/historial-${ancho}.png` }) }
    await historial.getByRole('button', { name: 'Cerrar' }).click()
    await expect(laDeAntes(page)).toHaveCount(0)

    expect(errores, 'errores de la página').toEqual([])
  })

  test(`el recorrido de Julio a ${ancho} × ${alto}: un emisor que no existe, «Darlo de alta», Intro y abrirla otra vez, siempre en la nueva`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    await ponerDocumento(s, factura(t, 3), 'k07-julio.pdf')
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    await page.goto(`/conta/documentos/recibidas/${factura(t, 3)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(franja(page)).toContainText('No conozco al que la emite', { timeout: 30_000 })
    await ficha(page).locator('.kf-duda').getByRole('button', { name: 'Darlo de alta' }).click()
    const form = page.locator('[data-prueba="formulario-alta-factura"]')
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Nombre con el que lo conocéis')).toHaveValue(`Emisor Nuevo K07 de Prueba ${t}, S.L.`)
    await form.getByRole('button', { name: 'Darlo de alta y elegirlo' }).click()
    await expect(aviso(page)).toContainText('dado de alta y elegido', { timeout: 30_000 })
    await expect(laDeAntes(page)).toHaveCount(0)
    // La cuenta de gasto: la propuesta, o la 60000000 si no la hay.
    const gasto = ficha(page).locator('#kf-cuenta-0')
    if (!(await gasto.inputValue()).trim()) {
      await gasto.fill('600')
      await page.getByRole('option', { name: /^60000000 · / }).click()
    }
    await sinDudaDeGasto(page)
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    await introFuera(page)
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    await expect(laDeAntes(page)).toHaveCount(0)

    // Abrirla otra vez: la misma ficha, contabilizada.
    await page.goto(`/conta/documentos/recibidas/${factura(t, 3)}`, { timeout: 30_000 })
    await laValidada(page, `el recorrido de Julio a ${ancho}`)
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue(`Emisor Nuevo K07 de Prueba ${t}, S.L.`)
    if (t === 1) { await cargada(page, 'la de Julio, abierta otra vez'); await page.screenshot({ path: `${DIR}/recorrido-julio-${ancho}.png` }) }

    expect(errores, 'errores de la página').toEqual([])
  })
}
