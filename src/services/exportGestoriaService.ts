// src/services/exportGestoriaService.ts
// Genera un CSV con datos de cierre de bolsa de horas para enviar a la gestoría.
// Recalcula cada cierre desde sus datos originales (schedules + vacations + clock_entries)
// para obtener desgloses que no están en la tabla `monthly_balance_closures`.

import { supabase } from '../lib/supabase'
import type { Employee, Location } from '../types'
import type { ShiftTemplate, Schedule } from '../types/scheduler'
import type { MonthlyBalanceClosure } from '../types/hoursBalance'
import { weeksTouchingPeriod } from '../types/hoursBalance'

interface VacationRow {
  start_date: string
  end_date: string
  paid: boolean | null
}

interface ClockEntryRow {
  type: 'entrada' | 'salida'
  datetime: string
}

interface RecalculatedDetail {
  workedHoursReal: number       // solo lo que se trabajó (fichaje o planificado, sin ausencias)
  paidAbsenceHours: number      // ausencia retribuida (la que ya viene en closure.vacationHours)
  unpaidAbsenceHours: number    // ausencia no retribuida (no está en BD, hay que calcular)
}

/* =====================================================
   HELPERS
   ===================================================== */

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function* iterateDays(startISO: string, endISO: string): Generator<string> {
  const start = parseISO(startISO)
  const end = parseISO(endISO)
  const cur = new Date(start)
  while (cur <= end) {
    yield isoDate(cur)
    cur.setDate(cur.getDate() + 1)
  }
}

function getMondayOfWeek(iso: string): string {
  const d = parseISO(iso)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoDate(d)
}

function getDayOfWeek(iso: string): number {
  return parseISO(iso).getDay()
}

function daysInPeriod(startISO: string, endISO: string): number {
  let count = 0
  for (const _ of iterateDays(startISO, endISO)) count++
  return count
}

/** Formato español: 7.43 → "7,43" */
function formatNumberES(n: number, decimals = 2): string {
  return n.toFixed(decimals).replace('.', ',')
}

/** Escapa un valor para CSV: si contiene ; " o salto de línea → entre comillas con comillas duplicadas */
function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Resolución del cierre → texto legible para el CSV */
function resolutionLabel(r: string): string {
  const map: Record<string, string> = {
    pendiente: 'Pendiente',
    pagado: 'Pagado',
    compensado: 'Compensado',
    arrastrado: 'Arrastrado',
    descartado: 'Descartado',
  }
  return map[r] || r
}

/* =====================================================
   CARGA DE DATOS PARA RECÁLCULO
   ===================================================== */

async function loadSchedulesForLocation(
  locationId: string,
  weekStartISOs: string[]
): Promise<Map<string, Schedule>> {
  const out = new Map<string, Schedule>()
  if (!supabase || weekStartISOs.length === 0) return out
  const { data } = await supabase
    .from('schedules')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'published')
    .in('week_start', weekStartISOs)
  for (const row of data || []) out.set(row.week_start, row as Schedule)
  return out
}

async function loadTemplates(locationId: string): Promise<ShiftTemplate[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('shift_templates')
    .select('*')
    .eq('location_id', locationId)
  return (data || []) as ShiftTemplate[]
}

async function loadVacations(employeeId: string, periodStart: string, periodEnd: string): Promise<VacationRow[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('vacations')
    .select('start_date, end_date, paid')
    .eq('employee_id', employeeId)
    .eq('status', 'aprobada')
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart)
  return (data || []) as VacationRow[]
}

async function loadClockEntries(employeeId: string, periodStart: string, periodEnd: string): Promise<ClockEntryRow[]> {
  if (!supabase) return []
  const startISO = `${periodStart}T00:00:00.000Z`
  const endISO = `${periodEnd}T23:59:59.999Z`
  const { data } = await supabase
    .from('clock_entries')
    .select('type, datetime')
    .eq('employee_id', employeeId)
    .gte('datetime', startISO)
    .lte('datetime', endISO)
    .order('datetime', { ascending: true })
  return (data || []) as ClockEntryRow[]
}

/* =====================================================
   CÁLCULO DETALLADO
   ===================================================== */

