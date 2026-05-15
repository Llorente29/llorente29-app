// src/modules/appcc/services/assignmentService.ts
// Motor de asignación de checklists APPCC.
// Prioridad: responsable fijo (appcc_schedule_responsibles) → empleado fichado → sin asignar.

import { supabase } from '@/lib/supabase'

/**
 * Determina a quién asignar un checklist APPCC.
 * 
 * Prioridad:
 * 1. Responsable fijo (tabla appcc_schedule_responsibles, role='primary')
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
      .eq('role', 'primary')
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
 */
export async function getClockedInEmployees(locationId: string): Promise<string[]> {
  if (!supabase) return []

  // Obtener empleados asignados a este local que estén activos
  const { data: employees } = await supabase
    .from('employees')
    .select('id, clock_entries')
    .eq('active', true)

  if (!employees || employees.length === 0) return []

  const result: string[] = []

  for (const emp of employees) {
    // Verificar si está asignado a este local
    const entries: Array<{
      type: string
      datetime: string
      locationIdAtClock?: string
    }> = emp.clock_entries || []

    if (entries.length === 0) continue

    // Filtrar fichajes de hoy en este local
    const today = new Date().toISOString().slice(0, 10)
    const todayEntries = entries
      .filter(e => {
        const entryDate = e.datetime?.slice(0, 10)
        return entryDate === today && e.locationIdAtClock === locationId
      })
      .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())

    // Si el último fichaje de hoy es 'entrada', está fichado
    if (todayEntries.length > 0 && todayEntries[0].type === 'entrada') {
      result.push(emp.id)
    }
  }

  return result
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
