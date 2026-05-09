// src/services/scheduleGenerator.ts
// Sub-fase 3.2 — algoritmo de generación de horarios automático.
//
// Modelo de 3 capas:
//   1. Plantilla del local (shift_templates) → qué turnos abre y cobertura base
//   2. Configuración del empleado → horas, código, franja, patrón de descanso
//   3. Ajustes semanales (coverage_overrides en el Schedule) → cambios puntuales
//
// El generador respeta este orden de prioridad al asignar:
//   1. Vacaciones aprobadas (excluye)
//   2. Patrón de descanso fijo (excluye sus franjas libres)
//   3. Franja habitual (prefiere)
//   4. Distancia respecto a horas contratadas (penaliza)
//   5. Tope 10% sobre horas contratadas (frena)

import type { Employee, Vacation } from '../types'
import type {
  ShiftTemplate,
  DayOfWeek,
  ScheduleCells,
  CoverageOverrides,
  UncoveredSlot,
  EmployeeWorkload,
  GeneratorResult,
} from '../types/scheduler'
import { shiftDurationHours, coverageForDay, DAY_LABELS } from '../types/scheduler'

// Helper de etiqueta de día por índice (0=Lun..6=Dom)
function dayLabel(d: DayOfWeek): string {
  return DAY_LABELS[d]
}

/* =====================================================
   Helper de solape temporal entre dos turnos
   Considera cruce de medianoche.
   ===================================================== */
function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function shiftIntervalAbs(start: string, end: string): { from: number; to: number } {
  const s = timeToMin(start)
  let e = timeToMin(end)
  if (e <= s) e += 24 * 60
  return { from: s, to: e }
}

function shiftsOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const a = shiftIntervalAbs(start1, end1)
  const b = shiftIntervalAbs(start2, end2)
  return a.from < b.to && b.from < a.to
}

const HOURS_OVERTIME_TOLERANCE = 0.10 // 10% sobre horas contratadas

// Helper local de franja del turno (tipo restrictivo, sin 'any')
type SlotPeriod = 'morning' | 'evening'
function slotPeriodOf(start: string): SlotPeriod {
  const [h] = start.split(':').map(Number)
  return h < 17 ? 'morning' : 'evening'
}

/* =====================================================
   Helpers de descanso
   ===================================================== */

function restSlotsOf(emp: Employee): Set<string> {
  const out = new Set<string>()
  const pattern = emp.restPattern
  if (!pattern) return out
  const [dayKey, kind] = pattern.split(':')
  const dayMap: Record<string, DayOfWeek> = { lun: 0, mar: 1, mie: 2 }
  const startDay = dayMap[dayKey]
  if (startDay === undefined) return out
  const nextDay = (startDay + 1) as DayOfWeek

  if (kind === 'tarde_dia') {
    out.add(`${startDay}:evening`)
    out.add(`${nextDay}:morning`)
    out.add(`${nextDay}:evening`)
  } else if (kind === 'dia_manana') {
    out.add(`${startDay}:morning`)
    out.add(`${startDay}:evening`)
    out.add(`${nextDay}:morning`)
  }
  return out
}

/* =====================================================
   Helpers de vacaciones / disponibilidad
   ===================================================== */

function isOnVacation(emp: Employee, isoDate: string): boolean {
  const vacs: Vacation[] = emp.vacations || []
  return vacs.some(v =>
    v.status === 'aprobada' &&
    v.startDate <= isoDate &&
    isoDate <= v.endDate
  )
}

function isoForDay(weekStartISO: string, dayIdx: DayOfWeek): string {
  const [y, m, d] = weekStartISO.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + dayIdx)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/* =====================================================
   Estructura de slot a cubrir
   ===================================================== */

interface Slot {
  templateId: string
  templateLabel: string
  day: DayOfWeek
  startTime: string
  endTime: string
  hours: number
  period: 'morning' | 'evening'
  needed: number
}

