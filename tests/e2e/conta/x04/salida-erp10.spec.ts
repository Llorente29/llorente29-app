/// <reference lib="dom" />
// tests/e2e/conta/x04/salida-erp10.spec.ts
//
// X04 · «Salida a ERP10», en el ordenador (encargo X04, 17/11):
//   1. La ficha (Ajustes › Ejercicio): se enciende con el código de la empresa en
//      ERP10 y lo confirma con el texto de la base.
//   2. La pantalla (Libros › Cierre › Salida a ERP10): las cinco filas de «Qué sale»
//      con sus cifras; la lista de las recibidas al pulsarla; un aviso de «no puede
//      salir»; «Descargar los ficheros» baja subcuentas.xlsx, recibidas.xlsx y
//      pdf.zip, apunta lo que sale y lo confirma con contenido; el fichero de
//      recibidas se abre y una fila se comprueba celda a celda; «Ya lo he
//      importado» vuelve al paso 1, que ya no enseña lo salido.
// Lo que dice la base (las funciones del X04 y las tablas de la X02, con la columna
// nueva de la carpeta) está SIMULADO en el navegador con la forma que devuelve:
// staging solo ensaya la tanda del X04 en ROLLBACK hasta que se aplique en
// producción. Que la base hace lo que se simula lo prueban las pruebas de staging
// de la X02 y del X04. Nada se escribe en staging.
// Capturas del paso 1, del paso 2 y del apartado de la ficha, a 1456 × 816.

