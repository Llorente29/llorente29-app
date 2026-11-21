/// <reference lib="dom" />
// tests/e2e/conta/k10/cuenta-de-pago.spec.ts
//
// K10 · La «Cuenta de pago» en la ficha del proveedor, como en ERP10, contra staging, con la cuenta del
// núcleo (semilla K02) en su gestoría y la semilla K10, a 1456 × 816 y a 1366 × 768:
//   1. en la ficha del proveedor de prueba se pone la 43000002 como cuenta de pago (debajo de la forma
//      de pago, con su código y su nombre), y lo dice;
//   2. su factura por revisar la trae en «Cómo se paga», «De su ficha»;
//   3. la contrapartida, con una del 21x: el aviso «Va a inmovilizado…»;
//   4. el proveedor, por su código: escribir su 400000xx lo encuentra;
//   5. la barra de arriba, con el logo de Sumied (la imagen, nunca escrito con una fuente).
// Y en el móvil, la cabecera con el logo. Lo que hace la base (la tanda pasa la 430 de la plataforma a
// su ficha, cualquier subcuenta, la vuelta atrás) lo prueba staging en ROLLBACK.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'
import { loQueSeCorta } from '../k05/nadaCortado'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k10'
const EMPRESA = () => enCarril('c0e20000-0000-4000-8000-0000000000e3')
const PROVEEDOR = (t: number) => enCarril(`c0ea0000-0000-4000-8000-0000000000b${t}`)
const FACTURA = (t: number) => enCarril(`c0ea0000-0000-4000-8000-000000000d${t}1`)
const SUBCUENTA = (t: number) => (t === 1 ? '40000082' : '40000083')
const NOMBRE = (t: number) => (t === 1 ? 'Proveedor de Prueba K10 Uno, S.L.' : 'Proveedor de Prueba K10 Dos, S.L.')
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
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

