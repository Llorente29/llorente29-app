/// <reference lib="dom" />
// tests/e2e/conta/r15b/libro.spec.ts
//
// R15b · El día del TPV en el libro de IVA, como manda la ley. Contra staging, en la cuenta del núcleo
// (semilla del K02): cada prueba crea una empresa de HOSTELERÍA nueva («Bar de prueba R15b …», con su plan,
// su ejercicio, la cuenta de cada forma de pago y la de la factura del día). Dos días INVENTADOS (T11): el
// ejemplo de Revo del R04 al 13 y al 14/10, con DOS series (Facturas y, de la orden 31 en adelante, Barra),
// dos facturas con NIF (B00000000) y una devolución cada uno; el 14/10, con un pago por «Bizum» sin cuenta.
//   1. A 1456 × 816: «Contabilizar 2 días» (se cierra «A qué cuenta va» sin elegir): el 13/10 contabilizado y
//      el 14/10 en espera.
//      · El 14/10 (en espera) enseña «Cómo irá al libro de IVA», fila a fila: «Tickets 5049 a 5078 · Facturas»,
//        «Tickets 5079 a 5096 · Barra», «Factura 5055 …», «Factura 5068 …» y «Devolución 5095» en rojo (2346).
//      · El 13/10 (contabilizado) enseña «En el libro de IVA» y su PDF sigue: con la 2347 en staging, las cinco
//        filas; sin ella (desde la rama, en ROLLBACK, W05), una por tipo, y lo dice en el registro.
//      · «Facturas emitidas»: el 13/10 con sus filas del libro (o, sin la 2347, su fila del día) y su PDF.
//   2. A 1366 × 768: la ficha del día en espera, con sus filas, sin rodar de lado.
// Escribe (empresas, días, asientos): solo en un carril; sin carril se salta y lo dice.

import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { CARRIL, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { NUCLEO, cargada, zonaActiva } from '../k02/comun'
import { asegurarFacturaDelDia } from '../r07/facturaDelDia'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })
test.skip(CARRIL === null, 'Crea una empresa en la cuenta del núcleo: necesita su carril.')

const DIR = 'docs/conta/capturas/r15b'
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const DIAS = ['2026-10-13', '2026-10-14'] as const

/**
 * Los cuatro ficheros de Revo con los dos días: el ejemplo inventado del 09/11 dos veces, con su fecha y la
 * numeración corrida (+48 el segundo). De la factura 5031 del ejemplo en adelante, la serie es «Barra». En el
 * segundo día, el primer pago con tarjeta es «Bizum». En una carpeta de nombre llano (con «×» o «»» en la ruta,
 * Chromium no recibe el fichero: R15, runs 44928228542 y 44930044830).
 */
function ficheros(info: TestInfo): string[] {
  const dir = mkdtempSync(join(tmpdir(), `r15b-revo-${info.workerIndex}-`))
  const columnas: Record<string, number[]> = { Ordenes: [0], Documentos: [0, 1], Impuestos: [0], Pagos: [0, 1, 4] }
  return Object.entries(columnas).map(([nombre, cols]) => {
    const texto = readFileSync(resolve(EJEMPLO, `${nombre}_2026-11-09.csv`)).toString('latin1')
    const fin = texto.includes('\r\n') ? '\r\n' : '\n'
    const [cabecera, ...filas] = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
    const salida = [cabecera]
    DIAS.forEach((dia, k) => {
      let bizum = nombre === 'Pagos' && k === 1
      for (const fila of filas) {
        const c = fila.split(';')
        if (nombre === 'Documentos' && Number(c[1]) > 5030) c[2] = 'Barra'
        for (const i of cols) {
          const m = /^(\s*)(\d+)$/.exec(c[i])
          if (m) c[i] = `${m[1]}${Number(m[2]) + 48 * k}`
        }
        if (bizum && c[7] === 'Tarjeta') { c[7] = 'Bizum'; bizum = false }
        salida.push(c.join(';').split('2026-11-09').join(dia))
      }
    })
    const ruta = join(dir, `${nombre}_2026-10-13_14.csv`)
    writeFileSync(ruta, Buffer.from(salida.join(fin) + fin, 'latin1'))
    return ruta
  })
}

