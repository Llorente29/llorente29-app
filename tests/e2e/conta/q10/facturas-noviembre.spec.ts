/// <reference lib="dom" />
// tests/e2e/conta/q10/facturas-noviembre.spec.ts
//
// Q10 · «Las facturas de noviembre», a 1366 y a 1920 (respuesta 1 al Q10: las
// facturas las emite Cegid; Sumied prepara lo que falta y lo cuadra):
//   1. la línea de arriba frente a GoCardless («Faltan N: mira abajo»), sin
//      «Emitir» ni números: los pone Cegid;
//   2. «Leer de Cegid» (solo lee): lo que va leyendo y lo leído; el código de
//      cliente de Cegid de cada ficha (por su 430 o por su NIF); y la tabla de
//      equivalencias, con el concepto de Cegid que propone lo ya facturado, su
//      serie y su retención;
//   3. en la empresa que retiene, la retención de cada cliente sale de su
//      última factura de Cegid;
//   4. una factura por cliente, mes y serie (Contasimple en la 3), con el atado
//      de «Clientes y cuotas»; lo pendiente con su motivo; lo no cobrado, aparte.
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad.
// Lo que la pantalla LEE se simula (como en ../q08/decisiones-qbo.spec.ts):
// los cobros, suscripciones, mandatos, enlaces, fichas y sus 430, inventados
// (T11), y la conexión y lo leído de Cegid (conta-cegid-leer y conta_cegid_*).
// Nada se escribe: ni en Sumied ni en Cegid.

import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/q10'
const MES = '2026-11'

