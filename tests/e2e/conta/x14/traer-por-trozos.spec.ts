/// <reference lib="dom" />
// tests/e2e/conta/x14/traer-por-trozos.spec.ts
//
// X14 · Respuesta 1, punto 1: lo leído de ERP10 entra en prueba POR TROZOS, diciendo arriba lo que lleva («Trayendo 2026:
// asientos 1 de N», después las facturas), a 1366 × 768 y a 1920 × 1080, CONTRA STAGING con el ERP10 SIMULADO del X12 (los
// Excel de ejemplo del N07 como los daría la API; datos inventados, T11), como la e2e del X13.
// La base de la tanda (20261124T1552) en staging solo se prueba en ROLLBACK desde la rama: conta_traer_cargar va a la base de
// verdad (la de siempre, que lo mete entero), y a su respuesta se le quita el «acabado»; conta_traer_seguir se sustituye en el
// navegador y contesta como la base nueva, en dos vueltas que esperan a la captura. Lo de después, de verdad: la carga, en
// prueba. Cada prueba crea su empresa en el carril de la cuenta A y al acabar deshace lo traído y la borra.

import { test, expect, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CARRIL, CUENTA_A, entrarComo, type Sesion } from '../sesion'
import { cifInventado, rest } from '../api'
import { ClienteErp10, type AlmacenToken } from '../../../../supabase/functions/_shared/erp10Cliente'
import { traerUnaPagina, type PedirPagina } from '../../../../supabase/functions/_shared/erp10Traer'
import { erp10Simulado, type EmpresaSimulada } from '../../../conta/erp10/simulado'

test.skip(CARRIL === null, 'Traer de ERP10 escribe en una empresa de la cuenta A (trae en prueba): necesita su carril.')

const DIR = 'docs/conta/capturas/x14'
const RUTA = '/conta/libros/diario/traer-erp10'
const QUIEN = 'Prueba e2e X14'
const TAMANOS = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const
const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }

async function crearEmpresa(s: Sesion, nif: string): Promise<string> {
  const r = await rest<{ id: string }[]>(s, 'POST', 'company', {
    account_id: CUENTA_A.id, legal_name: `Traer por trozos e2e ${Date.now()}`, tax_id: nif, tax_id_type: 'nif_es', entity_kind: 'company',
    setup_step: 'hecho', setup_completed_at: new Date().toISOString(),
  })
  expect(r.status, `se crea la empresa de la prueba: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(201)
  const id = r.datos[0].id
  const p = await rest(s, 'POST', 'company_tax_profile', { account_id: CUENTA_A.id, company_id: id, tax_territory: 'peninsula_baleares', chart_kind: 'pymes', account_digits: 8, tax_forms: ['303'] })
  expect(p.status, `y su perfil fiscal: ${JSON.stringify(p.datos).slice(0, 200)}`).toBe(201)
  const y = await rest(s, 'POST', 'fiscal_year', { account_id: CUENTA_A.id, company_id: id, code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31', created_by: s.user.id })
  expect(y.status, `y el ejercicio 2026: ${JSON.stringify(y.datos).slice(0, 200)}`).toBe(201)
  return id
}

async function conectar(s: Sesion, empresa: string) {
  const c = await rest<{ id: string }[]>(s, 'GET', 'connector?select=id&code=eq.erp10')
  const con = c.datos?.[0]
  if (!con) throw new Error('Staging no tiene el conector erp10.')
  const ya = await rest<{ id: string }[]>(s, 'GET', `account_connector?select=id&account_id=eq.${CUENTA_A.id}&connector_id=eq.${con.id}&scope=eq.account`)
  if (!ya.datos?.length) {
    const a = await rest(s, 'POST', 'account_connector', { account_id: CUENTA_A.id, connector_id: con.id, scope: 'account', status: 'connected', config: { nombre_bd: 'DESPACHO_INVENTADO' }, created_by_name: QUIEN })
    expect(a.status, `las claves de la cuenta: ${JSON.stringify(a.datos).slice(0, 200)}`).toBeLessThan(300)
  }
  const b = await rest(s, 'POST', 'account_connector', { account_id: CUENTA_A.id, connector_id: con.id, scope: 'company', company_id: empresa, external_account_id: '101', status: 'connected', config: {}, created_by_name: QUIEN })
  expect(b.status, `el código de la empresa: ${JSON.stringify(b.datos).slice(0, 200)}`).toBeLessThan(300)
}

async function limpiar(s: Sesion, id: string) {
  const enPrueba = await rest<{ id: string }[]>(s, 'GET', `import_run?select=id&company_id=eq.${id}&kind=eq.carga&status=eq.en_prueba`)
  for (const c of enPrueba.datos ?? []) await rest(s, 'POST', 'rpc/conta_traer_deshacer', { p_carga: c.id, p_quien_nombre: QUIEN })
  await rest(s, 'DELETE', `account_connector?company_id=eq.${id}&account_id=eq.${CUENTA_A.id}`, undefined, 'return=minimal')
  const b = await rest<unknown>(s, 'DELETE', `company?id=eq.${id}&account_id=eq.${CUENTA_A.id}`)
  if (b.status >= 300) console.log(`[X14] la empresa ${id} se queda en el carril (${b.status}): ${JSON.stringify(b.datos).slice(0, 200)}`)
}

/** conta-erp10-leer, sustituida como en el X13: cada «traer» es una página leída por el cliente de verdad del ERP10 simulado. */
async function erp10DeMentira(page: Page, nif: string) {
  const empresa: EmpresaSimulada = { ...JSON.parse(readFileSync('tests/conta/x12/erp10DeLosFicheros.json', 'utf8')), cif: nif }
  await page.route('**/functions/v1/conta-erp10-leer', async (route: Route) => {
    const b = route.request().postDataJSON() as { accion: string } & PedirPagina
    const responder = (status: number, cuerpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) }).catch(() => undefined)
    if (b.accion !== 'traer') return responder(400, { error: 'en esta prueba solo se trae' })
    const p: PedirPagina = { que: b.que, ejercicio: b.ejercicio, mes: b.mes ?? null, pagina: b.pagina ?? 0 }
    try {
      const sim = erp10Simulado({ empresas: { 101: structuredClone(empresa) } })
      const c = new ClienteErp10({
        base: 'https://erp10.invalid', nombreBd: 'DESPACHO_INVENTADO', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
        lista: [{ companyId: 'la-de-la-prueba', codEmpresa: '101', nif }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch,
      })
      return responder(200, { ok: true, pagina: await traerUnaPagina((r) => c.get(r), p) })
    } catch (e) {
      return responder(502, { error: e instanceof Error ? e.message : String(e) })
    }
  })
  await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))
}

/** Una compuerta: la vuelta de «seguir» espera a que la prueba haya hecho su captura. */
function compuerta() { let abrir = () => {}; const p = new Promise<void>((r) => { abrir = r }); return { p, abrir } }

/**
 * La carga, en dos vueltas como la base nueva: conta_traer_cargar, de verdad, sin su «acabado» (1 asiento de N); y
 * conta_traer_seguir, sustituida: todos los asientos y 1 factura; y al final, lo que dijo la base de verdad.
 */
async function porTrozos(page: Page) {
  const vueltas = [compuerta(), compuerta()]
  let real: { carga: string; texto: string; cuentas: Record<string, number> } | null = null
  let n = { asientos: 0, facturas: 0 }
  const seguir: unknown[] = []
  await page.route('**/rest/v1/rpc/conta_traer_cargar', async (route: Route) => {
    const r = await route.fetch()
    if (r.status() >= 300) return route.fulfill({ response: r })
    real = await r.json()
    n = { asientos: real!.cuentas.asientos ?? 0, facturas: (real!.cuentas.facturas_recibidas ?? 0) + (real!.cuentas.facturas_emitidas ?? 0) }
    return route.fulfill({ response: r, json: { carga: real!.carga, acabado: false, asientos: { hechos: 1, de: n.asientos }, facturas: { hechos: 0, de: n.facturas } } })
  })
  await page.route('**/rest/v1/rpc/conta_traer_seguir', async (route: Route) => {
    const i = seguir.length
    seguir.push(route.request().postDataJSON())
    await vueltas[Math.min(i, 1)].p
    const json = i === 0
      ? { carga: real!.carga, acabado: false, asientos: { hechos: n.asientos, de: n.asientos }, facturas: { hechos: 1, de: n.facturas } }
      : { carga: real!.carga, acabado: true, texto: real!.texto, cuentas: real!.cuentas, asientos: { hechos: n.asientos, de: n.asientos }, facturas: { hechos: n.facturas, de: n.facturas } }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
  })
  return { vueltas, seguir, n: () => n, real: () => real }
}

const pantalla = (page: Page) => page.getByRole('region', { name: 'Traer de ERP10' })

for (const tam of TAMANOS) {
  test(`X14 · ${tam.width} × ${tam.height}: lo leído entra en prueba por trozos, diciendo arriba lo que lleva`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X14).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
    const nif = cifInventado()
    const empresa = await crearEmpresa(s, nif)
    try {
      await conectar(s, empresa)
      await page.addInitScript(([clave, valor]) => { window.localStorage.setItem(clave, valor) }, [`folvy.conta.empresa.${CUENTA_A.id}`, empresa] as const)
      await erp10DeMentira(page, nif)
      const t = await porTrozos(page)

      await page.goto(RUTA, { waitUntil: 'load' })
      const p = pantalla(page)
      await expect(p).toContainText('Conectada con ERP10 · empresa 101', { timeout: 40_000 })
      await p.getByRole('button', { name: 'Traerlo todo de ERP10' }).click()

      // 1 · Leído, entra: «Trayendo 2026: asientos 1 de N», arriba y en el panel.
      await expect(p).toContainText(/Trayendo 2026: asientos 1 de \d+/, { timeout: 120_000 })
      const n = t.n()
      expect(n.asientos, 'la carga trae asientos').toBeGreaterThan(1)
      await expect(p).toContainText(`Trayendo 2026: asientos 1 de ${n.asientos.toLocaleString('es-ES')}`)
      await page.screenshot({ path: `${DIR}/x14-asientos-${tam.width}.png` })
      t.vueltas[0].abrir()

      // 2 · Los asientos, todos; ahora, las facturas.
      await expect(p).toContainText(`Trayendo 2026: facturas 1 de ${n.facturas.toLocaleString('es-ES')}`, { timeout: 30_000 })
      await page.screenshot({ path: `${DIR}/x14-facturas-${tam.width}.png` })
      t.vueltas[1].abrir()

      // 3 · Acabada: la carga, en prueba (de verdad), y la pantalla como siempre después de traer.
      await expect(p).not.toContainText('Trayendo 2026', { timeout: 60_000 })
      await expect(p).not.toContainText('No ha entrado en prueba')
      await expect(p.getByRole('button', { name: 'Darlo por bueno' })).toBeVisible({ timeout: 60_000 })
      expect(t.seguir).toEqual([{ p_carga: t.real()!.carga }, { p_carga: t.real()!.carga }])
      const enPrueba = await rest<{ id: string; status: string }[]>(s, 'GET', `import_run?select=id,status&company_id=eq.${empresa}&kind=eq.carga`)
      expect(enPrueba.datos.map((x) => x.status)).toEqual(['en_prueba'])
      await page.screenshot({ path: `${DIR}/x14-en-prueba-${tam.width}.png` })
      expect(errores).toEqual([])
    } finally {
      await limpiar(s, empresa)
    }
  })
}
