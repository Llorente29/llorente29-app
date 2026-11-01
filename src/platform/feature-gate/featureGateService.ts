// src/platform/feature-gate/featureGateService.ts
// Servicio central de feature gating. Carga los feature flags de la empresa
// abierta y permite preguntar si tiene acceso a una funcionalidad concreta.
// DM1 · PR 1b (30/10): la empresa abierta, no «el perfil» del usuario (con
// varias empresas había varios). Ver cuentaDelGate.ts.

import { supabase } from '@/lib/supabase'
import type {
  Account,
  AccountPlatformState,
} from '@/platform/types'
import { cuentaDelGate } from './cuentaDelGate'

// ─── ESTADO INTERNO ──────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutos
let state: AccountPlatformState | null = null
// Una carga en curso por cuenta: si se pide otra mientras tanto, cada una va
// por su lado y solo se queda la última pedida.
const enCurso = new Map<string, Promise<AccountPlatformState | null>>()
let ultimaPedida: string | null = null
// Lo que dice la base de quien entra, por usuario: su cuenta abierta y si es
// superadministrador. Para quien no lo es, la abierta solo cambia con
// cambiar_empresa, que recarga la aplicación entera.
let deLaBase: { uid: string; cuenta: string | null; esPlataforma: boolean } | null = null

/** La clave con la que AppContext recuerda la cuenta activa (la elige el superadministrador). */
const CLAVE_CUENTA_ACTIVA = 'andy-app-active-account'

function elegidaEnElNavegador(): string | null {
  try { return localStorage.getItem(CLAVE_CUENTA_ACTIVA) } catch { return null }
}

// ─── CARGA DE DATOS ──────────────────────────────────────────────────────

/**
 * La cuenta de la empresa abierta (DM1 · PR 1b, 30/10): la de la base para
 * todos; la elegida en el selector para el superadministrador. Ver
 * cuentaDelGate.ts.
 */
async function resolverCuenta(elegida?: string | null): Promise<string | null> {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id ?? null
  if (!uid) return null
  if (!deLaBase || deLaBase.uid !== uid) {
    // Las dos, de la base: las mismas que usan las políticas (_cuenta_activa,
    // de la 1950, y current_user_is_admin). No el claim del token: en
    // staging-conta el hook que lo pone no está activado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const [abierta, plataforma] = await Promise.all([
      db.rpc('_cuenta_activa'),
      db.rpc('current_user_is_admin'),
    ])
    if (abierta.error) {
      console.error('[featureGate] _cuenta_activa:', abierta.error.message)
      return null
    }
    deLaBase = {
      uid,
      cuenta: (abierta.data as string | null) ?? null,
      esPlataforma: !plataforma.error && plataforma.data === true,
    }
  }
  return cuentaDelGate({
    esPlataforma: deLaBase.esPlataforma,
    elegida: elegida ?? elegidaEnElNavegador(),
    deLaBase: deLaBase.cuenta,
  })
}

/**
 * Carga el estado de plataforma de la empresa abierta.
 * Idempotente: si ya está cargado para esa cuenta y dentro del TTL, devuelve la
 * cache. Si hay una carga en curso de esa cuenta, reusa la misma promesa.
 * `elegida`: la cuenta activa de la pantalla (solo cuenta para el
 * superadministrador).
 */
async function load(elegida?: string | null): Promise<AccountPlatformState | null> {
  if (!supabase) {
    state = null
    return null
  }
  try {
    const accountId = await resolverCuenta(elegida)
    if (!accountId) {
      state = null
      return null
    }
    ultimaPedida = accountId

    // Cache válida y de esta cuenta → devolver directamente
    if (state && state.account.id === accountId && Date.now() - state.loadedAt < CACHE_TTL_MS) {
      return state
    }
    const yaVa = enCurso.get(accountId)
    if (yaVa) return yaVa

    const promesa = cargarCuenta(accountId).finally(() => { enCurso.delete(accountId) })
    enCurso.set(accountId, promesa)
    return promesa
  } catch (err) {
    console.error('[featureGate] load error:', err)
    state = null
    return null
  }
}

