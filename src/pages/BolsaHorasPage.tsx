// src/pages/BolsaHorasPage.tsx
// Vista del gestor: bolsa de horas con sistema híbrido (planificado + fichaje + ausencias)

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Clock, History, Lightbulb, Calendar, AlertTriangle, X, RefreshCw,
  Lock, Download,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  getAllEmployeesBalanceStates,
  closePeriodForLocation,
  resolveClosure,
  getEffectiveCloseDay,
  detectPendingAutoClose,
  executeAutoClose,
  type LocationBalanceConfig,
  type EmployeeBalanceStateExtended,
  type DayAlert,
  type DayAlertType,
} from '../services/hoursBalanceService'
import type { Employee } from '../types'
import type {
  MonthlyBalanceClosure,
  ClosureResolution,
} from '../types/hoursBalance'
import type { Location } from '../types'
import { exportGestoriaCsv } from '../services/exportGestoriaService'

type Tab = 'current' | 'pending' | 'history'

const TAB_LABELS: Record<Tab, string> = {
  current: 'En curso',
  pending: 'Pendientes',
  history: 'Histórico',
}

const TAB_ICONS: Record<Tab, typeof BarChart3> = {
  current: BarChart3,
  pending: Clock,
  history: History,
}

const RESOLUTION_LABELS: Record<ClosureResolution, string> = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  compensado: 'Compensado',
  arrastrado: 'Arrastrado',
  descartado: 'Descartado',
}

const RESOLUTION_COLORS: Record<ClosureResolution, string> = {
  pendiente: 'text-warning bg-warning-bg',
  pagado: 'text-success bg-success-bg',
  compensado: 'text-accent bg-accent-bg',
  arrastrado: 'text-accent bg-accent-bg',
  descartado: 'text-text-secondary bg-accent-bg',
}

const ALERT_LABELS: Record<DayAlertType, string> = {
  sin_fichaje: 'Sin fichaje',
  sin_horario: 'Trabajo sin horario',
  desviacion_grande: 'Desviación >30 min',
}

const ALERT_COLORS: Record<DayAlertType, string> = {
  sin_fichaje: 'text-warning bg-warning-bg border-warning/30',
  sin_horario: 'text-warning bg-warning-bg border-warning/30',
  desviacion_grande: 'text-danger bg-danger-bg border-danger/30',
}

interface AutoCloseDetection {
  shouldClose: boolean
  period: { label: string; start: string; end: string }
  employeesNotClosed: Employee[]
}

