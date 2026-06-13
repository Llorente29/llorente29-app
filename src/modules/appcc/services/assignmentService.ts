// src/modules/appcc/services/assignmentService.ts
// Motor de asignación de checklists APPCC — v2 (junio 2026).
//
// Asigna cada control a una persona según el MOMENTO del control
// (appcc_templates.assignment_moment) cruzado con el HORARIO VIVO del día
// (schedules.cells + shift_templates) y las VACACIONES aprobadas:
//
//   opening    -> quien ABRE ese día (entrada más temprana)
//   closing    -> quien CIERRA (salida más tardía)
//   fixed_time -> quien esté EN TURNO a la scheduled_time del control
//   any        -> cualquiera que trabaje ese día (reparto equitativo)
//
// En todos los casos el candidato DEBE estar trabajando ese día y NO de
// vacaciones/permiso aprobado. Entre varios candidatos válidos se reparte de
// forma equitativa por carga del MES (menos controles asignados = elegido).
// Si no hay nadie disponible -> null (la ejecución queda sin asignar; el gestor
// la ve como hueco y reasigna a mano).
//
// DEUDA DECLARADA: getClockedInEmployees() queda como legacy sin uso tras v2
// (el horario planificado es mejor señal que el fichaje). Se conserva por si se
// reaprovecha; pendiente decidir su retirada. El antiguo escalón "responsable
// fijo" (appcc_schedule_responsibles) tampoco se usa en v2.

import { supabase } from '@/lib/supabase'
import { getSchedule, listShiftTemplates } from '@/services/schedulerService'
import { getMondayOfWeek, toISODate, type ScheduleCells } from '@/types/scheduler'

/** Minutos desde medianoche de una hora 'HH:MM' o 'HH:MM:SS'. */
function toMin(hhmm: string): number {
  const parts = hhmm.slice(0, 5).split(':')
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m)) return 0
  return h * 60 + m
}

export interface ResolveAssignmentParams {
  templateId: string
  locationId: string
  date: string                 // YYYY-MM-DD del control
  scheduledTime: string | null // 'HH:MM' / 'HH:MM:SS' / null
}

/**
 * Determina a quién asignar un checklist APPCC (motor v2).
 * @returns employee_id del asignado, o null si no hay nadie disponible.
 */
