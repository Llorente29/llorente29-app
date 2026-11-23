/// <reference lib="dom" />
// tests/e2e/conta/x27/fichas.spec.ts — X27 · La ficha de proveedor y la de cliente, como ERP10, contra staging, a
// 1456 × 816 y a 1366 × 768, en la gestoría de ejemplo del núcleo (semillas K02, K04 y K05):
//   1. Un proveedor nuevo, solo con el teclado: el nombre, Intro casilla a casilla hasta el final, y se da de alta con
//      su 400 («Dado de alta: …, con la subcuenta 400…»).
//   2. Cambiarle la subcuenta de gasto (una 628 nueva, inventada) y guardar: una recibida a mano nueva la propone.
//   3. Una recibida validada del «Proveedor de Prueba Ficha Uno» (con su NIF: sin él no se contabiliza): en su ficha,
//      «Movimientos» con su haber de 121,00 y el saldo; «Saldos», octubre con su haber.
//   4. La ficha del cliente «Cliente de Prueba Emitida Uno» con su «Subcuenta de cobro», guardada.
//   5. Las dos caben a 1366 (ninguna casilla se sale de la pantalla).
// Números y nombres inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x27'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const CLIENTE = () => enCarril('c0e50000-0000-4000-8000-0000000000c1')
const PROVEEDOR = () => enCarril('c0e40000-0000-4000-8000-0000000000a1')
const zona = (page: Page) => page.locator('.k-zona[data-activa="si"]')
const fichaProv = (page: Page) => zona(page).locator('[data-prueba="ficha-proveedor-nucleo"]')
const fichaCli = (page: Page) => zona(page).locator('[data-prueba="ficha-cliente-nucleo"]')
const recibida = (page: Page) => zona(page).locator('[data-prueba="ficha-recibida-nucleo"]')

