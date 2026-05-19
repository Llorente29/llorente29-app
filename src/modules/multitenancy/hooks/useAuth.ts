// src/modules/multitenancy/hooks/useAuth.ts
//
// Hook de conveniencia sobre AppContext para componentes que necesitan
// información de la sesión Supabase Auth + claims `folvy.*` del JWT.
//
// FILOSOFÍA (coherente con useActiveAccount, useLocationScope, usePermissions):
//   Este hook NO duplica subscriptions a `onAuthStateChange` ni queries a
//   `supabase.auth.getUser()`. Esa fuente de verdad vive en AppContext.
//   useAuth() simplemente lee del context y AÑADE la decodificación de los
//   claims `folvy.*` que el `custom_access_token_hook` (Sprint 2 A1) inyecta
//   en cada JWT emitido.
//
// API:
//   useAuth()                     → estado completo de sesión + folvy claims
//   useAuth().signIn(e, p)        → email + password login (envuelve authService)
//   useAuth().signOut()           → cierra sesión Supabase
//
// USO TÍPICO en pantallas pre-sesión (/login, /welcome, /reset-password):
//
//   const { signIn, isAuthenticated, isAuthResolved } = useAuth()
//   if (!isAuthResolved) return <Spinner/>
//   if (isAuthenticated) return <Navigate to="/" />
//   const handleSubmit = async (email, password) => {
//     const result = await signIn(email, password)
//     if (result.ok) navigate(...)
//   }
//
// USO TÍPICO en componentes post-sesión:
//
//   const { user, folvyClaims } = useAuth()
//   if (folvyClaims?.is_platform_admin) return <AdminBanner/>
//
// DEUDA B-8 (heredada de usePermissions.ts):
//   AppContext.isAdmin sigue siendo `!!adminEmail`. Sprint 3 (Shell) unificará
//   la fuente de verdad usando folvy.is_platform_admin del JWT como autoridad
//   única. Mientras tanto, este hook expone AMBAS: isAuthenticated (del
//   AppContext) y isPlatformAdmin (de folvy claims). En la práctica deberían
//   coincidir, pero usar folvy.is_platform_admin es la forma correcta moving
//   forward.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { supabase } from '../../../lib/supabase'
import * as authService from '../../../services/authService'

// ────────────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────────────

/**
 * Claims `folvy.*` emitidos por el `custom_access_token_hook` (Postgres
 * Function, Sprint 2 A1). Estructura espejo de la JWT real.
 *
 * Si el hook no se ejecutó (improbable: solo si está desactivado en panel),
 * `folvyClaims` será null. El frontend debe tratarlo defensivamente.
 */
export interface FolvyClaims {
  is_platform_admin: boolean
  platform_admin_role: string | null
  current_account_id: string | null
  current_account_slug: string | null
  current_account_role: string | null
  active_accounts: Array<{
    id: string
    slug: string
    role: string
    profile_id: string
  }>
  permission_set_id: string | null
  impersonating: boolean
  real_user_id: string | null
  session_max_age: number
}

/**
 * Sumario del usuario autenticado. Subset minimalista del User de Supabase
 * (solo id + email). Si necesitas más campos (created_at, app_metadata...)
 * usa supabase.auth.getUser() directamente desde tu componente.
 */
export interface AuthUser {
  id: string
  email: string | null
}

export interface UseAuthResult {
  // ─── Estado de sesión ──────────────────────────────────────────────
  /** Usuario autenticado actual. null si no hay sesión. */
  user: AuthUser | null
  /** True si hay sesión Supabase activa. Atajo de `user !== null`. */
  isAuthenticated: boolean
  /**
   * True cuando AppContext ha resuelto el estado inicial de auth
   * (`supabase.auth.getSession()` completó). false mientras carga.
   * Usar para evitar flicker en pantallas auth (login, welcome).
   */
  isAuthResolved: boolean

  // ─── Claims folvy.* del JWT ────────────────────────────────────────
  /**
   * Claims inyectados por `custom_access_token_hook`. null si no hay
   * sesión o si el hook no se ejecutó (caso defensivo improbable).
   */
  folvyClaims: FolvyClaims | null

  // ─── Atajos derivados de folvyClaims ───────────────────────────────
  /** Atajo de `folvyClaims?.is_platform_admin === true`. */
  isPlatformAdmin: boolean
  /** Atajo de `folvyClaims?.platform_admin_role`. null si no es admin. */
  platformAdminRole: string | null
  /** Atajo de `folvyClaims?.impersonating === true`. */
  isImpersonating: boolean

