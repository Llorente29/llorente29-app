/// <reference lib="dom" />
// tests/e2e/conta/x07/asientos-erp10.spec.ts
//
// X07 · Los asientos salen a ERP10, en el ordenador, CONTRA STAGING DE VERDAD
// (encargo X07, 2.4). En el carril de la e2e (se clona para el run y se borra al
// acabar), con la cuenta A y su empresa de pruebas, con la sesión del administrador:
//   0. Por la API: la salida, encendida DESDE HOY (así lo único que sale es lo de esta
//      prueba y lo de hoy de otras del carril), una nómina de cuatro apuntes (uno al
//      debe y tres al haber, con céntimos) y un pago de dos, validados, sin I.V.A.
//   1. Paso 1: la fila «Asientos», con los dos y su importe, y «Listo».
//   2. «Descargar los ficheros»: asientos.xlsx con una fila por apunte, el mismo número
//      en A por asiento, la fecha en B, la serie en L, un solo lado relleno.
//   3. Paso 2: su instrucción («Asientos»), después de las cuentas.
//   4. Paso 3: un «Sumas y saldos» inventado con el formato del de ERP10, hecho con
//      los saldos de Sumied (lo que ERP10 tendría si lo importó todo): las cuentas de
//      la nómina y del pago ya se comparan, quedan igual, y se da por igualado.
// Navegador en español (playwright.config.ts). Capturas a 1456 × 816, con la pantalla
// cargada: el paso 1 con la fila de asientos, el paso 2 con su instrucción y el paso 3
// ya igualado. Datos inventados y que se ven inventados (T11).

import { test, expect, type Page, type Download } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { CARRIL, CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'Los asientos escriben en la cuenta A (enciende la salida, saca y apunta): necesita su carril.')

const DIR = 'docs/conta/capturas/x07'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const QUIEN = 'Prueba e2e X07'

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}
function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}
const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const finDeMes = (iso: string) => { const [a, m] = iso.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }

/** Una cuenta de la empresa bajo esa hoja: la primera que haya, o una nueva inventada. */
async function cuenta(s: Sesion, hoja: string, nombre: string): Promise<string> {
  const [hay] = await api<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&code=like.${hoja}*&order=code&limit=1`)
  return hay?.code ?? (await api<{ code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: hoja, p_nombre: nombre, p_quien_nombre: QUIEN })).code
}

async function asiento(s: Sesion, hoy: string, concepto: string, lineas: { cuenta: string; debe?: number; haber?: number }[]) {
  const p = await api<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
    p_company: EMPRESA_A,
    p_entry: { series: 4, fecha: hoy, concepto, source_type: 'manual', confianza: 'seguro', porque: 'Asiento de la prueba e2e del X07.' },
    p_lines: lineas.map((l) => ({ ...l, comun: true })),
    p_quien_nombre: QUIEN,
  })
  await api(s, 'POST', 'rpc/journal_entry_validar', { p_entry: p.id, p_quien_nombre: QUIEN })
}

/** La salida desde hoy, una nómina (1 al debe, 3 al haber) y un pago (2 apuntes), sin I.V.A. */
async function preparar(s: Sesion, hoy: string) {
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
  const sueldos = await cuenta(s, '640', 'Sueldos inventados X07')
  const irpf = await cuenta(s, '4751', 'Retenciones inventadas X07')
  const ss = await cuenta(s, '476', 'Seguridad Social inventada X07')
  const pendiente = await cuenta(s, '465', 'Nóminas pendientes inventadas X07')
  const banco = await cuenta(s, '572', 'Banco inventado X07')
  const n = Date.now() % 100000
  await asiento(s, hoy, `E2E X07 · nómina ${n}`, [
    { cuenta: sueldos, debe: 1250 }, { cuenta: irpf, haber: 187.5 }, { cuenta: ss, haber: 79.38 }, { cuenta: pendiente, haber: 983.12 },
  ])
  await asiento(s, hoy, `E2E X07 · pago ${n}`, [{ cuenta: '41000002', debe: 82.1 }, { cuenta: banco, haber: 82.1 }])
  return { cuentas: [sueldos, irpf, ss, pendiente, banco, '41000002'], sueldos, banco }
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

test('X07 · contra staging: una nómina y un pago salen como asientos, con su fichero, y en el paso 3 sus cuentas ya se comparan', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X07).')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hoy = hoyEnMadrid()
  const fin = finDeMes(hoy)
  const hecho = await preparar(s, hoy)

  // 1 · Paso 1: la fila de los asientos, una más, con cuántos y su importe.
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  const tabla = page.getByRole('table', { name: 'Qué sale' })
  await expect(tabla.getByRole('row')).toHaveCount(7, { timeout: 40_000 })
  const fila = tabla.getByRole('row').filter({ hasText: 'Asientos' })
  await expect(fila).toContainText('Listo')
  await expect(fila).toContainText('Nóminas, pagos y cobros, bancos, traspasos')
  await expect(fila).not.toContainText('Todavía no sale por aquí')
  await expect(tabla.getByRole('row').filter({ hasText: 'Días de ventas del TPV' })).toContainText('Todavía no sale por aquí')
  const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
  await page.screenshot({ path: `${DIR}/paso1-asientos.png` })

  // 2 · Descargar: la confirmación nombra los asientos, y sale asientos.xlsx.
  const bajadas: Download[] = []
  page.on('download', (d) => bajadas.push(d))
  const igual = page.getByRole('button', { name: 'Sacarlas igual' }).first()
  if (await igual.isVisible()) await igual.click()
  await page.getByRole('button', { name: 'Descargar los ficheros' }).click()
  await expect(page.locator('.cxe-hecho')).toHaveText(/ y \d+ asientos \([\d.]+,\d\d €\)\.( Los PDF, en .+\.)? Queda apuntado\.$/, { timeout: 60_000 })
  await expect.poll(() => bajadas.map((d) => d.suggestedFilename()), { timeout: 30_000 }).toContain('asientos.xlsx')
  const d = bajadas.find((x) => x.suggestedFilename() === 'asientos.xlsx')!
  const wb = XLSX.read(readFileSync(await d.path()), { type: 'buffer', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const hasta = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').e.r + 1
  const filas = Array.from({ length: hasta }, (_, k) => k + 1).map((r) => ({
    a: ws[`A${r}`]?.v, b: ws[`B${r}`], l: ws[`L${r}`]?.v, debe: ws[`C${r}`]?.v as string | undefined, haber: ws[`G${r}`]?.v as string | undefined,
    f: ws[`F${r}`]?.v as number | undefined, j: ws[`J${r}`]?.v as number | undefined, k: ws[`K${r}`], m: ws[`M${r}`],
  }))
  // Sin títulos: la fila 1 ya es un apunte, con el número 1.
  expect(filas[0].a).toBe(1)
  for (const x of filas) {
    expect(x.b?.t, 'la fecha, como fecha').toBe('d')
    expect(x.l, 'la serie, como número').toBe(1)
    expect(Boolean(x.debe) !== Boolean(x.haber), 'un solo lado relleno').toBe(true)
    expect(x.k, 'K, vacía').toBeUndefined()
    expect(x.m, 'M, vacía').toBeUndefined()
    if (x.debe) { expect(x.debe).toMatch(/^\d{8}$/); expect(x.f).toBeGreaterThan(0) } else { expect(x.haber).toMatch(/^\d{8}$/); expect(x.j).toBeGreaterThan(0) }
  }
  // La nómina: cuatro filas con el mismo número; el pago, dos con otro. Cada asiento cuadra.
  const del = (codigo: string) => filas.filter((x) => x.a === filas.find((y) => y.debe === codigo || y.haber === codigo)?.a)
  const nomina = del(hecho.sueldos), pago = del(hecho.banco)
  expect(nomina.length).toBe(4)
  expect(pago.length).toBe(2)
  expect(nomina[0].a).not.toBe(pago[0].a)
  const cuadra = (g: typeof filas) => Math.round(g.reduce((t, x) => t + (x.f ?? 0) - (x.j ?? 0), 0) * 100)
  expect(cuadra(nomina)).toBe(0)
  expect(cuadra(pago)).toBe(0)
  expect(nomina.find((x) => x.debe === hecho.sueldos)?.f).toBe(1250)
  expect(nomina.map((x) => x.j).filter(Boolean).sort()).toEqual([187.5, 79.38, 983.12].sort())
  // Números seguidos desde el 1, sin huecos.
  const numeros = [...new Set(filas.map((x) => x.a as number))]
  expect(numeros).toEqual(numeros.map((_, i) => i + 1))

  // 3 · Paso 2: su instrucción, después de las cuentas, y su configuración.
  const orden = page.getByRole('table', { name: 'Los ficheros, en el orden en que se importan' })
  const suya = orden.getByRole('row').filter({ hasText: 'asientos.xlsx' })
  await expect(suya).toContainText('Asientos')
  await expect(suya).toContainText('nóminas, pagos y cobros, bancos')
  const filasOrden = await orden.getByRole('row').allInnerTexts()
  const iSub = filasOrden.findIndex((t) => t.includes('subcuentas.xlsx')), iAs = filasOrden.findIndex((t) => t.includes('asientos.xlsx'))
  if (iSub >= 0) expect(iSub, 'las subcuentas, antes').toBeLessThan(iAs)
  await expect(page.getByText('Primero las cuentas; después las emitidas, las recibidas y los asientos.')).toBeVisible()
  await page.getByRole('button', { name: 'La primera vez' }).click()
  await expect(page.getByRole('button', { name: 'ConfiguracionAsientos.XML' })).toBeVisible()
  await expect(page.getByText('Importaciones › Asientos › Configurar Excel › Configuración, con «No importar facturas» marcada.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/paso2-asientos.png` })

  // 4 · Paso 3: el sumas y saldos con todo importado. Las cuentas de la nómina y del pago se comparan y quedan igual.
  await page.getByRole('button', { name: 'Ya lo he importado' }).click()
  await expect(page.getByRole('heading', { name: 'Sube el «Sumas y saldos» de ERP10' })).toBeVisible()
  await page.getByLabel('El sumas y saldos de ERP10').setInputFiles({ name: 'sumas_y_saldos_x07.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await sumas(s, fin) })
  const comparada = page.getByRole('table', { name: 'Cuenta a cuenta' })
  const grupoIgual = comparada.locator('tbody').filter({ has: page.locator('tr.cxe-grupo', { hasText: /^\d+ cuentas? quedan? igual$/ }) })
  await expect(grupoIgual).toBeVisible({ timeout: 30_000 })
  const verlas = grupoIgual.getByRole('button', { name: 'Verlas todas' })
  if (await verlas.isVisible()) await verlas.click()
  for (const c of hecho.cuentas) await expect(grupoIgual.getByRole('row').filter({ hasText: c }), `la ${c} queda igual`).toHaveCount(1)
  const grupoNoSale = comparada.locator('tbody').filter({ has: page.locator('tr.cxe-grupo', { hasText: 'todavía no salen por aquí' }) })
  for (const c of hecho.cuentas) await expect(grupoNoSale.getByRole('row').filter({ hasText: c }), `la ${c} ya no está en «todavía no salen»`).toHaveCount(0)

  const igualar = page.getByRole('button', { name: /Darlo por igualado/ })
  await expect(igualar).toBeEnabled()
  await igualar.click()
  await expect(page.locator('.cxe-hecho')).toHaveText(/^Igualado: .+ queda igual en Sumied y en ERP10 \(sumas_y_saldos_x07\.xlsx, a .+\)\. Lo dio por igualado .+\.$/, { timeout: 30_000 })
  // La captura, con la pantalla acabada: la tabla con sus filas, el chip verde, el panel que lo dice y nada en ámbar.
  await expect(page.getByText(/^Igualado el \d\d\/\d\d\/\d{4}/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Igualado: no queda nada por mirar.')).toBeVisible()
  await expect(grupoIgual.getByRole('row').filter({ hasText: hecho.sueldos })).toBeVisible()
  await expect(page.locator('.cxe-fila-filo')).toHaveCount(0)
  await expect(page.locator('.cxe-grupo-ambar')).toHaveCount(0)
  await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0)
  const abajo3 = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo3[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo3[1])
  await page.screenshot({ path: `${DIR}/paso3-igualado.png` })
  expect(errores).toEqual([])
})