/** Una empresa de hostelería recién creada, con su plan, su ejercicio, la cuenta de cada forma (menos Bizum) y la de la factura del día. */
async function crearHosteleria(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Bar de prueba R15b ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    sector: 'hosteleria', setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e R15b' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  const ctas = await rest<{ id: string; code: string }[]>(s, 'GET', `company_account?select=id,code&company_id=eq.${id}&status=neq.cerrada&order=code`)
  const hojas = ctas.datos.filter((c) => c.code.length === 8)
  const de = (pref: string) => hojas.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  expect(caja && banco && plataforma, `caja, banco y una 430 en el plan (${hojas.length} cuentas)`).toBeTruthy()
  const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
  const f = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: NUCLEO.id, company_id: id, forma, canal, company_account_id: cta, created_by_name: 'e2e R15b' })))
  expect(f.status, `las cuentas de las formas de pago: ${JSON.stringify(f.datos).slice(0, 200)}`).toBeLessThan(300)
  expect(await asegurarFacturaDelDia(s, id), 'la cuenta de la factura del día').toBeTruthy()
  return id
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(`${page.url()}: ${e.message}`); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Lo primero al ver una e2e en rojo: lo que había en pantalla. */
async function contarPantalla(page: Page, que: string) {
  const texto = await page.locator('[role="dialog"], .k-zona[data-activa="si"]').first().innerText().catch(() => '(nada)')
  console.log(`[pantalla · ${que}] ${texto.replace(/\s+/g, ' ').slice(0, 1500)}`)
}

/** Subir los dos días y contabilizarlos; se abre «A qué cuenta va» por Bizum y se cierra sin elegir. */
async function subirYContabilizar(page: Page, info: TestInfo) {
  await page.goto('/conta/ventas/cierres?ver=todos', { timeout: 30_000 })
  const zona = zonaActiva(page)
  await expect(zona.getByRole('tab', { name: /^Todos \d+/ })).toBeVisible({ timeout: 40_000 })
  await cargada(page, 'Cierres del día de la empresa nueva')
  await zona.getByRole('button', { name: 'Subir las ventas del TPV' }).click({ timeout: 40_000 })
  const v = page.getByRole('dialog', { name: 'Subir las ventas del TPV' })
  await expect(v.getByText('Suelta aquí los cuatro ficheros que te da Revo')).toBeVisible({ timeout: 30_000 })
  await v.locator('input[type=file]').setInputFiles(ficheros(info))
  await expect(v.getByRole('heading', { name: 'Lo que he leído · 2 días' })).toBeVisible({ timeout: 30_000 })
  await v.getByRole('button', { name: 'Contabilizar 2 días' }).click()
  const f = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
  await expect(f.getByRole('button', { name: 'Cuenta de Bizum' })).toBeVisible({ timeout: 60_000 })
  await f.getByRole('button', { name: 'Cancelar' }).click()
  try {
    await expect(v.locator('[data-prueba="resultado-contabilizados"]')).toHaveText(/^Contabilizado 1 día: 2 asientos, el nº \d+ y el nº \d+\.$/, { timeout: 90_000 })
    await expect(v.locator('[data-prueba="resultado-en-espera"]')).toContainText(/^En espera 1: el 14\/10 /)
  } catch (e) { await contarPantalla(page, 'el paso 3'); throw e }
  await v.getByRole('button', { name: 'Ver la lista' }).click()
  return zona
}

const LINEAS_14 = ['Tickets 5049 a 5078 · Facturas', 'Tickets 5079 a 5096 · Barra', /^Factura 5055 · /, /^Factura 5068 · /, 'Devolución 5095']
const LINEAS_13 = ['Tickets 5001 a 5030 · Facturas', 'Tickets 5031 a 5048 · Barra', /^Factura 5007 · /, /^Factura 5020 · /, 'Devolución 5047']