function getScheduledHoursForDay(
  dayISO: string,
  schedule: Schedule | undefined,
  templates: ShiftTemplate[],
  employeeId: string
): number {
  if (!schedule) return 0
  const dow = getDayOfWeek(dayISO)
  let totalMinutes = 0
  const tplById = new Map(templates.map(t => [t.id, t]))
  for (const tid of Object.keys(schedule.cells)) {
    const t = tplById.get(tid)
    if (!t) continue
    for (const dayKey of Object.keys(schedule.cells[tid])) {
      const dayKeyNum = parseInt(dayKey, 10)
      const expectedGetDay = dayKeyNum === 6 ? 0 : dayKeyNum + 1
      if (expectedGetDay !== dow) continue
      const ids = schedule.cells[tid][dayKey]
      if (!ids.includes(employeeId)) continue
      const start = t.start_time.slice(0, 5)
      const end = t.end_time.slice(0, 5)
      const [sh, sm] = start.split(':').map(Number)
      const [eh, em] = end.split(':').map(Number)
      let mins = (eh * 60 + em) - (sh * 60 + sm)
      if (mins <= 0) mins += 24 * 60
      totalMinutes += mins
    }
  }
  return totalMinutes / 60
}

function getClockedHoursForDay(dayISO: string, allEntries: ClockEntryRow[]): number {
  const dayEntries = allEntries.filter(e => e.datetime.slice(0, 10) === dayISO)
  if (dayEntries.length === 0) return 0
  let totalMinutes = 0
  let openEntry: ClockEntryRow | null = null
  for (const e of dayEntries) {
    if (e.type === 'entrada') {
      openEntry = e
    } else if (e.type === 'salida' && openEntry) {
      const inMs = new Date(openEntry.datetime).getTime()
      const outMs = new Date(e.datetime).getTime()
      let mins = (outMs - inMs) / 60000
      if (mins < 0) mins += 24 * 60
      totalMinutes += mins
      openEntry = null
    }
  }
  return totalMinutes / 60
}

function getVacationOnDay(dayISO: string, vacations: VacationRow[]): { found: boolean; paid: boolean } {
  for (const v of vacations) {
    if (dayISO >= v.start_date && dayISO <= v.end_date) {
      return { found: true, paid: v.paid ?? true }
    }
  }
  return { found: false, paid: false }
}

/**
 * Recalcula un cierre para obtener el desglose detallado que la BD no guarda:
 * horas trabajadas reales (sin ausencias), ausencia retribuida y ausencia no retribuida
 */
async function recalculateClosureDetail(
  employee: Employee,
  closure: MonthlyBalanceClosure
): Promise<RecalculatedDetail> {
  const locationId = employee.locationId
  if (!locationId) {
    return { workedHoursReal: 0, paidAbsenceHours: 0, unpaidAbsenceHours: 0 }
  }

  const weeks = weeksTouchingPeriod(closure.periodStart, closure.periodEnd)
  const [schedules, templates, vacations, clockEntries] = await Promise.all([
    loadSchedulesForLocation(locationId, weeks),
    loadTemplates(locationId),
    loadVacations(employee.id, closure.periodStart, closure.periodEnd),
    loadClockEntries(employee.id, closure.periodStart, closure.periodEnd),
  ])

  const weeklyContract = employee.weeklyHours || 40
  const dailyContract = weeklyContract / 7

  let workedReal = 0
  let paidAbsence = 0
  let unpaidAbsence = 0

  for (const dayISO of iterateDays(closure.periodStart, closure.periodEnd)) {
    // 1) Ausencia
    const vac = getVacationOnDay(dayISO, vacations)
    if (vac.found) {
      if (vac.paid) {
        paidAbsence += dailyContract
      } else {
        unpaidAbsence += dailyContract
      }
      continue
    }

    // 2) Fichaje
    const clocked = getClockedHoursForDay(dayISO, clockEntries)
    if (clocked > 0) {
      workedReal += clocked
      continue
    }

    // 3) Planificado (sin fichaje, asumimos planificado)
    const weekMonday = getMondayOfWeek(dayISO)
    const schedule = schedules.get(weekMonday)
    const scheduled = getScheduledHoursForDay(dayISO, schedule, templates, employee.id)
    if (scheduled > 0) {
      workedReal += scheduled
    }
    // 4) Día libre, no suma nada
  }

  return {
    workedHoursReal: Math.round(workedReal * 100) / 100,
    paidAbsenceHours: Math.round(paidAbsence * 100) / 100,
    unpaidAbsenceHours: Math.round(unpaidAbsence * 100) / 100,
  }
}

