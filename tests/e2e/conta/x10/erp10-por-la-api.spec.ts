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
//   X11 · En la tarjeta, «Medir lo que se puede traer» (la medida de verdad, _shared/erp10Medir.ts,
//   contra el ERP10 simulado): la frase con cuántas lecturas y «No se ha escrito nada», y el texto
//   para copiar, sin el NIF.
// Datos inventados y que se ven inventados (T11).

import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { ClienteErp10, finalDelNif, lineas, porTipo, resumenSinDatos, sumarPorCuenta, type AlmacenToken } from '../../../../supabase/functions/_shared/erp10Cliente'
import { erp10Simulado, type EmpresaSimulada } from '../../../conta/erp10/simulado'
import { partidasDeLoQueSale, sacarUno, type Envio, type PuertoEscribir, type Resultado } from '../../../../supabase/functions/_shared/erp10Escribir'
import { pasadaDeLaCola, sacarYApuntar, type PuertoApuntar } from '../../../../supabase/functions/_shared/erp10Sacar'
import { carpetaDe, loQueSaleDesdeLaBase, pedidasDelCuerpo } from '../../../../supabase/functions/_shared/erp10DesdeLaBase'
import { medidaEnTexto, medirParaTraer } from '../../../../supabase/functions/_shared/erp10Medir'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { asegurarFacturaDelDia } from '../r07/facturaDelDia'
import { leerRevo } from '../../../../src/modules/conta/lib/lectorRevo'

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
      if (b.accion === 'medir') {
        await c.probar()
        const m = await medirParaTraer({ get: (r) => c.get(r), ahora: () => Date.now() }, { ejercicio: '2025', codEmpresa: c.codEmpresa })
        return responder(200, { ok: true, medida: m, texto: medidaEnTexto(m) })
      }
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
    body: JSON.stringify([...filas.values()].filter((x) => x.estado === 'en_erp10').map((x) => ({ ...x, clase: x.clase ?? 'recibida', creado_en: x.creado_en ?? new Date().toISOString(), cambiado_en: x.creado_en ?? new Date().toISOString() }))),
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
        usados: async (entryId) => new Set([...filas.values()].filter((x) => x.estado === 'en_erp10' && x.entry_id !== entryId)
          .flatMap((x) => [`${x.erp10_serie}/${x.erp10_documento}`, ...(x.cobro_documento ? [`${x.cobro_serie}/${x.cobro_documento}`] : [])])),
      }
      const resultados: Resultado[] = []
      for (const x of base.salen) resultados.push(...(await sacarUno(x, base.cuentasNuevas, p)))
      const porApuntar = resultados.filter((x) => x.estado === 'en_erp10' && x.sinApuntar)
      if (porApuntar.length) {
        const deLaBase = partidasDeLoQueSale(base.salen)
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

/**
 * Lo que una pasada anterior de hoy de estas pruebas dejó por salir (una que cayó antes de sacar lo suyo): se apunta como
 * salido, para que la de prueba sea la de esta pasada. Solo lo de las e2e del X10 (su concepto «E2E X10…»).
 */
async function limpiarLoDeHoy(s: Sesion, hoy: string) {
  const mes = `${hoy.slice(0, 7)}-01`
  const ps = await api<{ partidas: { entry_id: string; clase: string; concepto: string; sale: boolean }[] }>(s, 'POST', 'rpc/conta_erp10_por_salir', { p_company: EMPRESA_A, p_mes: mes })
  const viejas = ps.partidas.filter((x) => x.sale && x.concepto.startsWith('E2E X10') && ['recibida', 'emitida', 'asiento'].includes(x.clase))
  if (!viejas.length) return
  await api(s, 'POST', 'rpc/conta_erp10_lote_apuntar', {
    p_company: EMPRESA_A, p_mes: mes, p_quien_nombre: QUIEN,
    p_partidas: viejas.map((x) => ({ entry_id: x.entry_id, clase: x.clase, huella: 'e2e-x10-limpieza' })),
    p_ficheros: [{ nombre: 'Limpieza de una pasada anterior (e2e)', filas: viejas.length, huella: 'e2e-x10-limpieza' }],
  })
}

/** La salida, encendida desde hoy, y una recibida validada de hoy (como el X06). */
async function prepararSalida(s: Sesion, hoy: string) {
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
  await limpiarLoDeHoy(s, hoy)
  return (await unaRecibida(s, hoy, `X10-E2E-${Date.now() % 100000}`)).falta
}

/** Una recibida validada de hoy, con su número (el «E2E X10» de su concepto la deja limpiar a una pasada de mañana). */
async function unaRecibida(s: Sesion, hoy: string, numero: string): Promise<{ id: string; falta: Map<string, number> }> {
  const [t21] = await api<{ id: string }[]>(s, 'GET', 'tax_rate?select=id&is_system=is.true&valid_to=is.null&code=eq.iva_general')
  const [soportado] = await api<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&code=like.472*&order=code&limit=1`)
  const iva = soportado?.code
    ?? (await api<{ code: string }>(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: '472', p_nombre: 'IVA soportado inventado X10', p_quien_nombre: QUIEN })).code
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
  return { id: p.id, falta: new Map([['62300000', 4000], [iva, 840], ['41000002', -4840]]) }
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

    // X11 · Medir lo que se puede traer: solo lee, y deja el texto para copiar (sin nombres, NIF ni importes).
    const medir = tarjeta.getByRole('button', { name: 'Medir lo que se puede traer' })
    await expect(medir).toBeEnabled({ timeout: 30_000 })
    await medir.click()
    await expect(tarjeta.getByRole('status').filter({ hasText: 'Medido el ejercicio 2025' })).toHaveText(/^Medido el ejercicio 2025: \d+ lecturas en ERP10, \d+ segundos?\. No se ha escrito nada\.$/, { timeout: 60_000 })
    const medida = tarjeta.getByRole('group', { name: 'Lo que se puede traer de ERP10' })
    const texto = medida.getByRole('textbox', { name: 'Lo medido, para copiar' })
    await expect(texto).toHaveValue(/## ERP10 por la conexión · lo que se puede traer \(ejercicio 2025\)/)
    await expect(texto).toHaveValue(/\| Diario \(asientos de 2025\) \| `\/api\/apuntes` \| 200 \|/)
    expect(await texto.inputValue()).not.toContain(nif)
    await expect(medida.getByRole('button', { name: 'Copiar lo medido' })).toBeVisible()
    // Las palabras de Sumied; lo medido para copiar cita lo que contesta ERP10 tal cual (p. ej. «…un endpoint de Estimaciones…»).
    expect(await tarjeta.evaluate((el) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('textarea').forEach((t) => t.remove()); return c.textContent ?? '' })).not.toMatch(/token|API|endpoint/)
    await medida.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${DIR}/medir-${tam.width}.png` })
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
    await limpiarLoDeHoy(s, hoy)
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