test('a 1456 × 816: el día del TPV en el libro de IVA por serie, con sus facturas con NIF y su devolución; su ficha y «Facturas emitidas»', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(360_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1456')
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
  const zona = await subirYContabilizar(page, info)

  // 1 · El 14/10, en espera: «Cómo irá al libro de IVA», fila a fila (2346, de verdad en staging desde la rama).
  await zona.getByRole('row').filter({ hasText: '5049 a 5096' }).click({ timeout: 30_000 })
  const espera = page.locator('[data-prueba="ficha-dia-tpv"]:visible')
  await expect(espera).toHaveAttribute('data-estado', 'en_espera', { timeout: 30_000 })
  const libro14 = espera.getByRole('table', { name: 'En el libro de IVA' })
  try {
    await expect(espera.getByRole('heading', { name: 'Cómo irá al libro de IVA' })).toBeVisible({ timeout: 30_000 })
    await expect(libro14.locator('tbody tr td:first-child')).toHaveText(LINEAS_14)
    await expect(libro14.locator('tbody tr[data-clase="r5"] [data-tono="falta"]')).toHaveText('Devolución 5095')
    await expect(libro14.locator('tbody tr[data-clase="nif"]').first()).toContainText('B00000000')
  } catch (e) { await contarPantalla(page, 'la ficha del 14/10'); throw e }
  await cargada(page, 'la ficha del día en espera, con su libro')
  await libro14.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/ficha-dia-con-sus-lineas-1456.png` })

  // 2 · El 13/10, contabilizado: «En el libro de IVA» y su PDF.
  await page.goto('/conta/ventas/cierres?ver=todos', { timeout: 30_000 })
  await zonaActiva(page).getByRole('row').filter({ hasText: '5001 a 5048' }).click({ timeout: 30_000 })
  const ficha = page.locator('[data-prueba="ficha-dia-tpv"]:visible')
  await expect(ficha).toHaveAttribute('data-estado', 'validado', { timeout: 30_000 })
  await expect(ficha.getByRole('heading', { name: 'En el libro de IVA' })).toBeVisible({ timeout: 30_000 })
  const filas13 = ficha.getByRole('table', { name: 'En el libro de IVA' }).locator('tbody tr td:first-child')
  const repartido = (await filas13.count()) > 1
  console.log(`[R15b] el 13/10 contabilizado: ${repartido ? 'libro repartido (2347 en staging)' : 'una fila por tipo (2347 solo en ROLLBACK desde la rama)'}`)
  if (repartido) await expect(filas13).toHaveText(LINEAS_13)
  else await expect(filas13).toHaveText(['Tickets 5001 a 5048'])
  await expect(ficha.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
  await cargada(page, 'la ficha del día contabilizado, con su libro')
  await page.screenshot({ path: `${DIR}/ficha-dia-contabilizado-1456.png` })

  // 3 · «Facturas emitidas».
  await page.goto('/conta/ventas/facturas?mes=2026-10', { timeout: 30_000 })
  const lista = zonaActiva(page)
  try {
    if (repartido) {
      await expect(lista.locator('[data-prueba="emitida-dia-tpv"]')).toHaveCount(2, { timeout: 30_000 })
      await expect(lista.getByRole('row').filter({ hasText: '5001 a 5030' })).toContainText('Día del TPV · Revo')
      await expect(lista.getByRole('row').filter({ hasText: '5031 a 5048' })).toContainText('Tickets del TPV · Barra')
      await expect(lista.locator('[data-prueba="emitida-r5-tpv"]')).toHaveCount(1)
      await expect(lista.locator('[data-prueba="emitida-nif-tpv"]')).toHaveCount(2)
    } else {
      await expect(lista.locator('[data-prueba="emitida-dia-tpv"]')).toHaveCount(1, { timeout: 30_000 })
    }
    await expect(lista.locator('[data-prueba="emitida-dia-tpv"]').first().getByRole('button', { name: 'PDF' })).toBeVisible()
  } catch (e) { await contarPantalla(page, 'Facturas emitidas'); throw e }
  await cargada(page, 'Facturas emitidas con el día del TPV')
  await page.screenshot({ path: `${DIR}/emitidas-1456.png` })
  expect(errores, 'sin errores de la página').toEqual([])
})

test('a 1366 × 768: la ficha del día con sus filas del libro cabe sin rodar de lado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las ventanas del TPV son de ordenador')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1366')
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
  const zona = await subirYContabilizar(page, info)
  await zona.getByRole('row').filter({ hasText: '5049 a 5096' }).click({ timeout: 30_000 })
  const ficha = page.locator('[data-prueba="ficha-dia-tpv"]:visible')
  const libro = ficha.getByRole('table', { name: 'En el libro de IVA' })
  await expect(libro.locator('tbody tr td:first-child')).toHaveText(LINEAS_14, { timeout: 30_000 })
  await cargada(page, 'la ficha del día a 1366')
  await libro.scrollIntoViewIfNeeded()
  const lado = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(lado, 'la página no rueda de lado').toBeLessThanOrEqual(1)
  const cortados = await libro.evaluate((t) => [...t.querySelectorAll('td, th')].filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).map((e) => (e as HTMLElement).innerText.slice(0, 60)))
  expect(cortados, 'nada cortado en el libro del día').toEqual([])
  await page.screenshot({ path: `${DIR}/ficha-dia-con-sus-lineas-1366.png` })
  expect(errores, 'sin errores de la página').toEqual([])
})
