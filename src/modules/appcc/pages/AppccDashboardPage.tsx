// src/modules/appcc/pages/AppccDashboardPage.tsx
// Dashboard de analytics APPCC.
//
// Estructura visual:
//   1. Filtros: rango (semana/mes/trimestre) + local
//   2. 4 KPI cards grandes
//   3. Tendencia diaria de cumplimiento (LineChart)
//   4. Donut por severidad + Bar por categoría (2 columnas)
//   5. Ranking por local (tabla con barras)
//   6. Top 5 plantillas con más fallos
//   7. Heatmap día/hora de incidencias
//
// Toda la lógica de datos vive en analyticsService.ts.

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, AlertTriangle, Clock, ClipboardCheck,
  TrendingUp, MapPin, FileWarning, CalendarClock, UserCheck,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'
import { useApp } from '@/context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import * as analyticsService from '@/modules/appcc/services/analyticsService'
import type {
  DateRange,
  KpiSummary,
  DailyComplianceData,
  SeverityDistribution,
  CategoryDistribution,
  LocationMetrics,
  TopFailingTemplate,
  HeatmapCell,
  EmployeeCompliance,
  RangePreset,
} from '@/modules/appcc/services/analyticsService'
import { SEVERITY_LABEL } from '@/modules/appcc/types'

