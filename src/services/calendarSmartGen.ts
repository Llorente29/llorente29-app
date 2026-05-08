// src/services/calendarSmartGen.ts
// Generador inteligente del calendario semanal:
// - Respeta la plantilla del local (mínimos por turno y día)
// - Distribuye empleados según disponibilidad y horas contratadas
// - Permite turnos partidos (múltiples slots por día)
// - Aplica restricciones del convenio (descanso 12h, libra)
// - Produce diagnóstico con sugerencias accionables

import type { Employee } from '../types'
import type { ShiftType } from './calendarService'
import type { LocationPlanningRow } from './locationPlanningService'
import { neededFor } from './locationPlanningService'

// ─── TIPOS ────────────────────────────────────────────────────────────────

export interface SmartGenInput {
  employees: Employee[]              // empleados disponibles (ya filtrados por availability + vacaciones)
  unavailableDates: Map<string, Set<string>>  // employeeId -> set de fechas YYYY-MM-DD donde tiene vacaciones
  shiftTypes: ShiftType[]            // tipos activos
  planning: LocationPlanningRow[]    // plantilla del local
  days: string[]                     // 7 fechas YYYY-MM-DD lunes a domingo
  // Configuración
  maxMonthlyOverloadPct: number      // 20 = +20% horas mensuales máx
  monthlyHoursAlready: Map<string, number>   // employeeId -> horas ya asignadas en el mes
}

export type DiagnosticLevel = 'error' | 'warning' | 'suggestion'

export interface DiagnosticItem {
  level: DiagnosticLevel
  code: string
  title: string
  description: string
  date?: string
  employeeId?: string
  shiftCode?: string
}

