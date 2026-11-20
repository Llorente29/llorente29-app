// src/modules/conta/services/erp10ApiService.ts
//
// X10 (19/11) · Entrar en ERP10 desde Sumied, fase 1 (solo leer). X10b: la tarjeta
// «Conexión con ERP10» de la salida guarda las claves y el código de empresa de la
// sociedad abierta, y la prueba; el paso 3 lee los saldos de ERP10 sin subir un Excel. Lo que
// habla con ERP10 es la función conta-erp10-leer (en el servidor, con las claves en
// el Vault): aquí nunca hay claves.

import type { Pagina, PedirPagina } from '../../../../supabase/functions/_shared/erp10Traer'
import { supabase } from '@/lib/supabase'
import { hayBase, rpc, tabla } from '@/modules/conta/services/bd'
import type { FilaSumas } from '@/modules/conta/lib/traer'
import type { DocumentoErp10, EnvioErp10 } from '@/modules/conta/erp10/casar'
import { aSalidoHoy, type DatosLinea, type EnvioDeUnAsiento, type SalidoHoy } from '@/modules/conta/erp10/salidaSola'
import { getConnectorCredentialsStatus, saveConnectorCredentials } from '@/modules/integrations/services/connectorCredentialsService'

type Fila = Record<string, unknown>
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null)

/**
 * X10b (19/11, Julio): la conexión con ERP10 es de Sumied. Vive en Libros › Cierre ›
 * Salida a ERP10, en la tarjeta «Conexión con ERP10»: las claves de la cuenta (una vez,
 * en el Vault, por connector-credentials) y el código de empresa de la sociedad abierta.
 */
export interface ConexionErp10 {
  connectorId: string
  /** La conexión de la cuenta (las claves); null si todavía no hay. */
  cuentaId: string | null
  conClaves: boolean
  nombreBd: string
  config: Record<string, unknown>
  /** La conexión de la sociedad abierta (su código); null si no tiene. */
  sociedadId: string | null
  codigo: string
  estado: string | null
  ultimoFallo: string | null
}

/** Lo que falta para comparar con ERP10, en palabras; null si no falta nada. */
export function loQueFalta(c: ConexionErp10 | null): string | null {
  if (!c) return null
  if (!c.conClaves) return 'Faltan las claves de ERP10.'
  if (!c.codigo.trim()) return 'Falta el código de empresa de esta sociedad en ERP10.'
  return null
}

export async function leerConexionErp10(accountId: string, companyId: string): Promise<ConexionErp10> {
  hayBase()
  const { data: con, error: e0 } = await tabla('connector').select('id').eq('code', 'erp10').maybeSingle()
  if (e0) throw new Error(`No se ha podido leer el conector de ERP10: ${e0.message}`)
  if (!con) throw new Error('Esta base no tiene todavía el conector de ERP10.')
  const connectorId = String((con as Fila).id)
  const { data: ac, error: e1 } = await tabla('account_connector').select('id, scope, company_id, external_account_id, status, last_error, config')
    .eq('account_id', accountId).eq('connector_id', connectorId).in('scope', ['account', 'company'])
  if (e1) throw new Error(`No se ha podido leer la conexión con ERP10: ${e1.message}`)
  const filas = (ac ?? []) as Fila[]
  const cuenta = filas.find((x) => x.scope === 'account') ?? null
  const soc = filas.find((x) => x.scope === 'company' && x.company_id === companyId) ?? null
  let conClaves = false
  if (cuenta) {
    const r = await getConnectorCredentialsStatus(String(cuenta.id))
    conClaves = r.ok && r.hasCredentials
  }
  const config = ((cuenta?.config ?? {}) as Record<string, unknown>)
  return {
    connectorId, cuentaId: cuenta ? String(cuenta.id) : null, conClaves, nombreBd: String(config.nombre_bd ?? ''), config,
    sociedadId: soc ? String(soc.id) : null, codigo: soc ? String(soc.external_account_id ?? '') : '',
    estado: soc ? String(soc.status) : null, ultimoFallo: soc ? str(soc.last_error) : null,
  }
}

