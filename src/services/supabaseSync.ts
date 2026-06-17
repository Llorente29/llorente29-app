// src/services/supabaseSync.ts
// Sincronización entre el estado de la app y Supabase.
//
// REFACTOR Bloque B-3 (16/05/2026):
//   - fetchLocations / fetchEmployees / fetchClockEntries reciben accountId.
//   - Si accountId es null, devuelven [] silenciosamente (no es error: el
//     caller puede estar arrancando y aún no haber resuelto cuenta activa).
//   - upsertLocation requiere accountId obligatorio (INSERT necesita scope).
//   - upsertEmployee / insertClockEntry / deleteX no llevan accountId: la PK
//     o la FK ya identifica el registro, y RLS valida ownership.
//
// Estrategia de filtrado:
//   - locations: filtro directo por account_id.
//   - employees: 2 queries (locations → ids → employees WHERE location_id IN).
//     Más predecible que embed (Embed `select('a, related_table')` falla con
//     FKs no exactamente nombradas).
//   - clock_entries: 3 niveles (locations → employees → clock_entries).
//     Idem 2 queries.
//
// Si Supabase no está configurado, las funciones devuelven null/false
// silenciosamente. Cuando hay error real (RLS rechaza, red, etc.) se loguea
// y devuelve null/false. Convención antigua mantenida para no romper callers.

import { supabase, isSupabaseEnabled } from '../lib/supabase'
import type { Database } from '../types/database'
import type { Location, Employee, ClockEntry, ShiftPeriod, RestPattern } from '../types'

// Tipos helper para inserts/updates tipados
type EmployeeInsert = Database['public']['Tables']['employees']['Insert']
type LocationInsert = Database['public']['Tables']['locations']['Insert']
type Json = Database['public']['Tables']['employees']['Row']['availability']

// ─── LOCATIONS ────────────────────────────────────────────────────────────

interface LocationRow {
  id: string
  name: string
  address: string | null
  phone: string | null
  active: boolean
  lat: number | null
  lng: number | null
  hours_balance_close_day: number | null
  hours_balance_sync_with_gestoria: boolean | null
  clock_radius_m: number | null
  clock_geofence_mode: string | null
  // NOTA: account_id e is_billable existen en BBDD pero NO se exponen al cliente.
  // - account_id: scope server-side, el cliente no debe verlo en el tipo Location.
  // - is_billable: deuda apuntada para módulo Reportes (ver CONTEXTO §11).
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
    hoursBalanceCloseDay: r.hours_balance_close_day ?? 25,
    hoursBalanceSyncWithGestoria: r.hours_balance_sync_with_gestoria ?? true,
    clockRadiusM: r.clock_radius_m ?? 200,
    clockGeofenceMode: (r.clock_geofence_mode === 'warn' ? 'warn' : 'block'),
  }
}

/**
 * Construye el row para insert/upsert de Location.
 * Inyecta account_id obligatoriamente.
 * Si el id local NO es UUID, se omite y Supabase genera uno nuevo.
 */
function locationToRow(accountId: string, l: Location): LocationInsert {
  const isUuid = l.id && l.id.length === 36 && l.id.includes('-')
  return {
    ...(isUuid ? { id: l.id } : {}),
    account_id: accountId,
    name: l.name,
    address: l.address || null,
    phone: l.phone || null,
    active: l.active,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    hours_balance_close_day: l.hoursBalanceCloseDay ?? 25,
    hours_balance_sync_with_gestoria: l.hoursBalanceSyncWithGestoria ?? true,
    clock_radius_m: l.clockRadiusM ?? 200,
    clock_geofence_mode: l.clockGeofenceMode ?? 'block',
    // is_billable: omitido → toma DEFAULT true de BBDD.
  }
}

/**
 * Trae las locations de UNA cuenta.
 * Si accountId es null, devuelve [] (caller aún no ha resuelto cuenta).
 */
export async function fetchLocations(accountId: string | null): Promise<Location[] | null> {
  if (!supabase) return null
  if (!accountId) return []
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('account_id', accountId)
    .order('name')
  if (error) { console.error('Supabase fetchLocations:', error); return null }
  return (data as LocationRow[]).map(rowToLocation)
}

