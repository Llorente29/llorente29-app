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