/** Las claves de la cuenta: las cuatro a la vez (o ninguna) y la base del despacho. Crea la conexión de la cuenta si no hay. */
export async function guardarClavesErp10(accountId: string, c: ConexionErp10, claves: Record<'client_id' | 'client_secret' | 'username' | 'password', string>, nombreBd: string, quien: string | null): Promise<string> {
  hayBase()
  const escritas = Object.values(claves).filter((v) => v.trim()).length
  if (escritas > 0 && escritas < 4) throw new Error('Escribe las cuatro claves a la vez: se guardan juntas.')
  if (escritas === 0 && !c.conClaves) throw new Error('Faltan las cuatro claves de ERP10.')
  if (!nombreBd.trim()) throw new Error('Falta la base del despacho.')
  const config = { ...c.config, nombre_bd: nombreBd.trim() }
  let id = c.cuentaId
  if (!id) {
    const { data, error } = await tabla('account_connector').insert({
      account_id: accountId, connector_id: c.connectorId, scope: 'account', status: 'connecting', config, created_by_name: quien,
    }).select('id').single()
    if (error) throw new Error(`No se han guardado las claves: ${error.message}`)
    id = String((data as Fila).id)
  }
  if (escritas === 0) {
    const { error } = await tabla('account_connector').update({ config, updated_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId)
    if (error) throw new Error(`No se ha guardado la base del despacho: ${error.message}`)
    return 'Guardada la base del despacho. Las claves siguen las de antes.'
  }
  const secretos = Object.fromEntries(Object.entries(claves).map(([k, v]) => [k, v.trim()]))
  const r = await saveConnectorCredentials({ accountConnectorId: id, secrets: secretos, config })
  if (!r.ok) throw new Error(`No se han guardado las claves: ${r.error}`)
  return 'Claves guardadas, cifradas. Ahora pon el código de empresa y pulsa «Probar».'
}

/** El código de empresa de la sociedad abierta (crea su conexión si no la tiene). */
export async function guardarCodigoErp10(accountId: string, companyId: string, c: ConexionErp10, codigo: string, quien: string | null): Promise<ConexionErp10> {
  hayBase()
  const limpio = codigo.trim()
  // La de la base, no la leída antes: entre dos «Probar» seguidos la pantalla puede no haber vuelto a leer
  // (X10b, e2e 44544902397: el segundo intentaba crearla otra vez y chocaba con account_connector_company_uq).
  const { data: ya, error: e0 } = await tabla('account_connector').select('id').eq('account_id', accountId).eq('connector_id', c.connectorId)
    .eq('scope', 'company').eq('company_id', companyId).maybeSingle()
  if (e0) throw new Error(`No se ha leído la conexión de la sociedad: ${e0.message}`)
  if (ya) c = { ...c, sociedadId: String((ya as Fila).id) }
  if (c.sociedadId) {
    const { error } = await tabla('account_connector').update({ external_account_id: limpio || null, status: 'connected', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', c.sociedadId).eq('account_id', accountId)
    if (error) throw new Error(`No se ha guardado el código: ${error.message}`)
    return { ...c, codigo: limpio, estado: 'connected', ultimoFallo: null }
  }
  const { data, error } = await tabla('account_connector').insert({
    account_id: accountId, connector_id: c.connectorId, scope: 'company', company_id: companyId, external_account_id: limpio || null,
    status: 'connected', config: {}, created_by_name: quien,
  }).select('id').single()
  if (error) throw new Error(`No se ha guardado el código: ${error.message}`)
  return { ...c, sociedadId: String((data as Fila).id), codigo: limpio, estado: 'connected', ultimoFallo: null }
}

async function invocar(body: Fila): Promise<Fila> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-erp10-leer', { body })
  if (!error) return (data ?? {}) as Fila
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  throw new Error(str(cuerpo?.error) ?? (ctx?.status === 404 ? 'Entrar en ERP10 aún no está publicado en este entorno.' : `No se ha podido entrar en ERP10: ${error.message}`))
}

/** Lo que dice «Probar»: la frase y, debajo, lo que hay en ERP10 por mes (solo recuentos). */
export interface Probado {
  frase: string
  enErp10: {
    mes: string; asientos: number; lineas: number; facturas: number | null; tipos: { tipo: number | null; asientos: number; lineas: number }[]
    /** El resumen de ERP10 del mes (DescripcionTipoIntroduccion y Numero, que cuenta líneas), o por qué no se leyó. */
    resumen: Record<string, string | number>[] | { status: number; motivo: string | null }
  }[]
  pdf: { status: number; bytes: number; motivo: string | null }[]
  deSumied: { mes: string; partidas: number; clases: Record<string, number> }[]
  /** X10b · El último mes con apuntes en ERP10 (aunque los de ahora estén vacíos) y sus líneas. */
  ultimoConApuntes: { mes: string; lineas: number } | null
}
export async function probarErp10(companyId: string): Promise<Probado> {
  const d = await invocar({ company_id: companyId, accion: 'probar' })
  return {
    frase: String(d.frase ?? 'Conectada con ERP10.'),
    enErp10: (Array.isArray(d.enErp10) ? d.enErp10 : []) as Probado['enErp10'],
    pdf: (Array.isArray(d.pdf) ? d.pdf : []) as Probado['pdf'],
    deSumied: (Array.isArray(d.deSumied) ? d.deSumied : []) as Probado['deSumied'],
    ultimoConApuntes: d.ultimoConApuntes && typeof d.ultimoConApuntes === 'object' ? d.ultimoConApuntes as Probado['ultimoConApuntes'] : null,
  }
}

/**
 * X11 · Lo que da ERP10 de cada cosa que trae «Traer de ERP10» por fichero, medido leyendo:
 * rutas, totales, páginas, campos y tiempos (supabase/functions/_shared/erp10Medir.ts).
 * Sin nombres, NIF ni importes: el texto se pega tal cual en el PR.
 */
export interface Medido { ejercicio: string; peticiones: number; ms: number; cortada: boolean; texto: string }
export async function medirParaTraerErp10(companyId: string, ejercicio?: string): Promise<Medido> {
  const d = await invocar({ company_id: companyId, accion: 'medir', ...(ejercicio ? { ejercicio } : {}) })
  const m = (d.medida ?? {}) as Fila
  return { ejercicio: String(m.ejercicio ?? ejercicio ?? ''), peticiones: Number(m.peticiones ?? 0), ms: Number(m.ms ?? 0), cortada: m.cortada === true, texto: String(d.texto ?? '') }
}

/**
 * X12 · Una página de lo que trae «Traer de ERP10» por la conexión (conta-erp10-leer, accion traer).
 * Un freno (la lista, el NIF, las claves) o un permiso no se reintenta: lleva `noReintentar`.
 */
export async function traerPaginaErp10(companyId: string, p: PedirPagina): Promise<Pagina> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-erp10-leer', { body: { company_id: companyId, accion: 'traer', ...p } })
  if (!error) {
    const pag = (data as Fila | null)?.pagina as Pagina | undefined
    if (!pag || !Array.isArray(pag.filas)) throw new Error('ERP10 no ha contestado lo que se esperaba.')
    return pag
  }
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  const e = new Error(str(cuerpo?.error) ?? (ctx?.status === 404 ? 'Traer de ERP10 aún no está publicado en este entorno.' : `No se ha podido leer ERP10: ${error.message}`)) as Error & { noReintentar?: boolean }
  if (ctx && [400, 401, 403, 404, 409].includes(ctx.status)) e.noReintentar = true
  throw e
}

/** Los saldos de ERP10 de una sociedad entre dos días, sumados por cuenta (céntimos). */
export async function leerSaldosErp10(companyId: string, desde: string, hasta: string, pedidos: { serie: string; documento: number }[] = []): Promise<{ filas: FilaSumas[]; lineas: number; leidoEn: string; documentos: DocumentoErp10[] }> {
  const d = await invocar({ company_id: companyId, accion: 'saldos', desde, hasta, documentos: pedidos })
  const filas = (Array.isArray(d.filas) ? d.filas : []).map((f: Fila) => ({
    subcuenta: String(f.subcuenta ?? ''), nombre: String(f.nombre ?? ''), debe: Number(f.debe ?? 0), haber: Number(f.haber ?? 0),
    deudor: Number(f.deudor ?? 0), acreedor: Number(f.acreedor ?? 0),
  }))
  const documentos = (Array.isArray(d.documentos) ? d.documentos : []) as DocumentoErp10[]
  return { filas, lineas: Number(d.lineas ?? 0), leidoEn: String(d.leidoEn ?? new Date().toISOString()), documentos }
}

// ── X10b · Escribir en ERP10 (las recibidas) ─────────────────────────────────────────

/** Cómo va cada clase en esta sociedad: si ya salió su de prueba y si se comprobó después (X10c: por clase). */
export interface EstadoClase {
  /** Cuándo entró en ERP10 la primera (la de prueba); null si nunca. */
  primera: string | null
  /** Un «Darlo por igualado» posterior a la primera: ya se pueden sacar las demás. */
  comprobada: boolean
}
/** X10e · y el día del TPV (sus envíos llevan la marca del día: no cuentan como emitidas ni como asientos). */
export type ClaseConexion = 'recibida' | 'emitida' | 'asiento' | 'dia'
export type EstadoEscribir = Record<ClaseConexion, EstadoClase>
export async function leerEstadoEscribir(accountId: string, companyId: string): Promise<EstadoEscribir> {
  hayBase()
  const { data: e, error } = await tabla('conta_erp10_envio').select('clase, dia, creado_en').eq('account_id', accountId).eq('company_id', companyId)
    .eq('estado', 'en_erp10').order('creado_en', { ascending: true })
  if (error) throw new Error(`No se ha podido leer lo que ha salido a ERP10: ${error.message}`)
  const filas = (e ?? []) as Fila[]
  const { data: g, error: e2 } = await tabla('conta_erp10_igualado').select('igualado_en').eq('account_id', accountId).eq('company_id', companyId)
    .order('igualado_en', { ascending: false }).limit(1)
  if (e2) throw new Error(`No se ha podido leer lo igualado: ${e2.message}`)
  const ultimoIgualado = ((g ?? []) as Fila[])[0]?.igualado_en as string | undefined
  const de = (c: ClaseConexion): EstadoClase => {
    const primera = (filas.find((x) => (c === 'dia' ? x.dia === true && x.clase === 'emitida' : x.dia !== true && x.clase === c))?.creado_en as string | undefined) ?? null
    return { primera, comprobada: !!primera && !!ultimoIgualado && ultimoIgualado > primera }
  }
  return { recibida: de('recibida'), emitida: de('emitida'), asiento: de('asiento'), dia: de('dia') }
}

/** Lo que dice el servidor de cada factura. */
export interface Salido {
  entryId: string; numero: string; clase?: ClaseConexion
  estado: 'en_erp10' | 'ya_estaba' | 'en_marcha' | 'no_pudo'
  serie?: string; documento?: number; enlazada?: boolean; pdf?: 'subido' | 'fallo' | null; porque?: string
  /** X10e · El cobro del día (de un solo asiento) y, si es el cobro aparte de un día, de cuál. */
  cobro?: { serie: string; documento: number; enlazado: boolean }; cobroDe?: string
}

/**
 * Saca a ERP10 los asientos pedidos (conta-erp10-escribir). X10c: solo se mandan sus ids; el
 * servidor arma cada factura desde la base. Para a los 40 s y devuelve los que no le han dado
 * tiempo: aquí se le vuelven a pedir hasta que no queda ninguno.
 */
export async function sacarAErp10(companyId: string, mes: string, entradas: string[], quien: string | null,
  avance?: (hechas: number, de: number) => void): Promise<{ salidas: Salido[]; sinApuntar: string | null }> {
  const salidas: Salido[] = []
  let pendientes = entradas
  let sinApuntar: string | null = null
  for (let vuelta = 0; pendientes.length && vuelta < 50; vuelta++) {
    avance?.(salidas.length, entradas.length)
    const d = await invocarEscribir({ company_id: companyId, mes, entradas: pendientes, quien })
    const rs = (Array.isArray(d.resultados) ? d.resultados : []) as Salido[]
    salidas.push(...rs)
    if (typeof d.sinApuntar === 'string') sinApuntar = d.sinApuntar
    const quedan = new Set((Array.isArray(d.quedan) ? d.quedan : []) as string[])
    pendientes = pendientes.filter((x) => quedan.has(x))
  }
  return { salidas, sinApuntar }
}

async function invocarEscribir(body: Fila): Promise<Fila> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-erp10-escribir', { body })
  if (!error) return (data ?? {}) as Fila
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  throw new Error(str(cuerpo?.error) ?? (ctx?.status === 404 ? 'Sacar a ERP10 aún no está publicado en este entorno.' : `No se ha podido entrar en ERP10: ${error.message}`))
}

