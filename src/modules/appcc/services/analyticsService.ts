// src/modules/appcc/services/analyticsService.ts
// Servicio de analíticas para el dashboard APPCC.
// Todas las consultas son agregadas / read-only contra Supabase.
//
// Convenciones:
//  - "rango": [fromISO, toISO] inclusive, formato YYYY-MM-DD
//  - "locationIds": null = todos los locales | array = filtrar a esos locales
//  - Los resultados se devuelven en estructuras planas y serializables
//    (sin Date, solo strings ISO) para facilitar memoización.

import { supabase } from '@/lib/supabase'
import type {
  AppccSeverity,
} from '@/modules/appcc/types'

// ============================================================
// TIPOS DE SALIDA
// ============================================================

export interface DateRange {
  from: string  // YYYY-MM-DD inclusive
  to: string    // YYYY-MM-DD inclusive
}

export interface KpiSummary {
  /** Incidencias abiertas hoy (snapshot puntual, no del rango) */
  openIncidents: number
  /** % de ejecuciones completadas en el rango (0-100) */
  completionRate: number
  /** Tiempo medio de resolución en horas (corrected_at - created_at) */
  avgResolutionHours: number | null
  /** Controles ejecutados completados en el rango */
  executionsCompleted: number
  /** Total de ejecuciones del rango (completed + overdue + pending) */
  executionsTotal: number
  /** Incidencias creadas en el rango */
  incidentsCreatedInRange: number
}

/** Punto de la serie de cumplimiento diario */
export interface DailyComplianceData {
  date: string         // YYYY-MM-DD
  total: number        // ejecuciones del día
  completed: number    // completadas
  rate: number         // % (0-100)
}

/** Distribución de incidencias por severidad */
export interface SeverityDistribution {
  severity: AppccSeverity
  count: number
}

/** Distribución por categoría libre */
export interface CategoryDistribution {
  category: string  // 'Sin categoría' si null
  count: number
}

/** Métricas por local (ranking) */
export interface LocationMetrics {
  locationId: string
  locationName: string
  completionRate: number       // 0-100
  openIncidents: number        // ahora mismo
  incidentsInRange: number     // total del rango
  criticalInRange: number      // crítica + alta en el rango
}

/** Plantilla con más fallos (incidencias generadas) */
export interface TopFailingTemplate {
  templateId: string
  templateName: string
  templateCode: string
  failuresInRange: number
}

/** Celda del heatmap día/hora */
export interface HeatmapCell {
  dayOfWeek: number    // 0=domingo … 6=sábado
  hour: number         // 0-23
  count: number
}

// ============================================================
// HELPERS
// ============================================================

function rangeBounds(range: DateRange): { fromTs: string; toTs: string } {
  return {
    fromTs: `${range.from}T00:00:00Z`,
    toTs: `${range.to}T23:59:59Z`,
  }
}

// ============================================================
// KPIs principales (1 sola consulta agregada por bloque)
// ============================================================

export async function getKpiSummary(
  range: DateRange,
  locationIds: string[] | null,
): Promise<KpiSummary> {
  if (!supabase) {
    return {
      openIncidents: 0, completionRate: 0, avgResolutionHours: null,
      executionsCompleted: 0, executionsTotal: 0, incidentsCreatedInRange: 0,
    }
  }

  const { fromTs, toTs } = rangeBounds(range)

  // --- 1. Ejecuciones del rango (para completion rate) ---
  let execQuery = supabase
    .from('appcc_executions')
    .select('status, completed_at, scheduled_date', { count: 'exact' })
    .gte('scheduled_date', range.from)
    .lte('scheduled_date', range.to)
  if (locationIds && locationIds.length > 0) {
    execQuery = execQuery.in('location_id', locationIds)
  }
  const { data: execs, error: execErr } = await execQuery
  if (execErr) {
    console.error('[analyticsService] getKpiSummary execs error', execErr)
  }
  const executionsTotal = execs?.length ?? 0
  const executionsCompleted = (execs ?? []).filter(e => e.status === 'completed').length
  const completionRate = executionsTotal > 0
    ? Math.round((executionsCompleted / executionsTotal) * 100)
    : 0

  // --- 2. Incidencias creadas en el rango (para tiempo de resolución) ---
  let incQuery = supabase
    .from('appcc_incidents')
    .select('created_at, status, corrective_action_at, closed_at')
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
  if (locationIds && locationIds.length > 0) {
    incQuery = incQuery.in('location_id', locationIds)
  }
  const { data: incs, error: incErr } = await incQuery
  if (incErr) {
    console.error('[analyticsService] getKpiSummary incs error', incErr)
  }
  const incidentsCreatedInRange = incs?.length ?? 0

  // Tiempo medio resolución (corrective_action_at - created_at)
  const resolved = (incs ?? []).filter(
    i => i.corrective_action_at != null
  )
  let avgResolutionHours: number | null = null
  if (resolved.length > 0) {
    const totalMs = resolved.reduce((acc, i) => {
      const created = new Date(i.created_at as string).getTime()
      const corrected = new Date(i.corrective_action_at as string).getTime()
      return acc + (corrected - created)
    }, 0)
    avgResolutionHours = Math.round((totalMs / resolved.length / 3_600_000) * 10) / 10
  }

  // --- 3. Snapshot de incidencias abiertas HOY (no del rango) ---
  let openQuery = supabase
    .from('appcc_incidents')
    .select('id', { count: 'exact', head: true })
    .in('status', ['open', 'assigned', 'investigating', 'corrected'])
  if (locationIds && locationIds.length > 0) {
    openQuery = openQuery.in('location_id', locationIds)
  }
  const { count: openCount } = await openQuery

  return {
    openIncidents: openCount ?? 0,
    completionRate,
    avgResolutionHours,
    executionsCompleted,
    executionsTotal,
    incidentsCreatedInRange,
  }
}

