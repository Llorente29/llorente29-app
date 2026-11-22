/// <reference lib="dom" />
// tests/e2e/conta/r16/erp10-por-serie.spec.ts
//
// R16 · El día del TPV sale a ERP10 como su libro de IVA. Contra staging, en la cuenta del núcleo (semilla del K02):
// cada prueba crea una empresa de HOSTELERÍA nueva («Bar de prueba R16 …»), con su plan, su ejercicio, la cuenta de cada
// forma de pago y la de la factura del día. El día es INVENTADO (T11): el ejemplo de Revo del R04 al 13/10, con DOS series
// (Facturas y, de la 5031 en adelante, Barra), dos facturas con NIF (B00000000, del mismo cliente, que no tiene ficha en
// Sumied) y una devolución (5047).
//   1. Se sube y se contabiliza al subir (R15); su libro, repartido (R15b).
//   2. La salida a ERP10, encendida desde el 01/10. En «Qué sale», los días van «cada día como su libro de IVA»; su lista
//      enseña el día y sus cinco facturas: «Tickets» 5001-5030 y 5031-5048, las dos «Factura con NIF» (5007 y 5020) y la
//      «Devolución» 5047, en negativo.
//   3. El cliente de las facturas con NIF se ha dado de alta en Sumied al abrir la salida (y lo dice), y sale en «Cuentas
//      nuevas» con su NIF: «Primero, las fichas nuevas».
// A 1456 × 816 y a 1366 × 768. Escribe (empresas, días, asientos, la salida): solo en un carril; sin carril se salta.

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

const DIR = 'docs/conta/capturas/r16'
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const DIAS = ['2026-10-13'] as const

/**
 * Los cuatro ficheros de Revo con un día: el ejemplo inventado del 09/11 al 13/10. De la factura 5031 en adelante, la
 * serie es «Barra». En una carpeta de nombre llano (con «×» o «»» en la ruta, Chromium no recibe el fichero: R15).
 */
function ficheros(info: TestInfo): string[] {
  const dir = mkdtempSync(join(tmpdir(), `r16-revo-${info.workerIndex}-`))
  const columnas: Record<string, number[]> = { Ordenes: [0], Documentos: [0, 1], Impuestos: [0], Pagos: [0, 1, 4] }
  return Object.entries(columnas).map(([nombre, cols]) => {
    const texto = readFileSync(resolve(EJEMPLO, `${nombre}_2026-11-09.csv`)).toString('latin1')
    const fin = texto.includes('\r\n') ? '\r\n' : '\n'
    const [cabecera, ...filas] = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
    const salida = [cabecera]
    DIAS.forEach((dia, k) => {
      for (const fila of filas) {
        const c = fila.split(';')
        if (nombre === 'Documentos' && Number(c[1]) > 5030) c[2] = 'Barra'
        for (const i of cols) {
          const m = /^(\s*)(\d+)$/.exec(c[i])
          if (m) c[i] = `${m[1]}${Number(m[2]) + 48 * k}`
        }
        salida.push(c.join(';').split('2026-11-09').join(dia))
      }
    })
    const ruta = join(dir, `${nombre}_2026-10-13.csv`)
    writeFileSync(ruta, Buffer.from(salida.join(fin) + fin, 'latin1'))
    return ruta
  })
}

