// src/platform/feature-gate/featureGateService.ts
// Servicio central de feature gating. Carga los feature flags del usuario
// actual y permite preguntar si tiene acceso a una funcionalidad concreta.

import { supabase } from '@/lib/supabase'
import type {
  Account,
  AccountPlatformState,
} from '@/platform/types'

// ─── ESTADO INTERNO ──────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutos
let state: AccountPlatformState | null = null
let loadingPromise: Promise<AccountPlatformState | null> | null = null

// ─── CARGA DE DATOS ──────────────────────────────────────────────────────

/**
 * Carga el estado de plataforma completo del usuario actual.
 * Idempotente: si ya está cargado y dentro del TTL, devuelve la cache.
 * Si hay una carga en curso, reusa esa misma promesa.
 */
async function load(): Promise<AccountPlatformState | null> {
  // Si Supabase no está configurado, no hay nada que cargar
  if (!supabase) {
    state = null
    return null
  }

  // Cache válida → devolver directamente
  if (state && Date.now() - state.loadedAt < CACHE_TTL_MS) {
    return state
  }

  // Carga en curso → reusar la promesa para evitar dobles fetch
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    if (!supabase) {
      state = null
      return null
    }

    try {
      // 1. Identificar al usuario actual
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        state = null
        return null
      }

      // 2. Buscar su user_profile
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!profileData) {
        state = null
        return null
      }

      // 3. Determinar account_id
      //    - Admin: cuenta interna de Foodint
      //    - Manager/Trabajador: vía manager_locations → locations
      let accountId: string | null = null

      if (profileData.role === 'admin') {
        accountId = '00000000-0000-0000-0000-000000000001'
      } else {
        const { data: managerLocs } = await supabase
          .from('manager_locations')
          .select('locations(account_id)')
          .eq('user_profile_id', profileData.id)
          .limit(1)
          .maybeSingle()

        const loc = managerLocs?.locations as unknown as { account_id: string } | null
        accountId = loc?.account_id ?? null
      }

      if (!accountId) {
        state = null
        return null
      }

      // 4. Cargar cuenta + flags + quotas + usage en paralelo
      const [
        { data: accountData },
        { data: flagsData },
        { data: quotasData },
        { data: usageData },
      ] = await Promise.all([
        supabase.from('accounts').select('*').eq('id', accountId).single(),
        supabase.from('feature_flags').select('feature_key,enabled').eq('account_id', accountId),
        supabase.from('quotas').select('quota_key,limit_value').eq('account_id', accountId),
        supabase
          .from('usage_counters')
          .select('quota_key,current_value')
          .eq('account_id', accountId)
          .gte('period_start', firstDayOfMonth()),
      ])

      if (!accountData) {
        state = null
        return null
      }

      // 5. Construir el estado en memoria con estructuras eficientes
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
      state = null
      return null
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
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

/** ¿Es cuenta interna de Foodint (acceso total sin suscripción)? */
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
async function refresh(): Promise<AccountPlatformState | null> {
  state = null
  return load()
}

/** Limpiar al logout */
function clear(): void {
  state = null
  loadingPromise = null
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