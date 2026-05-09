// src/services/hoursBalanceService.ts
// Cálculo de bolsa de horas con periodos mensuales (cierre día N → día N siguiente mes)

import { supabase } from '../lib/supabase'
import type { Employee } from '../types'
import type { ShiftTemplate, Schedule } from '../types/scheduler'
import { computeWorkloads } from './scheduleGenerator'
import {
  type ClosureResolution,
  type MonthlyBalanceClosure,
  type PeriodBalance,
  type EmployeeBalanceState,
  getPeriodForDate,
  weeksTouchingPeriod,
  daysOfWeekInPeriod,
  daysInPeriod,
} from '../types/hoursBalance'

/* =====================================================
   Carga de datos
   ===================================================== */

interface VacationRow {
  start_date: string
  end_date: string
  status: string
}

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
    .select('start_date, end_date, status')
    .eq('employee_id', employeeId)
    .eq('status', 'aprobada')
  if (error) {
    console.warn('[hoursBalance] Error cargando vacations:', error)
    return []
  }
  return (data || []) as VacationRow[]
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
   Cálculo del saldo de un periodo concreto
   ===================================================== */

interface ComputePeriodInput {
  employee: Employee
  periodStart: string
  periodEnd: string
  schedules: Map<string, Schedule>
  templates: ShiftTemplate[]
  vacations: VacationRow[]
}

function computePeriodBalance(
  input: ComputePeriodInput
): {
  scheduledHours: number
  vacationHours: number
  contractedHoursPeriod: number
  delta: number
  weeksWithoutSchedule: string[]
} {
  const { employee, periodStart, periodEnd, schedules, templates, vacations } = input
  const contractedWeekly = employee.weeklyHours || 40

  // 1) Horas planificadas: para cada semana que toca el periodo, calcular horas del empleado
  //    en esa semana y prorratear por días de la semana que caen dentro del periodo.
  const weeks = weeksTouchingPeriod(periodStart, periodEnd)
  let scheduledHours = 0
  const weeksWithoutSchedule: string[] = []
  for (const weekStart of weeks) {
    const sched = schedules.get(weekStart)
    if (!sched) {
      weeksWithoutSchedule.push(weekStart)
      continue
    }
    const workloads = computeWorkloads(sched.cells, templates, [employee])
    const w = workloads.find(x => x.employee_id === employee.id)
    const weekHours = w ? w.assigned_hours : 0
    // Prorrateo por días que caen dentro del periodo
    const daysInThisPeriod = daysOfWeekInPeriod(weekStart, periodStart, periodEnd)
    const fraction = daysInThisPeriod / 7
    scheduledHours += weekHours * fraction
  }
  scheduledHours = Math.round(scheduledHours * 100) / 100

  // 2) Vacaciones aprobadas dentro del periodo
  let vacationDays = 0
  for (const v of vacations) {
    vacationDays += daysInPeriod(v.start_date, v.end_date, periodStart, periodEnd)
  }
  const vacationHours = Math.round((vacationDays * contractedWeekly / 7) * 100) / 100

  // 3) Horas contratadas del periodo: nº de días del periodo / 7 × contrato semanal
  const totalDaysOfPeriod = daysInPeriod(periodStart, periodEnd, periodStart, periodEnd)
  const contractedHoursPeriod = Math.round((totalDaysOfPeriod * contractedWeekly / 7) * 100) / 100

  // 4) Delta
  const delta = Math.round((scheduledHours + vacationHours - contractedHoursPeriod) * 100) / 100

  return {
    scheduledHours,
    vacationHours,
    contractedHoursPeriod,
    delta,
    weeksWithoutSchedule,
  }
}

/* =====================================================
   API pública: estado completo del empleado
   ===================================================== */

