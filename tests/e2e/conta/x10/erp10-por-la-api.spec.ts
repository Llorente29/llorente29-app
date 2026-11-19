/// <reference lib="dom" />
// tests/e2e/conta/x10/erp10-por-la-api.spec.ts
//
// X10 · ERP10 por la API, fase 1 (leer y comparar), y X10b: la conexión es de Sumied, en
// la tarjeta «Conexión con ERP10» de Libros › Cierre › Salida a ERP10 (ya no en
// Integraciones de Folvy). En el ordenador a 1456 × 816 y a 1366 × 768, CONTRA STAGING con
// un ERP10 SIMULADO: nunca el de verdad. La función del servidor (conta-erp10-leer) se
// sustituye en el navegador por el mismo cliente de ERP10 (_shared/erp10Cliente.ts: lista
// cerrada, NIF, suma por cuenta, resumen sin datos) hablando con el ERP10 simulado de las
// unitarias (tests/conta/erp10/simulado.ts). En el carril de la e2e, con la cuenta A y su
// empresa de pruebas, con la sesión del administrador:
//   1. Con las claves guardadas (la función que las cifra, simulada) y sin código de
//      empresa: la tarjeta, plegada, dice qué falta, y el paso 3 también, con «Ir a la
//      conexión con ERP10».
//   2. En la tarjeta: con el código 102 (una empresa del despacho con otro NIF), «El NIF de
//      la empresa de ERP10 no es el de esta sociedad»; con el 101, «Conectada con ERP10:
//      empresa con NIF terminado en …, N líneas desde el 01/10/2026», y debajo lo que hay
//      por mes con el nombre del tipo que da ERP10 («Por factura»), en singular si es uno.
//   3. Plegada, el paso 3 «Comparar con ERP10» lee los saldos del ERP10 simulado (los de
//      Sumied menos una recibida que le falta): «Comparado con ERP10 (leído ahora, …), a …»
//      y las tres cuentas de la factura.
//   4. «ERP10 (despacho)» no sale en el Marketplace de Folvy.
// Datos inventados y que se ven inventados (T11).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { ClienteErp10, finalDelNif, lineas, porTipo, resumenSinDatos, sumarPorCuenta, type AlmacenToken } from '../../../../supabase/functions/_shared/erp10Cliente'
import { erp10Simulado, type EmpresaSimulada } from '../../../conta/erp10/simulado'

test.skip(CARRIL === null, 'El X10 escribe en la cuenta A (la conexión con ERP10, la salida, una recibida): necesita su carril.')

const DIR = 'docs/conta/capturas/x10'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const QUIEN = 'Prueba e2e X10'
const NIF_OTRA = 'B99999999'
const TAMANOS = [{ width: 1456, height: 816 }, { width: 1366, height: 768 }] as const

