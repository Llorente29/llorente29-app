// src/services/managerPermissionsService.ts
// Gestión de permisos individuales por manager.
// Cada manager tiene su propia fila en manager_permissions.

import { supabase } from '../lib/supabase'

export interface ManagerPermissions {
  user_profile_id: string
  show_dashboard: boolean
  show_staff: boolean
  show_ahora_mismo: boolean
  show_fichajes_global: boolean
  show_kiosko_fichaje: boolean
  show_solicitudes_pendientes: boolean
  show_turnos_abiertos: boolean
  show_cambios_pendientes: boolean
  show_calendario: boolean
  show_plantilla_turnos: boolean
  show_informes_personal: boolean
  show_bolsa_horas: boolean
  show_tasks: boolean
  show_scheduled: boolean
  show_templates: boolean
  show_incidents: boolean
  show_audits: boolean
  show_history: boolean
  show_tspoon: boolean
  show_ventas_analisis: boolean
  show_prediccion_personal: boolean
  show_zonas_pedido: boolean
  show_inventory: boolean
  show_locations: boolean
  show_tspoon_settings: boolean
  show_salaries: boolean
}

// Valores por defecto razonables. Coinciden con los DEFAULT de la tabla.
export const DEFAULT_PERMISSIONS: Omit<ManagerPermissions, 'user_profile_id'> = {
  show_dashboard: true,
  show_staff: true,
  show_ahora_mismo: true,
  show_fichajes_global: true,
  show_kiosko_fichaje: true,
  show_solicitudes_pendientes: true,
  show_turnos_abiertos: true,
  show_cambios_pendientes: true,
  show_calendario: true,
  show_plantilla_turnos: true,
  show_informes_personal: false,
  show_bolsa_horas: true,
  show_tasks: true,
  show_scheduled: true,
  show_templates: false,
  show_incidents: true,
  show_audits: true,
  show_history: true,
  show_tspoon: true,
  show_ventas_analisis: true,
  show_prediccion_personal: true,
  show_zonas_pedido: false,
  show_inventory: true,
  show_locations: false,
  show_tspoon_settings: false,
  show_salaries: false,
}

/**
 * Obtiene los permisos de un manager.
 * Si no tiene fila, devuelve los defaults (no inserta).
 */
export async function getManagerPermissions(
  userProfileId: string
): Promise<ManagerPermissions> {
  if (!supabase) {
    return { user_profile_id: userProfileId, ...DEFAULT_PERMISSIONS }
  }
  const { data, error } = await supabase
    .from('manager_permissions')
    .select('*')
    .eq('user_profile_id', userProfileId)
    .maybeSingle()

  if (error) {
    console.error('[managerPerms] get:', error)
    return { user_profile_id: userProfileId, ...DEFAULT_PERMISSIONS }
  }
  if (!data) {
    return { user_profile_id: userProfileId, ...DEFAULT_PERMISSIONS }
  }
  return data as ManagerPermissions
}

/**
 * Guarda los permisos de un manager (upsert).
 * Solo accesible para admin (la UI lo controla).
 */
export async function saveManagerPermissions(
  permissions: ManagerPermissions
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  const { error } = await supabase
    .from('manager_permissions')
    .upsert({
      ...permissions,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_profile_id' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Restaurar permisos por defecto para un manager.
 */
export async function resetManagerPermissions(
  userProfileId: string
): Promise<{ ok: boolean; error?: string }> {
  return saveManagerPermissions({
    user_profile_id: userProfileId,
    ...DEFAULT_PERMISSIONS,
  })
}
