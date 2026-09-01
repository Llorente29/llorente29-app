// src/modules/kitchen/pages/AvailabilityReportsPage.tsx
//
// DISPONIBILIDAD · C3b — pantalla "Disponibilidad · Informes" (pata C,
// "vendible"). Oficina, rol manager, solo lectura. Consume availability_report
// (C3a) de un tirón (patrón sales_dashboard). Filtros disparan un nuevo
// fetch; sin filtros = cuenta entera, últimos 30 días vs 30 anteriores.
//
// p_channel_id NO se expone como filtro: availability_event no lleva canal
// todavía (ver availabilityReportService.ts) — un selector que no filtra
// nada sería mentir a Julio, así que se omite hasta que exista el escritor.
//
// Pérdidas SIEMPRE marcadas como estimación (nunca facturación real) — nota
// fija bajo el KPI y en el pie de la tabla de cierres.

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Store, Download, Loader2, Info,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import * as XLSX from 'xlsx'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listLocations, type LocationOption } from '@/modules/kitchen/services/availabilityService'
import { listAccountBrands, type AccountBrandLite } from '@/modules/kitchen/services/menuItemService'
import {
  getAvailabilityReport,
  type AvailabilityReport, type AvailabilityOrigin, type AvailabilityScope, type LogRow,
} from '@/modules/kitchen/services/availabilityReportService'
import { REASON_OPTIONS } from '@/modules/kds/lib/reasonCode'
import AvailabilityHeatmap from '@/modules/kitchen/components/AvailabilityHeatmap'
import KpiCard from '@/components/KpiCard'

// ─── paleta de origen (validada con dataviz/scripts/validate_palette.js —
// adjacent + wraparound, ALL CHECKS PASS en modo claro) ─────────────────────
const ORIGIN_COLORS: Record<AvailabilityOrigin, string> = {
  cocina: '#2a78d6',
  oficina: '#eb6834',
  plataforma: '#1baf7a',
  auto: '#eda100',
  sistema: '#e87ba4',
}
const ORIGIN_LABELS: Record<AvailabilityOrigin, string> = {
  cocina: 'Cocina', oficina: 'Oficina', plataforma: 'Plataforma', auto: 'Automático', sistema: 'Sistema',
}
const REASON_LABELS: Record<string, string> = Object.fromEntries(
  REASON_OPTIONS.filter((o) => o.value !== '').map((o) => [o.value, o.label]),
)
function reasonLabel(code: string | null): string {
  return code ? (REASON_LABELS[code] ?? code) : 'Sin clasificar'
}
function scopeLabel(scope: AvailabilityScope): string {
  return scope === 'location' ? 'Local' : scope === 'brand' ? 'Marca' : 'Producto'
}

// ─── formateo ────────────────────────────────────────────────────────────
function fmtEur(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}
function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`
}
function fmtHours(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(1)} h`
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// ─── rango de fechas ─────────────────────────────────────────────────────
type RangeKey = '7d' | '30d' | 'thisMonth' | 'custom'

function computeRange(key: RangeKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  if (key === 'custom' && customFrom && customTo) {
    const from = new Date(customFrom + 'T00:00:00')
    const to = new Date(customTo + 'T23:59:59')
    return { from: from.toISOString(), to: to.toISOString() }
  }
  if (key === 'thisMonth') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  const days = key === '7d' ? 7 : 30
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: now.toISOString() }
}

