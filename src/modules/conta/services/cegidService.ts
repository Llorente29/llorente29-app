// src/modules/conta/services/cegidService.ts
//
// Q10 · respuesta 1 · La conexión con la facturación de Cegid (DiezREC) y lo que se lee de ella. Como la de ERP10
// (erp10ApiService.ts): las cuatro claves de la cuenta van cifradas en el Vault por connector-credentials (nunca en
// el navegador después de guardarlas, ni en el registro); cada sociedad lleva su código de empresa en Cegid. Lo que
// habla con Cegid es conta-cegid-leer (el servidor): aquí solo se le llama y se lee lo guardado (conta_cegid_*).

import { supabase } from '@/lib/supabase'
import type { IncidenciaCegid } from '../../../../supabase/functions/_shared/cegidMandar'
import { hayBase, rpc, tabla } from '@/modules/conta/services/bd'
import { getConnectorCredentialsStatus, saveConnectorCredentials } from '@/modules/integrations/services/connectorCredentialsService'

type Fila = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))

export interface ConexionCegid {
  connectorId: string
  cuentaId: string | null
  conClaves: boolean
  sociedadId: string | null
  /** El código de empresa de esta sociedad en Cegid («empresa» del login). */
  codigo: string
}

export async function leerConexionCegid(accountId: string, companyId: string): Promise<ConexionCegid> {
  hayBase()
  const { data: con, error: e0 } = await tabla('connector').select('id').eq('code', 'diezrec').maybeSingle()
  if (e0) throw new Error(`No se ha podido leer el conector de la facturación de Cegid: ${e0.message}`)
  if (!con) throw new Error('Esta base no tiene todavía el conector de la facturación de Cegid.')
  const connectorId = String((con as Fila).id)
  const { data: ac, error: e1 } = await tabla('account_connector').select('id, scope, company_id, external_account_id')
    .eq('account_id', accountId).eq('connector_id', connectorId).in('scope', ['account', 'company'])
  if (e1) throw new Error(`No se ha podido leer la conexión con la facturación de Cegid: ${e1.message}`)
  const filas = (ac ?? []) as Fila[]
  const cuenta = filas.find((x) => x.scope === 'account') ?? null
  const soc = filas.find((x) => x.scope === 'company' && x.company_id === companyId) ?? null
  let conClaves = false
  if (cuenta) { const r = await getConnectorCredentialsStatus(String(cuenta.id)); conClaves = r.ok && r.hasCredentials }
  return { connectorId, cuentaId: cuenta ? String(cuenta.id) : null, conClaves, sociedadId: soc ? String(soc.id) : null, codigo: soc ? String(soc.external_account_id ?? '') : '' }
}

export type ClavesCegid = Record<'client_id' | 'client_secret' | 'username' | 'password', string>

/** Las cuatro claves, juntas. Crea la conexión de la cuenta si no la hay. */
export async function guardarClavesCegid(accountId: string, c: ConexionCegid, claves: ClavesCegid, quien: string | null): Promise<string> {
  hayBase()
  const escritas = Object.values(claves).filter((v) => v.trim()).length
  if (escritas < 4) throw new Error(escritas ? 'Escribe las cuatro claves a la vez: se guardan juntas.' : 'Faltan las cuatro claves.')
  let id = c.cuentaId
  if (!id) {
    const { data, error } = await tabla('account_connector').insert({
      account_id: accountId, connector_id: c.connectorId, scope: 'account', status: 'connecting', config: {}, created_by_name: quien,
    }).select('id').single()
    if (error) throw new Error(`No se han guardado las claves: ${error.message}`)
    id = String((data as Fila).id)
  }
  const r = await saveConnectorCredentials({ accountConnectorId: id, secrets: Object.fromEntries(Object.entries(claves).map(([k, v]) => [k, v.trim()])), config: {} })
  if (!r.ok) throw new Error(`No se han guardado las claves: ${r.error}`)
  return 'Claves guardadas, cifradas. Ahora pon el código de empresa y pulsa «Probar la conexión».'
}

/** El código de empresa de la sociedad en Cegid (crea su conexión si no la tiene). */
export async function guardarCodigoCegid(accountId: string, companyId: string, c: ConexionCegid, codigo: string, quien: string | null): Promise<string> {
  hayBase()
  const limpio = codigo.trim()
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(limpio)) throw new Error('El código de empresa es un número (o el nombre de la base de datos de Cegid), sin espacios.')
  const { data: ya, error: e0 } = await tabla('account_connector').select('id').eq('account_id', accountId).eq('connector_id', c.connectorId)
    .eq('scope', 'company').eq('company_id', companyId).maybeSingle()
  if (e0) throw new Error(`No se ha leído la conexión de la sociedad: ${e0.message}`)
  if (ya) {
    const { error } = await tabla('account_connector').update({ external_account_id: limpio, status: 'connected', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', String((ya as Fila).id)).eq('account_id', accountId)
    if (error) throw new Error(`No se ha guardado el código: ${error.message}`)
  } else {
    const { error } = await tabla('account_connector').insert({ account_id: accountId, connector_id: c.connectorId, scope: 'company', company_id: companyId,
      external_account_id: limpio, status: 'connected', config: {}, created_by_name: quien })
    if (error) throw new Error(`No se ha guardado el código: ${error.message}`)
  }
  return `Guardado: esta empresa es la ${limpio} en la facturación de Cegid.`
}

async function invocar(body: Fila): Promise<Fila> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-cegid-leer', { body })
  if (!error) return (data ?? {}) as Fila
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  throw new Error(str(cuerpo?.error) ?? (ctx?.status === 404 ? 'Leer de la facturación de Cegid aún no está publicado en este entorno.' : `No se ha podido entrar en la facturación de Cegid: ${error.message}`))
}

