/// <reference lib="dom" />
// tests/e2e/conta/x05/salida-erp10.spec.ts
//
// X05 · «Salida a ERP10», en el ordenador, CONTRA STAGING DE VERDAD (encargo X05,
// corrección 1 del X04·1: una e2e con la base simulada no prueba que la pantalla
// y la base se entienden; regla 40). Sustituye a la del X04, que simulaba la base.
//
// En el carril de la e2e (se clona para el run y se borra al acabar), con la
// cuenta A y su empresa de pruebas, y con la sesión del administrador (la misma
// RLS que la pantalla, nunca la clave de servicio):
//   0. Prepara por la API lo que la pantalla no crea sola: una factura de venta
//      emitida por el camino de verdad (conta_venta_guardar y conta_venta_emitir,
//      con su PDF subido y guardado con conta_venta_pdf_guardar) y una recibida
//      validada (journal_entry_proponer y journal_entry_validar).
//   1. La ficha (Ajustes › Ejercicio): se enciende con el código y desde el día 1
//      del mes, escrito dd/mm/aaaa, y lo confirma con el texto de la base.
//   2. La pantalla (Libros › Cierre › Salida a ERP10): la fila de las emitidas,
//      pulsada, con la factura en su lista; la de las recibidas, con la suya.
//   3. «Descargar los ficheros» baja subcuentas.xlsx, expedidas.xlsx,
//      recibidas.xlsx y pdf.zip, lo apunta y lo confirma con contenido; una fila
//      de cada Excel, comprobada.
//   4. El paso 2, con los cuatro ficheros en su orden; «Ya lo he importado» lleva al
//      paso 3 (X06) y, desde ahí, el paso 1 ya no enseña lo salido.
// Navegador en español (playwright.config.ts: locale es-ES y --lang=es-ES); la
// fecha de la ficha es el campo de Sumied, dd/mm/aaaa, sea cual sea el idioma.
// Capturas del paso 1 (con la fila de emitidas pulsada) y del paso 2, a 1456 × 816.
// Datos inventados y que se ven inventados (T11): NIF B00000000.