// ============================================================
// TENDENCIA DIARIA DE CUMPLIMIENTO
// ============================================================

export async function getDailyCompliance(
  range: DateRange,
  locationIds: string[] | null,
): Promise<DailyComplianceData[]> {
  if (!supabase) return []

  let q = supabase
    .from('appcc_executions')
    .select('scheduled_date, status')
    .gte('scheduled_date', range.from)
    .lte('scheduled_date', range.to)
  if (locationIds && locationIds.length > 0) {
    q = q.in('location_id', locationIds)
  }
  const { data, error } = await q
  if (error) {
    console.error('[analyticsService] getDailyCompliance error', error)
    return []
  }

  // Agrupar por fecha
  const byDate = new Map<string, { total: number; completed: number }>()
  for (const r of data ?? []) {
    const d = r.scheduled_date as string
    const entry = byDate.get(d) ?? { total: 0, completed: 0 }
    entry.total++
    if (r.status === 'completed') entry.completed++
    byDate.set(d, entry)
  }

  // Rellenar días sin datos para que la línea sea continua
  const result: DailyComplianceData[] = []
  const fromDate = new Date(range.from + 'T00:00:00Z')
  const toDate = new Date(range.to + 'T00:00:00Z')
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    const e = byDate.get(iso)
    result.push({
      date: iso,
      total: e?.total ?? 0,
      completed: e?.completed ?? 0,
      rate: e && e.total > 0 ? Math.round((e.completed / e.total) * 100) : 0,
    })
  }

  return result
}

// ============================================================
// DISTRIBUCIÓN POR SEVERIDAD
// ============================================================

export async function getSeverityDistribution(
  range: DateRange,
  locationIds: string[] | null,
): Promise<SeverityDistribution[]> {
  if (!supabase) return []
  const { fromTs, toTs } = rangeBounds(range)

  let q = supabase
    .from('appcc_incidents')
    .select('severity')
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
  if (locationIds && locationIds.length > 0) {
    q = q.in('location_id', locationIds)
  }
  const { data, error } = await q
  if (error) {
    console.error('[analyticsService] getSeverityDistribution error', error)
    return []
  }

  const counts: Record<AppccSeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0,
  }
  for (const r of data ?? []) {
    const s = r.severity as AppccSeverity
    if (s in counts) counts[s]++
  }
  return (['critical', 'high', 'medium', 'low'] as AppccSeverity[])
    .map(severity => ({ severity, count: counts[severity] }))
}

// ============================================================
// DISTRIBUCIÓN POR CATEGORÍA
// ============================================================

