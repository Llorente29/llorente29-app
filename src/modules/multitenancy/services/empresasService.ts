// src/modules/multitenancy/services/empresasService.ts
//
// DM1 · PR 1 (30/10/2026). Leer las empresas de quien entra y abrir otra.
// mis_empresas y cambiar_empresa son de la 1950. Cambiar de cuenta recarga la
// aplicación entera (decisión 1 de la respuesta 1 al DM1): la base ya solo
// enseña la cuenta abierta, y así no queda nada de la otra en memoria.

import { supabase } from '@/lib/supabase'
import type { CuentaMia } from '../lib/misEmpresas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase
}

/** Las cuentas de quien entra. Sin la 1950 (o sin red), ninguna: el selector no sale. */
export async function misEmpresas(): Promise<CuentaMia[]> {
  const { data, error } = await db().rpc('mis_empresas')
  if (error) return []
  return Array.isArray(data) ? (data as CuentaMia[]) : []
}

/** La clave con la que AppContext recuerda la cuenta abierta en el navegador. */
const CLAVE_CUENTA = 'andy-app-active-account'
/** La de Sumied para la sociedad elegida en cada cuenta (empresa/contexto.ts). */
const claveSociedad = (accountId: string) => `folvy.conta.empresa.${accountId}`

/**
 * Abre otra cuenta (y, si se dice, una de sus sociedades) y recarga en `destino`.
 * Lanza con el motivo en palabras si la base no deja.
 */
export async function abrirEmpresa(accountId: string, sociedadId: string | null, destino: string): Promise<void> {
  const { error } = await db().rpc('cambiar_empresa', { p_account_id: accountId })
  if (error) throw new Error(error.hint || error.message || 'No se ha podido abrir esa empresa.')
  try {
    window.localStorage.setItem(CLAVE_CUENTA, accountId)
    if (sociedadId) window.localStorage.setItem(claveSociedad(accountId), sociedadId)
  } catch { /* sin almacén: la base ya sabe cuál está abierta */ }
  window.location.assign(destino)
}
