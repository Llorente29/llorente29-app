// src/services/employeeAuthService.ts
// Servicio para gestionar empleados-con-cuenta vía Edge Function `manage-employee`.
// Solo usable por admins (la Edge Function verifica el rol del caller server-side).
//
// MODELO C1 (sesión 25/05/2026): el alta crea el acceso del trabajador con
// USUARIO + CONTRASEÑA prefijada (el manager las elige). NO hay email real de
// login ni magic link: la Edge Function genera internamente un email sintético
// {username}@empleado.folvy.app. El `email` aquí es OPCIONAL e informativo
// (notificaciones futuras vía account-email), nunca la llave de acceso.

import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

export interface CreateEmployeeInput {
  name: string
  username: string // C1: identidad de login (sin @). Requerido.
  password: string // C1: contraseña prefijada elegida por el manager. Requerido.
  email?: string // OPCIONAL e informativo. NO es la llave de acceso.
  dni?: string
  phone?: string
  position?: string
  department?: string
  contractType?: string
  locationId?: string
  assignedLocations?: string[]
  weeklyHours?: number
  salary?: number
  startDate?: string
  endDate?: string
  pin?: string
  birthDate?: string
  trialPeriodDays?: number
  role?: 'worker' | 'manager' // C1: rol del user_profile. Por defecto el server lo pone a 'worker'. NUNCA admin desde el alta.
}

export interface CreateEmployeeResult {
  ok: boolean
  employee?: Employee
  authUserId?: string
  /** Username canónico devuelto por el server (puede diferir del tecleado tras
   *  normalización). El caller (StaffPage) lo muestra al manager para entregarlo. */
  username?: string
  error?: string
}

interface DeactivateResult {
  ok: boolean
  employeeId?: string
  error?: string
}

// URL de la Edge Function. Patrón limpio: lee VITE_SUPABASE_URL del entorno
// (coherente con accountEmailService / platformEmailService). Antes accedía a
// internals del cliente Supabase con @ts-expect-error; saldada esa deuda menor.
function getFunctionUrl(name: string): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!base) return null
  return `${base.replace(/\/$/, '')}/functions/v1/${name}`
}

/**
 * Crea un empleado con cuenta de acceso (modelo C1: usuario + contraseña).
 * Solo accesible por admins (la Edge Function lo valida server-side).
 *
 * @param data  Datos del empleado. `username` y `password` son requeridos; el
 *              server normaliza el username y devuelve el canónico.
 */
export async function createEmployeeWithAccount(
  data: CreateEmployeeInput,
): Promise<CreateEmployeeResult> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'create',
        employee: data,
      }),
    })

    const result = await response.json()

    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }

    return {
      ok: true,
      employee: result.employee,
      authUserId: result.authUserId,
      username: result.username,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

/**
 * Desactiva un empleado y su cuenta de acceso.
 * El empleado y el user_profile quedan con active=false.
 */
export async function deactivateEmployeeAccount(
  employeeId: string,
): Promise<DeactivateResult> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'deactivate',
        employeeId,
      }),
    })

    const result = await response.json()
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }
    return { ok: true, employeeId: result.employeeId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

/**
 * Reactiva un empleado dado de baja. En C1 NO reenvía credenciales: el
 * trabajador sigue accediendo con su usuario + contraseña existentes.
 */
export async function reactivateEmployeeAccount(
  employeeId: string,
): Promise<DeactivateResult> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'reactivate',
        employeeId,
      }),
    })

    const result = await response.json()
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }
    return { ok: true, employeeId: result.employeeId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

/**
 * Regenera la contraseña de un trabajador C1.
 * El username no cambia (la identidad de login es estable); solo se sobrescribe
 * la password del auth.user asociado vía service_role.
 *
 * @param password  Nueva contraseña (mínimo 6 caracteres; el server re-valida).
 */
export async function setEmployeePassword(
  employeeId: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'set_password',
        employeeId,
        password,
      }),
    })

    const result = await response.json()
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

/**
 * Da acceso a la app a un employee que YA existe (alta sin acceso → con acceso,
 * o ascenso de trabajador-kiosko a worker/manager con credenciales).
 *
 * El server valida cross-tenant, unicidad del username, estado del employee
 * (rechaza con 409 si ya tiene acceso) y aplica la lista blanca de rol.
 *
 * @returns username canónico que devolvió el server (puede diferir del enviado
 *          tras normalización) y el rol efectivamente creado (puede caer a
 *          'worker' si el server descartó el valor enviado por la lista blanca).
 */
export async function grantEmployeeAccess(
  employeeId: string,
  username: string,
  password: string,
  role: 'worker' | 'manager',
): Promise<{ ok: boolean; username?: string; role?: 'worker' | 'manager'; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'grant_access',
        employeeId,
        username,
        password,
        role,
      }),
    })

    const result = await response.json()
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }
    return { ok: true, username: result.username, role: result.role }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

/**
 * ⚠️  ELIMINA PERMANENTEMENTE un empleado y todo su rastro.
 * - Borra employees + manager_locations + manager_permissions + user_profile + auth.user
 * - Es IRREVERSIBLE
 * - La UI debe confirmar 2 veces antes de llamar a esta función
 */
export async function deletePermanentEmployee(
  employeeId: string,
): Promise<DeactivateResult> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'delete_permanent',
        employeeId,
      }),
    })

    const result = await response.json()
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }
    return { ok: true, employeeId: result.employeeId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

/**
 * Genera un enlace mágico de acceso para un empleado-con-cuenta (modelo C1).
 *
 * NO envía correo: la Edge Function llama a admin.generateLink y DEVUELVE el
 * enlace. El caller (StaffPage) lo convierte en QR / copiar-enlace para
 * entregarlo por el canal que quiera (WhatsApp, SMS, en mano, email manual).
 * El trabajador, al abrirlo, queda con sesión iniciada SIN teclear nada.
 *
 * El enlace es de un solo uso y caduca según la config de Auth de Supabase
 * (OTP expiry). Reenviar acceso = volver a llamar esta función (el anterior
 * queda invalidado al generarse uno nuevo o al expirar).
 *
 * Solo admins (la Edge Function valida el rol y la pertenencia cross-tenant).
 *
 * @param employeeId  Empleado destino. Debe tener acceso (username no nulo) y
 *                     pertenecer a la cuenta del admin que invoca.
 * @param redirectTo  Opcional. URL de aterrizaje tras verificar el enlace; debe
 *                     estar en la allowlist de Redirect URLs de Supabase Auth.
 *                     Sin él, Supabase redirige al SITE_URL por defecto.
 */
export async function generateAccessLink(
  employeeId: string,
  redirectTo?: string,
): Promise<{ ok: boolean; tokenHash?: string; type?: string; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No hay sesión activa' }

  const url = getFunctionUrl('manage-employee')
  if (!url) return { ok: false, error: 'No se ha podido determinar la URL de la función' }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'generate_access_link',
        employeeId,
        ...(redirectTo ? { redirectTo } : {}),
      }),
    })

    const result = await response.json()
    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${response.status}` }
    }
    return { ok: true, tokenHash: result.tokenHash, type: result.type }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}
