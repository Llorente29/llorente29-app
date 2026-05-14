// src/components/MiBolsaHoras.tsx
// Vista del trabajador: su propia bolsa de horas con periodos cerrados y alertas del periodo.
// Solo se muestra si emp.showHoursBalance === true

import { useEffect, useState } from 'react'
import { Wallet, AlertTriangle, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getEmployeeBalanceState,
  getEffectiveCloseDay,
  type LocationBalanceConfig,
  type EmployeeBalanceStateExtended,
  type DayAlert,
  type DayAlertType,
} from '../services/hoursBalanceService'
import type {
  MonthlyBalanceClosure,
  ClosureResolution,
} from '../types/hoursBalance'
import type { Employee, Location } from '../types'

interface Props {
  employee: Employee
  location?: Location
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
  sin_horario: 'Sin horario',
  desviacion_grande: 'Desviación',
}

const ALERT_COLORS: Record<DayAlertType, string> = {
  sin_fichaje: 'bg-warning-bg border-warning/30 text-warning',
  sin_horario: 'bg-warning-bg border-warning/30 text-warning',
  desviacion_grande: 'bg-danger-bg border-danger/30 text-danger',
}

export default function MiBolsaHoras({ employee, location }: Props) {
  const [state, setState] = useState<EmployeeBalanceStateExtended | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)

  // closeDay efectivo para este local
  const closeDay = (() => {
    if (!location) return 25
    const config: LocationBalanceConfig = {
      closeDay: (location as any).hoursBalanceCloseDay ?? 25,
      syncWithGestoria: (location as any).hoursBalanceSyncWithGestoria ?? true,
      gestoriaDay: (location as any).gestoriaSendDay ?? 25,
    }
    return getEffectiveCloseDay(config)
  })()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getEmployeeBalanceState(employee, closeDay)
      .then(s => {
        if (!cancelled) {
          setState(s)
          setLoading(false)
        }
      })
      .catch(e => {
        console.error('[MiBolsaHoras] Error:', e)
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [employee.id, closeDay])

  if (!(employee as any).showHoursBalance) return null

  if (loading) {
    return (
      <div className="bg-card rounded-lg p-4 shadow-sm border">
        <div className="text-sm text-text-secondary text-center py-2">
          Cargando bolsa de horas...
        </div>
      </div>
    )
  }

  if (!state) return null

  const cp = state.currentPeriod
  const positive = cp.delta > 0.01
  const negative = cp.delta < -0.01
  const periodColor = positive ? 'text-success' : negative ? 'text-danger' : 'text-text-secondary'

  const recentClosures = state.resolvedClosures.slice(0, 6)
  const numAlerts = state.alerts.length

  return (
    <div className="bg-card rounded-lg p-4 shadow-sm border border-border-default">
      <h3 className="font-semibold text-base mb-3 text-accent inline-flex items-center gap-1.5">
        <Wallet size={18} /> Mi bolsa de horas
      </h3>

      {/* Periodo en curso */}
      <div className="bg-accent-bg rounded-lg p-3 mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-[10px] uppercase font-semibold text-accent">
            En curso · {cp.periodLabel}
          </div>
          <div className="text-[10px] text-text-secondary font-mono">
            {cp.periodStart.slice(5)} → {cp.periodEnd.slice(5)}
          </div>
        </div>
        <div className={`text-3xl font-bold ${periodColor}`}>
          {positive ? '+' : ''}{cp.delta.toFixed(2)}h
        </div>
        <div className="text-[11px] text-text-secondary mt-1">
          Trabajadas {cp.scheduledHours.toFixed(1)}h
          {cp.vacationHours > 0 && ` (incl. vacac. ${cp.vacationHours.toFixed(1)}h)`}
          {' '}− Contratadas {cp.contractedHoursPeriod.toFixed(1)}h
        </div>
        {cp.weeksWithoutSchedule.length > 0 && (
          <div className="mt-2 text-[10px] text-warning inline-flex items-center gap-1">
            <AlertTriangle size={10} /> {cp.weeksWithoutSchedule.length} semana(s) pendiente(s) de publicar
          </div>
        )}
      </div>

      {/* Alertas del periodo (si las hay) */}
      {numAlerts > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowAlerts(s => !s)}
            className="w-full text-left px-3 py-2 rounded bg-danger-bg border border-danger/30 text-xs hover:opacity-90 transition-base"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-danger inline-flex items-center gap-1.5">
                <AlertTriangle size={12} /> {numAlerts} día(s) con incidencias
              </span>
              <span className="text-danger">
                {showAlerts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </div>
          </button>
          {showAlerts && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {state.alerts.map((a, i) => (
                <AlertCard key={i} alert={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cierres pendientes */}
      {state.pendingClosures.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase font-semibold text-warning mb-2 inline-flex items-center gap-1">
            <Clock size={11} /> Pendiente de resolución por el gestor
          </div>
          <div className="space-y-2">
            {state.pendingClosures.map(c => {
              const cPositive = c.delta > 0.01
              const cNegative = c.delta < -0.01
              return (
                <div key={c.id} className="bg-warning-bg border border-warning/30 rounded p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{c.periodLabel}</div>
                      <div className="text-[10px] text-text-secondary font-mono">
                        {c.periodStart} → {c.periodEnd}
                      </div>
                    </div>
                    <div className={`text-base font-bold ${
                      cPositive ? 'text-success' :
                      cNegative ? 'text-danger' :
                      'text-text-secondary'
                    }`}>
                      {cPositive ? '+' : ''}{c.delta.toFixed(2)}h
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Datos del contrato */}
      <div className="text-[11px] text-text-secondary">
        Contrato: {state.contractedHours}h/semana
        {state.initialBalance !== 0 && (
          <span> · Saldo inicial: {state.initialBalance > 0 ? '+' : ''}{state.initialBalance.toFixed(1)}h</span>
        )}
      </div>

      {/* Histórico */}
      {recentClosures.length > 0 && (
        <>
          <button
            onClick={() => setShowHistory(s => !s)}
            className="mt-3 text-xs text-accent hover:underline inline-flex items-center gap-1"
          >
            {showHistory
              ? <><ChevronDown size={12} /> Ocultar histórico</>
              : <><ChevronRight size={12} /> Ver histórico ({recentClosures.length})</>}
          </button>

          {showHistory && (
            <div className="mt-2 space-y-2">
              {recentClosures.map(c => (
                <ClosureCard key={c.id} closure={c} />
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-3 text-[10px] text-text-secondary">
        Saldo positivo = la empresa te debe horas. Negativo = tú debes horas.
      </div>
    </div>
  )
}

function AlertCard({ alert }: { alert: DayAlert }) {
  return (
    <div className={`rounded px-2 py-1.5 text-[11px] border ${ALERT_COLORS[alert.type]}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] shrink-0">{alert.date.slice(5)}</span>
          <span className="font-semibold shrink-0">{ALERT_LABELS[alert.type]}</span>
        </div>
      </div>
      <div className="text-[10px] mt-0.5 opacity-80">{alert.message}</div>
    </div>
  )
}

function ClosureCard({ closure }: { closure: MonthlyBalanceClosure }) {
  const positive = closure.delta > 0.01
  const negative = closure.delta < -0.01
  return (
    <div className="bg-page rounded p-2 text-xs">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-semibold">{closure.periodLabel}</div>
          <div className="text-[10px] text-text-secondary font-mono">
            {closure.periodStart} → {closure.periodEnd}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold ${
            positive ? 'text-success' :
            negative ? 'text-danger' :
            'text-text-secondary'
          }`}>
            {positive ? '+' : ''}{closure.delta.toFixed(2)}h
          </div>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${RESOLUTION_COLORS[closure.resolution]}`}>
            {RESOLUTION_LABELS[closure.resolution]}
          </span>
        </div>
      </div>
      {closure.resolutionAmount !== undefined && (
        <div className="text-[10px] text-text-secondary">
          Resuelto: {closure.resolutionAmount.toFixed(2)}h
        </div>
      )}
      {closure.resolutionNotes && (
        <div className="text-[10px] text-text-secondary italic mt-1">
          {closure.resolutionNotes}
        </div>
      )}
    </div>
  )
}
