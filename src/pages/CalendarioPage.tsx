// src/pages/CalendarioPage.tsx
// Sub-fase 3.2 — Vista tipo Excel del calendario de horarios.
// - Selector de semana y local
// - Botón generar automático
// - Matriz turnos × días con celdas editables
// - Resumen de carga por empleado
// - Sugerencias para huecos sin cubrir
// - Horario individualizado por empleado (plegable)

import { useEffect, useMemo, useState } from 'react'
import {
  Wand2, Save, Check, Megaphone, X, Plus,
  AlertTriangle, Copy, Euro, Clock, TrendingUp,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  listShiftTemplates,
  getSchedule,
  upsertSchedule,
  publishSchedule,
  copyScheduleToWeeks,
  type CopyScheduleResult,
} from '../services/schedulerService'
import {
  generateSchedule,
  computeWorkloads,
  suggestFillForGap,
  setGlobalAssignedHoursSnapshot,
  validateSchedule,
  type FillSuggestion,
  type ValidationIssue,
} from '../services/scheduleGenerator'
import {
  type ShiftTemplate,
  type DayOfWeek,
  type ScheduleCells,
  type CoverageOverrides,
  type Schedule,
  type UncoveredSlot,
  type EmployeeWorkload,
  shiftDurationHours,
  coverageForDay,
  getMondayOfWeek,
  toISODate,
  DAY_LABELS_SHORT,
  DAY_LABELS,
} from '../types/scheduler'
import type { Employee } from '../types'
import { getStaffingGaps, type StaffingGap } from '../modules/multitenancy/services/businessHoursService'
import { fetchPayrollCosts } from '../services/payrollService'
import { fetchSalesByLocation, fetchDemandProfile, fetchDemandForecast, type DemandProfile, type DemandForecast } from '../services/teamReportsService'
import { fetchStaffRoles, roleColor, upsertStaffRole, deleteStaffRole, ROLE_COLOR_KEYS, type StaffRole, type RoleKind } from '../services/staffRoleService'

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

