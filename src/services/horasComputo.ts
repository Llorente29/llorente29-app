// src/services/horasComputo.ts
// Cálculos de horas, redondeo de fichajes, detección de retrasos/olvidos.

import type { Employee, ClockEntry } from '../types'

const DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const

// ─── Helpers de fecha ──────────────────────────────────────────────────────

export function dayKeyOf(d: Date): typeof DAY_KEYS[number] {
  return DAY_KEYS[d.getDay()]
}

// "08:30" → minutos desde 00:00
export function hhmmToMin(s: string): number {
  if (!s) return 0
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// 510 → "08:30"
export function minToHhmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// minutos desde 00:00 de una fecha
export function dateToMinOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

// ─── Horario teórico del empleado para una fecha concreta ──────────────────

export interface TheoreticalShift {
  start: string   // "09:00"
  end: string     // "17:00"
  startMin: number
  endMin: number
  hours: number
}

export function getTheoreticalShift(employee: Employee, date: Date): TheoreticalShift | null {
  const ws = employee.weeklySchedule
  if (!ws) return null
  const day = ws[dayKeyOf(date)]
  if (!day || !day.active || !day.start || !day.end) return null
  const startMin = hhmmToMin(day.start)
  const endMin = hhmmToMin(day.end)
  return {
    start: day.start,
    end: day.end,
    startMin,
    endMin,
    hours: (endMin - startMin) / 60,
  }
}

// ─── Redondeo amistoso (Opción 3) ──────────────────────────────────────────

export interface RoundingResult {
  applied: boolean              // ¿se aplicó redondeo?
  realDateTime: string          // ISO de la hora real
  effectiveDateTime: string     // ISO de la hora efectiva (puede ser igual a real)
  diffMin: number               // diferencia en minutos respecto a la hora teórica (negativo = antes)
  scheduledTime?: string        // hora teórica "HH:mm" si la hay
}

/**
 * Redondea el fichaje a la hora teórica si está dentro de la tolerancia.
 * Solo aplica al cómputo. La hora real siempre se conserva.
 *
 * @param realDate fecha real del fichaje
 * @param type     'entrada' o 'salida'
 * @param employee el empleado (para coger su weeklySchedule)
 * @param toleranceMin tolerancia en minutos (típico 8)
 */
export function applyRounding(
  realDate: Date,
  type: 'entrada' | 'salida',
  employee: Employee,
  toleranceMin: number,
): RoundingResult {
  const realISO = realDate.toISOString()
  const shift = getTheoreticalShift(employee, realDate)
  if (!shift) {
    return { applied: false, realDateTime: realISO, effectiveDateTime: realISO, diffMin: 0 }
  }

  const realMin = dateToMinOfDay(realDate)
  const targetMin = type === 'entrada' ? shift.startMin : shift.endMin
  const diff = realMin - targetMin

  if (Math.abs(diff) <= toleranceMin) {
    // Dentro de tolerancia → ajustar a hora teórica
    const eff = new Date(realDate)
    eff.setHours(0, 0, 0, 0)
    eff.setMinutes(targetMin)
    return {
      applied: true,
      realDateTime: realISO,
      effectiveDateTime: eff.toISOString(),
      diffMin: diff,
      scheduledTime: type === 'entrada' ? shift.start : shift.end,
    }
  }

  // Fuera de tolerancia → mantener hora real
  return {
    applied: false,
    realDateTime: realISO,
    effectiveDateTime: realISO,
    diffMin: diff,
    scheduledTime: type === 'entrada' ? shift.start : shift.end,
  }
}

// ─── Cálculo de horas trabajadas ──────────────────────────────────────────

/**
 * Empareja entradas con salidas y calcula horas trabajadas.
 * Si hay una entrada sin salida, devuelve esa entrada como "abierta".
 */
export interface PairedShift {
  entry: ClockEntry
  exit?: ClockEntry
  hoursWorked: number   // horas (con decimales) del par. 0 si todavía abierto.
  isOpen: boolean
}

export function pairClockEntries(entries: ClockEntry[]): PairedShift[] {
  const sorted = [...entries].sort((a, b) =>
    new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  )

  const pairs: PairedShift[] = []
  let currentEntry: ClockEntry | null = null

  for (const e of sorted) {
    if (e.type === 'entrada') {
      if (currentEntry) {
        // Entrada sin salida previa — la dejamos como huérfana
        pairs.push({ entry: currentEntry, hoursWorked: 0, isOpen: true })
      }
      currentEntry = e
    } else if (e.type === 'salida' && currentEntry) {
      const ms = new Date(e.datetime).getTime() - new Date(currentEntry.datetime).getTime()
      const hours = ms / (1000 * 60 * 60)
      pairs.push({ entry: currentEntry, exit: e, hoursWorked: Math.max(0, hours), isOpen: false })
      currentEntry = null
    }
  }

  if (currentEntry) {
    pairs.push({ entry: currentEntry, hoursWorked: 0, isOpen: true })
  }

  return pairs
}

/**
 * Devuelve solo los pares completos (entrada + salida) sumados en horas para un rango de fechas.
 */
export function hoursWorkedInRange(entries: ClockEntry[], startDate: Date, endDate: Date): number {
  const start = startDate.getTime()
  const end = endDate.getTime()
  const pairs = pairClockEntries(entries).filter(p => !p.isOpen && p.exit)

  let total = 0
  for (const p of pairs) {
    const t = new Date(p.entry.datetime).getTime()
    if (t >= start && t < end) total += p.hoursWorked
  }
  return total
}

// ─── Estado actual del empleado (en este momento) ─────────────────────────

export type CurrentStatus =
  | { kind: 'no_scheduled' }                           // no le toca trabajar hoy
  | { kind: 'pending_arrival'; theoretical: TheoreticalShift; minutesEarly: number }   // aún no es su hora de entrar
  | { kind: 'late_arrival'; theoretical: TheoreticalShift; minutesLate: number }       // debería estar pero no ha fichado
  | { kind: 'inside'; entryAt: Date; minutesWorked: number; theoretical: TheoreticalShift | null }
  | { kind: 'forgot_clockout'; entryAt: Date; minutesWorked: number; theoretical: TheoreticalShift; minutesOver: number }
  | { kind: 'finished'; lastExitAt: Date }            // ya terminó (jornada cerrada)

export interface StatusContext {
  now: Date
  employee: Employee
  todayEntries: ClockEntry[]   // fichajes de HOY
  lateAlertMin: number
  forgotClockoutMin: number
}

export function computeCurrentStatus(ctx: StatusContext): CurrentStatus {
  const { now, employee, todayEntries, lateAlertMin, forgotClockoutMin } = ctx

  const sorted = [...todayEntries].sort((a, b) =>
    new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  )
  const last = sorted[sorted.length - 1]

  const theoretical = getTheoreticalShift(employee, now)
  const nowMin = dateToMinOfDay(now)

  // Si tiene fichajes hoy y el último es entrada → está dentro
  if (last && last.type === 'entrada') {
    const entryAt = new Date(last.datetime)
    const minutesWorked = Math.round((now.getTime() - entryAt.getTime()) / 60000)
    if (theoretical) {
      const minutesOver = nowMin - theoretical.endMin
      if (minutesOver > forgotClockoutMin) {
        return { kind: 'forgot_clockout', entryAt, minutesWorked, theoretical, minutesOver }
      }
    }
    return { kind: 'inside', entryAt, minutesWorked, theoretical }
  }

  // Si tiene fichajes hoy y el último es salida → terminó
  if (last && last.type === 'salida') {
    return { kind: 'finished', lastExitAt: new Date(last.datetime) }
  }

  // No tiene fichajes hoy
  if (!theoretical) return { kind: 'no_scheduled' }

  if (nowMin < theoretical.startMin) {
    return { kind: 'pending_arrival', theoretical, minutesEarly: theoretical.startMin - nowMin }
  }

  const lateBy = nowMin - theoretical.startMin
  if (lateBy >= lateAlertMin) {
    return { kind: 'late_arrival', theoretical, minutesLate: lateBy }
  }

  // Aún en margen, no fichó
  return { kind: 'pending_arrival', theoretical, minutesEarly: -lateBy }
}

// ─── Helpers de filtrado de fichajes por día ──────────────────────────────

export function entriesOfDay(entries: ClockEntry[], date: Date): ClockEntry[] {
  const dayStr = date.toISOString().slice(0, 10)
  return entries.filter(e => e.datetime.slice(0, 10) === dayStr)
}

// ─── Bolsa de horas ───────────────────────────────────────────────────────

export interface HourBankPeriod {
  label: string                  // "Semana del 5 al 11 de mayo", "Mayo 2026", "Acumulado"
  rangeStart: Date
  rangeEnd: Date
  contractedHours: number        // horas que debió trabajar según contrato
  workedHours: number            // horas reales trabajadas (pares cerrados)
  balance: number                // workedHours - contractedHours (positivo = horas extra)
  daysInRange: number            // días contemplados
}

/**
 * Devuelve los días laborables (con horario activo) del empleado entre dos fechas.
 */
function activeWorkdaysBetween(employee: Employee, start: Date, end: Date): Date[] {
  const days: Date[] = []
  const ws = employee.weeklySchedule
  if (!ws) return days

  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  const stop = new Date(end)
  stop.setHours(0, 0, 0, 0)

  while (cur <= stop) {
    const day = ws[dayKeyOf(cur)]
    if (day && day.active && day.start && day.end) {
      days.push(new Date(cur))
    }
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

/**
 * Horas que el empleado DEBÍA trabajar según su weeklySchedule entre dos fechas.
 * Solo cuenta días que ya han pasado (incluyendo hoy hasta ahora si es parcial).
 */
export function contractedHoursBetween(employee: Employee, start: Date, end: Date, now: Date = new Date()): number {
  const ws = employee.weeklySchedule
  if (!ws) return 0

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  let total = 0
  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  const stop = new Date(end)
  stop.setHours(0, 0, 0, 0)

  while (cur <= stop) {
    const day = ws[dayKeyOf(cur)]
    if (day && day.active && day.start && day.end) {
      const startMin = hhmmToMin(day.start)
      const endMin = hhmmToMin(day.end)
      const dayHours = (endMin - startMin) / 60

      if (cur < today) {
        // Día pasado completo
        total += dayHours
      } else if (cur.getTime() === today.getTime()) {
        // Hoy: contar solo hasta el momento actual
        const nowMin = dateToMinOfDay(now)
        if (nowMin >= endMin) total += dayHours
        else if (nowMin > startMin) total += (nowMin - startMin) / 60
        // Si es antes de su hora de entrada, no cuenta nada
      }
      // Días futuros no cuentan
    }
    cur.setDate(cur.getDate() + 1)
  }
  return total
}

/**
 * Calcula el período "Esta semana" (lunes a domingo).
 */
export function weekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=domingo, 1=lunes...
  const offsetToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + offsetToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

/**
 * Calcula el período "Este mes" (1 a último día del mes).
 */
export function monthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

/**
 * Calcula el período "Acumulado" desde la fecha de alta del empleado.
 */
export function accumulatedRange(employee: Employee, until: Date): { start: Date; end: Date } {
  const startStr = employee.startDate || new Date().toISOString().slice(0, 10)
  const start = new Date(startStr + 'T00:00:00')
  const end = new Date(until)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

/**
 * Calcula la bolsa de horas para un empleado en un período concreto.
 */
export function computeHourBankPeriod(
  employee: Employee,
  rangeStart: Date,
  rangeEnd: Date,
  label: string,
  now: Date = new Date(),
): HourBankPeriod {
  const contractedHours = contractedHoursBetween(employee, rangeStart, rangeEnd, now)
  const workedHours = hoursWorkedInRange(
    employee.clockEntries || [],
    rangeStart,
    new Date(Math.min(rangeEnd.getTime(), now.getTime())),
  )
  const balance = workedHours - contractedHours
  const daysInRange = activeWorkdaysBetween(employee, rangeStart, rangeEnd).length
  return {
    label,
    rangeStart,
    rangeEnd,
    contractedHours,
    workedHours,
    balance,
    daysInRange,
  }
}

/**
 * Calcula las 3 vistas (semanal, mensual, acumulado) para un empleado.
 */
export interface HourBankSummary {
  week: HourBankPeriod
  month: HourBankPeriod
  accumulated: HourBankPeriod
}

export function computeHourBankSummary(employee: Employee, now: Date = new Date()): HourBankSummary {
  const w = weekRange(now)
  const m = monthRange(now)
  const a = accumulatedRange(employee, now)

  // Etiquetas
  const weekLabel = `Del ${w.start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} al ${w.end.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}`
  const monthLabel = m.start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const accLabel = `Desde el alta (${a.start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })})`

  return {
    week: computeHourBankPeriod(employee, w.start, w.end, weekLabel, now),
    month: computeHourBankPeriod(employee, m.start, m.end, monthLabel, now),
    accumulated: computeHourBankPeriod(employee, a.start, a.end, accLabel, now),
  }
}
