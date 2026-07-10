// src/pages/InformesTeamPage.tsx
// Informes de Folvy Team — hub analítico (v1). Dashboard + biblioteca de informes.
// v1 usa solo dato ya disponible (fichajes, coste laboral estimado, ausencias,
// geodato). Rentabilidad / % personal sobre ventas·margen / SPLH / MPLH llegan
// en v2 tras el RECON de ventas. El convenio (horas vs límite, extras,
// nocturnidad) llega en v1.5 con su config.

import { useState, useMemo, useEffect } from 'react'
import { Clock, Euro, Users, CalendarX, MapPin, Download, FileSpreadsheet, BarChart3, TrendingUp, AlertTriangle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { Card, Badge } from '../components/ui'
import type { Employee, ClockEntry } from '../types'
import { fetchPayrollCosts } from '../services/payrollService'
import {
  fetchSalesByLocation, fetchWorkedHoursByLocation, fetchSalesByHour, fetchWorkedShifts,
  type SalesByLocation, type HoursByLocation, type SalesByHour, type WorkedShift,
} from '../services/teamReportsService'

// Cuota patronal de Seguridad Social sobre el bruto (aprox. sector). Configurable
// por cuenta más adelante; hoy constante y etiquetada como estimación.
const SS_FACTOR = 1.30
// Horas EFECTIVAS de trabajo al año (jornada de convenio, ya descontadas
// vacaciones y festivos). Hostelería ≈ 1770 h. Se pagará el año entero pero se
// trabajan ~1770 h → el coste de una hora trabajada se reparte sobre estas.
// Será exacto por convenio con el config de convenio (v1.5).
const ANNUAL_EFFECTIVE_HOURS = 1770

// ── Helpers de cálculo ─────────────────────────────────────────────────────
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}
function hoursOf(entries: ClockEntry[], from: string, to: string): number {
  const asc = entries.filter(e => !e.voided && e.datetime >= from && e.datetime <= to + 'T23:59:59')
    .sort((a, b) => a.datetime.localeCompare(b.datetime))
  let total = 0, last: ClockEntry | null = null
  for (const e of asc) {
    if (e.type === 'entrada') last = e
    else if (e.type === 'salida' && last) { total += (new Date(e.datetime).getTime() - new Date(last.datetime).getTime()) / 3600000; last = null }
  }
  return total
}
// Coste empresa ANUAL: bruto + SS. Usa la SS real de la ficha/nómina si está;
// si falta, la estima al 30% del bruto (etiquetado como estimación).
function annualEmployerCost(emp: Employee): number {
  const gross = emp.salary || 0
  if (!(gross > 0)) return 0
  const ss = emp.employerSsAnnual != null ? emp.employerSsAnnual : gross * (SS_FACTOR - 1)
  return gross + ss
}
// Coste de una hora TRABAJADA: coste empresa anual repartido sobre las horas
// efectivas de convenio (no sobre 52×semana, que lo infravaloraría).
function hourlyCost(emp: Employee): number {
  const c = annualEmployerCost(emp)
  return c > 0 ? c / ANNUAL_EFFECTIVE_HOURS : 0
}
// Coste DEVENGADO en el periodo: coste empresa anual prorrateado por los días
// que el empleado está de alta dentro del periodo. NO depende de que los
// fichajes estén completos → número robusto para "cuánto me cuesta".
function accruedCost(emp: Employee, from: string, to: string): number {
  const annual = annualEmployerCost(emp)
  if (annual <= 0) return 0
  const start = emp.startDate && emp.startDate > from ? emp.startDate : from
  const end = emp.endDate && emp.endDate < to ? emp.endDate : to
  if (!start || !end || start > end) return 0
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  return annual * (days / 365)
}
function overlapDays(startDate: string, endDate: string, from: string, to: string): number {
  const s = startDate > from ? startDate : from
  const e = endDate < to ? endDate : to
  if (!s || !e || s > e) return 0
  return Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1
}
const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
const h1 = (n: number) => n.toFixed(1)

