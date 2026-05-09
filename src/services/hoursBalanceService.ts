// src/services/hoursBalanceService.ts
// Cálculo HÍBRIDO de bolsa de horas: combina horario planificado + fichaje real + ausencias.

import { supabase } from '../lib/supabase'
import type { Employee } from '../types'
import type { ShiftTemplate, Schedule } from '../types/scheduler'
import { createNotification } from './notificationsService'
import {
  type ClosureResolution,
  type MonthlyBalanceClosure,
  type PeriodBalance,
  type EmployeeBalanceState,
  getPeriodForDate,
  weeksTouchingPeriod,
  daysOfWeekInPeriod,
} from '../types/hoursBalance'

/* =====================================================
   TIPOS DE ALERTAS (sistema híbrido)
   ===================================================== */

export type DayAlertType =
  | 'sin_fichaje'
  | 'sin_horario'
  | 'desviacion_grande'

export interface DayAlert {
  type: DayAlertType
  date: string
  scheduledHours?: number
  clockedHours?: number
  diffMinutes?: number
  message: string
}

const DESVIATION_ALERT_THRESHOLD = 30
const ROUNDING_TOLERANCE_MIN = 10

/* =====================================================
   ROW INTERFACES
   ===================================================== */

interface VacationRow {
  id: string
  start_date: string
  end_date: string
  type: string
  status: string
  paid: boolean | null
}

interface ClockEntryRow {
  id: string
  employee_id: string
  type: 'entrada' | 'salida'
  datetime: string
  real_datetime: string | null
  scheduled: string | null
  rounding_applied: boolean | null
  diff_minutes: number | null
}

/* =====================================================
   CARGA DE DATOS
   ===================================================== */

async function loadPublishedSchedules(
  locationId: string,
  weekStartISOs: string[]
): Promise<Map<string, Schedule>> {
  const out = new Map<string, Schedule>()
  if (!supabase) return out
  if (weekStartISOs.length === 0) return out
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'published')
    .in('week_start', weekStartISOs)
  if (error) {
    console.warn('[hoursBalance] Error cargando schedules:', error)
    return out
  }
  for (const row of data || []) {
    out.set(row.week_start, row as Schedule)
  }
  return out
}

async function loadShiftTemplates(locationId: string): Promise<ShiftTemplate[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('shift_templates')
    .select('*')
    .eq('location_id', locationId)
  if (error) {
    console.warn('[hoursBalance] Error cargando templates:', error)
    return []
  }
  return (data || []) as ShiftTemplate[]
}

async function loadApprovedVacations(employeeId: string): Promise<VacationRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('vacations')
    .select('id, start_date, end_date, type, status, paid')
    .eq('employee_id', employeeId)
    .eq('status', 'aprobada')
  if (error) {
    console.warn('[hoursBalance] Error cargando vacations:', error)
    return []
  }
  return (data || []) as VacationRow[]
}

