/// <reference lib="dom" />
// tests/e2e/conta/k09/validar.spec.ts
//
// K09 · Nunca se valida una recibida incompleta ni repetida, contra staging, con la cuenta del núcleo
// (semilla K02) en su gestoría y la semilla K09, a 1456 × 816 y a 1366 × 768:
//   1. una sin cuenta de gasto: la franja lo dice, Intro no valida y dice por qué («Falta la cuenta de
//      gasto en la línea 1»), y no pasa a la siguiente;
//   2. una repetida: se valida «K09-t-000123»; la de «k09 t 123» (el mismo número escrito de otra forma)
//      dice cuál es la otra, Intro no la valida, y «Abrirla» abre la otra, contabilizada.
// Lo que dice la base (conta_recibida_motivos, la 0945) lo prueba staging en ROLLBACK: aquí, la pantalla,
// que lo dice antes de pulsar.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k09'
const factura = (t: number, n: number) => enCarril(`c0e90000-0000-4000-8000-000000000d${t}${n}`)
const PROVEEDOR = (t: number) => (t === 1 ? 'Proveedor de Prueba Ficha Uno, S.L.' : 'Proveedor de Prueba Ficha Dos, S.L.')
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const aviso = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="aviso-ficha"]')
const franja = (page: Page) => ficha(page).locator('.kf-estado')
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
  const ruta = `${NUCLEO.id}/k09-e2e/${Date.now()}-${nombre}`
  const r = await fetch(`${STAGING_URL}/storage/v1/object/receipt-uploads/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: pdfDe(`K09 - ${nombre}`),
  })
  expect(r.status, `subir ${nombre}: ${(await r.text()).slice(0, 200)}`).toBeLessThan(300)
  await rest(s, 'rpc/conta_recibida_papel_poner', { p_invoice: facturaId, p_ruta: ruta, p_nombre: nombre, p_quien_nombre: 'Prueba e2e K09' })
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

async function sinDudaDeGasto(page: Page) {
  const dejar = ficha(page).locator('.kf-duda').getByRole('button', { name: /^Dejar / })
  if (await dejar.count()) await dejar.first().click()
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`no se valida lo incompleto ni lo repetido a ${ancho} × ${alto}: sin cuenta de gasto, y la repetida con «Abrirla»`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    await ponerDocumento(s, factura(t, 2), 'k09-a.pdf')
    if (alto < 800) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1 · Sin cuenta de gasto: la franja lo dice, Intro no valida y dice por qué. ──
    await page.goto(`/conta/documentos/recibidas/${factura(t, 1)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await sinDudaDeGasto(page)
    await ficha(page).locator('#kf-cuenta-0').fill('')
    await expect(franja(page)).toContainText('Falta la cuenta de gasto', { timeout: 30_000 })
    await introFuera(page)
    await expect(aviso(page)).toContainText('sin validar: Falta la cuenta de gasto en la línea 1', { timeout: 60_000 })
    await expect(aviso(page)).toContainText('No paso a la siguiente.')
    await expect(page).toHaveURL(new RegExp(factura(t, 1)))
    const [sin] = await rest<{ status: string }[]>(s, `supplier_invoice?select=status&account_id=eq.${NUCLEO.id}&id=eq.${factura(t, 1)}`)
    expect(sin.status, 'la de sin cuenta de gasto no se ha validado').not.toBe('aprobada')
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, sin cuenta de gasto, a ${ancho}`).toEqual([])
    if (t === 1) { await cargada(page, 'sin cuenta de gasto'); await page.screenshot({ path: `${DIR}/sin-cuenta-de-gasto-${ancho}.png` }) }

    // ── 2 · La repetida: se valida la K09-t-000123 … ──
    await page.goto(`/conta/documentos/recibidas/${factura(t, 2)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await sinDudaDeGasto(page)
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toContainText('Cuadra', { timeout: 30_000 })
    await introFuera(page)
    await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 60_000 })
    // … y la «k09 t 123» dice cuál es la otra, no se valida y «Abrirla» la abre.
    await page.goto(`/conta/documentos/recibidas/${factura(t, 3)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    const repetida = ficha(page).locator('[data-prueba="repetida"]')
    await expect(repetida).toContainText(new RegExp(`Ya está la K09-${t}-000123 de ${PROVEEDOR(t).replace(/[.,]/g, '\\$&')}, asiento 2/\\d+\\.`), { timeout: 30_000 })
    await expect(franja(page)).toContainText('Repetida: Ya está la')
    await expect(repetida.getByRole('checkbox', { name: /No es la misma/ })).toBeVisible()
    await sinDudaDeGasto(page)
    await introFuera(page)
    await expect(aviso(page)).toContainText(`sin validar: Ya está la K09-${t}-000123`, { timeout: 60_000 })
    await expect(page).toHaveURL(new RegExp(factura(t, 3)))
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, la repetida, a ${ancho}`).toEqual([])
    if (t === 1) { await cargada(page, 'la repetida'); await page.screenshot({ path: `${DIR}/repetida-${ancho}.png` }) }
    await repetida.getByRole('link', { name: 'Abrirla' }).click()
    await expect(page).toHaveURL(new RegExp(factura(t, 2)), { timeout: 30_000 })
    await fichaLista(page)
    await expect(franja(page)).toContainText(/Contabilizada · asiento \d+\./, { timeout: 30_000 })
    await expect(ficha(page).locator('#kf-numero')).toHaveValue(`K09-${t}-000123`)

    expect(errores, 'errores de la página').toEqual([])
  })
}
