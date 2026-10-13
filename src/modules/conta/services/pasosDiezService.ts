// src/modules/conta/services/pasosDiezService.ts
//
// C06, respuesta 3: lo que leen los pasos antes de traer de Diez. La verdad la
// dice la base (conta_diez_listo, la misma que mira el workflow del histórico
// antes de traer nada); aquí solo se lee y, en el paso del banco, se crea la
// subcuenta 572 del banco que se dio de alta después de activar el plan.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'
import { anadirSubcuenta } from '@/modules/conta/services/planService'
import type { ListoDiez } from '@/modules/conta/lib/pasosDiez'

type Fila = Record<string, unknown>

export const leerPasosDiez = (companyId: string) => rpc<ListoDiez>('conta_diez_listo', { p_company: companyId })

/** Bancos dados de alta (treasury_account) cuya subcuenta del 572 aún no está enlazada en el plan. */
export async function bancosSinSubcuenta(accountId: string, companyId: string): Promise<{ id: string; name: string }[]> {
  const [bancos, enlaces] = await Promise.all([
    tabla('treasury_account').select('id, name').eq('account_id', accountId).eq('company_id', companyId).eq('kind', 'bank').eq('is_active', true),
    tabla('company_account_link').select('entity_id').eq('account_id', accountId).eq('company_id', companyId).eq('entity', 'bank_account'),
  ])
  for (const r of [bancos, enlaces]) if (r.error) throw new Error(mensaje('No se han podido leer tus bancos', r.error))
  const con = new Set(((enlaces.data ?? []) as Fila[]).map((e) => String(e.entity_id)))
  return ((bancos.data ?? []) as Fila[]).filter((b) => !con.has(String(b.id))).map((b) => ({ id: String(b.id), name: String(b.name) }))
}

/** Crea la subcuenta 572 de cada banco sin ella («Bancos · <nombre>», enlazada al banco). Devuelve los códigos. */
export async function crearSubcuentasDeBanco(accountId: string, companyId: string, quien: string | null): Promise<string[]> {
  const faltan = await bancosSinSubcuenta(accountId, companyId)
  const hechas: string[] = []
  for (const b of faltan) {
    const r = await anadirSubcuenta(companyId, '572', `Bancos · ${b.name}`, null, { entity: 'bank_account', id: b.id }, quien)
    hechas.push(r.code)
  }
  return hechas
}

/** Cuántas subcuentas llegaron de Diez sin nombre y esperan uno. */
export async function subcuentasSinNombre(accountId: string, companyId: string): Promise<number> {
  const { count, error } = await tabla('company_account').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('company_id', companyId).eq('name_pending', true)
  if (error) throw new Error(mensaje('No se han podido leer las subcuentas sin nombre', error))
  return count ?? 0
}