export async function getCategoryDistribution(
  range: DateRange,
  locationIds: string[] | null,
): Promise<CategoryDistribution[]> {
  if (!supabase) return []
  const { fromTs, toTs } = rangeBounds(range)

  let q = supabase
    .from('appcc_incidents')
    .select('category')
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
  if (locationIds && locationIds.length > 0) {
    q = q.in('location_id', locationIds)
  }
  const { data, error } = await q
  if (error) {
    console.error('[analyticsService] getCategoryDistribution error', error)
    return []
  }

  const map = new Map<string, number>()
  for (const r of data ?? []) {
    const cat = (r.category as string | null)?.trim() || 'Sin categoría'
    map.set(cat, (map.get(cat) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10) // top 10
}

// ============================================================
// RANKING POR LOCAL
// ============================================================

export async function getLocationMetrics(
  range: DateRange,
  locations: { id: string; name: string }[],
): Promise<LocationMetrics[]> {
  if (!supabase || locations.length === 0) return []
  const { fromTs, toTs } = rangeBounds(range)

  // Una query por local sería N+1; mejor 3 queries amplias y agrupar en cliente.
  const locIds = locations.map(l => l.id)

  // 1. Ejecuciones por local
  const { data: execs } = await supabase
    .from('appcc_executions')
    .select('location_id, status')
    .in('location_id', locIds)
    .gte('scheduled_date', range.from)
    .lte('scheduled_date', range.to)

  const execStats = new Map<string, { total: number; completed: number }>()
  for (const r of execs ?? []) {
    const k = r.location_id as string
    const e = execStats.get(k) ?? { total: 0, completed: 0 }
    e.total++
    if (r.status === 'completed') e.completed++
    execStats.set(k, e)
  }

  // 2. Incidencias del rango por local
  const { data: incs } = await supabase
    .from('appcc_incidents')
    .select('location_id, severity')
    .in('location_id', locIds)
    .gte('created_at', fromTs)
    .lte('created_at', toTs)

  const incStats = new Map<string, { total: number; critical: number }>()
  for (const r of incs ?? []) {
    const k = r.location_id as string
    const e = incStats.get(k) ?? { total: 0, critical: 0 }
    e.total++
    if (r.severity === 'critical' || r.severity === 'high') e.critical++
    incStats.set(k, e)
  }

  // 3. Incidencias abiertas AHORA por local
  const { data: openIncs } = await supabase
    .from('appcc_incidents')
    .select('location_id')
    .in('location_id', locIds)
    .in('status', ['open', 'assigned', 'investigating', 'corrected'])

  const openStats = new Map<string, number>()
  for (const r of openIncs ?? []) {
    const k = r.location_id as string
    openStats.set(k, (openStats.get(k) ?? 0) + 1)
  }

  // Construir resultado
  return locations.map(loc => {
    const ex = execStats.get(loc.id) ?? { total: 0, completed: 0 }
    const inc = incStats.get(loc.id) ?? { total: 0, critical: 0 }
    return {
      locationId: loc.id,
      locationName: loc.name,
      completionRate: ex.total > 0
        ? Math.round((ex.completed / ex.total) * 100)
        : 0,
      openIncidents: openStats.get(loc.id) ?? 0,
      incidentsInRange: inc.total,
      criticalInRange: inc.critical,
    }
  }).sort((a, b) => b.openIncidents - a.openIncidents)
}

// ============================================================
// TOP 5 PLANTILLAS CON MÁS FALLOS
// ============================================================

export async function getTopFailingTemplates(
  range: DateRange,
  locationIds: string[] | null,
  limit = 5,
): Promise<TopFailingTemplate[]> {
  if (!supabase) return []
  const { fromTs, toTs } = rangeBounds(range)

  // Incidencias del rango con su execution_id → join con templates
  let q = supabase
    .from('appcc_incidents')
    .select(`
      execution_id,
      appcc_executions:execution_id ( template_id, appcc_templates:template_id ( id, name, code ) )
    `)
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .not('execution_id', 'is', null)
  if (locationIds && locationIds.length > 0) {
    q = q.in('location_id', locationIds)
  }

  const { data, error } = await q
  if (error) {
    console.error('[analyticsService] getTopFailingTemplates error', error)
    return []
  }

  // Agrupar por template
  const counts = new Map<string, { name: string; code: string; count: number }>()
  for (const row of (data ?? []) as unknown as Array<{
    appcc_executions: { template_id: string; appcc_templates: { id: string; name: string; code: string } | null } | null
  }>) {
    const tpl = row.appcc_executions?.appcc_templates
    if (!tpl) continue
    const existing = counts.get(tpl.id) ?? { name: tpl.name, code: tpl.code, count: 0 }
    existing.count++
    counts.set(tpl.id, existing)
  }

  return Array.from(counts.entries())
    .map(([templateId, v]) => ({
      templateId,
      templateName: v.name,
      templateCode: v.code,
      failuresInRange: v.count,
    }))
    .sort((a, b) => b.failuresInRange - a.failuresInRange)
    .slice(0, limit)
}

// ============================================================
// HEATMAP DÍA/HORA
// ============================================================

export async function getIncidentsHeatmap(
  range: DateRange,
  locationIds: string[] | null,
): Promise<HeatmapCell[]> {
  if (!supabase) return []
  const { fromTs, toTs } = rangeBounds(range)

  let q = supabase
    .from('appcc_incidents')
    .select('created_at')
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
  if (locationIds && locationIds.length > 0) {
    q = q.in('location_id', locationIds)
  }
  const { data, error } = await q
  if (error) {
    console.error('[analyticsService] getIncidentsHeatmap error', error)
    return []
  }

  // Matriz 7x24 inicializada a 0
  const cells: HeatmapCell[] = []
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cells.push({ dayOfWeek: d, hour: h, count: 0 })
    }
  }
  // Indexable: idx = day * 24 + hour
  const idx = (day: number, hour: number) => day * 24 + hour

  for (const r of data ?? []) {
    const d = new Date(r.created_at as string)
    const day = d.getDay()    // 0=domingo
    const hour = d.getHours()
    cells[idx(day, hour)].count++
  }

  return cells
}

