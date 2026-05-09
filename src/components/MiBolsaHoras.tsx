// src/components/MiBolsaHoras.tsx
// Vista del trabajador: su propia bolsa de horas con periodos cerrados.
// Solo se muestra si emp.showHoursBalance === true

import { useEffect, useState } from 'react'
import {
  getEmployeeBalanceState,
  getEffectiveCloseDay,
  type LocationBalanceConfig,
} from '../services/hoursBalanceService'
import type {
  EmployeeBalanceState,
  MonthlyBalanceClosure,
  ClosureResolution,
} from '../types/hoursBalance'
import type { Employee, Location } from '../types'

interface Props {
  employee: Employee
  location?: Location
}

const RESOLUTION_LABELS: Record<ClosureResolution, string> = {
  pendiente: '⏳ Pendiente',
  pagado: '💰 Pagado',
  compensado: '🌴 Compensado',
  arrastrado: '↩️ Arrastrado',
  descartado: '🗑️ Descartado',
}

const RESOLUTION_COLORS: Record<ClosureResolution, string> = {
  pendiente: 'text-amber-700 bg-amber-50',
  pagado: 'text-emerald-700 bg-emerald-50',
  compensado: 'text-blue-700 bg-blue-50',
  arrastrado: 'text-violet-700 bg-violet-50',
  descartado: 'text-gray-500 bg-gray-100',
}

export default function MiBolsaHoras({ employee, location }: Props) {
  const [state, setState] = useState<EmployeeBalanceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

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

  // Si el trabajador no tiene visibilidad, no mostrar nada
  if (!(employee as any).showHoursBalance) return null

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-4 shadow-sm border">
        <div className="text-sm text-gray-500 text-center py-2">
          Cargando bolsa de horas...
        </div>
      </div>
    )
  }

  if (!state) return null

  const cp = state.currentPeriod
  const positive = cp.delta > 0.01
  const negative = cp.delta < -0.01
  const periodColor = positive ? 'text-emerald-600' : negative ? 'text-red-600' : 'text-gray-500'

  // Últimos cierres (mostrar máximo 6)
  const recentClosures = state.resolvedClosures.slice(0, 6)

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border">
      <h3 className="font-semibold text-base mb-3" style={{ color: '#7C1A1A' }}>
        💰 Mi bolsa de horas
      </h3>

      {/* Periodo en curso */}
      <div className="bg-[#F5E9D9] rounded-lg p-3 mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-[10px] uppercase font-semibold" style={{ color: '#7C1A1A' }}>
            En curso · {cp.periodLabel}
          </div>
          <div className="text-[10px] text-gray-600 font-mono">
            {cp.periodStart.slice(5)} → {cp.periodEnd.slice(5)}
          </div>
        </div>
        <div className={`text-3xl font-bold ${periodColor}`}>
          {positive ? '+' : ''}{cp.delta.toFixed(2)}h
        </div>
        <div className="text-[11px] text-gray-600 mt-1">
          Planificadas {cp.scheduledHours.toFixed(1)}h
          {cp.vacationHours > 0 && ` + Vacaciones ${cp.vacationHours.toFixed(1)}h`}
          {' '}− Contratadas {cp.contractedHoursPeriod.toFixed(1)}h
        </div>
        {cp.weeksWithoutSchedule.length > 0 && (
          <div className="mt-2 text-[10px] text-amber-700">
            ⚠️ {cp.weeksWithoutSchedule.length} semana(s) pendiente(s) de publicar
          </div>
        )}
      </div>

      {/* Cierres pendientes */}
      {state.pendingClosures.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase font-semibold text-amber-700 mb-2">
            ⏳ Pendiente de resolución por el gestor
          </div>
          <div className="space-y-2">
            {state.pendingClosures.map(c => {
              const cPositive = c.delta > 0.01
              const cNegative = c.delta < -0.01
              return (
                <div key={c.id} className="bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{c.periodLabel}</div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {c.periodStart} → {c.periodEnd}
                      </div>
                    </div>
                    <div className={`text-base font-bold ${
                      cPositive ? 'text-emerald-600' :
                      cNegative ? 'text-red-600' :
                      'text-gray-500'
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
      <div className="text-[11px] text-gray-500">
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
            className="mt-3 text-xs text-[#7C1A1A] hover:underline"
          >
            {showHistory ? '▼ Ocultar histórico' : `▶ Ver histórico (${recentClosures.length})`}
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

      <div className="mt-3 text-[10px] text-gray-400">
        Saldo positivo = la empresa te debe horas. Negativo = tú debes horas.
      </div>
    </div>
  )
}

function ClosureCard({ closure }: { closure: MonthlyBalanceClosure }) {
  const positive = closure.delta > 0.01
  const negative = closure.delta < -0.01
  return (
    <div className="bg-gray-50 rounded p-2 text-xs">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-semibold">{closure.periodLabel}</div>
          <div className="text-[10px] text-gray-500 font-mono">
            {closure.periodStart} → {closure.periodEnd}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold ${
            positive ? 'text-emerald-600' :
            negative ? 'text-red-600' :
            'text-gray-500'
          }`}>
            {positive ? '+' : ''}{closure.delta.toFixed(2)}h
          </div>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${RESOLUTION_COLORS[closure.resolution]}`}>
            {RESOLUTION_LABELS[closure.resolution]}
          </span>
        </div>
      </div>
      {closure.resolutionAmount !== undefined && (
        <div className="text-[10px] text-gray-600">
          Resuelto: {closure.resolutionAmount.toFixed(2)}h
        </div>
      )}
      {closure.resolutionNotes && (
        <div className="text-[10px] text-gray-600 italic mt-1">
          {closure.resolutionNotes}
        </div>
      )}
    </div>
  )
}
