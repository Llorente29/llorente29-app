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
//   4. lo pendiente con su motivo; lo que GoCardless no cobró, aparte; el PDF
//      de muestra de un cobro se abre.
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
async function simular(page: Page, Q: string, A: string) {
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
  ]
  const sus = (gc: string, nombre: string) => ({ gc_id: `SB${gc}`, nombre, gc_cliente_id: `CU${gc}` })
  const suscripciones = [sus('1', 'GESTORIA MENSUAL'), sus('2', 'SERVICIOS GESTORIA'), sus('3', 'GESTION LABORAL PERSONA INVENTADA'), sus('4', 'GESTORIA MENSUAL'),
    sus('5', 'GESTORIA MENSUAL'), sus('6', 'CONTASIMPLE SOFTWARE'), sus('8', 'GESTORIA MENSUAL'), sus('9', 'GESTORIA MENSUAL')]
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
    .map(([codigo, nif]) => ({ codigo, nombre_comercial: null, nombre_fiscal: `Cliente Cegid ${codigo}`, nif, conceptos: [], leido_at: '2026-11-25T17:00:00Z' }))
  const conceptosCegid = [['0001', 'HONORARIOS MENSUALES'], ['0002', 'SERVICIOS DE GESTORÍA'], ['0008', 'GESTIÓN LABORAL']]
    .map(([codigo, descripcion]) => ({ codigo, descripcion, por_iva: 21, con_retencion: false, iva_incluido: false }))
  const linea = (codigoConcepto: string, importe: number, llevaRetencion = false) => ({ linea: 1, codigoConcepto, importe, total: importe, cantidad: 1, porcentajeIva: 21, llevaRetencion })
  const factura = (codigo: number, cliente: number, lineas: Fila[], ret: number) =>
    ({ ejercicio: 2026, serie: '1', codigo, cliente, nif: null, fecha_cegid: 20261005, total: null, retencion: ret ? 7.5 : 0, porcentaje_retencion: ret || null, lineas })
  const facturasCegid = [factura(2700, 101, [linea('0001', 100)], 0), factura(2701, 102, [linea('0002', 50, true)], 15),
    factura(2702, 103, [linea('0008', 20)], 0), factura(2703, 104, [linea('0001', 50, true)], 15)]
  const TABLAS: Record<string, unknown[]> = { conta_gc_cobro: cobros, conta_gc_suscripcion: suscripciones, conta_gc_mandato: mandatos, conta_gc_enlace: enlaces, party: fichas, customer_fiscal: [],
    company_account_link: enlaces430 }
  const CEGID: Record<string, unknown[]> = { conta_cegid_cliente: clientesCegid, conta_cegid_concepto: conceptosCegid, conta_cegid_factura: facturasCegid }
  await page.route(/\/rest\/v1\/(conta_cegid_cliente|conta_cegid_concepto|conta_cegid_factura)\?/, (r) => {
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    return json(r, leido ? CEGID[t] : [])
  })
  // La conexión: el conector, la de la cuenta (con claves) y la de cada sociedad (con su código).
  const objeto = (r: Route, x: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  await page.route(/\/rest\/v1\/connector\?/, (r) => objeto(r, { id: 'conector-diezrec' }))
  await page.route(/\/rest\/v1\/account_connector\?/, (r) => json(r, [{ id: 'ac-cuenta', scope: 'account', company_id: null, external_account_id: null },
    { id: 'ac-q', scope: 'company', company_id: Q, external_account_id: '1' }, { id: 'ac-a', scope: 'company', company_id: A, external_account_id: '1' }]))
  await page.route(/\/functions\/v1\/connector-credentials/, (r) => objeto(r, { ok: true, hasCredentials: true }))
  const pedidas: Fila[] = []
  await page.route(/\/functions\/v1\/conta-cegid-leer/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    if (b.accion === 'leer') { leido = true; return objeto(r, { ok: true, que: b.que, pagina: b.pagina, leidas: b.que === 'clientes' ? 4 : b.que === 'conceptos' ? 3 : 4, total: 4, ultima: true }) }
    return objeto(r, { ok: true, que: b.que, desde: b.desde, hechos: 4, ultima: true })
  })
  await page.route(/\/rest\/v1\/(conta_gc_cobro|conta_gc_suscripcion|conta_gc_mandato|conta_gc_enlace|party|customer_fiscal|company_account_link)\?/, (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    // La segunda página (range desde 1000) va vacía.
    if (/offset=1000|range=1000/.test(r.request().url()) || (r.request().headers()['range'] ?? '').startsWith('1000')) return json(r, [])
    return json(r, TABLAS[t])
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
    const cabecera = page.locator('[data-prueba="cabecera"]')
    // 4 cobros con todo (121 + 53 + 24,20 + 60,50 = 258,70); cobrado 258,70 + 121 + 36,30 + 99 = 515,00; faltan 3 (256,30).
    await expect(cabecera).toHaveText('Noviembre: 4 facturas, 258,70 €. GoCardless cobró 515,00 €. Faltan 3 (256,30 €): mira abajo.')
    // 1. Ni «Emitir» ni números: los pone Cegid.
    await expect(page.getByRole('button', { name: /Emitir/ })).toHaveCount(0)
    const filas = page.getByRole('table', { name: 'Facturas' }).locator('tbody tr')
    await expect(filas).toHaveCount(4)
    await expect(filas.first().locator('td').first()).toHaveText('La numera Cegid')

    // 2. «Leer de Cegid»: solo lee; los códigos de cliente y la tabla de equivalencias.
    const cegid = page.locator('[data-prueba="cegid"]')
    await expect(cegid).toContainText('Aún no se ha leído nada de Cegid.')
    await cegid.getByRole('button', { name: 'Leer de Cegid' }).click()
    await expect(cegid.locator('[data-prueba="lectura"]')).toHaveText('Leído de Cegid: 4 clientes con sus conceptos fijos, 3 conceptos y 4 facturas de 2026. No se ha escrito nada en Cegid.', { timeout: 30_000 })
    expect(pedidas.every((p) => p.accion === 'leer' || p.accion === 'detalle')).toBe(true)
    await expect(cegid.locator('[data-prueba="codigos"]')).toHaveText('De 9 fichas atadas: 3 con su 430 igual al código de Cegid (y el mismo NIF), 0 con el código pero otro NIF en Cegid, 1 por su NIF y 5 sin código de Cegid.')
    const tabla = cegid.getByRole('table', { name: 'Tabla de equivalencias' })
    await expect(tabla.locator('tr[data-familia="GESTORIA MENSUAL"]')).toContainText('0001 HONORARIOS MENSUALES')
    // La 104 se factura con retención (50 € → 53 €) y su cobro es de 60,50 €: no vota.
    await expect(tabla.locator('tr[data-familia="GESTORIA MENSUAL"]')).toContainText('1 de 2 clientes')
    await expect(tabla.locator('tr[data-familia="SERVICIOS GESTORIA"]')).toContainText('0002')
    await expect(tabla.locator('tr[data-familia="SERVICIOS GESTORIA"]')).toContainText('Sí (1 de 1 líneas)')
    await expect(tabla.locator('tr[data-familia="GESTION LABORAL"]')).toContainText('0008 GESTIÓN LABORAL')
    await expect(tabla.locator('tr[data-familia="(sin suscripción)"]')).toContainText('Sin propuesta')

    // 4. Lo pendiente, con su motivo; lo no cobrado, aparte; el PDF de muestra se abre.
    await expect(page.locator('[data-prueba="pendientes"] li')).toHaveCount(3)
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_cliente"]')).toContainText('átalo en «Cobros de GoCardless sin cliente»')
    await expect(page.locator('[data-prueba="sin-factura"] li[data-estado="failed"]')).toContainText('Fallido: GoCardless no lo pudo cobrar (Fondos insuficientes)')
    await page.evaluate(() => {
      const w = window as unknown as { __abiertas: string[] }
      w.__abiertas = []
      window.open = ((u?: string | URL) => { w.__abiertas.push(String(u)); return {} as Window }) as typeof window.open
    })
    await filas.nth(0).getByRole('button', { name: 'PDF' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __abiertas: string[] }).__abiertas)).toEqual([expect.stringMatching(/^blob:/)])

    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/facturas-sociedad-${ancho}.png`, fullPage: true })

    // ── 3. La autónoma: la retención de cada cliente, de su última factura en Cegid ──
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${A}&mes=${MES}`, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Las facturas de noviembre de 2026' })).toBeVisible({ timeout: 30_000 })
    // Lo leído ya está guardado (la simulación lo da): 53 € a Talleres de Prueba (15 %): base 50, retención 7,50; 24,20 a la persona (sin retención): base 20.
    const talleres = filas.filter({ hasText: 'Talleres de Prueba, S.L.' })
    await expect(talleres).toContainText('50,00 €', { timeout: 30_000 })
    await expect(talleres).toContainText('−7,50 € (15 %)')
    await expect(filas.filter({ hasText: 'Persona Inventada Uno' })).toContainText('20,00 €')
    // 60,50 € con el 15 % no da el total al céntimo: a revisar, no a ojo.
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="no_cuadra"]')).toContainText('Comercial Ejemplo, S.L.')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/facturas-autonoma-${ancho}.png`, fullPage: true })
    expect(errores).toEqual([])
  })
}
