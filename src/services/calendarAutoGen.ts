// src/services/calendarAutoGen.ts
// Auto-generación de planes semanales: respeta weeklySchedule de cada empleado
// y rellena libras + turnos según patrones simples.

import type { Employee } from '../types'
import type { ShiftType, ShiftAssignment } from './calendarService'

export type AutoGenMode = 'todo' | 'solo_libras' | 'solo_vacios'

const DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const

interface AutoGenInput {
  employees: Employee[]              // empleados activos del local
  shiftTypes: ShiftType[]            // tipos disponibles
  days: string[]                     // 7 fechas YYYY-MM-DD (lunes-domingo)
  existingAssignments: ShiftAssignment[]  // las que ya hay
  mode: AutoGenMode
}

interface AutoGenOutput {
  toUpsert: { employeeId: string; date: string; shiftTypeId: string }[]
  unchanged: number
  conflicts: number
}

/**
 * Devuelve el código de turno típico de unas horas concretas.
 * Si no encuentra match exacto, devuelve null.
 */
function findShiftTypeForHours(start: string, end: string, types: ShiftType[]): ShiftType | null {
  // Match exacto
  const exact = types.find(t => !t.isOff && t.startTime === start && t.endTime === end)
  if (exact) return exact

  // Aproximación: misma hora de inicio (±15 min)
  const startMin = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  }
  const target = startMin(start)
  const candidate = types
    .filter(t => !t.isOff && t.startTime)
    .map(t => ({ t, diff: Math.abs(startMin(t.startTime!) - target) }))
    .sort((a, b) => a.diff - b.diff)[0]

  if (candidate && candidate.diff <= 15) return candidate.t
  return null
}

/**
 * Genera el plan automáticamente siguiendo el weeklySchedule de cada empleado.
 *
 * Reglas:
 * - Si el día está marcado como "active = false" en weeklySchedule → asignar LIBRE
 * - Si el día está marcado como "active = true" con start/end → buscar shiftType que coincida
 * - Si no hay weeklySchedule, deja el día vacío (no asigna nada)
 *
 * El parámetro `mode` controla qué celdas se tocan:
 * - 'todo': sobreescribe TODAS las celdas (incluso las ya asignadas)
 * - 'solo_libras': solo asigna LIBREs en días que weeklySchedule marca como inactivos. No toca turnos.
 * - 'solo_vacios': asigna en celdas vacías. No toca las que ya tienen turno.
 */
export function autoGenerate(input: AutoGenInput): AutoGenOutput {
  const { employees, shiftTypes, days, existingAssignments, mode } = input

  const libreType = shiftTypes.find(t => t.isOff)
  if (!libreType) {
    return { toUpsert: [], unchanged: 0, conflicts: 0 }
  }

  // Index de asignaciones existentes
  const existing = new Map<string, ShiftAssignment>()
  for (const a of existingAssignments) {
    existing.set(`${a.employeeId}|${a.date}`, a)
  }

  const toUpsert: { employeeId: string; date: string; shiftTypeId: string }[] = []
  let unchanged = 0
  let conflicts = 0

  for (const emp of employees) {
    const ws = emp.weeklySchedule
    if (!ws) continue

    for (const date of days) {
      const dayOfWeek = new Date(date + 'T00:00:00').getDay()
      const dayKey = DAY_KEYS[dayOfWeek]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = (ws as any)[dayKey] as { active: boolean; start: string; end: string } | undefined
      if (!day) continue

      const existingAssign = existing.get(`${emp.id}|${date}`)
      const hasExisting = !!existingAssign?.shiftTypeId

      // Decidir qué turno proponer según weeklySchedule
      let proposedTypeId: string | null = null

      if (!day.active) {
        proposedTypeId = libreType.id
      } else if (day.start && day.end) {
        const matchType = findShiftTypeForHours(day.start, day.end, shiftTypes)
        if (matchType) proposedTypeId = matchType.id
      }

      if (!proposedTypeId) {
        unchanged++
        continue
      }

      // Aplicar según modo
      if (mode === 'solo_libras') {
        // Solo asignar si la propuesta es LIBRE
        if (proposedTypeId !== libreType.id) {
          unchanged++
          continue
        }
        if (hasExisting) {
          // No tocar lo asignado en modo solo libras
          unchanged++
          continue
        }
      } else if (mode === 'solo_vacios') {
        if (hasExisting) {
          unchanged++
          continue
        }
      } else if (mode === 'todo') {
        // Si hay algo asignado distinto a la propuesta, contamos como conflicto pero igual sobrescribimos
        if (hasExisting && existingAssign.shiftTypeId !== proposedTypeId) {
          conflicts++
        }
      }

      toUpsert.push({ employeeId: emp.id, date, shiftTypeId: proposedTypeId })
    }
  }

  return { toUpsert, unchanged, conflicts }
}
