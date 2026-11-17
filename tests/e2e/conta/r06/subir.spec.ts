// tests/e2e/conta/r06/subir.spec.ts
//
// R06 · «Subir las ventas del TPV» y «A qué cuenta va cada forma de pago», contra
// staging-conta, en el carril de la cuenta A (la empresa del cierre de Glovo del
// 24/09, que es de hostelería). Ficheros INVENTADOS: tests/e2e/conta/r06/ficheros.
//
//   1. A 1456 × 816: se sueltan los cuatro ficheros con tres días; el 09/11 «Ya
//      estaba, igual» (se guarda antes por la API), el 10/11 «Cuadra» con una
//      forma de pago sin cuenta y el 11/11 «No cuadra», con su frase. Se guarda
//      y lo dice con contenido (regla 8); la lista dice la última subida y lo que
//      falta por subir. Desde «Decir a qué cuenta va»: la forma nueva, el asiento
//      de ejemplo con ella «sin cuenta», «Guardar» apagado y lo dice; se elige la
//      cuenta, el asiento cambia, se guarda y el 10/11 pasa a «Listo para validar».
//   2. A 1366 × 768, las dos ventanas caben sin que ruede la página.
// Las capturas, en docs/conta/capturas/r06 (van al artefacto del run).

import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { CUENTA_A, STAGING_URL, anonKey, entrarComo, enCarril, type Sesion } from '../sesion'
import { rest } from '../api'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'

const DIR = 'docs/conta/capturas/r06'
const CIERRE_GLOVO = enCarril('acebcda4-f03a-4f84-bfe4-062a941e60a2')
const FICHEROS = resolve('tests/e2e/conta/r06/ficheros')
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const csv = () => readdirSync(FICHEROS).filter((n) => n.endsWith('.csv')).map((n) => resolve(FICHEROS, n))

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