/** X10c · Lo que salió por la conexión (en ERP10, con su número): para casarlo en el paso 3. */
export async function leerEnviosErp10(accountId: string, companyId: string): Promise<EnvioErp10[]> {
  hayBase()
  const { data, error } = await tabla('conta_erp10_envio').select('entry_id, clase, dia, erp10_serie, erp10_documento, cobro_serie, cobro_documento').eq('account_id', accountId).eq('company_id', companyId)
    .eq('estado', 'en_erp10')
  if (error) throw new Error(`No se ha podido leer lo que salió por la conexión: ${error.message}`)
  // X10e · Un día del TPV (su factura, o su cobro aparte) se casa como día; el de un solo asiento, con los dos números.
  return ((data ?? []) as Fila[]).filter((x) => x.erp10_documento != null)
    .map((x) => ({ entryId: String(x.entry_id), clase: x.dia === true ? 'dia' : String(x.clase), serie: String(x.erp10_serie ?? ''), documento: Number(x.erp10_documento),
      ...(x.cobro_documento != null ? { cobro: { serie: String(x.cobro_serie ?? ''), documento: Number(x.cobro_documento) } } : {}) }))
}

// ── X10f · Lo validado sale solo a ERP10: lo que dicen la ficha, la barra y la lista de hoy ──────────

