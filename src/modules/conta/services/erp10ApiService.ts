// src/modules/conta/services/erp10ApiService.ts
//
// X10 (19/11) · Entrar en ERP10 desde Sumied, fase 1 (solo leer). X10b: la tarjeta
// «Conexión con ERP10» de la salida guarda las claves y el código de empresa de la
// sociedad abierta, y la prueba; el paso 3 lee los saldos de ERP10 sin subir un Excel. Lo que
// habla con ERP10 es la función conta-erp10-leer (en el servidor, con las claves en
// el Vault): aquí nunca hay claves.

import { supabase } from '@/lib/supabase'
import { hayBase, tabla } from '@/modules/conta/services/bd'
import type { FilaSumas } from '@/modules/conta/lib/traer'
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

/** Los saldos de ERP10 de una sociedad entre dos días, sumados por cuenta (céntimos). */
export async function leerSaldosErp10(companyId: string, desde: string, hasta: string): Promise<{ filas: FilaSumas[]; lineas: number; leidoEn: string }> {
  const d = await invocar({ company_id: companyId, accion: 'saldos', desde, hasta })
  const filas = (Array.isArray(d.filas) ? d.filas : []).map((f: Fila) => ({
    subcuenta: String(f.subcuenta ?? ''), nombre: String(f.nombre ?? ''), debe: Number(f.debe ?? 0), haber: Number(f.haber ?? 0),
    deudor: Number(f.deudor ?? 0), acreedor: Number(f.acreedor ?? 0),
  }))
  return { filas, lineas: Number(d.lineas ?? 0), leidoEn: String(d.leidoEn ?? new Date().toISOString()) }
}