async function api<T = unknown>(s: Sesion, metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<T> {
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
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const aaaammdd = (iso: string) => Number(iso.replace(/-/g, ''))
const sinToken: AlmacenToken = { leer: async () => null, guardar: async () => {}, caida: async () => {} }

/** El NIF de la sociedad en Sumied (en el carril; si no tiene, uno inventado). */
async function nifDeLaSociedad(s: Sesion): Promise<string> {
  const [c] = await api<{ tax_id: string | null }[]>(s, 'GET', `company?select=tax_id&id=eq.${EMPRESA_A}`)
  if (c?.tax_id) return c.tax_id
  await api(s, 'PATCH', `company?id=eq.${EMPRESA_A}`, { tax_id: 'B00000000' })
  return 'B00000000'
}

/**
 * La función conta-erp10-leer, sustituida: el cliente de verdad contra el ERP10 simulado. La
 * lista cerrada sale de lo que la pantalla ha guardado (el código de cada sociedad).
 */
async function erp10DeMentira(page: Page, s: Sesion, empresas: Record<string, EmpresaSimulada>, nif: string) {
  await page.route('**/functions/v1/conta-erp10-leer', async (route: Route) => {
    const b = route.request().postDataJSON() as { company_id: string; accion: string; desde?: string; hasta?: string }
    const filas = await api<{ company_id: string; external_account_id: string | null; connector: { code: string } }[]>(s, 'GET',
      `account_connector?select=company_id,external_account_id,connector!inner(code)&account_id=eq.${CUENTA_A.id}&scope=eq.company&connector.code=eq.erp10`)
    const esta = filas.find((f) => f.company_id === b.company_id)
    const responder = (status: number, cuerpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) })
    if (!esta) return responder(404, { error: 'Esta sociedad no está conectada con ERP10: pon su código de empresa en Integraciones › ERP10 (despacho).' })
    try {
      const sim = erp10Simulado({ empresas })
      const c = new ClienteErp10({
        base: 'https://erp10.invalid', nombreBd: 'DESPACHO_INVENTADO',
        claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
        lista: filas.map((f) => ({ companyId: f.company_id, codEmpresa: String(f.external_account_id ?? ''), nif: f.company_id === EMPRESA_A ? nif : null })),
        codEmpresa: String(esta.external_account_id ?? ''), almacen: sinToken, fetch: sim.fetch,
      })
      if (b.accion === 'probar') {
        const visto = await c.probar()
        const ap = await c.apuntesEntre('2026-10-01', hoyEnMadrid())
        const n = lineas(ap)
        const mes = hoyEnMadrid().slice(0, 7)
        const r = await c.resumenDelMes(mes)
        return responder(200, {
          ok: true, frase: `Conectada con ERP10: empresa con NIF terminado en ${finalDelNif(visto)}, ${new Intl.NumberFormat('es-ES').format(n)} líneas desde el 01/10/2026.`,
          enErp10: [{ mes, asientos: ap.length, lineas: n, facturas: 0, tipos: porTipo(ap), resumen: r.status === 200 ? resumenSinDatos(r.json) : { status: r.status, motivo: null } }],
          pdf: [], deSumied: [{ mes: hoyEnMadrid().slice(0, 7), partidas: 0, clases: {} }],
          ultimoConApuntes: await c.ultimoMesConApuntes(mes),
        })
      }
      const ap = await c.apuntesEntre(b.desde!, b.hasta!)
      return responder(200, { filas: sumarPorCuenta(ap), lineas: lineas(ap), asientos: ap.length, desde: b.desde, hasta: b.hasta, leidoEn: new Date().toISOString() })
    } catch (e) {
      return responder(409, { error: e instanceof Error ? e.message : String(e) })
    }
  })
}