const MONTH_LABELS = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTH_SHORT = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Desglose humano de la previsión ajustada (cuadrante y panel horario).
function forecastDesglose(f: DemandForecast): string {
  const parts: string[] = [`${DAY_LABELS[f.dow as DayOfWeek]} tipo ×${f.idxDow.toFixed(2)}`]
  const mesPct = Math.round((f.idxMes - 1) * 100)
  parts.push(`${MONTH_LABELS[f.mes]} ${mesPct >= 0 ? '+' : ''}${mesPct}%`)
  const tPct = Math.round((f.tendencia - 1) * 100)
  if (tPct !== 0) parts.push(`tendencia ${tPct >= 0 ? '+' : ''}${tPct}%`)
  parts.push(`base ${Math.round(f.baseAnual)} platos/día`)
  return parts.join(' · ')
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

function formatWeekLabel(weekStartISO: string): string {
  const [y, m, d] = weekStartISO.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${start.toLocaleDateString('es-ES', opts)} – ${end.toLocaleDateString('es-ES', opts)} ${end.getFullYear()}`
}

export default function CalendarioPage() {
  const { locations, staff, activeAccountId } = useApp()
  const [locationId, setLocationId] = useState<string>('')
  const [weekStart, setWeekStart] = useState<string>(() => toISODate(getMondayOfWeek(new Date())))
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [cells, setCells] = useState<ScheduleCells>({})
  const [overrides, setOverrides] = useState<CoverageOverrides>({})
  const [scheduleRow, setScheduleRow] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [gapModal, setGapModal] = useState<UncoveredSlot | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([])
  const [issuesShown, setIssuesShown] = useState(false)
  const [copyModalOpen, setCopyModalOpen] = useState(false)

  const employees = useMemo(
    () => staff.filter(e => e.active && (e.locationId === locationId || (e.assignedLocations || []).includes(locationId))),
    [staff, locationId]
  )

  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id)
  }, [locations, locationId])

  async function refresh() {
    if (!locationId) return
    setLoading(true)
    const [tpls, sched] = await Promise.all([
      listShiftTemplates(locationId),
      getSchedule(locationId, weekStart),
    ])
    setTemplates(tpls)
    setScheduleRow(sched)
    setCells(sched?.cells || {})
    setOverrides(sched?.coverage_overrides || {})
    setDirty(false)
    setLoading(false)
    // Aviso: horario comercial abierto sin personal (lee de BD; refleja lo guardado)
    getStaffingGaps(locationId).then(setStaffingGaps).catch(() => setStaffingGaps([]))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, weekStart])

  const workloads = useMemo<EmployeeWorkload[]>(
    () => computeWorkloads(cells, templates, employees),
    [cells, templates, employees]
  )

  // ── Coste en vivo del cuadrante ─────────────────────────────────────────
  const ANNUAL_HOURS = 1770  // horas efectivas de convenio/año (mismo criterio que Informes)
  const [hourlyCost, setHourlyCost] = useState<Record<string, number>>({})
  const [weekSales, setWeekSales] = useState<number | null>(null)

  // Coste/hora por empleado: nómina real (definitiva más reciente × 12 ÷ horas año);
  // si no hay nómina, se estima desde la ficha (bruto + SS real o 30%).
  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    ;(async () => {
      const costs = await fetchPayrollCosts(activeAccountId, new Date().getFullYear())
      const latest = new Map<string, number>()
      for (const c of costs) {
        if (c.status !== 'definitiva' || c.totalCost == null) continue
        const key = c.employeeId
        if (!latest.has(key)) latest.set(key, c.totalCost)  // fetch viene ordenado desc
      }
      const map: Record<string, number> = {}
      for (const e of staff) {
        const monthly = latest.get(e.id)
        if (monthly != null) map[e.id] = (monthly * 12) / ANNUAL_HOURS
        else {
          const gross = e.salary || 0
          const ss = e.employerSsAnnual != null ? e.employerSsAnnual : gross * 0.30
          map[e.id] = gross > 0 ? (gross + ss) / ANNUAL_HOURS : 0
        }
      }
      if (!cancel) setHourlyCost(map)
    })()
    return () => { cancel = true }
  }, [activeAccountId, staff])

  // Ventas de la semana del cuadrante (histórico del local) → base del % personal.
  useEffect(() => {
    if (!activeAccountId || !locationId) { setWeekSales(null); return }
    let cancel = false
    ;(async () => {
      const end = addDays(weekStart, 7)
      const rows = await fetchSalesByLocation(activeAccountId, weekStart, end)
      const row = rows.find(r => r.locationId === locationId)
      if (!cancel) setWeekSales(row ? row.ventas : 0)
    })()
    return () => { cancel = true }
  }, [activeAccountId, locationId, weekStart])

  // Perfil de demanda (día×hora) de las últimas ~8 semanas → SOLO la forma horaria (curva).
  const [demand, setDemand] = useState<DemandProfile[]>([])
  useEffect(() => {
    if (!activeAccountId) { setDemand([]); return }
    let cancel = false
    const from = addDays(weekStart, -56)
    const to = addDays(weekStart, 7)
    fetchDemandProfile(activeAccountId, from, to).then(d => { if (!cancel) setDemand(d) })
    return () => { cancel = true }
  }, [activeAccountId, weekStart])

  // Previsión AJUSTADA por día del local y semana: base × coef_día × coef_mes × tendencia.
  const [forecast, setForecast] = useState<DemandForecast[]>([])
  useEffect(() => {
    if (!activeAccountId || !locationId) { setForecast([]); return }
    let cancel = false
    fetchDemandForecast(activeAccountId, locationId, weekStart).then(f => { if (!cancel) setForecast(f) })
    return () => { cancel = true }
  }, [activeAccountId, locationId, weekStart])

  const forecastByDow = useMemo(() => {
    const m: Record<number, DemandForecast> = {}
    for (const f of forecast) m[f.dow] = f
    return m
  }, [forecast])

  // Curva horaria histórica por día (forma intradía; el total lo pone la previsión).
  const hourlyByDow = useMemo(() => {
    const hourly: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
    for (const r of demand) {
      if (locationId && r.locationId !== locationId) continue
      if (r.dow < 0 || r.dow > 6) continue
      hourly[r.dow][r.hour] += r.units
    }
    return hourly
  }, [demand, locationId])

  // Nivel Alta/Media/Baja relativo a la propia semana, sobre la PREVISIÓN.
  const demandLevels = useMemo(() => {
    const perDay = DAYS.map(d => forecastByDow[d]?.prevision ?? 0)
    const max = Math.max(1, ...perDay)
    const level = perDay.map(u => {
      if (u <= 0) return 'none' as const
      const ratio = u / max
      if (ratio >= 0.66) return 'alta' as const
      if (ratio >= 0.33) return 'media' as const
      return 'baja' as const
    })
    return { perDay, max, level }
  }, [forecastByDow])

  const [demandDayOpen, setDemandDayOpen] = useState<number | null>(null)

  // Totales que se recalculan solos al editar la rejilla (workloads depende de cells).
  const costLive = useMemo(() => {
    let hours = 0, cost = 0
    for (const w of workloads) {
      hours += w.assigned_hours
      cost += w.assigned_hours * (hourlyCost[w.employee_id] ?? 0)
    }
    const pct = weekSales && weekSales > 0 ? (cost / weekSales) * 100 : null
    return { hours: Math.round(hours * 10) / 10, cost: Math.round(cost * 100) / 100, pct }
  }, [workloads, hourlyCost, weekSales])

  const eur0 = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  // ── Vista visual "por empleado" con pastillas por área ──────────────────
  const [viewMode, setViewMode] = useState<'turno' | 'empleado'>('empleado')
  const [roles, setRoles] = useState<StaffRole[]>([])
  const [rolesModalOpen, setRolesModalOpen] = useState(false)
  const reloadRoles = () => { if (activeAccountId) fetchStaffRoles(activeAccountId).then(setRoles) }
  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    fetchStaffRoles(activeAccountId).then(r => { if (!cancel) setRoles(r) })
    return () => { cancel = true }
  }, [activeAccountId])

  // Color por área: casa employees.department (texto) con staff_role.name.
  const colorByDept = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of roles) m[r.name.toLowerCase().trim()] = r.color
    return m
  }, [roles])
  const empColor = (e: Employee) => roleColor(colorByDept[(e.department || '').toLowerCase().trim()])

  // Inversión: por empleado y día, los turnos que tiene asignados esa semana.
  const empSchedule = useMemo(() => {
    const map: Record<string, Record<number, ShiftTemplate[]>> = {}
    for (const t of templates) {
      for (const d of DAYS) {
        const ids = cells[t.id]?.[String(d)] || []
        for (const id of ids) {
          if (!map[id]) map[id] = {}
          if (!map[id][d]) map[id][d] = []
          map[id][d].push(t)
        }
      }
    }
    return map
  }, [cells, templates])

  const hoursByEmp = useMemo(() => {
    const m: Record<string, number> = {}
    for (const w of workloads) m[w.employee_id] = w.assigned_hours
    return m
  }, [workloads])
  const wlByEmp = useMemo(() => {
    const m: Record<string, { contracted: number; delta: number }> = {}
    for (const w of workloads) m[w.employee_id] = { contracted: w.contracted_hours, delta: w.delta }
    return m
  }, [workloads])

  // Añadir/quitar un empleado de un turno concreto en un día (reusa setCellAssign).
  function addToShift(templateId: string, day: DayOfWeek, empId: string) {
    const cur = cells[templateId]?.[String(day)] || []
    if (!cur.includes(empId)) setCellAssign(templateId, day, [...cur, empId])
  }
  function removeFromShift(templateId: string, day: DayOfWeek, empId: string) {
    const cur = cells[templateId]?.[String(day)] || []
    setCellAssign(templateId, day, cur.filter(x => x !== empId))
  }

  const uncovered = useMemo<UncoveredSlot[]>(() => {
    const list: UncoveredSlot[] = []
    for (const t of templates) {
      for (const d of DAYS) {
        const baseCov = coverageForDay(t, d)
        const ov = overrides[t.id]?.[String(d)]
        const needed = ov !== undefined ? ov : baseCov
        if (needed === 0) continue
        const assigned = (cells[t.id]?.[String(d)] || []).length
        if (assigned < needed) {
          list.push({
            template_id: t.id,
            template_label: t.label,
            day_of_week: d,
            needed,
            assigned,
            reason: assigned === 0 ? 'sin asignar' : 'parcialmente cubierto',
          })
        }
      }
    }
    return list
  }, [cells, overrides, templates])

  function setCellAssign(templateId: string, day: DayOfWeek, ids: string[]) {
    setCells(prev => {
      const copy = { ...prev }
      if (!copy[templateId]) copy[templateId] = {}
      copy[templateId] = { ...copy[templateId], [String(day)]: ids }
      return copy
    })
    setDirty(true)
  }

  function setOverride(templateId: string, day: DayOfWeek, value: number | null) {
    setOverrides(prev => {
      const copy = { ...prev }
      if (!copy[templateId]) copy[templateId] = {}
      copy[templateId] = { ...copy[templateId] }
      if (value === null) {
        delete copy[templateId][String(day)]
      } else {
        copy[templateId][String(day)] = value
      }
      return copy
    })
    setDirty(true)
  }

  function doValidate() {
    setIssues(validateSchedule(cells, templates, employees))
    setIssuesShown(true)
  }

  async function doGenerate() {
    if (!locationId || templates.length === 0 || employees.length === 0) return
    if (Object.keys(cells).length > 0) {
      if (!confirm('Esto sobreescribirá los turnos actuales. ¿Continuar?')) return
    }
    const result = generateSchedule({
      locationId,
      weekStart,
      templates,
      employees,
      overrides,
    })
    setCells(result.cells)
    setDirty(true)
  }

  async function doSave() {
    if (!locationId) return
    const saved = await upsertSchedule({
      location_id: locationId,
      week_start: weekStart,
      cells,
      coverage_overrides: overrides,
      status: scheduleRow?.status || 'draft',
      generated_at: new Date().toISOString(),
    })
    if (saved) {
      setScheduleRow(saved)
      setDirty(false)
      // Recalcular aviso de personal con lo recién guardado
      getStaffingGaps(locationId).then(setStaffingGaps).catch(() => setStaffingGaps([]))
    }
  }

  async function doPublish() {
    if (!scheduleRow) {
      await doSave()
    }
    if (scheduleRow?.id) {
      await publishSchedule(scheduleRow.id)
      await refresh()
    } else {
      const saved = await upsertSchedule({
        location_id: locationId,
        week_start: weekStart,
        cells,
        coverage_overrides: overrides,
        status: 'published',
        generated_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      })
      if (saved) setScheduleRow(saved)
    }
  }

  function shiftWeek(deltaDays: number) {
    if (dirty && !confirm('Tienes cambios sin guardar. ¿Cambiar de semana?')) return
    setWeekStart(prev => addDays(prev, deltaDays))
  }

  function clearCells() {
    if (!confirm('¿Vaciar toda la matriz?')) return
    setCells({})
    setDirty(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 bg-card border rounded-lg p-3">
        <select
          value={locationId}
          onChange={e => setLocationId(e.target.value)}
          className="border rounded px-3 py-2 bg-card text-sm"
        >
          {locations.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button onClick={() => shiftWeek(-7)} className="px-2 py-1 border rounded hover:bg-page">←</button>
          <div className="px-3 py-1 text-sm font-medium min-w-[180px] text-center">
            {formatWeekLabel(weekStart)}
          </div>
          <button onClick={() => shiftWeek(+7)} className="px-2 py-1 border rounded hover:bg-page">→</button>
          <button
            onClick={() => setWeekStart(toISODate(getMondayOfWeek(new Date())))}
            className="ml-2 text-xs text-text-secondary hover:underline"
          >
            Hoy
          </button>
        </div>

        <div className="flex-1" />

        <button
          onClick={doGenerate}
          disabled={loading || templates.length === 0 || employees.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-text-on-accent text-sm font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          title="Genera la matriz automáticamente respetando las reglas"
        >
          <Wand2 size={14} /> Generar automático
        </button>
        <button
          onClick={clearCells}
          className="px-3 py-2 rounded border border-border-default bg-card text-text-primary text-sm hover:bg-page transition-base"
        >
          Vaciar
        </button>
        <button
          onClick={doSave}
          disabled={!dirty}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded text-text-on-accent text-sm font-medium disabled:opacity-40 transition-base ${
            dirty ? 'bg-warning hover:opacity-90' : 'bg-text-secondary'
          }`}
        >
          {dirty ? <><Save size={14} /> Guardar borrador</> : <><Check size={14} /> Guardado</>}
        </button>
        <button
          onClick={doValidate}
          disabled={templates.length === 0 || employees.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-border-default bg-card text-text-primary text-sm hover:bg-page disabled:opacity-40 transition-base"
          title="Comprueba horas extras, descansos y solapes en el cuadrante actual"
        >
          <AlertTriangle size={14} /> Validar
        </button>
        <button
          onClick={doPublish}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded border-2 border-accent text-accent bg-card text-sm font-medium hover:bg-accent-bg transition-base"
          title="Publicar para que los empleados lo vean en su móvil"
        >
          <Megaphone size={14} /> Publicar
        </button>
        <button
          onClick={() => setCopyModalOpen(true)}
          disabled={Object.keys(cells).length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-border-default bg-card text-text-primary text-sm hover:bg-page disabled:opacity-40 transition-base"
          title="Copiar este horario a la semana siguiente, al resto del mes o a un rango"
        >
          <Copy size={14} /> Copiar
        </button>
      </div>

      {/* Coste en vivo del cuadrante (se recalcula al editar) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 bg-page border border-border-default">
          <div className="flex items-center gap-1.5 text-xs text-text-secondary"><Clock size={13} /> Horas asignadas</div>
          <div className="text-2xl font-bold text-text-primary mt-0.5">{costLive.hours} h</div>
        </div>
        <div className="rounded-lg p-3 bg-page border border-border-default">
          <div className="flex items-center gap-1.5 text-xs text-text-secondary"><Euro size={13} /> Coste semana (real)</div>
          <div className="text-2xl font-bold text-text-primary mt-0.5">{eur0(costLive.cost)}</div>
        </div>
        <div className={`rounded-lg p-3 border ${costLive.pct == null ? 'bg-page border-border-default' : costLive.pct <= 30 ? 'bg-success-bg border-success/40' : 'bg-warning-bg border-warning/40'}`}>
          <div className={`flex items-center gap-1.5 text-xs ${costLive.pct == null ? 'text-text-secondary' : costLive.pct <= 30 ? 'text-success' : 'text-warning'}`}><TrendingUp size={13} /> % personal / ventas</div>
          <div className={`text-2xl font-bold mt-0.5 ${costLive.pct == null ? 'text-text-secondary' : costLive.pct <= 30 ? 'text-success' : 'text-warning'}`}>
            {costLive.pct == null ? '—' : `${costLive.pct.toFixed(1)}%`}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary -mt-2">
        Coste = horas asignadas × coste/hora real de cada empleado (nóminas). % sobre ventas de esa semana en el local ({weekSales == null ? '—' : eur0(weekSales)}). Se actualiza al mover turnos.
      </p>

      <div className="flex items-center gap-3 text-xs text-text-secondary">
        {scheduleRow?.status === 'published' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-bg text-success font-medium">
            ● Publicado
          </span>
        )}
        {scheduleRow?.status === 'draft' && (
          <span className="px-2 py-0.5 rounded-full bg-warning-bg text-warning font-medium">
            ● Borrador
          </span>
        )}
        {!scheduleRow && (
          <span className="px-2 py-0.5 rounded-full bg-accent-bg text-text-primary font-medium">
            ● Sin guardar
          </span>
        )}
        {employees.length === 0 && locationId && (
          <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={12} /> No hay empleados activos en este local</span>
        )}
        {templates.length === 0 && locationId && (
          <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={12} /> No hay turnos definidos en la plantilla</span>
        )}
      </div>

      {issuesShown && (
        <div className="bg-card border border-border-default rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide inline-flex items-center gap-1.5">
              <AlertTriangle size={12} /> Validación del cuadrante
            </p>
            <button
              onClick={() => setIssuesShown(false)}
              className="text-xs text-text-secondary hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
          {issues.length === 0 ? (
            <p className="text-sm text-success inline-flex items-center gap-1.5">
              <Check size={14} /> Sin avisos detectados.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((iss, i) => {
                const cls =
                  iss.type === 'overtime' ? 'bg-warning-bg text-warning' :
                  iss.type === 'rest_violation' ? 'bg-danger-bg text-danger' :
                  iss.type === 'rest_12h' ? 'bg-danger-bg text-danger' :
                  iss.type === 'vacation_conflict' ? 'bg-warning-bg text-warning' :
                  iss.type === 'overlap' ? 'bg-danger-bg text-danger' :
                  'bg-page text-text-secondary'
                return (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${cls}`}>{iss.type}</span>
                    <span className="text-text-primary">{iss.message}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Aviso: horario comercial abierto sin personal asignado */}
      {staffingGaps.length > 0 && (
        <div className="rounded-lg p-3 mb-3" style={{ background: '#FFF3D6', border: '1px solid #F2DCA0' }}>
          <div className="flex items-center gap-1.5 text-sm font-semibold mb-1.5" style={{ color: '#7A5A12' }}>
            <AlertTriangle size={16} /> Horario comercial abierto sin personal asignado
          </div>
          <p className="text-xs mb-2" style={{ color: '#7A5A12' }}>
            Este local figura abierto al público pero no hay ningún turno con personal en:
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {staffingGaps.map((g, i) => {
              const dl: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' }
              return (
                <span key={i} className="text-xs" style={{ color: '#7A5A12' }}>
                  <span className="font-semibold">{dl[g.weekday]}</span> {g.gapStart}–{g.gapEnd}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {templates.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-secondary mr-1">Vista:</span>
          <button onClick={() => setViewMode('empleado')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-base ${viewMode === 'empleado' ? 'bg-accent text-text-on-accent' : 'bg-card border border-border-default text-text-secondary hover:border-accent'}`}>
            Por empleado
          </button>
          <button onClick={() => setViewMode('turno')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-base ${viewMode === 'turno' ? 'bg-accent text-text-on-accent' : 'bg-card border border-border-default text-text-secondary hover:border-accent'}`}>
            Por turno
          </button>
          <button onClick={() => setRolesModalOpen(true)}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg font-medium bg-card border border-border-default text-text-secondary hover:border-accent transition-base">
            Áreas
          </button>
        </div>
      )}

      {templates.length > 0 && (viewMode === 'empleado' ? (
        employees.length === 0 ? (
          <div className="bg-card border border-border-default rounded-lg p-6 text-center text-sm text-text-secondary">No hay empleados en este local.</div>
        ) : (
        <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page">
              <tr>
                <th className="px-3 py-2 text-left sticky left-0 z-20 bg-page border-r border-border-default">Empleado</th>
                {DAYS.map(d => {
                  const units = demandLevels.perDay[d]
                  const lv = demandLevels.level[d]
                  const f = forecastByDow[d]
                  const style = lv === 'alta' ? 'bg-danger-bg text-danger border-danger/30'
                    : lv === 'media' ? 'bg-warning-bg text-warning border-warning/30'
                    : lv === 'baja' ? 'bg-success-bg text-success border-success/30'
                    : 'bg-page text-text-secondary border-border-default'
                  const label = lv === 'alta' ? 'Alta' : lv === 'media' ? 'Media' : lv === 'baja' ? 'Baja' : '—'
                  // Ajuste de mes visible a simple vista (p.ej. "ago −35%") cuando pesa.
                  const mesPct = f ? Math.round((f.idxMes - 1) * 100) : 0
                  const showMes = f && Math.abs(f.idxMes - 1) >= 0.10
                  return (
                    <th key={d} className="px-2 py-2 text-center w-32 text-text-secondary font-medium align-top">
                      {DAY_LABELS_SHORT[d]}<br />
                      <span className="text-[10px] opacity-70 font-normal">{addDays(weekStart, d).slice(8, 10)}/{addDays(weekStart, d).slice(5, 7)}</span>
                      {units > 0 && f && (
                        <button onClick={() => setDemandDayOpen(d)}
                          className={`mt-1 w-full rounded-md border px-1.5 py-1 flex flex-col items-center leading-tight hover:opacity-80 transition-base ${style}`}
                          title={`Previsión ajustada · ${forecastDesglose(f)}`}>
                          <span className="text-[10px] font-semibold">{label}</span>
                          <span className="text-[11px] font-bold">{Math.round(units)}</span>
                          <span className="text-[8px] font-normal opacity-70">platos prev.</span>
                          {showMes && (
                            <span className="text-[8px] font-semibold opacity-80">{MONTH_SHORT[f.mes]} {mesPct >= 0 ? '+' : ''}{mesPct}%</span>
                          )}
                        </button>
                      )}
                    </th>
                  )
                })}
                <th className="px-2 py-2 text-center w-16 text-text-secondary font-medium">h</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => {
                const col = empColor(e)
                const initials = e.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
                return (
                  <tr key={e.id} className="border-b border-border-default">
                    <td className="px-3 py-2 align-top sticky left-0 z-10 bg-card border-r border-border-default">
                      <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${col.bg} ${col.text}`}>{initials}</span>
                        <div className="min-w-0">
                          <div className="font-medium leading-tight truncate">{e.name}</div>
                          <div className="text-[10px] text-text-secondary flex items-center gap-1 flex-wrap">
                            <span className={`w-2 h-2 rounded-full ${col.dot}`}></span>{e.department || 'sin área'} ·
                            <span className={wlByEmp[e.id] && wlByEmp[e.id].delta > 0.5 ? 'text-warning font-medium' : 'text-text-primary'}>{Math.round((hoursByEmp[e.id] || 0) * 10) / 10}h</span>
                            {wlByEmp[e.id] && wlByEmp[e.id].contracted > 0 && <span className="text-text-tertiary">/ {wlByEmp[e.id].contracted}h</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    {DAYS.map(d => {
                      const shifts = empSchedule[e.id]?.[d] || []
                      const avail = templates.filter(t => coverageForDay(t, d) > 0 && !shifts.some(s => s.id === t.id))
                      return (
                        <td key={d} className="px-1.5 py-1.5 align-top border-l border-border-default">
                          <div className="space-y-1">
                            {shifts.map(t => (
                              <button key={t.id} onClick={() => removeFromShift(t.id, d, e.id)}
                                className={`w-full text-left rounded-md px-1.5 py-1 text-[11px] font-medium ${col.bg} ${col.text} hover:opacity-80 transition-base group`}
                                title={`${t.label} · clic para quitar`}>
                                {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                                <X size={10} className="inline ml-1 opacity-0 group-hover:opacity-100" />
                              </button>
                            ))}
                            {avail.length > 0 && (
                              <select value="" onChange={ev => { if (ev.target.value) addToShift(ev.target.value, d, e.id) }}
                                className="w-full text-[10px] text-text-secondary border border-dashed border-border-default rounded-md px-1 py-0.5 bg-transparent hover:border-accent cursor-pointer">
                                <option value="">+ turno</option>
                                {avail.map(t => <option key={t.id} value={t.id}>{t.label} {t.start_time.slice(0, 5)}</option>)}
                              </select>
                            )}
                          </div>
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-center text-xs font-mono text-text-secondary align-top">{Math.round((hoursByEmp[e.id] || 0) * 10) / 10}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )
      ) : (
        <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-accent text-text-on-accent">
              <tr>
                <th className="px-3 py-2 text-left sticky left-0 z-20 bg-accent border-r border-white/15">Turno</th>
                {DAYS.map(d => (
                  <th key={d} className="px-2 py-2 text-center w-32">
                    {DAY_LABELS_SHORT[d]}
                    <br />
                    <span className="text-[10px] opacity-80 font-normal">
                      {addDays(weekStart, d).slice(8, 10)}/{addDays(weekStart, d).slice(5, 7)}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 text-center w-16">h</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => {
                const tHours = shiftDurationHours(t.start_time, t.end_time)
                return (
                  <tr key={t.id} className="border-b">
                    <td className="px-3 py-2 align-top sticky left-0 z-10 bg-card border-r border-border-default">
                      <div className="font-medium">{t.label}</div>
                      <div className="text-xs text-text-secondary font-mono">
                        {t.start_time.slice(0, 5)} – {t.end_time.slice(0, 5)}
                      </div>
                      <div className="text-xs text-text-secondary">{tHours}h</div>
                    </td>
                    {DAYS.map(d => {
                      const baseCov = coverageForDay(t, d)
                      const ovKey = String(d)
                      const ov = overrides[t.id]?.[ovKey]
                      const needed = ov !== undefined ? ov : baseCov
                      const assignedIds = cells[t.id]?.[ovKey] || []
                      const isOverridden = ov !== undefined && ov !== baseCov
                      return (
                        <Cell
                          key={d}
                          template={t}
                          day={d}
                          needed={needed}
                          baseCoverage={baseCov}
                          isOverridden={isOverridden}
                          assignedIds={assignedIds}
                          allEmployees={employees}
                          workloads={workloads}
                          onChangeAssigned={(ids) => setCellAssign(t.id, d, ids)}
                          onChangeNeeded={(v) => setOverride(t.id, d, v === baseCov ? null : v)}
                        />
                      )
                    })}
                    <td className="px-2 py-2 text-center text-xs text-text-secondary font-mono">
                      {tHours}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {uncovered.length > 0 && (
        <UncoveredPanel
          uncovered={uncovered}
          templates={templates}
          onClickGap={(g) => {
            const map = new Map<string, number>()
            for (const w of workloads) map.set(w.employee_id, w.assigned_hours)
            setGlobalAssignedHoursSnapshot(map)
            setGapModal(g)
          }}
        />
      )}

      {gapModal && (
        <SuggestionsModal
          gap={gapModal}
          template={templates.find(t => t.id === gapModal.template_id)!}
          weekStart={weekStart}
          cells={cells}
          employees={employees}
          onClose={() => setGapModal(null)}
          onApply={(empId) => {
            const cur = cells[gapModal.template_id]?.[String(gapModal.day_of_week)] || []
            setCellAssign(gapModal.template_id, gapModal.day_of_week, [...cur, empId])
            setGapModal(null)
          }}
        />
      )}

      {copyModalOpen && (
        <CopyScheduleModal
          locationId={locationId}
          sourceWeekStart={weekStart}
          onClose={() => setCopyModalOpen(false)}
          onDone={refresh}
        />
      )}

      {rolesModalOpen && activeAccountId && (
        <RolesModal
          accountId={activeAccountId}
          roles={roles}
          onClose={() => setRolesModalOpen(false)}
          onChanged={reloadRoles}
        />
      )}

      {demandDayOpen !== null && (
        <DemandDayPanel
          dow={demandDayOpen}
          hourly={hourlyByDow[demandDayOpen]}
          forecast={forecastByDow[demandDayOpen] || null}
          onClose={() => setDemandDayOpen(null)}
        />
      )}
    </div>
  )
}

/* =====================================================
   Panel: curva de demanda por hora de un día
   ===================================================== */

function DemandDayPanel({ dow, hourly, forecast, onClose }: {
  dow: number
  hourly: number[]
  forecast: DemandForecast | null
  onClose: () => void
}) {
  const dayName = DAY_LABELS[dow as DayOfWeek]
  // La forma intradía es histórica; el TOTAL lo pone la previsión ajustada.
  const histTotal = hourly.reduce((a, b) => a + b, 0)
  const scale = histTotal > 0 && forecast ? forecast.prevision / histTotal : (histTotal > 0 ? 1 : 0)
  const fcHourly = hourly.map(u => u * scale)
  const total = forecast ? forecast.prevision : histTotal
  const max = Math.max(1, ...fcHourly)
  const peak = fcHourly.indexOf(max)
  const comida = fcHourly.slice(13, 16).reduce((a, b) => a + b, 0)
  const cena = fcHourly.slice(20, 23).reduce((a, b) => a + b, 0)
  const hours = fcHourly.map((_, h) => h).filter(h => h >= 7 && h <= 23)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border-default w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-text-primary">Previsión de cocina · {dayName}</h3>
            <p className="text-xs text-text-secondary mt-0.5">
              ~{Math.round(total)} platos previstos · pico a las {peak}h · comida {Math.round(comida)} · cena {Math.round(cena)}
            </p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        {forecast && (
          <div className="px-4 pt-3">
            <div className="rounded-lg bg-page border border-border-default p-2.5 text-[11px] text-text-primary">
              <span className="font-semibold">Cómo sale este número:</span> {forecastDesglose(forecast)}
              {forecast.diasDatos < 21 && <span className="text-text-secondary"> · tendencia neutra (pocos datos aún)</span>}
            </div>
          </div>
        )}
        <div className="p-5">
          <div className="flex items-end gap-1 h-52">
            {hours.map(h => {
              const u = fcHourly[h]
              const pct = (u / max) * 100
              const ratio = u / max
              // Color sólido por intensidad: verde (flojo) → ámbar (medio) → rojo (punta).
              const barColor = u <= 0 ? '#E5E5E0'
                : ratio >= 0.66 ? '#E24B4A'
                : ratio >= 0.33 ? '#EF9F27'
                : '#639922'
              return (
                <div key={h} className="flex-1 flex flex-col items-center justify-end h-full group">
                  <div className="text-[10px] text-text-secondary mb-1 opacity-0 group-hover:opacity-100 transition-base">{Math.round(u)}</div>
                  <div className="w-full rounded-t transition-base"
                    style={{ height: `${Math.max(1, pct)}%`, backgroundColor: barColor }} title={`${h}h · ${Math.round(u)} platos`} />
                  <span className="text-[9px] text-text-secondary mt-1">{h}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[11px] text-text-secondary">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#639922' }} /> Carga baja</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#EF9F27' }} /> Media</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#E24B4A' }} /> Hora punta</span>
          </div>
          <p className="text-[11px] text-text-secondary mt-3">
            La curva es la forma horaria de las últimas semanas (excluye bebidas y postres), escalada al total previsto del día (previsión ajustada = base del local × día de la semana × mes × tendencia). Clima y eventos aún no entran (hacen falta 20-30 locales para calibrarlos). Úsalo para poner más gente donde se concentra la carga.
          </p>
        </div>
      </div>
    </div>
  )
}

/* =====================================================
   Modal: gestión de áreas/roles del personal
   ===================================================== */

function RolesModal({ accountId, roles, onClose, onChanged }: {
  accountId: string
  roles: StaffRole[]
  onClose: () => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<StaffRole[]>(roles)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const KINDS: { v: RoleKind; label: string }[] = [
    { v: 'cocina', label: 'Cocina (produce platos)' },
    { v: 'servicio', label: 'Servicio (sala/barra)' },
    { v: 'reparto', label: 'Reparto' },
    { v: 'otro', label: 'Otro' },
  ]

  async function patch(r: StaffRole, changes: Partial<StaffRole>) {
    setItems(prev => prev.map(x => x.id === r.id ? { ...x, ...changes } : x))
    await upsertStaffRole(accountId, { ...r, ...changes })
    onChanged()
  }
  async function addRole() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const created = await upsertStaffRole(accountId, { name, color: 'gray', kind: 'otro', sort: items.length + 1 })
    setBusy(false)
    if (created) { setItems(prev => [...prev, created]); setNewName(''); onChanged() }
  }
  async function remove(r: StaffRole) {
    if (!confirm(`¿Eliminar el área "${r.name}"? Los empleados que la tengan quedarán sin color hasta reasignarlos.`)) return
    setItems(prev => prev.filter(x => x.id !== r.id))
    await deleteStaffRole(r.id)
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border-default w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-text-primary">Áreas del personal</h3>
            <p className="text-xs text-text-secondary mt-0.5">Dan color a los turnos y dicen a la IA qué área produce platos. Cada negocio las ajusta.</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-2">
          {items.map(r => {
            const c = roleColor(r.color)
            return (
              <div key={r.id} className="flex items-center gap-2 border border-border-default rounded-lg p-2">
                <span className={`w-4 h-4 rounded-full shrink-0 ${c.dot}`} />
                <input value={r.name} onChange={e => setItems(prev => prev.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))}
                  onBlur={e => patch(r, { name: e.target.value.trim() || r.name })}
                  className="flex-1 min-w-0 bg-transparent text-sm text-text-primary border-b border-transparent focus:border-border-default outline-none" />
                <select value={r.color} onChange={e => patch(r, { color: e.target.value })}
                  className="text-xs border border-border-default rounded px-1 py-1 bg-card">
                  {ROLE_COLOR_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <select value={r.kind} onChange={e => patch(r, { kind: e.target.value as RoleKind })}
                  className="text-xs border border-border-default rounded px-1 py-1 bg-card max-w-[130px]">
                  {KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
                </select>
                <button onClick={() => remove(r)} className="text-danger hover:opacity-70 shrink-0" title="Eliminar área"><X size={15} /></button>
              </div>
            )
          })}
          {items.length === 0 && <p className="text-sm text-text-secondary text-center py-4">No hay áreas. Añade la primera abajo.</p>}
        </div>

        <div className="p-4 border-t border-border-default flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRole() }}
            placeholder="Nueva área (ej. Terraza, Pisos…)"
            className="flex-1 border border-border-default rounded-lg px-3 py-2 text-sm bg-card" />
          <button onClick={addRole} disabled={busy || !newName.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium disabled:opacity-40">
            <Plus size={14} className="inline mr-1" />Añadir
          </button>
        </div>
      </div>
    </div>
  )
}

/* =====================================================
   Celda de la matriz
   ===================================================== */

interface CellProps {
  template: ShiftTemplate
  day: DayOfWeek
  needed: number
  baseCoverage: number
  isOverridden: boolean
  assignedIds: string[]
  allEmployees: Employee[]
  workloads: EmployeeWorkload[]
  onChangeAssigned: (ids: string[]) => void
  onChangeNeeded: (v: number) => void
}

function Cell({
  template, day, needed, baseCoverage, isOverridden,
  assignedIds, allEmployees, workloads,
  onChangeAssigned, onChangeNeeded,
}: CellProps) {
  const [open, setOpen] = useState(false)
  const empById = useMemo(() => new Map(allEmployees.map(e => [e.id, e])), [allEmployees])
  const wlById = useMemo(() => new Map(workloads.map(w => [w.employee_id, w])), [workloads])
  const isWeekend = day === 4 || day === 5 || day === 6
  const isGap = needed > 0 && assignedIds.length < needed
  const isOverFilled = assignedIds.length > needed

  let bg = 'bg-card'
  if (needed === 0) bg = 'bg-page'
  else if (isGap) bg = 'bg-danger-bg'
  else if (isOverFilled) bg = 'bg-warning-bg'
  else if (isWeekend) bg = 'bg-warning-bg/30'

  function removeAt(idx: number) {
    onChangeAssigned(assignedIds.filter((_, i) => i !== idx))
  }
  function addEmployee(id: string) {
    if (!assignedIds.includes(id)) onChangeAssigned([...assignedIds, id])
    setOpen(false)
  }

  const availableToAdd = allEmployees.filter(e => !assignedIds.includes(e.id))

  return (
    <td className={`px-1 py-1 align-top border-l ${bg}`}>
      <div className="flex items-center justify-between gap-1 mb-1 px-1">
        <div className="text-[10px] text-text-secondary flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={9}
            value={needed}
            onChange={(e) => onChangeNeeded(Math.max(0, parseInt(e.target.value || '0', 10)))}
            className={`w-9 border rounded px-1 text-[10px] text-center ${
              isOverridden ? 'bg-accent-bg border-accent/30' : 'bg-card'
            }`}
            title={isOverridden ? `Override (base: ${baseCoverage})` : 'Personas necesarias'}
          />
          <span className="text-text-secondary">×</span>
        </div>
        {isGap && (
          <span className="text-danger" title="Hueco sin cubrir">
            <AlertTriangle size={11} />
          </span>
        )}
      </div>

      <div className="space-y-1 px-1 pb-1 min-h-[40px]">
        {assignedIds.map((id, i) => {
          const emp = empById.get(id)
          const wl = wlById.get(id)
          const code = emp?.shiftCode || emp?.name?.slice(0, 3).toUpperCase() || '?'
          const exceedsContract = wl && wl.assigned_hours > wl.contracted_hours * 1.10
          return (
            <div
              key={`${id}-${i}`}
              className={`group flex items-center justify-between gap-1 rounded px-1.5 py-0.5 cursor-default ${
                exceedsContract ? 'bg-danger-bg text-danger' : 'bg-accent-bg text-accent'
              }`}
              title={emp?.name || ''}
            >
              <span className="text-xs font-bold">{code}</span>
              <button
                onClick={() => removeAt(i)}
                className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-danger transition-base"
                title="Quitar"
              >
                <X size={10} />
              </button>
            </div>
          )
        })}

        {needed > 0 && (
          <div className="relative">
            <button
              onClick={() => setOpen(o => !o)}
              className="inline-flex items-center justify-center gap-1 w-full text-[10px] text-text-secondary hover:text-accent py-0.5 border border-dashed border-border-default rounded hover:border-accent transition-base"
            >
              <Plus size={10} /> asignar
            </button>
            {open && (
              <div className="absolute z-30 mt-1 left-0 right-0 bg-card border rounded shadow-lg max-h-48 overflow-y-auto">
                {availableToAdd.length === 0 ? (
                  <div className="px-2 py-1 text-[10px] text-text-secondary">Todos asignados</div>
                ) : availableToAdd.map(e => {
                  const wl = wlById.get(e.id)
                  const newH = (wl?.assigned_hours || 0) + shiftDurationHours(template.start_time, template.end_time)
                  const max = (e.weeklyHours || 40) * 1.10
                  const overflow = newH > max
                  return (
                    <button
                      key={e.id}
                      onClick={() => addEmployee(e.id)}
                      className={`w-full text-left px-2 py-1 text-xs hover:bg-page flex items-center justify-between ${overflow ? 'text-danger' : ''}`}
                    >
                      <span>
                        <span className="font-bold mr-1">{e.shiftCode || '–'}</span>
                        {e.name}
                      </span>
                      <span className={`inline-flex items-center gap-0.5 text-[10px] ${overflow ? 'text-danger font-bold' : 'text-text-secondary'}`}>
                        {newH.toFixed(1)}h{overflow && <AlertTriangle size={9} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </td>
  )
}

/* =====================================================
   Panel de huecos sin cubrir
   ===================================================== */

interface UncoveredPanelProps {
  uncovered: UncoveredSlot[]
  templates: ShiftTemplate[]
  onClickGap: (g: UncoveredSlot) => void
}

function UncoveredPanel({ uncovered, templates, onClickGap }: UncoveredPanelProps) {
  const tById = new Map(templates.map(t => [t.id, t]))
  const totalGap = uncovered.reduce((acc, u) => {
    const t = tById.get(u.template_id)
    const h = t ? shiftDurationHours(t.start_time, t.end_time) : 0
    return acc + (u.needed - u.assigned) * h
  }, 0)

  return (
    <div className="bg-danger-bg border border-danger/30 rounded-lg p-4">
      <h3 className="font-display font-semibold text-danger mb-2 inline-flex items-center gap-1.5">
        <AlertTriangle size={16} /> {uncovered.length} hueco(s) sin cubrir · {totalGap.toFixed(1)}h en total
      </h3>
      <p className="text-xs text-danger mb-3">
        Pulsa un hueco para ver sugerencias de cobertura.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {uncovered.map((u, i) => {
          const t = tById.get(u.template_id)
          if (!t) return null
          return (
            <button
              key={i}
              onClick={() => onClickGap(u)}
              className="text-left bg-card border border-red-300 hover:bg-danger-bg rounded p-2 text-sm"
            >
              <div className="font-medium">{DAY_LABELS[u.day_of_week]} · {t.label}</div>
              <div className="text-xs text-text-secondary">
                {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)} ·
                {' '}faltan {u.needed - u.assigned} de {u.needed} ·
                {' '}{shiftDurationHours(t.start_time, t.end_time)}h
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* =====================================================
   Modal de sugerencias para un hueco
   ===================================================== */

interface SuggestionsModalProps {
  gap: UncoveredSlot
  template: ShiftTemplate
  weekStart: string
  cells: ScheduleCells
  employees: Employee[]
  onClose: () => void
  onApply: (empId: string) => void
}

function SuggestionsModal({ gap, template, weekStart, cells, employees, onClose, onApply }: SuggestionsModalProps) {
  const suggestions: FillSuggestion[] = useMemo(
    () => suggestFillForGap({ gap, template, weekStart, cells, employees }),
    [gap, template, weekStart, cells, employees]
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border-default bg-accent text-text-on-accent">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Cubrir hueco — {DAY_LABELS[gap.day_of_week]}</div>
              <div className="text-xs opacity-90">
                {template.label} · {template.start_time.slice(0, 5)}–{template.end_time.slice(0, 5)} ·
                {' '}{shiftDurationHours(template.start_time, template.end_time)}h
              </div>
            </div>
            <button onClick={onClose} className="text-text-on-accent/80 hover:text-text-on-accent">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-2">
          {suggestions.length === 0 && (
            <p className="text-sm text-text-secondary">No hay sugerencias disponibles.</p>
          )}
          {suggestions.map((s) => {
            const blocked = !!s.blockedReason
            const exceeds = s.exceedsTolerance
            return (
              <div
                key={s.employeeId}
                className={`border rounded-lg p-3 flex items-center justify-between gap-3 ${
                  blocked ? 'bg-page border-border-default opacity-60' : exceeds ? 'bg-warning-bg border-warning/30' : 'bg-card border-border-default'
                }`}
              >
                <div className="flex-1">
                  <div className="text-sm text-text-primary">
                    <span className="font-bold mr-2 text-accent">
                      {s.shiftCode || '–'}
                    </span>
                    {s.employeeName}
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">
                    Pasaría de <strong>{s.currentHours}h</strong> a <strong>{s.newHours}h</strong>
                    {' '}(contratadas {s.contractedHours}h, {s.deltaPercent > 0 ? '+' : ''}{s.deltaPercent}%)
                  </div>
                  {blocked && (
                    <div className="text-xs text-danger mt-1 inline-flex items-center gap-1">
                      <AlertTriangle size={11} /> {s.blockedReason}
                    </div>
                  )}
                  {!blocked && exceeds && (
                    <div className="text-xs text-warning mt-1 inline-flex items-center gap-1">
                      <AlertTriangle size={11} /> Excede tope del 10% sobre contratadas
                    </div>
                  )}
                </div>
                <button
                  disabled={blocked}
                  onClick={() => onApply(s.employeeId)}
                  className={`px-3 py-1.5 rounded text-text-on-accent text-sm font-medium disabled:opacity-30 transition-base ${
                    exceeds ? 'bg-warning hover:opacity-90' : 'bg-accent hover:bg-accent-hover'
                  }`}
                >
                  Asignar
                </button>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-border-default bg-page flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border-default rounded bg-card text-text-primary hover:bg-page transition-base">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}


/* =====================================================
   Modal: Copiar horario a otras semanas
   ===================================================== */

type CopyMode = 'next' | 'month' | 'n'

function monthOfISO(iso: string): number {
  return Number(iso.split('-')[1])
}

function fmtShortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

interface CopyScheduleModalProps {
  locationId: string
  sourceWeekStart: string
  onClose: () => void
  onDone: () => void
}

function CopyScheduleModal({ locationId, sourceWeekStart, onClose, onDone }: CopyScheduleModalProps) {
  const [mode, setMode] = useState<CopyMode>('next')
  const [nWeeks, setNWeeks] = useState(4)
  const [removeVac, setRemoveVac] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CopyScheduleResult | null>(null)

  const targets = useMemo<string[]>(() => {
    if (mode === 'next') return [addDays(sourceWeekStart, 7)]
    if (mode === 'n') {
      const out: string[] = []
      for (let i = 1; i <= nWeeks; i++) out.push(addDays(sourceWeekStart, 7 * i))
      return out
    }
    // resto del mes: semanas siguientes cuyo lunes cae en el mes de la semana origen
    const out: string[] = []
    const srcMonth = monthOfISO(sourceWeekStart)
    let wk = addDays(sourceWeekStart, 7)
    for (let i = 0; i < 6 && monthOfISO(wk) === srcMonth; i++) {
      out.push(wk)
      wk = addDays(wk, 7)
    }
    return out
  }, [mode, nWeeks, sourceWeekStart])

  const rangeLabel = targets.length > 0
    ? `${fmtShortDay(targets[0])} – ${fmtShortDay(addDays(targets[targets.length - 1], 6))}`
    : '—'

  async function run() {
    if (targets.length === 0) return
    setRunning(true)
    const res = await copyScheduleToWeeks(locationId, sourceWeekStart, targets, {
      skipPublished: true,
      removeApprovedVacations: removeVac,
    })
    setResult(res)
    setRunning(false)
  }

  function finish() {
    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl max-w-md w-full p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-accent inline-flex items-center gap-1.5">
            <Copy size={16} /> Copiar este horario
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {!result ? (
          <>
            <p className="text-xs text-text-secondary mb-3">
              Copia los turnos de esta semana a futuras semanas <strong>como borrador</strong>.
              Las semanas ya publicadas se omiten; las que estén en borrador se sobrescriben.
            </p>

            <div className="space-y-2 mb-3">
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input type="radio" name="copymode" checked={mode === 'next'} onChange={() => setMode('next')} className="accent-accent" />
                A la semana siguiente
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input type="radio" name="copymode" checked={mode === 'month'} onChange={() => setMode('month')} className="accent-accent" />
                Al resto del mes
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input type="radio" name="copymode" checked={mode === 'n'} onChange={() => setMode('n')} className="accent-accent" />
                A las próximas
                <select
                  value={nWeeks}
                  onChange={e => { setNWeeks(Number(e.target.value)); setMode('n') }}
                  className="border border-border-default rounded px-2 py-1 text-sm bg-card"
                >
                  {[2, 3, 4, 6, 8, 13].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                semanas
              </label>
            </div>

            <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer bg-page rounded-lg p-2.5 mb-3">
              <input type="checkbox" checked={removeVac} onChange={e => setRemoveVac(e.target.checked)} className="mt-0.5 accent-accent" />
              <span>
                Quitar a quien tenga <strong>vacaciones aprobadas</strong> en cada día
                <span className="block text-[11px] text-text-secondary">Deja el hueco sin cubrir para que lo asignes a otra persona.</span>
              </span>
            </label>

            <div className="text-xs text-text-secondary mb-4">
              {targets.length === 0
                ? 'No hay semanas destino en este rango.'
                : <>Se copiará a <strong>{targets.length}</strong> semana{targets.length !== 1 ? 's' : ''} ({rangeLabel}).</>}
            </div>

            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-border-default rounded bg-card text-text-primary hover:bg-page transition-base">
                Cancelar
              </button>
              <button
                onClick={run}
                disabled={running || targets.length === 0}
                className="flex-1 px-4 py-2 text-sm rounded bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-40 transition-base"
              >
                {running ? 'Copiando…' : 'Copiar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-page rounded-lg p-3 mb-4 text-sm text-text-primary space-y-1">
              <p><strong className="text-success">{result.copied.length}</strong> semana{result.copied.length !== 1 ? 's' : ''} copiada{result.copied.length !== 1 ? 's' : ''} como borrador.</p>
              {result.skipped.length > 0 && (
                <p><strong className="text-warning">{result.skipped.length}</strong> omitida{result.skipped.length !== 1 ? 's' : ''} por estar ya publicada{result.skipped.length !== 1 ? 's' : ''}.</p>
              )}
              {result.removedForVacation > 0 && (
                <p><strong>{result.removedForVacation}</strong> asignación{result.removedForVacation !== 1 ? 'es' : ''} quitada{result.removedForVacation !== 1 ? 's' : ''} por vacaciones aprobadas.</p>
              )}
            </div>
            <button onClick={finish} className="w-full px-4 py-2 text-sm rounded bg-accent text-text-on-accent font-medium hover:bg-accent-hover transition-base">
              Hecho
            </button>
          </>
        )}
      </div>
    </div>
  )
}
