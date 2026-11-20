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
import { sacarAsiento, sacarEmitida, sacarRecibida, type Envio, type PuertoEscribir, type Resultado } from '../../../../supabase/functions/_shared/erp10Escribir'
import { carpetaDe, loQueSaleDesdeLaBase, pedidasDelCuerpo } from '../../../../supabase/functions/_shared/erp10DesdeLaBase'

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
    const b = route.request().postDataJSON() as { company_id: string; accion: string; desde?: string; hasta?: string; documentos?: { serie: string; documento: number }[] }
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
      const pedidos = new Set((b.documentos ?? []).map((d) => `${d.serie}/${d.documento}`))
      const documentos = ap.filter((a) => pedidos.has(`${a.Serie}/${a.Documento}`)).map((a) => ({
        serie: String(a.Serie), documento: Number(a.Documento),
        lineas: (a.Detalles ?? []).map((l) => ({ cuenta: String(l.Cuenta), importe: Math.round(Number(l.Debe ?? 0) * 100) - Math.round(Number(l.Haber ?? 0) * 100) })),
      }))
      return responder(200, { filas: sumarPorCuenta(ap), lineas: lineas(ap), asientos: ap.length, desde: b.desde, hasta: b.hasta, leidoEn: new Date().toISOString(), documentos })
    } catch (e) {
      return responder(409, { error: e instanceof Error ? e.message : String(e) })
    }
  })
}

/**
 * X10b · La función conta-erp10-escribir, sustituida: el mismo envío (sacarRecibida, con el cliente
 * de verdad escribiendo en el ERP10 simulado) y la fila de cada asiento en memoria, con las reglas de
 * conta_erp10_envio_tomar. Lo que entra se apunta en la salida DE VERDAD (conta_erp10_lote_apuntar,
 * con la sesión de quien pulsa), como hace la función.
 */
