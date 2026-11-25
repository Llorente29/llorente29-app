/// <reference lib="dom" />
// tests/e2e/conta/q10/facturas-noviembre.spec.ts
//
// Q10 · «Las facturas de noviembre», en borrador, a 1366 y a 1920:
//   1. la línea de arriba frente a GoCardless («Faltan N: mira abajo»);
//   2. «Leer de ERP10»: la serie (la última de ERP10 y por dónde seguiría) y,
//      en la empresa que retiene, la retención de cada cliente de su última
//      factura;
//   3. las facturas con su número seguido, base, IVA, retención y total; lo
//      pendiente con su motivo; lo que GoCardless no cobró, aparte;
//   4. el PDF de un borrador se abre (sin emitir nada);
//   5. «Emitir» se ve y no se puede pulsar todavía.
//
// La sesión, el marco y la cuenta de prueba son staging y el código de verdad.
// Lo que la pantalla LEE se simula (como en ../q08/decisiones-qbo.spec.ts):
// los cobros, suscripciones, mandatos, enlaces y fichas, inventados (T11), y
// ERP10 (conta-erp10-leer). Nada se escribe: la pantalla solo lee.

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
  const TABLAS: Record<string, unknown[]> = { conta_gc_cobro: cobros, conta_gc_suscripcion: suscripciones, conta_gc_mandato: mandatos, conta_gc_enlace: enlaces, party: fichas, customer_fiscal: [] }
  await page.route(/\/rest\/v1\/(conta_gc_cobro|conta_gc_suscripcion|conta_gc_mandato|conta_gc_enlace|party|customer_fiscal)\?/, (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    // La segunda página (range desde 1000) va vacía.
    if (/offset=1000|range=1000/.test(r.request().url()) || (r.request().headers()['range'] ?? '').startsWith('1000')) return json(r, [])
    return json(r, TABLAS[t])
  })
  // ERP10: las facturas emitidas de octubre y noviembre. La 2 (Talleres de Prueba) llevaba el 15 %; la 3 (una persona), sin retención.
  const erp = (n: number, nif: string, fecha: number, ret: number | null) =>
    ({ cuenta: `4300${n}`, nif, numero: `2026/1/${n}`, fecha, fechaFactura: fecha, retencion: ret ? { tipo: ret, importe: 750 } : null })
  const pedidas: Fila[] = []
  await page.route(/\/functions\/v1\/conta-erp10-leer/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    const filas = b.mes === MES ? [erp(572, 'B00000000', 20261103, 15), erp(573, 'A00000000', 20261105, 15)]
      : b.mes === '2026-10' ? [erp(560, '00000000T', 20261006, null), erp(561, 'B00000001', 20261006, 15), erp(562, 'A00000000', 20261006, 15)] : []
    return json(r, { ok: true, pagina: { que: 'facturas', ejercicio: '2026', mes: b.mes, pagina: b.pagina, filas, total: filas.length, ultima: true } })
  })
  return pedidas
}

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  test(`«Las facturas de noviembre» a ${ancho}: frente a GoCardless, ERP10, pendientes y el PDF, sin emitir`, async ({ page }, info) => {
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
    // 4 facturas (121 + 53 + 24,20 + 60,50 = 258,70); cobrado 258,70 + 121 + 36,30 + 99 = 515,00; faltan 3 (256,30).
    await expect(cabecera).toHaveText('Noviembre: 4 facturas, 258,70 €. GoCardless cobró 515,00 €. Faltan 3 (256,30 €): mira abajo.')
    await expect(page.getByRole('button', { name: 'Emitir las de noviembre de 2026' })).toBeDisabled()
    const filas = page.getByRole('table', { name: 'Facturas' }).locator('tbody tr')
    await expect(filas).toHaveCount(4)
    await expect(filas.first()).toContainText('Sin número')
    await expect(filas.first()).toContainText('Construcciones Ficticias, S.A.')

    // ERP10: la serie, y los números seguidos desde la de después de la última.
    await page.getByRole('button', { name: 'Leer de ERP10' }).click()
    await expect(page.locator('[data-prueba="erp10"]')).toHaveAttribute('data-estado', 'leido', { timeout: 30_000 })
    await expect(page.locator('[data-prueba="serie"]')).toContainText('se seguiría la serie de ERP10 desde la 2026/1/574')
    await expect(filas.nth(0).locator('td').first()).toHaveText('2026/1/574')
    await expect(filas.nth(3).locator('td').first()).toHaveText('2026/1/577')
    expect(pedidas.every((p) => p.accion === 'traer' && p.que === 'facturas')).toBe(true)

    // Lo pendiente, cada uno con su motivo; lo no cobrado, aparte.
    const pend = page.locator('[data-prueba="pendientes"] li')
    await expect(pend).toHaveCount(3)
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_cliente"]')).toContainText('átalo en «Cobros de GoCardless sin cliente»')
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_nif"]')).toContainText('no tiene NIF')
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_suscripcion"]')).toContainText('cobro suelto')
    await expect(page.locator('[data-prueba="sin-factura"] li')).toHaveCount(2)
    await expect(page.locator('[data-prueba="sin-factura"] li[data-estado="failed"]')).toContainText('Fallido: GoCardless no lo pudo cobrar (Fondos insuficientes)')

    // El PDF de un borrador se abre en otra pestaña: se apunta lo que abre (la pestaña de un PDF de blob, en el
    // Chromium sin pantalla, no tiene aún su dirección cuando salta «popup»: e2e 45625540114, url «»).
    await page.evaluate(() => {
      const w = window as unknown as { __abiertas: string[] }
      w.__abiertas = []
      window.open = ((u?: string | URL) => { w.__abiertas.push(String(u)); return {} as Window }) as typeof window.open
    })
    await filas.nth(0).getByRole('button', { name: 'PDF' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __abiertas: string[] }).__abiertas)).toEqual([expect.stringMatching(/^blob:/)])
    await expect(page.locator('section').filter({ hasText: 'Facturas (4)' }).getByRole('alert')).toHaveCount(0)

    mkdirSync(DIR, { recursive: true })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/facturas-sociedad-${ancho}.png`, fullPage: true })

    // ── La autónoma: con retención, de la última factura de cada cliente en ERP10 ──
    await page.goto(`/conta/ventas/clientes-y-cuotas/facturas?empresa=${A}&mes=${MES}`, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Las facturas de noviembre de 2026' })).toBeVisible({ timeout: 30_000 })
    await expect(cabecera).toContainText('Noviembre: 0 facturas')
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="sin_retencion"]')).toHaveCount(4)
    await page.getByRole('button', { name: 'Leer de ERP10' }).click()
    await expect(page.locator('[data-prueba="erp10"]')).toHaveAttribute('data-estado', 'leido', { timeout: 30_000 })
    // 53 € a Talleres de Prueba (15 %): base 50, IVA 10,50, retención 7,50. 24,20 a la persona (sin retención): base 20.
    const talleres = filas.filter({ hasText: 'Talleres de Prueba, S.L.' })
    await expect(talleres).toContainText('50,00 €')
    await expect(talleres).toContainText('−7,50 € (15 %)')
    await expect(filas.filter({ hasText: 'Persona Inventada Uno' })).toContainText('20,00 €')
    // 121 € con el 15 % sí da el total (base 114,15); 60,50 € no: a revisar, no a ojo.
    await expect(filas.filter({ hasText: 'Construcciones Ficticias, S.A.' })).toContainText('114,15 €')
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="no_cuadra"]')).toHaveCount(1)
    await expect(page.locator('[data-prueba="pendientes"] li[data-motivo="no_cuadra"]')).toContainText('Comercial Ejemplo, S.L.')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${DIR}/facturas-autonoma-${ancho}.png`, fullPage: true })
    expect(errores).toEqual([])
  })
}
