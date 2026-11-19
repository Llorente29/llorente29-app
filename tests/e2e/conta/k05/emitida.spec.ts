/// <reference lib="dom" />
// tests/e2e/conta/k05/emitida.spec.ts
//
// K05 · La ficha de la factura emitida en el núcleo, contra staging, con la
// cuenta del núcleo (semilla K02) en su gestoría y la semilla K05, a 1456 × 816
// y a 1366 × 768, con el navegador en español:
//   1. dos a mano, enteras con el teclado: la primera a la 70000000, con el
//      cobro al banco de su ficha (se apunta); la segunda a la 70400000, con el
//      cobro vacío (queda pendiente). Son las facturas anteriores de su cliente;
//   2. la rellenada (la propuesta de la semilla): la duda de la cuenta de venta
//      («Sus 2 facturas anteriores…»), resuelta SOLO con el teclado, y validada;
//   3. la que no se guarda, con su frase (sin número);
//   4. F5 en el cliente abre su mayor; F8 da la vuelta (asiento, recibida, emitida);
//      Asientos › «Emitidas» abre la ficha;
//   5. con el interruptor apagado (la cuenta A), la pantalla de hoy.
// Las capturas, con la pantalla cargada.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, type Sesion } from '../sesion'
import { abierta, cargada, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k05'
const CLIENTE = (t: number) => (t === 1 ? 'Cliente de Prueba Emitida Uno, S.L.' : 'Cliente de Prueba Emitida Dos, S.L.')
const SUBCUENTA = (t: number) => `4300008${t}`
// La de la pestaña que se ve (las pestañas escondidas siguen montadas).
const ficha = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="ficha-emitida-nucleo"]')
const franja = (page: Page) => ficha(page).locator('.kf-estado')
const aviso = (page: Page) => ficha(page).locator('[data-prueba="aviso-ficha"]')

