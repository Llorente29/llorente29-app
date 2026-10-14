// src/modules/conta/services/programaService.ts
//
// C06, respuesta 4: de qué programa viene la empresa (pregunta del alta). Se
// guarda con su registro por conta_programa_anterior_poner (0400); se lee de
// conta_programa_anterior (RLS: los de la cuenta).
//
// Nombres de la base entre comillas (regla 40): conta_programa_anterior,
// conta_programa_anterior_poner.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import type { ProgramaAnterior, Respuesta } from '@/modules/conta/alta/programa'

export const ponerProgramaAnterior = (companyId: string, r: Respuesta) =>
  rpc<{ programa: string }>('conta_programa_anterior_poner', { p_company: companyId, p_programa: r.programa, p_otro: r.otro })

/** La respuesta de la empresa, o null si no la tiene (su alta es de antes de la pregunta). */
export async function leerProgramaAnterior(accountId: string, companyId: string): Promise<ProgramaAnterior | null> {
  const { data, error } = await tabla('conta_programa_anterior').select('programa').eq('account_id', accountId).eq('company_id', companyId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer de qué programa vienes', error))
  return data ? (String((data as Record<string, unknown>).programa) as ProgramaAnterior) : null
}

/** ¿Tiene ya el plan activado (alguna cuenta en company_account)? Un alta retomada no lo activa dos veces. */
export async function planActivado(companyId: string): Promise<boolean> {
  const { count, error } = await tabla('company_account').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
  if (error) throw new Error(mensaje('No se ha podido mirar el plan', error))
  return (count ?? 0) > 0
}
