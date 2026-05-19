// src/services/authService.ts
// Servicio centralizado de autenticación con Supabase Auth.
// Wrapper puro: signInWithPassword, magic link (deprecado), reset password,
// welcome (verifyOtp invite + updateUser), getCurrentUser, signOut,
// onAuthStateChange, logSecurityEvent.
//
// Historial:
//   Bloque F-básico (17/05/2026): retirados `getCurrentProfile()`,
//     `UserProfileRow` y `rowToProfile()`.
//
//   Bloque F-completo (17/05/2026): retirados los tipos `UserRole` y
//     `UserProfile` (sustituidos por `UserProfileRole` y `UserProfile` del
//     módulo multitenancy, `src/types/multitenancy.ts`). También retirados
//     los helpers `hasRole`, `isAdmin`, `isManagerOrAdmin`, `isWorker`
//     (inline en los callers o sustituidos por `usePermissions()`).
//
//   Sprint 2 Bloque B2 (19/05/2026): añadidas funciones para flow
//     email+password con PKCE (D-S2.1). Mantiene `sendMagicLink` como
//     deprecated (D-S2.2) hasta Sprint 3.
//
// Decisiones aplicadas:
//   D-S2.1  flowType pkce (en supabase.ts).
//   D-S2.2  sendMagicLink marcado @deprecated, no se borra hasta Sprint 3.
//   D-S2.5  emailRedirectTo se construye desde import.meta.env.VITE_APP_URL
//           con fallback a window.location.origin. NUNCA hardcoded.
//   Regla 4 logSecurityEvent NO se sobrescribe. Firma posicional intacta:
//           (action, details?, targetUserId?).
//
// Este archivo queda como **wrapper puro de Supabase Auth**.
// NO incluye: lógica de redirect post-login (vive en /login),
// hooks de React (Bloque C), gestión de current_account_id en
// localStorage (D-S2.4, vive en useAccount).

import { supabase } from '../lib/supabase'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Tipos helper para el insert tipado de security_audit_log
type SecurityAuditLogInsert = Database['public']['Tables']['security_audit_log']['Insert']
type Json = Database['public']['Tables']['security_audit_log']['Row']['details']

/* =====================================================
   HELPER INTERNO — Base URL para emailRedirectTo
   ===================================================== */

/**
 * Resuelve la base URL usada en los `emailRedirectTo` de los flows auth
 * (welcome, reset password, magic link deprecated).
 *
 * Prioridad:
 *   1. `import.meta.env.VITE_APP_URL` (configurado en .env / Vercel).
 *   2. `window.location.origin` (fallback navegador).
 *   3. Cadena vacía (último recurso, en SSR sin env var).
 *
 * D-S2.5: la base URL NUNCA va hardcoded. Esto permite que dev (localhost),
 * staging (app.folvy.app) y producción (app.folvy.app) usen su propia URL
 * sin cambiar código.
 *
 * Devuelve la URL SIN trailing slash para que los callers puedan concatenar
 * paths limpios (`base + '/welcome'` en lugar de `base + 'welcome'`).
 */