/** La salida, encendida desde hoy, y una recibida validada de hoy (como el X06). */
async function prepararSalida(s: Sesion, hoy: string) {
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
  const [t21] = await api<{ id: string }[]>(s, 'GET', 'tax_rate?select=id&is_system=is.true&valid_to=is.null&code=eq.iva_general')
  const [soportado] = await api<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&code=like.472*&order=code&limit=1`)
  const iva = soportado?.code
    ?? (await api<{ code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: '472', p_nombre: 'IVA soportado inventado X10', p_quien_nombre: QUIEN })).code
  const numero = `X10-E2E-${Date.now() % 100000}`
  const p = await api<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
    p_company: EMPRESA_A,
    p_entry: { series: 2, fecha: hoy, concepto: `E2E X10 · recibida ${numero}`, source_type: 'manual', confianza: 'seguro', porque: 'Recibida de la prueba e2e del X10.', documento: numero, fecha_documento: hoy },
    p_lines: [
      { cuenta: '62300000', debe: 40, comun: true, documento: numero },
      { cuenta: iva, debe: 8.4, comun: true, documento: numero, iva: { tipo_id: t21.id, base: 40, libro: 'received', deducible: 'yes' } },
      { cuenta: '41000002', haber: 48.4, comun: true, documento: numero },
    ],
    p_quien_nombre: QUIEN,
  })
  await api(s, 'POST', 'rpc/journal_entry_validar', { p_entry: p.id, p_quien_nombre: QUIEN })
  return new Map([['62300000', 4000], [iva, 840], ['41000002', -4840]])
}

/** Sin código de empresa para la sociedad de la prueba (la de otra pasada se borra). */
async function sinCodigo(s: Sesion, connectorId: string) {
  await rest(s, 'DELETE', `account_connector?account_id=eq.${CUENTA_A.id}&connector_id=eq.${connectorId}&scope=eq.company&company_id=eq.${EMPRESA_A}`, undefined, 'return=minimal')
}

/** El ERP10 simulado de la sociedad: un apunte por cuenta con el saldo de Sumied menos lo que le falta. */
async function erp10ConLoDeSumied(s: Sesion, fecha: string, falta: Map<string, number>, nif: string): Promise<EmpresaSimulada> {
  const c = await api<{ desde: string; saldos: { codigo: string; saldo: number; erp: string | null }[] }>(s, 'POST', 'rpc/conta_erp10_comprobar', { p_company: EMPRESA_A, p_fecha: fecha })
  const det = c.saldos.map((x) => {
    const cent = Math.round(x.saldo * 100) - (falta.get(x.codigo) ?? 0)
    return { Cuenta: x.erp ?? x.codigo, Debe: cent > 0 ? cent / 100 : 0, Haber: cent < 0 ? -cent / 100 : 0 }
  })
  return { cif: `ES${nif}`, apuntes: [{ Serie: '1', Documento: 1, TipoAsiento: 1, Fecha: aaaammdd(c.desde), Detalles: det }] }
}

async function conectar(s: Sesion) {
  const [con] = await api<{ id: string }[]>(s, 'GET', 'connector?select=id&code=eq.erp10')
  if (!con) throw new Error('Staging no tiene el conector erp10: primero «Aplicar SQL en staging» con la tanda de la rama.')
  const ya = await api<{ id: string }[]>(s, 'GET', `account_connector?select=id&account_id=eq.${CUENTA_A.id}&connector_id=eq.${con.id}&scope=eq.account`)
  if (!ya.length) {
    await api(s, 'POST', 'account_connector', { account_id: CUENTA_A.id, connector_id: con.id, scope: 'account', status: 'connected', config: { nombre_bd: 'DESPACHO_INVENTADO' }, created_by_name: QUIEN })
  }
  return con.id
}

for (const tam of TAMANOS) {
  test(`X10b · ${tam.width} × ${tam.height}: la conexión con ERP10 en la salida (qué falta, probar: NIF distinto y bien) y el paso 3 sin Excel`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X10).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const hoy = hoyEnMadrid()
    const fin = finDeMes(hoy)
    const nif = await nifDeLaSociedad(s)
    const connectorId = await conectar(s)
    await sinCodigo(s, connectorId)
    const falta = await prepararSalida(s, hoy)
    const empresa101 = await erp10ConLoDeSumied(s, fin, falta, nif)
    await erp10DeMentira(page, s, { 101: empresa101, 102: { cif: NIF_OTRA, apuntes: [] } }, nif)
    // La función que cifra las claves, simulada: aquí no se guarda ninguna.
    await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))

    // 1 · Sin código: la tarjeta, plegada, lo dice; el paso 3 también, y lleva a ella.
    await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
    const tarjeta = page.getByRole('region', { name: 'Conexión con ERP10' })
    await expect(tarjeta).toContainText('Falta el código de empresa de esta sociedad en ERP10', { timeout: 30_000 })
    await expect(tarjeta.getByRole('button', { name: 'Conectar' })).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: 'Descargar los ficheros' }).click()
    await expect(page.locator('.cxe-hecho')).toContainText('Queda apuntado.', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Ya lo he importado' }).click()
    await expect(page.getByRole('heading', { name: 'Compara con ERP10' })).toBeVisible()
    await expect(page.locator('.cxe-erp10-falta')).toContainText('Falta el código de empresa de esta sociedad en ERP10. Ponlo en «Conexión con ERP10», arriba, y pulsa «Probar».')
    await expect(page.getByRole('button', { name: 'Comparar con ERP10' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'sube el Excel' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/paso3-falta-${tam.width}.png` })
    await page.getByRole('button', { name: 'Ir a la conexión con ERP10' }).click()

    // 2 · En la tarjeta: las claves guardadas, y probar con un código que no es y con el suyo.
    await expect(tarjeta.getByRole('button', { name: 'Plegar' })).toHaveAttribute('aria-expanded', 'true')
    await expect(tarjeta).toContainText('Claves guardadas · base del despacho DESPACHO_INVENTADO')
    const codigo = tarjeta.getByRole('textbox', { name: 'Código de empresa en ERP10' })
    await codigo.fill('102')
    await tarjeta.getByRole('button', { name: 'Probar' }).click()
    await expect(tarjeta.getByRole('alert')).toHaveText('El NIF de la empresa de ERP10 no es el de esta sociedad.', { timeout: 30_000 })
    await codigo.fill('101')
    await tarjeta.getByRole('button', { name: 'Probar' }).click()
    const lineasTotal = empresa101.apuntes[0].Detalles.length
    const n = new Intl.NumberFormat('es-ES').format(lineasTotal)
    await expect(tarjeta.getByRole('status')).toHaveText(`Conectada con ERP10: empresa con NIF terminado en ${nif.replace(/[^0-9A-Za-z]/g, '').slice(-3).toUpperCase()}, ${n} líneas desde el 01/10/2026.`, { timeout: 30_000 })
    const hay = tarjeta.getByRole('group', { name: 'Lo que hay en ERP10' })
    await expect(hay).toContainText(`${n} líneas en 1 asiento (Por factura: ${n} líneas)`)
    await expect(hay).not.toContainText('asientos')
    await expect(hay).not.toContainText('tipo 1')
    await expect(hay).toContainText(`El último mes con apuntes en ERP10 es ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(aaaammdd(fin).toString().slice(4, 6)) - 1]}`)
    await expect(tarjeta).not.toContainText(/token|API|endpoint/)
    await expect(tarjeta).toContainText('Código de empresa 101')
    await tarjeta.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${DIR}/conexion-${tam.width}.png` })

    // 3 · Plegada, el paso 3 compara con ERP10 leído ahora.
    await tarjeta.getByRole('button', { name: 'Plegar' }).click()
    await expect(page.getByLabel('A fecha')).toHaveValue(fin)
    await page.getByRole('button', { name: 'Comparar con ERP10' }).click()
    await expect(page.getByText(new RegExp(`^Comparado con ERP10 \\(leído ahora, \\d\\d/\\d\\d \\d\\d:\\d\\d\\), a ${dm(fin).replace('/', '\\/')}$`))).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('3 cuentas con diferencia')).toBeVisible({ timeout: 30_000 })
    const tabla = page.getByRole('table', { name: 'Cuenta a cuenta' })
    await expect(tabla.getByRole('row').filter({ hasText: '41000002' })).toContainText('−48,40')
    await expect(page.getByRole('button', { name: 'Subir un Excel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leer otra vez' })).toBeVisible()
    await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
    expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
    await page.screenshot({ path: `${DIR}/paso3-erp10-${tam.width}.png` })

    // 4 · En Folvy no sale: ni en el Marketplace.
    await page.goto('/integraciones/marketplace', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Marketplace de integraciones', level: 1 })).toBeVisible({ timeout: 40_000 })
    await expect(page.getByText('Diez (contabilidad)', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('ERP10 (despacho)')).toHaveCount(0)
    expect(errores).toEqual([])
  })
}
