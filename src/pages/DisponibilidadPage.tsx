// src/pages/DisponibilidadPage.tsx
// F10 — Disponibilidad: propuesta inferida del historial real (564
// asignaciones, ver ENCARGO_CODE_F10_generador_cuadrantes.md) + edición
// manual. Tabla empleado × día × (mañana/noche). "Aplicar lo de confianza
// alta" escribe en employee_availability (apply_inferred_availability) sin
// pisar lo que el encargado ya haya puesto a mano, salvo que marque
// sobrescribir. Editar una celda a mano tampoco se pisa después: se guarda
// con note=null y la RPC de aplicar la respeta (ver AVISOS del encargo).
//
// Recomendado, no obligatorio (decisión firme de Julio): esto alimenta al
// generador de cuadrante (F10, botón "Proponer cuadrante" en Calendario)
// como preferencia BLANDA — el solver puede romperla si hace falta cubrir
// el servicio, pero siempre avisando en ámbar con el motivo.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, XCircle, HelpCircle, Sparkles, RefreshCw, Info, RotateCcw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useActiveAccount } from '../modules/multitenancy/hooks/useActiveAccount'
import { usePermissions } from '../modules/multitenancy/hooks/usePermissions'
import { Card, Button } from '../components/ui'
import {
  fetchInferredAvailability, applyInferredAvailability,
  type InferredAvailabilityRow, type Confianza,
} from '../services/availabilityInferenceService'
import { listAvailabilityForLocation, setAvailability, clearUnavailable } from '../services/schedulerService'
import type { EmployeeAvailability, DayOfWeek, ShiftPeriod } from '../types/scheduler'
import { DAY_LABELS } from '../types/scheduler'

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]
const PERIODS: ShiftPeriod[] = ['morning', 'evening']
const PERIOD_LABEL: Record<ShiftPeriod, string> = { morning: 'Mañana', evening: 'Noche', any: 'Cualquiera' }

interface CellState {
  available: boolean
  motivo: string
  /** true = fila escrita a mano (o inferida-y-aplicada) en employee_availability. false = solo sugerencia sin aplicar. */
  hasRow: boolean
  isManual: boolean
  confianza: Confianza | null
}

function keyOf(employeeId: string, day: DayOfWeek, period: ShiftPeriod) {
  return `${employeeId}:${day}:${period}`
}