export default function AvailabilityReportsPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [locations, setLocations] = useState<LocationOption[]>([])
  const [brands, setBrands] = useState<AccountBrandLite[]>([])
  const [locationId, setLocationId] = useState<string>('')
  const [brandId, setBrandId] = useState<string>('')
  const [origin, setOrigin] = useState<AvailabilityOrigin | ''>('')
  const [scope, setScope] = useState<AvailabilityScope | ''>('')
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [report, setReport] = useState<AvailabilityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { from, to } = useMemo(() => computeRange(rangeKey, customFrom, customTo), [rangeKey, customFrom, customTo])

  useEffect(() => {
    if (!activeAccountId) return
    listLocations(activeAccountId).then(setLocations).catch(() => setLocations([]))
    listAccountBrands(activeAccountId).then(setBrands).catch(() => setBrands([]))
  }, [activeAccountId])

  useEffect(() => {
    if (!activeAccountId) return
    if (rangeKey === 'custom' && (!customFrom || !customTo)) return
    let alive = true
    setLoading(true); setError(null)
    getAvailabilityReport({
      accountId: activeAccountId, from, to,
      locationId: locationId || null,
      brandId: brandId || null,
      origin: origin || null,
      scope: scope || null,
    })
      .then((r) => { if (alive) setReport(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Error cargando el informe') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId, from, to, locationId, brandId, origin, scope, rangeKey, customFrom, customTo])

  const kpis = report?.kpis ?? null

  function exportLog() {
    if (!report || report.log.length === 0) return
    const rows = report.log.map((r: LogRow) => ({
      Qué: `${scopeLabel(r.scope)} · ${r.target_label ?? '—'}`,
      Origen: ORIGIN_LABELS[r.origin] ?? r.origin,
      Motivo: reasonLabel(r.reason_code),
      Inicio: fmtDateTime(r.started_at),
      'Duración (min)': Math.round(r.duration_min),
      'Pérdida estimada (€)': Math.round(r.lost_revenue_est * 100) / 100,
      Quién: r.actor ?? (r.origin === 'cocina' ? 'Tablet' : r.origin === 'sistema' ? 'Sistema' : '—'),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cierres')
    XLSX.writeFile(wb, `disponibilidad_cierres_${from.slice(0, 10)}_${to.slice(0, 10)}.xlsx`)
  }

  if (accountsLoading) return <div className="p-8 text-text-secondary">Cargando…</div>

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-medium text-text-primary flex items-center gap-2">
          <BarChart3 size={20} className="text-accent" /> Disponibilidad · Informes
        </h1>
        <p className="text-[13px] text-text-secondary mt-0.5">Uptime, pérdidas estimadas y motivos de cierre</p>
      </div>

      {/* ── Barra de filtros ──────────────────────────────────────────── */}
      <div className="flex gap-2.5 mb-5 flex-wrap items-center">
        <div className="inline-flex rounded-lg border border-border-default overflow-hidden text-sm">
          {([['7d', '7 días'], ['30d', '30 días'], ['thisMonth', 'Este mes'], ['custom', 'Rango']] as [RangeKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRangeKey(k)}
              className={`px-3 py-2 font-medium ${rangeKey === k ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:text-text-primary'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {rangeKey === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-border-default rounded-lg px-2.5 py-2 text-sm bg-card" />
            <span className="text-text-secondary text-sm">a</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="border border-border-default rounded-lg px-2.5 py-2 text-sm bg-card" />
          </>
        )}
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
          className="border border-border-default rounded-lg px-3 py-2 text-sm bg-card">
          <option value="">Todos los locales</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)}
          className="border border-border-default rounded-lg px-3 py-2 text-sm bg-card">
          <option value="">Todas las marcas</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value as AvailabilityOrigin | '')}
          className="border border-border-default rounded-lg px-3 py-2 text-sm bg-card">
          <option value="">Todo origen</option>
          {(Object.keys(ORIGIN_LABELS) as AvailabilityOrigin[]).map((o) => <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>)}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as AvailabilityScope | '')}
          className="border border-border-default rounded-lg px-3 py-2 text-sm bg-card">
          <option value="">Local + marca + producto</option>
          <option value="location">Solo local</option>
          <option value="brand">Solo marca</option>
          <option value="product">Solo producto</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-bg p-3 text-[13px] text-danger">{error}</div>
      )}

      {loading && !report ? (
        <div className="py-16 text-center text-text-secondary"><Loader2 size={22} className="animate-spin inline" /></div>
      ) : report && (
        <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
          {/* ── KPI cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KpiCard label="Uptime del local" value={kpis!.uptime_pct} prevValue={kpis!.prev.uptime_pct} betterWhen="up" format={fmtPct}
              note={brandId || scope === 'brand' || scope === 'product'
                ? 'No varía con el filtro de marca/producto — es del local'
                : 'Solo Cap. C (cerrar local) — no incluye marca/producto'} />
            <KpiCard label="Downtime" value={kpis!.downtime_hours} prevValue={kpis!.prev.downtime_hours} betterWhen="down" format={fmtHours} />
            <KpiCard label="Pérdidas estimadas" value={kpis!.lost_revenue_est} prevValue={kpis!.prev.lost_revenue_est} betterWhen="down" format={fmtEur}
              note="Estimación sobre histórico de ventas, no facturación real perdida" />
            <KpiCard label="Cierres" value={kpis!.closures_count} prevValue={kpis!.prev.closures_count} betterWhen="down"
              format={(v) => (v === null ? '—' : String(Math.round(v)))}
              note={kpis!.avoidable_pct !== null ? `${fmtPct(kpis!.avoidable_pct)} evitables` : undefined} />
          </div>

          {/* ── Heat map ─────────────────────────────────────────────── */}
          <div className="bg-card border border-border-default rounded-xl p-4 mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-3">Cuándo se cierra (día × hora)</h2>
            <AvailabilityHeatmap cells={report.heatmap} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* ── Tendencia ──────────────────────────────────────────── */}
            <div className="bg-card border border-border-default rounded-xl p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Tendencia de pérdidas estimadas</h2>
              {report.trend.length === 0 ? (
                <p className="text-sm text-text-secondary py-8 text-center">Sin datos en el periodo.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={report.trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9EBED" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="#898781"
                      tickFormatter={(d) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} />
                    <YAxis tick={{ fontSize: 10 }} stroke="#898781" tickFormatter={(v) => fmtEur(v)} width={60} />
                    <Tooltip
                      formatter={(v) => [fmtEur(Number(v)), 'Pérdida estimada']}
                      labelFormatter={(d) => new Date(d as string).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                    />
                    <Area type="monotone" dataKey="lost_revenue_est" stroke="#E0492E" fill="#E0492E" fillOpacity={0.18} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ── Ranking ────────────────────────────────────────────── */}
            <div className="bg-card border border-border-default rounded-xl p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Top pérdidas por marca/producto/local</h2>
              {report.ranking.length === 0 ? (
                <p className="text-sm text-text-secondary py-8 text-center">Sin cierres en el periodo.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, report.ranking.length * 28)}>
                  <BarChart data={report.ranking} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9EBED" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} stroke="#898781" tickFormatter={(v) => fmtEur(v)} />
                    <YAxis type="category" dataKey="target_label" tick={{ fontSize: 11 }} stroke="#898781" width={140}
                      tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
                    <Tooltip formatter={(v) => [fmtEur(Number(v)), 'Pérdida estimada']} />
                    <Bar dataKey="lost_revenue_est" fill="#E0492E" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* ── Por origen (donut) ─────────────────────────────────── */}
            <div className="bg-card border border-border-default rounded-xl p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Downtime por origen</h2>
              {report.by_origin.length === 0 ? (
                <p className="text-sm text-text-secondary py-8 text-center">Sin cierres en el periodo.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={report.by_origin} dataKey="downtime_min" nameKey="origin"
                      innerRadius={50} outerRadius={80} paddingAngle={2}
                    >
                      {report.by_origin.map((d) => (
                        <Cell key={d.origin} fill={ORIGIN_COLORS[d.origin] ?? '#898781'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, _n, p: any) => [fmtDuration(Number(v)), ORIGIN_LABELS[p?.payload?.origin as AvailabilityOrigin] ?? p?.payload?.origin]} />
                    <Legend
                      formatter={(_v, entry: any) => (
                        <span className="text-xs text-text-secondary">
                          {ORIGIN_LABELS[entry?.payload?.origin as AvailabilityOrigin] ?? entry?.payload?.origin} · {entry?.payload?.closures}
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ── Por motivo ─────────────────────────────────────────── */}
            <div className="bg-card border border-border-default rounded-xl p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Downtime por motivo</h2>
              {report.by_reason.length === 0 ? (
                <p className="text-sm text-text-secondary py-8 text-center">Sin cierres en el periodo.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, report.by_reason.length * 32)}>
                  <BarChart
                    data={report.by_reason.map((r) => ({ ...r, label: reasonLabel(r.reason_code) }))}
                    layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E9EBED" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} stroke="#898781" tickFormatter={(v) => fmtDuration(v)} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} stroke="#898781" width={110} />
                    <Tooltip formatter={(v) => [fmtDuration(Number(v)), 'Downtime']} />
                    <Bar dataKey="downtime_min" fill="#15171A" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── Registro de cierres ────────────────────────────────────── */}
          <div className="bg-card border border-border-default rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Store size={15} className="text-text-tertiary" /> Registro de cierres · {report.log.length}
              </h2>
              <button
                onClick={exportLog}
                disabled={report.log.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                <Download size={14} /> Exportar Excel
              </button>
            </div>
            {report.log.length >= 500 && (
              <p className="mb-2 text-[11px] text-warning flex items-center gap-1">
                <Info size={12} /> Mostrando los 500 cierres más recientes del periodo — acota el rango de fechas para un histórico más largo.
              </p>
            )}
            {report.log.length === 0 ? (
              <p className="text-sm text-text-secondary py-8 text-center">Sin cierres en el periodo.</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
                      <th className="py-2 pr-3 font-medium">Qué</th>
                      <th className="py-2 pr-3 font-medium">Origen</th>
                      <th className="py-2 pr-3 font-medium">Motivo</th>
                      <th className="py-2 pr-3 font-medium">Inicio</th>
                      <th className="py-2 pr-3 font-medium text-right">Duración</th>
                      <th className="py-2 pr-3 font-medium text-right">Pérdida est.</th>
                      <th className="py-2 font-medium">Quién</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.log.map((r, i) => (
                      <tr key={i} className="border-b border-border-default last:border-0">
                        <td className="py-2 pr-3">
                          <span className="text-[10px] uppercase text-text-tertiary mr-1.5">{scopeLabel(r.scope)}</span>
                          {r.target_label ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-text-secondary">{ORIGIN_LABELS[r.origin] ?? r.origin}</td>
                        <td className="py-2 pr-3 text-text-secondary">{reasonLabel(r.reason_code)}</td>
                        <td className="py-2 pr-3 text-text-secondary">{fmtDateTime(r.started_at)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-text-secondary">{fmtDuration(r.duration_min)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-danger">{fmtEur(r.lost_revenue_est)}</td>
                        <td className="py-2 text-text-secondary">{r.actor ?? (r.origin === 'cocina' ? 'Tablet' : r.origin === 'sistema' ? 'Sistema' : '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] text-text-tertiary">
              Las pérdidas son una estimación sobre el histórico de ventas de la franja (venta media por día de la semana y hora), no facturación real perdida.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