export async function resolveAssignment(
  params: ResolveAssignmentParams,
): Promise<string | null> {
  if (!supabase) return null
  const sb = supabase
  const { templateId, locationId, date } = params

  // 1. Momento del control (de la plantilla)
  const { data: tpl } = await sb
    .from('appcc_templates')
    .select('assignment_moment')
    .eq('id', templateId)
    .maybeSingle()
  const moment: string = (tpl?.assignment_moment as string | undefined) ?? 'any'

  // 2. Horario vivo del día: schedules.cells (lunes de esa semana) + plantillas de turno
  const monday = toISODate(getMondayOfWeek(new Date(date + 'T00:00:00')))
  const [schedule, shiftTemplates] = await Promise.all([
    getSchedule(locationId, monday),
    listShiftTemplates(locationId),
  ])
  if (!schedule || !schedule.cells) return null

  const jsDay = new Date(date + 'T00:00:00').getDay() // 0=dom..6=sáb
  const dayKey = String((jsDay + 6) % 7)              // 0=lunes..6=domingo

  const tplById = new Map(shiftTemplates.map(t => [t.id, t]))

  // employee_id -> tramos del día (en minutos, con cruce de medianoche resuelto)
  interface Span { earliest: number; latest: number; intervals: Array<[number, number]> }
  const byEmp = new Map<string, Span>()
  const cells = schedule.cells as ScheduleCells
  for (const shiftTplId of Object.keys(cells)) {
    const st = tplById.get(shiftTplId)
    if (!st) continue
    const ids = cells[shiftTplId]?.[dayKey] || []
    if (ids.length === 0) continue
    const startMin = toMin(st.start_time)
    let endMin = toMin(st.end_time)
    if (endMin <= startMin) endMin += 1440 // cruza medianoche
    for (const id of ids) {
      const cur = byEmp.get(id) || { earliest: Infinity, latest: -Infinity, intervals: [] as Array<[number, number]> }
      cur.earliest = Math.min(cur.earliest, startMin)
      cur.latest = Math.max(cur.latest, endMin)
      cur.intervals.push([startMin, endMin])
      byEmp.set(id, cur)
    }
  }
  if (byEmp.size === 0) return null

  // 3. Disponibilidad: quitar a quien tenga vacación/permiso APROBADO ese día
  const workingIds = Array.from(byEmp.keys())
  const { data: vac } = await sb
    .from('vacations')
    .select('employee_id')
    .eq('status', 'aprobada')
    .in('employee_id', workingIds)
    .lte('start_date', date)
    .gte('end_date', date)
  const onVacation = new Set((vac || []).map((v: { employee_id: string }) => v.employee_id))
  const available = workingIds.filter(id => !onVacation.has(id))
  if (available.length === 0) return null

  // 4. Candidatos según el momento
  let candidates: string[] = []
  if (moment === 'opening') {
    const min = Math.min(...available.map(id => byEmp.get(id)!.earliest))
    candidates = available.filter(id => byEmp.get(id)!.earliest === min)
  } else if (moment === 'closing') {
    const max = Math.max(...available.map(id => byEmp.get(id)!.latest))
    candidates = available.filter(id => byEmp.get(id)!.latest === max)
  } else if (moment === 'fixed_time' && params.scheduledTime) {
    const t = toMin(params.scheduledTime)
    candidates = available.filter(id =>
      byEmp.get(id)!.intervals.some(([s, e]) =>
        (t >= s && t <= e) || (t + 1440 >= s && t + 1440 <= e)
      )
    )
    // Si nadie cubre esa hora exacta, repartir entre los disponibles del día.
    if (candidates.length === 0) candidates = available
  } else {
    // 'any' (o 'fixed_time' sin hora definida)
    candidates = available
  }
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // 5. Reparto equitativo: el candidato con MENOS controles asignados este mes
  const [y, m] = date.split('-').map(Number)
  const mm = String(m).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getDate()
  const monthStart = `${y}-${mm}-01`
  const monthEnd = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`

  const { data: execs } = await sb
    .from('appcc_executions')
    .select('assigned_to')
    .in('assigned_to', candidates)
    .gte('scheduled_date', monthStart)
    .lte('scheduled_date', monthEnd)

  const load = new Map<string, number>()
  for (const id of candidates) load.set(id, 0)
  for (const e of (execs || []) as Array<{ assigned_to: string | null }>) {
    if (e.assigned_to && load.has(e.assigned_to)) {
      load.set(e.assigned_to, (load.get(e.assigned_to) || 0) + 1)
    }
  }

  // Menor carga; empate -> id estable (orden lexicográfico) para no oscilar.
  candidates.sort((a, b) => {
    const la = load.get(a) || 0
    const lb = load.get(b) || 0
    if (la !== lb) return la - lb
    return a < b ? -1 : a > b ? 1 : 0
  })
  return candidates[0]
}

/**
 * @deprecated LEGACY (v1) — sin uso desde el motor v2. Devolvía los empleados
 * con jornada abierta (fichaje) en un local. Se conserva por si se reaprovecha;
 * v2 usa el horario planificado, no el fichaje. Pendiente decidir retirada.
 *
 * Devuelve los IDs de empleados con jornada abierta en un local (último
 * clock_entry de hoy = 'entrada'), ordenados por hora de fichaje ascendente.
 */
export async function getClockedInEmployees(locationId: string): Promise<string[]> {
  if (!supabase) return []

  const today = new Date().toISOString().slice(0, 10)
  const dayStart = `${today}T00:00:00Z`
  const dayEnd = `${today}T23:59:59Z`

  const { data: entries, error } = await supabase
    .from('clock_entries')
    .select('employee_id, type, datetime')
    .eq('location_id_at_clock', locationId)
    .gte('datetime', dayStart)
    .lte('datetime', dayEnd)
    .order('employee_id', { ascending: true })
    .order('datetime', { ascending: false })

  if (error) {
    console.error('[assignmentService] getClockedInEmployees clock_entries error', error)
    return []
  }
  if (!entries || entries.length === 0) return []

  const lastEntryByEmployee = new Map<string, { type: string; datetime: string }>()
  for (const e of entries) {
    if (!e.employee_id) continue
    if (!lastEntryByEmployee.has(e.employee_id)) {
      lastEntryByEmployee.set(e.employee_id, { type: e.type, datetime: e.datetime })
    }
  }

  const candidateIds: string[] = []
  for (const [employeeId, lastEntry] of lastEntryByEmployee) {
    if (lastEntry.type === 'entrada') candidateIds.push(employeeId)
  }
  if (candidateIds.length === 0) return []

  const { data: activeEmployees, error: empErr } = await supabase
    .from('employees')
    .select('id')
    .eq('active', true)
    .in('id', candidateIds)

  if (empErr) {
    console.error('[assignmentService] getClockedInEmployees employees error', empErr)
    return []
  }

  const activeIds = new Set((activeEmployees ?? []).map(e => e.id))
  const orderedFiltered = Array.from(lastEntryByEmployee.entries())
    .filter(([id, entry]) => activeIds.has(id) && entry.type === 'entrada')
    .sort((a, b) => new Date(a[1].datetime).getTime() - new Date(b[1].datetime).getTime())
    .map(([id]) => id)

  return orderedFiltered
}

/**
 * Asigna un checklist a un empleado concreto (o lo desasigna con null).
 * Actualiza el campo assigned_to de la ejecución.
 */
export async function assignExecution(
  executionId: string,
  employeeId: string | null,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('appcc_executions')
    .update({ assigned_to: employeeId })
    .eq('id', executionId)

  if (error) {
    console.error('[assignmentService] assignExecution error', error)
    throw error
  }
}