// ── Export ─────────────────────────────────────────────────────────────────
type Cell = string | number
interface ReportData { headers: string[]; rows: Cell[][] }

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
function downloadCSV(filename: string, { headers, rows }: ReportData) {
  const esc = (v: Cell) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))]
  triggerDownload(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }), filename + '.csv')
}
async function downloadXLSX(filename: string, { headers, rows }: ReportData) {
  // SheetJS ya se usa en el dashboard de Shop; import dinámico para no acoplar tipos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Informe')
  XLSX.writeFile(wb, filename + '.xlsx')
}

type ReportKey = 'jornada' | 'coste' | 'absentismo' | 'fuera_zona' | 'comparativa'

export default function InformesTeamPage() {
  const { staff, locations, activeAccountId } = useApp()
  const today = new Date()
  // Por defecto: últimos 30 días (muestra un mes completo de operación, evita
  // que a principios de mes parezca que faltan ventas).
  const [from, setFrom] = useState(new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date(today.getTime() + 86400000).toISOString().slice(0, 10))
  const [locFilter, setLocFilter] = useState('todas')
  const [report, setReport] = useState<ReportKey>('jornada')

  const { resolvedLocationId } = useLocationScope()
  useEffect(() => { setLocFilter(resolvedLocationId ?? 'todas') }, [resolvedLocationId])

  // ── Ventas y productividad (server-side) ────────────────────────────────
  const [salesLoc, setSalesLoc] = useState<SalesByLocation[]>([])
  const [hoursLoc, setHoursLoc] = useState<HoursByLocation[]>([])
  const [salesHour, setSalesHour] = useState<SalesByHour[]>([])
  const [shifts, setShifts] = useState<WorkedShift[]>([])
  const [payrollByLoc, setPayrollByLoc] = useState<Record<string, number>>({})
  const [salesLoading, setSalesLoading] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setSalesLoading(true)
    ;(async () => {
      const [sl, hl, sh, wsh] = await Promise.all([
        fetchSalesByLocation(activeAccountId, from, to),
        fetchWorkedHoursByLocation(activeAccountId, from, to),
        fetchSalesByHour(activeAccountId, from, to),
        fetchWorkedShifts(activeAccountId, from, to),
      ])
      // Coste laboral por local = nóminas (definitivas) de los meses del periodo,
      // imputadas al local de la ficha de cada empleado.
      const costs = await fetchPayrollCosts(activeAccountId, new Date(from).getFullYear())
      const empLoc = new Map(staff.map(e => [e.id, e.locationId]))
      const f = new Date(new Date(from).getFullYear(), new Date(from).getMonth(), 1)
      const t = new Date(to)
      const byLoc: Record<string, number> = {}
      for (const c of costs) {
        if (c.status !== 'definitiva') continue
        const d = new Date(c.periodYear, c.periodMonth - 1, 1)
        if (d < f || d > t) continue
        const loc = empLoc.get(c.employeeId)
        if (!loc) continue
        byLoc[loc] = (byLoc[loc] || 0) + (c.totalCost || 0)
      }
      if (!cancelled) { setSalesLoc(sl); setHoursLoc(hl); setSalesHour(sh); setShifts(wsh); setPayrollByLoc(byLoc); setSalesLoading(false) }
    })()
    return () => { cancelled = true }
  }, [activeAccountId, from, to, staff])

  // Fila de comparativa por local con % personal, SPLH y fiabilidad del fichaje.
  const prod = useMemo(() => {
    return salesLoc.map(s => {
      const name = locations.find(l => l.id === s.locationId)?.name || '—'
      const horas = hoursLoc.find(h => h.locationId === s.locationId)?.hours ?? 0
      const costePersonal = payrollByLoc[s.locationId] ?? 0
      const ticketMedio = s.tickets > 0 ? s.ventas / s.tickets : 0
      const pctPersonal = s.ventas > 0 ? (costePersonal / s.ventas) * 100 : null
      const splh = horas > 0 ? s.ventas / horas : null
      // SPLH poco fiable si las horas fichadas son muy bajas para el volumen
      // (umbral prudente: > 150 €/hora casi siempre = fichaje incompleto).
      const splhReliable = splh != null && splh <= 150 && horas >= 8
      const cobertura = s.lineasTotal > 0 ? (s.lineasConCoste / s.lineasTotal) * 100 : 0
      return { id: s.locationId, name, ventas: s.ventas, tickets: s.tickets, ticketMedio, costePersonal, pctPersonal, horas, splh, splhReliable, cobertura }
    }).sort((a, b) => b.ventas - a.ventas)
  }, [salesLoc, hoursLoc, payrollByLoc, locations])

  const coberturaGlobal = useMemo(() => {
    const tot = salesLoc.reduce((s, r) => s + r.lineasTotal, 0)
    const con = salesLoc.reduce((s, r) => s + r.lineasConCoste, 0)
    return tot > 0 ? (con / tot) * 100 : 0
  }, [salesLoc])

  // Franja horaria: ventas por hora (ya en hora Madrid) y personal presente por
  // hora (repartiendo cada turno en cubos de hora, hora local Madrid).
  const franja = useMemo(() => {
    const ventasH = new Array(24).fill(0)
    const staffMinH = new Array(24).fill(0)
    const loc = locFilter === 'todas' ? null : locFilter
    for (const s of salesHour) {
      if (loc && s.locationId !== loc) continue
      ventasH[s.hour] += s.ventas
    }
    const hourMadrid = (ms: number) =>
      Number(new Date(ms).toLocaleString('en-US', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false })) % 24
    for (const sh of shifts) {
      if (loc && sh.locationId !== loc) continue
      let t = new Date(sh.startedAt).getTime()
      const end = new Date(sh.endedAt).getTime()
      const step = 10 * 60000
      while (t < end) { staffMinH[hourMadrid(t)] += 10; t += step }
    }
    const staffH = staffMinH.map(m => m / 60)
    const maxV = Math.max(1, ...ventasH)
    const maxS = Math.max(0.1, ...staffH)
    // Horas con actividad (venta o presencia) para no pintar la madrugada vacía.
    const active: number[] = []
    for (let h = 0; h < 24; h++) if (ventasH[h] > 0 || staffH[h] > 0.05) active.push(h)
    const hours = active.length ? active : [...Array(24).keys()]
    return { ventasH, staffH, maxV, maxS, hours }
  }, [salesHour, shifts, locFilter])

  const locName = (id?: string) => locations.find(l => l.id === id)?.name || '—'
  const emps = useMemo(
    () => staff.filter(e => locFilter === 'todas' || e.locationId === locFilter),
    [staff, locFilter])

  // Métricas por empleado en el periodo
  const perEmp = useMemo(() => emps.map(e => {
    const hours = hoursOf(e.clockEntries || [], from, to)
    const rate = hourlyCost(e)
    const workedCost = hours * rate
    const accrued = accruedCost(e, from, to)
    const absenceDays = (e.vacations || [])
      .filter(v => v.status === 'aprobada')
      .reduce((s, v) => s + overlapDays(v.startDate, v.endDate, from, to), 0)
    return { emp: e, hours, rate, workedCost, accrued, absenceDays }
  }), [emps, from, to])

  const totals = useMemo(() => ({
    hours: perEmp.reduce((s, x) => s + x.hours, 0),
    accrued: perEmp.reduce((s, x) => s + x.accrued, 0),
    workedCost: perEmp.reduce((s, x) => s + x.workedCost, 0),
    activos: perEmp.filter(x => x.hours > 0).length,
    absenceDays: perEmp.reduce((s, x) => s + x.absenceDays, 0),
  }), [perEmp])

  // Comparativa por local
  const perLoc = useMemo(() => {
    const scope = staff.filter(e => locFilter === 'todas' || e.locationId === locFilter)
    const byLoc = new Map<string, { hours: number; accrued: number; count: number; absence: number }>()
    for (const e of scope) {
      const hours = hoursOf(e.clockEntries || [], from, to)
      const accrued = accruedCost(e, from, to)
      const absence = (e.vacations || []).filter(v => v.status === 'aprobada').reduce((s, v) => s + overlapDays(v.startDate, v.endDate, from, to), 0)
      const k = e.locationId || 'sin_local'
      const cur = byLoc.get(k) || { hours: 0, accrued: 0, count: 0, absence: 0 }
      cur.hours += hours; cur.accrued += accrued; cur.count += 1; cur.absence += absence
      byLoc.set(k, cur)
    }
    return Array.from(byLoc.entries()).map(([id, v]) => ({ id, name: locName(id), ...v }))
      .sort((a, b) => b.accrued - a.accrued)
  }, [staff, locFilter, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxLocCost = Math.max(1, ...perLoc.map(l => l.accrued))

  // ── Datos de cada informe ────────────────────────────────────────────────
  const reportData: Record<ReportKey, ReportData> = useMemo(() => {
    // Jornada legal: una fila por par entrada→salida (excluye anulados)
    const jornadaRows: Cell[][] = []
    for (const e of emps) {
      const byDay = new Map<string, ClockEntry[]>()
      for (const c of (e.clockEntries || []).filter(c => !c.voided && c.datetime >= from && c.datetime <= to + 'T23:59:59')) {
        const d = c.datetime.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(c)
      }
      for (const [day, list] of Array.from(byDay.entries()).sort()) {
        const asc = list.sort((a, b) => a.datetime.localeCompare(b.datetime))
        let last: ClockEntry | null = null
        for (const c of asc) {
          if (c.type === 'entrada') last = c
          else if (c.type === 'salida' && last) {
            const hrs = (new Date(c.datetime).getTime() - new Date(last.datetime).getTime()) / 3600000
            jornadaRows.push([
              e.name, locName(e.locationId), day,
              new Date(last.datetime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
              new Date(c.datetime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
              h1(hrs),
              (last.source === 'manual' || c.source === 'manual') ? 'Manual' : 'Normal',
            ])
            last = null
          }
        }
      }
    }

    const costeRows: Cell[][] = perEmp
      .filter(x => x.accrued > 0 || x.hours > 0)
      .sort((a, b) => b.accrued - a.accrued)
      .map(x => [
        x.emp.name, locName(x.emp.locationId),
        eur(x.rate), h1(x.hours), eur(x.workedCost), eur(x.accrued),
        totals.accrued > 0 ? `${((x.accrued / totals.accrued) * 100).toFixed(1)}%` : '0%',
      ])

    const absRows: Cell[][] = []
    for (const e of emps) {
      for (const v of (e.vacations || []).filter(v => v.status === 'aprobada')) {
        const d = overlapDays(v.startDate, v.endDate, from, to)
        if (d > 0) absRows.push([e.name, locName(e.locationId), v.type, v.startDate, v.endDate, d])
      }
    }
    absRows.sort((a, b) => Number(b[5]) - Number(a[5]))

    const fzRows: Cell[][] = []
    for (const e of emps) {
      for (const c of (e.clockEntries || []).filter(c => !c.voided && c.datetime >= from && c.datetime <= to + 'T23:59:59')) {
        const loc = locations.find(l => l.id === (c.locationIdAtClock || e.locationId))
        if (c.lat == null || c.lng == null || !loc || loc.lat == null || loc.lng == null) continue
        const dist = Math.round(haversineM(c.lat, c.lng, loc.lat, loc.lng))
        const radius = loc.clockRadiusM ?? 200
        if (dist > radius) fzRows.push([e.name, new Date(c.datetime).toLocaleString('es-ES'), c.type, dist, radius, loc.name])
      }
    }
    fzRows.sort((a, b) => Number(b[3]) - Number(a[3]))

    const compRows: Cell[][] = perLoc.map(l => [l.name, l.count, h1(l.hours), eur(l.accrued), l.absence])

    return {
      jornada: { headers: ['Empleado', 'Local', 'Fecha', 'Entrada', 'Salida', 'Horas', 'Origen'], rows: jornadaRows },
      coste: { headers: ['Empleado', 'Local', 'Coste/hora', 'Horas fichadas', 'Coste horas fichadas', 'Coste devengado', '% del total'], rows: costeRows },
      absentismo: { headers: ['Empleado', 'Local', 'Tipo', 'Desde', 'Hasta', 'Días'], rows: absRows },
      fuera_zona: { headers: ['Empleado', 'Fecha y hora', 'Tipo', 'Distancia (m)', 'Radio (m)', 'Local'], rows: fzRows },
      comparativa: { headers: ['Local', 'Empleados', 'Horas fichadas', 'Coste devengado', 'Días ausencia'], rows: compRows },
    }
  }, [emps, perEmp, perLoc, from, to, totals.accrued, locations]) // eslint-disable-line react-hooks/exhaustive-deps

  const TABS: { key: ReportKey; label: string }[] = [
    { key: 'jornada', label: 'Jornada (legal)' },
    { key: 'coste', label: 'Coste por empleado' },
    { key: 'comparativa', label: 'Comparativa por local' },
    { key: 'absentismo', label: 'Absentismo' },
    { key: 'fuera_zona', label: 'Fichajes fuera de zona' },
  ]
  const current = reportData[report]
  const fileBase = `folvy-${report}-${from}_${to}`

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-accent">Informes</h1>
          <p className="text-sm text-text-secondary mt-0.5">Analítica de personal · {from} → {to}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 p-4 bg-page rounded-xl border border-border-default">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Desde</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Hasta</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Local</label>
          <select value={locFilter} onChange={e => setLocFilter(e.target.value)} className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary">
            <option value="todas">Todos</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* Dashboard KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={Clock} label="Horas fichadas" value={`${h1(totals.hours)} h`} />
        <KpiCard icon={Euro} label="Coste laboral (devengado)" value={eur(totals.accrued)} note="lo que pagas" />
        <KpiCard icon={Users} label="Empleados con actividad" value={String(totals.activos)} />
        <KpiCard icon={CalendarX} label="Días de ausencia" value={String(totals.absenceDays)} />
      </div>

      {/* Ventas y productividad por local (datos reales de ventas) */}
      <Card className="border-accent/30">
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl flex items-center gap-2">
          <TrendingUp size={15} className="text-accent" />
          <h3 className="font-semibold text-sm text-text-primary">Ventas y productividad por local</h3>
          <span className="text-xs text-text-secondary ml-auto">{from} → {to}</span>
        </div>
        {salesLoading ? (
          <p className="p-6 text-center text-sm text-text-secondary">Cargando ventas…</p>
        ) : prod.length === 0 ? (
          <p className="p-6 text-center text-sm text-text-secondary">Sin ventas en el periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border-default text-text-secondary">
                <th className="text-left font-medium px-4 py-2">Local</th>
                <th className="text-right font-medium px-4 py-2">Ventas</th>
                <th className="text-right font-medium px-4 py-2">Ticket medio</th>
                <th className="text-right font-medium px-4 py-2">Coste personal</th>
                <th className="text-right font-medium px-4 py-2">% personal</th>
                <th className="text-right font-medium px-4 py-2">Horas</th>
                <th className="text-right font-medium px-4 py-2">Ventas/hora</th>
              </tr></thead>
              <tbody>
                {prod.map(r => (
                  <tr key={r.id} className="border-b border-border-default last:border-0">
                    <td className="px-4 py-2 font-medium text-text-primary">{r.name}</td>
                    <td className="px-4 py-2 text-right text-text-primary">{eur(r.ventas)}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{eur(r.ticketMedio)}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{r.costePersonal > 0 ? eur(r.costePersonal) : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-text-primary">
                      {r.pctPersonal != null && r.costePersonal > 0 ? `${r.pctPersonal.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-text-secondary">{h1(r.horas)} h</td>
                    <td className="px-4 py-2 text-right">
                      {r.splh == null ? <span className="text-text-tertiary">—</span>
                        : r.splhReliable ? <span className="text-text-primary">{eur(r.splh)}/h</span>
                        : <span className="inline-flex items-center gap-1 text-warning" title="Pocas horas fichadas para este volumen: dato poco fiable">
                            <AlertTriangle size={12} /> fichaje bajo
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="p-4 border-t border-border-default space-y-1.5">
          <p className="text-[11px] text-text-secondary">
            <span className="font-medium text-text-primary">% personal</span> = coste real de nóminas del local ÷ sus ventas. <span className="font-medium text-text-primary">Ventas/hora</span> cruza ventas con horas fichadas por local; si hay muy pocas horas para el volumen, se marca <span className="text-warning">fichaje bajo</span> en vez de dar un número engañoso.
          </p>
          <p className="text-[11px] text-text-secondary flex items-start gap-1.5">
            <BarChart3 size={13} className="text-accent mt-0.5 shrink-0" />
            <span>
              <span className="font-medium text-accent">Margen real y % sobre margen</span> — el informe que ningún competidor tiene — se activan al completar el escandallo. Cobertura de coste actual: <span className="font-semibold text-text-primary">{coberturaGlobal.toFixed(0)}%</span> de las líneas de venta. Por debajo del 100% el margen sería parcial, así que no se muestra como cerrado.
            </span>
          </p>
        </div>
      </Card>

      {/* Ventas por franja horaria vs personal presente (sobre-dimensionado) */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl flex items-center gap-2">
          <Clock size={15} className="text-accent" />
          <h3 className="font-semibold text-sm text-text-primary">Ventas por franja horaria vs personal</h3>
          <span className="text-xs text-text-secondary ml-auto">{locFilter === 'todas' ? 'todos los locales' : locName(locFilter)}</span>
        </div>
        {salesLoading ? (
          <p className="p-6 text-center text-sm text-text-secondary">Cargando…</p>
        ) : (
          <div className="p-4">
            <div className="flex items-end gap-1 h-44">
              {franja.hours.map(h => {
                const v = franja.ventasH[h], s = franja.staffH[h]
                const vPct = (v / franja.maxV) * 100
                const sPct = (s / franja.maxS) * 100
                // Sobre-dimensionado: hay personal pero casi no hay ventas.
                const over = s > 0.3 && vPct < 15
                return (
                  <div key={h} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div className="absolute -top-1 opacity-0 group-hover:opacity-100 transition-base text-[10px] bg-card border border-border-default rounded px-1.5 py-1 shadow z-10 whitespace-nowrap pointer-events-none">
                      {eur(v)} · {s.toFixed(1)} p·h{over ? ' · sobra personal' : ''}
                    </div>
                    <div className="w-full flex items-end justify-center gap-0.5 h-full">
                      <div className={`w-1/2 rounded-t ${over ? 'bg-warning' : 'bg-accent'}`} style={{ height: `${Math.max(2, vPct)}%` }} title="ventas" />
                      <div className="w-1/2 rounded-t bg-text-tertiary/40" style={{ height: `${Math.max(2, sPct)}%` }} title="personal presente" />
                    </div>
                    <span className="text-[9px] text-text-secondary mt-1">{h}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[11px] text-text-secondary">
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-accent inline-block" /> Ventas por hora</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-text-tertiary/40 inline-block" /> Personal presente (persona·hora)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-warning inline-block" /> Franja con personal y sin ventas</span>
            </div>
            <p className="text-[11px] text-text-secondary mt-2">
              Barras en <span className="text-warning font-medium">ámbar</span> = horas con gente fichada pero ventas mínimas → candidatas a recortar plantilla. Usa el filtro de local arriba para verlo por sitio.
            </p>
          </div>
        )}
      </Card>

      {/* Comparativa por local (dashboard) */}
      {perLoc.length > 1 && (
        <Card>
          <div className="p-4 border-b border-border-default bg-page rounded-t-xl flex items-center gap-2">
            <MapPin size={15} className="text-accent" />
            <h3 className="font-semibold text-sm text-text-primary">Coste por local</h3>
          </div>
          <div className="p-4 space-y-3">
            {perLoc.map(l => (
              <div key={l.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-text-primary">{l.name}</span>
                  <span className="text-text-secondary">{eur(l.accrued)} · {h1(l.hours)} h fichadas · {l.count} empl.</span>
                </div>
                <div className="h-2 rounded-full bg-page overflow-hidden">
                  <div className="h-full bg-accent rounded-full" style={{ width: `${(l.accrued / maxLocCost) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Biblioteca de informes */}
      <div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setReport(t.key)}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-base ${report === t.key ? 'bg-accent text-text-on-accent' : 'bg-card border border-border-default text-text-secondary hover:border-accent'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <Card>
          <div className="p-4 border-b border-border-default bg-page rounded-t-xl flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm text-text-primary">{TABS.find(t => t.key === report)?.label} · {current.rows.length} filas</h3>
            <div className="flex gap-2">
              <button onClick={() => downloadCSV(fileBase, current)} disabled={current.rows.length === 0}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-accent-bg text-accent font-medium hover:bg-accent hover:text-text-on-accent disabled:opacity-40 transition-base">
                <Download size={13} /> CSV
              </button>
              <button onClick={() => void downloadXLSX(fileBase, current)} disabled={current.rows.length === 0}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-accent-bg text-accent font-medium hover:bg-accent hover:text-text-on-accent disabled:opacity-40 transition-base">
                <FileSpreadsheet size={13} /> Excel
              </button>
            </div>
          </div>

          {report === 'jornada' && (
            <p className="px-4 pt-3 text-[11px] text-text-secondary">
              Refleja los fichajes reales del periodo (excluye anulados). Origen "Manual" = añadido/corregido por el gestor; el detalle de cada corrección (quién, cuándo, por qué) está en Control horario → Historial.
            </p>
          )}
          {report === 'coste' && (
            <p className="px-4 pt-3 text-[11px] text-text-secondary">
              "Coste devengado" = lo que realmente pagas (sueldo prorrateado × SS), robusto aunque falten fichajes. "Coste horas fichadas" = horas × coste/hora; si sale muy por debajo del devengado, hay tiempo pagado sin fichar (fichajes incompletos o tiempo no trabajado).
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border-default bg-page">
                {current.headers.map(h => <th key={h} className="p-3 text-left text-xs font-semibold text-text-secondary whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {current.rows.length === 0 ? (
                  <tr><td colSpan={current.headers.length} className="p-8 text-center text-text-secondary text-sm">Sin datos en este periodo</td></tr>
                ) : current.rows.slice(0, 500).map((row, i) => (
                  <tr key={i} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                    {row.map((cell, j) => (
                      <td key={j} className={`p-3 whitespace-nowrap ${j === 0 ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                        {report === 'jornada' && j === 6
                          ? <Badge color={cell === 'Manual' ? 'gray' : 'green'}>{cell}</Badge>
                          : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.rows.length > 500 && (
            <p className="p-3 text-center text-xs text-text-secondary">Mostrando 500 de {current.rows.length} filas · exporta a CSV/Excel para verlas todas</p>
          )}
        </Card>
      </div>

      <p className="text-[11px] text-text-secondary text-center">
        Coste devengado = coste empresa anual (bruto + SS real de la nómina/ficha, o SS estimada al 30% si falta) prorrateado por días de alta en el periodo. Coste/hora = coste empresa ÷ horas efectivas de convenio ({ANNUAL_EFFECTIVE_HOURS} h/año). Con las nóminas reales el dato pasa a ser exacto.
      </p>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, note }: { icon: typeof Clock; label: string; value: string; note?: string }) {
  return (
    <div className="p-4 rounded-lg border border-border-default bg-accent-bg text-accent">
      <div className="flex items-center gap-2 mb-1"><Icon size={18} /><p className="text-2xl font-bold">{value}</p></div>
      <p className="text-xs">{label}{note && <span className="text-text-secondary"> · {note}</span>}</p>
    </div>
  )
}