/**
 * Inserta o actualiza una location en la cuenta dada.
 * accountId es obligatorio: INSERT lo necesita para crear el row;
 * UPDATE lo necesita para que RLS valide ownership de la cuenta destino.
 */
export async function upsertLocation(accountId: string, l: Location): Promise<Location | null> {
  if (!supabase) return null
  const row = locationToRow(accountId, l)
  const { data, error } = await supabase.from('locations').upsert(row).select().single()
  if (error) { console.error('Supabase upsertLocation:', error); return null }
  return rowToLocation(data as LocationRow)
}

/**
 * Borra una location por id. RLS valida ownership.
 * No necesita accountId: si el caller intenta borrar una location de otra cuenta,
 * RLS lo bloquea y devolvemos false.
 */
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
  birth_date: string | null
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
  shift_code: string | null
  shift_period: ShiftPeriod | null
  rest_pattern: RestPattern | null
  initial_hours_balance: number | null
  show_hours_balance: boolean | null
  termination_type: string | null
  termination_reason: string | null
  termination_communicated_to_gestoria: boolean | null
  trial_period_days: number | null
  // NOTA: contracted_hours_week existe en BBDD pero NO se expone al cliente
  // todavía. Deuda apuntada para sesión futura (ver CONTEXTO §11).
}

function rowToEmployee(r: EmployeeRow): Employee {
  return {
    id: r.id,
    name: r.name || '',
    dni: r.dni || '',
    phone: r.phone || '',
    email: r.email || '',
    photo: r.photo || '',
    birthDate: r.birth_date || undefined,
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
    clockEntries: [],
    documents: [],
    vacations: [],
    formations: [],
    shiftCode: r.shift_code || undefined,
    shiftPeriod: r.shift_period || undefined,
    restPattern: r.rest_pattern || undefined,
    initialHoursBalance: r.initial_hours_balance != null ? Number(r.initial_hours_balance) : 0,
    showHoursBalance: r.show_hours_balance ?? true,
    terminationType: (r.termination_type as Employee['terminationType']) || undefined,
    terminationReason: r.termination_reason || undefined,
    terminationCommunicatedToGestoria: r.termination_communicated_to_gestoria ?? false,
    trialPeriodDays: r.trial_period_days != null ? Number(r.trial_period_days) : undefined,
  }
}

/**
 * Construye el row para insert/upsert de Employee.
 * weekly_schedule y availability se castean con doble cast (as unknown as Json)
 * porque WeeklySchedule/Availability son interfaces con shape rígido, no maps.
 */
function employeeToRow(e: Employee): EmployeeInsert {
  const isUuid = e.id && e.id.length === 36 && e.id.includes('-')
  return {
    ...(isUuid ? { id: e.id } : {}),
    name: e.name,
    dni: e.dni || null,
    phone: e.phone || null,
    email: e.email || null,
    photo: e.photo || null,
    birth_date: e.birthDate || null,
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
    weekly_schedule: e.weeklySchedule as unknown as Json,
    availability: e.availability as unknown as Json,
    shift_code: e.shiftCode || null,
    shift_period: e.shiftPeriod || null,
    rest_pattern: e.restPattern || null,
    initial_hours_balance: e.initialHoursBalance ?? 0,
    show_hours_balance: e.showHoursBalance ?? true,
    termination_type: e.terminationType || null,
    termination_reason: e.terminationReason || null,
    termination_communicated_to_gestoria: e.terminationCommunicatedToGestoria ?? false,
    trial_period_days: e.trialPeriodDays ?? null,
  }
}

/**
 * Trae los employees de una cuenta. Estrategia: 2 queries.
 *   1. locations.select('id') WHERE account_id = X
 *   2. employees.select('*') WHERE location_id IN (ids)
 *
 * Si la cuenta no tiene locations todavía, devuelve [].
 */
export async function fetchEmployees(accountId: string | null): Promise<Employee[] | null> {
  if (!supabase) return null
  if (!accountId) return []

  // Query 1: ids de locations de la cuenta
  const { data: locs, error: locErr } = await supabase
    .from('locations')
    .select('id')
    .eq('account_id', accountId)
  if (locErr) { console.error('Supabase fetchEmployees (locations):', locErr); return null }
  const locationIds = (locs ?? []).map(l => l.id)
  if (locationIds.length === 0) return []

  // Query 2: employees cuyos location_id estén en esa lista
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .in('location_id', locationIds)
    .order('name')
  if (error) { console.error('Supabase fetchEmployees (employees):', error); return null }
  return (data as EmployeeRow[]).map(rowToEmployee)
}