import { test, expect, type Page, type Route, type Download } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/x04'
const json = (r: Route, cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  r.fulfill({ status: 200, contentType: 'application/json', headers: cabeceras, body: JSON.stringify(cuerpo) })
const id = (n: number) => `0e2e0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** Lo que contesta la base, inventado y con la forma de verdad. Cambia al encender y al apuntar. */
function simular(page: Page) {
  const estado = { encendida: false, codigo: null as string | null, apuntados: [] as unknown[] }
  const salida = () => ({
    encendida: estado.encendida, codigo_erp10: estado.codigo, largo_subcuenta: estado.encendida ? 8 : null, desde: estado.encendida ? '2026-10-01' : null,
    carpeta_pdf: null, cambiado_por_nombre: estado.encendida ? 'Prueba e2e X04' : null, cambiado_en: '2026-11-17T10:00:00+00:00',
  })
  const partida = (n: number, clase: string, o: Record<string, unknown> = {}) => ({
    entry_id: id(n), serie: clase === 'emitida' ? 1 : clase === 'asiento' ? 4 : 2, numero: n, fecha: '2026-10-05', concepto: `Inventado X04 ${n}`,
    origen: clase === 'recibida' ? 'supplier_invoice' : 'manual', clase, importe: 121, base_iva: 100, numero_factura: `X04-E2E-${n}`, nif: 'B00000000',
    tercero: 'Proveedor Inventado X04, S.L.', cuentas_base: 1, tiene_pdf: true, de_otro_mes: false, sale: true, avisos: [], ...o,
  })
  const L = (cuenta: string, plantilla: string, debe: number, haber: number, iva: [number, number] | null = null) =>
    ({ cuenta, plantilla, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, deducible: iva ? 'yes' : null, recargo: null, modeloRetencion: null })
  const recibida = (n: number, pdf: boolean, otroMes = false) => ({
    entryId: id(n), fecha: otroMes ? '2026-09-28' : '2026-10-05', factura: { numero: `X04-E2E-${n}`, fecha: '2026-10-03' },
    proveedor: { nombre: 'Proveedor Inventado X04, S.L.', nif: 'B00000000' }, operacion: 'interior',
    lineas: [L('62900000', '629', 100, 0), L('47200000', '472', 21, 0, [21, 100]), L('40000001', '4000', 0, 121)],
    tienePdf: pdf, pdf: pdf ? { ruta: `inventado/x04/${n}.pdf`, nombre: `${n}.pdf` } : null,
  })
  const salido = () => estado.apuntados.length > 0
  const porSalir = () => ({
    mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [],
    partidas: [
      ...(salido() ? [] : [partida(1, 'recibida'), partida(2, 'recibida', { tiene_pdf: false, de_otro_mes: true })]),
      partida(3, 'recibida', { sale: false, avisos: ['Reparte la base en 5 cuentas y ERP10 admite 4: no sale.'] }),
      partida(4, 'emitida', { importe: 242 }), partida(5, 'asiento', { importe: 30, numero_factura: null }), partida(6, 'asiento', { importe: 1000, numero_factura: null }),
    ],
  })
  const recibidas = () => ({
    mes: '2026-10-01', codigo: '0007', largo: 8,
    recibidas: salido() ? [] : [recibida(1, true), recibida(2, false, true)],
    cuentas: [
      { codigo: '40000001', plantilla: '4000', nombre: 'Proveedor Inventado X04', nif: 'B00000000', gastoHabitual: '62900000' },
      { codigo: '47200000', plantilla: '472', nombre: 'IVA soportado', nif: null, gastoHabitual: null },
      { codigo: '62900000', plantilla: '629', nombre: 'Otros servicios', nif: null, gastoHabitual: null },
    ],
    yaSalidas: salido() ? { '40000001': '40000001', '62900000': '62900000' } : {},
  })
  const lotes = () => (salido() ? [{ id: id(99), mes: '2026-10-01', recibidas: 2, emitidas: 0, asientos: 0, cuentas_nuevas: 2, creado_por_nombre: 'Prueba e2e X04', creado_en: '2026-11-17T10:05:00+00:00' }] : [])

  const tablas = async (r: Route, filas: () => unknown[] | unknown) => {
    const req = r.request()
    if (req.method() === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': `*/${lotes().length}` }, body: '' })
    const uno = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const f = filas()
    return json(r, uno ? f : Array.isArray(f) ? f : [f])
  }
  return Promise.all([
    page.route(/\/rest\/v1\/conta_erp10_salida_empresa(\?|$)/, (r) => tablas(r, () => (estado.encendida || estado.codigo ? salida() : []))),
    page.route(/\/rest\/v1\/conta_erp10_salida_lote(\?|$)/, (r) => tablas(r, lotes)),
    page.route(/\/rest\/v1\/rpc\/conta_erp10_salida_poner(\?|$)/, (r) => {
      const p = (r.request().postDataJSON() ?? {}) as { p_encender?: boolean; p_codigo?: string }
      estado.encendida = p.p_encender === true; estado.codigo = p.p_codigo ?? estado.codigo
      return json(r, { encendida: estado.encendida, codigo: estado.codigo, largo: 8, desde: '2026-10-01',
        texto: estado.encendida ? `Encendida: sale a ERP10 lo validado desde el 01/10/2026, con el código de empresa ${estado.codigo} y subcuentas de 8 cifras.` : 'Apagada: no sale nada a ERP10. Lo que ya salió queda apuntado.' })
    }),
    page.route(/\/rest\/v1\/rpc\/conta_erp10_salida_carpeta(\?|$)/, (r) => json(r, { carpeta: null, texto: 'Los PDF irán a la carpeta de siempre, C:\\Sumied\\0007\\.' })),
    page.route(/\/rest\/v1\/rpc\/conta_erp10_por_salir(\?|$)/, (r) => json(r, porSalir())),
    page.route(/\/rest\/v1\/rpc\/conta_erp10_recibidas_por_salir(\?|$)/, (r) => json(r, recibidas())),
    page.route(/\/rest\/v1\/rpc\/conta_erp10_cambiadas(\?|$)/, (r) => json(r, [])),
    page.route(/\/rest\/v1\/rpc\/conta_erp10_lote_apuntar(\?|$)/, (r) => {
      estado.apuntados.push(r.request().postDataJSON())
      return json(r, { lote: id(99), texto: 'Apuntado lo que sale de 10/2026: 2 facturas recibidas, 0 facturas emitidas, 0 asientos y 2 cuentas nuevas.' })
    }),
    page.route(/\/storage\/v1\/object\/(authenticated\/)?conta-documentos\//, (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: PDF })),
  ]).then(() => estado)
}

test('X04 · encender en la ficha, mirar lo que sale, descargar y volver al paso 1', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X04).')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1456, height: 816 })
  await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const estado = await simular(page)

  // 1 · La ficha: se enciende con el código y lo confirma con el texto de la base.
  await page.goto('/conta/ajustes/ejercicio', { waitUntil: 'load' })
  const ficha = page.getByRole('form', { name: 'Salida a ERP10' })
  await expect(ficha).toBeVisible({ timeout: 40_000 })
  await ficha.getByRole('switch').check()
  await ficha.getByLabel('Código de la empresa en ERP10').fill('0007')
  await expect(ficha.getByText('Es el número que sale entre corchetes arriba, en ERP10.')).toBeVisible()
  await expect(ficha.getByText('Tiene que ser la misma carpeta donde descomprimas los PDF. ERP10 los busca ahí.', { exact: false })).toBeVisible()
  await ficha.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Encendida: sale a ERP10 lo validado desde el 01/10/2026, con el código de empresa 0007 y subcuentas de 8 cifras.')).toBeVisible({ timeout: 20_000 })
  expect(estado.encendida).toBe(true)
  await ficha.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${DIR}/ficha.png` })

  // 2 · La pantalla: las cinco filas con sus cifras.
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  const tabla = page.getByRole('table', { name: 'Qué sale' })
  await expect(tabla.getByRole('row')).toHaveCount(6, { timeout: 30_000 })
  const fila = (que: string) => tabla.getByRole('row').filter({ hasText: que })
  await expect(fila('Cuentas nuevas')).toContainText('2')
  await expect(fila('Facturas recibidas')).toContainText('242,00')
  await expect(fila('Facturas recibidas')).toContainText('Mira esto')
  await expect(fila('Facturas emitidas')).toContainText('Todavía no sale por aquí')
  await expect(fila('Asientos')).toContainText('1.030,00')
  await expect(fila('Los PDF')).toContainText('1')
  // La lista de las recibidas, con la de otro mes marcada.
  await fila('Facturas recibidas').click()
  const lista = page.getByRole('table', { name: 'Facturas recibidas' })
  await expect(lista.getByRole('row')).toHaveCount(3)
  await expect(lista.getByText('de otro mes')).toBeVisible()
  // «Qué mirar»: la que no puede salir, con su frase y su enlace.
  await expect(page.getByText('1 factura recibida no puede salir.')).toBeVisible()
  await expect(page.getByText('Reparte la base en 5 cuentas y ERP10 admite 4: no sale.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'X04-E2E-3' })).toBeVisible()
  await expect(page.getByText('1 factura recibida no tiene PDF.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Comprobaciones' })).toContainText('Todas cuadran')
  // La página no se mueve: la pantalla acaba dentro de la ventana de 1456 × 816, y lo que no cabe rueda dentro.
  // (Se mide la pantalla, no el documento: el marco de staging lleva arriba su franja «no es producción».)
  const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
  expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
  await page.screenshot({ path: `${DIR}/paso1.png` })

  // Descargar: los tres ficheros, lo apunta y lo confirma con contenido.
  const bajadas: Download[] = []
  page.on('download', (d) => bajadas.push(d))
  await page.getByRole('button', { name: 'Descargar los ficheros' }).click()
  await expect(page.getByText('Descargado: 2 cuentas nuevas y 2 facturas recibidas, 242,00 €. Los PDF, en un fichero comprimido. Queda apuntado.')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => bajadas.map((d) => d.suggestedFilename()).sort(), { timeout: 20_000 }).toEqual(['pdf.zip', 'recibidas.xlsx', 'subcuentas.xlsx'])
  expect(estado.apuntados).toHaveLength(1)
  const apuntado = estado.apuntados[0] as { p_partidas: { entry_id: string; clase: string; huella: string }[]; p_ficheros: { nombre: string }[] }
  expect(apuntado.p_partidas.map((p) => [p.entry_id, p.clase])).toEqual([[id(1), 'recibida'], [id(2), 'recibida']])
  expect(apuntado.p_ficheros.map((f) => f.nombre)).toEqual(['subcuentas.xlsx', 'recibidas.xlsx', 'pdf.zip'])

  // El fichero de recibidas se abre: una fila, celda a celda.
  const recibidasXlsx = bajadas.find((d) => d.suggestedFilename() === 'recibidas.xlsx')!
  const wb = XLSX.read(readFileSync(await recibidasXlsx.path()), { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  expect(ws.G1.v).toBe('40000001')
  expect(ws.I1.v).toBe('X04-E2E-1')
  expect(ws.AB1.v).toBe(121)
  expect(ws.AM1.v).toBe('OI')
  expect(ws.Z1.v).toBe('C:\\Sumied\\0007\\20261003_Proveedor-Inventado-X04-S-L_X04-E2E-1.pdf')
  expect(ws.A2).toBeUndefined()

  // Paso 2: los ficheros en orden, con su botón de ERP10.
  const orden = page.getByRole('table', { name: 'Los ficheros, en el orden en que se importan' })
  await expect(orden.getByRole('row')).toHaveCount(4)
  await expect(orden).toContainText('Descomprímelos en C:\\Sumied\\0007\\ antes de importar las facturas.')
  await expect(page.getByText('Primero las cuentas: si no, ERP10 no encuentra a qué apuntar las facturas.')).toBeVisible()
  await page.getByRole('button', { name: 'La primera vez' }).click()
  await expect(page.getByText('En ERP10: Importaciones › Facturas › Configurar Excel › Configuración.')).toBeVisible()
  await page.screenshot({ path: `${DIR}/paso2.png` })

  // «Ya lo he importado»: de vuelta al paso 1, sin lo salido.
  await page.getByRole('button', { name: 'Ya lo he importado' }).click()
  await expect(tabla.getByRole('row')).toHaveCount(6, { timeout: 30_000 })
  await expect(fila('Facturas recibidas')).toContainText('0')
  await expect(page.getByText('Última salida: 17/11/2026, octubre de 2026.')).toBeVisible()
  expect(errores).toEqual([])
})
