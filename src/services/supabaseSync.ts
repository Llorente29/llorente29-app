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
import { ficharEnElServidor, corregirConMotivo, esFuncionQueNoExiste } from './fichajeServidor'

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
  employer_ss_annual?: number | null
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
  forgot_clockout_reminder: boolean | null
  termination_type: string | null
  termination_reason: string | null
  termination_communicated_to_gestoria: boolean | null
  trial_period_days: number | null
  contracted_hours_week: number | null
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
    employerSsAnnual: r.employer_ss_annual != null ? Number(r.employer_ss_annual) : undefined,
    weeklyHours: r.weekly_hours ?? 40,
    contractedHoursWeek: r.contracted_hours_week ?? undefined,
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
    forgotClockoutReminder: r.forgot_clockout_reminder ?? true,
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
function employeeToRow(e: Employee): EmployeeInsert & { employer_ss_annual?: number | null } {
  const isUuid = e.id && e.id.length === 36 && e.id.includes('-')
  const fila = filaDeEmpleado(e, isUuid)
  // L1a: quien no ha leído el salario, el DNI, la fecha de nacimiento ni el
  // coste de SS (no es el administrador) no los manda al guardar una ficha que
  // ya existe: mandaría vacíos y los borraría.
  if (isUuid && e.datosPrivados === 'ocultos') {
    const { dni: _dni, birth_date: _nac, salary: _sal, employer_ss_annual: _ss, ...resto } = fila
    void _dni; void _nac; void _sal; void _ss
    return resto as EmployeeInsert
  }
  return fila
}

function filaDeEmpleado(e: Employee, isUuid: boolean | '' | undefined): EmployeeInsert & { employer_ss_annual?: number | null } {
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
    employer_ss_annual: e.employerSsAnnual ?? null,
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

  // Query 2: employees cuyos location_id estén en esa lista. L1a (27/10/2026):
  // sin el salario, el DNI, la fecha de nacimiento ni el coste de la Seguridad
  // Social, que solo ve el administrador y llegan aparte (abajo).
  const { data, error } = await supabase
    .from('employees')
    .select(COLUMNAS_DE_LA_FICHA)
    .in('location_id', locationIds)
    .order('name')
  if (error) { console.error('Supabase fetchEmployees (employees):', error); return null }
  const fichas = (data as unknown as EmployeeRow[]).map(rowToEmployee)
  const privados = await leerDatosPrivadosDeEmpleados(accountId)
  return fichas.map(e => conDatosPrivados(e, privados))
}

/**
 * Las columnas de employees que lee cualquiera que vea la ficha (L1a). Fuera:
 * salary, dni, birth_date, employer_ss_annual (solo el administrador, por
 * empleados_datos_privados) y pin (vive en employee_kiosk_pin desde la 1215).
 * Una columna nueva de employees hay que añadirla aquí para que llegue.
 */
export const COLUMNAS_DE_LA_FICHA = [
  'id', 'name', 'phone', 'email', 'photo', 'position', 'department', 'contract_type', 'start_date', 'end_date',
  'weekly_hours', 'schedule', 'active', 'notes', 'location_id', 'assigned_locations', 'weekly_schedule',
  'availability', 'created_at', 'updated_at', 'contracted_hours_week', 'shift_code', 'shift_period', 'rest_pattern',
  'initial_hours_balance', 'show_hours_balance', 'termination_type', 'termination_reason',
  'termination_communicated_to_gestoria', 'trial_period_days', 'username', 'forgot_clockout_reminder', 'account_id',
].join(', ')

export interface DatosPrivadosDeEmpleado {
  salary: number | null
  dni: string | null
  birthDate: string | null
  employerSsAnnual: number | null
}

/**
 * El salario, el DNI, la fecha de nacimiento y el coste de Seguridad Social de
 * las personas de la cuenta. Solo el administrador los recibe: a cualquier otro
 * la función le devuelve cero filas. Con la base de antes de la 1905 (sin la
 * función), se leen como antes.
 */
export async function leerDatosPrivadosDeEmpleados(accountId: string): Promise<Map<string, DatosPrivadosDeEmpleado>> {
  const mapa = new Map<string, DatosPrivadosDeEmpleado>()
  if (!supabase) return mapa
  // empleados_datos_privados es de la 1905 y aún no está en database.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('empleados_datos_privados', { p_account_id: accountId })
  type Fila = { id: string; salary: number | null; dni: string | null; birth_date: string | null; employer_ss_annual: number | null }
  let filas: Fila[] = []
  if (error && esFuncionQueNoExiste(error)) {
    const r = await supabase.from('employees').select('id, salary, dni, birth_date, employer_ss_annual').eq('account_id', accountId)
    if (r.error) { console.error('Supabase leerDatosPrivadosDeEmpleados (antes de la 1905):', r.error); return mapa }
    filas = (r.data ?? []) as unknown as Fila[]
  } else if (error) {
    console.error('Supabase leerDatosPrivadosDeEmpleados:', error)
    return mapa
  } else {
    filas = (data ?? []) as Fila[]
  }
  for (const f of filas) {
    mapa.set(f.id, {
      salary: f.salary == null ? null : Number(f.salary),
      dni: f.dni,
      birthDate: f.birth_date,
      employerSsAnnual: f.employer_ss_annual == null ? null : Number(f.employer_ss_annual),
    })
  }
  return mapa
}

