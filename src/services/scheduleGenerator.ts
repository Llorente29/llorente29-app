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
import type { LaborRequirementRow } from './teamLaborService'

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
   Helpers del generador dirigido por demanda (Fase B)
   ===================================================== */

const ANY_ROLE = '*'
const MAX_DAILY_HOURS = 9   // tope de jornada diaria (permite turno partido, no maratones)

// Horas [inicio, fin) que cubre un turno (0-23), con cruce de medianoche.
function templateHours(t: ShiftTemplate): number[] {
  const sh = Number(t.start_time.slice(0, 2))
  const eh0 = Number(t.end_time.slice(0, 2))
  const end = eh0 <= sh ? eh0 + 24 : eh0
  const out: number[] = []
  for (let x = sh; x < end; x++) out.push(x % 24)
  return out
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
  // Fase B — dirigido por demanda (nivel líder mundial):
  requirement?: LaborRequirementRow[]          // personal necesario por (dow, hora, rol)
  roleKindByEmployee?: Record<string, string>  // employee.id → role_kind (área)
  hourlyCost?: Record<string, number>          // employee.id → €/hora real (nóminas)
}

// Motor que CUBRE LA CURVA DE DEMANDA por rol al menor coste (Fase B / Opción 2).
// Para cada rol y hora mira cuánta gente falta y añade el (empleado, turno) que más
// hueco tapa por euro, respetando rol, disponibilidad, vacaciones, descanso, solapes
// y tope de horas. Sin curva de demanda cae a la cobertura clásica de la plantilla.
export function generateSchedule(input: GeneratorInput): GeneratorResult {
  const {
    weekStart, templates, employees, overrides = {},
    requirement = [], roleKindByEmployee = {}, hourlyCost = {},
  } = input

  const warnings: string[] = []
  const cells: ScheduleCells = {}
  const assignedHours = new Map<string, number>()
  const restCache = new Map<string, Set<string>>()
  for (const e of employees) restCache.set(e.id, restSlotsOf(e))
  const templateById = new Map(templates.map(t => [t.id, t]))

  const demandMode = requirement.length > 0

  // need[dow][hora][rol] = personas necesarias todavía sin cubrir.
  const need: Record<number, Record<number, Record<string, number>>> = {}
  const setNeed = (d: number, h: number, role: string, n: number) => {
    if (n <= 0) return
    if (!need[d]) need[d] = {}
    if (!need[d][h]) need[d][h] = {}
    need[d][h][role] = Math.max(need[d][h][role] || 0, n)
  }
  if (demandMode) {
    for (const r of requirement) {
      if (r.dow < 0 || r.dow > 6) continue
      setNeed(r.dow, r.hora, r.roleKind, r.required)
    }
  } else {
    for (const t of templates) {
      for (let d = 0 as DayOfWeek; d <= 6; d = (d + 1) as DayOfWeek) {
        const base = coverageForDay(t, d)
        const ov = overrides[t.id]?.[String(d)]
        const nn = ov !== undefined ? ov : base
        if (nn > 0) for (const h of templateHours(t)) setNeed(d, h, ANY_ROLE, nn)
        if (d === 6) break
      }
    }
  }

  const roleSet = new Set<string>()
  for (const ds of Object.keys(need)) for (const hs of Object.keys(need[Number(ds)])) for (const role of Object.keys(need[Number(ds)][Number(hs)])) roleSet.add(role)

  const remaining = (d: number, h: number, role: string) => need[d]?.[h]?.[role] || 0
  const shiftHours = (t: ShiftTemplate) => shiftDurationHours(t.start_time, t.end_time)

  function feasible(emp: Employee, t: ShiftTemplate, d: DayOfWeek, role: string): boolean {
    if (role !== ANY_ROLE) {
      const k = roleKindByEmployee[emp.id]
      if (k && k !== role) return false            // rol distinto → no; sin rol conocido → flexible
    }
    if (isOnVacation(emp, isoForDay(weekStart, d))) return false
    const rest = restCache.get(emp.id)
    if (rest && rest.has(`${d}:${slotPeriodOf(t.start_time.slice(0, 5))}`)) return false
    const dk = String(d)
    if ((cells[t.id]?.[dk] || []).includes(emp.id)) return false
    for (const otherTid of Object.keys(cells)) {
      if (!(cells[otherTid]?.[dk] || []).includes(emp.id)) continue
      const ot = templateById.get(otherTid)
      if (ot && shiftsOverlap(t.start_time.slice(0, 5), t.end_time.slice(0, 5), ot.start_time.slice(0, 5), ot.end_time.slice(0, 5))) return false
    }
    const cur = assignedHours.get(emp.id) || 0
    const contracted = emp.weeklyHours || 40
    if (cur + shiftHours(t) > contracted * (1 + HOURS_OVERTIME_TOLERANCE)) return false
    // Tope de jornada diaria (permite turno partido comida+cena, no maratones de 12-16 h).
    let dayHours = 0
    for (const tid of Object.keys(cells)) {
      if (!(cells[tid]?.[dk] || []).includes(emp.id)) continue
      const ot = templateById.get(tid); if (ot) dayHours += shiftDurationHours(ot.start_time, ot.end_time)
    }
    if (dayHours + shiftHours(t) > MAX_DAILY_HOURS) return false
    // Descanso de 12 h entre jornadas de días distintos.
    const startMin = timeToMin(t.start_time.slice(0, 5))
    let endMin = timeToMin(t.end_time.slice(0, 5)); if (endMin <= startMin) endMin += 1440
    const s = d * 1440 + startMin, e = d * 1440 + endMin
    for (const tid of Object.keys(cells)) {
      const dmap = cells[tid]; if (!dmap) continue
      for (const odk of Object.keys(dmap)) {
        if (Number(odk) === d) continue
        if (!(dmap[odk] || []).includes(emp.id)) continue
        const ot = templateById.get(tid); if (!ot) continue
        const osm = timeToMin(ot.start_time.slice(0, 5))
        let oem = timeToMin(ot.end_time.slice(0, 5)); if (oem <= osm) oem += 1440
        const os = Number(odk) * 1440 + osm, oe = Number(odk) * 1440 + oem
        const gap = s >= oe ? s - oe : (os >= e ? os - e : -1)
        if (gap >= 0 && gap < 720) return false
      }
    }
    return true
  }

  function marginalCoverage(t: ShiftTemplate, d: DayOfWeek, role: string): number {
    let cov = 0
    for (const h of templateHours(t)) if (remaining(d, h, role) > 0) cov++
    return cov
  }
  // Coste MARGINAL: las horas contratadas ya están pagadas (coste ~0); solo la hora EXTRA cuesta.
  // Así el motor LLENA los contratos antes de dejar hueco o pagar horas extra.
  function costOf(emp: Employee, t: ShiftTemplate): number {
    const cur = assignedHours.get(emp.id) || 0
    const contracted = emp.weeklyHours || 40
    const overtime = Math.max(0, (cur + shiftHours(t)) - contracted)
    const rate = hourlyCost[emp.id]
    return 0.01 * shiftHours(t) + overtime * (rate && rate > 0 ? rate : 12)
  }
  function assign(emp: Employee, t: ShiftTemplate, d: DayOfWeek, role: string) {
    if (!cells[t.id]) cells[t.id] = {}
    if (!cells[t.id][String(d)]) cells[t.id][String(d)] = []
    cells[t.id][String(d)].push(emp.id)
    assignedHours.set(emp.id, (assignedHours.get(emp.id) || 0) + shiftHours(t))
    for (const h of templateHours(t)) if ((need[d]?.[h]?.[role] || 0) > 0) need[d][h][role] -= 1
  }

  // GREEDY: mejor cobertura por euro, hasta cubrir la curva.
  const MAX_ITERS = 4000
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let best: { emp: Employee; t: ShiftTemplate; d: DayOfWeek; role: string; adj: number } | null = null
    for (const role of roleSet) {
      for (let d = 0 as DayOfWeek; d <= 6; d = (d + 1) as DayOfWeek) {
        for (const t of templates) {
          if (marginalCoverage(t, d, role) > 0) {
            const cov = marginalCoverage(t, d, role)
            for (const emp of employees) {
              if (!feasible(emp, t, d, role)) continue
              const score = cov / costOf(emp, t)
              const cur = assignedHours.get(emp.id) || 0
              const contracted = emp.weeklyHours || 40
              const fillRatio = contracted > 0 ? Math.min(1, cur / contracted) : 1
              const period = slotPeriodOf(t.start_time.slice(0, 5))
              const prefPeriod = emp.shiftPeriod && emp.shiftPeriod !== 'partido'
                ? (((emp.shiftPeriod === 'manana' && period === 'morning') || (emp.shiftPeriod === 'tarde' && period === 'evening')) ? 1 : 0)
                : 0.5
              // Reparte justo: quien va MÁS por debajo de su contrato tiene prioridad.
              const adj = score * (1 + 0.30 * (1 - fillRatio) + 0.05 * prefPeriod)
              if (!best || adj > best.adj) best = { emp, t, d, role, adj }
            }
          }
        }
        if (d === 6) break
      }
    }
    if (!best) break
    assign(best.emp, best.t, best.d, best.role)
  }

  // Override manual = SUELO por bloque (role-agnóstico): fuerza al menos N personas.
  for (const t of templates) {
    for (let d = 0 as DayOfWeek; d <= 6; d = (d + 1) as DayOfWeek) {
      const ov = overrides[t.id]?.[String(d)]
      if (ov !== undefined && ov > 0) {
        while ((cells[t.id]?.[String(d)] || []).length < ov) {
          let pick: Employee | null = null; let pickCost = Infinity
          for (const emp of employees) {
            if (!feasible(emp, t, d, ANY_ROLE)) continue
            const c = costOf(emp, t)
            if (c < pickCost) { pickCost = c; pick = emp }
          }
          if (!pick) break
          assign(pick, t, d, ANY_ROLE)
        }
      }
      if (d === 6) break
    }
  }

  // Huecos por (turno, día): pico de personas concurrentes que quedó sin cubrir.
  const uncovered: UncoveredSlot[] = []
  for (const t of templates) {
    for (let d = 0 as DayOfWeek; d <= 6; d = (d + 1) as DayOfWeek) {
      let peakRemaining = 0
      for (const h of templateHours(t)) {
        let s = 0
        for (const role of roleSet) s += remaining(d, h, role)
        if (s > peakRemaining) peakRemaining = s
      }
      const assigned = (cells[t.id]?.[String(d)] || []).length
      if (peakRemaining > 0) {
        uncovered.push({
          template_id: t.id,
          template_label: t.label,
          day_of_week: d,
          needed: assigned + peakRemaining,
          assigned,
          reason: 'demanda no cubierta con el personal disponible',
        })
      }
      if (d === 6) break
    }
  }

  const workloads: EmployeeWorkload[] = computeWorkloads(cells, templates, employees)

  for (const w of workloads) {
    const max = w.contracted_hours * (1 + HOURS_OVERTIME_TOLERANCE)
    if (w.assigned_hours > max) {
      warnings.push(`${w.employee_name} excede el tope del 10% (${w.assigned_hours.toFixed(1)}h asignadas, contratadas ${w.contracted_hours}h)`)
    } else if (w.assigned_hours > 0 && w.assigned_hours < w.contracted_hours - 2) {
      warnings.push(`${w.employee_name} está a ${w.assigned_hours.toFixed(1)}h, faltan ${(w.contracted_hours - w.assigned_hours).toFixed(1)}h para su contrato`)
    }
  }
  if (uncovered.length > 0) warnings.push(`${uncovered.length} franja(s) con demanda sin cubrir`)

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
  type: 'overtime' | 'rest_violation' | 'rest_12h' | 'vacation_conflict' | 'gap' | 'overlap'
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

  // Descanso 12h entre jornadas (días distintos).
  // Recopila los turnos del empleado, ordena por inicio absoluto en mins
  // (day*1440 + startMin con +1440 si cruza medianoche), y valida pares
  // consecutivos en DÍAS DISTINTOS (mismo día = turno partido, no aplica).
  const turnosPorEmp = new Map<string, { day: DayOfWeek; startAbs: number; endAbs: number; label: string }[]>()
  for (const tid of Object.keys(cells)) {
    const t = templates.find(x => x.id === tid)
    if (!t) continue
    const [sh, sm] = t.start_time.slice(0, 5).split(':').map(Number)
    const [eh, em] = t.end_time.slice(0, 5).split(':').map(Number)
    const startMin = sh * 60 + sm
    let endMin = eh * 60 + em
    if (endMin <= startMin) endMin += 24 * 60   // cruce medianoche
    for (const dk of Object.keys(cells[tid])) {
      const day = parseInt(dk, 10) as DayOfWeek
      for (const empId of cells[tid][dk]) {
        if (!turnosPorEmp.has(empId)) turnosPorEmp.set(empId, [])
        turnosPorEmp.get(empId)!.push({
          day,
          startAbs: day * 1440 + startMin,
          endAbs: day * 1440 + endMin,
          label: t.label,
        })
      }
    }
  }
  for (const [empId, turnos] of turnosPorEmp.entries()) {
    if (turnos.length < 2) continue
    turnos.sort((a, b) => a.startAbs - b.startAbs)
    const emp = empById.get(empId)
    for (let i = 0; i < turnos.length - 1; i++) {
      const a = turnos[i]
      const b = turnos[i + 1]
      if (a.day === b.day) continue
      const restHours = (b.startAbs - a.endAbs) / 60
      if (restHours < 12) {
        issues.push({
          type: 'rest_12h',
          employeeId: empId,
          day: b.day,
          message: `${emp?.name || empId}: solo ${restHours.toFixed(1)}h de descanso entre ${dayLabel(a.day)} (${a.label}) y ${dayLabel(b.day)} (${b.label})`,
        })
      }
    }
  }

  return issues
}