async function loadClockEntriesForPeriod(
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<ClockEntryRow[]> {
  if (!supabase) return []
  const startISO = `${periodStart}T00:00:00.000Z`
  const endISO = `${periodEnd}T23:59:59.999Z`
  const { data, error } = await supabase
    .from('clock_entries')
    .select('id, employee_id, type, datetime, real_datetime, scheduled, rounding_applied, diff_minutes')
    .eq('employee_id', employeeId)
    .gte('datetime', startISO)
    .lte('datetime', endISO)
    .order('datetime', { ascending: true })
  if (error) {
    console.warn('[hoursBalance] Error cargando clock_entries:', error)
    return []
  }
  return (data || []) as ClockEntryRow[]
}

async function loadClosuresForEmployee(
  employeeId: string
): Promise<MonthlyBalanceClosure[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('monthly_balance_closures')
    .select('*')
    .eq('employee_id', employeeId)
    .order('period_end', { ascending: false })
  if (error) {
    console.warn('[hoursBalance] Error cargando closures:', error)
    return []
  }
  return (data || []).map(rowToClosure)
}

function rowToClosure(row: any): MonthlyBalanceClosure {
  return {
    id: row.id,
    employeeId: row.employee_id,
    locationId: row.location_id,
    periodLabel: row.period_label,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    scheduledHours: parseFloat(row.scheduled_hours) || 0,
    vacationHours: parseFloat(row.vacation_hours) || 0,
    contractedHoursPeriod: parseFloat(row.contracted_hours_period) || 0,
    delta: parseFloat(row.delta) || 0,
    resolution: row.resolution as ClosureResolution,
    resolutionNotes: row.resolution_notes || undefined,
    resolutionAmount: row.resolution_amount !== null ? parseFloat(row.resolution_amount) : undefined,
    closedAt: row.closed_at,
    closedBy: row.closed_by || undefined,
    resolvedAt: row.resolved_at || undefined,
    resolvedBy: row.resolved_by || undefined,
  }
}

/* =====================================================
   CÁLCULO DEL SALDO DE UN PERIODO
   ===================================================== */

interface ComputePeriodInput {
  employee: Employee
  periodStart: string
  periodEnd: string
  schedules: Map<string, Schedule>
  templates: ShiftTemplate[]
  vacations: VacationRow[]
  clockEntries: ClockEntryRow[]
}

interface PeriodCalcResult {
  scheduledHours: number
  vacationHours: number
  contractedHoursPeriod: number
  delta: number
  weeksWithoutSchedule: string[]
  alerts: DayAlert[]
  daysDetail: DayBalance[]
}

interface DayBalance {
  date: string
  workedHours: number
  contractedShare: number
  source: 'fichaje' | 'planificado' | 'ausencia_retribuida' | 'ausencia_no_retribuida' | 'libre'
  alert?: DayAlert
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function* iterateDays(startISO: string, endISO: string): Generator<string> {
  const start = parseISO(startISO)
  const end = parseISO(endISO)
  const cur = new Date(start)
  while (cur <= end) {
    yield isoDate(cur)
    cur.setDate(cur.getDate() + 1)
  }
}

function getDayOfWeek(iso: string): number {
  return parseISO(iso).getDay()
}

function getMondayOfWeek(iso: string): string {
  const d = parseISO(iso)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoDate(d)
}

function getScheduledHoursForDay(
  dayISO: string,
  schedule: Schedule | undefined,
  templates: ShiftTemplate[],
  employee: Employee
): number {
  if (!schedule) return 0
  const dow = getDayOfWeek(dayISO)
  let totalMinutes = 0
  const tplById = new Map(templates.map(t => [t.id, t]))
  for (const tid of Object.keys(schedule.cells)) {
    const t = tplById.get(tid)
    if (!t) continue
    for (const dayKey of Object.keys(schedule.cells[tid])) {
      const dayKeyNum = parseInt(dayKey, 10)
      const expectedGetDay = dayKeyNum === 6 ? 0 : dayKeyNum + 1
      if (expectedGetDay !== dow) continue
      const ids = schedule.cells[tid][dayKey]
      if (!ids.includes(employee.id)) continue
      const start = t.start_time.slice(0, 5)
      const end = t.end_time.slice(0, 5)
      const [sh, sm] = start.split(':').map(Number)
      const [eh, em] = end.split(':').map(Number)
      let mins = (eh * 60 + em) - (sh * 60 + sm)
      if (mins <= 0) mins += 24 * 60
      totalMinutes += mins
    }
  }
  return Math.round((totalMinutes / 60) * 100) / 100
}

function getClockedHoursForDay(
  dayISO: string,
  allEntries: ClockEntryRow[]
): { hours: number; complete: boolean } {
  const dayEntries = allEntries.filter(e => e.datetime.slice(0, 10) === dayISO)
  if (dayEntries.length === 0) return { hours: 0, complete: false }
  let totalMinutes = 0
  let openEntry: ClockEntryRow | null = null
  let pairsClosed = 0
  for (const e of dayEntries) {
    if (e.type === 'entrada') {
      openEntry = e
    } else if (e.type === 'salida' && openEntry) {
      const inMs = new Date(openEntry.datetime).getTime()
      const outMs = new Date(e.datetime).getTime()
      let mins = (outMs - inMs) / 60000
      if (mins < 0) mins += 24 * 60
      totalMinutes += mins
      pairsClosed++
      openEntry = null
    }
  }
  const complete = pairsClosed > 0 && openEntry === null
  return {
    hours: Math.round((totalMinutes / 60) * 100) / 100,
    complete,
  }
}

interface VacationOnDay {
  found: boolean
  paid: boolean
  type: string
}

function getVacationOnDay(dayISO: string, vacations: VacationRow[]): VacationOnDay {
  for (const v of vacations) {
    if (dayISO >= v.start_date && dayISO <= v.end_date) {
      return {
        found: true,
        paid: v.paid ?? true,
        type: v.type,
      }
    }
  }
  return { found: false, paid: false, type: '' }
}

function computePeriodBalanceHybrid(input: ComputePeriodInput): PeriodCalcResult {
  const { employee, periodStart, periodEnd, schedules, templates, vacations, clockEntries } = input
  const contractedWeekly = employee.weeklyHours || 40
  const dailyContract = contractedWeekly / 7

  const daysDetail: DayBalance[] = []
  const alerts: DayAlert[] = []
  const weeksWithoutScheduleSet = new Set<string>()
  let totalWorkedHours = 0
  let totalVacationHours = 0
  let totalContracted = 0

  for (const dayISO of iterateDays(periodStart, periodEnd)) {
    const weekMonday = getMondayOfWeek(dayISO)
    const schedule = schedules.get(weekMonday)
    if (!schedule) {
      weeksWithoutScheduleSet.add(weekMonday)
    }

    const vac = getVacationOnDay(dayISO, vacations)
    if (vac.found) {
      if (vac.paid) {
        const hours = Math.round(dailyContract * 100) / 100
        totalWorkedHours += hours
        totalVacationHours += hours
        totalContracted += dailyContract
        daysDetail.push({
          date: dayISO,
          workedHours: hours,
          contractedShare: dailyContract,
          source: 'ausencia_retribuida',
        })
      } else {
        daysDetail.push({
          date: dayISO,
          workedHours: 0,
          contractedShare: 0,
          source: 'ausencia_no_retribuida',
        })
      }
      continue
    }

    const clocked = getClockedHoursForDay(dayISO, clockEntries)
    const scheduledH = getScheduledHoursForDay(dayISO, schedule, templates, employee)

    if (clocked.complete && clocked.hours > 0) {
      let alert: DayAlert | undefined
      if (scheduledH > 0) {
        const diffMin = Math.round((clocked.hours - scheduledH) * 60)
        if (Math.abs(diffMin) > DESVIATION_ALERT_THRESHOLD) {
          alert = {
            type: 'desviacion_grande',
            date: dayISO,
            scheduledHours: scheduledH,
            clockedHours: clocked.hours,
            diffMinutes: diffMin,
            message: `Desviación ${diffMin > 0 ? '+' : ''}${diffMin} min vs planificado`,
          }
          alerts.push(alert)
        }
      } else {
        alert = {
          type: 'sin_horario',
          date: dayISO,
          clockedHours: clocked.hours,
          message: `Fichó ${clocked.hours.toFixed(2)}h sin horario planificado`,
        }
        alerts.push(alert)
      }
      totalWorkedHours += clocked.hours
      totalContracted += dailyContract
      daysDetail.push({
        date: dayISO,
        workedHours: clocked.hours,
        contractedShare: dailyContract,
        source: 'fichaje',
        alert,
      })
      continue
    }

    if (scheduledH > 0) {
      let alert: DayAlert | undefined
      const today = isoDate(new Date())
      if (dayISO < today) {
        alert = {
          type: 'sin_fichaje',
          date: dayISO,
          scheduledHours: scheduledH,
          message: `Sin fichaje, se asumen ${scheduledH.toFixed(2)}h planificadas`,
        }
        alerts.push(alert)
      }
      totalWorkedHours += scheduledH
      totalContracted += dailyContract
      daysDetail.push({
        date: dayISO,
        workedHours: scheduledH,
        contractedShare: dailyContract,
        source: 'planificado',
        alert,
      })
      continue
    }

    daysDetail.push({
      date: dayISO,
      workedHours: 0,
      contractedShare: 0,
      source: 'libre',
    })
  }

  const scheduledHours = Math.round(totalWorkedHours * 100) / 100
  const vacationHours = Math.round(totalVacationHours * 100) / 100
  const contractedHoursPeriod = Math.round(totalContracted * 100) / 100
  const delta = Math.round((scheduledHours - contractedHoursPeriod) * 100) / 100

  return {
    scheduledHours,
    vacationHours,
    contractedHoursPeriod,
    delta,
    weeksWithoutSchedule: Array.from(weeksWithoutScheduleSet),
    alerts,
    daysDetail,
  }
}

/* =====================================================
   API PÚBLICA: estado completo del empleado
   ===================================================== */

export interface EmployeeBalanceStateExtended extends EmployeeBalanceState {
  alerts: DayAlert[]
  daysDetail: DayBalance[]
}

export async function getEmployeeBalanceState(
  employee: Employee,
  closeDay: number,
  options?: { today?: Date }
): Promise<EmployeeBalanceStateExtended> {
  const today = options?.today || new Date()
  const contractedHours = employee.weeklyHours || 40
  const initialBalance = (employee as any).initialHoursBalance || 0
  const locationId = employee.locationId

  if (!locationId) {
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      shiftCode: employee.shiftCode,
      contractedHours,
      initialBalance,
      currentPeriod: emptyPeriod(getPeriodForDate(today, closeDay)),
      pendingClosures: [],
      resolvedClosures: [],
      alerts: [],
      daysDetail: [],
    }
  }

  const currentPeriodInfo = getPeriodForDate(today, closeDay)
  const allWeeks = weeksTouchingPeriod(currentPeriodInfo.start, currentPeriodInfo.end)

  const [schedulesMap, templates, vacations, clockEntries, closures] = await Promise.all([
    loadPublishedSchedules(locationId, allWeeks),
    loadShiftTemplates(locationId),
    loadApprovedVacations(employee.id),
    loadClockEntriesForPeriod(employee.id, currentPeriodInfo.start, currentPeriodInfo.end),
    loadClosuresForEmployee(employee.id),
  ])

  const calc = computePeriodBalanceHybrid({
    employee,
    periodStart: currentPeriodInfo.start,
    periodEnd: currentPeriodInfo.end,
    schedules: schedulesMap,
    templates,
    vacations,
    clockEntries,
  })

  const matchedClosure = closures.find(
    c => c.periodStart === currentPeriodInfo.start && c.periodEnd === currentPeriodInfo.end
  )

  const currentPeriod: PeriodBalance = {
    periodLabel: currentPeriodInfo.label,
    periodStart: currentPeriodInfo.start,
    periodEnd: currentPeriodInfo.end,
    scheduledHours: calc.scheduledHours,
    vacationHours: calc.vacationHours,
    contractedHoursPeriod: calc.contractedHoursPeriod,
    delta: calc.delta,
    weeksWithoutSchedule: calc.weeksWithoutSchedule,
    isClosed: !!matchedClosure,
    closure: matchedClosure,
  }

  const pendingClosures = closures.filter(c => c.resolution === 'pendiente')
  const resolvedClosures = closures.filter(c => c.resolution !== 'pendiente')

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    shiftCode: employee.shiftCode,
    contractedHours,
    initialBalance,
    currentPeriod,
    pendingClosures,
    resolvedClosures,
    alerts: calc.alerts,
    daysDetail: calc.daysDetail,
  }
}