export default function BolsaHorasPage() {
  const { staff, locations } = useApp()
  const [locationId, setLocationId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('current')
  const [states, setStates] = useState<EmployeeBalanceStateExtended[]>([])
  const [loading, setLoading] = useState(false)
  const [resolveModal, setResolveModal] = useState<MonthlyBalanceClosure | null>(null)
  const [alertsModal, setAlertsModal] = useState<{ employeeName: string; alerts: DayAlert[] } | null>(null)
  const [autoClose, setAutoClose] = useState<AutoCloseDetection | null>(null)
  const [autoClosing, setAutoClosing] = useState(false)

  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id)
  }, [locations, locationId])

  const currentLocation = useMemo(
    () => locations.find(l => l.id === locationId),
    [locations, locationId]
  )

  const employeesOfLocation = useMemo(
    () => staff.filter(e => e.active && (
      e.locationId === locationId ||
      (e.assignedLocations || []).includes(locationId)
    )),
    [staff, locationId]
  )

  const closeDay = useMemo(() => {
    if (!currentLocation) return 25
    const config: LocationBalanceConfig = {
      closeDay: (currentLocation as any).hoursBalanceCloseDay ?? 25,
      syncWithGestoria: (currentLocation as any).hoursBalanceSyncWithGestoria ?? true,
      gestoriaDay: (currentLocation as any).gestoriaSendDay ?? 25,
    }
    return getEffectiveCloseDay(config)
  }, [currentLocation])

  async function refresh() {
    if (employeesOfLocation.length === 0) {
      setStates([])
      setAutoClose(null)
      return
    }
    setLoading(true)
    try {
      const [result, autoCloseInfo] = await Promise.all([
        getAllEmployeesBalanceStates(employeesOfLocation, closeDay),
        detectPendingAutoClose(locationId, employeesOfLocation, closeDay),
      ])
      setStates(result)
      setAutoClose(autoCloseInfo.shouldClose ? autoCloseInfo : null)
    } catch (e) {
      console.error('[BolsaHoras] Error:', e)
      setStates([])
      setAutoClose(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, closeDay, employeesOfLocation.length])

  const totalPending = states.reduce((acc, s) => acc + s.pendingClosures.length, 0)
  const totalAlerts = states.reduce((acc, s) => acc + s.alerts.length, 0)

  async function handleCloseManual() {
    if (!locationId) return
    if (!confirm(
      `¿Cerrar el periodo actual para todos los empleados de este local?\n\n` +
      `Esto creará un cierre que podrás resolver luego en la pestaña Pendientes.`
    )) return
    setLoading(true)
    const result = await closePeriodForLocation(
      locationId,
      employeesOfLocation,
      closeDay
    )
    setLoading(false)
    alert(
      `✅ Cierres creados: ${result.created.length}\n` +
      `Ya existían: ${result.existing}`
    )
    await refresh()
  }

  async function handleAutoClose() {
    if (!autoClose) return
    if (!confirm(
      `¿Cerrar automáticamente el periodo "${autoClose.period.label}"?\n\n` +
      `Se creará un cierre para ${autoClose.employeesNotClosed.length} empleado(s) ` +
      `que aún no lo tienen. Después podrás resolverlos en la pestaña Pendientes.`
    )) return
    setAutoClosing(true)
    const result = await executeAutoClose(autoClose.employeesNotClosed, closeDay)
    setAutoClosing(false)
    alert(
      `✅ Cierres automáticos creados: ${result.created.length}\n` +
      (result.failed > 0 ? `⚠️ Fallidos: ${result.failed}` : '')
    )
    await refresh()
    setTab('pending')
  }

  return (
    <div className="space-y-4">
      {/* Banner de auto-cierre pendiente */}
      {autoClose && (
        <div className="bg-warning-bg border-2 border-warning/30 rounded-lg p-4 flex items-start gap-4">
          <Calendar size={32} className="text-warning shrink-0" />
          <div className="flex-1">
            <div className="font-bold text-warning mb-1">
              Periodo "{autoClose.period.label}" pendiente de cerrar
            </div>
            <p className="text-sm text-warning">
              El periodo del <strong>{autoClose.period.start}</strong> al <strong>{autoClose.period.end}</strong> ya
              ha terminado pero {autoClose.employeesNotClosed.length === 1
                ? '1 empleado tiene'
                : `${autoClose.employeesNotClosed.length} empleados tienen`} su cierre pendiente.
            </p>
            <p className="text-xs text-warning mt-1">
              Puedes cerrarlo automáticamente ahora y luego decidir cómo resolver cada saldo (pagar / compensar / arrastrar).
            </p>
          </div>
          <button
            onClick={handleAutoClose}
            disabled={autoClosing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-text-on-accent font-medium text-sm shrink-0 disabled:opacity-40 bg-warning hover:opacity-90 transition-base"
          >
            {autoClosing ? 'Cerrando...' : <><Lock size={14} /> Cerrar ahora</>}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-card border border-border-default rounded-lg p-3">
        <select
          value={locationId}
          onChange={e => setLocationId(e.target.value)}
          className="border border-border-default rounded px-3 py-2 bg-card text-text-primary text-sm"
        >
          {locations.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-accent-bg rounded p-1">
          {(['current', 'pending', 'history'] as Tab[]).map(t => {
            const TabIcon = TAB_ICONS[t]
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-sm transition-base ${
                  tab === t
                    ? 'bg-card shadow text-accent font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <TabIcon size={14} /> {TAB_LABELS[t]}
                {t === 'pending' && totalPending > 0 && (
                  <span className="ml-1.5 text-[10px] bg-warning text-text-on-accent px-1.5 py-0.5 rounded-full font-bold">
                    {totalPending}
                  </span>
                )}
                {t === 'current' && totalAlerts > 0 && (
                  <span className="ml-1.5 text-[10px] bg-danger text-text-on-accent px-1.5 py-0.5 rounded-full font-bold">
                    {totalAlerts}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <div className="text-xs text-text-secondary">
          Cierre día <strong>{closeDay}</strong> de cada mes
        </div>

        <button
          onClick={handleCloseManual}
          disabled={loading || !locationId}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded border-2 border-warning text-warning bg-card text-sm font-medium disabled:opacity-40 hover:bg-warning-bg transition-base"
          title="Cerrar el periodo actual ahora"
        >
          <Lock size={14} /> Cerrar periodo
        </button>

        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-text-on-accent text-sm font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
        >
          {loading ? 'Calculando...' : <><RefreshCw size={14} /> Recalcular</>}
        </button>
      </div>

      {/* Contenido por pestaña */}
      {tab === 'current' && (
        <CurrentTab states={states} loading={loading} onShowAlerts={setAlertsModal} />
      )}
      {tab === 'pending' && (
        <PendingTab
          states={states}
          loading={loading}
          onResolve={setResolveModal}
        />
      )}
      {tab === 'history' && (
        <HistoryTab
          states={states}
          loading={loading}
          employees={employeesOfLocation}
          locations={locations}
        />
      )}

      {resolveModal && (
        <ResolveModal
          closure={resolveModal}
          onClose={() => setResolveModal(null)}
          onResolved={async () => {
            setResolveModal(null)
            await refresh()
          }}
        />
      )}

      {alertsModal && (
        <AlertsModal
          employeeName={alertsModal.employeeName}
          alerts={alertsModal.alerts}
          onClose={() => setAlertsModal(null)}
        />
      )}
    </div>
  )
}

/* =====================================================
   PESTAÑA EN CURSO
   ===================================================== */

function CurrentTab({
  states,
  loading,
  onShowAlerts,
}: {
  states: EmployeeBalanceStateExtended[]
  loading: boolean
  onShowAlerts: (data: { employeeName: string; alerts: DayAlert[] }) => void
}) {
  if (loading) return <Skeleton />
  if (states.length === 0) {
    return (
      <div className="bg-card border rounded-lg p-8 text-center text-text-secondary">
        No hay empleados en este local
      </div>
    )
  }
  const allWeeksMissing = new Set<string>()
  for (const s of states) {
    for (const w of s.currentPeriod.weeksWithoutSchedule) allWeeksMissing.add(w)
  }
  return (
    <>
      {allWeeksMissing.size > 0 && (
        <div className="bg-warning-bg border border-warning/30 rounded-lg p-3 mb-3">
          <div className="text-sm font-semibold text-warning mb-1 inline-flex items-center gap-1.5">
            <AlertTriangle size={14} /> {allWeeksMissing.size} semana(s) sin horario publicado en este periodo
          </div>
          <p className="text-xs text-warning">
            Estas semanas no se cuentan en el saldo. Publica los horarios para que el saldo refleje la realidad.
          </p>
        </div>
      )}
      <div className="bg-card border border-border-default rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-accent text-text-on-accent">
            <tr>
              <th className="px-3 py-2 text-left">Empleado</th>
              <th className="px-3 py-2 text-center">Periodo</th>
              <th className="px-3 py-2 text-center w-24">Trabajadas</th>
              <th className="px-3 py-2 text-center w-20">Vacac.</th>
              <th className="px-3 py-2 text-center w-24">Contratadas</th>
              <th className="px-3 py-2 text-center w-24">Saldo</th>
              <th className="px-3 py-2 text-center w-20">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {states.map(s => {
              const cp = s.currentPeriod
              const positive = cp.delta > 0.01
              const negative = cp.delta < -0.01
              const numAlerts = s.alerts.length
              return (
                <tr key={s.employeeId} className="border-b border-border-default hover:bg-page transition-base">
                  <td className="px-3 py-2">
                    <span className="font-bold text-sm text-accent">
                      {s.shiftCode || '–'}
                    </span>
                    <span className="ml-2 text-text-primary">{s.employeeName}</span>
                    <div className="text-[10px] text-text-secondary">
                      Contrato {s.contractedHours}h/sem
                      {s.initialBalance !== 0 && (
                        <span> · Inicial: {s.initialBalance > 0 ? '+' : ''}{s.initialBalance.toFixed(1)}h</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-text-primary">
                    <div className="font-semibold">{cp.periodLabel}</div>
                    <div className="text-[10px] text-text-secondary font-mono">
                      {cp.periodStart} → {cp.periodEnd}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-mono text-text-primary">
                    {cp.scheduledHours.toFixed(2)}h
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-mono text-text-primary">
                    {cp.vacationHours > 0 ? `+${cp.vacationHours.toFixed(2)}h` : '–'}
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-mono text-text-secondary">
                    {cp.contractedHoursPeriod.toFixed(2)}h
                  </td>
                  <td className={`px-3 py-2 text-center font-bold text-sm ${
                    positive ? 'text-success' :
                    negative ? 'text-danger' :
                    'text-text-secondary'
                  }`}>
                    {positive ? '+' : ''}{cp.delta.toFixed(2)}h
                  </td>
                  <td className="px-3 py-2 text-center">
                    {numAlerts > 0 ? (
                      <button
                        onClick={() => onShowAlerts({ employeeName: s.employeeName, alerts: s.alerts })}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-danger-bg text-danger text-xs font-bold hover:opacity-90 transition-base"
                      >
                        <AlertTriangle size={11} /> {numAlerts}
                      </button>
                    ) : (
                      <span className="text-success text-xs">✓</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-text-secondary mt-2 inline-flex items-center gap-1">
        <Lightbulb size={11} /> Sistema híbrido: prioridad ausencias → fichaje → planificado. Las alertas marcan días con incidencias.
      </p>
    </>
  )
}

/* =====================================================
   PESTAÑA PENDIENTES
   ===================================================== */

function PendingTab({
  states,
  loading,
  onResolve,
}: {
  states: EmployeeBalanceStateExtended[]
  loading: boolean
  onResolve: (c: MonthlyBalanceClosure) => void
}) {
  if (loading) return <Skeleton />
  const allPending: { state: EmployeeBalanceStateExtended; closure: MonthlyBalanceClosure }[] = []
  for (const s of states) {
    for (const c of s.pendingClosures) {
      allPending.push({ state: s, closure: c })
    }
  }
  if (allPending.length === 0) {
    return (
      <div className="bg-success-bg border border-success/30 rounded-lg p-8 text-center">
        <div className="flex justify-center mb-2">
          <BarChart3 size={36} className="text-success" />
        </div>
        <div className="text-sm text-success font-medium">
          No hay periodos pendientes de resolución
        </div>
      </div>
    )
  }
  return (
    <div className="bg-card border border-border-default rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-accent text-text-on-accent">
          <tr>
            <th className="px-3 py-2 text-left">Empleado</th>
            <th className="px-3 py-2 text-center">Periodo</th>
            <th className="px-3 py-2 text-center w-24">Saldo</th>
            <th className="px-3 py-2 text-center w-32">Cerrado</th>
            <th className="px-3 py-2 text-center w-32">Acción</th>
          </tr>
        </thead>
        <tbody>
          {allPending.map(({ state, closure }) => {
            const positive = closure.delta > 0.01
            const negative = closure.delta < -0.01
            return (
              <tr key={closure.id} className="border-b border-border-default hover:bg-page transition-base">
                <td className="px-3 py-2">
                  <span className="font-bold text-sm text-accent">
                    {state.shiftCode || '–'}
                  </span>
                  <span className="ml-2 text-text-primary">{state.employeeName}</span>
                </td>
                <td className="px-3 py-2 text-center text-xs text-text-primary">
                  <div className="font-semibold">{closure.periodLabel}</div>
                  <div className="text-[10px] text-text-secondary font-mono">
                    {closure.periodStart} → {closure.periodEnd}
                  </div>
                </td>
                <td className={`px-3 py-2 text-center font-bold text-sm ${
                  positive ? 'text-success' :
                  negative ? 'text-danger' :
                  'text-text-secondary'
                }`}>
                  {positive ? '+' : ''}{closure.delta.toFixed(2)}h
                </td>
                <td className="px-3 py-2 text-center text-xs text-text-secondary font-mono">
                  {new Date(closure.closedAt).toLocaleDateString('es-ES')}
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => onResolve(closure)}
                    className="px-3 py-1 rounded text-text-on-accent text-xs font-medium bg-warning hover:opacity-90 transition-base"
                  >
                    Resolver
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}/* =====================================================
   PESTAÑA HISTÓRICO
   ===================================================== */

function HistoryTab({
  states,
  loading,
  employees,
  locations,
}: {
  states: EmployeeBalanceStateExtended[]
  loading: boolean
  employees: import('../types').Employee[]
  locations: Location[]
}) {
  const [filterEmpId, setFilterEmpId] = useState<string>('')
  const [filterResolution, setFilterResolution] = useState<ClosureResolution | ''>('')
  const [exporting, setExporting] = useState(false)

  if (loading) return <Skeleton />

  const allResolved: { state: EmployeeBalanceStateExtended; closure: MonthlyBalanceClosure }[] = []
  for (const s of states) {
    for (const c of s.resolvedClosures) {
      if (filterEmpId && s.employeeId !== filterEmpId) continue
      if (filterResolution && c.resolution !== filterResolution) continue
      allResolved.push({ state: s, closure: c })
    }
  }
  allResolved.sort((a, b) =>
    b.closure.periodEnd.localeCompare(a.closure.periodEnd)
  )

  async function handleExport() {
    if (allResolved.length === 0) {
      alert('No hay cierres para exportar con los filtros actuales.')
      return
    }
    setExporting(true)
    try {
      await exportGestoriaCsv({
        closures: allResolved.map(r => r.closure),
        employees,
        locations,
      })
    } catch (e) {
      console.error('[exportGestoria] Error:', e)
      alert('Error al exportar. Revisa la consola.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 bg-card border rounded-lg p-2 mb-3">
        <select
          value={filterEmpId}
          onChange={e => setFilterEmpId(e.target.value)}
          className="border rounded px-2 py-1 bg-card text-xs"
        >
          <option value="">Todos los empleados</option>
          {states.map(s => (
            <option key={s.employeeId} value={s.employeeId}>
              {s.shiftCode || '–'} {s.employeeName}
            </option>
          ))}
        </select>
        <select
          value={filterResolution}
          onChange={e => setFilterResolution(e.target.value as ClosureResolution | '')}
          className="border border-border-default rounded px-2 py-1 bg-card text-text-primary text-xs"
        >
          <option value="">Todas las resoluciones</option>
          <option value="pagado">Pagado</option>
          <option value="compensado">Compensado</option>
          <option value="arrastrado">Arrastrado</option>
          <option value="descartado">Descartado</option>
        </select>
        <div className="flex-1" />
        <span className="text-xs text-text-secondary">{allResolved.length} cierre(s)</span>
        <button
          onClick={handleExport}
          disabled={exporting || allResolved.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-text-on-accent text-xs font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          title="Descargar CSV con datos para gestoría (respeta los filtros)"
        >
          {exporting ? <><Clock size={11} /> Generando...</> : <><Download size={11} /> Exportar gestoría</>}
        </button>
      </div>

      {allResolved.length === 0 && (
        <div className="bg-card border border-border-default rounded-lg p-8 text-center text-text-secondary">
          No hay cierres en el histórico
        </div>
      )}

      {allResolved.length > 0 && (
        <div className="bg-card border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-accent text-text-on-accent">
              <tr>
                <th className="px-3 py-2 text-left">Empleado</th>
                <th className="px-3 py-2 text-center">Periodo</th>
                <th className="px-3 py-2 text-center w-20">Saldo</th>
                <th className="px-3 py-2 text-center w-32">Resolución</th>
                <th className="px-3 py-2 text-center w-20">Importe</th>
                <th className="px-3 py-2 text-left">Notas</th>
              </tr>
            </thead>
            <tbody>
              {allResolved.map(({ state, closure }) => {
                const positive = closure.delta > 0.01
                const negative = closure.delta < -0.01
                return (
                  <tr key={closure.id} className="border-b border-border-default hover:bg-page transition-base">
                    <td className="px-3 py-2">
                      <span className="font-bold text-xs text-accent">
                        {state.shiftCode || '–'}
                      </span>
                      <span className="ml-2 text-xs text-text-primary">{state.employeeName}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-text-primary">
                      <div className="font-semibold">{closure.periodLabel}</div>
                    </td>
                    <td className={`px-3 py-2 text-center font-mono text-xs ${
                      positive ? 'text-success font-bold' :
                      negative ? 'text-danger font-bold' :
                      'text-text-secondary'
                    }`}>
                      {positive ? '+' : ''}{closure.delta.toFixed(2)}h
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${RESOLUTION_COLORS[closure.resolution]}`}>
                        {RESOLUTION_LABELS[closure.resolution]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-mono text-text-primary">
                      {closure.resolutionAmount !== undefined
                        ? `${closure.resolutionAmount.toFixed(2)}h`
                        : '–'}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {closure.resolutionNotes || <span className="text-text-secondary">–</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* =====================================================
   MODAL DE RESOLUCIÓN
   ===================================================== */

function ResolveModal({
  closure,
  onClose,
  onResolved,
}: {
  closure: MonthlyBalanceClosure
  onClose: () => void
  onResolved: () => void
}) {
  const [resolution, setResolution] = useState<ClosureResolution>('pagado')
  const [amount, setAmount] = useState<string>(closure.delta.toFixed(2))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const result = await resolveClosure(closure.id, resolution, {
      amount: parseFloat(amount) || 0,
      notes: notes.trim() || undefined,
    })
    setSaving(false)
    if (result) onResolved()
    else alert('Error al resolver')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-xl max-w-lg w-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border-default bg-accent text-text-on-accent">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Resolver cierre — {closure.periodLabel}</div>
              <div className="text-xs opacity-90 font-mono">
                {closure.periodStart} → {closure.periodEnd}
              </div>
            </div>
            <button onClick={onClose} className="text-text-on-accent/80 hover:text-text-on-accent">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-page rounded p-3 text-sm text-text-primary">
            <div>Saldo del periodo: <strong className={closure.delta > 0 ? 'text-success' : 'text-danger'}>
              {closure.delta > 0 ? '+' : ''}{closure.delta.toFixed(2)}h
            </strong></div>
            <div className="text-xs text-text-secondary mt-1">
              Trabajadas {closure.scheduledHours.toFixed(2)}h
              (incl. vacac. {closure.vacationHours.toFixed(2)}h)
              − Contratadas {closure.contractedHoursPeriod.toFixed(2)}h
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">Resolución</label>
            <div className="grid grid-cols-2 gap-2">
              {(['pagado', 'compensado', 'arrastrado', 'descartado'] as ClosureResolution[]).map(r => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`px-3 py-2 rounded border text-sm font-medium transition-base ${
                    resolution === r
                      ? 'border-accent bg-accent-bg text-accent'
                      : 'border-border-default bg-card text-text-primary hover:bg-page'
                  }`}
                >
                  {RESOLUTION_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              Importe en horas (puede ser distinto al saldo)
            </label>
            <input
              type="number"
              step="0.25"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border border-border-default rounded px-3 py-2 text-sm bg-card text-text-primary"
            />
            <p className="text-[10px] text-text-secondary mt-1">
              Por defecto se usa el saldo. Puedes ajustar si solo pagas/compensas parte.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-border-default rounded px-3 py-2 text-sm bg-card text-text-primary"
              placeholder="Ej: pagado en nómina mayo, compensado con día libre 5 junio..."
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border-default bg-page flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border-default rounded bg-card text-text-primary hover:bg-page transition-base">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded text-text-on-accent text-sm font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          >
            {saving ? 'Guardando...' : 'Guardar resolución'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* =====================================================
   MODAL DE ALERTAS
   ===================================================== */

function AlertsModal({
  employeeName,
  alerts,
  onClose,
}: {
  employeeName: string
  alerts: DayAlert[]
  onClose: () => void
}) {
  const grouped: Record<DayAlertType, DayAlert[]> = {
    sin_fichaje: [],
    sin_horario: [],
    desviacion_grande: [],
  }
  for (const a of alerts) grouped[a.type].push(a)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border-default bg-accent text-text-on-accent">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold inline-flex items-center gap-1.5">
                <AlertTriangle size={16} /> Alertas del periodo
              </div>
              <div className="text-xs opacity-90">{employeeName} · {alerts.length} alerta(s)</div>
            </div>
            <button onClick={onClose} className="text-text-on-accent/80 hover:text-text-on-accent">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {(['desviacion_grande', 'sin_fichaje', 'sin_horario'] as DayAlertType[]).map(type => {
            const items = grouped[type]
            if (items.length === 0) return null
            return (
              <div key={type}>
                <div className={`text-xs font-semibold px-2 py-1 rounded mb-2 inline-block border ${ALERT_COLORS[type]}`}>
                  {ALERT_LABELS[type]} · {items.length}
                </div>
                <div className="space-y-1">
                  {items.map((a, i) => (
                    <div key={i} className="text-xs bg-page rounded px-3 py-2 flex items-center justify-between">
                      <div>
                        <span className="font-mono text-text-secondary">{a.date}</span>
                        <span className="ml-2 text-text-primary">{a.message}</span>
                      </div>
                      {a.scheduledHours !== undefined && a.clockedHours !== undefined && (
                        <div className="text-[10px] text-text-secondary font-mono">
                          plan {a.scheduledHours.toFixed(2)}h · ficha {a.clockedHours.toFixed(2)}h
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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

function Skeleton() {
  return (
    <div className="bg-card border rounded-lg p-8 text-center text-text-secondary">
      Calculando...
    </div>
  )
}
