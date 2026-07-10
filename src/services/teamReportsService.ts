// src/services/teamReportsService.ts
// Informes de Team v2: lee ventas, franjas y horas trabajadas desde las funciones
// SQL (server-side). El coste laboral se cruza en la página por asignación de ficha.
//
// db() laxo por la deuda de database.ts (las funciones nuevas no están en los tipos).

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export interface SalesByLocation {
  locationId: string
  tickets: number
  ventas: number
  base: number
  costeLineas: number
  lineasTotal: number
  lineasConCoste: number
}

export interface HoursByLocation {
  locationId: string
  hours: number
  shifts: number
}

export interface SalesByHour {
  locationId: string
  hour: number
  tickets: number
  ventas: number
}

const toIso = (d: string) => new Date(d).toISOString()

export async function fetchSalesByLocation(accountId: string, from: string, to: string): Promise<SalesByLocation[]> {
  const { data, error } = await db().rpc('team_sales_by_location', { p_account: accountId, p_from: toIso(from), p_to: toIso(to) })
  if (error) { console.error('team_sales_by_location:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    locationId: r.location_id,
    tickets: Number(r.tickets) || 0,
    ventas: Number(r.ventas) || 0,
    base: Number(r.base) || 0,
    costeLineas: Number(r.coste_lineas) || 0,
    lineasTotal: Number(r.lineas_total) || 0,
    lineasConCoste: Number(r.lineas_con_coste) || 0,
  }))
}

export async function fetchWorkedHoursByLocation(accountId: string, from: string, to: string): Promise<HoursByLocation[]> {
  const { data, error } = await db().rpc('team_worked_shifts', { p_account: accountId, p_from: toIso(from), p_to: toIso(to) })
  if (error) { console.error('team_worked_shifts:', error); return [] }
  const byLoc = new Map<string, { minutes: number; shifts: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data as any[])) {
    const k = r.location_id as string
    const cur = byLoc.get(k) ?? { minutes: 0, shifts: 0 }
    cur.minutes += Number(r.minutes) || 0
    cur.shifts += 1
    byLoc.set(k, cur)
  }
  return [...byLoc.entries()].map(([locationId, v]) => ({
    locationId, hours: Math.round((v.minutes / 60) * 10) / 10, shifts: v.shifts,
  }))
}

export interface WorkedShift {
  employeeId: string
  locationId: string
  startedAt: string
  endedAt: string
  minutes: number
}

export interface DemandProfile {
  locationId: string
  dow: number      // 0=Lunes .. 6=Domingo
  hour: number
  units: number
}

export async function fetchDemandProfile(accountId: string, from: string, to: string): Promise<DemandProfile[]> {
  const { data, error } = await db().rpc('team_demand_profile', { p_account: accountId, p_from: toIso(from), p_to: toIso(to) })
  if (error) { console.error('team_demand_profile:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    locationId: r.location_id,
    dow: Number(r.dow) || 0,
    hour: Number(r.hour_of_day) || 0,
    units: Number(r.units) || 0,
  }))
}

// Previsión ajustada de platos/día por local y semana.
// previsión = (base_reciente / factor_estacional_base) × idx_dow × idx_mes × tendencia.
// Sale de la RPC team_demand_forecast (reutiliza team_demand_coefficients + prior).
export interface DemandForecast {
  fecha: string
  dow: number       // 0=Lunes .. 6=Domingo
  mes: number       // 1..12
  baseReciente: number   // media platos/día del local (cruda)
  baseAnual: number      // base desestacionalizada (la que se multiplica)
  idxDow: number
  idxMes: number
  factorBase: number     // factor estacional del periodo base
  tendencia: number
  prevision: number
  diasDatos: number
}

export async function fetchDemandForecast(accountId: string, locationId: string, weekStart: string): Promise<DemandForecast[]> {
  const { data, error } = await db().rpc('team_demand_forecast', { p_account: accountId, p_location: locationId, p_week_start: weekStart })
  if (error) { console.error('team_demand_forecast:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    fecha: r.fecha,
    dow: Number(r.dow) || 0,
    mes: Number(r.mes) || 0,
    baseReciente: Number(r.base_reciente) || 0,
    baseAnual: Number(r.base_anual) || 0,
    idxDow: Number(r.idx_dow) || 0,
    idxMes: Number(r.idx_mes) || 0,
    factorBase: Number(r.factor_base) || 0,
    tendencia: Number(r.tendencia) || 0,
    prevision: Number(r.prevision) || 0,
    diasDatos: Number(r.dias_datos) || 0,
  }))
}

export interface DemandByHour {
  locationId: string
  hour: number
  units: number
}

export async function fetchDemandByHour(accountId: string, from: string, to: string): Promise<DemandByHour[]> {
  const { data, error } = await db().rpc('team_demand_by_hour', { p_account: accountId, p_from: toIso(from), p_to: toIso(to) })
  if (error) { console.error('team_demand_by_hour:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    locationId: r.location_id,
    hour: Number(r.hour_of_day) || 0,
    units: Number(r.units) || 0,
  }))
}

export async function fetchWorkedShifts(accountId: string, from: string, to: string): Promise<WorkedShift[]> {
  const { data, error } = await db().rpc('team_worked_shifts', { p_account: accountId, p_from: toIso(from), p_to: toIso(to) })
  if (error) { console.error('team_worked_shifts(raw):', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    employeeId: r.employee_id,
    locationId: r.location_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    minutes: Number(r.minutes) || 0,
  }))
}

export async function fetchSalesByHour(accountId: string, from: string, to: string): Promise<SalesByHour[]> {
  const { data, error } = await db().rpc('team_sales_by_hour', { p_account: accountId, p_from: toIso(from), p_to: toIso(to) })
  if (error) { console.error('team_sales_by_hour:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    locationId: r.location_id,
    hour: Number(r.hour_of_day) || 0,
    tickets: Number(r.tickets) || 0,
    ventas: Number(r.ventas) || 0,
  }))
}
