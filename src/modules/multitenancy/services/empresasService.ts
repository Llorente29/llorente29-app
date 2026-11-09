// src/modules/multitenancy/services/empresasService.ts
//
// DM1 · PR 1 (30/10/2026). Leer las empresas de quien entra y abrir otra.
// mis_empresas y cambiar_empresa son de la 1950. Cambiar de cuenta recarga la
// aplicación entera (decisión 1 de la respuesta 1 al DM1): la base ya solo
// enseña la cuenta abierta, y así no queda nada de la otra en memoria.

import { supabase } from '@/lib/supabase'
import type { ClienteDeDespacho, CuentaMia, DondeEstoy } from '../lib/misEmpresas'

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

// ── G05 · Entrar en un cliente del despacho y volver (08/11/2026) ──────────
// conta_despacho_entrar, conta_despacho_volver, conta_despacho_mis_clientes y
// conta_despacho_donde son de la 1225 (regla 40: comprobados en la base local
// con su prueba de staging, 20261108_g05_entrar_en_el_cliente_prueba.sql).

/** Dónde está quien entra. Sin la 1225 (o sin red): en ningún cliente. */
export async function dondeEstoy(): Promise<DondeEstoy> {
  const { data, error } = await db().rpc('conta_despacho_donde')
  if (error || !data || typeof data !== 'object') return { abierto: null, accesos: [] }
  const d = data as Partial<DondeEstoy>
  return { abierto: d.abierto ?? null, accesos: Array.isArray(d.accesos) ? d.accesos : [] }
}

/** Los clientes de los despachos de quien entra. Sin la 1225, ninguno. */
export async function misClientesDeDespacho(): Promise<ClienteDeDespacho[]> {
  const { data, error } = await db().rpc('conta_despacho_mis_clientes')
  if (error) return []
  return Array.isArray(data) ? (data as ClienteDeDespacho[]) : []
}

/** Lo que dice la base en palabras de oficina (nunca «cuenta activa» ni «tenant»). */
function enPalabras(e: { message?: string; hint?: string } | null, porDefecto: string): string {
  const m = e?.message ?? ''
  if (m.includes('NO_AUTORIZADO')) return 'Ese cliente no te ha dado permiso, o ya no eres de su asesoría.'
  if (m.includes('SIN_SESION')) return 'Se ha cerrado la sesión. Vuelve a entrar.'
  if (m.includes('NO_ES_DE_DESPACHO')) return 'Ya estás en tu despacho.'
  return e?.hint || m || porDefecto
}

/**
 * Entra en la cuenta de un cliente con su sociedad elegida, y recarga en su
 * Inicio de Sumied. Lanza con el porqué si la base no deja (regla 8).
 */
export async function entrarEnCliente(companyId: string, destino: string): Promise<void> {
  const { data, error } = await db().rpc('conta_despacho_entrar', { p_company: companyId })
  if (error) throw new Error(enPalabras(error, 'No se ha podido entrar en ese cliente.'))
  const r = data as { account_id: string; company_id: string }
  try {
    window.localStorage.setItem(CLAVE_CUENTA, r.account_id)
    window.localStorage.setItem(claveSociedad(r.account_id), r.company_id)
  } catch { /* sin almacén: la base ya sabe cuál está abierta */ }
  window.location.assign(destino)
}

/** Vuelve a la cuenta del despacho y recarga en Impuestos › Tus clientes (la ruta la da la base). */
export async function volverAlDespacho(rutaDe: (relativa: string) => string): Promise<void> {
  const { data, error } = await db().rpc('conta_despacho_volver')
  if (error) throw new Error(enPalabras(error, 'No se ha podido volver al despacho.'))
  const r = data as { account_id: string; ruta: string }
  try { window.localStorage.setItem(CLAVE_CUENTA, r.account_id) } catch { /* la base ya lo sabe */ }
  window.location.assign(rutaDe(r.ruta))
}
