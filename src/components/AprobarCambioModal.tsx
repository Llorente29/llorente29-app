// src/components/AprobarCambioModal.tsx
// Modal del gestor para aprobar o rechazar un cambio de turno.
// Muestra detalle, selector de atribución de horas y aviso visual de impacto.

import { useState, useMemo } from 'react'
import type { ShiftSwapRequest, HoursAttribution } from '../types/shiftSwap'
import {
  SWAP_TYPE_ICONS,
  SWAP_TYPE_LABELS,
} from '../types/shiftSwap'
import type { Employee } from '../types'
import type { ShiftTemplate, DayOfWeek } from '../types/scheduler'
import { DAY_LABELS, shiftDurationHours } from '../types/scheduler'
import { approveSwap, rejectSwap } from '../services/shiftSwapService'

interface Props {
  swap: ShiftSwapRequest
  requester: Employee
  target: Employee
  requesterTemplate?: ShiftTemplate
  targetTemplate?: ShiftTemplate
  managerEmployeeId: string
  onClose: () => void
  onResolved: () => void
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function AprobarCambioModal({
  swap,
  requester,
  target,
  requesterTemplate,
  targetTemplate,
  managerEmployeeId,
  onClose,
  onResolved,
}: Props) {
  const [hoursAttribution, setHoursAttribution] = useState<HoursAttribution>('worker')
  const [managerNotes, setManagerNotes] = useState('')
  const [acting, setActing] = useState<'none' | 'approving' | 'rejecting'>('none')

  // Calcular horas del turno del solicitante
  const requesterHours = useMemo(() => {
    if (!requesterTemplate) return 0
    return shiftDurationHours(
      requesterTemplate.start_time.slice(0, 5),
      requesterTemplate.end_time.slice(0, 5)
    )
  }, [requesterTemplate])

  // Calcular horas del turno target (solo en intercambio)
  const targetHours = useMemo(() => {
    if (!targetTemplate) return 0
    return shiftDurationHours(
      targetTemplate.start_time.slice(0, 5),
      targetTemplate.end_time.slice(0, 5)
    )
  }, [targetTemplate])

  /* ─────────────────────────────────────
     Cálculo del delta de horas por persona según atribución
     ───────────────────────────────────── */
  const deltaInfo = useMemo(() => {
    // Cesión / Petición directa:
    //   - El target trabaja el turno del requester.
    //   - Si attribution=worker: requester pierde X h, target gana X h
    //   - Si attribution=requester: nadie cambia (ficticio: target trabaja, requester cobra)
    //
    // Intercambio:
    //   - target trabaja el turno del requester (X h)
    //   - requester trabaja el turno del target (Y h)
    //   - Si attribution=worker: requester +Y -X ; target +X -Y
    //   - Si attribution=requester: 0 (raro en intercambios)

    if (swap.swapType === 'intercambio') {
      if (hoursAttribution === 'worker') {
        const reqDelta = +(targetHours - requesterHours).toFixed(2)
        const tgtDelta = +(requesterHours - targetHours).toFixed(2)
        return {
          requester: reqDelta,
          target: tgtDelta,
          explanation: `Intercambio: cada uno cobra el turno que trabaja físicamente.`,
        }
      } else {
        return {
          requester: 0,
          target: 0,
          explanation: `Atribución al cedente: las horas se mantienen como estaban (solo cambia quién trabaja físicamente).`,
        }
      }
    }
    // Cesión / petición directa
    if (hoursAttribution === 'worker') {
      return {
        requester: +(-requesterHours).toFixed(2),
        target: +(requesterHours).toFixed(2),
        explanation: `${target.name.split(' ')[0]} trabaja y cobra esas ${requesterHours}h. ${requester.name.split(' ')[0]} no las cobra (ese día queda libre).`,
      }
    } else {
      return {
        requester: 0,
        target: 0,
        explanation: `${target.name.split(' ')[0]} trabaja físicamente, pero las horas siguen contando para ${requester.name.split(' ')[0]}. Solo cuando hay acuerdo previo y la empresa lo autoriza.`,
      }
    }
  }, [swap.swapType, hoursAttribution, requesterHours, targetHours, requester.name, target.name])

  async function handleApprove() {
    setActing('approving')
    const ok = await approveSwap(swap.id, managerEmployeeId, managerNotes.trim() || undefined, hoursAttribution)
    setActing('none')
    if (ok) {
      onResolved()
    } else {
      alert('Error al aprobar. Mira la consola para más detalles.')
    }
  }

  async function handleReject() {
    if (!confirm('¿Rechazar esta solicitud?')) return
    setActing('rejecting')
    const ok = await rejectSwap(swap.id, managerEmployeeId, managerNotes.trim() || undefined)
    setActing('none')
    if (ok) {
      onResolved()
    } else {
      alert('Error al rechazar. Mira la consola para más detalles.')
    }
  }

  const reqDayN = parseInt(swap.requesterDayKey, 10) as DayOfWeek
  const reqStart = requesterTemplate?.start_time?.slice(0, 5) || '?'
  const reqEnd = requesterTemplate?.end_time?.slice(0, 5) || '?'

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-3 border-b sticky top-0" style={{ backgroundColor: '#7C1A1A', color: 'white' }}>
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2">
              {SWAP_TYPE_ICONS[swap.swapType]} {SWAP_TYPE_LABELS[swap.swapType]}
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Empleados con avatares */}
          <div className="flex items-center justify-center gap-3">
            <PersonBadge employee={requester} label="Cede" />
            <span className="text-2xl text-gray-300">→</span>
            <PersonBadge employee={target} label="Cubre" />
          </div>