async function rpc<T>(s: Sesion, nombre: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  expect(r.status, `${nombre}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return JSON.parse(texto) as T
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

/** Ninguna casilla de la ficha se sale de la pantalla ni de su ventana (cabe a lo ancho). */
async function cabe(page: Page, sel: string, ancho: number) {
  const fuera = await page.locator(`${sel} input, ${sel} select`).evaluateAll((els, w) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .filter((e) => { const r = e.getBoundingClientRect(); return r.right > (w as number) + 1 || r.left < -1 })
    .map((e) => e.id || e.getAttribute('aria-label') || e.tagName), ancho)
  expect(fuera, `casillas que se salen a ${ancho}`).toEqual([])
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`X27 · ${ancho} × ${alto}: la ficha de proveedor (alta con el teclado, subcuenta de gasto, movimientos y saldos) y la de cliente`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(300_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const n = `${Date.now() % 100000}`
    const nombre = `Proveedor Inventado X27 ${ancho}-${n}, S.L.`

    // 1 · El alta, solo con el teclado.
    await page.goto('/conta/clientes-y-proveedores/proveedor/nuevo', { timeout: 30_000 })
    await expect(fichaProv(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#ft-nombre')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.type(nombre)
    const aviso = fichaProv(page).locator('.kp-barra-aviso')
    // Intro casilla a casilla; en la última, guarda y abre su ficha (se para ahí: un Intro de más guardaría otra vez).
    for (let i = 0; i < 40 && !/\/proveedor\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname); i++) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(150)
    }
    await expect(aviso).toContainText(new RegExp(`Dado de alta: ${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, con la subcuenta 400\\d+\\.`), { timeout: 30_000 })
    await expect(page).toHaveURL(/\/proveedor\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    const sub = await page.locator('#ft-subcuenta').inputValue()
    expect(sub).toMatch(/^400\d+$/)
    console.log(`[X27] ${await aviso.textContent()}`)

    // 2 · Su subcuenta de gasto: una 628 nueva. Guardar, y una recibida a mano nueva la propone.
    const gasto = await rpc<{ code: string }>(s, 'company_account_add', { p_company: EMPRESA(), p_hoja: '628', p_nombre: `Electricidad X27 ${n}`, p_plain_name: null, p_entity: null, p_entity_id: null, p_quien_nombre: 'Prueba e2e X27', p_source: 'manual' })
    await page.reload()
    await expect(fichaProv(page)).toBeVisible({ timeout: 30_000 })
    await page.locator('#ft-gasto').click()
    await page.keyboard.type(gasto.code)
    await page.keyboard.press('Enter')
    await expect(fichaProv(page).getByRole('textbox', { name: 'Subcuenta de gasto: su nombre' })).toHaveValue(`Electricidad X27 ${n}`)
    await fichaProv(page).locator('[data-boton="guardar"]').click()
    await expect(aviso).toContainText(`Guardado: ${nombre}.`, { timeout: 30_000 })
    await cabe(page, '[data-prueba="ficha-proveedor-nucleo"]', ancho)
    await page.screenshot({ path: `${DIR}/proveedor-${ancho}.png` })

    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(recibida(page)).toBeVisible({ timeout: 30_000 })
    // K11b · La nueva entra por la primera casilla de la pantalla (la fecha de la factura, la de hoy); Intro pasa al proveedor.
    await expect(page.locator('#kf-fecha')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.press('Enter')
    await expect(page.locator('#kf-proveedor')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.type(`Proveedor Inventado X27 ${ancho}-${n}`)
    await page.keyboard.press('Enter')
    await expect(recibida(page).locator('#kf-cuenta-0'), 'la recibida nueva propone su subcuenta de gasto').toHaveValue(gasto.code, { timeout: 30_000 })

    // 3 · Una recibida validada del proveedor de la semilla (con su NIF: sin él no se contabiliza), y sus cifras en
    //     «Movimientos» y en «Saldos» de su ficha. La de arriba se deja sin guardar (el aviso del navegador, aceptado).
    page.on('dialog', (d) => void d.accept())
    const numero = `X27-${ancho}-${n}`
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    await expect(recibida(page)).toBeVisible({ timeout: 30_000 })
    // K11b · La nueva entra por la primera casilla de la pantalla (la fecha de la factura, la de hoy); Intro pasa al proveedor.
    await expect(page.locator('#kf-fecha')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.press('Enter')
    await expect(page.locator('#kf-proveedor')).toBeFocused({ timeout: 30_000 })
    await page.keyboard.type('Ficha Uno')
    await page.keyboard.press('Enter')
    await recibida(page).locator('#kf-numero').fill(numero)
    await recibida(page).locator('#kf-fecha').fill('20/10/2026')
    await recibida(page).locator('#kf-fecha').press('Tab')
    await recibida(page).getByRole('textbox', { name: 'Base 1' }).fill('100')
    await recibida(page).getByRole('combobox', { name: 'Tipo de IVA 1' }).selectOption('21')
    await recibida(page).getByRole('button', { name: 'Quitar el tipo 10 %' }).click()
    await recibida(page).locator('#kf-cuenta-0').fill('62800000')
    await page.getByRole('option', { name: /^62800000 · / }).click()
    const local = recibida(page).getByRole('combobox', { name: 'Local' })
    if (await local.isEnabled()) await local.selectOption({ index: 1 })
    await recibida(page).getByRole('checkbox', { name: 'Guardarla sin documento' }).check()
    await recibida(page).getByRole('textbox', { name: 'Por qué no tiene documento' }).fill('Prueba e2e X27: escrita a mano, sin documento')
    await expect(async () => {
      if (!(await page.getByText(/Apuntada y validada/).first().isVisible())) await recibida(page).locator('[data-guardar-y-siguiente]').click()
      await expect(page.getByText(/Apuntada y validada/).first()).toBeVisible({ timeout: 10_000 })
    }).toPass({ timeout: 90_000, intervals: [2_000] })

    await page.goto(`/conta/clientes-y-proveedores/proveedor/${PROVEEDOR()}`, { timeout: 30_000 })
    await expect(fichaProv(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#ft-subcuenta')).toHaveValue('40000071')
    await fichaProv(page).getByRole('tab', { name: 'Movimientos' }).click()
    const suya = fichaProv(page).getByRole('table', { name: 'Sus movimientos' }).locator('tbody tr', { hasText: numero })
    await expect(suya).toContainText('121,00', { timeout: 30_000 })
    await expect(fichaProv(page).locator('[data-prueba="saldo-final"]')).toHaveText(/^Saldo -?[\d.]+,\d\d$/)
    console.log(`[X27] Movimientos · ${await suya.textContent()} · ${await fichaProv(page).locator('[data-prueba="saldo-final"]').textContent()}`)
    await fichaProv(page).getByRole('tab', { name: 'Saldos' }).click()
    const octubre = fichaProv(page).getByRole('table', { name: 'Sus saldos por mes' }).locator('tbody tr', { hasText: 'Octubre 2026' })
    await expect(octubre).toBeVisible({ timeout: 30_000 })
    const haberOct = await octubre.locator('td').nth(2).textContent()
    expect(Number((haberOct ?? '0').replace(/\./g, '').replace(',', '.')), 'el haber de octubre lleva la recibida').toBeGreaterThanOrEqual(121)
    console.log(`[X27] Saldos · ${await octubre.textContent()}`)
    await page.screenshot({ path: `${DIR}/saldos-${ancho}.png` })

    // 4 · La ficha del cliente, con su «Subcuenta de cobro».
    await page.goto(`/conta/clientes-y-proveedores/${CLIENTE()}`, { timeout: 30_000 })
    await expect(fichaCli(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#ft-nombre')).toHaveValue(/Cliente de Prueba Emitida Uno/)
    await expect(fichaCli(page).locator('label[for="ft-pago"]')).toHaveText('Subcuenta de cobro')
    await page.locator('#ft-pago').click()
    await page.keyboard.press('F4')
    await page.getByRole('dialog').locator('tbody tr').first().click()
    await expect(fichaCli(page).getByRole('textbox', { name: 'Subcuenta de cobro: su nombre' })).not.toHaveValue('')
    // Uno distinto en cada pasada: las dos pruebas guardan el mismo cliente del carril, y si la segunda escribe lo mismo
    // que la primera la ficha dice, con razón, «No había nada distinto» (e2e 45029395595).
    await page.locator('#ft-telefono').fill(`9${n.padStart(8, '0')}`)
    await fichaCli(page).locator('[data-boton="guardar"]').click()
    await expect(fichaCli(page).locator('.kp-barra-aviso')).toContainText('Guardado: Cliente de Prueba Emitida Uno', { timeout: 30_000 })
    await cabe(page, '[data-prueba="ficha-cliente-nucleo"]', ancho)
    await page.screenshot({ path: `${DIR}/cliente-${ancho}.png` })
    expect(errores).toEqual([])
  })
}