function emptyPeriod(info: { label: string; start: string; end: string }): PeriodBalance {
  return {
    periodLabel: info.label,
    periodStart: info.start,
    periodEnd: info.end,
    scheduledHours: 0,
    vacationHours: 0,
    contractedHoursPeriod: 0,
    delta: 0,
    weeksWithoutSchedule: [],
    isClosed: false,
  }
}

/* =====================================================
   CIERRE MANUAL DE UN PERIODO
   ===================================================== */

export async function closePeriodForEmployee(
  employee: Employee,
  closeDay: number,
  options?: { closedBy?: string; useDate?: Date }
): Promise<MonthlyBalanceClosure | null> {
  if (!supabase) return null
  const refDate = options?.useDate || new Date()
  const periodInfo = getPeriodForDate(refDate, closeDay)

  const locationId = employee.locationId
  if (!locationId) {
    console.warn('[closePeriod] Empleado sin locationId')
    return null
  }

  const { data: existing } = await supabase
    .from('monthly_balance_closures')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('period_start', periodInfo.start)
    .eq('period_end', periodInfo.end)
    .maybeSingle()

  if (existing) {
    return rowToClosure(existing)
  }

  const weeks = weeksTouchingPeriod(periodInfo.start, periodInfo.end)
  const [schedulesMap, templates, vacations, clockEntries] = await Promise.all([
    loadPublishedSchedules(locationId, weeks),
    loadShiftTemplates(locationId),
    loadApprovedVacations(employee.id),
    loadClockEntriesForPeriod(employee.id, periodInfo.start, periodInfo.end),
  ])

  const calc = computePeriodBalanceHybrid({
    employee,
    periodStart: periodInfo.start,
    periodEnd: periodInfo.end,
    schedules: schedulesMap,
    templates,
    vacations,
    clockEntries,
  })

  const { data, error } = await supabase
    .from('monthly_balance_closures')
    .insert({
      employee_id: employee.id,
      location_id: locationId,
      period_label: periodInfo.label,
      period_start: periodInfo.start,
      period_end: periodInfo.end,
      scheduled_hours: calc.scheduledHours,
      vacation_hours: calc.vacationHours,
      contracted_hours_period: calc.contractedHoursPeriod,
      delta: calc.delta,
      resolution: 'pendiente',
      closed_by: options?.closedBy || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[closePeriod] Error:', error)
    return null
  }
  return rowToClosure(data)
}

export async function closePeriodForLocation(
  locationId: string,
  employees: Employee[],
  closeDay: number,
  options?: { closedBy?: string; useDate?: Date }
): Promise<{ created: MonthlyBalanceClosure[]; existing: number }> {
  const created: MonthlyBalanceClosure[] = []
  let existing = 0
  const empsOfLocation = employees.filter(e =>
    e.active && (e.locationId === locationId ||
      (e.assignedLocations || []).includes(locationId))
  )
  for (const emp of empsOfLocation) {
    const result = await closePeriodForEmployee(emp, closeDay, options)
    if (result) {
      const justCreated = result.closedAt &&
        Math.abs(Date.now() - new Date(result.closedAt).getTime()) < 5000
      if (justCreated) created.push(result)
      else existing++
    }
  }
  return { created, existing }
}

/* =====================================================
   RESOLUCIÓN DE UN CIERRE
   ===================================================== */

export async function resolveClosure(
  closureId: string,
  resolution: ClosureResolution,
  options?: {
    notes?: string
    amount?: number
    resolvedBy?: string
  }
): Promise<MonthlyBalanceClosure | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('monthly_balance_closures')
    .update({
      resolution,
      resolution_notes: options?.notes || null,
      resolution_amount: options?.amount ?? null,
      resolved_at: new Date().toISOString(),
      resolved_by: options?.resolvedBy || null,
    })
    .eq('id', closureId)
    .select()
    .single()

  if (error) {
    console.error('[resolveClosure] Error:', error)
    return null
  }
  return rowToClosure(data)
}

