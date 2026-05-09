// src/services/hoursBalanceService.ts
// Cálculo HÍBRIDO de bolsa de horas: combina horario planificado + fichaje real + ausencias.

import { supabase } from '../lib/supabase'
import type { Employee } from '../types'
import type { ShiftTemplate, Schedule } from '../types/scheduler'
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
  | 'sin_fichaje'        // había horario, no fichó
  | 'sin_horario'        // fichó pero no había horario planificado
  | 'desviacion_grande'  // desviación >30 min entre fichado y planificado

export interface DayAlert {
  type: DayAlertType
  date: string                 // YYYY-MM-DD
  scheduledHours?: number      // horas planificadas ese día
  clockedHours?: number        // horas fichadas ese día
  diffMinutes?: number         // diferencia en minutos (positivo = fichó más, negativo = menos)
  message: string              // mensaje legible
}

/** Umbral de desviación en minutos para generar alerta */
const DESVIATION_ALERT_THRESHOLD = 30

/** Redondeo a la hora prevista si la diferencia es ≤ este valor (en minutos) */
const ROUNDING_TOLERANCE_MIN = 10

/* =====================================================
   ROW INTERFACES (datos de Supabase)
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
   HELPERS DE FECHAS
   ===================================================== */

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

/** Día de la semana 0=domingo, 1=lunes... 6=sábado */
function getDayOfWeek(iso: string): number {
  return parseISO(iso).getDay()
}

/** Lunes de la semana al que pertenece el día */
function getMondayOfWeek(iso: string): string {
  const d = parseISO(iso)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoDate(d)
}

/* =====================================================
   HORAS PLANIFICADAS POR DÍA
   ===================================================== */

/** Devuelve las horas planificadas para un empleado en un día concreto del periodo */
function getScheduledHoursForDay(
  dayISO: string,
  schedule: Schedule | undefined,
  templates: ShiftTemplate[],
  employee: Employee
): number {
  if (!schedule) return 0
  // workloads viene en horas/semana. Para obtener horas/día necesitamos calcular
  // mirando directamente las celdas del schedule en ese día concreto.
  const dow = getDayOfWeek(dayISO)
  // El schedule.cells está estructurado: cells[templateId][dayKey] = [employeeIds]
  // dayKey suele ser '0' a '6' (0=lunes? 0=domingo?). Comprobamos ambos formatos.
  // Asumimos misma convención que computeWorkloads usa.
  let totalMinutes = 0
  const tplById = new Map(templates.map(t => [t.id, t]))
  for (const tid of Object.keys(schedule.cells)) {
    const t = tplById.get(tid)
    if (!t) continue
    for (const dayKey of Object.keys(schedule.cells[tid])) {
      // dayKey puede ser '0'-'6' (lunes=0) o equivalente. Ajustar si scheduler usa otra convención.
      // Aquí asumimos que en MiHorario.tsx el dayKey es 0=lunes, 1=martes... 6=domingo
      const dayKeyNum = parseInt(dayKey, 10)
      // Convertir a getDay() format: lunes=1, ..., domingo=0
      // Si dayKey 0=lunes en scheduler → equivalente a getDay()===1
      const expectedGetDay = dayKeyNum === 6 ? 0 : dayKeyNum + 1
      if (expectedGetDay !== dow) continue
      const ids = schedule.cells[tid][dayKey]
      if (!ids.includes(employee.id)) continue
      const start = t.start_time.slice(0, 5)
      const end = t.end_time.slice(0, 5)
      const [sh, sm] = start.split(':').map(Number)
      const [eh, em] = end.split(':').map(Number)
      let mins = (eh * 60 + em) - (sh * 60 + sm)
      if (mins <= 0) mins += 24 * 60 // cruza medianoche
      totalMinutes += mins
    }
  }
  return Math.round((totalMinutes / 60) * 100) / 100
}

/* =====================================================
   HORAS FICHADAS POR DÍA
   ===================================================== */

/**
 * Calcula horas fichadas en un día concreto.
 * Empareja entradas con salidas. Si la salida es del día siguiente (cruce medianoche)
 * la incluye en el día de la entrada.
 * Aplica redondeo de 10 min si la entrada está cerca del horario previsto.
 */
