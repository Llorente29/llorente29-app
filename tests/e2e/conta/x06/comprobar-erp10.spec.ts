/// <reference lib="dom" />
// tests/e2e/conta/x06/comprobar-erp10.spec.ts
//
// X06 · El paso 3 de «Salida a ERP10», «Comprueba que queda igual», en el ordenador,
// CONTRA STAGING DE VERDAD (encargo X06). En el carril de la e2e (se clona para el
// run y se borra al acabar), con la cuenta A y su empresa de pruebas, con la sesión
// del administrador:
//   0. Por la API: la salida, encendida DESDE HOY (así lo único que sale es lo de esta
//      prueba), y una recibida validada de hoy.
//   1. Paso 1 → «Descargar los ficheros» → paso 2 → «Ya lo he importado» → paso 3.
//   2. Se sube un «Sumas y saldos» inventado con el formato del de ERP10 (título en la
//      1, títulos en la 5, datos desde la 7 y «TOTALES:»; el ejemplo de
//      tests/conta/fixtures/importar/erp10/), hecho con los saldos de Sumied de
//      conta_erp10_comprobar menos esa factura: a ERP10 le falta.
//   3. Salen las tres cuentas de la factura, con «En ERP10 falta una factura…», las
//      otras dos de la misma factura y lo que Sumied no sabe; «Darlo por igualado»,
//      apagado.
//   4. «Ya la he metido a mano» lo confirma con contenido, y «Darlo por igualado» se
//      enciende y lo confirma con contenido.
// Navegador en español (playwright.config.ts). Capturas a 1456 × 816: con las tres
// diferencias y una elegida, y ya igualado.
// Datos inventados y que se ven inventados (T11).

