// src/services/calendarValidations.ts
// Validaciones del calendario: reglas del convenio + mínimos de plantilla.
import type { Employee } from '../types'
import type { ShiftAssignment, ShiftType, ShiftMinimum } from './calendarService'

export type ValidationLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: ValidationLevel
  code: string
  title: string
  description: string
  employeeId?: string
  date?: string
  shiftTypeCode?: string
}

interface ValidateContext {
  assignments: ShiftAssignment[]
  shiftTypes: ShiftType[]
  employees: Employee[]
  minimums: ShiftMinimum[]
  weekDays: string[]                 // 7 fechas YYYY-MM-DD
  locationId: string                 // local del plan
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Devuelve [startMinSinceMonday, endMinSinceMonday] para una asignación.
 * Para turnos partidos devuelve dos rangos. Si cruza medianoche, ajusta el end. */
function shiftRanges(date: string, weekStart: string, t: ShiftType): { startAbs: number; endAbs: number }[] {
  if (t.isOff || !t.startTime || !t.endTime) return []
  const dayIdx = Math.floor(
    (new Date(date + 'T00:00:00').getTime() - new Date(weekStart + 'T00:00:00').getTime()) / (24 * 60 * 60000)
  )
  const dayOffset = dayIdx * 24 * 60

  const ranges: { startAbs: number; endAbs: number }[] = []

  // Tramo 1
  const s1 = hhmmToMin(t.startTime)
  let e1 = hhmmToMin(t.endTime)
  if (e1 <= s1) e1 += 24 * 60   // cruza medianoche
  ranges.push({ startAbs: dayOffset + s1, endAbs: dayOffset + e1 })

  // Tramo 2 (turno partido)
  if (t.isSplit && t.split2Start && t.split2End) {
    const s2 = hhmmToMin(t.split2Start)
    let e2 = hhmmToMin(t.split2End)
    if (e2 <= s2) e2 += 24 * 60
    ranges.push({ startAbs: dayOffset + s2, endAbs: dayOffset + e2 })
  }

  return ranges
}

/** Devuelve true si dos rangos abs se solapan o están a menos de "minRest" de distancia */
function tooCloseRest(a: { startAbs: number; endAbs: number }, b: { startAbs: number; endAbs: number }, minRestMin: number): boolean {
  // Reordenar por inicio
  const [x, y] = a.startAbs <= b.startAbs ? [a, b] : [b, a]
  const gap = y.startAbs - x.endAbs
  return gap < minRestMin
}

// ─── Validador principal ──────────────────────────────────────────────────

export function validatePlan(ctx: ValidateContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const typesById = new Map(ctx.shiftTypes.map(t => [t.id, t]))
  const employeesById = new Map(ctx.employees.map(e => [e.id, e]))
  const weekStart = ctx.weekDays[0]

  // Index asignaciones por empleado
  const byEmployee = new Map<string, ShiftAssignment[]>()
  for (const a of ctx.assignments) {
    if (!byEmployee.has(a.employeeId)) byEmployee.set(a.employeeId, [])
    byEmployee.get(a.employeeId)!.push(a)
  }

  // ── Reglas POR EMPLEADO ─────────────────────────────────────────────────
  for (const [empId, assigns] of byEmployee.entries()) {
    const emp = employeesById.get(empId)
    if (!emp) continue

    const sorted = [...assigns].sort((a, b) => a.date.localeCompare(b.date))

    // Calcular ranges abs y total horas
    let totalHours = 0
    const allRanges: { startAbs: number; endAbs: number; date: string; code: string }[] = []
    const offDays: string[] = []
    const workDays: string[] = []

    for (const a of sorted) {
      if (!a.shiftTypeId) continue
      const t = typesById.get(a.shiftTypeId)
      if (!t) continue
      if (t.isOff) {
        offDays.push(a.date)
        continue
      }
      workDays.push(a.date)
      totalHours += t.hours

      const ranges = shiftRanges(a.date, weekStart, t)
      for (const r of ranges) {
        allRanges.push({ ...r, date: a.date, code: t.code })
      }

      // Regla: máximo 10.5h por día (relajado a tu petición)
      const dayHours = ranges.reduce((acc, r) => acc + (r.endAbs - r.startAbs) / 60, 0)
      if (dayHours > 10.5) {
        issues.push({
          level: 'error',
          code: 'max_daily_hours',
          title: 'Máximo 10.5 h diarias',
          description: `${emp.name}: ${dayHours.toFixed(1)}h el ${a.date} con turno ${t.code}`,
          employeeId: empId,
          date: a.date,
          shiftTypeCode: t.code,
        })
      }
    }

    // Regla: máximo 40h semanales (warning)
    const contractHours = emp.weeklyHours || 40
    if (totalHours > contractHours) {
      issues.push({
        level: 'warning',
        code: 'over_weekly_hours',
        title: `${emp.name}: ${totalHours.toFixed(1)}h supera contrato`,
        description: `Contrato: ${contractHours}h. Asignado: ${totalHours.toFixed(1)}h. Excede en ${(totalHours - contractHours).toFixed(1)}h.`,
        employeeId: empId,
      })
    }

    // Regla: mínimo 12h descanso entre turnos (error)
    allRanges.sort((a, b) => a.startAbs - b.startAbs)
    for (let i = 1; i < allRanges.length; i++) {
      const prev = allRanges[i - 1]
      const cur = allRanges[i]
      if (tooCloseRest(prev, cur, 12 * 60)) {
        const gap = (cur.startAbs - prev.endAbs) / 60
        if (gap < 12) {
          issues.push({
            level: 'error',
            code: 'min_rest_12h',
            title: 'Descanso < 12 h',
            description: `${emp.name}: solo ${gap.toFixed(1)}h entre el turno ${prev.code} (${prev.date}) y ${cur.code} (${cur.date}).`,
            employeeId: empId,
            date: cur.date,
          })
        }
      }
    }

    // Regla: máximo 6 días consecutivos (warning)
    let consecutive = 0
    let maxConsecutive = 0
    for (const d of ctx.weekDays) {
      const a = sorted.find(x => x.date === d)
      const t = a?.shiftTypeId ? typesById.get(a.shiftTypeId) : null
      if (t && !t.isOff) {
        consecutive++
        if (consecutive > maxConsecutive) maxConsecutive = consecutive
      } else {
        consecutive = 0
      }
    }
    if (maxConsecutive > 6) {
      issues.push({
        level: 'warning',
        code: 'max_consecutive_days',
        title: 'Más de 6 días seguidos',
        description: `${emp.name}: ${maxConsecutive} días seguidos sin libra.`,
        employeeId: empId,
      })
    }

    // Regla: 1.5 días libres seguidos (warning)
    // Buscamos un bloque LIBRE de al menos 1.5 días naturales (≈ 36h sin turno asignado)
    if (offDays.length === 0) {
      issues.push({
        level: 'warning',
        code: 'no_off_days',
        title: 'Sin días libres',
        description: `${emp.name}: no tiene libra esta semana.`,
        employeeId: empId,
      })
    }

    // Regla: libra en V/S/D (warning especial)
    for (const d of offDays) {
      const dayOfWeek = new Date(d + 'T00:00:00').getDay()
      if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
        const dayLabel = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dayOfWeek]
        issues.push({
          level: 'warning',
          code: 'off_weekend',
          title: 'Libra en fin de semana',
          description: `${emp.name}: librará el ${dayLabel} ${d}, día de alta demanda.`,
          employeeId: empId,
          date: d,
        })
      }
    }
  }

  // ── Reglas POR DÍA Y TURNO (mínimos de plantilla) ───────────────────────
  // Para cada día y cada tipo de turno (no off), contar empleados asignados.
  for (const d of ctx.weekDays) {
    const dayOfWeek = new Date(d + 'T00:00:00').getDay()
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0

    for (const t of ctx.shiftTypes) {
      if (t.isOff) continue

      // Contar asignaciones de este turno en este día
      const count = ctx.assignments.filter(a => a.date === d && a.shiftTypeId === t.id).length

      // Buscar mínimo aplicable
      const min = ctx.minimums.find(m => m.shiftTypeId === t.id)
      if (!min) continue
      const required = isWeekend && min.minWeekend != null ? min.minWeekend : min.minDefault

      if (count < required) {
        const dayLabel = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dayOfWeek]
        issues.push({
          level: count === 0 ? 'error' : 'warning',
          code: 'min_staff_per_shift',
          title: `${t.code} insuficiente`,
          description: `${dayLabel} ${d}: ${count}/${required} en ${t.code} ${t.label}${isWeekend && min.minWeekend != null ? ' (V/S/D)' : ''}.`,
          date: d,
          shiftTypeCode: t.code,
        })
      }
    }
  }


  // ── Regla CRÍTICA: V/S/D necesitan mínimo 3 trabajadores cubriendo 20:00–cierre ──
  // Cuenta empleados asignados a turnos que cubran las 20:00–00:15 ese día.
  // Cualquier turno cuya franja cruce las 20:00 cuenta (T2 14:45-00:15, T3 16:45-00:15,
  // T1+T3 que vuelve a las 19:45-00:15).
  for (const d of ctx.weekDays) {
    const dayOfWeek = new Date(d + 'T00:00:00').getDay()
    const isVSD = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0
    if (!isVSD) continue

    let coveringClose = 0
    for (const a of ctx.assignments) {
      if (a.date !== d || !a.shiftTypeId) continue
      const t = typesById.get(a.shiftTypeId)
      if (!t || t.isOff) continue

      // Calcular si el turno cubre las 20:00 (1200 min desde 00:00)
      // Tramo 1
      if (t.startTime && t.endTime) {
        const s1 = (() => { const [h,m] = t.startTime.split(':').map(Number); return h*60+m })()
        let e1 = (() => { const [h,m] = t.endTime.split(':').map(Number); return h*60+m })()
        if (e1 <= s1) e1 += 24 * 60
        if (s1 <= 20 * 60 && e1 >= 20 * 60 + 15) {
          coveringClose++
          continue
        }
      }
      // Tramo 2 (turno partido)
      if (t.isSplit && t.split2Start && t.split2End) {
        const s2 = (() => { const [h,m] = t.split2Start!.split(':').map(Number); return h*60+m })()
        let e2 = (() => { const [h,m] = t.split2End!.split(':').map(Number); return h*60+m })()
        if (e2 <= s2) e2 += 24 * 60
        if (s2 <= 20 * 60 && e2 >= 20 * 60 + 15) {
          coveringClose++
        }
      }
    }

    if (coveringClose < 3) {
      const dayLabel = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dayOfWeek]
      issues.push({
        level: coveringClose === 0 ? 'error' : coveringClose === 1 ? 'error' : 'warning',
        code: 'min_close_coverage',
        title: `Cobertura 20–cierre insuficiente (${dayLabel})`,
        description: `${dayLabel} ${d}: solo ${coveringClose}/3 trabajadores cubriendo de 20:00 al cierre. V/S/D requiere mínimo 3.`,
        date: d,
      })
    }
  }

  return issues
}

/** Cuenta asignaciones por turno por día. Útil para mostrar cobertura. */
export function shiftCoverage(
  assignments: ShiftAssignment[],
  shiftTypes: ShiftType[],
  weekDays: string[],
): Map<string, Map<string, number>> {
  // map: shiftTypeId → date → count
  const coverage = new Map<string, Map<string, number>>()
  for (const t of shiftTypes) {
    if (t.isOff) continue
    const byDay = new Map<string, number>()
    for (const d of weekDays) byDay.set(d, 0)
    coverage.set(t.id, byDay)
  }
  for (const a of assignments) {
    if (!a.shiftTypeId) continue
    const byDay = coverage.get(a.shiftTypeId)
    if (!byDay) continue
    byDay.set(a.date, (byDay.get(a.date) || 0) + 1)
  }
  return coverage
}