function conDatosPrivados(e: Employee, privados: Map<string, DatosPrivadosDeEmpleado>): Employee {
  const p = privados.get(e.id)
  if (!p) return { ...e, salary: 0, dni: '', birthDate: undefined, employerSsAnnual: undefined, datosPrivados: 'ocultos' }
  return {
    ...e,
    salary: p.salary ?? 0,
    dni: p.dni ?? '',
    birthDate: p.birthDate ?? undefined,
    employerSsAnnual: p.employerSsAnnual ?? undefined,
    datosPrivados: 'cargados',
  }
}

/**
 * Devuelve los compañeros que comparten local(es) con el trabajador: solo
 * nombre, foto y puesto (companeros_de_trabajo, de servidor). No exige
 * accountId: en sesión de trabajador no se conoce la cuenta, pero sí sus
 * locales, y la función ya limita a los de su cuenta y sus locales.
 *
 * Usado por el modulo de cambios de turno (modal de solicitud, tablon, mis
 * solicitudes) para poblar la lista de companeros y resolver nombres.
 */
export async function fetchColleagues(locationIds: string[]): Promise<Employee[]> {
  if (!supabase) return []
  const ids = (locationIds || []).filter(Boolean)
  if (ids.length === 0) return []
  // L00 · Respuesta 1 (27/10/2026): un trabajador ya no lee la tabla employees
  // de sus compañeros (salario, DNI, PIN…). De ellos solo llega lo que hace
  // falta para los turnos y los cambios: nombre, foto y puesto, por una función
  // de servidor. El resto de campos del Employee sale vacío.
  // companeros_de_trabajo es nueva (1215) y aún no está en database.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('companeros_de_trabajo', { p_location_ids: ids })
  if (error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? ''))) {
    // La base aún no tiene la 1215 (staging desde una rama, o el front llega
    // antes que la tanda): lo de antes, que en esa base todavía se puede leer.
    const r = await supabase.from('employees').select('id, name, photo, position, location_id, assigned_locations, active').in('location_id', ids).order('name')
    if (r.error) { console.error('Supabase fetchColleagues:', r.error); return [] }
    return (r.data ?? []).map(c => rowToEmployee(c as unknown as EmployeeRow))
  }
  if (error) { console.error('Supabase fetchColleagues:', error); return [] }
  type Companero = { id: string; name: string; photo: string | null; position: string | null; location_id: string | null; assigned_locations: string[] | null; active: boolean }
  return ((data ?? []) as Companero[]).map(c => rowToEmployee({
    id: c.id, name: c.name, photo: c.photo, position: c.position,
    location_id: c.location_id, assigned_locations: c.assigned_locations, active: c.active,
  } as unknown as EmployeeRow))
}

/**
 * Inserta o actualiza un employee.
 * No requiere accountId: location_id ya identifica la cuenta indirectamente,
 * y RLS valida que el caller tenga acceso a esa location.
 */