/** Lo que la ficha necesita para su línea de ERP10 (salidaSola.lineaErp10), menos el estado y la fecha del asiento. */
export async function leerLineaErp10(accountId: string, companyId: string, entryId: string): Promise<Omit<DatosLinea, 'validado' | 'fecha'>> {
  hayBase()
  const [v, z, p, primera] = await Promise.all([
    tabla('conta_erp10_envio').select('estado, erp10_serie, erp10_documento, motivo, intentos, como').eq('account_id', accountId).eq('entry_id', entryId).maybeSingle(),
    tabla('conta_erp10_salida_empresa').select('encendida, desde').eq('account_id', accountId).eq('company_id', companyId).maybeSingle(),
    tabla('conta_erp10_salida_partida').select('erp10_documento').eq('account_id', accountId).eq('entry_id', entryId).eq('estado', 'salida').maybeSingle(),
    tabla('conta_erp10_envio').select('creado_en').eq('account_id', accountId).eq('company_id', companyId).eq('estado', 'en_erp10').order('creado_en', { ascending: true }).limit(1),
  ])
  for (const r of [v, z, p, primera]) if (r.error) throw new Error(`No se ha podido leer cómo va en ERP10: ${r.error.message}`)
  const e = v.data as Fila | null
  const desde = ((primera.data ?? []) as Fila[])[0]?.creado_en as string | undefined
  let pruebaHecha = false
  if (desde) {
    const { data: g, error } = await tabla('conta_erp10_igualado').select('id').eq('account_id', accountId).eq('company_id', companyId).gt('igualado_en', desde).limit(1)
    if (error) throw new Error(`No se ha podido leer lo igualado: ${error.message}`)
    pruebaHecha = ((g ?? []) as Fila[]).length > 0
  }
  const s = z.data as Fila | null
  const par = p.data as Fila | null
  return {
    envio: e ? {
      estado: e.estado as EnvioDeUnAsiento['estado'], serie: str(e.erp10_serie) ?? null, documento: e.erp10_documento == null ? null : Number(e.erp10_documento),
      motivo: str(e.motivo) ?? null, intentos: Number(e.intentos ?? 1), como: (e.como as EnvioDeUnAsiento['como']) ?? null,
    } : null,
    salida: s ? { encendida: s.encendida === true, desde: String(s.desde) } : null,
    conElExcel: par ? { documento: par.erp10_documento == null ? null : Number(par.erp10_documento) } : null,
    pruebaHecha,
  }
}

/** La lista de hoy de «Salida a ERP10»: lo que ha pasado hoy por la conexión y lo que no ha salido (de cualquier día). */
export async function leerSalidoHoy(accountId: string, companyId: string): Promise<SalidoHoy[]> {
  hayBase()
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  const { data, error } = await tabla('conta_erp10_envio')
    .select('entry_id, estado, erp10_documento, motivo, intentos, como, cambiado_en, journal_entry(series, number, concept)')
    .eq('account_id', accountId).eq('company_id', companyId)
    .or(`cambiado_en.gte.${hoy}T00:00:00+01:00,estado.eq.no_pudo`)
    .order('cambiado_en', { ascending: false }).limit(200)
  if (error) throw new Error(`No se ha podido leer lo que ha salido hoy: ${error.message}`)
  return ((data ?? []) as Fila[]).map(aSalidoHoy)
}

/** Cuántos asientos llevan más de una hora validados sin salir a ERP10 (la barra de abajo). */
export async function leerAtascadosErp10(companyId: string): Promise<number> {
  hayBase()
  const d = await rpc<Fila | null>('conta_erp10_atascados', { p_company: companyId })
  return Number(d?.sin_salir ?? 0)
}