// ── X10e · Los días del TPV por la conexión ─────────────────────────────────────────

const EJEMPLO = resolve('tests/conta/r04/revo_ejemplo')

/** El ejemplo de Revo del 09/11 (el del R04), movido a hoy, con su centena de facturas (60 + el día: no choca con las del X08). */
function revoDeHoy(dia: string) {
  const centena = String(60 + Number(dia.slice(8, 10)))
  return ['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => {
    const t = readFileSync(resolve(EJEMPLO, `${n}_2026-11-09.csv`), 'utf8').replaceAll('2026-11-09', dia).replace(/\b50(\d\d)\b/g, `${centena}$1`)
    return { nombre: `${n}_${dia}.csv`, contenido: new TextEncoder().encode(t) }
  })
}

/**
 * El día del TPV de hoy, validado (como el X08: las formas de pago, «Clientes de contado», la factura del día del R07 y el
 * día guardado; se valida en Cierres del día). Si ya salió (otra pasada de hoy), vuelve a lo que sale. Sus asientos: la
 * factura del día y, desde el R07, su cobro.
 */
async function diaDeHoy(page: Page, s: Sesion, hoy: string): Promise<string[]> {
  const ctas = await api<{ id: string; code: string; name: string }[]>(s, 'GET', `company_account?select=id,code,name&company_id=eq.${EMPRESA_A}&status=neq.cerrada&order=code`)
  const de = (pref: string) => ctas.find((c) => c.code.startsWith(pref))
  const caja = de('570') ?? de('572'), banco = de('572') ?? de('570'), plataforma = ctas.find((c) => c.code.startsWith('430') && !/contado/i.test(c.name))
  if (!caja || !banco || !plataforma) throw new Error(`El plan de la empresa no tiene caja, banco o una 430 (${ctas.length} cuentas).`)
  const formas = await api<{ id: string }[]>(s, 'GET', `conta_tpv_forma_cuenta?select=id&company_id=eq.${EMPRESA_A}`)
  if (!formas.length) {
    const fs = [['Efectivo', null, caja.id], ['Tarjeta', null, banco.id], ['Deliverect', 'Glovo', plataforma.id], ['Deliverect', 'UberEats', plataforma.id]] as const
    await api(s, 'POST', 'conta_tpv_forma_cuenta', fs.map(([forma, canal, cta]) => ({ account_id: CUENTA_A.id, company_id: EMPRESA_A, forma, canal, company_account_id: cta, created_by_name: QUIEN })))
  }
  if (!ctas.some((c) => c.code.startsWith('430') && /contado/i.test(c.name))) await api(s, 'POST', 'rpc/company_account_add', { p_company: EMPRESA_A, p_hoja: '4300', p_nombre: 'Clientes de contado', p_quien_nombre: QUIEN })
  await asegurarFacturaDelDia(s, EMPRESA_A)
  const estado = async () => (await api<{ dia: string; estado: string }[]>(s, 'POST', 'rpc/conta_tpv_dias', { p_company: EMPRESA_A, p_desde: hoy, p_hasta: hoy }))[0]?.estado ?? null
  if (!(await estado())) {
    const l = leerRevo(revoDeHoy(hoy))
    if (!l.ok) throw new Error(l.problemas.join(' | '))
    await api(s, 'POST', 'rpc/conta_tpv_dia_guardar', { p_company: EMPRESA_A, p_dia: hoy, p_programa: 'revo', p_lectura: l.lectura.dias[0].lectura, p_quien_nombre: QUIEN })
  }
  if ((await estado()) !== 'validado') {
    await page.goto('/conta/ventas/cierres?ver=todos', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { level: 1, name: 'Cierres del día' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.s-lista-cargando')).toHaveCount(0, { timeout: 30_000 })
    const boton = page.getByRole('button', { name: /^Validar los \d+ listos/ }).first()
    await expect(boton).toBeEnabled({ timeout: 30_000 })
    await boton.click()
    await page.getByRole('dialog').getByRole('button', { name: /^Validar \d+ cierres?$/ }).click()
    await expect.poll(estado, { timeout: 300_000, intervals: [5_000] }).toBe('validado')
  }
  const asientos = await api<{ id: string }[]>(s, 'GET', `journal_entry?select=id&company_id=eq.${EMPRESA_A}&entry_date=eq.${hoy}&status=eq.validado&source_type=in.(sales_day,sales_day_payment)`)
  // Otra pasada de hoy ya lo sacó: vuelve a lo que sale (como «Volver a sacar solo esa»).
  for (const a of asientos) await rest(s, 'POST', 'rpc/conta_erp10_volver_a_sacar', { p_company: EMPRESA_A, p_entry: a.id, p_quien_nombre: QUIEN })
  return asientos.map((a) => a.id)
}

test('X10e · 1366 × 768 y 1456 × 816: el día del TPV sale por la conexión (su factura del día y su cobro), el primero solo, y el paso 3 lo casa día a día', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X10e).')
  test.setTimeout(480_000)
  await page.setViewportSize(TAMANOS[0])
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hoy = hoyEnMadrid()
  const fin = finDeMes(hoy)
  const mesTexto = `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(hoy.slice(5, 7)) - 1]} de ${hoy.slice(0, 4)}`
  const nif = await nifDeLaSociedad(s)
  await conCodigo(s, await conectar(s))
  const asientos = await diaDeHoy(page, s, hoy)
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
  await limpiarLoDeHoy(s, hoy)

  // Lo que el día y su cobro dejan en Sumied: lo que a ERP10 le falta (y la 477 del día, la que ERP10 tiene para el IVA repercutido).
  const leer = (fn: string) => api<{ dias?: { entryId: string; lineas: { cuenta: string; debe: number; haber: number; tipoIva: number | null }[] }[]; asientos?: { entryId: string; lineas: { cuenta: string; debe: number; haber: number }[] }[] }>(s, 'POST', `rpc/${fn}`, { p_company: EMPRESA_A, p_mes: `${hoy.slice(0, 7)}-01` })
  const [ds, as] = [await leer('conta_erp10_dias_tpv_por_salir'), await leer('conta_erp10_asientos_por_salir')]
  const lineasDia = [...(ds.dias ?? []), ...(as.asientos ?? [])].filter((x) => asientos.includes(x.entryId)).flatMap((x) => x.lineas)
  expect(lineasDia.length, 'el día del TPV de hoy está para salir').toBeGreaterThan(0)
  const falta = new Map<string, number>()
  for (const l of lineasDia) falta.set(l.cuenta, (falta.get(l.cuenta) ?? 0) + Math.round(Number(l.debe) * 100) - Math.round(Number(l.haber) * 100))
  const empresa101 = await erp10ConLoDeSumied(s, fin, falta, nif)
  const c = await api<{ saldos: { codigo: string; erp: string | null }[] }>(s, 'POST', 'rpc/conta_erp10_comprobar', { p_company: EMPRESA_A, p_fecha: fin })
  const iva = (ds.dias ?? []).flatMap((d) => d.lineas).find((l) => l.tipoIva != null)?.cuenta
  empresa101.ivaRepercutido = c.saldos.find((x) => x.codigo === iva)?.erp ?? iva
  const empresas = { 101: empresa101 }
  const pedidas: string[] = []
  await erp10DeMentira(page, s, empresas, nif)
  await erp10Escribe(page, s, empresas, nif, pedidas)
  await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))

  // 1 · La primera vez, un solo día, para probar: cuál, con su rango, y que no se puede borrar. A los dos tamaños.
  const prueba = new RegExp(`^Va a entrar en ERP10 un solo día del TPV de ${mesTexto}, para probar: el día ${dm(hoy).replace('/', '\\/')}, las facturas \\d+-\\d+ \\([\\d.]+,\\d\\d €\\), con su factura del día y su cobro\\. Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo\\.`)
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Salida a ERP10', level: 1 })).toBeVisible({ timeout: 40_000 })
  const aviso = page.getByRole('alertdialog', { name: 'Sacar a ERP10' })
  for (const tam of [TAMANOS[1], TAMANOS[0]]) {
    await page.setViewportSize(tam)
    const sacar = page.getByRole('button', { name: 'Sacar una para probar' })
    await expect(sacar).toBeEnabled({ timeout: 30_000 })
    await sacar.click()
    await expect(aviso).toContainText(prueba)
    await expect(aviso).not.toContainText(/todavía no salen? por la conexión|siguen? con el Excel/)
    await page.screenshot({ path: `${DIR}/paso1-dia-${tam.width}.png` })
    if (tam === TAMANOS[1]) await aviso.getByRole('button', { name: 'No, todavía no' }).click()
  }
  await aviso.getByRole('button', { name: 'Sacar solo este para probar' }).click()
  await expect(page.getByRole('heading', { name: 'Compara con ERP10' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.cxe-hecho')).toHaveText(new RegExp(`^Han entrado en ERP10 1 día del TPV de ${mesTexto} \\(1/\\d+, 1/\\d+\\)\\.$`))
  expect(pedidas).toHaveLength(1)
  expect(empresa101.facturas ?? []).toHaveLength(1)
  expect(empresa101.facturas![0]).toMatchObject({ Serie: '1', NombreCliente: expect.stringMatching(/contado/i), NumeroFacturasIncluidas340: expect.any(Number), PrimerNumeroFactura340: expect.stringMatching(/^\d+$/) })
  expect(empresa101.apuntes.filter((a) => a.TipoAsiento === 0)).toHaveLength(1)

  // 2 · El paso 3: el día casado con los números que le dio ERP10 (su factura y su cobro), y sus cuentas igual. A los dos tamaños.
  await page.getByRole('button', { name: 'Comparar con ERP10' }).click()
  await expect(page.locator('.cxe-marco[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('note', { name: 'Una a una, con su número de ERP10' }))
    .toHaveText(/^Día a día: (el que salió|los 2 que salieron) por la conexión (está|están) en ERP10 con su número, igual\.$/, { timeout: 30_000 })
  const tabla = page.getByRole('table', { name: 'Cuenta a cuenta' })
  for (const k of falta.keys()) await expect(tabla.getByRole('row').filter({ hasText: k }).locator('.cxe-dif')).toHaveText('', { timeout: 30_000 })
  for (const tam of TAMANOS) {
    await page.setViewportSize(tam)
    await page.evaluate(() => window.scrollTo(0, 0))
    const abajo = await page.evaluate(() => [document.querySelector('.cxe')?.getBoundingClientRect().bottom ?? 9999, window.innerHeight])
    expect(abajo[0], `a ${tam.width} × ${tam.height}, la pantalla acaba dentro de la ventana`).toBeLessThanOrEqual(abajo[1])
    await page.screenshot({ path: `${DIR}/paso3-dia-${tam.width}.png` })
  }
  expect(errores).toEqual([])
})

// ── X10f · Lo validado sale solo a ERP10 ─────────────────────────────────────────────

type FilaEnvio = Envio & { clase?: string; creado_en: string; cambiado_en: string }

/** Lo que sale ese mes, leído de staging con la sesión de quien está (las mismas funciones que el servidor). */
async function baseDe(s: Sesion, mes: string) {
  const leer = (fn: string) => api<Record<string, unknown>>(s, 'POST', `rpc/${fn}`, { p_company: EMPRESA_A, p_mes: mes })
  const [sal] = await api<{ carpeta_pdf: string | null; codigo_erp10: string | null }[]>(s, 'GET', `conta_erp10_salida_empresa?select=carpeta_pdf,codigo_erp10&company_id=eq.${EMPRESA_A}`)
  return {
    porSalir: await leer('conta_erp10_por_salir'), recibidas: await leer('conta_erp10_recibidas_por_salir'), emitidas: await leer('conta_erp10_emitidas_por_salir'),
    asientos: await leer('conta_erp10_asientos_por_salir'), dias: await leer('conta_erp10_dias_tpv_por_salir'), carpeta: carpetaDe(sal?.carpeta_pdf, sal?.codigo_erp10),
  }
}

/**
 * X10f · El servidor, sustituido como en el X10b: los envíos en memoria (con las reglas de conta_erp10_envio_tomar),
 * el cliente de verdad contra el ERP10 simulado y el lote apuntado DE VERDAD en staging. La cola (conta-erp10-cola,
 * que en producción despierta el cron cada minuto) es `pasada`: la MISMA pieza (pasadaDeLaCola) con «sola»; el botón
 * y «Volver a intentarlo» (conta-erp10-escribir), sacarYApuntar con «a mano». La pantalla lee los envíos de aquí.
 */
async function erp10Sola(page: Page, s: Sesion, empresas: Record<string, EmpresaSimulada>, nif: string) {
  const filas = new Map<string, FilaEnvio>()
  const ahora = () => new Date().toISOString()
  // La prueba de la empresa: su primera salida, de hace tiempo (en el paso 3 se da por igualada después).
  filas.set('prueba', { id: 'e-prueba', entry_id: '00000000-0000-4000-8000-00000000f10f', estado: 'en_erp10', erp10_ejercicio: '2026', erp10_serie: '2', erp10_documento: 1, enlazada: false,
    pdf: null, motivo: null, intentos: 1, lote_id: 'lote-prueba', clase: 'recibida', como: 'a_mano', creado_en: '2026-01-02T09:00:00Z', cambiado_en: '2026-01-02T09:00:00Z' })
  const sim = erp10Simulado({ empresas })
  const cliente = new ClienteErp10({
    base: 'https://erp10.invalid', nombreBd: 'DESPACHO_INVENTADO', claves: { client_id: 'cliente-inventado', client_secret: 'x', username: 'x', password: 'codigo-inventado' },
    lista: [{ companyId: EMPRESA_A, codEmpresa: '101', nif }], codEmpresa: '101', almacen: sinToken, fetch: sim.fetch, escribir: true,
  })
  const puerto = (mes: string, como: 'sola' | 'a_mano'): PuertoEscribir & PuertoApuntar => ({
    hoy: hoyEnMadrid(),
    tomar: async (id, clase) => {
      const f = filas.get(id)
      if (f && f.estado !== 'no_pudo') return { tomado: false, envio: f }
      const n: FilaEnvio = { id: `e-${id}`, entry_id: id, estado: 'enviando', erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null,
        intentos: (f?.intentos ?? 0) + 1, lote_id: null, clase, como: f?.como ?? null, creado_en: f?.creado_en ?? ahora(), cambiado_en: ahora() }
      filas.set(id, n)
      return { tomado: true, envio: n }
    },
    poner: async (id, cambios) => { Object.assign([...filas.values()].find((x) => x.id === id)!, { como }, cambios, { cambiado_en: ahora() }) },
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
    erp10: cliente,
    usados: async (entryId) => new Set([...filas.values()].filter((x) => x.estado === 'en_erp10' && x.entry_id !== entryId).map((x) => `${x.erp10_serie}/${x.erp10_documento}`)),
    apuntar: async (partidas, huella) => {
      const r = await rest<{ lote: string }>(s, 'POST', 'rpc/conta_erp10_lote_apuntar', {
        p_company: EMPRESA_A, p_mes: mes, p_quien_nombre: QUIEN, p_partidas: partidas, p_ficheros: [{ nombre: `ERP10 (${como === 'sola' ? 'salida sola' : 'por la conexión'})`, filas: partidas.length, huella }],
      })
      return r.status >= 300 ? { error: JSON.stringify(r.datos).slice(0, 300) } : { lote: String(r.datos.lote) }
    },
    apuntado: async (lote, r) => { const f = filas.get(r.entryId); if (f) f.lote_id = lote },
  })
  // conta_erp10_envio la escribe solo el servidor (aquí, el sustituto): la pantalla la lee de aquí, con sus filtros.
  await page.route((u) => u.pathname.endsWith('/rest/v1/conta_erp10_envio'), (route: Route) => {
    const u = new URL(route.request().url())
    const eq = (k: string) => { const v = u.searchParams.get(k); return v?.startsWith('eq.') ? v.slice(3) : null }
    const hoy = hoyEnMadrid()
    let xs = [...filas.values()].filter((x) => (!eq('entry_id') || x.entry_id === eq('entry_id')) && (!eq('estado') || x.estado === eq('estado')))
    if (u.searchParams.get('or')) xs = xs.filter((x) => x.estado === 'no_pudo' || x.cambiado_en.slice(0, 10) >= hoy)
    if (u.searchParams.get('order')?.startsWith('creado_en.asc')) xs.sort((a, b) => a.creado_en.localeCompare(b.creado_en))
    if (u.searchParams.get('limit')) xs = xs.slice(0, Number(u.searchParams.get('limit')))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(xs.map((x) => ({ ...x, company_id: EMPRESA_A, account_id: CUENTA_A.id }))) })
  })
  await page.route('**/functions/v1/conta-erp10-escribir', async (route: Route) => {
    const b = route.request().postDataJSON() as { company_id: string; mes: string; quien: string | null }
    const responder = (status: number, cuerpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) })
    try {
      const base = await loQueSaleDesdeLaBase(await baseDe(s, b.mes), pedidasDelCuerpo(b))
      const r = await sacarYApuntar(base, puerto(b.mes, 'a_mano'))
      return responder(200, { ok: true, resultados: r.resultados, quedan: r.quedan, sinApuntar: r.sinApuntar })
    } catch (e) {
      return responder(409, { error: e instanceof Error ? e.message : String(e) })
    }
  })
  return {
    filas,
    /** Una pasada de la cola, con lo que le toca (lo que conta_erp10_cola daría en staging, si se despertara). */
    pasada: (pendientes: { id: string; fecha: string }[]) => pasadaDeLaCola({
      pendientes: async () => pendientes.map((x) => ({ entry_id: x.id, account_id: CUENTA_A.id, company_id: EMPRESA_A, entry_date: x.fecha })),
      empresa: async () => ({ base: (mes) => baseDe(s, mes), puerto: (mes) => puerto(mes, 'sola') }),
    }),
  }
}