async function empresas(s: Sesion): Promise<[string, string]> {
  const r = await rest<{ id: string }[]>(s, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&order=created_at.asc`)
  const ids = (r.datos ?? []).map((x) => x.id)
  if (ids.length < 2) throw new Error(`La cuenta de prueba A tiene ${ids.length} empresas y esta prueba necesita dos (HTTP ${r.status}).`)
  return [ids[0], ids[1]]
}

type Fila = Record<string, unknown>
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })

/** Q: una sociedad (sin retención); A: una autónoma (con retención). Los mismos cobros, con sus importes de verdad. */
async function simular(page: Page, Q: string, A: string, conectada = true, fijos = false) {
  const NIF = { [Q]: 'B00000000', [A]: '00000000T' }
  const NOMBRE = { [Q]: 'Gestoría de Prueba Norte, S.L.', [A]: 'Autónoma de Prueba' }
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Fila) => {
      const id = String(x.id)
      if (!(id in NIF)) return x
      const y: Fila = { ...x, sector: 'gestoria', is_hospitality: false, tax_id: NIF[id], fiscal_street: 'Calle Inventada 1', fiscal_postal_code: '28000', fiscal_city: 'Madrid', email: 'gestoria@ejemplo.test' }
      for (const k of ['legal_name', 'trade_name', 'name', 'nombre', 'commercial_name']) if (k in y) y[k] = NOMBRE[id]
      return y
    }
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Fila)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Fila) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  const cobro = (gc: string, importe: number, fecha: string, estado = 'paid_out', x: Fila = {}) =>
    ({ gc_id: `PM${gc}`, estado, fecha, importe, suscripcion_gc_id: `SB${gc}`, mandato_gc_id: `MD${gc}`, motivo_es: null, ...x })
  const cobros = [
    cobro('1', 121, `${MES}-03`), cobro('2', 53, `${MES}-04`), cobro('3', 24.2, `${MES}-04`), cobro('4', 60.5, `${MES}-24`, 'confirmed'),
    // Sin cliente atado, sin NIF y un cobro suelto: a «Pendiente de revisar».
    cobro('5', 121, `${MES}-04`), cobro('6', 36.3, `${MES}-05`), cobro('7', 99, `${MES}-09`, 'paid_out', { suscripcion_gc_id: null }),
    // Lo que GoCardless no cobró: sin factura.
    cobro('8', 121, `${MES}-04`, 'failed', { motivo_es: 'Fondos insuficientes' }), cobro('9', 53, `${MES}-04`, 'charged_back'),
    // El Contasimple del cliente 1: su factura va aparte, en la serie 3.
    cobro('10', 36.3, `${MES}-05`, 'paid_out', { mandato_gc_id: 'MD1' }),
  ]
  const sus = (gc: string, nombre: string) => ({ gc_id: `SB${gc}`, nombre, gc_cliente_id: `CU${gc}` })
  const suscripciones = [sus('1', 'GESTORIA MENSUAL'), sus('2', 'SERVICIOS GESTORIA'), sus('3', 'GESTION LABORAL PERSONA INVENTADA'), sus('4', 'GESTORIA MENSUAL'),
    sus('5', 'GESTORIA MENSUAL'), sus('6', 'CONTASIMPLE SOFTWARE'), sus('8', 'GESTORIA MENSUAL'), sus('9', 'GESTORIA MENSUAL'),
    { gc_id: 'SB10', nombre: 'CONTASIMPLE SOFTWARE', gc_cliente_id: 'CU1' }]
  const mandatos = Array.from({ length: 9 }, (_, i) => ({ gc_id: `MD${i + 1}`, gc_cliente_id: `CU${i + 1}`, cuenta_final: String(10 + i) }))
  const enlaces = Array.from({ length: 9 }, (_, i) => ({ gc_cliente_id: `CU${i + 1}`, party_id: `p${i + 1}`, estado: i + 1 === 5 ? 'propuesto' : 'atado' }))
  const fichas = [
    ['p1', 'Construcciones Ficticias, S.A.', 'A00000000'], ['p2', 'Talleres de Prueba, S.L.', 'B00000000'], ['p3', 'Persona Inventada Uno', '00000000T'],
    ['p4', 'Comercial Ejemplo, S.L.', 'B00000001'], ['p5', 'Sin Atar de Prueba, S.L.', 'B00000002'], ['p6', 'Sin NIF de Prueba, S.L.', null],
    ['p7', 'Suelto de Prueba, S.L.', 'B00000003'], ['p8', 'Fallido de Prueba, S.L.', 'B00000004'], ['p9', 'Devuelto de Prueba, S.L.', 'B00000005'],
  ].map(([id, name, tax_id]) => ({ id, name, tax_id }))
  // Sus 430 en Sumied: p1, p2 y p4 (el código de su cliente en Cegid); p3 no tiene (se ata por su NIF).
  const enlaces430 = [['p1', '43000101'], ['p2', '43000102'], ['p4', '43000104']].map(([entity_id, code]) => ({ entity_id, company_account: { code } }))
  // Lo leído de Cegid: vacío hasta pulsar «Leer de Cegid».
  let leido = false
  const clientesCegid = [[101, 'A00000000'], [102, 'B00000000'], [103, '00000000T'], [104, 'B00000001']]
    .map(([codigo, nif]) => ({ codigo, nombre_comercial: null, nombre_fiscal: `Cliente Cegid ${codigo}`, nif, conceptos: [] as Fila[], leido_at: '2026-11-25T17:00:00Z' }))
  // Respuesta 3: con «fijos», el 102 tiene un concepto fijo en su ficha de Cegid. No lo para: Julio quita Noviembre
  // del periodo MENSUAL en Cegid, y la API los sigue devolviendo.
  if (fijos) clientesCegid[1].conceptos = [{ codigoConcepto: '0002', descripcion: 'SERVICIOS DE GESTORÍA', totalLinea: 43.8, cantidad: 1, importe: 43.8 }]
  const conceptosCegid = [['0001', 'HONORARIOS MENSUALES'], ['0002', 'SERVICIOS DE GESTORÍA'], ['0008', 'GESTIÓN LABORAL']]
    .map(([codigo, descripcion]) => ({ codigo, descripcion, por_iva: 21, con_retencion: false, iva_incluido: false }))
  const linea = (codigoConcepto: string, importe: number, llevaRetencion = false) => ({ linea: 1, codigoConcepto, importe, total: importe, cantidad: 1, porcentajeIva: 21, llevaRetencion })
  const factura = (codigo: number, cliente: number, lineas: Fila[], ret: number) =>
    ({ ejercicio: 2026, serie: '1', codigo, cliente, nif: null, fecha_cegid: 20261005, total: null, retencion: ret ? 7.5 : 0, porcentaje_retencion: ret || null, lineas })
  const facturasCegid = [factura(2700, 101, [linea('0001', 100)], 0), factura(2701, 102, [linea('0002', 50, true)], 15),
    factura(2702, 103, [linea('0008', 20)], 0), factura(2703, 104, [linea('0001', 50, true)], 15)]
  const TABLAS: Record<string, unknown[]> = { conta_gc_cobro: cobros, conta_gc_suscripcion: suscripciones, conta_gc_mandato: mandatos, conta_gc_enlace: enlaces, party: fichas, customer_fiscal: [],
    company_account_link: enlaces430,
    // El atado de «Clientes y cuotas»: el cliente 5 tiene su enlace solo «propuesto», pero su fila aquí lo ata.
    conta_cobro_cliente: [{ party_id: 'p5', gc_cliente_id: 'CU5' }] }
  const CEGID: Record<string, unknown[]> = { conta_cegid_cliente: clientesCegid, conta_cegid_concepto: conceptosCegid, conta_cegid_factura: facturasCegid }
  await page.route(/\/rest\/v1\/(conta_cegid_cliente|conta_cegid_concepto|conta_cegid_factura)\?/, (r) => {
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    return json(r, leido ? CEGID[t] : [])
  })
  // La conexión: el conector, la de la cuenta (con claves) y la de cada sociedad (con su código).
  const objeto = (r: Route, x: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  await page.route(/\/rest\/v1\/connector\?/, (r) => objeto(r, { id: 'conector-diezrec' }))
  await page.route(/\/rest\/v1\/account_connector\?/, (r) => json(r, conectada ? [{ id: 'ac-cuenta', scope: 'account', company_id: null, external_account_id: null },
    { id: 'ac-q', scope: 'company', company_id: Q, external_account_id: '1' }, { id: 'ac-a', scope: 'company', company_id: A, external_account_id: '1' }] : []))
  await page.route(/\/functions\/v1\/connector-credentials/, (r) => objeto(r, { ok: true, hasCredentials: true }))
  const pedidas: Fila[] = []
  await page.route(/\/functions\/v1\/conta-cegid-leer/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    if (b.accion === 'leer') { leido = true; return objeto(r, { ok: true, que: b.que, pagina: b.pagina, leidas: b.que === 'clientes' ? 4 : b.que === 'conceptos' ? 3 : 4, total: 4, ultima: true }) }
    return objeto(r, { ok: true, que: b.que, desde: b.desde, hechos: 4, ultima: true })
  })
  await page.route(/\/rest\/v1\/(conta_gc_cobro|conta_gc_suscripcion|conta_gc_mandato|conta_gc_enlace|party|customer_fiscal|company_account_link|conta_cobro_cliente)\?/, (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    // La segunda página (range desde 1000) va vacía.
    if (/offset=1000|range=1000/.test(r.request().url()) || (r.request().headers()['range'] ?? '').startsWith('1000')) return json(r, [])
    return json(r, TABLAS[t])
  })
  // Respuesta 3 · lo mandado a Cegid (conta_cegid_incidencia) y conta-cegid-mandar, simulados: nada sale a Cegid.
  const mandadas: Fila[] = []
  let numero = 0
  await page.route(/\/rest\/v1\/conta_cegid_incidencia\?/, (r) => json(r, mandadas))
  await page.route(/\/functions\/v1\/conta-cegid-mandar/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    if (b.accion === 'mandar') {
      const ids = b.cobros as string[]
      for (const gc of ids) mandadas.push({ gc_cobro_id: gc, cliente: b.cliente, incidencia: ++numero, estado: 'mandada', total: Number(cobros.find((c) => c.gc_id === gc)?.importe ?? 0) })
      return objeto(r, { ok: true, hechas: ids.length, frase: `Mandado a Cegid el cliente ${b.cliente}: ${ids.length} ${ids.length === 1 ? 'cobro' : 'cobros'}.` })
    }
    const vivas = mandadas.filter((x) => x.estado === 'mandada')
    for (const x of vivas) x.estado = 'deshecha'
    return objeto(r, { ok: true, borradas: vivas.length, facturadas: 0, frase: `Deshecho: ${vivas.length} incidencias borradas en Cegid.` })
  })
  return pedidas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Las facturas de noviembre» a ${ancho}: frente a GoCardless, lo leído de Cegid y la tabla de equivalencias, sin escribir nada`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Las facturas del mes, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const pedidas = await simular(page, Q, A)

    // ── La sociedad: sin retención ──
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${Q}&mes=${MES}`, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Las facturas de noviembre de 2026' })).toBeVisible({ timeout: 30_000 })
    // La pestaña «Facturas del mes», en las páginas de Clientes y cuotas, y marcada (Julio, 25/11: no la encontraba).
    await expect(page.getByRole('list', { name: 'Páginas de Clientes y cuotas' }).getByRole('link', { name: 'Facturas del mes' })).toHaveAttribute('aria-current', 'page')
    const cabecera = page.locator('[data-prueba="cabecera"]')
    // 6 cobros con todo (121 + 53 + 24,20 + 60,50 + 121 del 5, atado por Clientes y cuotas, + 36,30 de Contasimple = 416,00), en
    // 6 facturas (el cliente 1, dos: la serie 1 y la 3); cobrado 416,00 + 36,30 + 99 = 551,30; faltan 2 (135,30).
    await expect(cabecera).toHaveText('Noviembre: 6 facturas (6 cobros), 416,00 €. GoCardless cobró 551,30 €. Faltan 2 (135,30 €): mira abajo.')
    // 1. Ni «Emitir» ni números: los pone Cegid.
    await expect(page.getByRole('button', { name: /Emitir/ })).toHaveCount(0)
    const filas = page.getByRole('table', { name: 'Facturas' }).locator('tbody tr')
    await expect(filas).toHaveCount(6)
    // Una factura por cliente, mes y serie: Contasimple, en la 3.
    await expect(filas.filter({ hasText: 'Construcciones Ficticias, S.A.' })).toHaveCount(2)
    await expect(filas.filter({ hasText: 'Construcciones Ficticias, S.A.' }).and(page.locator('[data-serie="3"]'))).toContainText('CONTASIMPLE SOFTWARE')
    await expect(filas.filter({ hasText: 'Sin Atar de Prueba, S.L.' })).toContainText('121,00 €')

    // 2. «Leer de Cegid»: solo lee; los códigos de cliente y la tabla de equivalencias.
    const cegid = page.locator('[data-prueba="cegid"]')
    await expect(cegid).toContainText('Aún no se ha leído nada de Cegid.')
    await cegid.getByRole('button', { name: 'Leer de Cegid' }).click()
    await expect(cegid.locator('[data-prueba="lectura"]')).toHaveText('Leído de Cegid: 4 clientes con sus conceptos fijos, 3 conceptos y 4 facturas de 2026. No se ha escrito nada en Cegid.', { timeout: 30_000 })
    expect(pedidas.every((p) => p.accion === 'leer' || p.accion === 'detalle')).toBe(true)
    await expect(cegid.locator('[data-prueba="codigos"]')).toHaveText('De 7 fichas atadas: 3 con su 430 igual al código de Cegid (y el mismo NIF), 0 con el código pero otro NIF en Cegid, 1 por su NIF y 3 sin código de Cegid.')
    // Las fichas sin código de Cegid, con su NIF, para mirarlas.
    await cegid.locator('[data-prueba="sin-codigo"] summary').click()
    await expect(cegid.getByRole('table', { name: 'Fichas sin código de Cegid' }).locator('tbody tr')).toHaveCount(3)
    await expect(cegid.getByRole('table', { name: 'Fichas sin código de Cegid' })).toContainText('B00000002')
    const tabla = cegid.getByRole('table', { name: 'Tabla de equivalencias' })
    await expect(tabla.locator('tr[data-familia="GESTORIA MENSUAL"]')).toContainText('0001 HONORARIOS MENSUALES')
    // La 104 se factura con retención (50 € → 53 €) y su cobro es de 60,50 €: no vota.
    await expect(tabla.locator('tr[data-familia="GESTORIA MENSUAL"]')).toContainText('1 de 2 clientes')
    await expect(tabla.locator('tr[data-familia="SERVICIOS GESTORIA"]')).toContainText('0002')
    await expect(tabla.locator('tr[data-familia="SERVICIOS GESTORIA"]')).toContainText('Sí (1 de 1 líneas)')
    await expect(tabla.locator('tr[data-familia="GESTION LABORAL"]')).toContainText('0008 GESTIÓN LABORAL')
    await expect(tabla.locator('tr[data-familia="(sin suscripción)"]')).toContainText('Sin propuesta')

    // 4. Lo pendiente, con su motivo (ya no «sin cliente»: el 5 lo ata Clientes y cuotas); lo no cobrado, aparte.
    await expect(page.locator('[data-prueba="pendientes"] li')).toHaveCount(2)
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_cliente"]')).toHaveCount(0)
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_nif"]')).toContainText('no tiene NIF')
    await expect(page.locator('[data-prueba="sin-factura"] li[data-estado="failed"]')).toContainText('Fallido: GoCardless no lo pudo cobrar (Fondos insuficientes)')

    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/facturas-sociedad-${ancho}.png`, fullPage: true })

    // ── 3. La autónoma: la retención de cada cliente, de su última factura en Cegid ──
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${A}&mes=${MES}`, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Las facturas de noviembre de 2026' })).toBeVisible({ timeout: 30_000 })
    // Lo leído ya está guardado (la simulación lo da): 53 € a Talleres de Prueba (15 %): base 50, retención 7,50; 24,20 a la persona (sin retención): base 20.
    const talleres = filas.filter({ hasText: 'Talleres de Prueba, S.L.' })
    await expect(talleres).toContainText('50,00 €', { timeout: 30_000 })
    await expect(talleres).toContainText('−7,50 €')
    await expect(filas.filter({ hasText: 'Persona Inventada Uno' })).toContainText('20,00 €')
    // 60,50 € con el 15 % no da el total al céntimo: a revisar, no a ojo.
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="no_cuadra"]')).toContainText('Comercial Ejemplo, S.L.')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/facturas-autonoma-${ancho}.png`, fullPage: true })
    expect(errores).toEqual([])
  })
}