export interface SmartGenOutput {
  toUpsert: { employeeId: string; date: string; shiftTypeId: string; slot: number }[]
  diagnostics: DiagnosticItem[]
  summary: {
    totalAssigned: number
    totalNeeded: number
    coverageRate: number  // 0..1
    employeesUsed: number
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function hhmmToMin(s?: string): number {
  if (!s) return 0
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Devuelve el rango absoluto [startMinAbs, endMinAbs] de un turno en un día. */
function shiftAbsRange(date: string, weekStart: string, t: ShiftType): { startAbs: number; endAbs: number; startAbs2?: number; endAbs2?: number } {
  const dayIdx = Math.floor(
    (new Date(date + 'T00:00:00').getTime() - new Date(weekStart + 'T00:00:00').getTime()) / (24 * 60 * 60000)
  )
  const dayOffset = dayIdx * 24 * 60

  const s1 = hhmmToMin(t.startTime)
  let e1 = hhmmToMin(t.endTime)
  if (e1 <= s1) e1 += 24 * 60

  const r: { startAbs: number; endAbs: number; startAbs2?: number; endAbs2?: number } = {
    startAbs: dayOffset + s1,
    endAbs: dayOffset + e1,
  }

  if (t.isSplit && t.split2Start && t.split2End) {
    const s2 = hhmmToMin(t.split2Start)
    let e2 = hhmmToMin(t.split2End)
    if (e2 <= s2) e2 += 24 * 60
    r.startAbs2 = dayOffset + s2
    r.endAbs2 = dayOffset + e2
  }
  return r
}


// ─── ALGORITMO PRINCIPAL ──────────────────────────────────────────────────

export function smartGenerate(input: SmartGenInput): SmartGenOutput {
  const { employees, unavailableDates, shiftTypes, planning, days, maxMonthlyOverloadPct, monthlyHoursAlready } = input
  const weekStart = days[0]

  // Filtrar tipos no off
  const workTypes = shiftTypes.filter(t => !t.isOff && t.active && t.startTime && t.endTime)

  // Estado por empleado durante la generación
  interface EmpState {
    emp: Employee
    weeklyHoursContract: number          // horas contratadas semanales
    monthlyHoursContract: number         // contratadas × ~4.33
    monthlyMaxAllowed: number            // contratadas mes × (1 + overload%)
    monthlyHoursAccumBefore: number      // horas ya asignadas en el mes antes de esta semana
    weeklyAssigned: number               // horas asignadas en ESTA semana hasta ahora
    workingDays: Set<string>             // fechas YYYY-MM-DD donde ya tiene al menos un turno
    ranges: { startAbs: number; endAbs: number; date: string }[]  // rangos abs ordenados
  }

  const states = new Map<string, EmpState>()
  for (const emp of employees) {
    const w = emp.weeklyHours || 40
    states.set(emp.id, {
      emp,
      weeklyHoursContract: w,
      monthlyHoursContract: w * 4.33,
      monthlyMaxAllowed: w * 4.33 * (1 + maxMonthlyOverloadPct / 100),
      monthlyHoursAccumBefore: monthlyHoursAlready.get(emp.id) || 0,
      weeklyAssigned: 0,
      workingDays: new Set(),
      ranges: [],
    })
  }

  // Resultado
  const toUpsert: SmartGenOutput['toUpsert'] = []
  const diagnostics: DiagnosticItem[] = []
  const cover = new Map<string, Map<string, number>>()  // shiftTypeId -> date -> count
  for (const t of workTypes) {
    const m = new Map<string, number>()
    for (const d of days) m.set(d, 0)
    cover.set(t.id, m)
  }

  // Asignar libras: día completo entre L-J
  // Para cada empleado, elegir un día L-J donde no estará disponible
  const libreType = shiftTypes.find(t => t.isOff)
  const libreId = libreType?.id

  // Detectar si el empleado tiene día preferido como inactivo en weeklySchedule
  const dayKeyByIdx = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  function findPreferredOffDay(emp: Employee): string | null {
    const ws = emp.weeklySchedule
    if (!ws) return null
    // Buscar lunes-jueves inactivo
    for (let dow = 1; dow <= 4; dow++) {
      const key = dayKeyByIdx[dow]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = (ws as any)[key]
      if (day && !day.active) {
        return days.find(d => new Date(d + 'T00:00:00').getDay() === dow) || null
      }
    }
    return null
  }

  // Asignar libras
  if (libreId) {
    for (const [empId, st] of states.entries()) {
      const preferDate = findPreferredOffDay(st.emp)
      let chosenDate = preferDate

      // Si no hay preferida, distribuir entre L-J el día con menos personas ya con libra
      if (!chosenDate) {
        const lunaJueDays = days.filter(d => {
          const dow = new Date(d + 'T00:00:00').getDay()
          return dow >= 1 && dow <= 4
        })
        // Contar libras ya asignadas por día
        const libreCount = new Map<string, number>()
        for (const d of lunaJueDays) libreCount.set(d, 0)
        for (const u of toUpsert) {
          if (u.shiftTypeId === libreId && libreCount.has(u.date)) {
            libreCount.set(u.date, (libreCount.get(u.date) || 0) + 1)
          }
        }
        chosenDate = lunaJueDays.sort((a, b) => (libreCount.get(a) || 0) - (libreCount.get(b) || 0))[0]
      }

      if (chosenDate) {
        // Comprobar si está disponible ese día (no vacaciones)
        const unavail = unavailableDates.get(empId)
        if (!unavail || !unavail.has(chosenDate)) {
          toUpsert.push({ employeeId: empId, date: chosenDate, shiftTypeId: libreId, slot: 1 })
          st.workingDays.add(chosenDate)   // bloqueado para más turnos ese día
        }
      }
    }
  }

  // Procesar días en orden de criticidad: V, S, D primero, luego L, M, X, J
  const dayPriority = (d: string): number => {
    const dow = new Date(d + 'T00:00:00').getDay()
    if (dow === 5 || dow === 6 || dow === 0) return 0  // V/S/D crítico
    return 1
  }
  const sortedDays = [...days].sort((a, b) => dayPriority(a) - dayPriority(b))

  // Procesar turnos en orden: T2 y T3 primero (más horas, más críticos), luego T1, T4
  const typePriority = (t: ShiftType): number => {
    if (t.code === 'T2' || t.code === 'T3') return 0
    if (t.code === 'T1') return 1
    if (t.code === 'T4') return 2
    return 3
  }
  const sortedTypes = [...workTypes].sort((a, b) => typePriority(a) - typePriority(b))

  // ASIGNACIÓN PRINCIPAL
  for (const date of sortedDays) {
    const dow = new Date(date + 'T00:00:00').getDay()

    for (const t of sortedTypes) {
      // ¿Cuántos hacen falta de este turno este día?
      const planRow = planning.find(p => p.shiftTypeId === t.id)
      if (!planRow) continue
      const needed = neededFor(planRow, dow)
      if (needed === 0) continue

      // Mientras la cobertura sea < needed, intentar asignar
      while ((cover.get(t.id)?.get(date) || 0) < needed) {
        // Calcular el rango abs del turno este día
        const range = shiftAbsRange(date, weekStart, t)

        // Buscar candidato óptimo
        let best: { state: EmpState; reason: string } | null = null
        let bestScore = -Infinity

        for (const st of states.values()) {
          const empId = st.emp.id

          // ¿Vacaciones ese día?
          const unavail = unavailableDates.get(empId)
          if (unavail && unavail.has(date)) continue

          // ¿Ya tiene libra ese día? No asignar más
          // (bloqueamos el día completo cuando se asigna LIBRE)
          // Verificamos si ya tiene asignación LIBRE
          const alreadyLibre = toUpsert.some(u => u.employeeId === empId && u.date === date && u.shiftTypeId === libreId)
          if (alreadyLibre) continue

          // ¿Ya tiene este turno hoy? (no duplicar)
          const alreadyHasThis = toUpsert.some(u =>
            u.employeeId === empId && u.date === date && u.shiftTypeId === t.id
          )
          if (alreadyHasThis) continue

          // ¿Cuántos turnos ya tiene hoy?
          const todayShifts = toUpsert.filter(u => u.employeeId === empId && u.date === date && u.shiftTypeId !== libreId)
          if (todayShifts.length >= 2) continue   // máx 2 turnos por día

          // Verificar descanso 12h con turnos previos del empleado
          let restOk = true
          for (const r of st.ranges) {
            // ¿Solapan o están a menos de 12h?
            const overlap = !(range.endAbs <= r.startAbs || range.startAbs >= r.endAbs)
            if (overlap) { restOk = false; break }

            const gap = range.startAbs > r.endAbs
              ? range.startAbs - r.endAbs
              : r.startAbs - range.endAbs
            if (gap < 12 * 60) { restOk = false; break }

            if (range.startAbs2 !== undefined && range.endAbs2 !== undefined) {
              const overlap2 = !(range.endAbs2 <= r.startAbs || range.startAbs2 >= r.endAbs)
              if (overlap2) { restOk = false; break }
            }
          }
          if (!restOk) continue

          // ¿Excedería el máximo mensual?
          const newWeeklyTotal = st.weeklyAssigned + t.hours
          const newMonthlyTotal = st.monthlyHoursAccumBefore + newWeeklyTotal
          if (newMonthlyTotal > st.monthlyMaxAllowed) continue

          // ─── SCORE ───
          // Priorizar:
          //  + Empleados con jornada completa (más horas contratadas)
          //  + Empleados con menos horas asignadas esta semana (equilibrar)
          //  - Empleados ya sobrecargados
          let score = 0
          score += st.weeklyHoursContract * 2    // jornada completa pesa
          score -= st.weeklyAssigned             // menos horas asignadas, mejor
          // Si está cerca del máximo mensual, penalizar
          const monthlyUsage = newMonthlyTotal / st.monthlyMaxAllowed
          if (monthlyUsage > 1) score -= 1000    // ya excedió
          else if (monthlyUsage > 0.95) score -= 50

          if (score > bestScore) {
            bestScore = score
            best = { state: st, reason: 'score=' + score.toFixed(1) }
          }
        }

        if (!best) {
          // No hay candidato → déficit
          const dow0 = dow
          const dayLabel = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dow0]
          const haveCount = cover.get(t.id)?.get(date) || 0
          const missing = needed - haveCount
          diagnostics.push({
            level: 'error',
            code: 'shift_uncovered',
            title: `${t.code} sin cubrir el ${dayLabel}`,
            description: `Faltan ${missing} ${missing === 1 ? 'persona' : 'personas'} para cubrir ${t.code} ${t.label} (${t.startTime}–${t.endTime}) el ${dayLabel} ${date}.`,
            date,
            shiftCode: t.code,
          })
          break  // pasar al siguiente turno
        }

        // Asignar
        const st = best.state
        const slot = (toUpsert.filter(u => u.employeeId === st.emp.id && u.date === date && u.shiftTypeId !== libreId).length) + 1
        toUpsert.push({ employeeId: st.emp.id, date, shiftTypeId: t.id, slot })
        st.weeklyAssigned += t.hours
        st.workingDays.add(date)
        st.ranges.push({ startAbs: range.startAbs, endAbs: range.endAbs, date })
        if (range.startAbs2 !== undefined && range.endAbs2 !== undefined) {
          st.ranges.push({ startAbs: range.startAbs2, endAbs: range.endAbs2, date })
        }
        st.ranges.sort((a, b) => a.startAbs - b.startAbs)
        cover.get(t.id)!.set(date, (cover.get(t.id)?.get(date) || 0) + 1)
      }
    }
  }

  // ─── DIAGNÓSTICO ───────────────────────────────────────────────────────

  // Empleados sobrecargados o subutilizados
  for (const st of states.values()) {
    const newMonthly = st.monthlyHoursAccumBefore + st.weeklyAssigned
    const monthlyUsagePct = (newMonthly / st.monthlyHoursContract) * 100

    if (monthlyUsagePct > 100) {
      diagnostics.push({
        level: 'warning',
        code: 'overloaded',
        title: `${st.emp.name} sobrecargado`,
        description: `Acumula ${newMonthly.toFixed(1)}h en el mes (${monthlyUsagePct.toFixed(0)}% de su contrato de ${st.monthlyHoursContract.toFixed(0)}h). Excede en ${(newMonthly - st.monthlyHoursContract).toFixed(1)}h.`,
        employeeId: st.emp.id,
      })
    } else if (st.weeklyAssigned < st.weeklyHoursContract * 0.7 && st.weeklyAssigned > 0) {
      const margin = st.weeklyHoursContract - st.weeklyAssigned
      diagnostics.push({
        level: 'suggestion',
        code: 'underused',
        title: `${st.emp.name} con horas libres`,
        description: `Solo tiene ${st.weeklyAssigned.toFixed(1)}h asignadas de ${st.weeklyHoursContract}h contratadas. Le quedan ${margin.toFixed(1)}h disponibles.`,
        employeeId: st.emp.id,
      })
    }
  }

  // Sugerencias globales
  let totalNeeded = 0
  let totalAssigned = 0
  for (const t of workTypes) {
    const planRow = planning.find(p => p.shiftTypeId === t.id)
    if (!planRow) continue
    for (const date of days) {
      const dow = new Date(date + 'T00:00:00').getDay()
      const need = neededFor(planRow, dow)
      const have = cover.get(t.id)?.get(date) || 0
      totalNeeded += need
      totalAssigned += Math.min(have, need)
    }
  }

  // Si hay déficit global > 10%, sugerir contratación
  const coverageRate = totalNeeded > 0 ? totalAssigned / totalNeeded : 1
  if (coverageRate < 0.9 && totalNeeded > 0) {
    const missingShifts = totalNeeded - totalAssigned
    const avgShiftHours = workTypes.reduce((acc, t) => acc + t.hours, 0) / workTypes.length
    const suggestedHours = Math.ceil(missingShifts * avgShiftHours / 4.33)   // horas semanales nuevas
    diagnostics.push({
      level: 'suggestion',
      code: 'hire_more',
      title: 'Plantilla insuficiente',
      description: `Faltan ${missingShifts} turnos por cubrir esta semana. Considera contratar 1 persona con jornada de ~${suggestedHours}h semanales o ampliar horas de un trabajador a tiempo parcial.`,
    })
  }

  return {
    toUpsert,
    diagnostics,
    summary: {
      totalAssigned,
      totalNeeded,
      coverageRate,
      employeesUsed: Array.from(states.values()).filter(s => s.weeklyAssigned > 0).length,
    },
  }
}