export default function DisponibilidadPage() {
  const { staff, locations } = useApp()
  const { activeAccountId } = useActiveAccount()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission('can_edit_schedule')

  const [locationId, setLocationId] = useState('')
  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id)
  }, [locations, locationId])

  const employees = useMemo(
    () => staff.filter(e => e.active && (e.locationId === locationId || (e.assignedLocations || []).includes(locationId))),
    [staff, locationId]
  )

  const [proposal, setProposal] = useState<InferredAvailabilityRow[]>([])
  const [manualRows, setManualRows] = useState<EmployeeAvailability[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [applyResult, setApplyResult] = useState<number | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function load() {
    if (!activeAccountId || !locationId) return
    setLoading(true)
    setLoadError(null)
    try {
      const empIds = employees.map(e => e.id)
      const [prop, manual] = await Promise.all([
        fetchInferredAvailability(activeAccountId, locationId),
        listAvailabilityForLocation(empIds),
      ])
      setProposal(prop)
      setManualRows(manual)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'No se pudo cargar la disponibilidad.')
    } finally {
      setLoading(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [activeAccountId, locationId, staff])

  const manualByKey = useMemo(() => {
    const m = new Map<string, EmployeeAvailability>()
    for (const r of manualRows) m.set(keyOf(r.employee_id, r.day_of_week, r.shift_period), r)
    return m
  }, [manualRows])

  const proposalByKey = useMemo(() => {
    const m = new Map<string, InferredAvailabilityRow>()
    for (const r of proposal) m.set(keyOf(r.employeeId, r.dayOfWeek, r.shiftPeriod), r)
    return m
  }, [proposal])

  const confianzaCounts = useMemo(() => {
    const c = { alta: 0, media: 0, baja: 0 }
    for (const r of proposal) c[r.confianza]++
    return c
  }, [proposal])

  function cellState(employeeId: string, day: DayOfWeek, period: ShiftPeriod): CellState {
    const key = keyOf(employeeId, day, period)
    const manual = manualByKey.get(key)
    if (manual) {
      const isManual = !manual.note || !manual.note.startsWith('Inferido')
      return { available: manual.available, motivo: manual.note || (isManual ? 'Puesto a mano' : ''), hasRow: true, isManual, confianza: isManual ? null : 'alta' }
    }
    const prop = proposalByKey.get(key)
    if (prop) {
      return { available: prop.sugerencia, motivo: prop.motivo, hasRow: false, isManual: false, confianza: prop.confianza }
    }
    return { available: true, motivo: 'Sin historial suficiente para proponer nada.', hasRow: false, isManual: false, confianza: null }
  }

  async function toggleCell(employeeId: string, day: DayOfWeek, period: ShiftPeriod) {
    if (!canEdit || !activeAccountId) return
    const state = cellState(employeeId, day, period)
    const key = keyOf(employeeId, day, period)
    setSavingKey(key)
    const ok = await setAvailability(activeAccountId, employeeId, day, period, !state.available, null)
    if (ok) {
      setManualRows(prev => {
        const next = prev.filter(r => keyOf(r.employee_id, r.day_of_week, r.shift_period) !== key)
        next.push({ id: key, employee_id: employeeId, day_of_week: day, shift_period: period, available: !state.available, note: undefined })
        return next
      })
    }
    setSavingKey(null)
  }

  async function resetCell(employeeId: string, day: DayOfWeek, period: ShiftPeriod) {
    if (!canEdit) return
    const key = keyOf(employeeId, day, period)
    setSavingKey(key)
    const ok = await clearUnavailable(employeeId, day, period)
    if (ok) {
      setManualRows(prev => prev.filter(r => keyOf(r.employee_id, r.day_of_week, r.shift_period) !== key))
    }
    setSavingKey(null)
  }

  async function handleApply() {
    if (!activeAccountId || !canEdit) return
    setApplying(true)
    setApplyError(null)
    setApplyResult(null)
    try {
      const count = await applyInferredAvailability(activeAccountId, locationId, overwrite)
      setApplyResult(count)
      await load()
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'No se pudo aplicar.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl text-accent">Disponibilidad</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Propuesta inferida del historial real de turnos — no un formulario en blanco. Recomendado, no obligatorio:
          el generador de cuadrante puede saltársela si hace falta cubrir el servicio, pero siempre avisando.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border-default rounded-lg p-3">
        <select
          value={locationId}
          onChange={e => setLocationId(e.target.value)}
          className="border border-border-default rounded px-3 py-2 bg-card text-sm"
        >
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-text-secondary">
            {confianzaCounts.alta} patrones claros · {confianzaCounts.media + confianzaCounts.baja} con poco historial
          </span>
          {canEdit && (
            <>
              <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-accent" />
                Sobrescribir también lo editado a mano
              </label>
              <Button size="sm" onClick={handleApply} disabled={applying || loading || confianzaCounts.alta === 0}>
                <span className="inline-flex items-center gap-1.5">
                  {applying ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Aplicar lo de confianza alta
                </span>
              </Button>
            </>
          )}
        </div>
      </div>

      {applyResult !== null && (
        <div className="px-4 py-2 rounded-lg bg-success-bg border border-success/30 text-sm text-success">
          {applyResult} fila{applyResult === 1 ? '' : 's'} aplicada{applyResult === 1 ? '' : 's'} en employee_availability.
        </div>
      )}
      {applyError && (
        <div className="px-4 py-2 rounded-lg bg-danger-bg border border-danger/30 text-sm text-danger">{applyError}</div>
      )}
      {loadError && (
        <div className="px-4 py-2 rounded-lg bg-danger-bg border border-danger/30 text-sm text-danger">{loadError}</div>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Cargando disponibilidad…</Card>
      ) : employees.length === 0 ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Sin empleados activos en este local.</Card>
      ) : (
        <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary sticky left-0 bg-page z-10 border-b border-border-default">Empleado</th>
                {DAYS.map(d => (
                  <th key={d} colSpan={2} className="px-1 py-1 text-center text-xs font-semibold text-text-secondary border-b border-l border-border-default bg-page">
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 bg-page z-10 border-b border-border-default" />
                {DAYS.map(d => (
                  <Fragment key={d}>
                    <th className="px-1 py-1 text-center text-[10px] font-medium text-text-tertiary border-b border-l border-border-default bg-page">M</th>
                    <th className="px-1 py-1 text-center text-[10px] font-medium text-text-tertiary border-b border-border-default bg-page">N</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-b border-border-default last:border-0">
                  <td className="px-3 py-1.5 sticky left-0 bg-card z-10 border-r border-border-default">
                    <span className="text-sm font-medium text-text-primary truncate block max-w-[160px]">{emp.name}</span>
                  </td>
                  {DAYS.map(d => (
                    <Fragment key={d}>
                      {PERIODS.map((p, pi) => {
                        const st = cellState(emp.id, d, p)
                        const key = keyOf(emp.id, d, p)
                        const saving = savingKey === key
                        const base = st.available
                          ? { Icon: CheckCircle2, solidCls: 'text-success bg-success-bg', softCls: 'text-success/70' }
                          : { Icon: XCircle, solidCls: 'text-danger bg-danger-bg', softCls: 'text-danger/70' }
                        const opacity = !st.hasRow && st.confianza === 'baja' ? 'opacity-40'
                          : !st.hasRow && st.confianza === 'media' ? 'opacity-70' : 'opacity-100'
                        const dashed = !st.hasRow ? 'border border-dashed border-current' : ''
                        const title = `${emp.name} · ${DAY_LABELS[d]} ${PERIOD_LABEL[p]}: ${st.available ? 'disponible' : 'no disponible'}${
                          st.hasRow ? (st.isManual ? ' (puesto a mano)' : ' (aplicado del historial)') : ' (sugerencia, sin aplicar)'
                        }\n${st.motivo}`
                        return (
                          <td key={`${d}-${p}`} className={`px-0.5 py-0.5 text-center ${pi === 0 ? 'border-l border-border-default' : ''}`}>
                            <div className="relative inline-block group">
                              <button
                                type="button"
                                title={title}
                                disabled={!canEdit || saving}
                                onClick={() => toggleCell(emp.id, d, p)}
                                className={`w-6 h-6 rounded flex items-center justify-center transition-base ${st.hasRow ? base.solidCls : ''} ${!st.hasRow ? base.softCls : ''} ${opacity} ${dashed} ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
                              >
                                {saving ? <RefreshCw size={12} className="animate-spin" /> : <base.Icon size={13} />}
                              </button>
                              {canEdit && st.hasRow && !saving && (
                                <button
                                  type="button"
                                  title="Quitar (volver a la sugerencia automática)"
                                  onClick={() => resetCell(emp.id, d, p)}
                                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-card border border-border-default text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary flex items-center justify-center transition-base"
                                >
                                  <RotateCcw size={8} />
                                </button>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card className="p-3 text-xs text-text-secondary flex items-start gap-2">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>
          <strong className="text-text-primary">Leyenda:</strong> <CheckCircle2 size={11} className="inline text-success" /> disponible ·{' '}
          <XCircle size={11} className="inline text-danger" /> no disponible · relleno sólido = confirmado (a mano o ya aplicado) · borde punteado = solo sugerencia
          sin aplicar, más tenue cuanta menos confianza · <RotateCcw size={11} className="inline" /> al pasar el ratón quita lo escrito y vuelve a la sugerencia automática.
          {!canEdit && ' Sin permiso de edición de cuadrante: vista de solo lectura.'}
        </span>
      </Card>
      <Card className="p-3 text-xs text-text-secondary flex items-start gap-2">
        <HelpCircle size={13} className="shrink-0 mt-0.5" />
        <span>
          Esta disponibilidad es una preferencia <strong>blanda</strong>: el botón "Proponer cuadrante" de Calendario la respeta
          cuando puede y la rompe cuando hace falta cubrir el servicio — siempre avisando en ámbar con el motivo, nunca en silencio.
        </span>
      </Card>
    </div>
  )
}