/** «Probar la conexión»: entra y lee las series; no escribe nada. Devuelve su frase. */
export async function probarCegid(companyId: string): Promise<string> {
  const d = await invocar({ company_id: companyId, accion: 'probar' })
  return String(d.frase ?? 'Conectada.')
}

export const leerPaginaCegid = (companyId: string, que: 'clientes' | 'conceptos' | 'facturas', pagina: number, ejercicio?: number) =>
  invocar({ company_id: companyId, accion: 'leer', que, pagina, ejercicio }) as Promise<{ leidas: number; total: number | null; ultima: boolean }>
export const detalleCegid = (companyId: string, que: 'clientes' | 'conceptos', desde: number) =>
  invocar({ company_id: companyId, accion: 'detalle', que, desde }) as Promise<{ hechos: number; ultima: boolean }>

/** Leerlo todo, por páginas: clientes (y sus conceptos fijos), conceptos (con su IVA y retención) y las facturas del ejercicio. */
export async function leerTodoCegid(companyId: string, ejercicio: number, avance: (frase: string) => void): Promise<string> {
  const cuenta: Record<string, number> = { clientes: 0, conceptos: 0, facturas: 0 }
  for (const que of ['clientes', 'conceptos', 'facturas'] as const) {
    for (let p = 0; p < 1000; p++) {
      avance(`Leyendo de Cegid los ${que}… (${cuenta[que]} leídos)`)
      const r = await leerPaginaCegid(companyId, que, p, que === 'facturas' ? ejercicio : undefined)
      cuenta[que] += r.leidas
      if (r.ultima) break
    }
  }
  for (const que of ['clientes', 'conceptos'] as const) {
    for (let desde = 0; desde < 100_000; desde += 25) {
      avance(`Leyendo de Cegid ${que === 'clientes' ? 'los conceptos fijos de cada cliente' : 'el IVA y la retención de cada concepto'}… (${Math.min(desde, cuenta[que])} de ${cuenta[que]})`)
      const r = await detalleCegid(companyId, que, desde)
      if (r.ultima) break
    }
  }
  return `Leído de Cegid: ${cuenta.clientes} clientes con sus conceptos fijos, ${cuenta.conceptos} conceptos y ${cuenta.facturas} facturas de ${ejercicio}. No se ha escrito nada en Cegid.`
}

// ── Lo guardado (para el cuadre y la tabla de equivalencias) ─────────────────────────────

export interface LeidoCegid {
  clientes: { codigo: number; nombre: string | null; nif: string | null; email?: string | null; conceptos: { codigoConcepto: string | null; descripcion: string | null; totalLinea: number | null; cantidad: number | null; importe: number | null }[] | null }[]
  conceptos: { codigo: string; descripcion: string | null; porIva: number | null; conRetencion: boolean | null; ivaIncluido: boolean | null }[]
  facturas: { ejercicio: number; serie: string; codigo: number; cliente: number | null; nif: string | null; fecha: number | null; total: number | null; retencion: number; porcentajeRetencion: number | null; lineas: Fila[] }[]
  leidoAt: string | null
}

async function todas(nombre: string, columnas: string, companyId: string, orden: string): Promise<Fila[]> {
  const r: Fila[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await tabla(nombre).select(columnas).eq('company_id', companyId).order(orden).range(i, i + 999)
    if (error) throw new Error(`No se ha podido leer lo leído de Cegid (${nombre}): ${error.message}`)
    const xs = (data ?? []) as Fila[]
    r.push(...xs)
    if (xs.length < 1000) return r
  }
}

