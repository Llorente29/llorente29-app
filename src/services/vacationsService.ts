// src/services/vacationsService.ts
import { supabase } from '../lib/supabase'
import type { VacationRequest, VacationStatus, VacationSettings, VacationType } from '../types/personal'

interface VacRow {
  id: string
  employee_id: string
  type: string
  start_date: string
  end_date: string
  days: number
  status: VacationStatus
  notes: string | null
  requested_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  review_notes: string | null
  alert_min_staff: boolean | null
  alert_lead_time: boolean | null
  paid: boolean | null
  created_at: string
}

function rowToVacation(r: VacRow): VacationRequest {
  return {
    id: r.id,
    employeeId: r.employee_id,
    type: r.type as VacationType,
    startDate: r.start_date,
    endDate: r.end_date,
    days: Number(r.days),
    status: r.status,
    notes: r.notes || undefined,
    requestedAt: r.requested_at,
    reviewedAt: r.reviewed_at || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewNotes: r.review_notes || undefined,
    alertMinStaff: r.alert_min_staff ?? undefined,
    alertLeadTime: r.alert_lead_time ?? undefined,
    paid: r.paid ?? true,
    createdAt: r.created_at,
  }
}

export async function fetchVacations(employeeId?: string): Promise<VacationRequest[] | null> {
  if (!supabase) return null
  let query = supabase.from('vacations').select('*').order('start_date', { ascending: false })
  if (employeeId) query = query.eq('employee_id', employeeId)
  const { data, error } = await query
  if (error) { console.error('fetchVacations:', error); return null }
  return (data as VacRow[]).map(rowToVacation)
}

export async function fetchPendingVacations(): Promise<VacationRequest[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('vacations')
    .select('*').eq('status', 'solicitada').order('requested_at', { ascending: false })
  if (error) { console.error('fetchPendingVacations:', error); return null }
  return (data as VacRow[]).map(rowToVacation)
}

export async function requestVacation(
  employeeId: string,
  type: VacationType,
  startDate: string,
  endDate: string,
  days: number,
  notes: string,
  alertLeadTime: boolean,
  paid: boolean = true,
): Promise<VacationRequest | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('vacations').insert({
    employee_id: employeeId,
    type,
    start_date: startDate,
    end_date: endDate,
    days,
    status: 'solicitada',
    notes: notes || null,
    requested_at: new Date().toISOString(),
    alert_lead_time: alertLeadTime,
    paid,
  }).select().single()
  if (error) { console.error('requestVacation:', error); throw new Error('Error solicitando: ' + error.message) }
  return rowToVacation(data as VacRow)
}

export async function reviewVacation(
  id: string,
  status: 'aprobada' | 'rechazada',
  reviewedBy: string | null,
  reviewNotes: string,
  alertMinStaff: boolean,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('vacations').update({
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewedBy,
    review_notes: reviewNotes || null,
    alert_min_staff: alertMinStaff,
  }).eq('id', id)
  if (error) { console.error('reviewVacation:', error); return false }
  return true
}

export async function updateVacationPaid(id: string, paid: boolean): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('vacations').update({ paid }).eq('id', id)
  if (error) { console.error('updateVacationPaid:', error); return false }
  return true
}

export async function cancelVacation(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('vacations').update({ status: 'cancelada' }).eq('id', id)
  if (error) { console.error('cancelVacation:', error); return false }
  return true
}

export async function deleteVacation(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('vacations').delete().eq('id', id)
  if (error) { console.error('deleteVacation:', error); return false }
  return true
}

// ─── Settings ─────────────────────────────────────────────────────────────
//
// vacation_settings tiene account_id (una fila scope='global' POR CUENTA).
// - Para LEER desde un contexto donde el usuario pertenece a una sola cuenta
//   (trabajador, manager), la RLS ya acota a esa cuenta → no hace falta pasar
//   accountId (fetchVacationSettings() sin argumento sigue valiendo).
// - Para un SUPERADMIN que ve varias cuentas, hay que pasar accountId para
//   obtener la fila de la cuenta concreta que se está mirando.
// - Para ESCRIBIR siempre se exige accountId: con una fila global por cuenta,
//   no acotar dispararía el update sobre TODAS las cuentas que el usuario pueda
//   escribir (un superadmin tocaría todas). El accountId lo aporta el front
//   (useActiveAccount), nunca se deduce en SQL.