          {/* Detalle del turno */}
          <div className="bg-[#F5E9D9] rounded-lg p-3 text-sm">
            <p className="font-semibold mb-1">📅 Turno del cedente:</p>
            <p className="text-gray-800">
              <span className="font-medium">{DAY_LABELS[reqDayN] || swap.requesterDayKey}</span>
              {' '}<span className="text-gray-500">{shortDate(swap.requesterDate)}</span>
              {' · '}
              <span className="font-mono">{reqStart}–{reqEnd}</span>
              {' · '}
              <span className="font-mono">{requesterHours}h</span>
            </p>
            {requesterTemplate && (
              <p className="text-xs text-gray-600 mt-0.5">{requesterTemplate.label}</p>
            )}
          </div>

          {/* Si es intercambio, mostrar también el turno del target */}
          {swap.swapType === 'intercambio' && targetTemplate && swap.targetDate && swap.targetDayKey && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="font-semibold mb-1 text-blue-800">🔄 A cambio del turno:</p>
              <p className="text-blue-900">
                <span className="font-medium">{DAY_LABELS[parseInt(swap.targetDayKey, 10) as DayOfWeek]}</span>
                {' '}<span className="text-blue-600">{shortDate(swap.targetDate)}</span>
                {' · '}
                <span className="font-mono">{targetTemplate.start_time.slice(0, 5)}–{targetTemplate.end_time.slice(0, 5)}</span>
                {' · '}
                <span className="font-mono">{targetHours}h</span>
              </p>
              <p className="text-xs text-blue-700 mt-0.5">{targetTemplate.label}</p>
            </div>
          )}

          {/* Notas del solicitante */}
          {swap.requestNotes && (
            <div className="text-sm bg-gray-50 border border-gray-200 rounded p-2.5">
              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Mensaje del cedente</p>
              <p className="text-gray-700 italic">"{swap.requestNotes}"</p>
            </div>
          )}

          {/* Notas del aceptor */}
          {swap.acceptorNotes && (
            <div className="text-sm bg-gray-50 border border-gray-200 rounded p-2.5">
              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Mensaje de quien lo cogió</p>
              <p className="text-gray-700 italic">"{swap.acceptorNotes}"</p>
            </div>
          )}

          {/* Selector de atribución de horas */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">⚖️ Atribución de horas</p>
            <div className="space-y-2">
              <AttributionOption
                value="worker"
                selected={hoursAttribution === 'worker'}
                onSelect={() => setHoursAttribution('worker')}
                title={`${target.name.split(' ')[0]} cobra esas horas`}
                description="Modelo legal por defecto. Quien trabaja físicamente cobra. Convenio Hostelería."
                recommended
              />
              <AttributionOption
                value="requester"
                selected={hoursAttribution === 'requester'}
                onSelect={() => setHoursAttribution('requester')}
                title={`${requester.name.split(' ')[0]} mantiene las horas`}
                description="Excepción: solo si hay acuerdo previo entre los empleados y autorización de la empresa."
              />
            </div>
          </div>

          {/* Aviso visual de impacto */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-xs font-bold text-amber-900 uppercase mb-2">📊 Impacto en horas trabajadas</p>
            <div className="space-y-1.5">
              <ImpactRow name={requester.name.split(' ')[0]} delta={deltaInfo.requester} />
              <ImpactRow name={target.name.split(' ')[0]} delta={deltaInfo.target} />
            </div>
            <p className="text-[11px] text-amber-800 mt-2 italic">{deltaInfo.explanation}</p>
          </div>

          {/* Notas del gestor */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Notas (opcional)</p>
            <textarea
              value={managerNotes}
              onChange={e => setManagerNotes(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Motivo de la decisión, observaciones..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            />
            <p className="text-[10px] text-gray-400 mt-0.5 text-right">{managerNotes.length}/300</p>
          </div>
        </div>

        {/* Botones */}
        <div className="px-5 py-3 border-t bg-gray-50 sticky bottom-0 flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={acting !== 'none'}
            className="px-4 py-2 text-sm border rounded bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleReject}
            disabled={acting !== 'none'}
            className="px-4 py-2 text-sm border-2 border-red-300 text-red-600 rounded bg-white hover:bg-red-50 disabled:opacity-40"
          >
            {acting === 'rejecting' ? 'Rechazando...' : '❌ Rechazar'}
          </button>
          <button
            onClick={handleApprove}
            disabled={acting !== 'none'}
            className="px-4 py-2 rounded text-white text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: '#7C1A1A' }}
          >
            {acting === 'approving' ? 'Aprobando...' : '✅ Aprobar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* =====================================================
   COMPONENTES AUXILIARES
   ===================================================== */

function PersonBadge({ employee, label }: { employee: Employee; label: string }) {
  const initial = (employee.name || '?')[0].toUpperCase()
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{label}</div>
      {employee.photo ? (
        <img src={employee.photo} alt={employee.name} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" />
      ) : (
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-lg border-2 border-white shadow" style={{ backgroundColor: '#7C1A1A' }}>
          {initial}
        </div>
      )}
      <div className="text-xs font-medium text-center max-w-[90px] truncate">{employee.name.split(' ')[0]}</div>
    </div>
  )
}

function AttributionOption({
  selected,
  onSelect,
  title,
  description,
  recommended,
}: {
  value: string
  selected: boolean
  onSelect: () => void
  title: string
  description: string
  recommended?: boolean
}) {
  return (
    <button
      onClick={onSelect}
      type="button"
      className={`w-full text-left px-3 py-2 rounded-lg border-2 transition ${
        selected ? 'border-[#7C1A1A] bg-[#F5E9D9]' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-[#7C1A1A] bg-[#7C1A1A]' : 'border-gray-300'
        }`}>
          {selected && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{title}</span>
            {recommended && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold">
                RECOMENDADO
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  )
}

function ImpactRow({ name, delta }: { name: string; delta: number }) {
  const isPositive = delta > 0
  const isNegative = delta < 0
  const sign = isPositive ? '+' : ''
  const arrow = isPositive ? '⬆' : isNegative ? '⬇' : '–'
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium text-gray-800">{name}</span>
      <span className={`font-mono font-bold ${
        isPositive ? 'text-emerald-700' :
        isNegative ? 'text-red-700' :
        'text-gray-500'
      }`}>
        {sign}{delta.toFixed(2)}h {arrow}
      </span>
    </div>
  )
}