// Paleta para gráficos (consistente con tokens semánticos)
const SEV_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#F59E0B',
  medium: '#FBBF24',
  low: '#15171A',
}
const CATEGORY_COLOR = '#15171A'
const TREND_COLOR = '#15171A'

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export default function AppccDashboardPage() {
  const { locations } = useApp()
  const activeLocations = useMemo(
    () => locations.filter(l => l.active),
    [locations]
  )

  // ---------- Filtros ----------
  const { resolvedLocationId } = useLocationScope()
  const [preset, setPreset] = useState<RangePreset>('month')
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all')

  // El selector global de local manda: 'all' (consolidado) o el local activo.
  useEffect(() => {
    setSelectedLocationId(resolvedLocationId ?? 'all')
  }, [resolvedLocationId])
  const range: DateRange = useMemo(
    () => analyticsService.rangeFromPreset(preset),
    [preset]
  )
  const filterLocationIds = selectedLocationId === 'all'
    ? null
    : [selectedLocationId]

  // ---------- Estado de datos ----------
  const [kpi, setKpi] = useState<KpiSummary | null>(null)
  const [daily, setDaily] = useState<DailyComplianceData[]>([])
  const [severity, setSeverity] = useState<SeverityDistribution[]>([])
  const [category, setCategory] = useState<CategoryDistribution[]>([])
  const [byLocation, setByLocation] = useState<LocationMetrics[]>([])
  const [topFailing, setTopFailing] = useState<TopFailingTemplate[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [empCompliance, setEmpCompliance] = useState<EmployeeCompliance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---------- Carga ----------
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (activeLocations.length === 0) return
      setLoading(true)
      setError(null)
      try {
        const [k, d, s, c, byL, topF, hm, ec] = await Promise.all([
          analyticsService.getKpiSummary(range, filterLocationIds),
          analyticsService.getDailyCompliance(range, filterLocationIds),
          analyticsService.getSeverityDistribution(range, filterLocationIds),
          analyticsService.getCategoryDistribution(range, filterLocationIds),
          analyticsService.getLocationMetrics(
            range,
            activeLocations.map(l => ({ id: l.id, name: l.name }))
          ),
          analyticsService.getTopFailingTemplates(range, filterLocationIds, 5),
          analyticsService.getIncidentsHeatmap(range, filterLocationIds),
          analyticsService.getEmployeeCompliance(range, filterLocationIds),
        ])
        if (cancelled) return
        setKpi(k); setDaily(d); setSeverity(s); setCategory(c)
        setByLocation(byL); setTopFailing(topF); setHeatmap(hm)
        setEmpCompliance(ec)
      } catch (err) {
        if (cancelled) return
        console.error('[AppccDashboardPage] load error', err)
        setError(err instanceof Error ? err.message : 'Error cargando datos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, selectedLocationId, activeLocations.length])

  // ---------- Render ----------
  return (
    <div className="space-y-5">
      {/* ============ HEADER ============ */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-display text-text-primary flex items-center gap-2">
          <BarChart3 size={26} className="text-accent" />
          Dashboard APPCC
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Métricas en tiempo real de cumplimiento e incidencias
        </p>
      </div>

      {/* ============ FILTROS ============ */}
      <div className="bg-card rounded-lg border border-border-default p-3 sm:p-4 grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5">
            Rango
          </label>
          <div className="flex gap-1 flex-wrap">
            {(['week', 'month', 'quarter'] as const).map(p => (
              <FilterBtn
                key={p}
                active={preset === p}
                onClick={() => setPreset(p)}
                label={p === 'week' ? 'Última semana' : p === 'month' ? 'Último mes' : 'Último trimestre'}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5">
            Local
          </label>
          <select
            value={selectedLocationId}
            onChange={e => setSelectedLocationId(e.target.value)}
            className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
          >
            <option value="all">Todos los locales</option>
            {activeLocations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg text-danger rounded-md p-3 text-sm">{error}</div>
      )}

      {/* ============ KPIs ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiBox
          Icon={AlertTriangle}
          label="Incidencias abiertas"
          value={kpi?.openIncidents ?? '…'}
          tone={kpi && kpi.openIncidents > 0 ? 'danger' : 'neutral'}
          loading={loading}
        />
        <KpiBox
          Icon={ClipboardCheck}
          label="Cumplimiento"
          value={kpi ? `${kpi.completionRate}%` : '…'}
          subtitle={kpi ? `${kpi.executionsCompleted}/${kpi.executionsTotal} controles` : ''}
          tone={kpi && kpi.completionRate >= 90 ? 'success' : kpi && kpi.completionRate >= 70 ? 'warning' : 'danger'}
          loading={loading}
        />
        <KpiBox
          Icon={Clock}
          label="Tiempo medio resolución"
          value={kpi?.avgResolutionHours != null ? `${kpi.avgResolutionHours}h` : '—'}
          subtitle="desde detección"
          tone="neutral"
          loading={loading}
        />
        <KpiBox
          Icon={TrendingUp}
          label="Incidencias del periodo"
          value={kpi?.incidentsCreatedInRange ?? '…'}
          tone="neutral"
          loading={loading}
        />
      </div>

      {/* ============ TENDENCIA DIARIA ============ */}
      <Panel title="Cumplimiento diario" Icon={TrendingUp}>
        {daily.length === 0 ? (
          <EmptyState message="Sin datos de ejecuciones en este rango" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5)} // MM-DD
                tick={{ fontSize: 11 }}
                stroke="#6B7280"
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 11 }}
                stroke="#6B7280"
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                formatter={(v) => [`${v}%`, 'Cumplimiento']}
                labelFormatter={(l) => `Día ${String(l ?? '')}`}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={TREND_COLOR}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* ============ SEVERIDAD + CATEGORÍA ============ */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Panel title="Incidencias por severidad" Icon={AlertTriangle}>
          {severity.every(s => s.count === 0) ? (
            <EmptyState message="Sin incidencias en este rango" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={severity.filter(s => s.count > 0)}
                  dataKey="count"
                  nameKey="severity"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  label={(props: { payload?: SeverityDistribution }) => {
                    const p = props.payload
                    if (!p) return ''
                    return `${SEVERITY_LABEL[p.severity]} (${p.count})`
                  }}
                  labelLine={false}
                  style={{ fontSize: 11 }}
                >
                  {severity.filter(s => s.count > 0).map(entry => (
                    <Cell key={entry.severity} fill={SEV_COLORS[entry.severity]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v, _name, props: { payload?: { severity?: string } }) => {
                    const sev = props.payload?.severity as keyof typeof SEVERITY_LABEL | undefined
                    return [v, sev ? SEVERITY_LABEL[sev] : '']
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Incidencias por categoría" Icon={FileWarning}>
          {category.length === 0 ? (
            <EmptyState message="Sin incidencias categorizadas" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={category} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#6B7280" />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={110}
                  tick={{ fontSize: 11 }}
                  stroke="#6B7280"
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v) => [v, 'Incidencias']}
                />
                <Bar dataKey="count" fill={CATEGORY_COLOR} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* ============ RANKING POR LOCAL ============ */}
      {activeLocations.length > 1 && (
        <Panel title="Ranking por local" Icon={MapPin}>
          <LocationRanking metrics={byLocation} />
        </Panel>
      )}

      {/* ============ CUMPLIMIENTO POR EMPLEADO ============ */}
      <Panel title="Cumplimiento por empleado" Icon={UserCheck}>
        <p className="text-xs text-text-secondary mb-3 -mt-1">
          Reparto equilibrado por turno y disponibilidad: la comparacion es justa.
        </p>
        <EmployeeComplianceTable rows={empCompliance} />
      </Panel>

      {/* ============ TOP 5 FALLOS ============ */}
      <Panel title="Top plantillas con más fallos" Icon={FileWarning}>
        {topFailing.length === 0 ? (
          <EmptyState message="Sin fallos asociados a plantillas" />
        ) : (
          <div className="space-y-2">
            {topFailing.map((t, i) => (
              <div
                key={t.templateId}
                className="flex items-center gap-3 p-3 bg-page rounded-md border border-border-default"
              >
                <span className="shrink-0 w-7 h-7 rounded-full bg-accent text-text-on-accent flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {t.templateName}
                  </div>
                  <div className="text-xs text-text-secondary">{t.templateCode}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-danger tabular-nums">
                    {t.failuresInRange}
                  </div>
                  <div className="text-xs text-text-secondary">incidencias</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ============ HEATMAP ============ */}
      <Panel title="Cuándo se detectan las incidencias" Icon={CalendarClock}>
        <Heatmap cells={heatmap} />
      </Panel>
    </div>
  )
}

// ============================================================
// SUB-COMPONENTES
// ============================================================

function FilterBtn({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-base ${
        active
          ? 'bg-accent text-text-on-accent'
          : 'bg-card border border-border-default text-text-secondary hover:bg-page'
      }`}
    >
      {label}
    </button>
  )
}

function KpiBox({
  Icon, label, value, subtitle, tone, loading,
}: {
  Icon: typeof BarChart3
  label: string
  value: string | number
  subtitle?: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  loading?: boolean
}) {
  const colors = {
    neutral: 'bg-accent-bg text-accent',
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
  }[tone]
  return (
    <div className={`p-4 rounded-lg border border-border-default ${colors}`}>
      <Icon size={16} className="mb-1.5 opacity-70" />
      <div className="text-2xl sm:text-3xl font-bold tabular-nums">
        {loading ? '…' : value}
      </div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
      {subtitle && (
        <div className="text-xs opacity-60 mt-0.5">{subtitle}</div>
      )}
    </div>
  )
}

function Panel({
  title, Icon, children,
}: { title: string; Icon: typeof BarChart3; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-lg border border-border-default p-3 sm:p-4">
      <h2 className="text-base font-semibold text-text-primary mb-3 flex items-center gap-2">
        <Icon size={16} className="text-accent" />
        {title}
      </h2>
      {children}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center text-text-secondary text-sm py-8 italic">
      {message}
    </div>
  )
}

function EmployeeComplianceTable({ rows }: { rows: EmployeeCompliance[] }) {
  if (rows.length === 0) {
    return <EmptyState message="Sin tareas asignadas en el periodo" />
  }
  const best = [...rows].sort((a, b) => b.completionRate - a.completionRate)[0]
  return (
    <div className="overflow-x-auto -mx-3 sm:-mx-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-text-secondary border-b border-border-default">
            <th className="px-3 sm:px-4 py-2 font-medium">Empleado</th>
            <th className="px-3 py-2 font-medium text-right">Asign.</th>
            <th className="px-3 py-2 font-medium text-right">Hechas</th>
            <th className="px-3 py-2 font-medium text-right hidden sm:table-cell">Tarde</th>
            <th className="px-3 py-2 font-medium text-right">Sin hacer</th>
            <th className="px-3 py-2 font-medium text-right">Cumpl.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const color = r.completionRate >= 90 ? 'text-success'
              : r.completionRate >= 70 ? 'text-warning'
              : 'text-danger'
            const isBest = r.employeeId === best.employeeId && r.completionRate >= 90 && rows.length > 1
            return (
              <tr key={r.employeeId} className="border-b border-border-default last:border-0">
                <td className="px-3 sm:px-4 py-2.5 font-medium text-text-primary">
                  {r.employeeName}
                  {isBest && <span className="ml-2 text-xs text-success">★ mejor</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{r.assigned}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-primary">{r.done}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-warning hidden sm:table-cell">
                  {r.late > 0 ? r.late : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-danger">
                  {r.overdueMissed > 0 ? r.overdueMissed : '—'}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${color}`}>
                  {r.completionRate}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LocationRanking({ metrics }: { metrics: LocationMetrics[] }) {
  if (metrics.length === 0) {
    return <EmptyState message="Sin locales con datos" />
  }
  const maxOpen = Math.max(...metrics.map(m => m.openIncidents), 1)

  return (
    <div className="overflow-x-auto -mx-3 sm:-mx-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-text-secondary border-b border-border-default">
            <th className="px-3 sm:px-4 py-2 font-medium">Local</th>
            <th className="px-3 py-2 font-medium text-right">Cumpl.</th>
            <th className="px-3 py-2 font-medium text-right">Abiertas</th>
            <th className="px-3 py-2 font-medium text-right hidden sm:table-cell">Periodo</th>
            <th className="px-3 py-2 font-medium text-right hidden md:table-cell">Crítica/Alta</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => {
            const pct = (m.openIncidents / maxOpen) * 100
            const cumplColor = m.completionRate >= 90 ? 'text-success'
              : m.completionRate >= 70 ? 'text-warning'
              : 'text-danger'
            return (
              <tr key={m.locationId} className="border-b border-border-default last:border-0">
                <td className="px-3 sm:px-4 py-2.5 font-medium text-text-primary">
                  {m.locationName}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${cumplColor}`}>
                  {m.completionRate}%
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden sm:block w-20 bg-page rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-danger"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`tabular-nums font-semibold ${m.openIncidents > 0 ? 'text-danger' : 'text-text-secondary'}`}>
                      {m.openIncidents}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary hidden sm:table-cell">
                  {m.incidentsInRange}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums hidden md:table-cell">
                  <span className={m.criticalInRange > 0 ? 'text-danger font-medium' : 'text-text-secondary'}>
                    {m.criticalInRange}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  if (cells.length === 0 || cells.every(c => c.count === 0)) {
    return <EmptyState message="Sin incidencias para mapear" />
  }
  const max = Math.max(...cells.map(c => c.count), 1)

  // Agrupamos por hora para el grid: 24 columnas x 7 filas
  const rows: HeatmapCell[][] = []
  for (let d = 0; d < 7; d++) {
    rows.push(cells.filter(c => c.dayOfWeek === d))
  }

  // Cada hora es una columna pero las etiquetas las mostramos cada 3h
  const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21]

  return (
    <div className="overflow-x-auto -mx-3 sm:-mx-4 px-3 sm:px-4">
      <div className="min-w-[600px]">
        {/* Header con horas */}
        <div className="flex">
          <div className="w-10 shrink-0" />
          <div
            className="flex-1 grid gap-px text-[10px] text-text-secondary"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="text-center">
                {HOUR_TICKS.includes(h) ? `${h}h` : ''}
              </div>
            ))}
          </div>
        </div>

        {/* Filas por día */}
        {rows.map((row, dayIdx) => (
          <div key={dayIdx} className="flex items-center mt-1">
            <div className="w-10 shrink-0 text-xs text-text-secondary">
              {DAY_NAMES[dayIdx]}
            </div>
            <div
              className="flex-1 grid gap-px"
              style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
            >
              {row.map(c => {
                const intensity = c.count / max
                return (
                  <div
                    key={`${c.dayOfWeek}-${c.hour}`}
                    title={`${DAY_NAMES[c.dayOfWeek]} ${c.hour}:00 — ${c.count} incidencia(s)`}
                    className="aspect-square rounded-sm"
                    style={{
                      backgroundColor: c.count === 0
                        ? '#F6F7F8'
                        : `rgba(220, 38, 38, ${0.15 + intensity * 0.85})`,
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* Leyenda */}
        <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
          <span>Menos</span>
          {[0.15, 0.3, 0.5, 0.7, 0.9].map(i => (
            <div
              key={i}
              className="w-4 h-4 rounded-sm"
              style={{ backgroundColor: `rgba(220, 38, 38, ${i})` }}
            />
          ))}
          <span>Más</span>
        </div>
      </div>
    </div>
  )
}