function buildSlots(
  templates: ShiftTemplate[],
  overrides: CoverageOverrides
): Slot[] {
  const slots: Slot[] = []
  for (const t of templates) {
    for (let d = 0 as DayOfWeek; d <= 6; d = (d + 1) as DayOfWeek) {
      const baseCoverage = coverageForDay(t, d)
      const override = overrides[t.id]?.[String(d)]
      const needed = override !== undefined ? override : baseCoverage
      if (needed > 0) {
        slots.push({
          templateId: t.id,
          templateLabel: t.label,
          day: d,
          startTime: t.start_time.slice(0, 5),
          endTime: t.end_time.slice(0, 5),
          hours: shiftDurationHours(t.start_time, t.end_time),
          period: slotPeriodOf(t.start_time.slice(0, 5)),
          needed,
        })
      }
      if (d === 6) break
    }
  }
  return slots
}

/* =====================================================
   Score de un candidato para un slot
   ===================================================== */

interface CandidateScore {
  employeeId: string
  score: number
  wouldExceedTolerance: boolean
  newHours: number
}

function scoreCandidate(
  emp: Employee,
  slot: Slot,
  currentAssignedHours: number
): CandidateScore | null {
  const newHours = currentAssignedHours + slot.hours
  const contracted = emp.weeklyHours || 40
  const maxAllowed = contracted * (1 + HOURS_OVERTIME_TOLERANCE)
  const wouldExceedTolerance = newHours > maxAllowed

  const deltaToContract = newHours - contracted
  let score = Math.abs(deltaToContract) * 10
  if (deltaToContract > 0) score *= 1.5

  if (emp.shiftPeriod) {
    if (emp.shiftPeriod === 'partido') {
      // ambos le valen igual
    } else if (
      (emp.shiftPeriod === 'manana' && slot.period === 'morning') ||
      (emp.shiftPeriod === 'tarde' && slot.period === 'evening')
    ) {
      score -= 5
    } else {
      score += 15
    }
  }

  return {
    employeeId: emp.id,
    score,
    wouldExceedTolerance,
    newHours,
  }
}

/* =====================================================
   Generador principal
   ===================================================== */

export interface GeneratorInput {
  locationId: string
  weekStart: string
  templates: ShiftTemplate[]
  employees: Employee[]
  overrides?: CoverageOverrides
}

export function generateSchedule(input: GeneratorInput): GeneratorResult {
  const { weekStart, templates, employees, overrides = {} } = input
  const warnings: string[] = []

  console.group(`🪄 [scheduler] generateSchedule — semana del ${weekStart}`)
  console.log(`  Empleados: ${employees.length}`, employees.map(e => `${e.shiftCode || '?'} ${e.name} (${e.weeklyHours || 40}h, ${e.shiftPeriod || 'sin franja'}, ${e.restPattern || 'sin descanso'})`))
  console.log(`  Turnos definidos: ${templates.length}`)

  const slots = buildSlots(templates, overrides)

  const assignedHours = new Map<string, number>()
  const cells: ScheduleCells = {}
  const uncovered: UncoveredSlot[] = []

  const restCache = new Map<string, Set<string>>()
  for (const e of employees) restCache.set(e.id, restSlotsOf(e))

  const ordered = [...slots].sort((a, b) => {
    if (a.period !== b.period) return a.period === 'evening' ? -1 : 1
    return b.hours - a.hours
  })

  // Asignación en 3 pasadas:
  //   Pasada 1 — normal (respeta franja habitual + descanso + tope)
  //   Pasada 2 — fuera de franja habitual (rescate suave)
  //   Pasada 3 — viola descanso fijo (rescate fuerte, con warning)

  interface SlotState {
    slot: Slot
    needed: number
  }
  const slotStates: SlotState[] = ordered.map(s => ({ slot: s, needed: s.needed }))

  for (const ss of slotStates) {
    if (!c
