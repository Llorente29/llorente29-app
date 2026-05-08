// src/services/calendarSmartGen.ts
// Generador inteligente del calendario semanal v2.
// Mejoras:
// - Asignación greedy basada en horas-pendientes por empleado
// - Libra de 1.5 días seguidos (día completo + T1 mañana, o T4 cierre + día completo)
// - Búsqueda exhaustiva de cobertura (no se rinde hasta llenar o agotar)
// - Soporte de turnos partidos (T1+T3) en última instancia

import type { Employee } from '../types'
import type { ShiftType } from './calendarService'
import type { LocationPlanningRow } from './locationPlanningService'
import { neededFor } from './locationPlanningService'

// ─── TIPOS ────────────────────────────────────────────────────────────────

export interface SmartGenInput {
  employees: Employee[]
  unavailableDates: Map<string, Set<string>>
  shiftTypes: ShiftType[]
  planning: LocationPlanningRow[]
  days: string[]
  maxMonthlyOverloadPct: number
  monthlyHoursAlready: Map<string, number>
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
    coverageRate: number
    employeesUsed: number
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function hhmmToMin(s?: string): number {
  if (!s) return 0
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

interface ShiftRange {
  startAbs: number
  endAbs: number
  date: string
}

function shiftRanges(date: string, weekStart: string, t: ShiftType): ShiftRange[] {
  const dayIdx = Math.floor(
    (new Date(date + 'T00:00:00').getTime() - new Date(weekStart + 'T00:00:00').getTime()) / (24 * 60 * 60000)
  )
  const dayOffset = dayIdx * 24 * 60

  const out: ShiftRange[] = []

  if (t.startTime && t.endTime) {
    const s1 = hhmmToMin(t.startTime)
    let e1 = hhmmToMin(t.endTime)
    if (e1 <= s1) e1 += 24 * 60
    out.push({ startAbs: dayOffset + s1, endAbs: dayOffset + e1, date })
  }

  if (t.isSplit && t.split2Start && t.split2End) {
    const s2 = hhmmToMin(t.split2Start)
    let e2 = hhmmToMin(t.split2End)
    if (e2 <= s2) e2 += 24 * 60
    out.push({ startAbs: dayOffset + s2, endAbs: dayOffset + e2, date })
  }

  return out
}

const dayKeyByIdx = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

// ─── ALGORITMO PRINCIPAL ──────────────────────────────────────────────────

export function smartGenerate(input: SmartGenInput): SmartGenOutput {
  const { employees, unavailableDates, shiftTypes, planning, days, maxMonthlyOverloadPct, monthlyHoursAlready } = input
  const weekStart = days[0]

  const workTypes = shiftTypes.filter(t => !t.isOff && t.active && t.startTime && t.endTime)
  const libreType = shiftTypes.find(t => t.isOff)
  const libreId = libreType?.id || ''
  const t1Type = shiftTypes.find(t => t.code === 'T1' && t.active)
  const t4Type = shiftTypes.find(t => t.code === 'T4' && t.active)

  // Estado por empleado
  interface EmpState {
    emp: Employee
    weeklyHoursContract: number
    monthlyMaxAllowed: number
    monthlyHoursAccumBefore: number
    weeklyAssigned: number
    workingDays: Set<string>
    libreDay: string | null            // día con LIBRE
    halfLibreDay: string | null        // día con media libra
    halfLibreType: 'morning' | 'evening' | null  // T1 = morning, T4 = evening
    ranges: ShiftRange[]
  }

  const states = new Map<string, EmpState>()
  for (const emp of employees) {
    const w = emp.weeklyHours || 40
    states.set(emp.id, {
      emp,
      weeklyHoursContract: w,
      monthlyMaxAllowed: w * 4.33 * (1 + maxMonthlyOverloadPct / 100),
      monthlyHoursAccumBefore: monthlyHoursAlready.get(emp.id) || 0,
      weeklyAssigned: 0,
      workingDays: new Set(),
      libreDay: null,
      halfLibreDay: null,
      halfLibreType: null,
      ranges: [],
    })
  }

  const toUpsert: SmartGenOutput['toUpsert'] = []
  const diagnostics: DiagnosticItem[] = []
  const cover = new Map<string, Map<string, number>>()
  for (const t of workTypes) {
    const m = new Map<string, number>()
    for (const d of days) m.set(d, 0)
    cover.set(t.id, m)
  }

  // ─── PASO 1: Asignar libras (día completo + media libra contigua) ───────

  function findPreferredOffDay(emp: Employee): string | null {
    const ws = emp.weeklySchedule
    if (!ws) return null
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

  // Libre count para distribuir
  const libreCountByDay = new Map<string, number>()
  for (const d of days) libreCountByDay.set(d, 0)

  if (libreId) {
    for (const [empId, st] of states.entries()) {
      const unavail = unavailableDates.get(empId) || new Set<string>()

      // Elegir día completo de libra (preferencia ws + balance)
      let libreDate = findPreferredOffDay(st.emp)
      if (!libreDate || unavail.has(libreDate)) {
        // Buscar día L-J con menos libras y disponible
        const lunaJueDays = days.filter(d => {
          const dow = new Date(d + 'T00:00:00').getDay()
          return dow >= 1 && dow <= 4 && !unavail.has(d)
        })
        libreDate = lunaJueDays.sort((a, b) =>
          (libreCountByDay.get(a) || 0) - (libreCountByDay.get(b) || 0)
        )[0] || null
      }

      if (!libreDate) continue   // no se puede librar esta semana

      // Asignar día completo LIBRE
      toUpsert.push({ employeeId: empId, date: libreDate, shiftTypeId: libreId, slot: 1 })
      st.libreDay = libreDate
      st.workingDays.add(libreDate)
      libreCountByDay.set(libreDate, (libreCountByDay.get(libreDate) || 0) + 1)

      // Media libra: buscar día contiguo (siguiente o anterior) que sea L-J y disponible
      const libreDateObj = new Date(libreDate + 'T00:00:00')
      const nextDate = new Date(libreDateObj); nextDate.setDate(nextDate.getDate() + 1)
      const prevDate = new Date(libreDateObj); prevDate.setDate(prevDate.getDate() - 1)
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      const nextIso = fmt(nextDate)
      const prevIso = fmt(prevDate)
      const nextDow = nextDate.getDay()
      const prevDow = prevDate.getDay()
      const nextIsValid = days.includes(nextIso) && nextDow >= 1 && nextDow <= 4 && !unavail.has(nextIso)
      const prevIsValid = days.includes(prevIso) && prevDow >= 1 && prevDow <= 4 && !unavail.has(prevIso)

      // Preferir SIGUIENTE (libra día completo + T1 mañana siguiente)
      if (nextIsValid && t1Type) {
        toUpsert.push({ employeeId: empId, date: nextIso, shiftTypeId: t1Type.id, slot: 1 })
        st.halfLibreDay = nextIso
        st.halfLibreType = 'morning'
        st.weeklyAssigned += t1Type.hours
        st.workingDays.add(nextIso)
        st.ranges.push(...shiftRanges(nextIso, weekStart, t1Type))
        const c = cover.get(t1Type.id)
        if (c) c.set(nextIso, (c.get(nextIso) || 0) + 1)
      } else if (prevIsValid && t4Type) {
        // Alternativa: T4 cierre el día anterior + día completo siguiente
        toUpsert.push({ employeeId: empId, date: prevIso, shiftTypeId: t4Type.id, slot: 1 })
        st.halfLibreDay = prevIso
        st.halfLibreType = 'evening'
        st.weeklyAssigned += t4Type.hours
        st.workingDays.add(prevIso)
        st.ranges.push(...shiftRanges(prevIso, weekStart, t4Type))
        const c = cover.get(t4Type.id)
        if (c) c.set(prevIso, (c.get(prevIso) || 0) + 1)
      }
    }
  }

  // ─── PASO 2: Calcular demanda total y oferta ────────────────────────────

  let totalNeededHours = 0
  for (const t of workTypes) {
    const planRow = planning.find(p => p.shiftTypeId === t.id)
    if (!planRow) continue
    for (const date of days) {
      const dow = new Date(date + 'T00:00:00').getDay()
      const need = neededFor(planRow, dow)
      totalNeededHours += need * t.hours
    }
  }

  let totalAvailableHours = 0
  for (const st of states.values()) {
    const remaining = st.monthlyMaxAllowed - st.monthlyHoursAccumBefore - st.weeklyAssigned
    if (remaining > 0) totalAvailableHours += remaining
  }

  if (totalNeededHours > totalAvailableHours) {
    const deficit = totalNeededHours - totalAvailableHours
    diagnostics.push({
      level: 'suggestion',
      code: 'global_deficit',
      title: 'Plantilla insuficiente para cubrir la demanda',
      description: `La demanda esta semana es de ${totalNeededHours.toFixed(0)}h pero la oferta máxima de tu plantilla es ${totalAvailableHours.toFixed(0)}h. Déficit estimado: ${deficit.toFixed(0)}h. Considera contratar 1 persona con jornada de ~${Math.ceil(deficit)}h o ampliar horas existentes.`,
    })
  }

  // ─── PASO 3: Asignación greedy día por día ──────────────────────────────

  // Orden días: V, S, D primero (críticos), luego L-J
  const dayPriority = (d: string): number => {
    const dow = new Date(d + 'T00:00:00').getDay()
    if (dow === 5 || dow === 6 || dow === 0) return 0
    return 1
  }
  const sortedDays = [...days].sort((a, b) => dayPriority(a) - dayPriority(b))

  // Orden tipos dentro de un día: T2 y T3 primero (más horas, más críticos), luego T1, T4
  const typePriority = (t: ShiftType): number => {
    if (t.code === 'T2') return 0
    if (t.code === 'T3') return 1
    if (t.code === 'T1') return 2
    if (t.code === 'T4') return 3
    return 4
  }

  function tryAssignSingle(date: string, t: ShiftType): boolean {
    const range = shiftRanges(date, weekStart, t)

    // Buscar mejor candidato
    let best: EmpState | null = null
    let bestScore = -Infinity

    for (const st of states.values()) {
      const empId = st.emp.id

      // Vacaciones
      const unavail = unavailableDates.get(empId) || new Set<string>()
      if (unavail.has(date)) continue

      // Es su día de libra
      if (st.libreDay === date) continue

      // Es su día de media libra → solo permitir si el turno asignado coincide con la mañana/tarde libre
      // En la práctica ya tiene asignado el T1 o T4, así que lo bloqueamos para no añadir más
      if (st.halfLibreDay === date) continue

      // ¿Ya tiene este turno hoy?
      if (toUpsert.some(u => u.employeeId === empId && u.date === date && u.shiftTypeId === t.id)) continue

      // ¿Cuántos turnos ya tiene hoy? Máximo 2
      const todayShifts = toUpsert.filter(u =>
        u.employeeId === empId && u.date === date && u.shiftTypeId !== libreId
      )
      if (todayShifts.length >= 2) continue

      // Descanso 12h SOLO entre días distintos. Dentro del mismo día se permite (turno partido).
      let restOk = true
      for (const r of st.ranges) {
        for (const newR of range) {
          // Si están en el mismo día, no aplicamos la regla de 12h (es partido)
          const sameDay = r.date === newR.date
          // Comprobar solapamiento siempre (no se puede solapar)
          const overlap = !(newR.endAbs <= r.startAbs || newR.startAbs >= r.endAbs)
          if (overlap) { restOk = false; break }
          if (sameDay) continue   // dentro del mismo día solo no solapar, sin descanso 12h
          // Días distintos: aplicar descanso 12h
          const gap = newR.startAbs > r.endAbs ? newR.startAbs - r.endAbs : r.startAbs - newR.endAbs
          if (gap < 12 * 60) { restOk = false; break }
        }
        if (!restOk) break
      }
      if (!restOk) continue

      // Máximo mensual
      const newWeekly = st.weeklyAssigned + t.hours
      const newMonthly = st.monthlyHoursAccumBefore + newWeekly
      if (newMonthly > st.monthlyMaxAllowed) continue

      // ─── SCORE ───
      // Objetivo: equilibrar horas entre empleados, todos cerca de su contrato.
      const remainingToContract = st.weeklyHoursContract - st.weeklyAssigned
      let score = 0

      // Si aún no llega al contrato, MUY prioritario
      if (newWeekly <= st.weeklyHoursContract) {
        score += 1000 + remainingToContract * 5
      } else {
        // Ya supera el contrato: penalizar fuerte el exceso
        const excess = newWeekly - st.weeklyHoursContract
        score -= excess * 30
        // Si encima ya está sobre el contrato actual, penalizar aún más
        if (st.weeklyAssigned > st.weeklyHoursContract) score -= 200
      }

      if (score > bestScore) {
        bestScore = score
        best = st
      }
    }

    if (!best) return false

    const slot = (toUpsert.filter(u => u.employeeId === best.emp.id && u.date === date && u.shiftTypeId !== libreId).length) + 1
    toUpsert.push({ employeeId: best.emp.id, date, shiftTypeId: t.id, slot })
    best.weeklyAssigned += t.hours
    best.workingDays.add(date)
    best.ranges.push(...range)
    best.ranges.sort((a, b) => a.startAbs - b.startAbs)
    const c = cover.get(t.id)
    if (c) c.set(date, (c.get(date) || 0) + 1)

    // Si es turno partido (T1+T3), también cuenta como cobertura de T1 y T4
    // porque cubre tanto la mañana como el cierre.
    if (t.isSplit) {
      const t1 = workTypes.find(x => x.code === 'T1')
      const t4 = workTypes.find(x => x.code === 'T4')
      if (t1) {
        const c1 = cover.get(t1.id)
        if (c1) c1.set(date, (c1.get(date) || 0) + 1)
      }
      if (t4) {
        const c4 = cover.get(t4.id)
        if (c4) c4.set(date, (c4.get(date) || 0) + 1)
      }
    }
    return true
  }

  // PASE 1 — turnos en orden de prioridad (T2/T3 primero, luego T1, T4)
  for (const date of sortedDays) {
    const dow = new Date(date + 'T00:00:00').getDay()
    const sortedTypes = [...workTypes].sort((a, b) => typePriority(a) - typePriority(b))

    for (const t of sortedTypes) {
      if (t.isSplit) continue   // partido se asigna en pase 2 como último recurso
      const planRow = planning.find(p => p.shiftTypeId === t.id)
      if (!planRow) continue
      const needed = neededFor(planRow, dow)
      if (needed === 0) continue

      // Calcular cuántos hay ya cubriendo este turno (incluidos partidos para T1/T4)
      const getCoverage = (tid: string): number => cover.get(tid)?.get(date) || 0

      while (getCoverage(t.id) < needed) {
        const ok = tryAssignSingle(date, t)
        if (!ok) break
      }
    }
  }

  // PASE 2 — Si quedan huecos en T1 o T4, asignar T1+T3 partido como último recurso
  const splitType = workTypes.find(t => t.isSplit && t.code === 'T1+T3')
  if (splitType) {
    for (const date of sortedDays) {
      const dow = new Date(date + 'T00:00:00').getDay()
      const t1 = workTypes.find(t => t.code === 'T1')
      const t4 = workTypes.find(t => t.code === 'T4')
      if (!t1 || !t4) continue

      const t1Plan = planning.find(p => p.shiftTypeId === t1.id)
      const t4Plan = planning.find(p => p.shiftTypeId === t4.id)
      const t1Need = t1Plan ? neededFor(t1Plan, dow) : 0
      const t4Need = t4Plan ? neededFor(t4Plan, dow) : 0

      while (true) {
        const t1Have = cover.get(t1.id)?.get(date) || 0
        const t4Have = cover.get(t4.id)?.get(date) || 0
        // Si hay déficit en T1 o T4, intentar partido
        if (t1Have >= t1Need && t4Have >= t4Need) break
        const ok = tryAssignSingle(date, splitType)
        if (!ok) break
      }
    }
  }

  // ─── PASO 4: Diagnóstico de huecos ──────────────────────────────────────

  let totalAssigned = 0
  let totalNeeded = 0
  for (const t of workTypes) {
    const planRow = planning.find(p => p.shiftTypeId === t.id)
    if (!planRow) continue
    for (const date of sortedDays) {
      const dow = new Date(date + 'T00:00:00').getDay()
      const need = neededFor(planRow, dow)
      const have = cover.get(t.id)?.get(date) || 0
      totalNeeded += need
      totalAssigned += Math.min(have, need)

      if (have < need) {
        const dayLabel = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dow]
        const missing = need - have
        diagnostics.push({
          level: 'error',
          code: 'shift_uncovered',
          title: `${t.code} sin cubrir el ${dayLabel}`,
          description: `Faltan ${missing} ${missing === 1 ? 'persona' : 'personas'} para cubrir ${t.code} ${t.label} (${t.startTime}–${t.endTime}) el ${dayLabel} ${date}.`,
          date, shiftCode: t.code,
        })
      }
    }
  }

  // Diagnóstico por empleado
  for (const st of states.values()) {
    const monthlyUsage = (st.monthlyHoursAccumBefore + st.weeklyAssigned) / (st.weeklyHoursContract * 4.33)

    if (monthlyUsage > 1) {
      const extraHours = (st.monthlyHoursAccumBefore + st.weeklyAssigned) - (st.weeklyHoursContract * 4.33)
      diagnostics.push({
        level: 'warning',
        code: 'overloaded',
        title: `${st.emp.name} sobrecargado`,
        description: `Va por ${(monthlyUsage * 100).toFixed(0)}% de su contrato mensual (+${extraHours.toFixed(1)}h extra). Dentro del margen permitido (+${maxMonthlyOverloadPct}%) pero conviene compensar.`,
        employeeId: st.emp.id,
      })
    } else if (st.weeklyAssigned < st.weeklyHoursContract && st.weeklyAssigned > 0) {
      const margin = st.weeklyHoursContract - st.weeklyAssigned
      diagnostics.push({
        level: 'suggestion',
        code: 'underused',
        title: `${st.emp.name} con horas libres`,
        description: `Tiene ${st.weeklyAssigned.toFixed(1)}h asignadas de ${st.weeklyHoursContract}h contratadas. Le quedan ${margin.toFixed(1)}h disponibles esta semana.`,
        employeeId: st.emp.id,
      })
    }
  }

  return {
    toUpsert,
    diagnostics,
    summary: {
      totalAssigned,
      totalNeeded,
      coverageRate: totalNeeded > 0 ? totalAssigned / totalNeeded : 1,
      employeesUsed: Array.from(states.values()).filter(s => s.weeklyAssigned > 0).length,
    },
  }
}