export async function leerGuardadoCegid(companyId: string, ejercicio: number): Promise<LeidoCegid> {
  const [cl, co, fa] = await Promise.all([
    todas('conta_cegid_cliente', 'codigo, nombre_comercial, nombre_fiscal, nif, email, conceptos, leido_at', companyId, 'codigo'),
    todas('conta_cegid_concepto', 'codigo, descripcion, por_iva, con_retencion, iva_incluido', companyId, 'codigo'),
    todas('conta_cegid_factura', 'ejercicio, serie, codigo, cliente, nif, fecha_cegid, total, retencion, porcentaje_retencion, lineas', companyId, 'codigo'),
  ])
  return {
    clientes: cl.map((x) => ({ codigo: Number(x.codigo), nombre: str(x.nombre_fiscal) ?? str(x.nombre_comercial), nif: str(x.nif), email: str(x.email), conceptos: (x.conceptos as LeidoCegid['clientes'][number]['conceptos']) ?? null })),
    conceptos: co.map((x) => ({ codigo: String(x.codigo), descripcion: str(x.descripcion), porIva: x.por_iva == null ? null : Number(x.por_iva), conRetencion: (x.con_retencion as boolean | null) ?? null, ivaIncluido: (x.iva_incluido as boolean | null) ?? null })),
    facturas: fa.filter((x) => Number(x.ejercicio) === ejercicio).map((x) => ({ ejercicio: Number(x.ejercicio), serie: String(x.serie), codigo: Number(x.codigo), cliente: x.cliente == null ? null : Number(x.cliente),
      nif: str(x.nif), fecha: x.fecha_cegid == null ? null : Number(x.fecha_cegid), total: x.total == null ? null : Number(x.total), retencion: Number(x.retencion ?? 0), porcentajeRetencion: x.porcentaje_retencion == null ? null : Number(x.porcentaje_retencion), lineas: (x.lineas as Fila[]) ?? [] })),
    leidoAt: cl.reduce<string | null>((m, x) => { const t = str(x.leido_at); return t && (!m || t > m) ? t : m }, null),
  }
}

// ── Q10 · respuesta 3 · Mandar a Cegid (conta-cegid-mandar) ─────────────────────────────

async function mandarInvocar(body: Fila): Promise<Fila> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await supabase.functions.invoke('conta-cegid-mandar', { body })
  if (!error) return (data ?? {}) as Fila
  const ctx = (error as { context?: Response }).context
  const cuerpo = ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) as Fila | null : null
  throw new Error(str(cuerpo?.error) ?? (ctx?.status === 404 ? 'Mandar a Cegid aún no está publicado en este entorno.' : `No se ha podido mandar a Cegid: ${error.message}`))
}

/** Manda a Cegid los cobros de UN cliente; devuelve su frase o lanza con el porqué. */
export async function mandarClienteCegid(companyId: string, mes: string, cliente: number, cobros: string[], serie: '1' | '3'): Promise<string> {
  const r = await mandarInvocar({ company_id: companyId, accion: 'mandar', mes, cliente, cobros, serie })
  return String(r.frase ?? 'Mandado.')
}

/** Borra en Cegid lo mandado por Sumied este mes que aún no esté facturado (de un cliente, o de todos). */
export async function deshacerCegid(companyId: string, mes: string, cliente?: number): Promise<string> {
  const r = await mandarInvocar({ company_id: companyId, accion: 'deshacer', mes, ...(cliente ? { cliente } : {}) })
  return String(r.frase ?? 'Deshecho.')
}

export interface IncidenciaMandada { gcCobroId: string; cliente: number; incidencia: number | null; estado: string; total: number; serie: string; serieFactura: string | null }
/** Lo mandado a Cegid de un mes (conta_cegid_incidencia, la 2336). Sin la tabla, nada. */
export async function leerMandadoCegid(companyId: string, mes: string): Promise<IncidenciaMandada[]> {
  const { data, error } = await tabla('conta_cegid_incidencia').select('gc_cobro_id, cliente, incidencia, estado, total, serie, serie_factura').eq('company_id', companyId).eq('mes', mes)
  if (error) return []
  return ((data ?? []) as Fila[]).map((x) => ({ gcCobroId: String(x.gc_cobro_id), cliente: Number(x.cliente), incidencia: x.incidencia == null ? null : Number(x.incidencia), estado: String(x.estado), total: Number(x.total),
    serie: String(x.serie ?? '1'), serieFactura: str(x.serie_factura) }))
}

/** Q10 · respuesta 4 · Las incidencias del mes que hay en Cegid (las de Sumied y las de cualquiera), para el cuadre. Solo lee. */
export async function leerIncidenciasMesCegid(companyId: string, mes: string): Promise<{ incidencias: IncidenciaCegid[]; frase: string }> {
  const r = await mandarInvocar({ company_id: companyId, accion: 'leer_mes', mes })
  return { incidencias: (r.incidencias as IncidenciaCegid[] | undefined) ?? [], frase: String(r.frase ?? 'Leído de Cegid.') }
}

/** Q10 · respuesta 4 · «Atar al N»: la ficha es el cliente N de Cegid (conta_cobro_cliente.codigo_cliente). */
export async function atarFichaCegid(companyId: string, partyId: string, codigo: number, como: 'correo' | 'nombre' | 'a_mano'): Promise<string> {
  const r = await rpc<Fila | null>('conta_cegid_atar', { p_company: companyId, p_party: partyId, p_codigo: codigo, p_como: como })
  return String(r?.frase ?? `Atada al cliente ${codigo} de Cegid.`)
}
