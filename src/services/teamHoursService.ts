// src/services/teamHoursService.ts
// F4.2/F4.3 — RPCs de horas y coste real del equipo (team_hours_summary,
// employee_daily_detail). Motores verificados en BBDD el 07/08 (ver
// ENCARGO_CODE_team_F4_arranque.md). db() laxo por la deuda de database.ts
// (funciones nuevas aún no tipadas) — mismo patrón que teamLaborService.ts.

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

/**
 * Una fila por empleado activo de la cuenta (y local, si se filtra).
 * SECURITY INVOKER: la RLS ya acota a la cuenta del caller.
 */
export interface TeamHoursSummaryRow {
  employeeId: string
  employeeName: string
  locationId: string
  contractedHours: number  // prorrateado por alta/baja dentro del periodo
  workedHours: number
  vacationHours: number
  nightHours: number
  deltaHours: number       // bolsa: trabajado+ausencia_pagada - contratado
  laborCost: number        // coste real de nóminas de los meses del periodo
  costIsPartial: boolean   // true = falta alguna nómina del periodo; NO ocultar, marcar
}

export async function fetchTeamHoursSummary(
  accountId: string,
  from: string,
  to: string,
  locationId?: string | null
): Promise<TeamHoursSummaryRow[]> {
  const { data, error } = await db().rpc('team_hours_summary', {
    p_account_id: accountId,
    p_from: from,
    p_to: to,
    p_location_id: locationId || null,
  })
  if (error) {
    console.error('[teamHours] team_hours_summary:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    locationId: r.location_id,
    contractedHours: Number(r.contracted_hours) || 0,
    workedHours: Number(r.worked_hours) || 0,
    vacationHours: Number(r.vacation_hours) || 0,
    nightHours: Number(r.night_hours) || 0,
    deltaHours: Number(r.delta_hours) || 0,
    laborCost: Number(r.labor_cost) || 0,
    costIsPartial: !!r.cost_is_partial,
  }))
}

/**
 * Día a día de un empleado, anclado a la ENTRADA (F1.4) — evita que un turno
 * de noche que cruza medianoche se parta en dos jornadas fantasma.
 */
export interface EmployeeDailyDetailRow {
  workDate: string
  startedAt: string | null
  endedAt: string | null
  workedMinutes: number
  presenceMinutes: number
  breakMinutes: number
  nightMinutes: number
  // Presencia >11h o salida de madrugada: probable olvido de fichar la salida.
  // Mostrar en ámbar, no contar como jornada real en totales sin avisar.
  looksLikeForgottenClockout: boolean
}

export async function fetchEmployeeDailyDetail(
  employeeId: string,
  from: string,
  to: string
): Promise<EmployeeDailyDetailRow[]> {
  const { data, error } = await db().rpc('employee_daily_detail', {
    p_employee_id: employeeId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    console.error('[teamHours] employee_daily_detail:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    workDate: r.work_date,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    workedMinutes: Number(r.worked_minutes) || 0,
    presenceMinutes: Number(r.presence_minutes) || 0,
    breakMinutes: Number(r.break_minutes) || 0,
    nightMinutes: Number(r.night_minutes) || 0,
    looksLikeForgottenClockout: !!r.looks_like_forgotten_clockout,
  }))
}

/**
 * Bolsa de un empleado en un periodo (base de la pestaña "Bolsa" de la ficha,
 * F2, motor ya en producción). effective_hours = worked + paid_absence.
 */
export interface EmployeeBalanceRow {
  contractedHours: number
  workedHours: number
  paidAbsenceHours: number
  effectiveHours: number
  deltaHours: number
  nightHours: number
}

export async function fetchEmployeeBalance(
  employeeId: string,
  from: string,
  to: string
): Promise<EmployeeBalanceRow | null> {
  const { data, error } = await db().rpc('compute_employee_balance', {
    p_employee_id: employeeId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    console.error('[teamHours] compute_employee_balance:', error)
    return null
  }
  const r = (data as unknown[])[0] as Record<string, unknown> | undefined
  if (!r) return null
  return {
    contractedHours: Number(r.contracted_hours) || 0,
    workedHours: Number(r.worked_hours) || 0,
    paidAbsenceHours: Number(r.paid_absence_hours) || 0,
    effectiveHours: Number(r.effective_hours) || 0,
    deltaHours: Number(r.delta_hours) || 0,
    nightHours: Number(r.night_hours) || 0,
  }
}