async function rpc<T>(s: Sesion, nombre: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${t}`)
  return (t ? JSON.parse(t) : null) as T
}

/** Como el R05: las cuentas de efectivo, tarjeta y Deliverect, y el 09/11 guardado (el que «ya estaba»). */
async function preparar(s: Sesion): Promise<void> {
  const cierre = await rest<{ company_id: string }[]>(s, 'GET', `sales_day_summary?select=company_id&id=eq.${CIERRE_GLOVO}`)
  const empresa = cierre.datos[0]?.company_id
  if (!empresa) throw new Error('No encuentro la empresa del cierre de Glovo del 24/09 en el carril.')
  const ctas = await rest<{ id: string; code: string }[]>(s, 'GET', `company_account?select=id,code&company_id=eq.${empresa}&status=neq.cerrada&order=code`)
  const de = (pref: string) => ctas.datos.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  if (!caja || !banco || !plataforma) throw new Error(`El plan de la empresa no tiene caja, banco o una 430 (${ctas.datos.length} cuentas).`)
  const ya = await rest<{ forma: string }[]>(s, 'GET', `conta_tpv_forma_cuenta?select=forma&company_id=eq.${empresa}`)
  if (!ya.datos.length) {
    const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
    const r = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: CUENTA_A.id, company_id: empresa, forma, canal, company_account_id: cta, created_by_name: 'e2e R06' })))
    if (r.status >= 300) throw new Error(`No se han podido guardar las cuentas de las formas de pago: ${r.status} ${JSON.stringify(r.datos)}`)
  }
  const dias = await rpc<{ dia: string }[]>(s, 'conta_tpv_dias', { p_company: empresa, p_desde: '2026-11-09', p_hasta: '2026-11-09' })
  if (!dias.length) {
    const lectura = leerRevo(['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => ({ nombre: `${n}_2026-11-09.csv`, contenido: new Uint8Array(readFileSync(resolve(EJEMPLO, `${n}_2026-11-09.csv`))) })))
    if (!lectura.ok) throw new Error(lectura.problemas.join(' | '))
    await rpc(s, 'conta_tpv_dia_guardar', { p_company: empresa, p_dia: '2026-11-09', p_programa: 'revo', p_lectura: lectura.lectura.dias[0].lectura, p_quien_nombre: 'Prueba e2e' })
  }
}

const sinRodar = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

test('subir los ficheros del TPV: lo que cuadra se guarda, lo que no lo dice; y a qué cuenta va la forma de pago nueva', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador; el móvil lo prueba la lista (R05)')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  await preparar(s)
  await page.goto('/conta/ventas/cierres?ver=todos')
  await expect(page.getByRole('heading', { level: 1, name: 'Cierres del día' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="ultima-subida"]')).toContainText(/^Última subida: .*, hasta el \d\d\/11$/, { timeout: 30_000 })

  // 1 · Soltar los cuatro ficheros
  await page.getByRole('button', { name: 'Subir las ventas del TPV' }).click()
  const v = page.getByRole('dialog', { name: 'Subir las ventas del TPV' })
  await expect(v.getByText('Suelta aquí los cuatro ficheros que te da Revo')).toBeVisible()
  await v.locator('input[type=file]').setInputFiles(csv())
  const ficheros = v.getByRole('list', { name: 'Los ficheros' })
  for (const [clase, nombre] of [['Órdenes', 'orders (3).csv'], ['Documentos', 'invoices_nov.csv'], ['Impuestos', 'taxes_nov.csv'], ['Pagos', 'payments_nov.csv']])
    await expect(ficheros.getByRole('listitem').filter({ hasText: clase })).toContainText(nombre)

  // 2 · Lo que he leído
  await expect(v.getByRole('heading', { name: 'Lo que he leído · 3 días' })).toBeVisible()
  const tabla = v.getByRole('table', { name: 'Lo que he leído' })
  await expect(tabla.getByRole('row').filter({ hasText: '09/11' })).toContainText('Ya estaba, igual', { timeout: 30_000 })
  await expect(tabla.getByRole('row').filter({ hasText: '10/11' })).toContainText(/5049 a 5096.*1\.100,00.*Cuadra/)
  await expect(tabla.getByRole('row').filter({ hasText: '11/11' })).toContainText('No cuadra')
  await expect(v.locator('[data-prueba="aviso-2026-11-11"]')).toHaveText(
    'El 11/11 no se guarda. Los pagos suman 1.080,07 € y las facturas 1.100,00 €. Faltan 19,93 €. Mira la orden 702002.Vuelve a sacar de Revo los cuatro ficheros de ese día y súbelos otra vez. Los demás días se guardan igual.')
  await tabla.getByRole('row').filter({ hasText: '10/11' }).click()
  await expect(v.getByRole('heading', { name: 'El 10/11, por dentro' })).toBeVisible()
  await expect(v.getByText('Too Good To Go')).toBeVisible()
  await expect(v.getByRole('button', { name: 'Cuenta sin elegir' })).toBeVisible()
  await expect(v.getByText('Sigue a la última factura del día anterior (5048)')).toBeVisible()
  await expect(v.getByText('Guardar no contabiliza: los días quedan en «Por validar», como los demás.')).toBeVisible()
  await sinRodar(page)
  await page.screenshot({ path: `${DIR}/subir-paso2-1456.png` })

  // 3 · Guardado, con contenido
  await v.getByRole('button', { name: 'Guardar 1 día' }).click()
  await expect(v.locator('[data-prueba="resultado-subir"]')).toHaveText(
    'Guardado 1 día, el 10/11: 48 facturas, 1.100,00 €. El 11/11 no se ha guardado. El 09/11 ya estaba igual: no se ha tocado.', { timeout: 60_000 })
  await page.screenshot({ path: `${DIR}/subir-paso3-1456.png` })

  // 4 · A qué cuenta va «Too Good To Go»
  await v.getByRole('button', { name: 'Decir a qué cuenta va' }).click()
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await expect(f.locator('[data-prueba="aviso-forma-nueva"]')).toHaveText(
    'Hay una forma de pago nueva: Too Good To Go. Dime a qué cuenta va y no te lo vuelvo a preguntar. Hasta entonces, los días que la llevan no se pueden validar.', { timeout: 30_000 })
  const asiento = f.getByRole('table', { name: 'Cómo queda el asiento de un día' })
  await expect(asiento.getByRole('row').filter({ hasText: 'Too Good To Go · sin cuenta' })).toContainText('17,24', { timeout: 30_000 })
  await expect(asiento).toContainText('Ejemplo: el 10/11')
  await expect(f.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await expect(page.getByText('Falta 1 cuenta por elegir.')).toBeVisible()
  await sinRodar(page)
  await page.screenshot({ path: `${DIR}/formas-sin-elegir-1456.png` })
  await f.getByRole('button', { name: 'Cuenta de Too Good To Go' }).click()
  await f.getByRole('combobox', { name: 'Número o nombre de la cuenta' }).fill('570')
  await page.keyboard.press('Enter')
  await expect(asiento.getByText('Too Good To Go · sin cuenta')).toHaveCount(0, { timeout: 30_000 })
  await expect(f.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  await f.getByRole('button', { name: 'Guardar' }).click()
  await expect(f.locator('[data-prueba="resultado-formas"]')).toHaveText(/^Guardado: Too Good To Go a la 570\d+ · .+\. El 10\/11 pasa a «Listo para validar»\. Vale para los días que aún no están validados\.$/, { timeout: 30_000 })
  await f.getByRole('button', { name: 'Ver la lista' }).click()

  // 5 · La lista, con lo guardado
  await expect(page.locator('[data-prueba="ultima-subida"]')).toHaveText(/^Última subida: hoy, hasta el 10\/11$/, { timeout: 30_000 })
  const fila = page.getByRole('row').filter({ hasText: '5049 a 5096' })
  await expect(fila).toContainText('Listo para validar', { timeout: 30_000 })
  await expect(page.locator('[data-prueba="falta-por-subir"]')).toContainText(/^Falta por subir: del 11\/11 a ayer$/)
  expect(errores).toEqual([])
})

test('a 1366 × 768, las dos ventanas caben sin que ruede la página', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores = vigilar(page)
  const s = await entrarComo(page, CUENTA_A.email)
  await preparar(s)
  await page.goto('/conta/ventas/cierres?ver=todos')
  await expect(page.getByRole('heading', { level: 1, name: 'Cierres del día' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Subir las ventas del TPV' }).click({ timeout: 30_000 })
  const v = page.getByRole('dialog', { name: 'Subir las ventas del TPV' })
  await v.locator('input[type=file]').setInputFiles(csv())
  await expect(v.getByRole('heading', { name: 'Lo que he leído · 3 días' })).toBeVisible()
  await expect(v.getByRole('table', { name: 'Lo que he leído' }).getByRole('row').filter({ hasText: '11/11' })).toContainText('No cuadra', { timeout: 30_000 })
  await sinRodar(page)
  await page.screenshot({ path: `${DIR}/subir-paso2-1366.png` })
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await page.goto('/conta/ajustes/ventas-por-dia')
  // Ajustes › Ventas por día sale con «ventas por día» encendido; aquí la empresa es de hostelería, y se abre por la dirección.
  await page.getByRole('button', { name: 'A qué cuenta va cada forma de pago' }).click({ timeout: 30_000 })
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await expect(f.getByRole('table', { name: 'A qué cuenta va cada forma de pago' })).toBeVisible({ timeout: 30_000 })
  await sinRodar(page)
  await page.screenshot({ path: `${DIR}/formas-1366.png` })
  expect(errores).toEqual([])
})
