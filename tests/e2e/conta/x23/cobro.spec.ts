/// <reference lib="dom" />
// tests/e2e/conta/x23/cobro.spec.ts — X23 · «Cómo se cobra» de la emitida con cualquier subcuenta del plan (Julio,
// 19/11), contra staging, a 1456 × 816 y a 1366 × 768, en la gestoría de ejemplo del núcleo (semillas K02 y K05):
//   1. Una a mano del cliente Uno (su 43000081), base 100 al 21 %, cobrada a la 43000082 (la 430 del cliente Dos: no es
//      un banco). Sale en la lista con su nombre, la línea del asiento sale y cabe, y al guardar queda cobrada con ese
//      asiento: serie 4, la 43000082 al debe y la 43000081 al haber, por 121.
//   2. Regla 31: otra igual cobrada al banco de su ficha (57200001) deja el mismo asiento que dejaba antes del X23: su
//      huella contra la de un cobro del K05 hecho antes de hoy (la misma vara: serie, estado y cada apunte).
// Números inventados (T11), uno por pasada.

import { test, expect, type Page } from '@playwright/test'
import { STAGING_URL, anonKey, type Sesion, entrarComo } from '../sesion'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/x23'
const CLIENTE = '43000081'
const OTRA = '43000082'
const ANTES_DEL_X23 = '2026-11-21T11:00:00Z'
const ficha = (page: Page) => page.locator('.k-zona[data-activa="si"] [data-prueba="ficha-emitida-nucleo"]')
const aviso = (page: Page) => ficha(page).locator('[data-prueba="aviso-ficha"]')

async function rest<T>(s: Sesion, ruta: string): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/${ruta}`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } })
  const texto = await r.text()
  expect(r.status, `GET ${ruta}: ${texto.slice(0, 300)}`).toBeLessThan(300)
  return JSON.parse(texto) as T
}

type Asiento = { id: string; status: string; series: number; created_at: string; journal_line: { position: number; debit: number; credit: number; company_account: { code: string } }[] }
/** La vara (la misma a los dos lados): serie, estado y cada apunte (cuenta, debe, haber), en su orden. */
const huella = (e: Asiento) => JSON.stringify({ serie: e.series, estado: e.status,
  apuntes: e.journal_line.sort((a, b) => a.position - b.position).map((l) => [l.company_account.code, Number(l.debit), Number(l.credit)]) })
const SELECT = 'select=id,status,series,created_at,journal_line(position,debit,credit,company_account(code))'

async function cobroDe(s: Sesion, numero: string): Promise<Asiento> {
  const e = await rest<Asiento[]>(s, `journal_entry?${SELECT}&account_id=eq.${NUCLEO.id}&concept=eq.${encodeURIComponent(`Cobro factura ${numero}`)}&status=eq.validado`)
  expect(e, `el cobro de la ${numero}`).toHaveLength(1)
  return e[0]
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

/** Una a mano del cliente Uno, base 100 al 21 %, a la 70000000. El cobro, lo que diga la prueba. */
async function escribir(page: Page, numero: string) {
  await page.goto('/conta/ventas/facturas/a-mano', { timeout: 30_000 })
  await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
  await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(ficha(page).locator('#kf-cliente')).toBeFocused({ timeout: 15_000 })
  await page.keyboard.type('Emitida Uno')
  await expect(page.getByRole('option', { name: new RegExp(`^${CLIENTE} · `) })).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  await ficha(page).locator('#kf-numero').fill(numero)
  await ficha(page).locator('#kf-fecha').fill('01/10/2026')
  await ficha(page).locator('#kf-fecha').press('Tab')
  await ficha(page).getByRole('textbox', { name: 'Base 1' }).fill('100')
  await ficha(page).getByRole('textbox', { name: 'Base 1' }).press('Tab')
  await expect(ficha(page).locator('[data-prueba="total"]')).toHaveText('121,00')
  await expect(ficha(page).locator('#kf-venta-0')).toHaveValue('70000000', { timeout: 15_000 })
}

for (const [ancho, alto] of [[1456, 816], [1366, 768]] as const) {
  test(`X23 · ${ancho} × ${alto}: se cobra con una 430 que no es un banco, con la línea del asiento; al banco, el mismo asiento que antes`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'El marco del núcleo es de ordenador')
    test.setTimeout(240_000)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
    await page.setViewportSize({ width: ancho, height: alto })
    const s = await entrarEnLaGestoria(page)
    const n = `${Date.now() % 100000}`

    // 1 · Cobrada a la 43000082: en la lista con su nombre, la línea del asiento, y al guardar, su asiento.
    const num1 = `X23-${ancho}-${n}-1`
    await escribir(page, num1)
    const cobro = ficha(page).locator('#kf-cobro')
    await cobro.fill(OTRA)
    const opcion = page.getByRole('option', { name: new RegExp(`^${OTRA} · `) })
    await expect(opcion).toBeVisible({ timeout: 15_000 })
    await expect(ficha(page).getByRole('button', { name: /^No está/ })).toHaveCount(0)
    const nombreOtra = ((await opcion.textContent()) ?? '').replace(new RegExp(`^${OTRA} · `), '').trim()
    await opcion.click()
    await expect(cobro).toHaveValue(OTRA)
    await expect(ficha(page).getByRole('textbox', { name: 'Nombre de la cuenta del cobro' })).toHaveValue(nombreOtra)
    const linea = ficha(page).locator('[data-prueba="cobro-asiento"]')
    await expect(linea).toHaveText(`No es un banco ni la caja: al guardar, un asiento del cobro con la ${OTRA} · ${nombreOtra} al debe y la ${CLIENTE} del cliente al haber, por 121,00 €, y la factura queda cobrada.`)
    const cabe = await linea.evaluate((e) => { const r = e.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && e.scrollWidth <= e.clientWidth + 1 })
    expect(cabe, `la línea del asiento cabe a ${ancho}`).toBe(true)
    await page.screenshot({ path: `${DIR}/cobro-con-430-${ancho}.png` })
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText(`Cobro apuntado en la ${OTRA}: 4 / `, { timeout: 60_000 })
    const a1 = await cobroDe(s, num1)
    expect(JSON.parse(huella(a1))).toEqual({ serie: 4, estado: 'validado', apuntes: [[OTRA, 121, 0], [CLIENTE, 0, 121]] })

    // 2 · Regla 31: al banco de su ficha, el mismo asiento que antes del X23 (un cobro del K05, del mismo cliente y por lo mismo).
    const num2 = `X23-${ancho}-${n}-2`
    await escribir(page, num2)
    await expect(cobro).toHaveValue('57200001')
    await expect(ficha(page).locator('[data-prueba="cobro-asiento"]')).toHaveCount(0)
    await ficha(page).locator('[data-guardar-y-siguiente]').click()
    await expect(aviso(page)).toContainText('Cobro apuntado en la 57200001', { timeout: 60_000 })
    const despues = huella(await cobroDe(s, num2))
    const k05 = await rest<Asiento[]>(s, `journal_entry?${SELECT}&account_id=eq.${NUCLEO.id}&concept=like.${encodeURIComponent('Cobro factura K05A-1-1')}&status=eq.validado&created_at=lt.${ANTES_DEL_X23}&order=created_at.desc&limit=1`)
    expect(k05, 'un cobro del K05 de antes del X23').toHaveLength(1)
    const antes = huella(k05[0])
    console.log(`[X23] regla 31 · antes (K05, ${k05[0].created_at}): ${antes}`)
    console.log(`[X23] regla 31 · después (${num2}): ${despues}`)
    expect(despues).toBe(antes)
    expect(errores).toEqual([])
  })
}
