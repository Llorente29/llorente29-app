// src/services/calendarAutoGen.ts
// Auto-generación de planes semanales: respeta weeklySchedule de cada empleado
// y rellena libras + turnos según patrones simples.
//
// REGLAS CRÍTICAS:
// 1. NUNCA asigna LIBRE automáticamente en V/S/D (alta demanda).
// 2. En V/S/D si el empleado tiene weeklySchedule inactivo, asignar T2 por defecto
//    (cubre franja 14:45-00:15, garantiza presencia 20:00-cierre).

import type { Employee } from '../types'
import type { ShiftType, ShiftAssignment } from './calendarService'

export type AutoGenMode = 'todo' | 'solo_libras' | 'solo_vacios'

const DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const

interface AutoGenInput {
  employees: Employee[]
  shiftTypes: ShiftType[]
  days: string[]
  existingAssignments: ShiftAssignment[]
  mode: AutoGenMode
}

interface AutoGenOutput {
  toUpsert: { employeeId: string; date: string; shiftTypeId: string }[]
  unchanged: number
  conflicts: number
}

function findShiftTypeForHours(start: string, end: string, types: ShiftType[]): ShiftType | null {
  const exact = types.find(t => !t.isOff && t.startTime === start && t.endTime === end)
  if (exact) return exact

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

export function autoGenerate(input: AutoGenInput): AutoGenOutput {
  const { employees, shiftTypes, days, existingAssignments, mode } = input

  const libreType = shiftTypes.find(t => t.isOff)
  if (!libreType) {
    return { toUpsert: [], unchanged: 0, conflicts: 0 }
  }

  // Turno por defecto para V/S/D cuando el empleado tiene libra contractual:
  // T2 (14:45-00:15) — cubre la franja crítica 20:00-cierre.
  const defaultWeekendShift = shiftTypes.find(t => t.code === 'T2' && !t.isOff)

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

      // dayOfWeek: 0=domingo, 5=viernes, 6=sábado
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0

      let proposedTypeId: string | null = null

      if (!day.active) {
        // Día marcado como inactivo en weeklySchedule
        if (isWeekend) {
          // V/S/D: NO librar. Asignar T2 por defecto (cubre 20-cierre).
          if (defaultWeekendShift) {
            proposedTypeId = defaultWeekendShift.id
          } else {
            unchanged++
            continue
          }
        } else {
          // Lun-Jue: asignar LIBRE como hace el weeklySchedule
          proposedTypeId = libreType.id
        }
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
        if (proposedTypeId !== libreType.id) {
          unchanged++
          continue
        }
        if (hasExisting) {
          unchanged++
          continue
        }
      } else if (mode === 'solo_vacios') {
        if (hasExisting) {
          unchanged++
          continue
        }
      } else if (mode === 'todo') {
        if (hasExisting && existingAssign.shiftTypeId !== proposedTypeId) {
          conflicts++
        }
      }

      toUpsert.push({ employeeId: emp.id, date, shiftTypeId: proposedTypeId })
    }
  }

  return { toUpsert, unchanged, conflicts }
}
