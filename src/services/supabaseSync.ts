// src/services/supabaseSync.ts
// Sincronización entre el estado de Andy App y Supabase.
// Si Supabase no está configurado, las funciones devuelven null/false silenciosamente.

import { supabase, isSupabaseEnabled } from '../lib/supabase'
import type { Location, Employee, ClockEntry, ShiftPeriod, RestPattern } from '../types'

// ─── LOCATIONS ────────────────────────────────────────────────────────────

interface LocationRow {
  id: string
  name: string
  address: string | null
  phone: string | null
  active: boolean
  lat: number | null
  lng: number | null
  // === Campos de bolsa de horas ===
  hours_balance_close_day: number | null
  hours_balance_sync_with_gestoria: boolean | null
}

function rowToLocation(r: LocationRow): Location {
  return {
    id: r.id,
    name: r.name,
    address: r.address || '',
    phone: r.phone || '',
    active: r.active,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    // === Campos de bolsa de horas ===
    hoursBalanceCloseDay: r.hours_balance_close_day ?? 25,
    hoursBalanceSyncWithGestoria: r.hours_balance_sync_with_gestoria ?? true,
  }
}

function locationToRow(l: Location): Omit<LocationRow, 'id'> & { id?: string } {
  return {
    id: l.id.length === 36 ? l.id : undefined, // si el id es UUID lo enviamos, si no dejamos que Supabase lo genere
    name: l.name,
    address: l.address || null,
    phone: l.phone || null,
    active: l.active,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    // === Campos de bolsa de horas ===
    hours_balance_close_day: l.hoursBalanceCloseDay ?? 25,
    hours_balance_sync_with_gestoria: l.hoursBalanceSyncWithGestoria ?? true,
  }
}

export async function fetchLocations(): Promise<Location[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('locations').select('*').order('name')
  if (error) { console.error('Supabase fetchLocations:', error); return null }
  return (data as LocationRow[]).map(rowToLocation)
}

export async function upsertLocation(l: Location): Promise<Location | null> {
  if (!supabase) return null
  const row = locationToRow(l)
  const { data, error } = await supabase.from('locations').upsert(row).select().single()
  if (error) { console.error('Supabase upsertLocation:', error); return null }
  return rowToLocation(data as LocationRow)
}

export async function deleteLocation(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('locations').delete().eq('id', id)
  if (error) { console.error('Supabase deleteLocation:', error); return false }
  return true
}

// ─── EMPLOYEES ────────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string
  name: string
  dni: string | null
  phone: string | null
  email: string | null
  photo: string | null
  position: string | null
  department: string | null
  contract_type: string | null
  start_date: string | null
  end_date: string | null
  salary: number | null
  weekly_hours: number | null
  schedule: string | null
  active: boolean
  notes: string | null
  pin: string | null
  location_id: string | null
  assigned_locations: string[] | null
  weekly_schedule: unknown
  availability: unknown
  // === Campos del scheduler (sub-fase 3.2) ===
  shift_code: string | null
  shift_period: ShiftPeriod | null
  rest_pattern: RestPattern | null
  // === Campos de bolsa de horas ===
  initial_hours_balance: number | null
  show_hours_balance: boolean | null
}

