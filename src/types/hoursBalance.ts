// src/types/hoursBalance.ts
// Bolsa de horas v2 — tipos compartidos

export type ClosureResolution =
  | 'pendiente'
  | 'pagado'
  | 'compensado'
  | 'arrastrado'
  | 'descartado'

export interface MonthlyBalanceClosure {
  id: string
  employeeId: string
  locationId: string
  periodLabel: string         // ej: "Mayo 2026"
  periodStart: string         // ISO YYYY-MM-DD
  periodEnd: string           // ISO YYYY-MM-DD
  scheduledHours: number
  vacationHours: number
  contractedHoursPeriod: number
  delta: number
  resolution: ClosureResolution
  resolutionNotes?: string
  resolutionAmount?: number
  closedAt: string
  closedBy?: string
  resolvedAt?: string
  resolvedBy?: string
}

export interface PeriodBalance {
  /** Identificación del periodo */
  periodLabel: string         // ej: "Mayo 2026"
  periodStart: string         // ISO 'YYYY-MM-DD'
  periodEnd: string           // ISO 'YYYY-MM-DD'

  /** Cifras */
  scheduledHours: number      // horas planificadas en el periodo
  vacationHours: number       // horas equivalentes por vacaciones aprobadas
  contractedHoursPeriod: number // contrato semanal × nº semanas del periodo
  delta: number               // scheduled + vacation - contracted

  /** Semanas del periodo no publicadas todavía */
  weeksWithoutSchedule: string[]

  /** Si está cerrado */
  isClosed: boolean
  closure?: MonthlyBalanceClosure
}

export interface EmployeeBalanceState {
  employeeId: string
  employeeName: string
  shiftCode?: string
  contractedHours: number
  initialBalance: number

  /** Periodo actualmente en curso (saldo vivo) */
  currentPeriod: PeriodBalance

  /** Cierres pendientes de resolver */
  pendingClosures: MonthlyBalanceClosure[]

  /** Histórico de cierres ya resueltos (ordenado de más reciente a más antiguo) */
  resolvedClosures: MonthlyBalanceClosure[]
}

/* =====================================================
   Helpers de fechas
   ===================================================== */

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const dt = parseISO(iso)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

export function addMonths(iso: string, months: number): string {
  const dt = parseISO(iso)
  dt.setMonth(dt.getMonth() + months)
  return toISODate(dt)
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/* =====================================================
   PERIODO DE CIERRE — la lógica clave
   ===================================================== */

/**
 * Devuelve el periodo de cierre que CONTIENE la fecha dada.
 *
 * El periodo va del día (closeDay+1) del mes anterior al día closeDay del mes actual.
 * Ej: closeDay=25 → periodo "Mayo 2026" = 26 abril a 25 mayo.
 *
 * Si la fecha es posterior al closeDay del mes actual, el periodo es el del mes siguiente.
 */
export function getPeriodForDate(date: Date, closeDay: number): {
  label: string
  start: string
  end: string
} {
  const d = new Date(date)
  const day = d.getDate()
  const month = d.getMonth() // 0-11
  const year = d.getFullYear()

  // Si hoy es <= closeDay → estamos en el periodo que cierra este mes
  // Si hoy es > closeDay → estamos en el periodo que cierra el mes siguiente
  let endYear: number
  let endMonth: number  // 0-11
  if (day <= closeDay) {
    endYear = year
    endMonth = month
  } else {
    endYear = month === 11 ? year + 1 : year
    endMonth = month === 11 ? 0 : month + 1
  }

  // Calcular periodo: end = endYear-endMonth-closeDay
  // Hay que ajustar closeDay si el mes no llega (ej: febrero con closeDay=31)
  const lastDayOfEndMonth = new Date(endYear, endMonth + 1, 0).getDate()
  const effectiveCloseDay = Math.min(closeDay, lastDayOfEndMonth)
  const endDate = new Date(endYear, endMonth, effectiveCloseDay)
  const endISO = toISODate(endDate)

  // Start = día siguiente al closeDay del mes anterior al endMonth
  const startMonth = endMonth === 0 ? 11 : endMonth - 1
  const startYear = endMonth === 0 ? endYear - 1 : endYear
  const lastDayOfStartMonth = new Date(startYear, startMonth + 1, 0).getDate()
  const effectiveStartDay = Math.min(closeDay, lastDayOfStartMonth) + 1
  // Si effectiveStartDay > último día del mes (ej: closeDay=31), usar día 1 del endMonth
  let startDate: Date
  if (effectiveStartDay > lastDayOfStartMonth) {
    startDate = new Date(endYear, endMonth, 1)
  } else {
    startDate = new Date(startYear, startMonth, effectiveStartDay)
  }
  const startISO = toISODate(startDate)

  // Etiqueta: usamos el mes del endDate
  const label = `${MONTH_LABELS[endMonth]} ${endYear}`
  return { label, start: startISO, end: endISO }
}

/** Devuelve el periodo INMEDIATAMENTE ANTERIOR al que contiene la fecha */
export function getPreviousPeriod(date: Date, closeDay: number): {
  label: string
  start: string
  end: string
} {
  const current = getPeriodForDate(date, closeDay)
  const prevDate = addDays(current.start, -1) // último día del periodo anterior
  return getPeriodForDate(parseISO(prevDate), closeDay)
}

/** Lista de periodos del año (los ya cerrados según la fecha actual) */
export function getYearPeriods(year: number, closeDay: number, today = new Date()): {
  label: string
  start: string
  end: string
}[] {
  const periods: { label: string; start: string; end: string }[] = []
  for (let m = 0; m < 12; m++) {
    const refDate = new Date(year, m, closeDay)
    const period = getPeriodForDate(refDate, closeDay)
    // Solo incluir periodos cuyo end es <= hoy
    if (parseISO(period.end) <= today) {
      periods.push(period)
    }
  }
  return periods
}

/** Cuenta cuántos días caen dentro del periodo, dado un rango */
export function daysInPeriod(
  rangeStartISO: string,
  rangeEndISO: string,
  periodStartISO: string,
  periodEndISO: string
): number {
  const start = rangeStartISO > periodStartISO ? rangeStartISO : periodStartISO
  const end = rangeEndISO < periodEndISO ? rangeEndISO : periodEndISO
  if (end < start) return 0
  const startDate = parseISO(start)
  const endDate = parseISO(end)
  const diffMs = endDate.getTime() - startDate.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1
}

/** Devuelve los lunes de todas las semanas que tocan el periodo */
export function weeksTouchingPeriod(periodStartISO: string, periodEndISO: string): string[] {
  const out: string[] = []
  const periodStart = parseISO(periodStartISO)
  const periodEnd = parseISO(periodEndISO)
  let monday = getMondayOfWeek(periodStart)
  while (monday <= periodEnd) {
    out.push(toISODate(monday))
    const next = new Date(monday)
    next.setDate(next.getDate() + 7)
    monday = next
  }
  return out
}

/** Cuántos días de una semana caen dentro del periodo */
export function daysOfWeekInPeriod(
  weekStartISO: string,
  periodStartISO: string,
  periodEndISO: string
): number {
  const weekEndISO = addDays(weekStartISO, 6)
  return daysInPeriod(weekStartISO, weekEndISO, periodStartISO, periodEndISO)
}
