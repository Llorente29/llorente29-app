// src/services/calendarService.ts
// Servicio del calendario de horarios: tipos de turno, planes semanales, asignaciones.
import { supabase } from '../lib/supabase'

// ─── TIPOS ────────────────────────────────────────────────────────────────

export interface ShiftType {
  id: string
  code: string                  // "T1", "T2", "T3", "T1+T3", "LIBRE"
  label: string
  startTime?: string            // "12:30"
  endTime?: string              // "16:45"
  breakMinutes?: number
  hours: number
  color: string
  isSplit: boolean
  split2Start?: string
  split2End?: string
  isOff: boolean
  active: boolean
  displayOrder: number
}

export type PlanStatus = 'borrador' | 'publicado'

export interface WeeklyPlan {
  id: string
  locationId?: string           // null = afecta a todos los locales
  weekStart: string             // "2026-05-04" (lunes)
  status: PlanStatus
  notes?: string
  publishedAt?: string
  publishedBy?: string
  createdAt: string
  updatedAt: string
}

export interface ShiftAssignment {
  id: string
  planId: string
  employeeId: string
  date: string                  // "2026-05-04"
  slot: number                  // 1 o 2 (turno partido = 2 asignaciones)
  shiftTypeId?: string          // null = sin asignar (dejar vacío)
  overrideStart?: string
  overrideEnd?: string
  notes?: string
}

export interface ShiftMinimum {
  id: string
  locationId?: string           // null = default global
  shiftTypeId: string
  minDefault: number
  minWeekend?: number
}

// ─── ROW MAPPERS ──────────────────────────────────────────────────────────

interface ShiftTypeRow {
  id: string; code: string; label: string
  start_time: string | null; end_time: string | null
  break_minutes: number | null
  hours: number
  color: string
  is_split: boolean
  split_2_start: string | null; split_2_end: string | null
  is_off: boolean; active: boolean
  display_order: number
}

interface PlanRow {
  id: string; location_id: string | null
  week_start: string
  status: PlanStatus
  notes: string | null
  published_at: string | null
  published_by: string | null
  created_at: string; updated_at: string
}

interface AssignmentRow {
  id: string; plan_id: string; employee_id: string
  date: string
  slot: number
  shift_type_id: string | null
  override_start: string | null; override_end: string | null
  notes: string | null
}

interface MinimumRow {
  id: string; location_id: string | null
  shift_type_id: string
  min_default: number; min_weekend: number | null
}

function rowToShiftType(r: ShiftTypeRow): ShiftType {
  return {
    id: r.id, code: r.code, label: r.label,
    startTime: r.start_time || undefined, endTime: r.end_time || undefined,
    breakMinutes: r.break_minutes ?? undefined,
    hours: Number(r.hours),
    color: r.color,
    isSplit: r.is_split,
    split2Start: r.split_2_start || undefined,
    split2End: r.split_2_end || undefined,
    isOff: r.is_off, active: r.active,
    displayOrder: r.display_order,
  }
}