async function cargarCuenta(accountId: string): Promise<AccountPlatformState | null> {
  if (!supabase) return null
  try {
    // Cuenta + flags + quotas + usage en paralelo, todo de la misma cuenta.
    const [
      { data: accountData },
      { data: flagsData },
      { data: quotasData },
      { data: usageData },
    ] = await Promise.all([
      supabase.from('accounts').select('*').eq('id', accountId).maybeSingle(),
      supabase.from('feature_flags').select('feature_key,enabled').eq('account_id', accountId),
      supabase.from('quotas').select('quota_key,limit_value').eq('account_id', accountId),
      supabase
        .from('usage_counters')
        .select('quota_key,current_value')
        .eq('account_id', accountId)
        .gte('period_start', firstDayOfMonth()),
    ])

    // Mientras cargaba se ha pedido otra: esta ya no manda.
    if (ultimaPedida !== accountId) return state

    if (!accountData) {
      state = null
      return null
    }

    const flags = new Set<string>(
      (flagsData ?? [])
        .filter(f => f.enabled)
        .map(f => f.feature_key)
    )
    const quotas = new Map<string, number>(
      (quotasData ?? []).map(q => [q.quota_key, q.limit_value])
    )
    const usage = new Map<string, number>(
      (usageData ?? []).map(u => [u.quota_key, u.current_value])
    )

    state = {
      account: accountData as Account,
      flags,
      quotas,
      usage,
      loadedAt: Date.now(),
    }
    return state
  } catch (err) {
    console.error('[featureGate] load error:', err)
    if (ultimaPedida === accountId) state = null
    return null
  }
}

// ─── API PÚBLICA ─────────────────────────────────────────────────────────

/**
 * ¿La cuenta tiene activa esta feature?
 * Devuelve false si el estado no está cargado todavía (no se hace fetch aquí).
 * Llama a load() al inicio de la sesión.
 */
function has(featureKey: string): boolean {
  if (!state) return false
  return state.flags.has(featureKey)
}

/** ¿Tiene activa al menos una de estas features? */
function hasAny(featureKeys: string[]): boolean {
  if (!state) return false
  return featureKeys.some(k => state!.flags.has(k))
}

/** ¿Tiene activas todas estas features? */
function hasAll(featureKeys: string[]): boolean {
  if (!state) return false
  return featureKeys.every(k => state!.flags.has(k))
}

/** Cuenta actual (objeto completo) */
function account(): Account | null {
  return state?.account ?? null
}

/** ¿Es cuenta interna de Folvy (acceso total sin suscripción)? */
function isInternal(): boolean {
  return state?.account.is_internal ?? false
}

/** Estado completo (útil para componentes que quieran reaccionar) */
function snapshot(): AccountPlatformState | null {
  return state
}

/**
 * ¿Se puede crear un nuevo item según las quotas?
 * Compara usage_counters.current_value con quotas.limit_value.
 * limit=0 significa ilimitado.
 */
function canCreate(quotaKey: string): boolean {
  if (!state) return false
  const limit = state.quotas.get(quotaKey)
  if (limit === undefined) return true   // sin quota definida = sin límite
  if (limit === 0) return true           // 0 = ilimitado
  const current = state.usage.get(quotaKey) ?? 0
  return current < limit
}

/** Forzar recarga desde BBDD (ej. tras cambio de suscripción) */
async function refresh(elegida?: string | null): Promise<AccountPlatformState | null> {
  state = null
  deLaBase = null
  return load(elegida)
}

/** Limpiar al logout */
function clear(): void {
  state = null
  deLaBase = null
  ultimaPedida = null
  enCurso.clear()
}

// ─── HELPER ──────────────────────────────────────────────────────────────

function firstDayOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

// ─── EXPORT ──────────────────────────────────────────────────────────────

export const gate = {
  load,
  has,
  hasAny,
  hasAll,
  canCreate,
  account,
  isInternal,
  snapshot,
  refresh,
  clear,
}

export type FeatureGate = typeof gate