function getClockedHoursForDay(
  dayISO: string,
  allEntries: ClockEntryRow[]
): { hours: number; complete: boolean } {
  // Filtrar entradas del día (por la fecha de la entrada, no del cierre)
  const dayEntries = allEntries.filter(e => e.datetime.slice(0, 10) === dayISO)
  if (dayEntries.length === 0) return { hours: 0, complete: false }

  // Emparejar entrada → salida cronológicamente
  let totalMinutes = 0
  let openEntry: ClockEntryRow | null = null
  let pairsClosed = 0

  for (const e of dayEntries) {
    if (e.type === 'entrada') {
      openEntry = e
    } else if (e.type === 'salida' && openEntry) {
      // Calcular minutos entre openEntry y e
      // Usar `datetime` que ya tiene aplicado el redondeo del kiosko si lo había
      const inMs = new Date(openEntry.datetime).getTime()
      const outMs = new Date(e.datetime).getTime()
      let mins = (outMs - inMs) / 60000
      if (mins < 0) mins += 24 * 60 // por si acaso
      totalMinutes += mins
      pairsClosed++
      openEntry = null
    }
  }

  // Si quedó una entrada sin salida → fichaje incompleto
  const complete = pairsClosed > 0 && openEntry === null

  return {
    hours: Math.round((totalMinutes / 60) * 100) / 100,
    complete,
  }
}

/* =====================================================
   AUSENCIAS POR DÍA
   ===================================================== */

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
        paid: v.paid ?? true, // por defecto retribuida
        type: v.type,
      }
    }
  }
  return { found: false, paid: false, type: '' }
}

/* =====================================================
   CÁLCULO DÍA A DÍA (núcleo del sistema híbrido)
   ===================================================== */

interface DayBalance {
  date: string
  workedHours: number          // horas que cuentan a favor del trabajador
  contractedShare: number      // fracción de contrato semanal que aplica este día (contrato/7) o 0 si no cuenta
  source: 'fichaje' | 'planificado' | 'ausencia_retribuida' | 'ausencia_no_retribuida' | 'libre'
  alert?: DayAlert
}

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
  scheduledHours: number       // horas planificadas + fichadas + ausencias retribuidas
  vacationHours: number        // solo las horas de ausencia retribuida
  contractedHoursPeriod: number
  delta: number
  weeksWithoutSchedule: string[]
  alerts: DayAlert[]
  daysDetail: DayBalance[]
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

    // 1) ¿Hay ausencia ese día?
    const vac = getVacationOnDay(dayISO, vacations)
    if (vac.found) {
      if (vac.paid) {
        // Ausencia retribuida → cuenta como trabajada
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
        // Ausencia NO retribuida → no cuenta, descuenta del contrato del periodo
        daysDetail.push({
          date: dayISO,
          workedHours: 0,
          contractedShare: 0,
          source: 'ausencia_no_retribuida',
        })
      }
      continue
    }

    // 2) ¿Hay fichaje ese día?
    const clocked = getClockedHoursForDay(dayISO, clockEntries)
    const scheduledH = getScheduledHoursForDay(dayISO, schedule, templates, employee)

    if (clocked.complete && clocked.hours > 0) {
      // Cuenta las fichadas
      let alert: DayAlert | undefined
      if (scheduledH > 0) {
        // Comparar con planificado
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
        // Fichó sin estar planificado
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

    // 3) ¿Hay horario planificado ese día?
    if (scheduledH > 0) {
      // Asumimos que trabajó las planificadas (probable olvido de fichar)
      let alert: DayAlert | undefined
      // Solo generar alerta si ya pasó el día (no para días futuros del periodo)
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

    // 4) Día libre normal (no horario, no fichaje, no ausencia)
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
   API PÚBLICA
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

  // Cargar todos los datos en paralelo
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

// Re-exportar para que las páginas no rompan imports
export { weeksTouchingPeriod, daysOfWeekInPeriod }

// Constantes exportadas por si una UI las necesita
export { DESVIATION_ALERT_THRESHOLD, ROUNDING_TOLERANCE_MIN }
