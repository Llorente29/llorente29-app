// src/services/authService.ts
// Servicio centralizado de autenticación con Supabase Auth.
// Magic Link via email, gestión de sesión y perfil de usuario.

import { supabase } from '../lib/supabase'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

/* =====================================================
   TIPOS
   ===================================================== */

export type UserRole = 'admin' | 'manager' | 'worker'

export interface UserProfile {
  id: string
  userId: string
  employeeId?: string
  role: UserRole
  active: boolean
  displayName?: string
  createdAt: string
  updatedAt: string
}

interface UserProfileRow {
  id: string
  user_id: string
  employee_id: string | null
  role: string
  active: boolean
  display_name: string | null
  created_at: string
  updated_at: string
}

function rowToProfile(r: UserProfileRow): UserProfile {
  return {
    id: r.id,
    userId: r.user_id,
    employeeId: r.employee_id || undefined,
    role: r.role as UserRole,
    active: r.active,
    displayName: r.display_name || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

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
 * Obtiene el perfil (role, employee_id, etc.) del usuario actual.
 * Devuelve null si no hay sesión activa o no tiene profile creado.
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  if (!supabase) return null

  const user = await getCurrentUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  if (error) {
    console.error('[auth] getCurrentProfile:', error)
    return null
  }
  if (!data) return null
  return rowToProfile(data as UserProfileRow)
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
    await supabase.from('security_audit_log').insert({
      actor_user_id: actor?.id || null,
      target_user_id: targetUserId || null,
      action,
      details: details || null,
      ip_address: null,  // No tenemos acceso a IP desde frontend de forma fiable
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
  } catch (e) {
    // No bloquear flujo principal por errores de logging
    console.warn('[auth] logSecurityEvent failed:', e)
  }
}

/* =====================================================
   HELPERS DE PERMISOS
   ===================================================== */

/**
 * Comprueba si el rol del usuario tiene un permiso determinado.
 * Por ahora simple: jerárquico admin > manager > worker.
 */
export function hasRole(profile: UserProfile | null, requiredRole: UserRole): boolean {
  if (!profile || !profile.active) return false

  const hierarchy: Record<UserRole, number> = {
    worker: 1,
    manager: 2,
    admin: 3,
  }
  return hierarchy[profile.role] >= hierarchy[requiredRole]
}

/**
 * Comprueba si el usuario es admin.
 */
export function isAdmin(profile: UserProfile | null): boolean {
  return profile?.role === 'admin' && profile.active
}

/**
 * Comprueba si el usuario es manager o admin (perfil de "gestor").
 */
export function isManagerOrAdmin(profile: UserProfile | null): boolean {
  if (!profile || !profile.active) return false
  return profile.role === 'admin' || profile.role === 'manager'
}

/**
 * Comprueba si el usuario es worker.
 */
export function isWorker(profile: UserProfile | null): boolean {
  return profile?.role === 'worker' && profile.active === true
}
