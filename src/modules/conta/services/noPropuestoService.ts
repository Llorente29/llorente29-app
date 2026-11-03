// src/modules/conta/services/noPropuestoService.ts
//
// S01 · PR 3 · Lo que no se ha podido proponer solo, de un apartado
// (conta_propuesta_pendiente, de la 0753). Filtrado por empresa (regla 9).

import { tabla, mensaje } from '@/modules/conta/services/bd'
import type { Donde, NoPropuesto } from '@/modules/conta/lib/noPropuesto'

export async function leerNoPropuesto(companyId: string, donde: Donde): Promise<NoPropuesto[]> {
  const { data, error } = await tabla('conta_propuesta_pendiente').select('id, origen, que, porque, at')
    .eq('company_id', companyId).eq('donde', donde).order('at', { ascending: false })
  // El front antes que la base (la 0753 sin aplicar): no hay nada que enseñar, y no es un fallo.
  if (error && /does not exist|could not find|relation/i.test(error.message)) return []
  if (error) throw new Error(mensaje('No se ha podido leer lo que no se ha propuesto', error))
  return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: String(x.id), origen: String(x.origen), que: String(x.que), porque: String(x.porque), at: String(x.at),
  }))
}

/** Lo que no se ha podido apuntar solo de una liquidación: qué es, por qué, y hasta cuándo es su periodo. */
export interface SinPropuesta { origenId: string; que: string; porque: string; hasta: string | null }

/**
 * S01q · PR C · Lo que no se ha podido proponer de las liquidaciones, por su
 * origen (la liquidación de plataforma o la del socio), con el último día de su
 * periodo (channel_settlement y licensed_settlement: id, period_to). Ventas ›
 * Liquidaciones lo dice en su fila, con sus palabras; si no tiene fila en el
 * mes, aparte, en el mes de su periodo (regla 7: no se esconde).
 */
export async function leerNoPropuestoPorOrigen(accountId: string, companyId: string): Promise<Map<string, SinPropuesta>> {
  const { data, error } = await tabla('conta_propuesta_pendiente').select('origen, origen_id, que, porque')
    .eq('company_id', companyId).in('origen', ['channel_settlement', 'licensed_settlement'])
  if (error && /does not exist|could not find|relation/i.test(error.message)) return new Map()
  if (error) throw new Error(mensaje('No se ha podido leer lo que no se ha propuesto', error))
  const filas = (data ?? []) as Record<string, unknown>[]
  const hasta = new Map<string, string>()
  for (const [origen, t] of [['channel_settlement', 'channel_settlement'], ['licensed_settlement', 'licensed_settlement']] as const) {
    const ids = filas.filter((x) => x.origen === origen).map((x) => String(x.origen_id))
    if (!ids.length) continue
    const { data: ps, error: e2 } = await tabla(t).select('id, period_to').eq('account_id', accountId).in('id', ids)
    if (e2) throw new Error(mensaje('No se han podido leer los periodos de lo que no se ha propuesto', e2))
    for (const x of (ps ?? []) as Record<string, unknown>[]) if (x.period_to) hasta.set(String(x.id), String(x.period_to).slice(0, 10))
  }
  return new Map(filas.map((x) => [String(x.origen_id), { origenId: String(x.origen_id), que: String(x.que), porque: String(x.porque), hasta: hasta.get(String(x.origen_id)) ?? null }]))
}