async function rest<T>(s: Sesion, ruta: string): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } })
  const texto = await r.text()
  expect(r.status, `GET ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return JSON.parse(texto) as T
}

/** El asiento de una emitida por su número: estado, serie y cada apunte (cuenta, debe, haber), en su orden. */
async function asientoDe(s: Sesion, numero: string): Promise<{ id: string; status: string; series: number; lineas: [string, number, number][] }> {
  const e = await rest<{ id: string; status: string; series: number; journal_line: { position: number; debit: number; credit: number; company_account: { code: string } }[] }[]>(s,
    `journal_entry?select=id,status,series,journal_line(position,debit,credit,company_account(code))&account_id=eq.${NUCLEO.id}&document_ref=eq.${encodeURIComponent(numero)}&series=eq.1&status=in.(propuesto,borrador,validado)`)
  expect(e, `el asiento de la ${numero}`).toHaveLength(1)
  const lineas = e[0].journal_line.sort((a, b) => a.position - b.position).map((l): [string, number, number] => [l.company_account.code, Number(l.debit), Number(l.credit)])
  return { id: e[0].id, status: e[0].status, series: e[0].series, lineas }
}

async function fichaLista(page: Page) {
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
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

/** Lo que había en la ficha, en el registro (Q03): la franja, las comprobaciones, el aviso y el asiento. */
async function contar(page: Page, donde: string) {
  const x = await ficha(page).evaluate((el) => ({
    franja: el.querySelector('.kf-estado')?.textContent, comprobaciones: [...el.querySelectorAll('[data-comprobacion]')].map((c) => c.textContent),
    aviso: el.querySelector('[data-prueba="aviso-ficha"]')?.textContent ?? null, asiento: el.querySelector('[data-prueba="cuadra"]')?.textContent ?? null,
  })).catch((e) => String(e))
  console.log(`[K05 ${donde}] ${JSON.stringify(x)}`)
}

/** Escribe y pasa con Intro (la casilla tiene el foco). */
async function escribirEIntro(page: Page, texto: string) {
  await page.keyboard.press('ControlOrMeta+a')
  if (texto) await page.keyboard.type(texto)
  await page.keyboard.press('Enter')
}

for (const [t, ancho, alto] of [[1, 1456, 816], [2, 1366, 768]] as const) {
  test(`la ficha de la emitida a ${ancho} × ${alto}: a mano, la rellenada con la duda, la que no se guarda, F5, F8 y Emitidas`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(420_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const grande = ancho === 1456
    if (!grande) {
      const plegar = page.getByRole('button', { name: /Plegar los botones/ })
      if (await plegar.isVisible()) await plegar.click()
    }

    // ── 1a · Una a mano, entera con el teclado, a la 70000000, con el cobro al banco de su ficha. ──
    await page.goto('/conta/ventas/facturas/a-mano', { timeout: 30_000 })
    await fichaLista(page)
    await expect(franja(page)).toContainText('La escribes tú.')
    await expect(ficha(page).locator('#kf-cliente')).toBeFocused({ timeout: 15_000 })
    await page.keyboard.type(t === 1 ? 'Emitida Uno' : 'Emitida Dos')
    await expect(page.getByRole('option', { name: new RegExp(`^${SUBCUENTA(t)} · `) })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Enter')
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue(CLIENTE(t))
    await page.keyboard.press('Enter') // al número
    await expect(ficha(page).locator('#kf-numero')).toBeFocused()
    await escribirEIntro(page, `K05A-${t}-1`)
    await escribirEIntro(page, '01/10/2026') // la fecha
    await escribirEIntro(page, '100') // la base del 21 %
    await expect(ficha(page).locator('[data-prueba="total"]')).toHaveText('121,00')
    // El resto, con Intro: el tipo, la otra base (vacía), su tipo, la retención, la cuenta de venta (la que se propone) y el cobro (el de su ficha).
    await expect(ficha(page).locator('#kf-venta-0')).toHaveValue('70000000', { timeout: 15_000 })
    await expect(ficha(page).locator('#kf-cobro')).toHaveValue('57200001')
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toHaveText('Cuadra · 121,00')
    if (grande) {
      await cargada(page, 'la emitida escrita a mano')
      await page.screenshot({ path: `${DIR}/a-mano-escribiendo-${ancho}.png` })
    }
    for (let i = 0; i < 12 && !(await aviso(page).isVisible()); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150) }
    await contar(page, `${ancho} 1a`)
    await expect(aviso(page)).toContainText(`Apuntada y validada: 1 / `, { timeout: 60_000 })
    await expect(aviso(page)).toContainText(`la K05A-${t}-1 de ${CLIENTE(t)} por 121,00`)
    await expect(aviso(page)).toContainText('Cobro apuntado en la 57200001')
    const a1 = await asientoDe(s, `K05A-${t}-1`)
    expect(a1).toMatchObject({ status: 'validado', series: 1, lineas: [[SUBCUENTA(t), 121, 0], ['70000000', 0, 100], ['47700021', 0, 21]] })

    // ── 1b · Otra, a la 70400000, con el cobro vacío: queda pendiente. ──
    await expect(ficha(page).locator('#kf-cliente')).toBeFocused({ timeout: 15_000 })
    await page.keyboard.type(t === 1 ? 'Emitida Uno' : 'Emitida Dos')
    await expect(page.getByRole('option', { name: new RegExp(`^${SUBCUENTA(t)} · `) })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Enter')
    await ficha(page).locator('#kf-numero').fill(`K05A-${t}-2`)
    await ficha(page).locator('#kf-fecha').fill('02/10/2026')
    await ficha(page).locator('#kf-fecha').press('Tab')
    await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('50')
    await ficha(page).getByRole('textbox', { name: 'Base 1' }).press('Tab')
    const venta = ficha(page).locator('#kf-venta-0')
    await venta.fill('704')
    await page.getByRole('option', { name: /^70400000/ }).click()
    await expect(venta).toHaveValue('70400000')
    await ficha(page).locator('#kf-cobro').fill('')
    await expect(ficha(page).locator('[data-prueba="cuadra"]')).toHaveText('Cuadra · 60,50')
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText(`la K05A-${t}-2 de ${CLIENTE(t)} por 60,50`, { timeout: 60_000 })
    await expect(aviso(page)).toContainText('Queda pendiente de cobrar (sin cuenta de cobro)')
    expect((await asientoDe(s, `K05A-${t}-2`)).lineas.map((l) => l[0])).toEqual([SUBCUENTA(t), '70400000', '47700021'])

    // ── 3 · La que no se guarda, con su frase: sin número. Y F5 en el cliente abre su mayor. ──
    await page.keyboard.type(t === 1 ? 'Emitida Uno' : 'Emitida Dos')
    await expect(page.getByRole('option', { name: new RegExp(`^${SUBCUENTA(t)} · `) })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Enter')
    await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('10')
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toHaveText('No se ha guardado: falta el número de factura.', { timeout: 15_000 })
    if (grande) await page.screenshot({ path: `${DIR}/no-se-guarda-${ancho}.png` })
    await ficha(page).locator('#kf-cliente').focus()
    await page.keyboard.press('F5')
    await expect(page).toHaveURL(new RegExp(`/conta/plan/${SUBCUENTA(t)}`))
    await expect(page.getByRole('tab', { name: `Mayor · ${SUBCUENTA(t)}` })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /^Factura emitida/ }).click()
    await fichaLista(page)
    await expect(ficha(page).locator('#kf-nombre')).toHaveValue(CLIENTE(t))
    // Se deja sin guardar (Esc y «Cerrar sin guardar»).
    await ficha(page).locator('#kf-numero').press('Escape')
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin guardar' }).click()

    // ── 2 · La rellenada: la duda de la cuenta de venta, resuelta SOLO con el teclado. ──
    const propuesta = await asientoDe(s, `K05R-${t}-1`)
    expect(propuesta.status).toBe('propuesto')
    await page.goto(`/conta/ventas/facturas/asiento/${propuesta.id}`, { timeout: 30_000 })
    await fichaLista(page)
    await expect(page.getByRole('tab', { name: `Factura emitida · ${CLIENTE(t)}` })).toBeVisible()
    const duda = ficha(page).locator('.kf-duda')
    await expect(duda).toContainText(`Sus 2 facturas anteriores fueron 1 a la 70400000 (la última) y 1 a la 70000000.`, { timeout: 30_000 })
    await contar(page, `${ancho} 2 al abrir`)
    await expect(franja(page)).toContainText('Rellenada por Sumied, con 1 duda.')
    await expect(duda.getByRole('button', { name: 'Dejar 70000000' })).toBeFocused({ timeout: 15_000 })
    await cargada(page, 'la rellenada con su duda')
    await page.screenshot({ path: `${DIR}/rellenada-duda-${ancho}.png` })
    await page.keyboard.press('Tab')
    await expect(duda.getByRole('button', { name: 'Cambiar a 70400000' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(ficha(page).locator('.kf-duda')).toHaveCount(0)
    await expect(ficha(page).locator('#kf-venta-0')).toHaveValue('70400000')
    await page.keyboard.press('Enter')
    await expect(page.getByText(/Apuntada y validada: 1 \//).first()).toBeVisible({ timeout: 60_000 })
    await contar(page, `${ancho} 2 al validar`)
    const rellenada = await asientoDe(s, `K05R-${t}-1`)
    expect(rellenada.status).toBe('validado')
    expect(rellenada.lineas.map((l) => l[0])).toEqual([SUBCUENTA(t), '70400000', '47700021'])

    // ── 4 · F8 da la vuelta; Asientos › «Emitidas» abre la ficha. ──
    await page.goto('/conta/ventas/facturas/a-mano', { timeout: 30_000 })
    await fichaLista(page)
    await page.keyboard.press('F8')
    await expect(page).toHaveURL(/\/conta\/libros\/diario\/nuevo/)
    await page.keyboard.press('F8')
    await expect(page).toHaveURL(/\/conta\/documentos\/nueva/)
    await page.keyboard.press('F8')
    await expect(page).toHaveURL(/\/conta\/ventas\/facturas\/a-mano/)
    await fichaLista(page)
    if (!grande) {
      const ver = page.getByRole('button', { name: 'Ver los botones' })
      if (await ver.isVisible()) await ver.click()
    }
    await page.getByRole('tablist', { name: 'La cinta' }).getByRole('tab', { name: 'Asientos' }).click()
    await page.locator('[data-boton="emitidas"]').click()
    await fichaLista(page)

    expect(errores, 'errores de la página').toEqual([])
  })
}

test('con el interruptor apagado, la de hoy (la cuenta A: «Nueva factura emitida» de Asientos, sin la ficha nueva)', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'De ordenador')
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/ventas/facturas/a-mano', { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Nueva factura emitida' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="ficha-emitida-nucleo"]')).toHaveCount(0)
  await expect(page.locator('.k-nucleo')).toHaveCount(0)
})