interface SettingsRow {
  id: string
  scope: 'global' | 'employee'
  employee_id: string | null
  vacation_days_per_year: number
  asuntos_propios_per_year: number
  min_staff_per_location: number
  min_lead_days: number
  request_types_disabled: string[] | null
  created_at: string
  updated_at: string
}

function rowToSettings(r: SettingsRow): VacationSettings {
  return {
    id: r.id,
    scope: r.scope,
    employeeId: r.employee_id || undefined,
    vacationDaysPerYear: Number(r.vacation_days_per_year),
    asuntosPropiosPerYear: Number(r.asuntos_propios_per_year),
    minStaffPerLocation: r.min_staff_per_location,
    minLeadDays: r.min_lead_days,
    requestTypesDisabled: (r.request_types_disabled ?? []) as VacationType[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function fetchVacationSettings(accountId?: string): Promise<VacationSettings[] | null> {
  if (!supabase) return null
  let query = supabase.from('vacation_settings').select('*')
  if (accountId) query = query.eq('account_id', accountId)
  const { data, error } = await query
  if (error) { console.error('fetchVacationSettings:', error); return null }
  return (data as SettingsRow[]).map(rowToSettings)
}

export async function updateGlobalSettings(
  accountId: string,
  vacationDays: number, asuntosDays: number, minStaff: number, minLead: number,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('vacation_settings').update({
    vacation_days_per_year: vacationDays,
    asuntos_propios_per_year: asuntosDays,
    min_staff_per_location: minStaff,
    min_lead_days: minLead,
    updated_at: new Date().toISOString(),
  }).eq('account_id', accountId).eq('scope', 'global')
  if (error) { console.error('updateGlobalSettings:', error); return false }
  return true
}

// Actualiza la LISTA NEGRA de tipos que el trabajador no puede solicitar, en la
// fila global de LA CUENTA indicada. Devuelve false si no existe esa fila o si
// hay error, para no dar por guardado lo que no se guardó.
export async function updateDisabledRequestTypes(
  accountId: string,
  disabled: VacationType[],
): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.from('vacation_settings').update({
    request_types_disabled: disabled,
    updated_at: new Date().toISOString(),
  }).eq('account_id', accountId).eq('scope', 'global').select('id')
  if (error) { console.error('updateDisabledRequestTypes:', error); return false }
  if (!data || data.length === 0) {
    console.warn('updateDisabledRequestTypes: no existe fila scope=global para la cuenta; no se guardó nada')
    return false
  }
  return true
}

// ─── Helpers de cálculo ───────────────────────────────────────────────────

// Días naturales (todos los días, fines de semana incluidos) entre dos fechas
// inclusive. Hostelería trabaja findes, así que las vacaciones se cuentan en
// días naturales (mínimo legal 30, Art. 38 ET), no en laborables.
export function naturalDaysBetween(start: string, end: string): number {
  const startD = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  let count = 0
  const cur = new Date(startD)
  while (cur <= endD) {
    count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// Días de antelación entre hoy y la fecha de inicio
export function leadDays(startDate: string): number {
  const start = new Date(startDate + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = start.getTime() - today.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// Saldo de vacaciones disponibles para un empleado en el año actual
export function availableDays(
  employee: { startDate?: string },
  approvedAndRequested: VacationRequest[],
  type: 'vacaciones' | 'asuntos_propios',
  yearTotal: number,
): { used: number; available: number; prorrateado: number } {
  const year = new Date().getFullYear()
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31)

  // Prorrateo si el empleado entró este año
  let prorrateado = yearTotal
  if (employee.startDate) {
    const startD = new Date(employee.startDate + 'T00:00:00')
    if (startD > yearStart && startD <= yearEnd) {
      const monthsLeft = 12 - startD.getMonth() // meses restantes desde el de alta
      prorrateado = Math.round((yearTotal / 12) * monthsLeft * 100) / 100
    }
  }

  // Días usados/solicitados este año
  let used = 0
  for (const v of approvedAndRequested) {
    if (v.type !== type) continue
    if (v.status !== 'aprobada' && v.status !== 'solicitada') continue
    const startY = new Date(v.startDate + 'T00:00:00').getFullYear()
    if (startY !== year) continue
    used += v.days
  }

  return { used, available: Math.max(0, prorrateado - used), prorrateado }
}
