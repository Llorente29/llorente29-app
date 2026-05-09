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
    if (!cells[ss.slot.templateId]) cells[ss.slot.templateId] = {}
    const dk = String(ss.slot.day)
    if (!cells[ss.slot.templateId][dk]) cells[ss.slot.templateId][dk] = []
  }

  const slotAssignedCount = (s: Slot) => {
    return (cells[s.templateId]?.[String(s.day)] || []).length
  }

  function tryAssignSlot(
    slotIdx: number,
    relax: { ignoreShiftPeriod: boolean; ignoreRest: boolean }
  ): boolean {
    const ss = slotStates[slotIdx]
    const slot = ss.slot
    const dayKey = String(slot.day)
    const isoDate = isoForDay(weekStart, slot.day)
    const currentAssigned = cells[slot.templateId][dayKey]

    if (slotAssignedCount(slot) >= slot.needed) return false

    const pasadaName = relax.ignoreRest
      ? 'PASADA 3 (rescate fuerte)'
      : relax.ignoreShiftPeriod
        ? 'PASADA 2 (rescate suave)'
        : 'PASADA 1 (normal)'

    const diagnostics: { empName: string; reason: string }[] = []

    const candidates: (CandidateScore & { violatesRest: boolean })[] = []
    const templateById = new Map(templates.map(t => [t.id, t]))
    for (const emp of employees) {
      const empName = `${emp.shiftCode || '?'} ${emp.name}`
      if (currentAssigned.includes(emp.id)) {
        diagnostics.push({ empName, reason: 'ya asignado a este slot' })
        continue
      }
      if (isOnVacation(emp, isoDate)) {
        diagnostics.push({ empName, reason: 'vacaciones aprobadas' })
        continue
      }
      let hasOverlap = false
      let overlapWith = ''
      for (const otherTid of Object.keys(cells)) {
        const otherIds = cells[otherTid]?.[dayKey] || []
        if (!otherIds.includes(emp.id)) continue
        const otherT = templateById.get(otherTid)
        if (!otherT) continue
        if (shiftsOverlap(
          slot.startTime, slot.endTime,
          otherT.start_time.slice(0, 5), otherT.end_time.slice(0, 5)
        )) {
          hasOverlap = true
          overlapWith = `${otherT.label} (${otherT.start_time.slice(0,5)}-${otherT.end_time.slice(0,5)})`
          break
        }
      }
      if (hasOverlap) {
        diagnostics.push({ empName, reason: `solape con ${overlapWith}` })
        continue
      }
      const rest = restCache.get(emp.id)
      const violatesRest = rest ? rest.has(`${slot.day}:${slot.period}`) : false
      if (violatesRest && !relax.ignoreRest) {
        diagnostics.push({ empName, reason: `descanso fijo (${slot.period === 'morning' ? 'mañana' : 'tarde'} de ${dayLabel(slot.day)})` })
        continue
      }

      const cur = assignedHours.get(emp.id) || 0
      const sc = scoreCandidate(emp, slot, cur)
      if (!sc) continue

      if (!relax.ignoreShiftPeriod) {
        if (
          emp.shiftPeriod &&
          emp.shiftPeriod !== 'partido' &&
          ((emp.shiftPeriod === 'manana' && slot.period !== 'morning') ||
            (emp.shiftPeriod === 'tarde' && slot.period !== 'evening'))
        ) {
          diagnostics.push({ empName, reason: `franja habitual=${emp.shiftPeriod} no encaja con turno ${slot.period === 'morning' ? 'mañana' : 'tarde'}` })
          continue
        }
      }

      if (sc.wouldExceedTolerance) {
        diagnostics.push({ empName, reason: `excede tope 10% (pasaría a ${sc.newHours.toFixed(2)}h, contratadas ${emp.weeklyHours || 40}h)` })
      }

      candidates.push({ ...sc, violatesRest })
    }

    if (candidates.length === 0) {
      logSlotFailure(slot, pasadaName, diagnostics)
      return false
    }

    const safe = candidates.filter(c => !c.wouldExceedTolerance)
    if (safe.length === 0) {
      logSlotFailure(slot, pasadaName, diagnostics)
      return false
    }

    let winner: (typeof safe)[number]
    if (relax.ignoreShiftPeriod || relax.ignoreRest) {
      safe.sort((a, b) => {
        const empA = employees.find(e => e.id === a.employeeId)!
        const empB = employees.find(e => e.id === b.employeeId)!
        const cA = empA.weeklyHours || 40
        const cB = empB.weeklyHours || 40
        const ratioA = a.newHours / cA
        const ratioB = b.newHours / cB
        if (a.violatesRest !== b.violatesRest) return a.violatesRest ? 1 : -1
        return ratioA - ratioB
      })
      winner = safe[0]
    } else {
      safe.sort((a, b) => a.score - b.score)
      winner = safe[0]
    }

    cells[slot.templateId][dayKey].push(winner.employeeId)
    assignedHours.set(winner.employeeId, winner.newHours)
    if (winner.violatesRest) {
      const emp = employees.find(e => e.id === winner.employeeId)
      warnings.push(
        `⚠️ ${emp?.name || winner.employeeId} asignado en su descanso fijo (${slot.templateLabel}, ${dayLabel(slot.day)})`
      )
    }
    return true
  }

  function logSlotFailure(
    slot: Slot,
    pasada: string,
    diagnostics: { empName: string; reason: string }[]
  ) {
    if (diagnostics.length === 0) return
    console.groupCollapsed(
      `❌ [scheduler] ${pasada} — Hueco en ${slot.templateLabel} ${dayLabel(slot.day)} (${slot.startTime}-${slot.endTime}, ${slot.hours}h)`
    )
    for (const d of diagnostics) {
      console.log(`  ${d.empName} → ${d.reason}`)
    }
    console.groupEnd()
  }

  // ─── PASADA 1 ───
  console.log('▶️ Pasada 1: normal (respeta franja + descanso)')
  for (let i = 0; i < slotStates.length; i++) {
    while (slotAssignedCount(slotStates[i].slot) < slotStates[i].needed) {
      const ok = tryAssignSlot(i, { ignoreShiftPeriod: false, ignoreRest: false })
      if (!ok) break
    }
  }

  // ─── PASADA 2 ───
  console.log('▶️ Pasada 2: rescate suave (ignora franja habitual)')
  for (let i = 0; i < slotStates.length; i++) {
    while (slotAssignedCount(slotStates[i].slot) < slotStates[i].needed) {
      const ok = tryAssignSlot(i, { ignoreShiftPeriod: true, ignoreRest: false })
      if (!ok) break
    }
  }

  // ─── PASADA 3 ───
  console.log('▶️ Pasada 3: rescate fuerte (ignora descanso fijo)')
  for (let i = 0; i < slotStates.length; i++) {
    while (slotAssignedCount(slotStates[i].slot) < slotStates[i].needed) {
      const ok = tryAssignSlot(i, { ignoreShiftPeriod: true, ignoreRest: true })
      if (!ok) break
    }
  }

  for (const ss of slotStates) {
    const assignedFinal = slotAssignedCount(ss.slot)
    if (assignedFinal < ss.needed) {
      uncovered.push({
        template_id: ss.slot.templateId,
        template_label: ss.slot.templateLabel,
        day_of_week: ss.slot.day,
        needed: ss.needed,
        assigned: assignedFinal,
        reason: 'todos los empleados al tope del 10% o en vacaciones',
      })
    }
  }

  console.log(`✅ Asignación terminada. Huecos: ${uncovered.length}`)
  for (const emp of employees) {
    const h = assignedHours.get(emp.id) || 0
    const c = emp.weeklyHours || 40
    console.log(`  ${emp.shiftCode || '?'} ${emp.name}: ${h.toFixed(2)}h / ${c}h (${(h - c >= 0 ? '+' : '')}${(h - c).toFixed(2)}h)`)
  }
  console.groupEnd()

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
  deltaPercent: number
  exceedsTolerance: boolean
  blockedReason?: string
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

  const out: FillSuggestion[] = []
  const assignedToThisSlot = new Set(cells[gap.template_id]?.[dayKey] ?? [])

  for (const emp of employees) {
    if (assignedToThisSlot.has(emp.id)) continue

    let blocked: string | undefined

    if (isOnVacation(emp, isoDate)) {
      blocked = 'En vacaciones aprobadas'
    } else {
      const rest = restSlotsOf(emp)
      if (rest.has(`${gap.day_of_week}:${slotPeriod}`)) {
        blocked = 'En su descanso fijo'
      }
    }

    const cur = getEmployeeAssignedHoursFromGlobal(emp.id)
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

  out.sort((a, b) => {
    if (!!a.blockedReason !== !!b.blockedReason) return a.blockedReason ? 1 : -1
    if (a.exceedsTolerance !== b.exceedsTolerance) return a.exceedsTolerance ? 1 : -1
    return Math.abs(a.deltaPercent) - Math.abs(b.deltaPercent)
  })

  return out
}

