/// <reference lib="dom" />
// tests/e2e/conta/x08/dias-tpv-erp10.spec.ts
//
// X08 · Los días del TPV salen a ERP10 como facturas expedidas, en el ordenador, CONTRA
// STAGING DE VERDAD (encargo X08, 2.5, y respuestas X08 · 3 y X08 · 4). En el carril de la
// e2e (se clona para el run y se borra al acabar), con la cuenta A y su empresa de
// hostelería, con la sesión del administrador:
//   0. Por la API: a qué cuenta va cada forma de pago (como la e2e del R05), la cuenta
//      «Clientes de contado» de la sociedad (una 430 que lo dice) y DOS días del ejemplo
//      INVENTADO de Revo (el 09/11 tal cual; el 10/11, el mismo con las facturas 5101 a 5148),
//      leídos con el lector del R04 y guardados con conta_tpv_dia_guardar.
//   1. Cierres del día: «Validar los N listos» los valida con su PDF y su asiento (si no lo
//      estaban ya en este carril).
//   2. La salida, encendida desde el día 1 del mes. Paso 1: la fila «Días de ventas del TPV»
//      sale, y su lista enseña los dos días con su rango.
//   3. «Descargar los ficheros»: dias-tpv.xlsx lleva una fila por día con «Clientes de
//      contado» en G, el total en AB, el I.V.A. en J a L y el rango (48 facturas, primera y
//      última) en AJ, AK y AL, la I vacía; asientos.xlsx lleva el cobro de cada día: lo
//      cobrado a cada cuenta al debe, «Clientes de contado» al haber, el mismo número en A.
//   4. Paso 2: su instrucción, con la de volver a cargar la configuración de expedidas.
//   5. Paso 3: el sumas y saldos con los saldos de Sumied (lo que ERP10 tendría con todo
//      importado): las cuentas de los días quedan igual, ninguna en «todavía no salen», y
//      se da por igualado.
// Navegador en español (playwright.config.ts). Capturas a 1456 × 816, con la pantalla
// cargada. Datos inventados y que se ven inventados (T11).

import { test, expect, type Page, type Download } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { asegurarFacturaDelDia } from '../r07/facturaDelDia'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'

test.skip(CARRIL === null, 'Los días del TPV escriben en la cuenta A (valida, enciende la salida, saca y apunta): necesita su carril.')

