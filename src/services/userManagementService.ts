// src/services/userManagementService.ts
// Servicio de administración de usuarios.
// Lee/actualiza user_profiles, manager_locations.
// Solo accesible por admin (la app valida en UI; la BD aún no tiene RLS estricto).

import { supabase } from '../lib/supabase'
import type { UserRole } from './authService'

export interface UserListItem {
  id: string                  // user_profile.id
  userId: string              // auth.users.id
  employeeId?: string         // employees.id (si está vinculado)
  email: string               // auth.users.email
  displayName?: string
  role: UserRole
  active: boolean
  employeeName?: string       // nombre del empleado si está vinculado
  managedLocationIds: string[]  // locales que gestiona si es manager
  createdAt: string
}

/**
 * Lista todos los usuarios con cuenta + sus locales asignados (si manager).
 */
export async function listUsers(): Promise<UserListItem[]> {
  if (!supabase) return []

  // 1) Traer todos los user_profiles
  const { data: profiles, error: pErr } = await supabase
    .from('user_profiles')
    .select(`
      id,
      user_id,
      employee_id,
      role,
      active,
      display_name,
      created_at
    `)
    .order('created_at', { ascending: false })

  if (pErr) {
    console.error('[users] list:', pErr)
    return []
  }
  if (!profiles || profiles.length === 0) return []

  // 2) Traer emails de auth.users (mediante una RPC o JOIN propio)
  // Como no podemos hacer join directo a auth.users desde el client, usamos
  // un fetch separado pasando los user_ids.
  const userIds = profiles.map((p: { user_id: string }) => p.user_id)

  // 3) Traer empleados vinculados
  const employeeIds = profiles
    .map((p: { employee_id: string | null }) => p.employee_id)
    .filter((id): id is string => !!id)

  const { data: employees } = employeeIds.length > 0
    ? await supabase.from('employees').select('id, name, email').in('id', employeeIds)
    : { data: [] }

  // 4) Traer manager_locations
  const profileIds = profiles.map((p: { id: string }) => p.id)
  const { data: managerLocs } = await supabase
    .from('manager_locations')
    .select('user_profile_id, location_id')
    .in('user_profile_id', profileIds)

  // 5) Email de cada user_id - lo cogemos del email del empleado si existe,
  // y si no, devolvemos vacío (no podemos consultar auth.users desde el cliente).
  // En la Edge Function future podemos exponer este dato si hace falta.
  const emailByUserId = new Map<string, string>()
  for (const p of profiles) {
    if (p.employee_id) {
      const emp = (employees || []).find((e: { id: string; email: string }) => e.id === p.employee_id)
      if (emp?.email) emailByUserId.set(p.user_id, emp.email)
    }
  }

  // Para los que no tienen empleado vinculado (admins puros), email queda vacío
  // y se rellenará desde la Edge Function en futuro o se muestra "—"
  void userIds  // suprimir warning de variable no usada

  // 6) Combinar todo
  return profiles.map((p: {
    id: string
    user_id: string
    employee_id: string | null
    role: string
    active: boolean
    display_name: string | null
    created_at: string
  }) => {
    const employee = p.employee_id
      ? (employees || []).find((e: { id: string }) => e.id === p.employee_id)
      : null
    const managedLocs = (managerLocs || [])
      .filter((ml: { user_profile_id: string }) => ml.user_profile_id === p.id)
      .map((ml: { location_id: string }) => ml.location_id)

    return {
      id: p.id,
      userId: p.user_id,
      employeeId: p.employee_id || undefined,
      email: emailByUserId.get(p.user_id) || (employee as { email?: string } | null)?.email || '',
      displayName: p.display_name || undefined,
      role: p.role as UserRole,
      active: p.active,
      employeeName: (employee as { name?: string } | null)?.name,
      managedLocationIds: managedLocs,
      createdAt: p.created_at,
    }
  })
}

/**
 * Cambia el rol de un usuario.
 * No permite cambiar role de admins (incluido el propio).
 */
export async function changeUserRole(
  userProfileId: string,
  newRole: UserRole,
  currentRole: UserRole,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  // Salvaguarda: no cambiar role de admins
  if (currentRole === 'admin') {
    return { ok: false, error: 'No se puede cambiar el rol de un administrador. Otro admin debe hacerlo manualmente en la BD.' }
  }

  if (newRole === 'admin') {
    return { ok: false, error: 'Promover a admin requiere intervención manual por seguridad.' }
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ role: newRole })
    .eq('id', userProfileId)

  if (error) return { ok: false, error: error.message }

  // Si cambia a worker, limpiar manager_locations
  if (newRole === 'worker') {
    await supabase
      .from('manager_locations')
      .delete()
      .eq('user_profile_id', userProfileId)
  }

  return { ok: true }
}

/**
 * Actualiza los locales que gestiona un manager.
 * Reemplaza completamente la lista.
 */
export async function setManagerLocations(
  userProfileId: string,
  locationIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  // Borrar los actuales
  const { error: delErr } = await supabase
    .from('manager_locations')
    .delete()
    .eq('user_profile_id', userProfileId)

  if (delErr) return { ok: false, error: delErr.message }

  // Insertar los nuevos
  if (locationIds.length > 0) {
    const rows = locationIds.map(loc => ({
      user_profile_id: userProfileId,
      location_id: loc,
    }))
    const { error: insErr } = await supabase
      .from('manager_locations')
      .insert(rows)
    if (insErr) return { ok: false, error: insErr.message }
  }

  return { ok: true }
}

/**
 * Activa o desactiva un usuario (su acceso a la app).
 * No se puede desactivar a uno mismo.
 */
export async function setUserActive(
  userProfileId: string,
  active: boolean,
  currentRole: UserRole,
  isOwnUser: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase no disponible' }

  if (isOwnUser) {
    return { ok: false, error: 'No puedes desactivarte a ti mismo' }
  }

  if (currentRole === 'admin' && !active) {
    return { ok: false, error: 'No se puede desactivar un administrador desde aquí' }
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ active })
    .eq('id', userProfileId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