/* =====================================================
   CSV BUILDER
   ===================================================== */

interface ExportInput {
  closure: MonthlyBalanceClosure
  employee: Employee
  location?: Location
}

const CSV_HEADERS = [
  'DNI',
  'Nombre',
  'Local',
  'Tipo contrato',
  'Fecha alta',
  'Horas contrato/sem',
  'Periodo',
  'Inicio periodo',
  'Fin periodo',
  'Días naturales',
  'Horas contratadas periodo',
  'Horas trabajadas reales',
  'Horas ausencia retribuida',
  'Horas ausencia NO retribuida',
  'Total horas computables',
  'Saldo (delta)',
  'Resolución',
  'Horas a pagar',
  'Horas compensadas',
  'Horas arrastradas',
  'Notas resolución',
  'Cerrado el',
  'Resuelto el',
]

function buildCsvRow(
  input: ExportInput,
  detail: RecalculatedDetail
): string {
  const { closure, employee, location } = input

  // Cálculos derivados según resolución
  const resol = closure.resolution
  const amount = closure.resolutionAmount ?? 0
  const horasPagar = resol === 'pagado' ? amount : 0
  const horasCompensar = resol === 'compensado' ? amount : 0
  const horasArrastrar = resol === 'arrastrado' ? amount : 0

  const closedDate = closure.closedAt ? closure.closedAt.slice(0, 10) : ''
  const resolvedDate = closure.resolvedAt ? closure.resolvedAt.slice(0, 10) : ''

  const cells = [
    employee.dni,
    employee.name,
    location?.name || '',
    employee.contractType,
    employee.startDate,
    formatNumberES(employee.weeklyHours || 0, 2),
    closure.periodLabel,
    closure.periodStart,
    closure.periodEnd,
    String(daysInPeriod(closure.periodStart, closure.periodEnd)),
    formatNumberES(closure.contractedHoursPeriod, 2),
    formatNumberES(detail.workedHoursReal, 2),
    formatNumberES(detail.paidAbsenceHours, 2),
    formatNumberES(detail.unpaidAbsenceHours, 2),
    formatNumberES(closure.scheduledHours, 2),
    formatNumberES(closure.delta, 2),
    resolutionLabel(closure.resolution),
    formatNumberES(horasPagar, 2),
    formatNumberES(horasCompensar, 2),
    formatNumberES(horasArrastrar, 2),
    closure.resolutionNotes || '',
    closedDate,
    resolvedDate,
  ]

  return cells.map(c => csvEscape(c)).join(';')
}

/* =====================================================
   API PÚBLICA
   ===================================================== */

export interface ExportGestoriaInput {
  closures: MonthlyBalanceClosure[]
  employees: Employee[]
  locations: Location[]
}

/**
 * Genera el CSV con todas las filas y dispara la descarga del archivo.
 * Recalcula los desgloses (worked real / ausencia paid / ausencia unpaid) en paralelo.
 */
export async function exportGestoriaCsv(input: ExportGestoriaInput): Promise<void> {
  const { closures, employees, locations } = input

  if (closures.length === 0) {
    alert('No hay cierres para exportar.')
    return
  }

  // Recalcular detalle para cada cierre en paralelo
  const recalculations = await Promise.all(closures.map(async (closure) => {
    const employee = employees.find(e => e.id === closure.employeeId)
    const location = locations.find(l => l.id === closure.locationId)
    if (!employee) return null
    const detail = await recalculateClosureDetail(employee, closure)
    return { closure, employee, location, detail }
  }))

  // Filtrar nulos (cierres sin empleado)
  const valid = recalculations.filter((r): r is NonNullable<typeof r> => r !== null)
  if (valid.length === 0) {
    alert('No se pudieron procesar los cierres seleccionados.')
    return
  }

  // Construir CSV
  const headerLine = CSV_HEADERS.map(csvEscape).join(';')
  const dataLines = valid.map(r => buildCsvRow(
    { closure: r.closure, employee: r.employee, location: r.location },
    r.detail
  ))
  const csvBody = [headerLine, ...dataLines].join('\r\n')

  // BOM UTF-8 para que Excel español detecte bien acentos y eñes
  const BOM = '\uFEFF'
  const csv = BOM + csvBody

  // Disparar descarga
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const filename = `bolsa-horas-gestoria-${yyyy}-${mm}-${dd}.csv`
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
