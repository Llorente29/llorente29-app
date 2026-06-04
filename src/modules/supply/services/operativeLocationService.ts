// src/modules/supply/services/operativeLocationService.ts
//
// Resuelve el LOCAL OPERATIVO de un usuario para acciones de riesgo (recepción,
// inventario, conteo). NO es el activeLocationId del header (ese es de análisis y
// admite 'all'). Aquí el local SIEMPRE es concreto y seguro, derivado de:
//   1. Fichaje activo (cuando haya datos): clock_entries.location_id_at_clock
//      de la última entrada sin salida del empleado del usuario.
//   2. Local del empleado: user_profiles.employee_id → employees.location_id.
// Si nada resuelve, devuelve null → la UI decide (worker bloquea, gerente elige).
//
// Decisión rectora (registrada): el location_id operativo sale del CONTEXTO
// (fichaje/perfil/dispositivo), NUNCA de un selector que el trabajador toque.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

export interface ResolvedOperativeLocation {
  locationId: string | null
  source: 'fichaje' | 'perfil' | null
  /** Locales a los que el empleado está asignado (para el caso gerente multi-local). */
  assignedLocationIds: string[]
}

/**
 * Resuelve el local operativo del usuario en una cuenta.
 * @param _accountId cuenta activa (reservado para scope/RLS futuro)
 * @param employeeId user_profiles.employee_id (puede ser null para admin sin ficha)
 */
export async function resolveOperativeLocation(
  _accountId: string,
  employeeId: string | null,
): Promise<ResolvedOperativeLocation> {
  requireSupabase()
  if (!employeeId) {
    return { locationId: null, source: null, assignedLocationIds: [] }
  }

  // 1. Fichaje activo: última entrada sin salida posterior, con su local.
  //    clock_entries.type distingue entrada/salida; hoy no hay datos (gancho).
  let fichajeLocation: string | null = null
  try {
    const { data: clockRows } = await from('clock_entries')
      .select('location_id_at_clock, type, datetime')
      .eq('employee_id', employeeId)
      .order('datetime', { ascending: false })
      .limit(1)
    const last = ((clockRows as Row[] | null) ?? [])[0]
    // Solo cuenta como activo si la última marca es de entrada y tiene local.
    if (last && (last.type === 'in' || last.type === 'entrada' || last.type === 'clock_in')) {
      fichajeLocation = (last.location_id_at_clock as string | null) ?? null
    }
  } catch {
    // sin fichajes / tabla no accesible → se ignora y cae al perfil
  }

  // 2. Local del empleado + locales asignados.
  let employeeLocation: string | null = null
  let assigned: string[] = []
  try {
    const { data: emp } = await from('employees')
      .select('location_id, assigned_locations')
      .eq('id', employeeId)
      .maybeSingle()
    const e = (emp as Row | null) ?? null
    employeeLocation = (e?.location_id as string | null) ?? null
    const a = e?.assigned_locations
    if (Array.isArray(a)) assigned = a.filter((x): x is string => typeof x === 'string')
    if (employeeLocation && !assigned.includes(employeeLocation)) assigned = [employeeLocation, ...assigned]
  } catch {
    // sin ficha de empleado accesible
  }

  if (fichajeLocation) {
    return { locationId: fichajeLocation, source: 'fichaje', assignedLocationIds: assigned }
  }
  if (employeeLocation) {
    return { locationId: employeeLocation, source: 'perfil', assignedLocationIds: assigned }
  }
  return { locationId: null, source: null, assignedLocationIds: assigned }
}