function getRedirectBaseUrl(): string {
  const envUrl = import.meta.env.VITE_APP_URL as string | undefined
  if (envUrl) return envUrl.replace(/\/+$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

/* =====================================================
   AUTENTICACIÓN — Login email+password (Sprint 2)
   ===================================================== */

/**
 * Login con email + password (flow principal Folvy V1).
 *
 * Si el login es exitoso, Supabase Auth invoca `custom_access_token_hook`
 * (Postgres Function) que enriquece el JWT con claims `folvy.*`.
 *
 * Tras esta llamada, el frontend debe invocar `check-account-status`
 * (Edge Function) para resolver el redirect post-login según el estado
 * real de las cuentas del user. Esa orquestación NO vive aquí.
 *
 * @param email - email del usuario
 * @param password - password en claro (Supabase lo hashea server-side con bcrypt)
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    // Errores comunes: 'Invalid login credentials', 'Email not confirmed',
    // 'Too many requests' (rate limit), 'User not found'.
    console.error('[auth] signInWithPassword:', error)
    return { ok: false, error: error.message }
  }

  if (!data.user) {
    return { ok: false, error: 'Login sin user retornado' }
  }

  return { ok: true, user: data.user }
}

/* =====================================================
   AUTENTICACIÓN — Reset password (Sprint 2)
   ===================================================== */

/**
 * Inicia el flow de reset password.
 *
 * Supabase envía un email al usuario con un link tipo:
 *   {emailRedirectTo}?code=XXX&type=recovery
 *
 * Al hacer click, el cliente PKCE intercambia el code por sesión activa
 * (`detectSessionInUrl: true` en supabase.ts). Después la pantalla
 * `/reset-password/confirm` invoca `updateUserPassword()` para setear
 * la nueva password.
 *
 * Por seguridad, esta función SIEMPRE devuelve `ok: true` (incluso si el
 * email no existe), evitando que un atacante enumere users válidos.
 * El frontend muestra siempre el mismo mensaje neutro.
 *
 * @param email - email del usuario
 */
export async function resetPasswordForEmail(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const redirectUrl = `${getRedirectBaseUrl()}/reset-password/confirm`

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl,
  })

  if (error) {
    // Loggeamos internamente pero NO exponemos el error al usuario.
    // El frontend devolverá siempre mensaje neutro al user para no
    // permitir enumeración de cuentas (CWE-203).
    console.warn('[auth] resetPasswordForEmail (silenciado al user):', error)
    // Aun así, en frontend tratamos el ok:false como caso técnico
    // (ej: Supabase caído). Si el email no existe, Supabase devuelve ok.
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

/**
 * Actualiza la password del usuario actualmente autenticado.
 *
 * Usado por:
 *   - Pantalla `/reset-password/confirm` tras click en email de reset.
 *   - Pantalla `/welcome` tras `verifyOtpInvite` exitoso.
 *
 * Requiere sesión activa (el caller debe haber pasado por verifyOtpInvite
 * o resetPasswordForEmail+detectSessionInUrl antes).
 *
 * Supabase valida la password contra el policy configurado en el panel
 * (D-S2.14: min 8 chars, Lowercase+Uppercase+Digits, leaked passwords ON).
 *
 * @param newPassword - nueva password en claro
 */
export async function updateUserPassword(
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    // Errores comunes: 'Password should be at least 8 characters',
    // 'Password should contain lowercase, uppercase and numbers',
    // 'Password is leaked' (HaveIBeenPwned), 'Auth session missing!'.
    console.error('[auth] updateUserPassword:', error)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

/* =====================================================
   AUTENTICACIÓN — Welcome (Sprint 2)
   ===================================================== */

/**
 * Verifica el token de invitación enviado al user en el email de welcome.
 *
 * Flow welcome completo (2 pasos):
 *   1. Admin crea cuenta + user_profile inactivo + envía invite email
 *      (Supabase `inviteUserByEmail` desde panel admin o Edge Function).
 *   2. User hace click en email → llega a `/welcome?token=XXX&email=YYY`.
 *   3. Pantalla `/welcome` llama a `verifyOtpInvite(email, token)` ← AQUÍ.
 *      Si OK, hay sesión activa.
 *   4. Pantalla `/welcome` pide al user que rellene password + acepte T&C.
 *   5. Pantalla `/welcome` llama a `updateUserPassword(password)` + UPDATE
 *      user_profiles.terms_accepted_at + welcome_completed_at.
 *
 * Token de invite caduca a los 7 días (D-S2.13, pendiente verificar setting
 * Supabase para tokens de invite vs recovery por separado).
 *
 * @param email - email del usuario invitado (debe coincidir con el del token)
 * @param token - token OTP del email de invite
 */
export async function verifyOtpInvite(
  email: string,
  token: string
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'invite',
  })

  if (error) {
    // Errores comunes: 'Token has expired or is invalid',
    // 'Email link is invalid or has expired'.
    console.error('[auth] verifyOtpInvite:', error)
    return { ok: false, error: error.message }
  }

  if (!data.user) {
    return { ok: false, error: 'Token verificado pero sin user retornado' }
  }

  return { ok: true, user: data.user }
}

/* =====================================================
   AUTENTICACIÓN — Magic Link (DEPRECATED, Sprint 3 elimination)
   ===================================================== */

/**
 * @deprecated D-S2.2: Folvy V1 usa email+password como flow auth principal
 *   (`signInWithPassword`). Esta función queda como compatibilidad mientras
 *   no se verifiquen 0 callers en el repo. Eliminación física en Sprint 3
 *   junto con la migración de cualquier pantalla legacy que aún la use.
 *
 * Envía un Magic Link al email del usuario.
 * El usuario recibe un email con un enlace; al pulsarlo se inicia sesión.
 *
 * @param email - email del usuario
 * @param shouldCreateUser - si true, crea cuenta nueva si no existe.
 *   Default false (solo permite login a cuentas ya creadas).
 */
export async function sendMagicLink(
  email: string,
  shouldCreateUser = false
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  // D-S2.5: base URL desde env, NO hardcoded ni desde window.location.pathname
  // (eso era patrón Foodint legacy en GitHub Pages).
  const redirectUrl = getRedirectBaseUrl() || '/'

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

/* =====================================================
   SESIÓN — Getters
   ===================================================== */

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
 *
 * Regla 4 del proyecto: NO sobrescribir esta función.
 * Firma posicional consolidada: (action, details?, targetUserId?).
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
//
// Sprint 2 Bloque C (próximo): se introducen hooks `useAuth`, `useAccount`,
// `useMembership`, `usePermission` que reemplazarán completamente cualquier
// uso residual de helpers de permisos en este archivo.