// ============================================================
// HELPER: derivar rango ISO desde un preset
// ============================================================

// ============================================================
// CUMPLIMIENTO POR EMPLEADO (rendicion de cuentas)
// Quien hizo su trabajo y quien no. El reparto ya es equitativo por turno/
// disponibilidad (resolveAssignment), asi que esta comparacion es JUSTA:
// solo cuenta lo que a cada uno se le asigno. Diferenciador vs Jolt/Zenput,
// que no reparten por disponibilidad.
// ============================================================

export interface EmployeeCompliance {
  employeeId: string
  employeeName: string
  assigned: number        // tareas asignadas en el rango
  done: number            // completadas (a tiempo o tarde)
  late: number            // completadas pero en fecha posterior a la prevista
  overdueMissed: number   // vencidas sin hacer (paso el dia y no se completo)
  pendingOnTime: number   // pendientes aun a tiempo (hoy/futuro), no penalizan
  completionRate: number  // done / assigned (0-100)
}

export async function getEmployeeCompliance(
  range: DateRange,
  locationIds: string[] | null,
): Promise<EmployeeCompliance[]> {
  if (!supabase) return []
  const today = new Date().toISOString().slice(0, 10)

  let q = supabase
    .from('appcc_executions')
    .select('assigned_to, status, scheduled_date, completed_at')
    .gte('scheduled_date', range.from)
    .lte('scheduled_date', range.to)
    .not('assigned_to', 'is', null)
  if (locationIds && locationIds.length > 0) {
    q = q.in('location_id', locationIds)
  }
  const { data: execs, error } = await q
  if (error) {
    console.error('[analyticsService] getEmployeeCompliance error', error)
    return []
  }

  type Agg = {
    assigned: number; done: number; late: number
    overdueMissed: number; pendingOnTime: number
  }
  const stats = new Map<string, Agg>()
  for (const r of execs ?? []) {
    const id = r.assigned_to as string
    const a = stats.get(id) ?? { assigned: 0, done: 0, late: 0, overdueMissed: 0, pendingOnTime: 0 }
    a.assigned++
    const done = r.status === 'completed' || r.completed_at != null
    if (done) {
      a.done++
      const compDate = typeof r.completed_at === 'string' ? r.completed_at.slice(0, 10) : null
      if (compDate && r.scheduled_date && compDate > (r.scheduled_date as string)) a.late++
    } else if ((r.scheduled_date as string) < today) {
      a.overdueMissed++
    } else {
      a.pendingOnTime++
    }
    stats.set(id, a)
  }

  const ids = [...stats.keys()]
  if (ids.length === 0) return []

  const { data: emps } = await supabase
    .from('employees')
    .select('id, name')
    .in('id', ids)
  const nameById = new Map<string, string>()
  for (const e of emps ?? []) nameById.set(e.id as string, (e.name as string) ?? '-')

  return ids.map(id => {
    const a = stats.get(id)!
    return {
      employeeId: id,
      employeeName: (nameById.get(id) ?? '-').trim(),
      assigned: a.assigned,
      done: a.done,
      late: a.late,
      overdueMissed: a.overdueMissed,
      pendingOnTime: a.pendingOnTime,
      completionRate: a.assigned > 0 ? Math.round((a.done / a.assigned) * 100) : 0,
    }
  }).sort((x, y) => x.completionRate - y.completionRate || y.overdueMissed - x.overdueMissed)
}

export type RangePreset = 'week' | 'month' | 'quarter'

export function rangeFromPreset(preset: RangePreset): DateRange {
  const today = new Date()
  const to = today.toISOString().slice(0, 10)

  const from = new Date(today)
  if (preset === 'week') from.setDate(from.getDate() - 6)
  else if (preset === 'month') from.setDate(from.getDate() - 29)
  else from.setDate(from.getDate() - 89) // quarter ~ 90 días

  return { from: from.toISOString().slice(0, 10), to }
}