/** Una empresa de hostelería recién creada, con su plan, su ejercicio, la cuenta de cada forma de pago y la de la factura del día. */
async function crearHosteleria(s: Sesion, que: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: NUCLEO.id, legal_name: `Bar de prueba R16 ${que} ${Date.now()}`, tax_id: cifInventado(), tax_id_type: 'nif_es', entity_kind: 'company',
    sector: 'hosteleria', setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: NUCLEO.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: NUCLEO.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  const a = await rest(s, 'POST', 'rpc/company_chart_activate', { p_company: id, p_comun_proveedores: false, p_quien_nombre: 'Prueba e2e R16' })
  expect(a.status, `el plan activado: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  const ctas = await rest<{ id: string; code: string }[]>(s, 'GET', `company_account?select=id,code&company_id=eq.${id}&status=neq.cerrada&order=code`)
  const hojas = ctas.datos.filter((c) => c.code.length === 8)
  const de = (pref: string) => hojas.find((c) => c.code.startsWith(pref))?.id
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = de('430')
  expect(caja && banco && plataforma, `caja, banco y una 430 en el plan (${hojas.length} cuentas)`).toBeTruthy()
  const formas = [['Efectivo', null, caja], ['Tarjeta', null, banco], ['Deliverect', 'Glovo', plataforma], ['Deliverect', 'UberEats', plataforma]] as const
  const f = await rest(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: NUCLEO.id, company_id: id, forma, canal, company_account_id: cta, created_by_name: 'e2e R16' })))
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


/** Subir el día y contabilizarlo al subir (todas sus formas de pago tienen su cuenta). */
async function subirYContabilizar(page: Page, info: TestInfo) {
  await page.goto('/conta/ventas/cierres?ver=todos', { timeout: 30_000 })
  const zona = zonaActiva(page)
  await expect(zona.getByRole('tab', { name: /^Todos \d+/ })).toBeVisible({ timeout: 40_000 })
  await cargada(page, 'Cierres del día de la empresa nueva')
  await zona.getByRole('button', { name: 'Subir las ventas del TPV' }).click({ timeout: 40_000 })
  const v = page.getByRole('dialog', { name: 'Subir las ventas del TPV' })
  await expect(v.getByText('Suelta aquí los cuatro ficheros que te da Revo')).toBeVisible({ timeout: 30_000 })
  await v.locator('input[type=file]').setInputFiles(ficheros(info))
  await expect(v.getByRole('heading', { name: 'Lo que he leído · 1 día' })).toBeVisible({ timeout: 30_000 })
  await v.getByRole('button', { name: 'Contabilizar 1 día' }).click()
  try {
    await expect(v.locator('[data-prueba="resultado-contabilizados"]')).toHaveText(/^Contabilizado 1 día: 2 asientos, el nº \d+ y el nº \d+\.$/, { timeout: 90_000 })
  } catch (e) { await contarPantalla(page, 'el paso 3'); throw e }
  await v.getByRole('button', { name: 'Ver la lista' }).click()
}

async function laSalida(page: Page, s: Sesion, empresa: string) {
  const r = await rest(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: empresa, p_encender: true, p_codigo: '0016', p_largo: 8, p_desde: '2026-10-01', p_quien_nombre: 'Prueba e2e R16' })
  expect(r.status, `la salida encendida: ${JSON.stringify(r.datos).slice(0, 200)}`).toBeLessThan(300)
  await page.goto('/conta/libros/cierre/salida-erp10', { timeout: 30_000 })
  const zona = zonaActiva(page)
  await expect(zona.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  await zona.getByRole('combobox', { name: 'Mes' }).selectOption('2026-10-01')
  const tabla = zona.getByRole('table', { name: 'Qué sale' })
  const fila = tabla.getByRole('row').filter({ hasText: 'Días de ventas del TPV' })
  try {
    await expect(fila).toContainText('48 facturas del TPV, cada día como su libro de IVA', { timeout: 40_000 })
  } catch (e) { await contarPantalla(page, 'Qué sale'); throw e }
  return { zona, tabla, fila }
}

const PARTES = ['5001-5030', '5031-5048', '5007', '5020', '5047']

test('a 1456 × 816: el día sale a ERP10 como su libro de IVA, con sus facturas con NIF y su devolución, y el cliente nuevo primero', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La salida a ERP10 es de ordenador')
  test.setTimeout(360_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1456')
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
  await subirYContabilizar(page, info)
  const { zona, tabla, fila } = await laSalida(page, s, empresa)

  // El cliente de las facturas con NIF, dado de alta en Sumied al abrir la salida, y dicho.
  await expect(zona.locator('[data-prueba="altas-clientes"]')).toContainText(/Dados de alta en Sumied, para sus facturas con NIF del TPV: .+ \(B00000000\) con la 4300\d{4}\./)

  // El día y sus cinco facturas en ERP10.
  await fila.click()
  const lista = zona.getByRole('table', { name: 'Días de ventas del TPV' })
  try {
    await expect(lista.locator('[data-prueba="dia-erp10"]')).toContainText('5 facturas en ERP10, como su libro de IVA')
    await expect(lista.locator('[data-prueba="parte-erp10"] td:nth-child(3)')).toHaveText(PARTES.map((n) => new RegExp(`^${n} · `)))
    await expect(lista.locator('[data-prueba="parte-erp10"][data-clase="nif"]').first()).toContainText('(B00000000)')
    await expect(lista.locator('[data-prueba="parte-erp10"][data-clase="devolucion"]')).toContainText('−11,00')
  } catch (e) { await contarPantalla(page, 'la lista de los días'); throw e }
  await cargada(page, 'la salida a ERP10 con el día repartido')
  await lista.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/salida-dia-repartido-1456.png` })

  // «Primero, las fichas nuevas»: el cliente, con su NIF.
  await tabla.getByRole('row').filter({ hasText: 'Cuentas nuevas' }).click()
  const cuentas = zona.getByRole('table', { name: 'Cuentas nuevas' })
  await expect(cuentas.getByRole('row').filter({ hasText: 'B00000000' })).toContainText(/4300\d{4}/, { timeout: 30_000 })
  await cuentas.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/salida-cuentas-nuevas-1456.png` })
  expect(errores, 'sin errores de la página').toEqual([])
})

test('a 1366 × 768: la lista del día repartido cabe sin rodar de lado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'La salida a ERP10 es de ordenador')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores = vigilar(page)
  const s = await entrarComo(page, NUCLEO.email)
  const empresa = await crearHosteleria(s, '1366')
  await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${NUCLEO.id}`, empresa] as const)
  await subirYContabilizar(page, info)
  const { zona, fila } = await laSalida(page, s, empresa)
  await fila.click()
  const lista = zona.getByRole('table', { name: 'Días de ventas del TPV' })
  await expect(lista.locator('[data-prueba="parte-erp10"]')).toHaveCount(5, { timeout: 30_000 })
  await cargada(page, 'la salida a ERP10 a 1366')
  await lista.scrollIntoViewIfNeeded()
  const lado = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(lado, 'la página no rueda de lado').toBeLessThanOrEqual(1)
  const cortados = await lista.evaluate((t) => [...t.querySelectorAll('td, th')].filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).map((e) => (e as HTMLElement).innerText.slice(0, 60)))
  expect(cortados, 'nada cortado en la lista del día').toEqual([])
  await page.screenshot({ path: `${DIR}/salida-dia-repartido-1366.png` })
  expect(errores, 'sin errores de la página').toEqual([])
})