export async function getAllEmployeesBalanceStates(
  employees: Employee[],
  closeDay: number,
  options?: { today?: Date }
): Promise<EmployeeBalanceStateExtended[]> {
  const promises = employees.map(emp => getEmployeeBalanceState(emp, closeDay, options))
  return await Promise.all(promises)
}

/* =====================================================
   CONFIG DE CIERRE EFECTIVO
   ===================================================== */

export interface LocationBalanceConfig {
  closeDay: number
  syncWithGestoria: boolean
  gestoriaDay?: number
}

export function getEffectiveCloseDay(config: LocationBalanceConfig): number {
  if (config.syncWithGestoria && config.gestoriaDay) {
    return config.gestoriaDay
  }
  return config.closeDay
}

/* =====================================================
   AUTO-CIERRE LAZY: detectar periodo anterior no cerrado
   ===================================================== */

/**
 * Devuelve el periodo INMEDIATAMENTE ANTERIOR al actual.
 * Útil para detectar qué periodo debería estar cerrado pero no lo está.
 */
export function getPreviousPeriod(closeDay: number, today = new Date()): {
  label: string
  start: string
  end: string
} {
  // El periodo anterior termina justo antes del inicio del actual
  const currentPeriod = getPeriodForDate(today, closeDay)
  // Tomar un día antes del inicio del periodo actual
  const dayBefore = parseISO(currentPeriod.start)
  dayBefore.setDate(dayBefore.getDate() - 1)
  return getPeriodForDate(dayBefore, closeDay)
}