/**
 * Devuelve los empleados que comparten local(es) con el trabajador.
 * A diferencia de fetchEmployees(accountId), NO exige accountId: en sesion de
 * trabajador no se conoce la cuenta, pero si su(s) location_id. La RLS de
 * employees (employees_read) ya restringe a los locales de la cuenta del
 * usuario, asi que filtrar por location_id es seguro y suficiente.
 *
 * Usado por el modulo de cambios de turno (modal de solicitud, tablon, mis
 * solicitudes) para poblar la lista de companeros y resolver nombres.
 */
export async function fetchColleagues(locationIds: string[]): Promise<Employee[]> {
  if (!supabase) return []
  const ids = (locationIds || []).filter(Boolean)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .in('location_id', ids)
    .order('name')
  if (error) { console.error('Supabase fetchColleagues:', error); return [] }
  return (data as EmployeeRow[]).map(rowToEmployee)
}

/**
 * Inserta o actualiza un employee.
 * No requiere accountId: location_id ya identifica la cuenta indirectamente,
 * y RLS valida que el caller tenga acceso a esa location.
 */
export async function upsertEmployee(e: Employee): Promise<Employee | null> {
  if (!supabase) return null
  const row = employeeToRow(e)
  const { data, error } = await supabase.from('employees').upsert(row).select().single()
  if (error) { console.error('Supabase upsertEmployee:', error); return null }
  return rowToEmployee(data as EmployeeRow)
}

/**
 * Borra un employee por id. RLS valida ownership vía location_id → account_id.
 */
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

/**
 * Trae los clock_entries de una cuenta. Estrategia: 2 queries encadenadas
 * (no 3 — reaprovechamos fetchEmployees lite para obtener los employee_ids).
 *   1. locations + employees → employee_ids de la cuenta
 *   2. clock_entries WHERE employee_id IN (ids)
 *
 * Si la cuenta no tiene employees, devuelve [].
 */
export async function fetchClockEntries(accountId: string | null): Promise<{ employeeId: string; entry: ClockEntry }[] | null> {
  if (!supabase) return null
  if (!accountId) return []

  // Query 1a: ids de locations de la cuenta
  const { data: locs, error: locErr } = await supabase
    .from('locations')
    .select('id')
    .eq('account_id', accountId)
  if (locErr) { console.error('Supabase fetchClockEntries (locations):', locErr); return null }
  const locationIds = (locs ?? []).map(l => l.id)
  if (locationIds.length === 0) return []

  // Query 1b: ids de employees en esas locations
  const { data: emps, error: empErr } = await supabase
    .from('employees')
    .select('id')
    .in('location_id', locationIds)
  if (empErr) { console.error('Supabase fetchClockEntries (employees):', empErr); return null }
  const employeeIds = (emps ?? []).map(e => e.id)
  if (employeeIds.length === 0) return []

  // Query 2: clock_entries de esos employees
  const { data, error } = await supabase
    .from('clock_entries')
    .select('*')
    .in('employee_id', employeeIds)
    .order('datetime', { ascending: false })
  if (error) { console.error('Supabase fetchClockEntries (clock_entries):', error); return null }
  return (data as ClockRow[]).map(r => {
    const ce = rowToClock(r)
    return { employeeId: ce.employeeId, entry: ce }
  })
}

/**
 * Inserta un clock entry. No requiere accountId: employee_id identifica
 * el employee y por tanto su location/account. RLS valida.
 */
export async function insertClockEntry(employeeId: string, entry: ClockEntry): Promise<boolean> {
  if (!supabase) return false
  const row = {
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

/**
 * Suscribe a cambios en las 3 tablas. Los callbacks se disparan al recibir
 * un evento; es responsabilidad del caller llamar a fetchX(accountId) dentro
 * del callback para refrescar los datos de SU cuenta.
 *
 * NO se filtra el subscribe por cuenta porque postgres_changes no lo permite
 * de forma sencilla a través de joins. RLS hace que solo recibas eventos de
 * filas a las que tienes acceso, así que en la práctica solo se disparan
 * para tu(s) cuenta(s).
 */
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
