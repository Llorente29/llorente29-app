// src/modules/conta/services/erp10ApiService.ts
//
// X10 (19/11) · Entrar en ERP10 desde Sumied, fase 1 (solo leer). La pantalla del
// conector «ERP10 (despacho)» guarda el código de empresa de cada sociedad y la
// prueba; el paso 3 de la salida lee los saldos de ERP10 sin subir un Excel. Lo que
// habla con ERP10 es la función conta-erp10-leer (en el servidor, con las claves en
// el Vault): aquí nunca hay claves.

import { supabase } from '@/lib/supabase'
import { hayBase, tabla } from '@/modules/conta/services/bd'
import type { FilaSumas } from '@/modules/conta/lib/traer'

type Fila = Record<string, unknown>
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null)

/** Una sociedad de la cuenta y su conexión con ERP10 (si la tiene). */
export interface SociedadErp10 {
  companyId: string
  nombre: string
  nif: string | null
  conexionId: string | null
  codigo: string
  estado: string | null
  ultimoFallo: string | null
}

/** Las sociedades de la cuenta, cada una con su código de empresa de ERP10. */
export async function leerSociedadesErp10(accountId: string, connectorId: string): Promise<SociedadErp10[]> {
  hayBase()
  const [{ data: cs, error: e1 }, { data: ac, error: e2 }] = await Promise.all([
    tabla('company').select('id, legal_name, trade_name, tax_id').eq('account_id', accountId).order('legal_name'),
    tabla('account_connector').select('id, company_id, external_account_id, status, last_error').eq('account_id', accountId).eq('connector_id', connectorId).eq('scope', 'company'),
  ])
  if (e1 || e2) throw new Error(`No se han podido leer las sociedades: ${(e1 ?? e2)!.message}`)
  const por = new Map(((ac ?? []) as Fila[]).map((x) => [String(x.company_id), x]))
  return ((cs ?? []) as Fila[]).map((c) => {
    const x = por.get(String(c.id))
    return {
      companyId: String(c.id), nombre: String(c.trade_name ?? c.legal_name ?? ''), nif: str(c.tax_id),
      conexionId: x ? String(x.id) : null, codigo: x ? String(x.external_account_id ?? '') : '',
      estado: x ? String(x.status) : null, ultimoFallo: x ? str(x.last_error) : null,
    }
  })
}

/** Guarda el código de empresa de una sociedad (crea su conexión si no la tiene). */
export async function guardarCodigoErp10(accountId: string, connectorId: string, s: SociedadErp10, codigo: string, quien: { id: string | null; nombre: string | null }): Promise<SociedadErp10> {
  hayBase()
  const limpio = codigo.trim()
  if (s.conexionId) {
    const { error } = await tabla('account_connector').update({ external_account_id: limpio || null, status: 'connected', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', s.conexionId).eq('account_id', accountId)
    if (error) throw new Error(`No se ha guardado el código: ${error.message}`)
    return { ...s, codigo: limpio, estado: 'connected', ultimoFallo: null }
  }
  const { data, error } = await tabla('account_connector').insert({
    account_id: accountId, connector_id: connectorId, scope: 'company', company_id: s.companyId, external_account_id: limpio || null,
    status: 'connected', config: {}, created_by: quien.id, created_by_name: quien.nombre,
  }).select('id').single()
  if (error) throw new Error(`No se ha guardado el código: ${error.message}`)
  return { ...s, conexionId: String((data as Fila).id), codigo: limpio, estado: 'connected', ultimoFallo: null }
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
  enErp10: { mes: string; asientos: number; lineas: number; facturas: number | null; tipos: { tipo: number | null; asientos: number; lineas: number }[] }[]
  pdf: { status: number; bytes: number; motivo: string | null }[]
  deSumied: { mes: string; partidas: number; clases: Record<string, number> }[]
}
export async function probarErp10(companyId: string): Promise<Probado> {
  const d = await invocar({ company_id: companyId, accion: 'probar' })
  return {
    frase: String(d.frase ?? 'Conectada con ERP10.'),
    enErp10: (Array.isArray(d.enErp10) ? d.enErp10 : []) as Probado['enErp10'],
    pdf: (Array.isArray(d.pdf) ? d.pdf : []) as Probado['pdf'],
    deSumied: (Array.isArray(d.deSumied) ? d.deSumied : []) as Probado['deSumied'],
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