export async function upsertEmployee(e: Employee): Promise<Employee | null> {
  if (!supabase) return null
  const row = employeeToRow(e)
  // employer_ss_annual aún no está en database.ts (deuda: regenerar). El cliente
  // tipado rechaza columnas desconocidas; casteamos el row. La columna existe en BD.
  // L1a: se lee de vuelta sin las columnas privadas; las que se acaban de
  // guardar se devuelven tal cual las mandó quien las escribió.
  // L1a · PR 2 (28/10): una ficha que ya existe se guarda con UPDATE y una
  // nueva con INSERT, nunca con upsert. Con el salario, el DNI y el nacimiento
  // cerrados a la sesión (la tanda siguiente), un INSERT … ON CONFLICT DO
  // UPDATE falla siempre, también para el administrador (medido en local);
  // INSERT y UPDATE devolviendo solo las columnas abiertas, no.
  const { id, ...cambios } = row as EmployeeInsert & { id?: string }
  const { data, error } = id
    ? await supabase.from('employees').update(cambios as EmployeeInsert).eq('id', id).select(COLUMNAS_DE_LA_FICHA).single()
    : await supabase.from('employees').insert(row as EmployeeInsert).select(COLUMNAS_DE_LA_FICHA).single()
  if (error) { console.error('Supabase upsertEmployee:', error); return null }
  const guardada = rowToEmployee(data as unknown as EmployeeRow)
  return e.datosPrivados === 'ocultos'
    ? { ...guardada, salary: 0, dni: '', birthDate: undefined, employerSsAnnual: undefined, datosPrivados: 'ocultos' }
    : { ...guardada, salary: e.salary, dni: e.dni, birthDate: e.birthDate, employerSsAnnual: e.employerSsAnnual, datosPrivados: 'cargados' }
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
  source: 'kiosko' | 'movil' | 'tablet' | 'manual'
  location_id_at_clock: string | null
  photo_data_url: string | null
  voided: boolean | null
  // L1a (1905): pueden no venir con la base de antes.
  distance_m?: number | null
  within_radius?: boolean | null
  declared_at?: string | null
  created_at?: string | null
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
    voided: r.voided ?? false,
    distanceM: r.distance_m ?? undefined,
    withinRadius: r.within_radius ?? undefined,
    declaredAt: r.declared_at || undefined,
    createdAt: r.created_at || undefined,
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
  // database.ts aún no incluye `voided` (deuda: regenerar). Cast vía unknown.
  return (data as unknown as ClockRow[]).map(r => {
    const ce = rowToClock(r)
    return { employeeId: ce.employeeId, entry: ce }
  })
}

/**
 * Error de escritura de un fichaje, con el hint del servidor intacto.
 *
 * Los triggers de clock_entries levantan excepciones con `hint` legible
 * (YA_ESTA_DENTRO, NO_ESTA_FICHADO, PAUSA_FUERA_DE_ORDEN,
 * DOBLE_FICHAJE_MUY_RAPIDO). Ese hint esta escrito para que lo lea una persona
 * en una cocina: se conserva hasta la pantalla en vez de traducirse a un
 * booleano por el camino.
 */
export class ClockWriteError extends Error {
  readonly hint: string | null
  readonly code: string | null
  /** L1a: no ha salido por la red (sin cobertura). El portal lo guarda en el móvil y lo manda después. */
  readonly sinRed: boolean
  constructor(message: string, hint: string | null, code: string | null, sinRed = false) {
    super(message)
    this.name = 'ClockWriteError'
    this.hint = hint
    this.code = code
    this.sinRed = sinRed
  }
}

/**
 * Traduce un fallo de escritura de fichaje a algo que una persona pueda leer.
 * El trigger de orden manda un `hint` ya escrito en castellano para quien ficha;
 * lo demas cae en un texto generico que NO promete que el fichaje se guardo.
 * Compartido por las TRES pantallas que escriben fichajes, para que las tres
 * digan lo mismo cuando la BBDD rechaza la fila.
 */
export function mensajeDeFalloDeFichaje(e: unknown): string {
  if (e instanceof ClockWriteError) {
    if (e.hint) return e.hint
    if (e.message) return `No se ha podido registrar: ${e.message}`
  }
  if (e instanceof Error && e.message) return `No se ha podido registrar: ${e.message}`
  return 'No se ha podido registrar el fichaje. Comprueba la conexión e inténtalo otra vez. '
       + 'Si sigue fallando avisa a tu encargado: NO ha quedado guardado.'
}

/**
 * Inserta un clock entry. No requiere accountId: employee_id identifica
 * el employee y por tanto su location/account. RLS valida.
 *
 * LANZA si la escritura falla. Quien llame decide que enseñar, pero no puede
 * ya no enterarse.
 */
export async function insertClockEntry(employeeId: string, entry: ClockEntry): Promise<boolean> {
  if (!supabase) return false
  // L1a (27/10/2026). Una marca a mano es una corrección con motivo.
  if (entry.source === 'manual') {
    const err = await corregirConMotivo(employeeId, entry)
    if (err) throw new ClockWriteError(err.message, err.hint, err.code)
    return true
  }
  // El móvil y la tablet fichan en el servidor (fichar(), en producción desde
  // el PR 1). No hay INSERT directo de respaldo: la L1a · PR 2b quitará ese
  // permiso a la sesión. Si la función no está, se dice.
  const r = await ficharEnElServidor(employeeId, entry)
  if (r.tipo === 'guardado') return true
  if (r.tipo === 'rechazado') throw new ClockWriteError(r.error.message, r.error.hint, r.error.code)
  if (r.tipo === 'sin-red') throw new ClockWriteError(r.error.message, r.error.hint, r.error.code, true)
  throw new ClockWriteError('FICHAR_NO_DISPONIBLE', 'El servidor no tiene la función de fichar. Avisa a tu encargado: NO ha quedado guardado.', null)
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