function rowToPlan(r: PlanRow): WeeklyPlan {
  return {
    id: r.id,
    locationId: r.location_id || undefined,
    weekStart: r.week_start,
    status: r.status,
    notes: r.notes || undefined,
    publishedAt: r.published_at || undefined,
    publishedBy: r.published_by || undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function rowToAssignment(r: AssignmentRow): ShiftAssignment {
  return {
    id: r.id, planId: r.plan_id, employeeId: r.employee_id,
    date: r.date,
    slot: r.slot ?? 1,
    shiftTypeId: r.shift_type_id || undefined,
    overrideStart: r.override_start || undefined,
    overrideEnd: r.override_end || undefined,
    notes: r.notes || undefined,
  }
}

function rowToMinimum(r: MinimumRow): ShiftMinimum {
  return {
    id: r.id,
    locationId: r.location_id || undefined,
    shiftTypeId: r.shift_type_id,
    minDefault: r.min_default,
    minWeekend: r.min_weekend ?? undefined,
  }
}

// ─── SHIFT TYPES ──────────────────────────────────────────────────────────

export async function fetchShiftTypes(): Promise<ShiftType[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('shift_types')
    .select('*').eq('active', true).order('display_order')
  if (error) { console.error('fetchShiftTypes:', error); return [] }
  return (data as ShiftTypeRow[]).map(rowToShiftType)
}

// ─── PLANS ────────────────────────────────────────────────────────────────

/**
 * Devuelve el plan de una semana concreta para un local. Si no existe lo crea como borrador.
 */
export async function getOrCreatePlan(weekStart: string, locationId: string): Promise<WeeklyPlan | null> {
  if (!supabase) return null
  // Buscar
  const { data: existing } = await supabase.from('weekly_plans')
    .select('*').eq('week_start', weekStart).eq('location_id', locationId).maybeSingle()
  if (existing) return rowToPlan(existing as PlanRow)

  // Crear
  const { data, error } = await supabase.from('weekly_plans').insert({
    week_start: weekStart,
    location_id: locationId,
    status: 'borrador',
  }).select().single()
  if (error) { console.error('getOrCreatePlan:', error); return null }
  return rowToPlan(data as PlanRow)
}

export async function fetchPlanForWeek(weekStart: string, locationId: string): Promise<WeeklyPlan | null> {
  if (!supabase) return null
  const { data } = await supabase.from('weekly_plans')
    .select('*').eq('week_start', weekStart).eq('location_id', locationId).maybeSingle()
  if (!data) return null
  return rowToPlan(data as PlanRow)
}

export async function publishPlan(planId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('weekly_plans').update({
    status: 'publicado',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', planId)
  if (error) { console.error('publishPlan:', error); return false }
  return true
}

export async function unpublishPlan(planId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('weekly_plans').update({
    status: 'borrador',
    published_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', planId)
  if (error) { console.error('unpublishPlan:', error); return false }
  return true
}

// ─── ASSIGNMENTS ──────────────────────────────────────────────────────────

export async function fetchAssignmentsForPlan(planId: string): Promise<ShiftAssignment[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('shift_assignments')
    .select('*').eq('plan_id', planId).order('date')
  if (error) { console.error('fetchAssignmentsForPlan:', error); return [] }
  return (data as AssignmentRow[]).map(rowToAssignment)
}

/**
 * Asignaciones publicadas (visibles para el trabajador) en un rango de fechas para un empleado.
 */
export async function fetchPublishedAssignmentsForEmployee(
  employeeId: string, fromDate: string, toDate: string,
): Promise<{ assignment: ShiftAssignment; shiftType: ShiftType | null }[]> {
  if (!supabase) return []
  // Inner join virtual: traemos asignaciones del empleado y luego enriquecemos con plan publicado
  const { data: rawAssigns } = await supabase.from('shift_assignments')
    .select('*').eq('employee_id', employeeId).gte('date', fromDate).lte('date', toDate)
  if (!rawAssigns) return []

  const assigns = (rawAssigns as AssignmentRow[]).map(rowToAssignment)
  if (assigns.length === 0) return []

  // Filtrar solo las que pertenezcan a planes publicados
  const planIds = Array.from(new Set(assigns.map(a => a.planId)))
  const { data: rawPlans } = await supabase.from('weekly_plans')
    .select('*').in('id', planIds)
  const publishedIds = new Set(
    ((rawPlans as PlanRow[]) || []).filter(p => p.status === 'publicado').map(p => p.id)
  )
  const filtered = assigns.filter(a => publishedIds.has(a.planId))

  // Enriquecer con tipos
  const types = await fetchShiftTypes()
  const typeMap = new Map(types.map(t => [t.id, t]))
  return filtered.map(a => ({
    assignment: a,
    shiftType: a.shiftTypeId ? (typeMap.get(a.shiftTypeId) || null) : null,
  }))
}

/**
 * Asignaciones publicadas (visibles para el trabajador) para MÚLTIPLES empleados en un rango.
 * Útil para el panel "Ahora mismo" del gestor que necesita el horario teórico de todo el equipo.
 */
export async function fetchPublishedAssignmentsForRange(
  fromDate: string, toDate: string,
): Promise<{ assignments: ShiftAssignment[]; types: ShiftType[] }> {
  if (!supabase) return { assignments: [], types: [] }

  const { data: rawAssigns } = await supabase.from('shift_assignments')
    .select('*').gte('date', fromDate).lte('date', toDate)
  if (!rawAssigns) return { assignments: [], types: [] }

  const assigns = (rawAssigns as AssignmentRow[]).map(rowToAssignment)
  if (assigns.length === 0) {
    const types = await fetchShiftTypes()
    return { assignments: [], types }
  }

  const planIds = Array.from(new Set(assigns.map(a => a.planId)))
  const { data: rawPlans } = await supabase.from('weekly_plans')
    .select('*').in('id', planIds)
  const publishedIds = new Set(
    ((rawPlans as PlanRow[]) || []).filter(p => p.status === 'publicado').map(p => p.id)
  )
  const filtered = assigns.filter(a => publishedIds.has(a.planId))

  const types = await fetchShiftTypes()
  return { assignments: filtered, types }
}

export async function upsertAssignment(input: {
  planId: string; employeeId: string; date: string;
  shiftTypeId?: string | null;
  slot?: number;
  overrideStart?: string; overrideEnd?: string;
  notes?: string;
}): Promise<ShiftAssignment | null> {
  if (!supabase) return null
  const sb = supabase
  const slot = input.slot ?? 1

  // Si shiftTypeId es null o undefined, borrar la asignación si existe
  if (!input.shiftTypeId) {
    await sb.from('shift_assignments')
      .delete()
      .eq('plan_id', input.planId)
      .eq('employee_id', input.employeeId)
      .eq('date', input.date)
      .eq('slot', slot)
    return null
  }

  const { data, error } = await sb.from('shift_assignments').upsert({
    plan_id: input.planId,
    employee_id: input.employeeId,
    date: input.date,
    slot,
    shift_type_id: input.shiftTypeId,
    override_start: input.overrideStart || null,
    override_end: input.overrideEnd || null,
    notes: input.notes || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'plan_id,employee_id,date,slot' }).select().single()

  if (error) { console.error('upsertAssignment:', error); return null }
  return rowToAssignment(data as AssignmentRow)
}

export async function deleteAssignment(planId: string, employeeId: string, date: string, slot?: number): Promise<boolean> {
  if (!supabase) return false
  let q = supabase.from('shift_assignments')
    .delete()
    .eq('plan_id', planId)
    .eq('employee_id', employeeId)
    .eq('date', date)
  if (slot !== undefined) q = q.eq('slot', slot)
  const { error } = await q
  if (error) { console.error('deleteAssignment:', error); return false }
  return true
}

/**
 * Duplica las asignaciones de la semana anterior al plan actual.
 * - Busca el plan de la semana anterior para el mismo local
 * - Copia cada asignación al día equivalente de la semana actual (+7 días)
 * - Si ya hay asignación en la semana actual, la sobreescribe
 * Devuelve número de asignaciones copiadas, o null si no hay semana anterior.
 */
export async function duplicatePreviousWeek(
  currentPlanId: string,
  currentWeekStart: string,
  locationId: string,
): Promise<number | null> {
  if (!supabase) return null
  const sb = supabase

  // Calcular el lunes anterior
  const d = new Date(currentWeekStart + 'T00:00:00')
  d.setDate(d.getDate() - 7)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const prevWeekStart = `${y}-${m}-${dd}`

  // Buscar plan anterior
  const { data: prevPlan } = await sb.from('weekly_plans')
    .select('*').eq('week_start', prevWeekStart).eq('location_id', locationId).maybeSingle()
  if (!prevPlan) return null

  // Cargar asignaciones del plan anterior
  const { data: prevAssigns } = await sb.from('shift_assignments')
    .select('*').eq('plan_id', (prevPlan as { id: string }).id)
  if (!prevAssigns) return 0

  let copied = 0
  for (const a of prevAssigns as Array<{ employee_id: string; date: string; shift_type_id: string | null; override_start: string | null; override_end: string | null; notes: string | null }>) {
    // Sumar 7 días a la fecha
    const da = new Date(a.date + 'T00:00:00')
    da.setDate(da.getDate() + 7)
    const ny = da.getFullYear()
    const nm = String(da.getMonth() + 1).padStart(2, '0')
    const ndd = String(da.getDate()).padStart(2, '0')
    const newDate = `${ny}-${nm}-${ndd}`

    if (!a.shift_type_id) continue

    await sb.from('shift_assignments').upsert({
      plan_id: currentPlanId,
      employee_id: a.employee_id,
      date: newDate,
      slot: (a as { slot?: number }).slot ?? 1,
      shift_type_id: a.shift_type_id,
      override_start: a.override_start,
      override_end: a.override_end,
      notes: a.notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_id,employee_id,date,slot' })
    copied++
  }
  return copied
}

/**
 * Borra todas las asignaciones de un plan (no borra el plan).
 */
export async function clearPlanAssignments(planId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('shift_assignments').delete().eq('plan_id', planId)
  if (error) { console.error('clearPlanAssignments:', error); return false }
  return true
}

// ─── MINIMUMS ─────────────────────────────────────────────────────────────

export async function fetchMinimums(locationId?: string): Promise<ShiftMinimum[]> {
  if (!supabase) return []
  // Trae globales + del local
  const { data, error } = await supabase.from('shift_minimums').select('*')
  if (error) { console.error('fetchMinimums:', error); return [] }
  const all = (data as MinimumRow[]).map(rowToMinimum)
  // Si hay específico del local, prevalece sobre el global
  if (locationId) {
    const local = all.filter(m => m.locationId === locationId)
    const global = all.filter(m => !m.locationId)
    const localTypes = new Set(local.map(m => m.shiftTypeId))
    return [...local, ...global.filter(g => !localTypes.has(g.shiftTypeId))]
  }
  return all.filter(m => !m.locationId)
}


// ─── EDITAR TIPOS DE TURNO ────────────────────────────────────────────────

export async function fetchAllShiftTypes(): Promise<ShiftType[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('shift_types')
    .select('*').order('display_order')
  if (error) { console.error('fetchAllShiftTypes:', error); return [] }
  return (data as ShiftTypeRow[]).map(rowToShiftType)
}

export async function upsertShiftType(input: {
  id?: string
  code: string
  label: string
  startTime?: string
  endTime?: string
  color: string
  active?: boolean
  displayOrder?: number
}): Promise<ShiftType | null> {
  if (!supabase) return null
  const sb = supabase

  // Calcular horas automáticamente desde el horario
  let hours = 0
  if (input.startTime && input.endTime) {
    const [sh, sm] = input.startTime.split(':').map(Number)
    const [eh, em] = input.endTime.split(':').map(Number)
    const startMin = sh * 60 + sm
    let endMin = eh * 60 + em
    if (endMin <= startMin) endMin += 24 * 60   // cruce medianoche
    hours = (endMin - startMin) / 60
  }

  const payload = {
    code: input.code,
    label: input.label,
    start_time: input.startTime || null,
    end_time: input.endTime || null,
    hours,
    color: input.color,
    active: input.active ?? true,
    display_order: input.displayOrder ?? 1,
    is_split: false,
    is_off: false,
  }

  if (input.id) {
    const { data, error } = await sb.from('shift_types').update(payload).eq('id', input.id).select().single()
    if (error) { console.error('upsertShiftType update:', error); return null }
    return rowToShiftType(data as ShiftTypeRow)
  } else {
    const { data, error } = await sb.from('shift_types').insert(payload).select().single()
    if (error) { console.error('upsertShiftType insert:', error); return null }
    return rowToShiftType(data as ShiftTypeRow)
  }
}

export async function setShiftTypeActive(id: string, active: boolean): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('shift_types').update({ active }).eq('id', id)
  if (error) { console.error('setShiftTypeActive:', error); return false }
  return true
}

/**
 * Borra un tipo de turno. Solo si no tiene asignaciones (de lo contrario debe desactivarse).
 * Devuelve número de asignaciones bloqueantes, o 0 si se borró correctamente.
 */
export async function deleteShiftType(id: string): Promise<number> {
  if (!supabase) return -1
  const sb = supabase

  // Comprobar si hay asignaciones
  const { count } = await sb.from('shift_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('shift_type_id', id)

  if (count && count > 0) {
    return count   // hay asignaciones, no se puede borrar
  }

  // Borrar mínimos y planning relacionados
  await sb.from('shift_minimums').delete().eq('shift_type_id', id)
  await sb.from('location_planning').delete().eq('shift_type_id', id)

  // Borrar el tipo
  const { error } = await sb.from('shift_types').delete().eq('id', id)
  if (error) { console.error('deleteShiftType:', error); return -1 }
  return 0
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

/** Devuelve el lunes (ISO YYYY-MM-DD) de la semana de una fecha. */
export function mondayOf(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const offsetToMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + offsetToMonday)
  // Construir ISO string local (no UTC) para evitar problemas de zona horaria
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day2 = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day2}`
}

/** Genera array de 7 fechas (YYYY-MM-DD) desde el lunes. */
export function weekDates(weekStartIso: string): string[] {
  const d = new Date(weekStartIso + 'T00:00:00')
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const x = new Date(d)
    x.setDate(d.getDate() + i)
    const y = x.getFullYear()
    const m = String(x.getMonth() + 1).padStart(2, '0')
    const day = String(x.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${day}`)
  }
  return out
}

/** Formatea fecha YYYY-MM-DD a "Lun 5" para cabeceras. */
export function shortDayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const day = d.toLocaleDateString('es-ES', { weekday: 'short' })
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d.getDate()}`
}

/** ¿Es fin de semana (V-S-D)? */
export function isWeekend(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00')
  const day = d.getDay() // 0=dom, 5=vie, 6=sab
  return day === 5 || day === 6 || day === 0
}

// ─── HELPERS PARA SMART GEN ───────────────────────────────────────────────

/**
 * Devuelve las fechas (YYYY-MM-DD) en las que cada empleado tiene VACACIONES APROBADAS
 * dentro del rango dado.
 */
export async function fetchApprovedVacationDates(fromDate: string, toDate: string): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  if (!supabase) return result

  const { data, error } = await supabase.from('vacations')
    .select('employee_id, start_date, end_date, status')
    .eq('status', 'aprobada')
    .lte('start_date', toDate)
    .gte('end_date', fromDate)

  if (error) { console.error('fetchApprovedVacationDates:', error); return result }

  for (const v of (data as Array<{ employee_id: string; start_date: string; end_date: string }>)) {
    const set = result.get(v.employee_id) || new Set<string>()
    const start = new Date(v.start_date + 'T00:00:00')
    const end = new Date(v.end_date + 'T00:00:00')
    const cur = new Date(start)
    while (cur <= end) {
      const y = cur.getFullYear()
      const m = String(cur.getMonth() + 1).padStart(2, '0')
      const d = String(cur.getDate()).padStart(2, '0')
      set.add(`${y}-${m}-${d}`)
      cur.setDate(cur.getDate() + 1)
    }
    result.set(v.employee_id, set)
  }
  return result
}

/**
 * Calcula horas mensuales ya asignadas en planes PUBLICADOS, antes de una fecha.
 * Devuelve mapa employee_id -> horas.
 */
export async function fetchMonthlyHoursBefore(weekStart: string): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!supabase) return result

  // Inicio del mes
  const d = new Date(weekStart + 'T00:00:00')
  const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

  const { data: assigns } = await supabase.from('shift_assignments')
    .select('employee_id, shift_type_id')
    .gte('date', monthStart)
    .lt('date', weekStart)

  if (!assigns) return result

  const { data: types } = await supabase.from('shift_types').select('id, hours, is_off')
  const hoursByType = new Map<string, number>()
  for (const t of (types || []) as Array<{ id: string; hours: number; is_off: boolean }>) {
    if (!t.is_off) hoursByType.set(t.id, Number(t.hours))
  }

  for (const a of assigns as Array<{ employee_id: string; shift_type_id: string | null }>) {
    if (!a.shift_type_id) continue
    const h = hoursByType.get(a.shift_type_id) || 0
    result.set(a.employee_id, (result.get(a.employee_id) || 0) + h)
  }
  return result
}
