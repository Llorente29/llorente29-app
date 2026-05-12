// src/services/employeeAuthService.ts
// Servicio para gestionar empleados-con-cuenta vía Edge Function.
// Solo usable por admins (la Edge Function verifica el rol del caller).

import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

interface CreateEmployeeInput {
  name: string
  email: string
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
}

interface CreateEmployeeResult {
  ok: boolean
  employee?: Employee
  authUserId?: string
  magicLinkSent?: boolean
  error?: string
}

interface DeactivateResult {
  ok: boolean
  employeeId?: string
  error?: string
}

// URL de la Edge Function (la calcula Supabase automáticamente)
function getFunctionUrl(name: string): string | null {
  if (!supabase) return null
  // @ts-expect-error: acceso a internals para extraer la URL del cliente
  const url = supabase.supabaseUrl || (supabase as { url?: string }).url
  if (!url) return null
  return `${url}/functions/v1/${name}`
}

/**
 * Crea un empleado con cuenta de auth + envío automático de Magic Link.
 * Solo accesible por admins (la Edge Function lo valida).
 */
export async function createEmployeeWithAccount(
  data: CreateEmployeeInput,
  sendMagicLink = true,
): Promise<CreateEmployeeResult> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  // Obtener token del admin actual
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
        sendMagicLink,
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
      magicLinkSent: result.magicLinkSent,
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
 * Reactiva un empleado dado de baja.
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
 * ⚠️ ELIMINA PERMANENTEMENTE un empleado y todo su rastro.
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