import { test, expect, type Page, type Download } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { CARRIL, CUENTA_A, STAGING_URL, anonKey, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

test.skip(CARRIL === null, 'La salida a ERP10 escribe en la cuenta A (enciende la salida, emite y apunta): necesita su carril.')

const DIR = 'docs/conta/capturas/x05'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await rest<T>(s, metodo, ruta, cuerpo)
  if (r.status >= 300) throw new Error(`${metodo} ${ruta.split('?')[0]}: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  return r.datos
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Hoy en Madrid (AAAA-MM-DD) y el día 1 de su mes. */
function hoyEnMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
const dma = (iso: string) => iso.split('-').reverse().join('/')
const mesEnPalabras = (iso: string) => {
  const [a, m] = iso.split('-').map(Number)
  return `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m - 1]} de ${a}`
}

type Cuenta = { id: string; code: string; name: string; template_code: string | null }

/** Una cuenta de la empresa que cumpla `vale`, o una nueva de esa hoja con ese nombre. */
async function cuenta(s: Sesion, cuentas: Cuenta[], vale: (c: Cuenta) => boolean, hoja: string, nombre: string): Promise<Cuenta> {
  const ya = cuentas.find(vale)
  if (ya) return ya
  const r = await api<{ id: string; code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: hoja, p_nombre: nombre, p_quien_nombre: 'Prueba e2e X05' })
  return { id: r.id, code: r.code, name: nombre, template_code: hoja }
}

/** Lo que la pantalla no crea sola: una emitida con su PDF y una recibida, validadas, de hoy. */
async function preparar(s: Sesion, hoy: string) {
  const tipos = await api<{ id: string; code: string }[]>(s, 'GET', 'tax_rate?select=id,code&is_system=is.true&valid_to=is.null&code=eq.iva_general')
  const t21 = tipos[0]?.id
  if (!t21) throw new Error('No está el tipo de IVA general del sistema.')
  const cuentas = await api<Cuenta[]>(s, 'GET', `company_account?select=id,code,name,template_code&company_id=eq.${EMPRESA_A}&or=(code.like.7*,code.like.477*,code.like.472*)`)
  const ventas = await cuenta(s, cuentas, (c) => /^70[05]/.test(c.code), '700', 'Ventas inventadas X05')
  // La 477 del 21 %: la que busca conta_venta_emitir (su nombre dice «21» y no es la 47700000).
  await cuenta(s, cuentas, (c) => c.code.startsWith('477') && c.code !== '47700000' && /21/.test(c.name), '477', 'IVA repercutido 21 %')
  const soportado = await cuenta(s, cuentas, (c) => c.code.startsWith('472'), '472', 'IVA soportado inventado X05')

  // La emitida: el cliente, la factura, emitirla y su PDF.
  // Por el camino de Contactos (party_save_customer). Si el NIF inventado ya es de otro tercero del carril, ese, con este nombre.
  const alta = (party: string | null) => rest<{ party_id: string }>(s, 'POST', 'rpc/party_save_customer',
    { p_account: CUENTA_A.id, p_party: party, p_nombre: 'Cliente Inventado X05 E2E, S.L.', p_nif: 'B00000000', p_datos: {}, p_quien_nombre: 'Prueba e2e X05' })
  let r = await alta(null)
  const otro = r.status >= 300 ? JSON.stringify(r.datos).match(/MISMO_NIF ([0-9a-f-]{36})/)?.[1] : undefined
  if (otro) r = await alta(otro)
  if (r.status >= 300) throw new Error(`party_save_customer: HTTP ${r.status} · ${JSON.stringify(r.datos).slice(0, 300)}`)
  const cliente = { id: r.datos.party_id }
  const f = await api<{ id: string }>(s, 'POST', 'rpc/conta_venta_guardar', {
    p_company: EMPRESA_A, p_id: null, p_datos: { cliente_id: cliente.id, fecha: hoy },
    p_lineas: [{ concepto: 'Servicio inventado X05', cantidad: 1, precio: 100, tipo_id: t21, cuenta_id: ventas.id }], p_quien_nombre: 'Prueba e2e X05',
  })
  const emitida = await api<{ numero: string; asiento: string }>(s, 'POST', 'rpc/conta_venta_emitir', { p_id: f.id, p_quien_nombre: 'Prueba e2e X05' })
  const ruta = `${CUENTA_A.id}/ventas/${f.id}/x05-e2e.pdf`
  const sube = await fetch(`${STAGING_URL}/storage/v1/object/conta-documentos/${ruta}`, {
    method: 'POST', headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf' }, body: PDF,
  })
  if (!sube.ok) throw new Error(`Subir el PDF de la emitida: HTTP ${sube.status} · ${(await sube.text()).slice(0, 200)}`)
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PDF)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await api(s, 'POST', 'rpc/conta_venta_pdf_guardar', { p_id: f.id, p_ruta: ruta, p_sha256: sha, p_bytes: PDF.length })

  // La recibida: un gasto con su IVA y su acreedor, validada.
  const numero = `X05-E2E-R-${Date.now() % 100000}`
  const p = await api<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
    p_company: EMPRESA_A,
    p_entry: { series: 2, fecha: hoy, concepto: `E2E X05 · recibida ${numero}`, source_type: 'manual', confianza: 'seguro', porque: 'Recibida de la prueba e2e del X05.', documento: numero, fecha_documento: hoy },
    p_lines: [
      { cuenta: '62300000', debe: 100, comun: true, documento: numero },
      { cuenta: soportado.code, debe: 21, comun: true, documento: numero, iva: { tipo_id: t21, base: 100, libro: 'received', deducible: 'yes' } },
      { cuenta: '41000002', haber: 121, comun: true, documento: numero },
    ],
    p_quien_nombre: 'Prueba e2e X05',
  })
  await api(s, 'POST', 'rpc/journal_entry_validar', { p_entry: p.id, p_quien_nombre: 'Prueba e2e X05' })
  return { emitida: emitida.numero, recibida: numero }
}

test('X05 · contra staging: encender, mirar las emitidas y las recibidas, descargar los cuatro ficheros y volver al paso 1', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X05).')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hoy = hoyEnMadrid()
  const dia1 = `${hoy.slice(0, 8)}01`
  const hecho = await preparar(s, hoy)

  // 1 · La ficha: se enciende con el código y desde el día 1 del mes, en dd/mm/aaaa.
  await page.goto('/conta/ajustes/ejercicio', { waitUntil: 'load' })
  const ficha = page.getByRole('form', { name: 'Salida a ERP10' })
  await expect(ficha).toBeVisible({ timeout: 40_000 })
  await ficha.getByRole('switch').check()
  // Si en el mismo carril ya salió algo (la e2e del X06, con el mismo código), el código ya no se cambia: se queda el 0007.
  const codigo = ficha.getByLabel('Código de la empresa en ERP10')
  if (await codigo.isEditable()) await codigo.fill('0007')
  else await expect(codigo).toHaveValue('0007')
  const desde = ficha.getByLabel('Desde qué día sale')
  await desde.fill(dma(dia1))
  await desde.blur()
  await expect(desde).toHaveValue(dma(dia1))
  await ficha.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText(`Encendida: sale a ERP10 lo validado desde el ${dma(dia1)}, con el código de empresa 0007 y subcuentas de 8 cifras.`)).toBeVisible({ timeout: 20_000 })

  // 2 · La pantalla, con lo de verdad de la base.
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  await expect(page.getByRole('combobox', { name: 'Mes' })).toHaveValue(dia1)
  const tabla = page.getByRole('table', { name: 'Qué sale' })
  await expect(tabla.getByRole('row')).toHaveCount(7, { timeout: 40_000 })
  const fila = (que: string) => tabla.getByRole('row').filter({ hasText: que })
  await expect(fila('Facturas emitidas')).not.toContainText('Todavía no sale por aquí')
  await expect(fila('Días de ventas del TPV')).toContainText('Todavía no sale por aquí')
  // La de las recibidas, con la suya.
  await fila('Facturas recibidas').click()
  await expect(page.getByRole('table', { name: 'Facturas recibidas' }).getByRole('link', { name: hecho.recibida })).toBeVisible()
  // La de las emitidas, pulsada: su lista, con la factura y su cliente.
  await fila('Facturas emitidas').click()
  await expect(fila('Facturas emitidas')).toHaveAttribute('aria-selected', 'true')
  const lista = page.getByRole('table', { name: 'Facturas emitidas' })
  const suya = lista.getByRole('row').filter({ hasText: hecho.emitida })
  await expect(suya).toContainText('Cliente Inventado X05 E2E, S.L.')
  await expect(suya).toContainText('121,00')
  await expect(suya).toContainText(dma(hoy))
  // La página no se mueve: la pantalla acaba dentro de la ventana.
  const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
  await page.screenshot({ path: `${DIR}/paso1.png` })

  // 3 · Descargar: lo apunta y lo confirma con contenido; solo entonces se entregan los ficheros.
  const bajadas: Download[] = []
  page.on('download', (d) => bajadas.push(d))
  // Si alguna sale sin PDF, se dice antes y se aceptan (es lo que ve quien lo hace).
  const igual = page.getByRole('button', { name: 'Sacarlas igual' }).first()
  if (await igual.isVisible()) await igual.click()
  await page.getByRole('button', { name: 'Descargar los ficheros' }).click()
  const confirma = page.locator('.cxe-hecho')
  await expect(confirma).toHaveText(/^Descargado: \d+ cuentas? nuevas?, \d+ facturas? emitidas? \([\d.]+,\d\d €\)(, | y )\d+ facturas? recibidas? \([\d.]+,\d\d €\)( y \d+ asientos? \([\d.]+,\d\d €\))?\. Los PDF, en un fichero comprimido\. Queda apuntado\.$/, { timeout: 60_000 })
  // X07: si en el mes hay asientos (nóminas, pagos y cobros) de otra prueba del carril, sale también su fichero.
  await expect.poll(() => bajadas.map((d) => d.suggestedFilename()).filter((f) => f !== 'asientos.xlsx').sort(), { timeout: 30_000 })
    .toEqual(['expedidas.xlsx', 'pdf.zip', 'recibidas.xlsx', 'subcuentas.xlsx'])

  const hoja = async (nombre: string) => {
    const d = bajadas.find((x) => x.suggestedFilename() === nombre)!
    const wb = XLSX.read(readFileSync(await d.path()), { type: 'buffer', cellDates: true })
    return wb.Sheets[wb.SheetNames[0]]
  }
  // Por la celda I de cada fila (el número): la hoja no empieza en la A (no se escriben las celdas vacías).
  const filaCon = (ws: XLSX.WorkSheet, numero: string) => {
    const hasta = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').e.r + 1
    const n = Array.from({ length: hasta }, (_, k) => k + 1).find((r) => ws[`I${r}`]?.v === numero)
    expect(n, `la fila de ${numero}`).toBeDefined()
    return n!
  }
  // Una fila de expedidas: fecha (E), cliente (G), número (I), IVA 1 (J, K, L), PDF (Z), ingreso (AA, AC) y total (AB).
  const ex = await hoja('expedidas.xlsx')
  const n = filaCon(ex, hecho.emitida)
  expect(ex[`E${n}`].t).toBe('d')
  expect(String(ex[`G${n}`].v)).toMatch(/^430\d{5}$/)
  expect([ex[`J${n}`].v, ex[`K${n}`].v, ex[`L${n}`].v, ex[`AC${n}`].v, ex[`AB${n}`].v]).toEqual([100, 21, 21, 100, 121])
  expect(String(ex[`AA${n}`].v)).toMatch(/^70[05]\d{5}$/)
  expect(String(ex[`Z${n}`].v)).toMatch(/^C:\\Sumied\\0007\\\d{8}_Cliente-Inventado-X05-E2E-S-L_.+\.pdf$/)
  // Una fila de recibidas: número (I), total (AB) y tipo de operación (AM).
  const re = await hoja('recibidas.xlsx')
  const m = filaCon(re, hecho.recibida)
  expect([re[`AB${m}`].v, re[`AM${m}`].v, re[`J${m}`].v, re[`K${m}`].v, re[`L${m}`].v]).toEqual([121, 'OI', 100, 21, 21])
  // La cuenta del cliente, en subcuentas, con su NIF.
  const sub = await hoja('subcuentas.xlsx')
  const filasSub = XLSX.utils.decode_range(sub['!ref'] ?? 'A1').e.r + 1
  expect(Array.from({ length: filasSub }, (_, k) => k + 1).some((r) => sub[`A${r}`]?.v === ex[`G${n}`].v && sub[`C${r}`]?.v === 'B00000000'),
    'la 430 del cliente, con su NIF').toBe(true)

  // 4 · El paso 2: los cuatro ficheros, en el orden en que se importan.
  const orden = page.getByRole('table', { name: 'Los ficheros, en el orden en que se importan' })
  await expect(orden.getByRole('row').nth(1)).toContainText('subcuentas.xlsx')
  await expect(orden.getByRole('row').nth(2)).toContainText('expedidas.xlsx')
  await expect(orden.getByRole('row').nth(2)).toContainText('Facturas, eligiendo «Facturas emitidas»')
  await expect(orden.getByRole('row').nth(3)).toContainText('recibidas.xlsx')
  await expect(orden.getByRole('row').last()).toContainText('pdf.zip')
  await expect(page.getByText('Primero las cuentas; después las emitidas, las recibidas y los asientos.')).toBeVisible()
  await page.getByRole('button', { name: 'La primera vez' }).click()
  await expect(page.getByRole('button', { name: 'ConfiguracionExpedidas.XML' })).toBeVisible()
  await page.screenshot({ path: `${DIR}/paso2.png` })

  // «Ya lo he importado»: al paso 3 (X06); de ahí, al paso 1, sin lo salido.
  await page.getByRole('button', { name: 'Ya lo he importado' }).click()
  await expect(page.getByRole('heading', { name: 'Sube el «Sumas y saldos» de ERP10' })).toBeVisible()
  await page.getByRole('button', { name: 'Mira lo que sale' }).click()
  await expect(tabla.getByRole('row')).toHaveCount(7, { timeout: 40_000 })
  await fila('Facturas emitidas').click()
  await expect(page.getByRole('table', { name: 'Facturas emitidas' })).not.toContainText(hecho.emitida)
  await expect(page.getByText(`Última salida: ${dma(hoy)}, ${mesEnPalabras(dia1)}.`)).toBeVisible()
  expect(errores).toEqual([])
})
