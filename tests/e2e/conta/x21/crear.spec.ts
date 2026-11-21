// tests/e2e/conta/x21/crear.spec.ts — X21 · «No está: crear la …» en los buscadores de cuentas (21/11), contra
// staging, a 1456 × 816 y a 1366 × 768, en la gestoría de ejemplo del núcleo (la de las K06):
//   1. La factura recibida, «A qué cuenta de gasto va»: un código de la 602 que no está (lo que Julio quiso hacer
//      con la 60200001), «No está: crear la …», el nombre e Intro; queda elegida, con su nombre, sin salir de la ficha.
//   2. Un asiento nuevo, F4 en la cuenta (el otro buscador, BuscarCuentaHoja): lo mismo, sin salir del asiento.
// No se guarda ni la factura ni el asiento. Los códigos, los siguientes libres de staging en cada pasada; los nombres,
// inventados con un número (T11).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { abierta, GESTORIA, NUCLEO } from '../k02/comun'
import { siguienteLibre } from '../../../../src/modules/conta/lib/planEmpresa'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
test.skip(CARRIL === null, 'El X21 crea subcuentas en la gestoría de ejemplo del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/x21'
const TAMANOS = [{ width: 1456, height: 816 }, { width: 1366, height: 768 }] as const
const zona = (page: Page) => page.locator('.k-zona[data-activa="si"]')

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

async function entrarEnLaGestoria(page: Page): Promise<Sesion> {
  const s = await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => { window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas') })
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${GESTORIA}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${GESTORIA}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
  return s
}

/** El siguiente código libre de la gestoría bajo un prefijo: lo que va a proponer Sumied. */
async function libre(s: Sesion, prefijo: string): Promise<string> {
  const [c] = (await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${NUCLEO.id}&legal_name=eq.${encodeURIComponent(GESTORIA)}`)).datos
  if (!c) throw new Error(`No encuentro la ${GESTORIA} en el carril.`)
  const r = await rest<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${c.id}&code=like.${prefijo}*`)
  const libreYa = siguienteLibre(prefijo, 8, new Set(r.datos.map((x) => x.code)))
  if (!libreYa) throw new Error(`No quedan códigos libres bajo ${prefijo}.`)
  return libreYa
}

for (const tam of TAMANOS) {
  test(`X21 · ${tam.width} × ${tam.height}: «No está: crear la …» en la cuenta de gasto de la recibida y en la cuenta de un asiento, sin salir`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X21).')
    test.setTimeout(180_000)
    await page.setViewportSize(tam)
    const s = await entrarEnLaGestoria(page)
    const errores = vigilar(page)
    const n = Date.now() % 100000

    // 1 · La recibida: «A qué cuenta de gasto va», un código de la 602 que no está.
    await page.goto('/conta/documentos/nueva', { timeout: 30_000 })
    const ficha = zona(page).locator('[data-prueba="ficha-recibida-nucleo"]')
    await expect(ficha).toBeVisible({ timeout: 30_000 })
    const gasto = await libre(s, '602')
    await ficha.locator('#kf-cuenta-0').fill(gasto)
    await ficha.getByRole('button', { name: `No está: crear la ${gasto}` }).click()
    const crear = ficha.getByRole('form', { name: 'Añadir subcuenta' })
    await expect(crear.getByRole('textbox', { name: 'Código' })).toHaveValue(gasto)
    await expect(ficha.locator('#cx-subcuenta-frase')).toHaveText(new RegExp(`^Será la ${gasto}, bajo la 602 · `))
    await crear.getByRole('textbox', { name: 'Nombre' }).fill(`Otros aprovisionamientos X21 ${n}`)
    await page.screenshot({ path: `${DIR}/recibida-crear-${tam.width}.png` })
    await crear.getByRole('textbox', { name: 'Nombre' }).press('Enter')
    await expect(ficha.locator('#kf-cuenta-0')).toHaveValue(gasto, { timeout: 30_000 })
    await expect(ficha.getByRole('textbox', { name: 'Nombre de la cuenta 1' })).toHaveValue(`Otros aprovisionamientos X21 ${n}`)
    await expect(crear).toHaveCount(0)
    await page.screenshot({ path: `${DIR}/recibida-elegida-${tam.width}.png` })

    // 2 · Un asiento nuevo: F4 en la cuenta de la primera línea, un código de la 629 que no está.
    await page.goto('/conta/libros/diario/nuevo', { timeout: 30_000 })
    const linea = zona(page).getByRole('textbox', { name: 'Cuenta de la línea 1' })
    await expect(linea).toBeVisible({ timeout: 30_000 })
    const otra = await libre(s, '629')
    await linea.fill(otra)
    await linea.press('F4')
    const buscar = zona(page).getByRole('dialog', { name: 'Buscar la cuenta' })
    await expect(buscar).toBeVisible()
    await buscar.getByRole('button', { name: `No está: crear la ${otra}` }).click()
    const crear2 = buscar.getByRole('form', { name: 'Añadir subcuenta' })
    await crear2.getByRole('textbox', { name: 'Nombre' }).fill(`Otros servicios X21 ${n}`)
    await page.screenshot({ path: `${DIR}/asiento-crear-${tam.width}.png` })
    await crear2.getByRole('textbox', { name: 'Nombre' }).press('Enter')
    await expect(buscar).toHaveCount(0, { timeout: 30_000 })
    await expect(linea).toHaveValue(otra)
    await expect(zona(page).locator(`tr[data-cuenta="${otra}"]`)).toContainText(`Otros servicios X21 ${n}`, { timeout: 30_000 })
    await page.screenshot({ path: `${DIR}/asiento-elegida-${tam.width}.png` })
    expect(errores).toEqual([])
  })
}