test('X10f · 1456 × 816 y 1366 × 768: lo validado sale solo a ERP10, la ficha lo dice (gris, verde, ámbar) y «Volver a intentarlo» lo saca', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X10f).')
  test.setTimeout(300_000)
  await page.setViewportSize(TAMANOS[0])
  const s = await entrarComo(page, CUENTA_A.email)
  const errores = vigilar(page)
  const hoy = hoyEnMadrid()
  const fin = finDeMes(hoy)
  const nif = await nifDeLaSociedad(s)
  await conCodigo(s, await conectar(s))
  await api(s, 'POST', 'rpc/conta_erp10_salida_poner', { p_company: EMPRESA_A, p_encender: true, p_codigo: '0007', p_largo: 8, p_desde: hoy, p_quien_nombre: QUIEN })
  await limpiarLoDeHoy(s, hoy)
  // La prueba hecha: la primera salida de la empresa (en los envíos), igualada después en el paso 3 (de verdad, en staging).
  await api(s, 'POST', 'rpc/conta_erp10_igualado_poner', { p_company: EMPRESA_A, p_mes: `${hoy.slice(0, 7)}-01`, p_fichero: 'ERP10, leído (e2e X10f)', p_fecha: hoy, p_cuentas: 1, p_con_diferencia: 0, p_quien_nombre: QUIEN })
  const n = Date.now() % 100000
  const buena = await unaRecibida(s, hoy, `X10F-E2E-${n}`)
  const mala = await unaRecibida(s, hoy, `X10F-FALLA-${n}`)
  const falta = new Map(buena.falta)
  for (const [k, v] of mala.falta) falta.set(k, (falta.get(k) ?? 0) + v)
  const empresa101 = await erp10ConLoDeSumied(s, fin, falta, nif)
  empresa101.fallaFactura = 'X10F-FALLA'
  const sola = await erp10Sola(page, s, { 101: empresa101 }, nif)
  await page.route('**/functions/v1/connector-credentials', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hasCredentials: true }) }))
  const linea = page.getByRole('status', { name: 'ERP10' })

  // 1 · Validada: en la ficha, gris, «Saliendo a ERP10…». A los dos tamaños.
  await page.goto(`/conta/libros/diario/${buena.id}`, { waitUntil: 'load' })
  await expect(linea).toHaveText('Saliendo a ERP10…', { timeout: 40_000 })
  for (const tam of [TAMANOS[1], TAMANOS[0]]) { await page.setViewportSize(tam); await expect(linea).toBeInViewport(); await page.screenshot({ path: `${DIR}/x10f-gris-${tam.width}.png` }) }

  // 2 · La cola (en producción, el servidor cada minuto): sin tocar la pantalla, la ficha pasa a verde con el número.
  const r = await sola.pasada([{ id: buena.id, fecha: hoy }, { id: mala.id, fecha: hoy }])
  expect(r).toMatchObject({ cogidos: 2, en_erp10: 1, no_pudo: 1 })
  await expect(linea).toHaveText(/^En ERP10 · asiento \d+$/, { timeout: 30_000 })
  expect(sola.filas.get(buena.id)).toMatchObject({ estado: 'en_erp10', como: 'sola' })
  for (const tam of [TAMANOS[1], TAMANOS[0]]) { await page.setViewportSize(tam); await expect(linea).toBeInViewport(); await page.screenshot({ path: `${DIR}/x10f-verde-${tam.width}.png` }) }

  // 3 · La que falla: ámbar, con su motivo y «Volver a intentarlo»; arreglada en ERP10, la saca (a mano).
  await page.goto(`/conta/libros/diario/${mala.id}`, { waitUntil: 'load' })
  await expect(linea).toContainText('No ha salido a ERP10: ', { timeout: 40_000 })
  await expect(linea).toContainText('Error al guardar la factura (inventado)')
  await expect(linea).toContainText('Se vuelve a intentar sola en unos minutos.')
  for (const tam of [TAMANOS[1], TAMANOS[0]]) { await page.setViewportSize(tam); await expect(linea.getByRole('button', { name: 'Volver a intentarlo' })).toBeInViewport(); await page.screenshot({ path: `${DIR}/x10f-ambar-${tam.width}.png` }) }
  delete empresa101.fallaFactura
  await linea.getByRole('button', { name: 'Volver a intentarlo' }).click()
  await expect(linea).toHaveText(/^En ERP10 · asiento \d+$/, { timeout: 30_000 })
  expect(sola.filas.get(mala.id)).toMatchObject({ estado: 'en_erp10', como: 'a_mano', intentos: 2 })
  expect(empresa101.facturas?.filter((f) => String(f.NumeroFactura).endsWith(String(n)))).toHaveLength(2)

  // 4 · En «Salida a ERP10», lo de hoy con «Cómo salió»: la buena, sola; la mala, a mano.
  await page.goto('/conta/libros/cierre/salida-erp10', { waitUntil: 'load' })
  const tabla = page.getByRole('table', { name: 'Hoy en ERP10' })
  await expect(tabla).toBeVisible({ timeout: 40_000 })
  await expect(tabla.getByRole('row').filter({ hasText: 'Sola' })).toHaveCount(1)
  await expect(tabla.getByRole('row').filter({ hasText: 'A mano' })).toHaveCount(1)
  for (const tam of [TAMANOS[1], TAMANOS[0]]) { await page.setViewportSize(tam); await expect(tabla).toBeInViewport(); await page.screenshot({ path: `${DIR}/x10f-hoy-${tam.width}.png` }) }
  expect(errores).toEqual([])
})