const DIR = 'docs/conta/capturas/x08'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')
const QUIEN = 'Prueba e2e X08'

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}
async function rpc<T>(s: Sesion, nombre: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${STAGING_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${t.slice(0, 300)}`)
  return (t ? JSON.parse(t) : null) as T
}
function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** El ejemplo de Revo de un día: el 09/11 tal cual, o movido a otro día con sus facturas 51xx (para que no se repitan). */
function ejemplo(dia: string) {
  return ['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => {
    let t = readFileSync(resolve(EJEMPLO, `${n}_2026-11-09.csv`), 'utf8')
    if (dia !== '2026-11-09') t = t.replaceAll('2026-11-09', dia).replace(/\b50(\d\d)\b/g, '51$1')
    return { nombre: `${n}_${dia}.csv`, contenido: new TextEncoder().encode(t) }
  })
}

/** Las cuentas de cada forma de pago, «Clientes de contado» y los dos días guardados (si no lo estaban). */
async function preparar(s: Sesion): Promise<{ contado: string; caja: string; plataforma: string }> {
  const ctas = await api<{ id: string; code: string; name: string }[]>(s, 'GET', `company_account?select=id,code,name&company_id=eq.${EMPRESA_A}&status=neq.cerrada&order=code`)
  const de = (pref: string) => ctas.find((c) => c.code.startsWith(pref))
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = ctas.find((c) => c.code.startsWith('430') && !/contado/i.test(c.name))
  if (!caja || !banco || !plataforma) throw new Error(`El plan de la empresa no tiene caja, banco o una 430 (${ctas.length} cuentas).`)
  const ya = await api<{ id: string }[]>(s, 'GET', `conta_tpv_forma_cuenta?select=id&company_id=eq.${EMPRESA_A}`)
  if (!ya.length) {
    const formas = [['Efectivo', null, caja.id], ['Tarjeta', null, banco.id], ['Deliverect', 'Glovo', plataforma.id], ['Deliverect', 'UberEats', plataforma.id]] as const
    await api(s, 'POST', 'conta_tpv_forma_cuenta', formas.map(([forma, canal, cta]) => ({ account_id: CUENTA_A.id, company_id: EMPRESA_A, forma, canal, company_account_id: cta, created_by_name: QUIEN })))
  }
  // «Clientes de contado»: una 430 de la sociedad que lo dice en su nombre (la respuesta X08 · 3). No se inventa en la pantalla: la prueba la da de alta.
  const contado = ctas.find((c) => c.code.startsWith('430') && /contado/i.test(c.name))?.code
    ?? (await api<{ code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: '4300', p_nombre: 'Clientes de contado', p_quien_nombre: QUIEN })).code
  // R07 · Desde la 0900, sin la cuenta de la factura del día no se valida: la de «contado» de arriba.
  await asegurarFacturaDelDia(s, EMPRESA_A)
  for (const dia of ['2026-11-09', '2026-11-10']) {
    const ya = await rpc<{ dia: string }[]>(s, 'conta_tpv_dias', { p_company: EMPRESA_A, p_desde: dia, p_hasta: dia })
    if (ya.length) continue
    const l = leerRevo(ejemplo(dia))
    if (!l.ok) throw new Error(l.problemas.join(' | '))
    await rpc(s, 'conta_tpv_dia_guardar', { p_company: EMPRESA_A, p_dia: dia, p_programa: 'revo', p_lectura: l.lectura.dias[0].lectura, p_quien_nombre: QUIEN })
  }
  return { contado, caja: caja.code, plataforma: plataforma.code }
}

/** El «Sumas y saldos» de ERP10, inventado con su formato, con los saldos de Sumied: lo que ERP10 tendría si lo importó todo. */
async function sumas(s: Sesion, fecha: string): Promise<Buffer> {
  const c = await api<{ saldos: { codigo: string; nombre: string; saldo: number; erp: string | null }[] }>(s, 'POST', 'rpc/conta_erp10_comprobar', { p_company: EMPRESA_A, p_fecha: fecha })
  const filas: (string | number)[][] = [['Balance de sumas y saldos'], [], [], [], ['Subcuenta', '', '', 'Debe', 'Haber', 'Deudor', 'Acreedor'], []]
  let td = 0, ta = 0
  for (const x of c.saldos) {
    const cent = Math.round(x.saldo * 100)
    const d = cent > 0 ? cent / 100 : 0, a = cent < 0 ? -cent / 100 : 0
    td += d; ta += a
    filas.push([x.erp ?? x.codigo, x.nombre, '', d, a, d, a])
  }
  filas.push(['', '', 'TOTALES:', Math.round(td * 100) / 100, Math.round(ta * 100) / 100, Math.round(td * 100) / 100, Math.round(ta * 100) / 100])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Datos')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('X08 · contra staging: dos días del TPV validados salen como una factura por día, con su rango y su cobro, y en el paso 3 sus cuentas se comparan', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X08).')
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hecho = await preparar(s)

  // 1 · Validar los dos días en Cierres del día (con su PDF y su asiento), si no lo estaban.
  const estados = await rpc<{ dia: string; estado: string }[]>(s, 'conta_tpv_dias', { p_company: EMPRESA_A, p_desde: '2026-11-09', p_hasta: '2026-11-10' })
  if (estados.some((d) => d.estado !== 'validado')) {
    await page.goto('/conta/ventas/cierres?ver=todos', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { level: 1, name: 'Cierres del día' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
    const boton = page.getByRole('button', { name: /^Validar los \d+ listos/ }).first()
    await expect(boton).toBeEnabled({ timeout: 30_000 })
    await boton.click()
    await page.getByRole('dialog').getByRole('button', { name: /^Validar \d+ cierres?$/ }).click()
    const resultado = page.locator('[data-prueba="resultado-validar"]')
    // Solo los que no lo estaban: en el mismo run, el R05 puede haber validado ya el 09/11 (la misma empresa del carril).
    const faltaban = estados.filter((d) => d.estado !== 'validado').map((d) => Number(d.dia.slice(8, 10)))
    for (const [i, d] of faltaban.entries())
      await expect(resultado.getByText(new RegExp(`^✓ TPV · Revo · ${d} nov: validado`))).toBeVisible({ timeout: i ? 60_000 : 300_000 })
  }
  const validados = await rpc<{ dia: string; estado: string }[]>(s, 'conta_tpv_dias', { p_company: EMPRESA_A, p_desde: '2026-11-09', p_hasta: '2026-11-10' })
  expect(validados.map((d) => d.estado), 'los dos días, validados').toEqual(['validado', 'validado'])

  // 2 · La salida, desde el día 1 del mes. Paso 1: la fila de los días y su lista.
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: '2026-11-01', p_quien_nombre: QUIEN })
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  await page.getByRole('combobox', { name: 'Mes' }).selectOption('2026-11-01')
  const tabla = page.getByRole('table', { name: 'Qué sale' })
  await expect(tabla.getByRole('row')).toHaveCount(7, { timeout: 40_000 })
  const fila = tabla.getByRole('row').filter({ hasText: 'Días de ventas del TPV' })
  await expect(fila).not.toContainText('Todavía no sale por aquí')
  await expect(fila).toContainText(/\d+ facturas del TPV, una factura por día/)
  await fila.click()
  const lista = page.getByRole('table', { name: 'Días de ventas del TPV' })
  await expect(lista.getByRole('row').filter({ hasText: '5001–5048' })).toContainText('48')
  await expect(lista.getByRole('row').filter({ hasText: '5101–5148' })).toContainText('48')
  const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
  await page.screenshot({ path: `${DIR}/paso1-dias.png` })

  // 3 · Descargar: dias-tpv.xlsx con una fila por día; el cobro de cada día, en asientos.xlsx.
  const bajadas: Download[] = []
  page.on('download', (d) => bajadas.push(d))
  const igual = page.getByRole('button', { name: 'Sacarlas igual' }).first()
  if (await igual.isVisible()) await igual.click()
  await page.getByRole('button', { name: 'Descargar los ficheros' }).click()
  await expect(page.locator('.cxe-hecho')).toContainText(/\d+ días de ventas \([\d.]+,\d\d €\)/, { timeout: 60_000 })
  await expect.poll(() => bajadas.map((d) => d.suggestedFilename()), { timeout: 30_000 }).toEqual(expect.arrayContaining(['dias-tpv.xlsx', 'asientos.xlsx']))
  const hoja = async (nombre: string) => {
    const d = bajadas.find((x) => x.suggestedFilename() === nombre)!
    const wb = XLSX.read(readFileSync(await d.path()), { type: 'buffer', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    return { ws, filas: XLSX.utils.decode_range(ws['!ref'] ?? 'A1').e.r + 1 }
  }
  const dias = await hoja('dias-tpv.xlsx')
  const filaDe = (primero: string) => Array.from({ length: dias.filas }, (_, k) => k + 1).find((r) => String(dias.ws[`AK${r}`]?.v) === primero)
  for (const [primero, ultimo] of [['5001', '5048'], ['5101', '5148']]) {
    const r = filaDe(primero)
    expect(r, `la fila del día con la ${primero}`).toBeDefined()
    expect(dias.ws[`E${r}`].t, 'la fecha, como fecha').toBe('d')
    expect(dias.ws[`G${r}`].v, 'el cliente, «Clientes de contado»').toBe(hecho.contado)
    expect(dias.ws[`I${r}`], 'la I (nº factura), vacía').toBeUndefined()
    expect(dias.ws[`AJ${r}`].v, 'cuántas facturas').toBe(48)
    expect(String(dias.ws[`AL${r}`].v), 'la última').toBe(ultimo)
    expect(dias.ws[`AB${r}`].v, 'el total del día').toBe(1100)
    expect([dias.ws[`J${r}`].v, dias.ws[`K${r}`].v, dias.ws[`L${r}`].v], 'base, % y cuota').toEqual([999.99, 10, 100.01])
    expect(dias.ws[`Z${r}`], 'sin PDF').toBeUndefined()
  }
  const as = await hoja('asientos.xlsx')
  const filas = Array.from({ length: as.filas }, (_, k) => k + 1).map((r) => ({ a: as.ws[`A${r}`]?.v as number, debe: as.ws[`C${r}`]?.v as string | undefined, haber: as.ws[`G${r}`]?.v as string | undefined,
    f: as.ws[`F${r}`]?.v as number | undefined, j: as.ws[`J${r}`]?.v as number | undefined }))
  // Los cobros: los asientos cuyo haber es «Clientes de contado» por 1.100, uno por día; cada uno cuadra.
  const cobros = [...new Set(filas.filter((x) => x.haber === hecho.contado && x.j === 1100).map((x) => x.a))]
  expect(cobros, 'un cobro por día').toHaveLength(2)
  for (const n of cobros) {
    const g = filas.filter((x) => x.a === n)
    expect(g.filter((x) => x.debe).map((x) => x.debe).sort(), 'lo cobrado a cada cuenta, al debe').toEqual(expect.arrayContaining([hecho.caja, hecho.plataforma]))
    expect(Math.round(g.reduce((t, x) => t + (x.f ?? 0) - (x.j ?? 0), 0) * 100), 'cuadra').toBe(0)
  }

  // 4 · Paso 2: su instrucción, con volver a cargar la configuración de expedidas.
  const orden = page.getByRole('table', { name: 'Los ficheros, en el orden en que se importan' })
  const suya = orden.getByRole('row').filter({ hasText: 'dias-tpv.xlsx' })
  await expect(suya).toContainText('Facturas, eligiendo «Facturas emitidas»')
  await expect(suya).toContainText('carga otra vez ConfiguracionExpedidas.XML')
  await expect(page.getByText('Primero las cuentas; después las emitidas, los días de ventas, las recibidas y los asientos.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/paso2-dias.png` })

  // 5 · Paso 3: con todo importado, las cuentas de los días quedan igual.
  await page.getByRole('button', { name: 'Ya lo he importado' }).click()
  await expect(page.getByRole('heading', { name: 'Compara con ERP10' })).toBeVisible()
  await page.getByLabel('El sumas y saldos de ERP10').setInputFiles({ name: 'sumas_y_saldos_x08.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await sumas(s, '2026-11-30') })
  const comparada = page.getByRole('table', { name: 'Cuenta a cuenta' })
  const grupoIgual = comparada.locator('tbody').filter({ has: page.locator('tr.cxe-grupo', { hasText: /^\d+ cuentas? quedan? igual$/ }) })
  await expect(grupoIgual).toBeVisible({ timeout: 30_000 })
  const verlas = grupoIgual.getByRole('button', { name: 'Verlas todas' })
  if (await verlas.isVisible()) await verlas.click()
  for (const c of [hecho.caja, hecho.plataforma]) await expect(grupoIgual.getByRole('row').filter({ hasText: c }), `la ${c} queda igual`).toHaveCount(1)
  const grupoNoSale = comparada.locator('tbody').filter({ has: page.locator('tr.cxe-grupo', { hasText: 'todavía no salen por aquí' }) })
  for (const c of [hecho.caja, hecho.plataforma]) await expect(grupoNoSale.getByRole('row').filter({ hasText: c }), `la ${c} ya no está en «todavía no salen»`).toHaveCount(0)
  const igualar = page.getByRole('button', { name: /Darlo por igualado/ })
  await expect(igualar).toBeEnabled()
  await igualar.click()
  await expect(page.getByText(/^Igualado el \d\d\/\d\d\/\d{4}/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('complementary', { name: 'Igualado' })).toContainText('Igualado: no queda nada por mirar.')
  await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0)
  const abajo3 = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo3[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo3[1])
  await page.screenshot({ path: `${DIR}/paso3-igualado.png` })
  expect(errores).toEqual([])
})