test('«Facturas del mes» sin la conexión con Cegid: «Leer de Cegid» se ve, apagado, y dice dónde se conecta', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Las facturas del mes, en el ordenador')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))
  const s = await entrarComo(page, CUENTA_A.email)
  const [Q, A] = await empresas(s)
  await simular(page, Q, A, false)
  await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${Q}&mes=${MES}`, { timeout: 30_000 })
  const cegid = page.locator('[data-prueba="cegid"]')
  await expect(cegid.getByRole('button', { name: 'Leer de Cegid' })).toBeDisabled({ timeout: 30_000 })
  await expect(cegid.locator('[data-prueba="sin-conexion"]')).toContainText('faltan las claves o el código de empresa')
  await expect(cegid.getByRole('link', { name: 'Ponlos en Ajustes › Ejercicio › Facturación de Cegid →' })).toHaveAttribute('href', /\/conta\/ajustes\/empresa\/ejercicio$/)
  mkdirSync(DIR, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/facturas-del-mes-sin-conexion-1366.png` })
  expect(errores).toEqual([])
})

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Mandar a Cegid» a ${ancho}: lo cobrado, el aviso del periodo MENSUAL, primero uno, todos y deshacer (Cegid simulado)`, async ({ page }, info) => {
    test.skip(info.project.name === 'movil', 'Las facturas del mes, en el ordenador')
    test.setTimeout(180_000)
    await page.setViewportSize({ width: ancho, height: alto })
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(e.message))
    const s = await entrarComo(page, CUENTA_A.email)
    const [Q, A] = await empresas(s)
    const pedidas = await simular(page, Q, A, true, true)
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${Q}&mes=${MES}`, { timeout: 30_000 })
    const mandar = page.locator('[data-prueba="mandar"]')
    await expect(mandar.locator('[data-prueba="mandar-por-que-no"]')).toHaveText('Aún no se ha leído lo de Cegid.', { timeout: 30_000 })
    await page.locator('[data-prueba="cegid"]').getByRole('button', { name: 'Leer de Cegid' }).click()
    // Listos: 101 (121 + 36,30 de Contasimple), 102 (53, aunque su ficha de Cegid tenga un concepto fijo), 103 (24,20) y 104 (60,50).
    await expect(mandar.locator('[data-prueba="mandar-frase"]')).toHaveText('Listos para mandar: 4 clientes, 295,00 €.', { timeout: 30_000 })
    await expect(mandar.locator('[data-prueba="mandar-aviso"]')).toHaveText('Antes de facturar, quita Noviembre del periodo MENSUAL en Cegid y comprueba que el precálculo sale vacío.')
    await expect(mandar.locator('[data-prueba="parados"]')).toHaveCount(0)
    // Lo que no sale, con su porqué: lo no cobrado (fallido y devuelto) y las fichas sin código de Cegid.
    await mandar.locator('[data-prueba="no-salen"] summary').click()
    await expect(mandar.locator('[data-prueba="no-salen"] li[data-porque="no_cobrado"]')).toHaveCount(2)
    await expect(mandar.locator('[data-prueba="no-salen"] li[data-porque="sin_codigo"]')).toHaveCount(3)
    // Un solo botón grande: primero uno para probar; «Mandar los N listos» aún no está.
    await expect(mandar.getByRole('button', { name: /Mandar los/ })).toHaveCount(0)
    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await mandar.screenshot({ path: `${DIR}/mandar-a-cegid-${ancho}.png` })

    await mandar.getByRole('button', { name: 'Mandar solo este para probar' }).click()
    await expect(mandar.getByRole('alertdialog')).toContainText('Se manda a Cegid el cliente 101 (Construcciones Ficticias, S.A.): 2 líneas de 2026-11, 157,30 €.')
    await mandar.getByRole('button', { name: 'Sí, adelante' }).click()
    await expect(mandar.locator('[data-prueba="mandar-hecho"]')).toHaveText('Mandado a Cegid el cliente 101: 2 cobros.', { timeout: 30_000 })
    await expect(mandar.locator('[data-prueba="mandar-frase"]')).toHaveText('Listos para mandar: 3 clientes, 137,70 €.')
    await expect(mandar.getByRole('button', { name: 'Deshacer lo mandado (2)' })).toBeVisible()

    await mandar.getByRole('button', { name: 'Mandar los 3 listos' }).click()
    await expect(mandar.getByRole('alertdialog')).toContainText('Se mandan a Cegid 3 clientes, 3 líneas de 2026-11, 137,70 €.')
    await mandar.getByRole('button', { name: 'Sí, adelante' }).click()
    await expect(mandar.locator('[data-prueba="mandar-hecho"]')).toHaveText(/^Mandados a Cegid 3 clientes, 3 líneas\./, { timeout: 30_000 })
    await expect(mandar.getByRole('button', { name: 'Mandar los 0 listos' })).toBeDisabled()

    // Solo lo cobrado, y nada dos veces.
    const mandados = pedidas.filter((p) => p.accion === 'mandar').flatMap((p) => p.cobros as string[])
    expect(mandados.sort()).toEqual(['PM1', 'PM10', 'PM2', 'PM3', 'PM4'])

    await mandar.getByRole('button', { name: 'Deshacer lo mandado (5)' }).click()
    await expect(mandar.getByRole('alertdialog')).toContainText('Se borran en Cegid las 5 líneas que mandó Sumied este mes y aún no están facturadas.')
    await mandar.getByRole('button', { name: 'Sí, adelante' }).click()
    await expect(mandar.locator('[data-prueba="mandar-hecho"]')).toHaveText('Deshecho: 5 incidencias borradas en Cegid.', { timeout: 30_000 })

    // La autónoma: nada se manda hasta leer su Cegid y el sí de Julio.
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${A}&mes=${MES}`, { timeout: 30_000 })
    await expect(page.locator('[data-prueba="mandar-por-que-no"]')).toContainText('persona física', { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Mandar solo este para probar' })).toHaveCount(0)
    expect(errores).toEqual([])
  })
}
