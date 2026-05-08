// src/services/locationPlanningService.ts
// Plantilla del local: necesidades de cobertura por turno y día.
// Disponibilidad semanal de empleados.
import { supabase } from '../lib/supabase'

// ─── TIPOS ────────────────────────────────────────────────────────────────

export interface LocationPlanningRow {
  id: string
  locationId: string
  shiftTypeId: string
  // Necesidad por día (null = usar needed_default)
  neededLun?: number | null
  neededMar?: number | null
  neededMie?: number | null
  neededJue?: number | null
  neededVie?: number | null
  neededSab?: number | null
  neededDom?: number | null
  neededDefault: number
  notes?: string
  updatedAt: string
}

export interface WeeklyAvailability {
  id: string
  employeeId: string
  weekStart: string             // YYYY-MM-DD
  available: boolean
  notes?: string
  updatedAt: string
}

interface PlanningDbRow {
  id: string
  location_id: string
  shift_type_id: string
  needed_lun: number | null
  needed_mar: number | null
  needed_mie: number | null
  needed_jue: number | null
  needed_vie: number | null
  needed_sab: number | null
  needed_dom: number | null
  needed_default: number
  notes: string | null
  updated_at: string
}

interface AvailDbRow {
  id: string
  employee_id: string
  week_start: string
  available: boolean
  notes: string | null
  updated_at: string
}

function rowToPlanning(r: PlanningDbRow): LocationPlanningRow {
  return {
    id: r.id,
    locationId: r.location_id,
    shiftTypeId: r.shift_type_id,
    neededLun: r.needed_lun,
    neededMar: r.needed_mar,
    neededMie: r.needed_mie,
    neededJue: r.needed_jue,
    neededVie: r.needed_vie,
    neededSab: r.needed_sab,
    neededDom: r.needed_dom,
    neededDefault: r.needed_default,
    notes: r.notes || undefined,
    updatedAt: r.updated_at,
  }
}

function rowToAvail(r: AvailDbRow): WeeklyAvailability {
  return {
    id: r.id,
    employeeId: r.employee_id,
    weekStart: r.week_start,
    available: r.available,
    notes: r.notes || undefined,
    updatedAt: r.updated_at,
  }
}

// ─── PLANNING ─────────────────────────────────────────────────────────────

export async function fetchLocationPlanning(locationId: string): Promise<LocationPlanningRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('location_planning').select('*').eq('location_id', locationId)
  if (error) { console.error('fetchLocationPlanning:', error); return [] }
  return (data as PlanningDbRow[]).map(rowToPlanning)
}

export async function upsertLocationPlanning(input: {
  locationId: string
  shiftTypeId: string
  neededLun?: number | null
  neededMar?: number | null
  neededMie?: number | null
  neededJue?: number | null
  neededVie?: number | null
  neededSab?: number | null
  neededDom?: number | null
  neededDefault: number
  notes?: string
}): Promise<boolean> {
  if (!supabase) return false
  const sb = supabase

  const { data: existing } = await sb.from('location_planning')
    .select('id')
    .eq('location_id', input.locationId)
    .eq('shift_type_id', input.shiftTypeId)
    .maybeSingle()

  const payload = {
    location_id: input.locationId,
    shift_type_id: input.shiftTypeId,
    needed_lun: input.neededLun ?? null,
    needed_mar: input.neededMar ?? null,
    needed_mie: input.neededMie ?? null,
    needed_jue: input.neededJue ?? null,
    needed_vie: input.neededVie ?? null,
    needed_sab: input.neededSab ?? null,
    needed_dom: input.neededDom ?? null,
    needed_default: input.neededDefault,
    notes: input.notes || null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await sb.from('location_planning').update(payload).eq('id', (existing as { id: string }).id)
    if (error) { console.error('upsertLocationPlanning:', error); return false }
  } else {
    const { error } = await sb.from('location_planning').insert(payload)
    if (error) { console.error('upsertLocationPlanning:', error); return false }
  }
  return true
}

/**
 * Devuelve la necesidad de cobertura para un día concreto y un turno.
 * dayOfWeek: 0=domingo, 1=lunes, ... 6=sábado
 */
export function neededFor(planning: LocationPlanningRow, dayOfWeek: number): number {
  switch (dayOfWeek) {
    case 1: return planning.neededLun ?? planning.neededDefault
    case 2: return planning.neededMar ?? planning.neededDefault
    case 3: return planning.neededMie ?? planning.neededDefault
    case 4: return planning.neededJue ?? planning.neededDefault
    case 5: return planning.neededVie ?? planning.neededDefault
    case 6: return planning.neededSab ?? planning.neededDefault
    case 0: return planning.neededDom ?? planning.neededDefault
    default: return planning.neededDefault
  }
}

// ─── WEEKLY AVAILABILITY ──────────────────────────────────────────────────

export async function fetchWeeklyAvailability(weekStart: string): Promise<WeeklyAvailability[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('weekly_availability')
    .select('*').eq('week_start', weekStart)
  if (error) { console.error('fetchWeeklyAvailability:', error); return [] }
  return (data as AvailDbRow[]).map(rowToAvail)
}

export async function setWeeklyAvailability(
  employeeId: string, weekStart: string, available: boolean, notes?: string,
): Promise<boolean> {
  if (!supabase) return false
  const sb = supabase

  const { data: existing } = await sb.from('weekly_availability')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('week_start', weekStart)
    .maybeSingle()

  const payload = {
    employee_id: employeeId,
    week_start: weekStart,
    available,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await sb.from('weekly_availability').update(payload).eq('id', (existing as { id: string }).id)
    if (error) { console.error('setWeeklyAvailability:', error); return false }
  } else {
    const { error } = await sb.from('weekly_availability').insert(payload)
    if (error) { console.error('setWeeklyAvailability:', error); return false }
  }
  return true
}

/** Devuelve un Set con los IDs de empleados marcados como NO disponibles esa semana. */
export async function fetchUnavailableEmployees(weekStart: string): Promise<Set<string>> {
  const all = await fetchWeeklyAvailability(weekStart)
  return new Set(all.filter(a => !a.available).map(a => a.employeeId))
}