async function erp10Escribe(page: Page, s: Sesion, empresas: Record<string, EmpresaSimulada>, nif: string, pedidas: string[] = []) {
  const filas = new Map<string, Envio & { clase?: string; creado_en?: string }>()
  // conta_erp10_envio la escribe solo el servidor (aquí, el sustituto): la pantalla la lee de lo que este ha apuntado.
  await page.route((u) => u.pathname.endsWith('/rest/v1/conta_erp10_envio'), (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([...filas.values()].filter((x) => x.estado === 'en_erp10').map((x) => ({ ...x, clase: x.clase ?? 'recibida', creado_en: x.creado_en ?? new Date().toISOString() }))),
  }))
  await page.route('**/functions/v1/conta-erp10-escribir', async (route: Route) => {
    const b = route.request().postDataJSON() as { company_id: string; mes: string; quien: string | null }
    // X10c · Como el servidor: del cuerpo, solo los asientos; lo demás, DESDE LA BASE (las funciones de staging, como el usuario).
    pedidas.push(...pedidasDelCuerpo(b))
    const responder = (status: number, cuerpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) })
    try {
      const leer = (fn: string) => api<Record<string, unknown>>(s, 'POST', `rpc/${fn}`, { p_company: b.company_id, p_mes: b.mes })
      const [sal] = await api<{ carpeta_pdf: string | null; codigo_erp10: string | null }[]>(s, 'GET', `conta_erp10_salida_empresa?select=carpeta_pdf,codigo_erp10&company_id=eq.${b.company_id}`)
      const base = await loQueSaleDesdeLaBase({
        porSalir: await leer('conta_erp10_por_salir'), recibidas: await leer('conta_erp10_recibidas_por_salir'), emitidas: await leer('conta_erp10_emitidas_por_salir'),
        asientos: await leer('conta_erp10_asientos_por_salir'), dias: await leer('conta_erp10_dias_tpv_por_salir'), carpeta: carpetaDe(sal?.carpeta_pdf, sal?.codigo_erp10),
      }, pedidasDelCuerpo(b))
      const sim = erp10Simulado({ empresas })
      const c = new ClienteErp10({
        base: 'https://erp10.invalid', nombreBd: 'DESPACHO_INVENTADO', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
        lista: [{ companyId: EMPRESA_A, codEmpresa: '101', nif }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch, escribir: true,
      })
      const p: PuertoEscribir = {
        hoy: hoyEnMadrid(),
        tomar: async (id, clase) => {
          const f = filas.get(id)
          if (f && f.estado !== 'no_pudo') return { tomado: false, envio: f }
          const n = { id: `e-${id}`, entry_id: id, estado: 'enviando' as const, erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: (f?.intentos ?? 0) + 1, lote_id: null, clase, creado_en: new Date().toISOString() }
          filas.set(id, n)
          return { tomado: true, envio: n }
        },
        poner: async (id, cambios) => { Object.assign([...filas.values()].find((x) => x.id === id)!, cambios) },
        pdf: async () => new Uint8Array([37, 80, 68, 70]),
        erp10: c,
        usados: async (entryId) => new Set([...filas.values()].filter((x) => x.estado === 'en_erp10' && x.entry_id !== entryId).map((x) => `${x.erp10_serie}/${x.erp10_documento}`)),
      }
      const resultados: Resultado[] = []
      for (const x of base.salen) {
        resultados.push(x.clase === 'recibida' ? await sacarRecibida(x.api, base.cuentasNuevas, x.pdf, p)
          : x.clase === 'emitida' ? await sacarEmitida(x.api, base.cuentasNuevas, x.pdf, p)
          : await sacarAsiento(x.api, base.cuentasNuevas, p))
      }
      const porApuntar = resultados.filter((x) => x.estado === 'en_erp10' && x.sinApuntar)
      if (porApuntar.length) {
        const deLaBase = new Map(base.salen.map((x) => [x.entryId, x]))
        await api(s, 'POST', 'rpc/conta_erp10_lote_apuntar', {
          p_company: b.company_id, p_mes: b.mes, p_quien_nombre: b.quien,
          p_partidas: porApuntar.map((x) => ({ entry_id: x.entryId, clase: deLaBase.get(x.entryId)!.clase, huella: deLaBase.get(x.entryId)!.huella })),
          p_ficheros: [{ nombre: 'ERP10 (por la conexión)', filas: porApuntar.length, huella: 'e2e-x10b' }],
        })
        for (const x of porApuntar) x.sinApuntar = false
      }
      return responder(200, { ok: true, resultados, quedan: [], sinApuntar: null })
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
  return { cif: `ES${nif}`, apuntes: [{ Serie: '1', Documento: 1, TipoAsiento: 1, Fecha: aaaammdd(c.desde), Detalles: det }], subcuentas: [...det.map((d) => d.Cuenta), '47200000'] }
}

/** X10d · Una cuenta de la empresa bajo esa hoja: la primera que haya, o una nueva inventada (como el X07). */
async function cuenta(s: Sesion, hoja: string, nombre: string): Promise<string> {
  const [hay] = await api<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&code=like.${hoja}*&order=code&limit=1`)
  return hay?.code ?? (await api<{ code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: hoja, p_nombre: nombre, p_quien_nombre: QUIEN })).code
}

/** X10d · La sociedad con su código de empresa 101 (la de la conexión de la prueba de arriba). */
async function conCodigo(s: Sesion, connectorId: string) {
  await sinCodigo(s, connectorId)
  await api(s, 'POST', 'account_connector', { account_id: CUENTA_A.id, connector_id: connectorId, scope: 'company', company_id: EMPRESA_A, external_account_id: '101', status: 'connected', config: {}, created_by_name: QUIEN })
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
  test(`X10b · ${tam.width} × ${tam.height}: la conexión con ERP10 en la salida (qué falta, probar), la factura de prueba por la conexión y el paso 3 sin Excel`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X10).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const hoy = hoyEnMadrid()
    const fin = finDeMes(hoy)
    const mesTexto = `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(hoy.slice(5, 7)) - 1]} de ${hoy.slice(0, 4)}`
    const nif = await nifDeLaSociedad(s)
    const connectorId = await conectar(s)
    await sinCodigo(s, connectorId)
    const falta = await prepararSalida(s, hoy)
    const empresa101 = await erp10ConLoDeSumied(s, fin, falta, nif)
    const empresas = { 101: empresa101, 102: { cif: NIF_OTRA, apuntes: [] } }
    await erp10DeMentira(page, s, empresas, nif)
    const pedidas: string[] = []
    await erp10Escribe(page, s, empresas, nif, pedidas)
    // La función que cifra las claves, simulada: aquí no se guarda ninguna.
    await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))

    // 1 · Sin código: la tarjeta, plegada, lo dice; el botón de sacar también, y lleva a ella.
    await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
    const tarjeta = page.getByRole('region', { name: 'Conexión con ERP10' })
    await expect(tarjeta).toContainText('Falta el código de empresa de esta sociedad en ERP10', { timeout: 30_000 })
    await expect(tarjeta.getByRole('button', { name: 'Conectar' })).toHaveAttribute('aria-expanded', 'false')
    const sacar = page.getByRole('button', { name: 'Sacar una para probar' })
    await expect(sacar).toBeDisabled({ timeout: 30_000 })
    await expect(page.locator('.cxe-sacar-falta')).toHaveText('Para sacar a ERP10: Falta el código de empresa de esta sociedad en ERP10. Ir a la conexión con ERP10')
    await expect(page.getByRole('button', { name: 'Descargar los ficheros (Excel)' })).toBeEnabled()
    // La cabecera del paso 1 lleva dos (el Excel y «Sacar»): los otros pasos se quedan en su número, sin montarse.
    await expect(page.locator(".cxe-paso:not([aria-current='step']) .cxe-paso-etq").first()).toBeHidden()
    await page.screenshot({ path: `${DIR}/paso1-falta-${tam.width}.png` })
    await page.locator('.cxe-sacar-falta').getByRole('button', { name: 'Ir a la conexión con ERP10' }).click()

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
    await expect(hay).toContainText(`El último mes con apuntes en ERP10 es ${mesTexto}`)
    await expect(tarjeta).not.toContainText(/token|API|endpoint/)
    await expect(tarjeta).toContainText('Código de empresa 101')
    await tarjeta.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${DIR}/conexion-${tam.width}.png` })
    await tarjeta.getByRole('button', { name: 'Plegar' }).click()

    // 3 · La primera vez, una sola, para probar: lo que va a entrar y que no se puede borrar.
    await expect(sacar).toBeEnabled({ timeout: 30_000 })
    await sacar.click()
    const aviso = page.getByRole('alertdialog', { name: 'Sacar a ERP10' })
    await expect(aviso).toContainText(new RegExp(`^Va a entrar en ERP10 una sola factura recibida de ${mesTexto}, para probar: la X10-E2E-\\d+ de .+ \\(48,40 €\\)\\. Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo\\.`))
    await page.screenshot({ path: `${DIR}/paso1-confirmar-${tam.width}.png` })
    await aviso.getByRole('button', { name: 'Sacar solo esta para probar' }).click()
    // Pasa sola al paso 3, con lo que ha entrado y su número de ERP10.
    await expect(page.getByRole('heading', { name: 'Compara con ERP10' })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.cxe-hecho')).toHaveText(new RegExp(`^Han entrado en ERP10 1 factura recibida de ${mesTexto} \\(2/\\d+\\)\\.$`))
    expect(empresa101.facturas).toHaveLength(1)
    // X10c · El navegador solo ha pedido el asiento (el servidor lo ha armado desde la base): uno.
    expect(pedidas).toHaveLength(1)
    expect(empresa101.subcuentas).toContain('41000002')

    // 4 · El paso 3 compara con ERP10 leído ahora: la factura ya está, el proveedor y el gasto quedan igual.
    await expect(page.getByLabel('A fecha')).toHaveValue(fin)
    await page.getByRole('button', { name: 'Comparar con ERP10' }).click()
    await expect(page.getByText(new RegExp(`^Comparado con ERP10 \\(leído ahora, \\d\\d/\\d\\d \\d\\d:\\d\\d\\), a ${dm(fin).replace('/', '\\/')}$`))).toBeVisible({ timeout: 30_000 })
    const tabla = page.getByRole('table', { name: 'Cuenta a cuenta' })
    await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
    for (const k of ['41000002', '62300000']) await expect(tabla.getByRole('row').filter({ hasText: k }).locator('.cxe-dif')).toHaveText('', { timeout: 30_000 })
    // X10c · Factura a factura: la de prueba, casada con el número que le dio ERP10.
    await expect(page.getByRole('note', { name: 'Una a una, con su número de ERP10' })).toHaveText('Factura a factura: la que salió por la conexión está en ERP10 con su número, igual.')
    await expect(page.getByRole('button', { name: 'Subir un Excel' })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
    expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
    await page.screenshot({ path: `${DIR}/paso3-erp10-${tam.width}.png` })

    // 5 · En Folvy no sale: ni en el Marketplace.
    await page.goto('/integraciones/marketplace', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Marketplace de integraciones', level: 1 })).toBeVisible({ timeout: 40_000 })
    await expect(page.getByText('Diez (contabilidad)', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('ERP10 (despacho)')).toHaveCount(0)
    expect(errores).toEqual([])
  })
}

// ── X10d · Los asientos por la conexión ─────────────────────────────────────────────

for (const tam of TAMANOS) {
  test(`X10d · ${tam.width} × ${tam.height}: un asiento sale por la conexión (el de prueba) y el paso 3 lo casa asiento a asiento`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X10d).')
    test.setTimeout(240_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const hoy = hoyEnMadrid()
    const fin = finDeMes(hoy)
    const mesTexto = `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(hoy.slice(5, 7)) - 1]} de ${hoy.slice(0, 4)}`
    const nif = await nifDeLaSociedad(s)
    await conCodigo(s, await conectar(s))
    // La salida desde hoy y un pago sin I.V.A. (dos apuntes), validado: un asiento del X07.
    await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
    const banco = await cuenta(s, '572', 'Banco inventado X10d')
    const concepto = `E2E X10d · pago ${Date.now() % 100000}`
    const p = await api<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
      p_company: EMPRESA_A, p_entry: { series: 4, fecha: hoy, concepto, source_type: 'manual', confianza: 'seguro', porque: 'Asiento de la prueba e2e del X10d.' },
      p_lines: [{ cuenta: '41000002', debe: 30.25, comun: true }, { cuenta: banco, haber: 30.25, comun: true }], p_quien_nombre: QUIEN,
    })
    await api(s, 'POST', 'rpc/journal_entry_validar', { p_entry: p.id, p_quien_nombre: QUIEN })
    const empresa101 = await erp10ConLoDeSumied(s, fin, new Map([['41000002', 3025], [banco, -3025]]), nif)
    const empresas = { 101: empresa101 }
    const pedidas: string[] = []
    await erp10DeMentira(page, s, empresas, nif)
    await erp10Escribe(page, s, empresas, nif, pedidas)
    await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))

    // 1 · La primera vez, un solo asiento, para probar: cuál, y que no se puede borrar.
    await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
    const sacar = page.getByRole('button', { name: 'Sacar una para probar' })
    await expect(sacar).toBeEnabled({ timeout: 30_000 })
    await sacar.click()
    const aviso = page.getByRole('alertdialog', { name: 'Sacar a ERP10' })
    await expect(aviso).toContainText(new RegExp(`^Va a entrar en ERP10 un solo asiento de ${mesTexto}, para probar: el 4/\\d+ de Sumied, ${concepto} \\(30,25 €\\)\\. Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo\\.`))
    await page.screenshot({ path: `${DIR}/paso1-asiento-${tam.width}.png` })
    await aviso.getByRole('button', { name: 'Sacar solo este para probar' }).click()
    await expect(page.getByRole('heading', { name: 'Compara con ERP10' })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.cxe-hecho')).toHaveText(new RegExp(`^Han entrado en ERP10 1 asiento de ${mesTexto} \\(1/\\d+\\)\\.$`))
    expect(pedidas).toHaveLength(1)
    expect(empresa101.apuntes.filter((a) => a.TipoAsiento === 0)).toHaveLength(1)

    // 2 · El paso 3: el asiento casado con el número que le dio ERP10, y las dos cuentas igual.
    await page.getByRole('button', { name: 'Comparar con ERP10' }).click()
    await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByRole('note', { name: 'Una a una, con su número de ERP10' })).toHaveText('Asiento a asiento: el que salió por la conexión está en ERP10 con su número, igual.', { timeout: 30_000 })
    const tabla = page.getByRole('table', { name: 'Cuenta a cuenta' })
    for (const k of ['41000002', banco]) await expect(tabla.getByRole('row').filter({ hasText: k }).locator('.cxe-dif')).toHaveText('', { timeout: 30_000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
    expect(abajo[0], 'la pantalla acaba dentro de la ventana').toBeLessThanOrEqual(abajo[1])
    await page.screenshot({ path: `${DIR}/paso3-asiento-${tam.width}.png` })
    expect(errores).toEqual([])
  })
}