let GLOBAL_ASSIGNED_HOURS: Map<string, number> = new Map()

export function setGlobalAssignedHoursSnapshot(map: Map<string, number>) {
  GLOBAL_ASSIGNED_HOURS = map
}

function getEmployeeAssignedHoursFromGlobal(empId: string): number {
  return GLOBAL_ASSIGNED_HOURS.get(empId) || 0
}

/* =====================================================
   Recalcular workloads sobre un cells dado
   (con merge de intervalos para no contar solapes)
   ===================================================== */

export function computeWorkloads(
  cells: ScheduleCells,
  templates: ShiftTemplate[],
  employees: Employee[]
): EmployeeWorkload[] {
  const templateById = new Map(templates.map(t => [t.id, t]))

  const intervalsByEmpDay = new Map<string, { from: number; to: number }[]>()
  for (const tid of Object.keys(cells)) {
    const t = templateById.get(tid)
    if (!t) continue
    const startStr = t.start_time.slice(0, 5)
    const endStr = t.end_time.slice(0, 5)
    const interval = shiftIntervalAbs(startStr, endStr)
    for (const dk of Object.keys(cells[tid])) {
      for (const empId of cells[tid][dk]) {
        const key = `${empId}:${dk}`
        if (!intervalsByEmpDay.has(key)) intervalsByEmpDay.set(key, [])
        intervalsByEmpDay.get(key)!.push({ ...interval })
      }
    }
  }

  const sum = new Map<string, number>()
  for (const [key, list] of intervalsByEmpDay.entries()) {
    const empId = key.split(':')[0]
    list.sort((a, b) => a.from - b.from)
    let totalMin = 0
    let curFrom = list[0].from
    let curTo = list[0].to
    for (let i = 1; i < list.length; i++) {
      const it = list[i]
      if (it.from <= curTo) {
        curTo = Math.max(curTo, it.to)
      } else {
        totalMin += curTo - curFrom
        curFrom = it.from
        curTo = it.to
      }
    }
    totalMin += curTo - curFrom
    sum.set(empId, (sum.get(empId) || 0) + totalMin / 60)
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
  type: 'overtime' | 'rest_violation' | 'vacation_conflict' | 'gap' | 'overlap'
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

  // Solape temporal entre turnos del mismo empleado el mismo día
  const byEmpDay = new Map<string, { tid: string; start: string; end: string; label: string }[]>()
  for (const tid of Object.keys(cells)) {
    const t = templates.find(x => x.id === tid)
    if (!t) continue
    for (const dk of Object.keys(cells[tid])) {
      for (const empId of cells[tid][dk]) {
        const key = `${empId}:${dk}`
        if (!byEmpDay.has(key)) byEmpDay.set(key, [])
        byEmpDay.get(key)!.push({
          tid,
          start: t.start_time.slice(0, 5),
          end: t.end_time.slice(0, 5),
          label: t.label,
        })
      }
    }
  }
  for (const [key, list] of byEmpDay.entries()) {
    if (list.length < 2) continue
    const [empId, dk] = key.split(':')
    const day = parseInt(dk, 10) as DayOfWeek
    const emp = empById.get(empId)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (shiftsOverlap(list[i].start, list[i].end, list[j].start, list[j].end)) {
          issues.push({
            type: 'overlap',
            employeeId: empId,
            day,
            message: `${emp?.name || empId} tiene dos turnos solapados el ${dayLabel(day)}: ${list[i].label} (${list[i].start}-${list[i].end}) y ${list[j].label} (${list[j].start}-${list[j].end})`,
          })
        }
      }
    }
  }

  return issues
}