  // ─── Operaciones auth ──────────────────────────────────────────────
  /**
   * Login con email + password. Devuelve `ok: true` con user si éxito.
   * Tras login OK, el frontend (típicamente /login) debe invocar
   * Edge Function `check-account-status` para resolver el redirect.
   */
  signIn: (
    email: string,
    password: string
  ) => Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }>

  /** Cierra sesión Supabase. Limpia tokens locales. */
  signOut: () => Promise<{ ok: true } | { ok: false; error: string }>
}

// ────────────────────────────────────────────────────────────────────────
// Helper interno: decodificar payload JWT
// ────────────────────────────────────────────────────────────────────────

/**
 * Decodifica el payload (claims) de un JWT sin validar firma.
 *
 * La validación de firma la hace Supabase Auth Gateway server-side antes
 * de aceptar el token. Desde el cliente solo necesitamos leer claims,
 * no validar (decodificar es seguro: el JWT ya está en localStorage tras
 * un login exitoso).
 *
 * Devuelve null si:
 *   - jwt es null o vacío.
 *   - JWT mal formado (no tiene 3 partes).
 *   - Payload no es JSON parseable.
 *   - Payload no tiene la propiedad `folvy`.
 */
function decodeFolvyClaims(jwt: string | null | undefined): FolvyClaims | null {
  if (!jwt) return null

  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null

    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payloadJson = atob(payloadB64)
    const payload = JSON.parse(payloadJson) as Record<string, unknown>

    const folvy = payload.folvy
    if (!folvy || typeof folvy !== 'object') return null

    // Cast defensivo: el hook garantiza la estructura, pero por si acaso.
    return folvy as unknown as FolvyClaims
  } catch (e) {
    console.warn('[useAuth] decodeFolvyClaims failed:', e)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────

export function useAuth(): UseAuthResult {
  const { authUserId, adminEmail, authResolved } = useApp()

  // El access_token JWT vive en supabase.auth.getSession(). NO lo expone
  // AppContext porque hasta ahora no era necesario. Lo obtenemos aquí.
  //
  // getSession() es síncrono respecto a red: lee de localStorage. No hace
  // queries. Su coste es despreciable.
  //
  // Lo guardamos en state local que se actualiza cuando authUserId cambia
  // (lo que ocurre tras login, logout, o refresh token).
  const [accessToken, setAccessToken] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!authUserId) {
      // No hay sesión activa → no hay JWT.
      setAccessToken(null)
      return
    }

    if (!supabase) {
      setAccessToken(null)
      return
    }

    // Hay user → leer access_token actual.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setAccessToken(data.session?.access_token ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [authUserId])

  // Decodificar claims folvy.* del JWT actual.
  // useMemo evita parsear el JWT en cada render.
  const folvyClaims = useMemo(
    () => decodeFolvyClaims(accessToken),
    [accessToken]
  )

  // Sumario del user para consumers que no necesitan el User completo.
  const user = useMemo<AuthUser | null>(() => {
    if (!authUserId) return null
    return { id: authUserId, email: adminEmail }
  }, [authUserId, adminEmail])

  // ─── Operaciones auth ────────────────────────────────────────────────

  const signIn: UseAuthResult['signIn'] = async (email, password) => {
    const result = await authService.signInWithPassword(email, password)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    // Tras login OK, refrescamos accessToken local para que folvyClaims
    // se recalcule inmediatamente (sin esperar a que AppContext propague).
    if (supabase) {
      const { data } = await supabase.auth.getSession()
      setAccessToken(data.session?.access_token ?? null)
    }
    return {
      ok: true,
      user: { id: result.user.id, email: result.user.email ?? null },
    }
  }

  const signOut: UseAuthResult['signOut'] = async () => {
    const result = await authService.signOut()
    if (result.ok) {
      // AppContext detectará el cambio via onAuthStateChange y limpiará
      // authUserId/adminEmail. Aquí solo limpiamos nuestro state local.
      setAccessToken(null)
    }
    return result
  }

  return {
    user,
    isAuthenticated: authUserId !== null,
    isAuthResolved: authResolved,
    folvyClaims,
    isPlatformAdmin: folvyClaims?.is_platform_admin === true,
    platformAdminRole: folvyClaims?.platform_admin_role ?? null,
    isImpersonating: folvyClaims?.impersonating === true,
    signIn,
    signOut,
  }
}