import { test, expect, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { CARRIL, CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'El paso 3 escribe en la cuenta A (enciende la salida, saca y apunta): necesita su carril.')

const DIR = 'docs/conta/capturas/x06'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')

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
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** La salida, encendida desde hoy, y una recibida validada de hoy. Devuelve su número y lo que pone en cada cuenta. */
async function preparar(s: Sesion, hoy: string) {
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: 'Prueba e2e X06' })
  const [t21] = await api<{ id: string }[]>(s, 'GET', 'tax_rate?select=id&is_system=is.true&valid_to=is.null&code=eq.iva_general')
  const [soportado] = await api<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&code=like.472*&order=code&limit=1`)
  const iva = soportado?.code
    ?? (await api<{ code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: '472', p_nombre: 'IVA soportado inventado X06', p_quien_nombre: 'Prueba e2e X06' })).code
  const numero = `X06-E2E-${Date.now() % 100000}`
  const p = await api<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
    p_company: EMPRESA_A,
    p_entry: { series: 2, fecha: hoy, concepto: `E2E X06 · recibida ${numero}`, source_type: 'manual', confianza: 'seguro', porque: 'Recibida de la prueba e2e del X06.', documento: numero, fecha_documento: hoy },
    p_lines: [
      { cuenta: '62300000', debe: 67.85, comun: true, documento: numero },
      { cuenta: iva, debe: 14.25, comun: true, documento: numero, iva: { tipo_id: t21.id, base: 67.85, libro: 'received', deducible: 'yes' } },
      { cuenta: '41000002', haber: 82.10, comun: true, documento: numero },
    ],
    p_quien_nombre: 'Prueba e2e X06',
  })
  await api(s, 'POST', 'rpc/journal_entry_validar', { p_entry: p.id, p_quien_nombre: 'Prueba e2e X06' })
  return { numero, lineas: new Map([['62300000', 6785], [iva, 1425], ['41000002', -8210]]) }
}

/** El «Sumas y saldos» de ERP10, inventado con su formato: los saldos de Sumied menos la factura que le falta. */
async function sumasSinLaFactura(s: Sesion, fecha: string, falta: Map<string, number>): Promise<Buffer> {
  const c = await api<{ saldos: { codigo: string; nombre: string; saldo: number; erp: string | null }[] }>(s, 'POST', 'rpc/conta_erp10_comprobar', { p_company: EMPRESA_A, p_fecha: fecha })
  const filas: (string | number)[][] = [['Balance de sumas y saldos'], [], [], [], ['Subcuenta', '', '', 'Debe', 'Haber', 'Deudor', 'Acreedor'], []]
  let td = 0, ta = 0
  for (const x of c.saldos) {
    const cent = Math.round(x.saldo * 100) - (falta.get(x.codigo) ?? 0)
    const d = cent > 0 ? cent / 100 : 0, a = cent < 0 ? -cent / 100 : 0
    td += d; ta += a
    filas.push([x.erp ?? x.codigo, x.nombre, '', d, a, d, a])
  }
  filas.push(['', '', 'TOTALES:', Math.round(td * 100) / 100, Math.round(ta * 100) / 100, Math.round(td * 100) / 100, Math.round(ta * 100) / 100])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Datos')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('X06 · contra staging: sacar, subir el sumas y saldos de ERP10, ver la factura que falta, metida a mano e igualado', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X06).')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hoy = hoyEnMadrid()
  const fin = finDeMes(hoy)
  const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const hecho = await preparar(s, hoy)

  // 1 · Paso 1 → descargar → paso 2 → «Ya lo he importado» → paso 3.
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  await expect(page.getByRole('table', { name: 'Qué sale' }).getByRole('row')).toHaveCount(7, { timeout: 40_000 })
  await page.getByRole('button', { name: 'Descargar los ficheros' }).click()
  await expect(page.locator('.cxe-hecho')).toContainText('Queda apuntado.', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Ya lo he importado' }).click()
  await expect(page.getByRole('heading', { name: 'Sube el «Sumas y saldos» de ERP10' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Darlo por igualado/ })).toBeDisabled()

  // 2 · El sumas y saldos de ERP10, al que le falta la factura.
  const excel = await sumasSinLaFactura(s, fin, hecho.lineas)
  await page.getByLabel('El sumas y saldos de ERP10').setInputFiles({ name: 'sumas_y_saldos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel })
  await expect(page.getByText(`Comparado con sumas_y_saldos.xlsx de ERP10, a ${dm(fin)}`)).toBeVisible({ timeout: 30_000 })

  // 3 · Las tres cuentas de la factura no quedan igual, con su explicación.
  await expect(page.getByText('3 cuentas con diferencia')).toBeVisible({ timeout: 30_000 })
  const tabla = page.getByRole('table', { name: 'Cuenta a cuenta' })
  await expect(tabla.getByText('3 cuentas no quedan igual', { exact: true })).toBeVisible()
  const proveedor = tabla.getByRole('row').filter({ hasText: '41000002' })
  await expect(proveedor).toContainText('−82,10')
  await proveedor.click()
  await expect(proveedor).toHaveAttribute('aria-selected', 'true')
  const porque = page.getByRole('complementary', { name: 'Por qué no queda igual' })
  await expect(porque).toContainText(`En ERP10 falta una factura. La ${hecho.numero} del ${dm(hoy)}, de 82,10, salió de Sumied en esta tanda y no está en el saldo de ERP10.`)
  await expect(porque).toContainText('Las otras dos diferencias son de la misma factura:')
  await expect(porque).toContainText('su base (67,85) en la 62300000')
  await expect(porque).toContainText('Sumied no sabe por qué ERP10 no la cogió. Solo ve que falta. El motivo lo dice ERP10 al importar.')
  await expect(porque.getByRole('link', { name: 'Abrir su mayor' })).toHaveAttribute('href', /41000002/)
  await expect(page.getByRole('button', { name: /Darlo por igualado/ })).toBeDisabled()
  // Cabe: la pantalla acaba dentro de la ventana y rueda la tabla, no la página.
  const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
  await page.screenshot({ path: `${DIR}/paso3-diferencias.png` })

  // 4 · «Ya la he metido a mano», y «Darlo por igualado».
  await porque.getByRole('button', { name: 'Ya la he metido a mano' }).click()
  await expect(page.locator('.cxe-hecho')).toHaveText(new RegExp(`^Apuntado: la ${hecho.numero} la metió a mano en ERP10 .+ el \\d\\d/\\d\\d/\\d{4} a las \\d\\d:\\d\\d\\. Ya no cuenta como diferencia\\.$`), { timeout: 30_000 })
  await expect(porque).toContainText('Metida a mano en ERP10.', { timeout: 30_000 })
  const igualar = page.getByRole('button', { name: /Darlo por igualado/ })
  await expect(igualar).toBeEnabled()
  await igualar.click()
  const mes = MESES[Number(hoy.slice(5, 7)) - 1]
  await expect(page.locator('.cxe-hecho')).toHaveText(new RegExp(`^Igualado: ${mes} de ${hoy.slice(0, 4)} queda igual en Sumied y en ERP10 \\(sumas_y_saldos\\.xlsx, a ${dm(fin).replace('/', '\\/')}; \\d+ cuentas\\)\\. Lo dio por igualado .+ el \\d\\d/\\d\\d/\\d{4} a las \\d\\d:\\d\\d\\.$`), { timeout: 30_000 })
  // X07 · La captura, con la pantalla acabada: la tabla con sus filas (no «Comparando…»), el chip verde y el panel que lo dice.
  await expect(page.getByText(/^Igualado el \d\d\/\d\d\/\d{4}/)).toBeVisible({ timeout: 30_000 })
  await expect(porque).toContainText('Igualado: no queda nada por mirar.')
  await expect(tabla.getByRole('row').filter({ hasText: '41000002' })).toBeVisible()
  await expect(page.getByText('3 cuentas tienen la diferencia explicada', { exact: true })).toBeVisible()
  await expect(page.locator('.cxe-fila-filo')).toHaveCount(0)
  await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0)
  await page.screenshot({ path: `${DIR}/paso3-igualado.png` })
  expect(errores).toEqual([])
})
