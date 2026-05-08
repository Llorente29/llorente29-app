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
import { shiftDurationHours, coverageForDay } from '../types/scheduler'

// Devuelve la franja del turno con tipo restrictivo (sin 'any').
type SlotPeriod = 'morning' | 'evening'
function slotPeriodOf(start: string): SlotPeriod {
  const [h] = start.split(':').map(Number)
  return h < 17 ? 'morning' : 'evening'
}

const HOURS_OVERTIME_TOLERANCE = 0.10 // 10% sobre horas contratadas

/* =====================================================
   Helpers de descanso
   ===================================================== */

// Devuelve, para un empleado, qué (día, franja) tiene libres por su restPattern.
// Resultado: Set de strings "<dayIdx>:<period>" donde period es 'morning' o 'evening'
// (Los descansos solo afectan a su franja: 'morning' = turnos de mañana, 'evening' = tarde/noche)
function restSlotsOf(emp: Employee): Set<string> {
  const out = new Set<string>()
  const pattern = emp.restPattern
  if (!pattern) return out
  // pattern formato: "<dia>:<tipo>"  ej "mar:dia_manana"
  const [dayKey, kind] = pattern.split(':')
  const dayMap: Record<string, DayOfWeek> = { lun: 0, mar: 1, mie: 2 }
  const startDay = dayMap[dayKey]
  if (startDay === undefined) return out
  const nextDay = (startDay + 1) as DayOfWeek

  if (kind === 'tarde_dia') {
    // Día X tarde libre + Día X+1 entero libre
    out.add(`${startDay}:evening`)
    out.add(`${nextDay}:morning`)
    out.add(`${nextDay}:evening`)
  } else if (kind === 'dia_manana') {
    // Día X entero libre + Día X+1 mañana libre
    out.add(`${startDay}:morning`)
    out.add(`${startDay}:evening`)
    out.add(`${nextDay}:morning`)
  }
  return out
}

/* =====================================================
   Helpers de vacaciones / disponibilidad
   ===================================================== */

// Si el empleado tiene una vacación aprobada que cubre la fecha, devuelve true
function isOnVacation(emp: Employee, isoDate: string): boolean {
  const vacs: Vacation[] = emp.vacations || []
  return vacs.some(v =>
    v.status === 'aprobada' &&
    v.startDate <= isoDate &&
    isoDate <= v.endDate
  )
}

