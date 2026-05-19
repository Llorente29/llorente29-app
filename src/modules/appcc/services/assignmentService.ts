// src/modules/appcc/services/assignmentService.ts
// Motor de asignación de checklists APPCC.
// Prioridad: responsable fijo (appcc_schedule_responsibles) → empleado fichado → sin asignar.
//
// HISTORIAL DE FIXES (mayo 2026):
//
// 1. La columna era `is_primary` (boolean), no `role` (string). La query
//    `.eq('role', 'primary')` siempre devolvía 0 filas. Antes del fix, esta
//    función NUNCA encontraba responsables primarios.
//
// 2. El embed `select('id, clock_entries')` no funcionaba porque Supabase
//    no resolvía la relación inversa automáticamente. Se cambió a dos queries
//    separadas: empleados activos primero, luego sus fichajes del día.
//    Esto es más eficiente porque no trae el histórico de cada empleado.

import { supabase } from '@/lib/supabase'

/**
 * Determina a quién asignar un checklist APPCC.
 *
 * Prioridad:
 * 1. Responsable fijo (tabla appcc_schedule_responsibles, is_primary=true)
 * 2. Empleado fichado en ese local en este momento (jornada abierta)
 * 3. null (sin asignar — cualquiera puede hacerlo)
 *
 * @param scheduleId ID del schedule (para buscar responsable fijo)
 * @param locationId ID del local (para buscar empleados fichados)
 * @returns employee_id del asignado, o null si no hay nadie
 */
export async function resolveAssignment(
  scheduleId: string | null,
  locationId: string,
): Promise<string | null> {
  if (!supabase) return null

  // 1. Buscar responsable fijo (primary) para este schedule
  if (scheduleId) {
    const { data: responsibles } = await supabase
      .from('appcc_schedule_responsibles')
      .select('user_id')
      .eq('schedule_id', scheduleId)
      .eq('is_primary', true)
      .limit(1)

    if (responsibles && responsibles.length > 0) {
      // Resolver user_id → employee_id via user_profiles
      const userId = responsibles[0].user_id
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('employee_id')
        .eq('user_id', userId)
        .maybeSingle()

      if (profile?.employee_id) {
        return profile.employee_id
      }
    }
  }

  // 2. Buscar empleado fichado en este local (jornada abierta)
  const clockedIn = await getClockedInEmployees(locationId)
  if (clockedIn.length > 0) {
    // Si hay varios fichados, devolver el primero (el que fichó primero hoy)
    return clockedIn[0]
  }

  // 3. Sin asignar
  return null
}

/**
 * Devuelve los IDs de empleados que tienen jornada abierta en un local.
 * "Jornada abierta" = su último clock_entry para hoy en ese local es tipo 'entrada'.
 *
 * Estrategia (refactor mayo 2026):
 *   1. Una query a `clock_entries` filtrada por hoy + local concreto.
 *      Ordenada por employee_id ASC, datetime DESC (último fichaje primero).
 *   2. En memoria: agrupar por employee_id y quedarse con el último fichaje.
 *      Si es 'entrada', está fichado.
 *   3. Validar que esos empleados están activos.
 *
 * Más eficiente que la versión anterior (que traía todos los clock_entries
 * de cada empleado vía embed roto). Esta solo trae los fichajes de HOY de
 * ese local, que son pocas filas.
 */
export async function getClockedInEmployees(locationId: string): Promise<string[]> {
  if (!supabase) return []

  // Rango temporal: día actual completo en UTC.
  const today = new Date().toISOString().slice(0, 10)
  const dayStart = `${today}T00:00:00Z`
  const dayEnd = `${today}T23:59:59Z`

  // 1. Traer todos los fichajes de hoy en este local, ordenados por empleado
  //    y por timestamp descendente (más reciente primero).
  const { data: entries, error } = await supabase
    .from('clock_entries')
    .select('employee_id, type, datetime')
    .eq('location_id_at_clock', locationId)
    .gte('datetime', dayStart)
    .lte('datetime', dayEnd)
    .order('employee_id', { ascending: true })
    .order('datetime', { ascending: false })

  if (error) {
    console.error('[assignmentService] getClockedInEmployees clock_entries error', error)
    return []
  }
  if (!entries || entries.length === 0) return []

  // 2. Para cada empleado, ver si su PRIMER fichaje en la lista (el más
  //    reciente del día) es 'entrada'. Si lo es, está fichado.
  const lastEntryByEmployee = new Map<string, { type: string; datetime: string }>()
  for (const e of entries) {
    if (!e.employee_id) continue
    if (!lastEntryByEmployee.has(e.employee_id)) {
      lastEntryByEmployee.set(e.employee_id, {
        type: e.type,
        datetime: e.datetime,
      })
    }
  }

  const candidateIds: string[] = []
  for (const [employeeId, lastEntry] of lastEntryByEmployee) {
    if (lastEntry.type === 'entrada') {
      candidateIds.push(employeeId)
    }
  }

  if (candidateIds.length === 0) return []

  // 3. Validar que esos empleados están activos.
  const { data: activeEmployees, error: empErr } = await supabase
    .from('employees')
    .select('id')
    .eq('active', true)
    .in('id', candidateIds)

  if (empErr) {
    console.error('[assignmentService] getClockedInEmployees employees error', empErr)
    return []
  }

  // Devolver en el orden original (primero el que fichó primero hoy).
  // Para eso, ordenamos los candidatos por datetime ASC de su última entrada.
  const activeIds = new Set((activeEmployees ?? []).map(e => e.id))
  const orderedFiltered = Array.from(lastEntryByEmployee.entries())
    .filter(([id, entry]) => activeIds.has(id) && entry.type === 'entrada')
    .sort((a, b) => new Date(a[1].datetime).getTime() - new Date(b[1].datetime).getTime())
    .map(([id]) => id)

  return orderedFiltered
}

/**
 * Asigna un checklist a un empleado concreto.
 * Actualiza el campo assigned_to de la ejecución.
 */
export async function assignExecution(
  executionId: string,
  employeeId: string | null,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('appcc_executions')
    .update({ assigned_to: employeeId })
    .eq('id', executionId)

  if (error) {
    console.error('[assignmentService] assignExecution error', error)
    throw error
  }
}