export async function getEmployeeBalanceState(
  employee: Employee,
  closeDay: number,
  options?: { today?: Date }
): Promise<EmployeeBalanceState> {
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
    }
  }

  // Periodo actual
  const currentPeriodInfo = getPeriodForDate(today, closeDay)

  // Cargar todos los datos necesarios
  const allWeeks = weeksTouchingPeriod(currentPeriodInfo.start, currentPeriodInfo.end)
  const [schedulesMap, templates, vacations, closures] = await Promise.all([
    loadPublishedSchedules(locationId, allWeeks),
    loadShiftTemplates(locationId),
    loadApprovedVacations(employee.id),
    loadClosuresForEmployee(employee.id),
  ])

  // Calcular saldo del periodo actual
  const currentCalc = computePeriodBalance({
    employee,
    periodStart: currentPeriodInfo.start,
    periodEnd: currentPeriodInfo.end,
    schedules: schedulesMap,
    templates,
    vacations,
  })

  // Comprobar si ya está cerrado (no debería, salvo edición manual)
  const matchedClosure = closures.find(
    c => c.periodStart === currentPeriodInfo.start && c.periodEnd === currentPeriodInfo.end
  )

  const currentPeriod: PeriodBalance = {
    periodLabel: currentPeriodInfo.label,
    periodStart: currentPeriodInfo.start,
    periodEnd: currentPeriodInfo.end,
    scheduledHours: currentCalc.scheduledHours,
    vacationHours: currentCalc.vacationHours,
    contractedHoursPeriod: currentCalc.contractedHoursPeriod,
    delta: currentCalc.delta,
    weeksWithoutSchedule: currentCalc.weeksWithoutSchedule,
    isClosed: !!matchedClosure,
    closure: matchedClosure,
  }

  // Cierres: separar pendientes de resueltos
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
   Cierre manual de un periodo
   ===================================================== */

export async function closePeriodForEmployee(
  employee: Employee,
  closeDay: number,
  options?: { closedBy?: string; useDate?: Date }
): Promise<MonthlyBalanceClosure | null> {
  if (!supabase) return null
  const refDate = options?.useDate || new Date()
  // Cerrar el periodo que TERMINA en o antes de refDate
  const periodInfo = getPeriodForDate(refDate, closeDay)

  const locationId = employee.locationId
  if (!locationId) {
    console.warn('[closePeriod] Empleado sin locationId')
    return null
  }

  // Comprobar si ya existe cierre
  const { data: existing } = await supabase
    .from('monthly_balance_closures')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('period_start', periodInfo.start)
    .eq('period_end', periodInfo.end)
    .maybeSingle()

  if (existing) {
    console.log('[closePeriod] Ya existe cierre para este periodo')
    return rowToClosure(existing)
  }

  // Cargar datos para calcular
  const weeks = weeksTouchingPeriod(periodInfo.start, periodInfo.end)
  const [schedulesMap, templates, vacations] = await Promise.all([
    loadPublishedSchedules(locationId, weeks),
    loadShiftTemplates(locationId),
    loadApprovedVacations(employee.id),
  ])

  const calc = computePeriodBalance({
    employee,
    periodStart: periodInfo.start,
    periodEnd: periodInfo.end,
    schedules: schedulesMap,
    templates,
    vacations,
  })

  // Insertar
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

/** Cerrar el periodo actual para TODOS los empleados activos del local */
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
      // Si ya existía, lo distinguimos comparando closedAt cercano
      const justCreated = result.closedAt &&
        Math.abs(Date.now() - new Date(result.closedAt).getTime()) < 5000
      if (justCreated) created.push(result)
      else existing++
    }
  }
  return { created, existing }
}

/* =====================================================
   Resolución de un cierre
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

/* =====================================================
   Carga masiva para vista del gestor
   ===================================================== */

export async function getAllEmployeesBalanceStates(
  employees: Employee[],
  closeDay: number,
  options?: { today?: Date }
): Promise<EmployeeBalanceState[]> {
  const promises = employees.map(emp => getEmployeeBalanceState(emp, closeDay, options))
  return await Promise.all(promises)
}

/* =====================================================
   Determinar el closeDay efectivo para un local
   ===================================================== */

export interface LocationBalanceConfig {
  closeDay: number
  syncWithGestoria: boolean
  /** Si syncWithGestoria=true, este es el día configurado en Informes Gestoría */
  gestoriaDay?: number
}

export function getEffectiveCloseDay(config: LocationBalanceConfig): number {
  if (config.syncWithGestoria && config.gestoriaDay) {
    return config.gestoriaDay
  }
  return config.closeDay
}