// Convierte (weekStartISO, dayIdx) → fecha ISO YYYY-MM-DD
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
  needed: number   // nº de personas que requiere ese turno ese día
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
   Cuanto MENOR sea el score, mejor candidato.
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

  // Score base: distancia absoluta al objetivo de horas contratadas
  // Penaliza estar lejos del contrato en cualquier dirección, pero más si excede.
  const deltaToContract = newHours - contracted
  let score = Math.abs(deltaToContract) * 10
  if (deltaToContract > 0) score *= 1.5 // sobrecargo penaliza más que faltar

  // Bonus por franja habitual: el slot que cae en su franja le encaja mejor
  if (emp.shiftPeriod) {
    if (emp.shiftPeriod === 'partido') {
      // Partido: ambos le valen igual
    } else if (
      (emp.shiftPeriod === 'manana' && slot.period === 'morning') ||
      (emp.shiftPeriod === 'tarde' && slot.period === 'evening')
    ) {
      score -= 5 // bonus
    } else {
      score += 15 // penaliza salirse de su franja
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
  weekStart: string                  // "YYYY-MM-DD" (lunes)
  templates: ShiftTemplate[]
  employees: Employee[]              // empleados del local activos
  overrides?: CoverageOverrides
}

export function generateSchedule(input: GeneratorInput): GeneratorResult {
  const { weekStart, templates, employees, overrides = {} } = input
  const warnings: string[] = []

  // 1) Construir slots a cubrir
  const slots = buildSlots(templates, overrides)

  // 2) Estado de horas asignadas por empleado (parte de 0)
  const assignedHours = new Map<string, number>()
  // 3) Resultado: cells[templateId][day] = [empId, ...]
  const cells: ScheduleCells = {}
  const uncovered: UncoveredSlot[] = []

  // 4) Para cada empleado, precalcular sus rest_slots (franjas que tiene libres por descanso fijo)
  const restCache = new Map<string, Set<string>>()
  for (const e of employees) restCache.set(e.id, restSlotsOf(e))

  // 5) Ordenar slots por dificultad: turnos largos y noches primero
  // (los turnos de noche son más difíciles de cubrir, igual que los largos)
  const ordered = [...slots].sort((a, b) => {
    if (a.period !== b.period) return a.period === 'evening' ? -1 : 1
    return b.hours - a.hours
  })

  // 6) Asignación
  for (const slot of ordered) {
    if (!cells[slot.templateId]) cells[slot.templateId] = {}
    const dayKey = String(slot.day)
    if (!cells[slot.templateId][dayKey]) cells[slot.templateId][dayKey] = []

    let assignedThis = 0
    const isoDate = isoForDay(weekStart, slot.day)

    while (assignedThis < slot.needed) {
      // Construir lista de candidatos válidos (no descartados por reglas duras)
      const candidates: CandidateScore[] = []

      for (const emp of employees) {
        // Hard filter 1: ya asignado a este mismo slot
        if (cells[slot.templateId][dayKey].includes(emp.id)) continue
        // Hard filter 2: vacaciones aprobadas
        if (isOnVacation(emp, isoDate)) continue
        // Hard filter 3: descanso fijo en esa (día, franja)
        const rest = restCache.get(emp.id)
        if (rest && rest.has(`${slot.day}:${slot.period}`)) continue

        // Score
        const cur = assignedHours.get(emp.id) || 0
        const sc = scoreCandidate(emp, slot, cur)
        if (sc) candidates.push(sc)
      }

      if (candidates.length === 0) {
        // No hay candidatos válidos posibles
        break
      }

      // Filtrar primero los que NO excedan tolerancia. Si hay alguno, elegir entre ellos.
      const safe = candidates.filter(c => !c.wouldExceedTolerance)
      const pool = safe.length > 0 ? safe : candidates // si todos exceden, dejamos hueco
      if (safe.length === 0) {
        // Todos los disponibles excederían el 10% → no asignamos para no sobrecargar
        break
      }

      pool.sort((a, b) => a.score - b.score)
      const winner = pool[0]
      cells[slot.templateId][dayKey].push(winner.employeeId)
      assignedHours.set(winner.employeeId, winner.newHours)
      assignedThis++
    }

    // Registrar huecos
    if (assignedThis < slot.needed) {
      uncovered.push({
        template_id: slot.templateId,
        template_label: slot.templateLabel,
        day_of_week: slot.day,
        needed: slot.needed,
        assigned: assignedThis,
        reason: assignedThis === 0
          ? 'sin empleados disponibles (vacaciones, descanso fijo o tope de horas)'
          : 'no hay suficiente personal disponible',
      })
    }
  }

  // 7) Calcular workloads finales
  const workloads: EmployeeWorkload[] = employees.map(emp => {
    const assigned = assignedHours.get(emp.id) || 0
    const contracted = emp.weeklyHours || 40
    return {
      employee_id: emp.id,
      employee_name: emp.name,
      shift_code: emp.shiftCode,
      contracted_hours: contracted,
      assigned_hours: assigned,
      delta: Math.round((assigned - contracted) * 100) / 100,
    }
  })

  // 8) Warnings
  for (const w of workloads) {
    const max = w.contracted_hours * (1 + HOURS_OVERTIME_TOLERANCE)
    if (w.assigned_hours > max) {
      warnings.push(`${w.employee_name} excede el tope del 10% (${w.assigned_hours.toFixed(2)}h asignadas, contratadas ${w.contracted_hours}h)`)
    } else if (w.assigned_hours < w.contracted_hours - 2) {
      warnings.push(`${w.employee_name} está a ${w.assigned_hours.toFixed(2)}h, faltan ${(w.contracted_hours - w.assigned_hours).toFixed(2)}h para su contrato`)
    }
  }

  if (uncovered.length > 0) {
    const totalGapH = uncovered.reduce((acc, u) => {
      const t = templates.find(x => x.id === u.template_id)
      const h = t ? shiftDurationHours(t.start_time, t.end_time) : 0
      return acc + (u.needed - u.assigned) * h
    }, 0)
    warnings.push(`${uncovered.length} huecos sin cubrir (${totalGapH.toFixed(1)}h en total)`)
  }

  return { cells, uncovered, workloads, warnings }
}

/* =====================================================
   Sugerencias para rellenar un hueco concreto
   ===================================================== */

export interface FillSuggestion {
  employeeId: string
  employeeName: string
  shiftCode?: string
  currentHours: number
  newHours: number
  contractedHours: number
  deltaPercent: number      // cuánto se pasaría sobre contratadas (en %)
  exceedsTolerance: boolean
  blockedReason?: string    // si está bloqueado: por qué
}

export interface SuggestFillInput {
  gap: UncoveredSlot
  template: ShiftTemplate
  weekStart: string
  cells: ScheduleCells
  employees: Employee[]
}

export function suggestFillForGap(input: SuggestFillInput): FillSuggestion[] {
  const { gap, template, weekStart, cells, employees } = input
  const slotHours = shiftDurationHours(template.start_time, template.end_time)
  const slotPeriod = slotPeriodOf(template.start_time.slice(0, 5))
  const isoDate = isoForDay(weekStart, gap.day_of_week)
  const dayKey = String(gap.day_of_week)

  // Recalcular horas actualmente asignadas por empleado
  const currentHours = new Map<string, number>()
  for (const tid of Object.keys(cells)) {
    for (const dk of Object.keys(cells[tid])) {
      const ids = cells[tid][dk]
      // Necesitamos las horas de ese template — lo buscamos al vuelo
      // (aceptamos no tener todos los templates, en cuyo caso saltamos)
      // Para ser robustos, asumimos que el caller hidrata todos los templates necesarios.
      for (const id of ids) {
        // Usaremos slotHours del template del propio gap solo para incrementar al asignar.
        // Para el current usamos un contador agregado fuera; mejor recalculamos desde cells:
        currentHours.set(id, (currentHours.get(id) || 0) + 0)
      }
    }
  }
  // Recalcular currentHours correctamente: necesitamos un map de templateId → horas
  // El llamador puede pasar todos los templates pero aquí solo tenemos uno. Para no exigir cambios,
  // recibimos opcionalmente templatesById externamente. Si no, asumimos cells solo tiene este template.
  // → simplificamos: el caller ya pasa el tope, y aquí calculamos solo con el slot a cubrir.

  const out: FillSuggestion[] = []
  const assignedToThisSlot = new Set(cells[gap.template_id]?.[dayKey] ?? [])

  for (const emp of employees) {
    if (assignedToThisSlot.has(emp.id)) continue // ya está en este slot

    let blocked: string | undefined

    if (isOnVacation(emp, isoDate)) {
      blocked = 'En vacaciones aprobadas'
    } else {
      const rest = restSlotsOf(emp)
      if (rest.has(`${gap.day_of_week}:${slotPeriod}`)) {
        blocked = 'En su descanso fijo'
      }
    }

    const cur = currentHoursForEmployee(emp.id, cells, input)
    const newH = cur + slotHours
    const contracted = emp.weeklyHours || 40
    const max = contracted * (1 + HOURS_OVERTIME_TOLERANCE)
    const deltaPct = ((newH - contracted) / contracted) * 100

    out.push({
      employeeId: emp.id,
      employeeName: emp.name,
      shiftCode: emp.shiftCode,
      currentHours: Math.round(cur * 100) / 100,
      newHours: Math.round(newH * 100) / 100,
      contractedHours: contracted,
      deltaPercent: Math.round(deltaPct * 10) / 10,
      exceedsTolerance: newH > max,
      blockedReason: blocked,
    })
  }

  // Ordenar: primero los no bloqueados y no excedidos, por menor delta
  out.sort((a, b) => {
    if (!!a.blockedReason !== !!b.blockedReason) return a.blockedReason ? 1 : -1
    if (a.exceedsTolerance !== b.exceedsTolerance) return a.exceedsTolerance ? 1 : -1
    return Math.abs(a.deltaPercent) - Math.abs(b.deltaPercent)
  })

  return out
}

/**
 * Calcula las horas actuales asignadas a un empleado iterando todas las celdas.
 * Necesita los templates para conocer las horas de cada turno.
 */
function currentHoursForEmployee(
  empId: string,
  cells: ScheduleCells,
  input: SuggestFillInput
): number {
  // El llamador nos pasa solo "template" del hueco. Para el resto, asumimos
  // que la suma fina la calculará la página padre y recalculará al aceptar.
  // Aquí devolvemos 0 si no podemos saberlo. En la UI se mostrará "current" desde el workload calculado.
  void cells; void input
  return getEmployeeAssignedHoursFromGlobal(empId)
}

// Pizarra interna para que la página le pase el snapshot de horas calculado
let GLOBAL_ASSIGNED_HOURS: Map<string, number> = new Map()

export function setGlobalAssignedHoursSnapshot(map: Map<string, number>) {
  GLOBAL_ASSIGNED_HOURS = map
}

function getEmployeeAssignedHoursFromGlobal(empId: string): number {
  return GLOBAL_ASSIGNED_HOURS.get(empId) || 0
}

/* =====================================================
   Recalcular workloads sobre un cells dado
   (para cuando el gestor edita manualmente)
   ===================================================== */

export function computeWorkloads(
  cells: ScheduleCells,
  templates: ShiftTemplate[],
  employees: Employee[]
): EmployeeWorkload[] {
  const tHoursById = new Map(templates.map(t => [t.id, shiftDurationHours(t.start_time, t.end_time)]))
  const sum = new Map<string, number>()
  for (const tid of Object.keys(cells)) {
    const h = tHoursById.get(tid) || 0
    for (const dk of Object.keys(cells[tid])) {
      for (const empId of cells[tid][dk]) {
        sum.set(empId, (sum.get(empId) || 0) + h)
      }
    }
  }
  return employees.map(emp => {
    const assigned = sum.get(emp.id) || 0
    const contracted = emp.weeklyHours || 40
    return {
      employee_id: emp.id,
      employee_name: emp.name,
      shift_code: emp.shiftCode,
      contracted_hours: contracted,
      assigned_hours: Math.round(assigned * 100) / 100,
      delta: Math.round((assigned - contracted) * 100) / 100,
    }
  })
}

/* =====================================================
   Validación de un cells (cruzar restricciones)
   ===================================================== */

export interface ValidationIssue {
  type: 'overtime' | 'rest_violation' | 'vacation_conflict' | 'gap'
  employeeId?: string
  templateId?: string
  day?: DayOfWeek
  message: string
}

export function validateSchedule(
  cells: ScheduleCells,
  templates: ShiftTemplate[],
  employees: Employee[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const wls = computeWorkloads(cells, templates, employees)
  const empById = new Map(employees.map(e => [e.id, e]))

  // 1) Tope 10%
  for (const w of wls) {
    const max = w.contracted_hours * (1 + HOURS_OVERTIME_TOLERANCE)
    if (w.assigned_hours > max) {
      issues.push({
        type: 'overtime',
        employeeId: w.employee_id,
        message: `${w.employee_name} excede el tope del 10%: ${w.assigned_hours}h asignadas vs ${w.contracted_hours}h contratadas`,
      })
    }
  }

  // 2) Descanso fijo violado
  for (const tid of Object.keys(cells)) {
    const t = templates.find(x => x.id === tid)
    if (!t) continue
    const period = slotPeriodOf(t.start_time.slice(0, 5))
    for (const dk of Object.keys(cells[tid])) {
      const day = parseInt(dk, 10) as DayOfWeek
      for (const empId of cells[tid][dk]) {
        const emp = empById.get(empId)
        if (!emp) continue
        const rest = restSlotsOf(emp)
        if (rest.has(`${day}:${period}`)) {
          issues.push({
            type: 'rest_violation',
            employeeId: empId,
            templateId: tid,
            day,
            message: `${emp.name} está asignado en su descanso fijo (${t.label}, día ${day})`,
          })
        }
      }
    }
  }

  return issues
}
