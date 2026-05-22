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
  Wand2, Save, Check, Megaphone, ChevronLeft, ChevronRight, X, Plus,
  Users, AlertTriangle, CalendarDays,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  listShiftTemplates,
  getSchedule,
  upsertSchedule,
  publishSchedule,
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

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

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
  const { locations, staff } = useApp()
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
  const [issuesShown, setIssuesShown] = useState(false)

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
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, weekStart])

  const workloads = useMemo<EmployeeWorkload[]>(
    () => computeWorkloads(cells, templates, employees),
    [cells, templates, employees]
  )

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
      </div>

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

      {templates.length > 0 && (
        <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-accent text-text-on-accent">
              <tr>
                <th className="px-3 py-2 text-left">Turno</th>
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
                    <td className="px-3 py-2 align-top">
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
      )}

      {employees.length > 0 && templates.length > 0 && (
        <WorkloadSummary workloads={workloads} />
      )}

      {employees.length > 0 && templates.length > 0 && (
        <EmployeeSchedules
          employees={employees}
          templates={templates}
          cells={cells}
          weekStart={weekStart}
        />
      )}

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
   Resumen de carga por empleado
   ===================================================== */

function WorkloadSummary({ workloads }: { workloads: EmployeeWorkload[] }) {
  return (
    <div className="bg-card border border-border-default rounded-lg p-4">
      <h3 className="font-display font-semibold mb-3 text-accent inline-flex items-center gap-1.5">
        <Users size={16} /> Carga por empleado
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {workloads.map(w => {
          const pct = w.contracted_hours > 0 ? (w.assigned_hours / w.contracted_hours) * 100 : 0
          const exceedsTol = w.assigned_hours > w.contracted_hours * 1.10
          const underContract = w.assigned_hours < w.contracted_hours - 0.5
          let barColor = 'bg-success'
          if (exceedsTol) barColor = 'bg-danger'
          else if (underContract) barColor = 'bg-warning'
          else if (pct > 100) barColor = 'bg-warning'
          const widthPct = Math.min(100, pct)
          return (
            <div key={w.employee_id} className="border border-border-default rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="font-bold text-sm text-accent">
                    {w.shift_code || '–'}
                  </span>
                  <span className="ml-2 text-sm text-text-primary">{w.employee_name}</span>
                </div>
                <span className={`text-xs font-mono ${exceedsTol ? 'text-danger font-bold' : 'text-text-secondary'}`}>
                  {w.assigned_hours.toFixed(2)} / {w.contracted_hours}h
                </span>
              </div>
              <div className="h-2 bg-accent-bg rounded-full overflow-hidden">
                <div className={`h-full ${barColor}`} style={{ width: `${widthPct}%` }} />
              </div>
              <div className="text-[10px] text-text-secondary mt-1">
                {w.delta > 0 ? '+' : ''}{w.delta.toFixed(2)}h vs contrato
                {exceedsTol && <span className="ml-2 text-danger font-bold">excede tope 10%</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
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
   Horario individualizado por empleado
   ===================================================== */

interface EmployeeSchedulesProps {
  employees: Employee[]
  templates: ShiftTemplate[]
  cells: ScheduleCells
  weekStart: string
}

interface EmpDayShift {
  templateId: string
  label: string
  start: string
  end: string
  hours: number
  crossesMidnight: boolean
}

function EmployeeSchedules({ employees, templates, cells }: EmployeeSchedulesProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const tplById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates])

  const detailByEmp = useMemo(() => {
    const map = new Map<string, { shifts: Record<string, EmpDayShift[]>; total: number }>()
    for (const emp of employees) {
      const shifts: Record<string, EmpDayShift[]> = {}
      let total = 0
      for (const tid of Object.keys(cells)) {
        const t = tplById.get(tid)
        if (!t) continue
        for (const dk of Object.keys(cells[tid])) {
          if (!cells[tid][dk].includes(emp.id)) continue
          const start = t.start_time.slice(0, 5)
          const end = t.end_time.slice(0, 5)
          const [sh, sm] = start.split(':').map(Number)
          const [eh, em] = end.split(':').map(Number)
          const crossesMidnight = (eh * 60 + em) <= (sh * 60 + sm)
          const hours = shiftDurationHours(start, end)
          if (!shifts[dk]) shifts[dk] = []
          shifts[dk].push({ templateId: tid, label: t.label, start, end, hours, crossesMidnight })
          total += hours
        }
      }
      for (const k of Object.keys(shifts)) {
        shifts[k].sort((a, b) => a.start.localeCompare(b.start))
      }
      map.set(emp.id, { shifts, total: Math.round(total * 100) / 100 })
    }
    return map
  }, [employees, cells, tplById])

  return (
    <div className="bg-card border border-border-default rounded-lg p-4">
      <h3 className="font-display font-semibold mb-3 text-accent inline-flex items-center gap-1.5">
        <CalendarDays size={16} /> Horario por empleado
      </h3>
      <div className="space-y-2">
        {employees.map(emp => {
          const detail = detailByEmp.get(emp.id) || { shifts: {}, total: 0 }
          const isOpen = openId === emp.id
          const contracted = emp.weeklyHours || 40
          const delta = detail.total - contracted
          const exceeds = detail.total > contracted * 1.10
          return (
            <div key={emp.id} className="border border-border-default rounded-lg">
              <button
                onClick={() => setOpenId(isOpen ? null : emp.id)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-page transition-base"
              >
                <div className="flex items-center gap-3">
                  {isOpen
                    ? <ChevronLeft size={14} className="text-text-secondary rotate-[-90deg]" />
                    : <ChevronRight size={14} className="text-text-secondary" />}
                  <span className="font-bold text-sm text-accent">
                    {emp.shiftCode || '–'}
                  </span>
                  <span className="text-sm text-text-primary">{emp.name}</span>
                  {emp.shiftPeriod && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-text-secondary">
                      {emp.shiftPeriod === 'manana' ? 'mañanas' : emp.shiftPeriod === 'tarde' ? 'tardes' : 'partido'}
                    </span>
                  )}
                  {emp.restPattern && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-accent">
                      libra: {humanRestPattern(emp.restPattern)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono ${exceeds ? 'text-danger font-bold' : 'text-text-secondary'}`}>
                    {detail.total.toFixed(2)} / {contracted}h
                  </span>
                  <span className={`text-[10px] ${exceeds ? 'text-danger' : delta < -0.5 ? 'text-warning' : 'text-success'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(2)}h
                  </span>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border-default p-3 grid grid-cols-1 md:grid-cols-7 gap-2">
                  {[0, 1, 2, 3, 4, 5, 6].map(d => {
                    const dk = String(d)
                    const list = detail.shifts[dk] || []
                    const dayTotal = list.reduce((acc, s) => acc + s.hours, 0)
                    return (
                      <div key={d} className="border border-border-default rounded p-2 text-xs">
                        <div className="font-semibold mb-1 flex items-center justify-between text-text-primary">
                          <span>{DAY_LABELS_SHORT[d as DayOfWeek]}</span>
                          {list.length > 0 && (
                            <span className="text-[10px] text-text-secondary font-mono">{dayTotal.toFixed(2)}h</span>
                          )}
                        </div>
                        {list.length === 0 ? (
                          <div className="text-[10px] text-text-secondary italic">Libre</div>
                        ) : (
                          <div className="space-y-1">
                            {list.map((s, i) => (
                              <div key={i} className="bg-accent-bg rounded px-1.5 py-1">
                                <div className="font-mono text-[10px] text-accent">
                                  {s.start}–{s.end}
                                  {s.crossesMidnight && <span className="ml-1 text-text-secondary">+1d</span>}
                                </div>
                                <div className="text-[9px] text-text-secondary">{s.label}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function humanRestPattern(p: string): string {
  const [d, kind] = p.split(':')
  const dayMap: Record<string, string> = { lun: 'Lun', mar: 'Mar', mie: 'Mié' }
  const nextMap: Record<string, string> = { lun: 'Mar', mar: 'Mié', mie: 'Jue' }
  const d1 = dayMap[d] || d
  const d2 = nextMap[d] || ''
  if (kind === 'tarde_dia') return `${d1} tarde + ${d2} día`
  if (kind === 'dia_manana') return `${d1} día + ${d2} mañana`
  return p
}