function rowToEmployee(r: EmployeeRow): Employee {
  return {
    id: r.id,
    name: r.name || '',
    dni: r.dni || '',
    phone: r.phone || '',
    email: r.email || '',
    photo: r.photo || '',
    position: r.position || '',
    department: r.department || '',
    contractType: r.contract_type || '',
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    salary: r.salary ?? 0,
    weeklyHours: r.weekly_hours ?? 40,
    schedule: r.schedule || '',
    active: r.active,
    notes: r.notes || '',
    pin: r.pin || undefined,
    locationId: r.location_id || '',
    assignedLocations: r.assigned_locations || [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    weeklySchedule: (r.weekly_schedule as any) || {
      lunes: { active: true, start: '09:00', end: '17:00' },
      martes: { active: true, start: '09:00', end: '17:00' },
      miercoles: { active: true, start: '09:00', end: '17:00' },
      jueves: { active: true, start: '09:00', end: '17:00' },
      viernes: { active: true, start: '09:00', end: '17:00' },
      sabado: { active: false, start: '', end: '' },
      domingo: { active: false, start: '', end: '' },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    availability: (r.availability as any) || undefined,
    clockEntries: [],   // se cargan aparte por si hay muchos
    documents: [],
    vacations: [],
    formations: [],
    // === Campos del scheduler ===
    shiftCode: r.shift_code || undefined,
    shiftPeriod: r.shift_period || undefined,
    restPattern: r.rest_pattern || undefined,
    // === Campos de bolsa de horas ===
    initialHoursBalance: r.initial_hours_balance != null ? Number(r.initial_hours_balance) : 0,
    showHoursBalance: r.show_hours_balance ?? true,
  }
}

function employeeToRow(e: Employee): Partial<EmployeeRow> {
  // Solo enviamos campos que existen en la tabla
  const isUuid = e.id && e.id.length === 36 && e.id.includes('-')
  return {
    ...(isUuid ? { id: e.id } : {}),
    name: e.name,
    dni: e.dni || null,
    phone: e.phone || null,
    email: e.email || null,
    photo: e.photo || null,
    position: e.position || null,
    department: e.department || null,
    contract_type: e.contractType || null,
    start_date: e.startDate || null,
    end_date: e.endDate || null,
    salary: e.salary || 0,
    weekly_hours: e.weeklyHours || 40,
    schedule: e.schedule || null,
    active: e.active,
    notes: e.notes || null,
    pin: e.pin || null,
    location_id: e.locationId && e.locationId.length === 36 ? e.locationId : null,
    assigned_locations: (e.assignedLocations || []).filter(l => l.length === 36),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    weekly_schedule: e.weeklySchedule as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    availability: e.availability as any,
    // === Campos del scheduler ===
    shift_code: e.shiftCode || null,
    shift_period: e.shiftPeriod || null,
    rest_pattern: e.restPattern || null,
    // === Campos de bolsa de horas ===
    initial_hours_balance: e.initialHoursBalance ?? 0,
    show_hours_balance: e.showHoursBalance ?? true,
  }
}

export async function fetchEmployees(): Promise<Employee[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('employees').select('*').order('name')
  if (error) { console.error('Supabase fetchEmployees:', error); return null }
  return (data as EmployeeRow[]).map(rowToEmployee)
}

export async function upsertEmployee(e: Employee): Promise<Employee | null> {
  if (!supabase) return null
  const row = employeeToRow(e)
  const { data, error } = await supabase.from('employees').upsert(row).select().single()
  if (error) { console.error('Supabase upsertEmployee:', error); return null }
  return rowToEmployee(data as EmployeeRow)
}

export async function deleteEmployee(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) { console.error('Supabase deleteEmployee:', error); return false }
  return true
}

// ─── CLOCK ENTRIES ────────────────────────────────────────────────────────

interface ClockRow {
  id: string
  employee_id: string
  type: 'entrada' | 'salida'
  datetime: string
  real_datetime: string | null
  lat: number | null
  lng: number | null
  address: string | null
  scheduled: string | null
  rounding_applied: boolean | null
  diff_minutes: number | null
  source: 'kiosko' | 'movil' | 'manual'
  location_id_at_clock: string | null
  photo_data_url: string | null
}

function rowToClock(r: ClockRow): ClockEntry & { employeeId: string } {
  return {
    id: r.id,
    type: r.type,
    datetime: r.datetime,
    realDatetime: r.real_datetime || undefined,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    address: r.address || undefined,
    scheduled: r.scheduled || undefined,
    roundingApplied: r.rounding_applied ?? undefined,
    diffMinutes: r.diff_minutes ?? undefined,
    source: r.source,
    locationIdAtClock: r.location_id_at_clock || undefined,
    photoDataUrl: r.photo_data_url || undefined,
    employeeId: r.employee_id,
  }
}

export async function fetchClockEntries(): Promise<{ employeeId: string; entry: ClockEntry }[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('clock_entries').select('*').order('datetime', { ascending: false })
  if (error) { console.error('Supabase fetchClockEntries:', error); return null }
  return (data as ClockRow[]).map(r => {
    const ce = rowToClock(r)
    return { employeeId: ce.employeeId, entry: ce }
  })
}

export async function insertClockEntry(employeeId: string, entry: ClockEntry): Promise<boolean> {
  if (!supabase) return false
  const row = {
    // No enviamos id local — dejamos que Supabase genere uno UUID
    employee_id: employeeId,
    type: entry.type,
    datetime: entry.datetime,
    real_datetime: entry.realDatetime || null,
    lat: entry.lat ?? null,
    lng: entry.lng ?? null,
    address: entry.address || null,
    scheduled: entry.scheduled || null,
    rounding_applied: entry.roundingApplied ?? false,
    diff_minutes: entry.diffMinutes ?? null,
    source: entry.source || 'kiosko',
    location_id_at_clock: entry.locationIdAtClock || null,
    photo_data_url: entry.photoDataUrl || null,
  }
  const { error } = await supabase.from('clock_entries').insert(row)
  if (error) { console.error('Supabase insertClockEntry:', error); return false }
  return true
}

// ─── REALTIME ─────────────────────────────────────────────────────────────

export function subscribeToChanges(
  onLocationsChange: () => void,
  onEmployeesChange: () => void,
  onClockEntriesChange: () => void,
): () => void {
  if (!supabase) {
    console.warn('[Supabase] subscribeToChanges: cliente no inicializado')
    return () => {}
  }
  const sb = supabase

  console.log('[Supabase] Iniciando suscripción a cambios...')

  const channel = sb
    .channel('andy-app-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (payload) => {
      console.log('[Supabase] 🔔 cambio en locations', payload.eventType)
      onLocationsChange()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, (payload) => {
      console.log('[Supabase] 🔔 cambio en employees', payload.eventType)
      onEmployeesChange()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clock_entries' }, (payload) => {
      console.log('[Supabase] 🔔 cambio en clock_entries', payload.eventType)
      onClockEntriesChange()
    })
    .subscribe((status, err) => {
      console.log('[Supabase] Estado suscripción:', status)
      if (err) console.error('[Supabase] Error suscripción:', err)
    })

  return () => {
    console.log('[Supabase] Desuscribiendo canal')
    sb.removeChannel(channel)
  }
}

export { isSupabaseEnabled }
