// src/services/authService.ts
// Servicio centralizado de autenticación con Supabase Auth.
// Magic Link via email, gestión de sesión.
//
// Bloque F-básico (17/05/2026): retirados `getCurrentProfile()`,
// `UserProfileRow` y `rowToProfile()`.
//
// Bloque F-completo (17/05/2026): retirados los tipos `UserRole` y
// `UserProfile` (sustituidos por `UserProfileRole` y `UserProfile` del
// módulo multitenancy, `src/types/multitenancy.ts`). También retirados
// los helpers `hasRole`, `isAdmin`, `isManagerOrAdmin`, `isWorker`
// (inline en los callers o sustituidos por `usePermissions()`).
//
// Este archivo queda como **wrapper puro de Supabase Auth**:
//   - sendMagicLink (login pasivo)
//   - getCurrentUser (envoltorio de auth.getUser)
//   - signOut
//   - onAuthStateChange (envoltorio de auth.onAuthStateChange)
//   - logSecurityEvent (audit log)

import { supabase } from '../lib/supabase'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Tipos helper para el insert tipado de security_audit_log
type SecurityAuditLogInsert = Database['public']['Tables']['security_audit_log']['Insert']
type Json = Database['public']['Tables']['security_audit_log']['Row']['details']

/* =====================================================
   AUTENTICACIÓN
   ===================================================== */

/**
 * Envía un Magic Link al email del usuario.
 * El usuario recibe un email con un enlace; al pulsarlo se inicia sesión automáticamente.
 *
 * @param email - email del usuario
 * @param shouldCreateUser - si true, crea cuenta nueva si no existe. Default false (solo permite login a cuentas ya creadas).
 */
export async function sendMagicLink(
  email: string,
  shouldCreateUser = false
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  // Construir URL de redirección desde window.location para que SIEMPRE
  // coincida con la URL real de la app (evita problemas con Site URL
  // mal configurado en el panel de Supabase).
  // Necesitamos: https://llorente29.github.io/llorente29-app/
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  // Normalizar: asegurarse de que termina con /
  const basePath = pathname.endsWith('/') ? pathname : pathname.replace(/\/[^/]*$/, '/')
  const redirectUrl = origin + basePath

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser,
      emailRedirectTo: redirectUrl,
    },
  })

  if (error) {
    console.error('[auth] sendMagicLink:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Obtiene el usuario actualmente logueado (si lo hay).
 */
export async function getCurrentUser(): Promise<User | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    // No es error grave si simplemente no hay sesión
    if (error.message !== 'Auth session missing!') {
      console.error('[auth] getCurrentUser:', error)
    }
    return null
  }
  return data.user || null
}

/**
 * Cierra sesión del usuario actual.
 * Limpia tokens locales y notifica a Supabase.
 */
export async function signOut(): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('[auth] signOut:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Suscribirse a cambios de estado de autenticación.
 * Se dispara cuando el usuario hace login, logout o se refresca el token.
 *
 * @returns función para cancelar la suscripción
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): () => void {
  if (!supabase) return () => {}

  const { data } = supabase.auth.onAuthStateChange(callback)
  return () => {
    data.subscription.unsubscribe()
  }
}

/* =====================================================
   AUDIT LOG
   ===================================================== */

/**
 * Registra una acción crítica de seguridad en el audit log.
 * Útil para login_success, role_changed, permission_denied, etc.
 */
export async function logSecurityEvent(
  action: string,
  details?: Record<string, unknown>,
  targetUserId?: string
): Promise<void> {
  if (!supabase) return

  const actor = await getCurrentUser()
  try {
    // FIX: tipado fuerte del insert. details se castea a Json (compatible con
    //      Record<string, unknown> en runtime, solo TS necesita el cast).
    const insertRow: SecurityAuditLogInsert = {
      actor_user_id: actor?.id || null,
      target_user_id: targetUserId || null,
      action,
      details: (details ?? null) as Json,
      ip_address: null,  // No tenemos acceso a IP desde frontend de forma fiable
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    }
    await supabase.from('security_audit_log').insert(insertRow)
  } catch (e) {
    // No bloquear flujo principal por errores de logging
    console.warn('[auth] logSecurityEvent failed:', e)
  }
}

/* =====================================================
   HELPERS DE PERMISOS
   ===================================================== */
//
// BLOQUE F-completo (17/05/2026): retirados `hasRole`, `isAdmin`,
// `isManagerOrAdmin` y `isWorker`. Operaban sobre el tipo `UserProfile`
// legacy de este archivo. Reemplazados por:
//   - `usePermissions().isFullAccess` (admin global o admin de cuenta).
//   - Inline `profile?.role === 'X' && profile.active` cuando hace falta.
// Solo había 2 callers (ambos en App.tsx, ya inlined).