/** El logo: la imagen del SVG blanco aprobado, cargada, sin deformar y a la altura de la barra. */
async function logoBien(page: Page, donde: string) {
  const img = page.locator(`${donde} img`).first()
  await expect(img).toBeVisible({ timeout: 30_000 })
  await expect(img).toHaveAttribute('src', /sumied-logo-horizontal-blanco\.svg/)
  const m = await img.evaluate((el) => {
    const i = el as HTMLImageElement
    const r = i.getBoundingClientRect()
    return { cargada: i.complete && i.naturalWidth > 0, ancho: r.width, alto: r.height, proporcion: i.naturalWidth / Math.max(1, i.naturalHeight) }
  })
  expect(m.cargada, `el logo de ${donde} no ha cargado`).toBe(true)
  expect(Math.abs(m.ancho / m.alto - m.proporcion), `el logo de ${donde} está deformado (${m.ancho}×${m.alto})`).toBeLessThan(0.05)
  return m
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`la cuenta de pago en la ficha del proveedor y su factura la trae, a ${ancho} × ${alto}; el 21x, el proveedor por su código y el logo`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    // Desde cero: sin cuenta de pago en su ficha (si una pasada anterior la dejó puesta).
    await rest(s, 'rpc/company_account_link_unset', { p_company: EMPRESA(), p_entity: 'supplier', p_entity_id: PROVEEDOR(t), p_role: 'pago', p_quien_nombre: 'Prueba e2e K10' })

    // ── 5 · La barra, con el logo. ──
    const logo = await logoBien(page, '[data-prueba="logo-barra"]')
    // La barra es la fila que lleva el logo (su padre): el logo cabe en ella, y la captura llega hasta su borde de abajo.
    const barra = await page.locator('[data-prueba="logo-barra"]').evaluate((el) => { const r = el.parentElement!.getBoundingClientRect(); return { alto: r.height, abajo: r.bottom } })
    expect(logo.alto, 'el logo cabe en la barra').toBeLessThanOrEqual(barra.alto)
    if (t === 1) await cargada(page, 'la barra')
    await page.screenshot({ path: `${DIR}/barra-${ancho}.png`, clip: { x: 0, y: 0, width: ancho, height: Math.ceil(barra.abajo) + 4 } })

    // ── 1 · En la ficha del proveedor, «Cuenta de pago»: la 43000002. ──
    await page.goto(`/conta/clientes-y-proveedores/proveedor/${PROVEEDOR(t)}/pago`, { timeout: 30_000 })
    const casilla = page.locator('[data-prueba="cuenta-de-pago"]')
    await expect(casilla).toBeVisible({ timeout: 30_000 })
    await expect(casilla.locator('#cuenta-de-pago')).toBeEnabled({ timeout: 30_000 })
    await expect(casilla.locator('#cuenta-de-pago')).toHaveValue('', { timeout: 30_000 })
    await casilla.locator('#cuenta-de-pago').fill('43000002')
    await page.getByRole('option', { name: /^43000002 · / }).click()
    await expect(page.locator('[data-prueba="cuenta-de-pago-dicho"]')).toContainText('Guardada: la 43000002', { timeout: 30_000 })
    await expect(casilla.locator('#cuenta-de-pago')).toHaveValue('43000002', { timeout: 30_000 })
    await expect(casilla.getByRole('textbox', { name: 'Nombre de la cuenta de pago' })).not.toHaveValue('')
    const enlaces = await rest<{ entity_id: string }[]>(s, `company_account_link?select=entity_id&company_id=eq.${EMPRESA()}&entity=eq.supplier&entity_id=eq.${PROVEEDOR(t)}&role=eq.pago`)
    expect(enlaces.length, 'la base guarda la cuenta de pago de su ficha').toBe(1)
    expect(await loQueSeCorta(page, '[data-prueba="cuenta-de-pago"]'), `lo que se corta, la cuenta de pago, a ${ancho}`).toEqual([])
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${DIR}/ficha-proveedor-${ancho}.png` })

    // ── 2 · Su factura la trae en «Cómo se paga», «De su ficha». ──
    await page.goto(`/conta/documentos/recibidas/${FACTURA(t)}?ver=por-revisar`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(ficha(page).locator('#kf-pago')).toHaveValue('43000002', { timeout: 30_000 })
    await expect(ficha(page).locator('[data-prueba="origen-pago"]')).toHaveText('De su ficha')

    // ── 3 · La contrapartida, con una del 21x: el aviso. ──
    const dejar = ficha(page).locator('.kf-duda').getByRole('button', { name: /^Dejar / })
    if (await dejar.count()) await dejar.first().click()
    await ficha(page).locator('#kf-cuenta-0').fill('2160')
    await page.getByRole('option', { name: /^21600000 · / }).click()
    await expect(ficha(page).locator('#kf-cuenta-0')).toHaveValue('21600000')
    await expect(ficha(page).locator('[data-prueba="aviso-inmovilizado"]')).toHaveText('Va a inmovilizado: después dalo de alta en la ficha de bienes.')
    expect(await loQueSeCorta(page, FICHA), `lo que se corta, la factura, a ${ancho}`).toEqual([])
    await page.screenshot({ path: `${DIR}/factura-${ancho}.png` })

    // ── 4 · El proveedor, por su código: el del OTRO proveedor de prueba (la casilla ya enseña el código del suyo,
    //    y escribir lo mismo no abre la lista: e2e 44924628489). Solo en la lista del proveedor (no los <select> del IVA). ──
    const otro = t === 1 ? 2 : 1
    const prov = ficha(page).locator('#kf-proveedor')
    await prov.fill('')
    await prov.pressSequentially(SUBCUENTA(otro))
    const opciones = ficha(page).locator('#kf-proveedor-lista [role="option"]')
    await expect(opciones.first()).toContainText(NOMBRE(otro), { timeout: 30_000 })
    await expect(opciones.first()).toContainText(SUBCUENTA(otro))
    await prov.press('Escape')

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('en el móvil, la cabecera con el logo de Sumied', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'La cabecera del móvil')
  test.setTimeout(120_000)
  await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  const img = page.locator('.s-cab-logotipo img').first()
  await expect(img).toBeVisible({ timeout: 30_000 })
  await expect(img).toHaveAttribute('src', /sumied-logo-horizontal/)
  const m = await img.evaluate((el) => { const i = el as HTMLImageElement; const r = i.getBoundingClientRect(); return { ok: i.complete && i.naturalWidth > 0, p: r.width / r.height, n: i.naturalWidth / Math.max(1, i.naturalHeight), alto: r.height } })
  expect(m.ok, 'el logo del móvil no ha cargado').toBe(true)
  expect(Math.abs(m.p - m.n), 'el logo del móvil está deformado').toBeLessThan(0.05)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${DIR}/barra-movil.png` })
})