/**
 * Comprueba si el periodo anterior del local YA HA TERMINADO (es decir, hoy >= periodEnd+1)
 * y si todos los empleados del local tienen ese periodo cerrado.
 *
 * Devuelve:
 * - shouldClose: true si hay que cerrar el periodo anterior
 * - period: info del periodo anterior
 * - employeesNotClosed: lista de empleados sin cierre para ese periodo
 */
export async function detectPendingAutoClose(
  locationId: string,
  employees: Employee[],
  closeDay: number,
  today = new Date()
): Promise<{
  shouldClose: boolean
  period: { label: string; start: string; end: string }
  employeesNotClosed: Employee[]
}> {
  const previousPeriod = getPreviousPeriod(closeDay, today)
  // Comprobar que el periodo anterior YA terminó (hoy > periodEnd)
  const todayISO = isoDate(today)
  if (todayISO <= previousPeriod.end) {
    return { shouldClose: false, period: previousPeriod, employeesNotClosed: [] }
  }

  // Filtrar empleados del local
  const empsOfLocation = employees.filter(e =>
    e.active && (e.locationId === locationId ||
      (e.assignedLocations || []).includes(locationId))
  )

  if (empsOfLocation.length === 0) {
    return { shouldClose: false, period: previousPeriod, employeesNotClosed: [] }
  }

  if (!supabase) {
    return { shouldClose: false, period: previousPeriod, employeesNotClosed: [] }
  }

  // Buscar cierres existentes para ese periodo y esos empleados
  const empIds = empsOfLocation.map(e => e.id)
  const { data, error } = await supabase
    .from('monthly_balance_closures')
    .select('employee_id')
    .in('employee_id', empIds)
    .eq('period_start', previousPeriod.start)
    .eq('period_end', previousPeriod.end)

  if (error) {
    console.warn('[detectPendingAutoClose] Error:', error)
    return { shouldClose: false, period: previousPeriod, employeesNotClosed: [] }
  }

  const closedIds = new Set((data || []).map((r: any) => r.employee_id))
  const employeesNotClosed = empsOfLocation.filter(e => !closedIds.has(e.id))

  return {
    shouldClose: employeesNotClosed.length > 0,
    period: previousPeriod,
    employeesNotClosed,
  }
}

/**
 * Ejecuta el auto-cierre del periodo anterior para los empleados que faltan
 */
export async function executeAutoClose(
  employeesNotClosed: Employee[],
  closeDay: number,
  options?: { closedBy?: string }
): Promise<{ created: MonthlyBalanceClosure[]; failed: number }> {
  const created: MonthlyBalanceClosure[] = []
  let failed = 0
  // useDate apunta a un día del periodo anterior (su periodEnd)
  const previousPeriod = getPreviousPeriod(closeDay)
  const useDate = parseISO(previousPeriod.end)

  for (const emp of employeesNotClosed) {
    const result = await closePeriodForEmployee(emp, closeDay, {
      ...options,
      useDate,
    })
    if (result) {
      created.push(result)
    } else {
      failed++
    }
  }
  return { created, failed }
}

export { weeksTouchingPeriod, daysOfWeekInPeriod }
export { DESVIATION_ALERT_THRESHOLD, ROUNDING_TOLERANCE_MIN }
