// src/components/AprobarCambioModal.tsx
// Modal del gestor para aprobar o rechazar un cambio de turno.
// Muestra detalle, selector de atribución de horas y aviso visual de impacto.

import { useState, useMemo } from 'react'
import {
  X,
  Calendar,
  RefreshCw,
  Scale,
  BarChart3,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Check,
} from 'lucide-react'
import type { ShiftSwapRequest, HoursAttribution } from '../types/shiftSwap'
import {
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
      <div className="bg-card rounded-t-xl sm:rounded-xl max-w-xl w-full max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border-default sticky top-0 bg-accent text-text-on-accent">
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2">
              <RefreshCw size={16} /> {SWAP_TYPE_LABELS[swap.swapType]}
            </div>
            <button onClick={onClose} className="text-text-on-accent/80 hover:text-text-on-accent">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Empleados con avatares */}
          <div className="flex items-center justify-center gap-3">
            <PersonBadge employee={requester} label="Cede" />
            <ArrowRight size={24} className="text-text-secondary" />
            <PersonBadge employee={target} label="Cubre" />
          </div>

          {/* Detalle del turno */}
          <div className="bg-accent-bg rounded-lg p-3 text-sm">
            <p className="font-semibold mb-1 inline-flex items-center gap-1.5 text-text-primary">
              <Calendar size={14} /> Turno del cedente:
            </p>
            <p className="text-text-primary">
              <span className="font-medium">{DAY_LABELS[reqDayN] || swap.requesterDayKey}</span>
              {' '}<span className="text-text-secondary">{shortDate(swap.requesterDate)}</span>
              {' · '}
              <span className="font-mono">{reqStart}–{reqEnd}</span>
              {' · '}
              <span className="font-mono">{requesterHours}h</span>
            </p>
            {requesterTemplate && (
              <p className="text-xs text-text-secondary mt-0.5">{requesterTemplate.label}</p>
            )}
          </div>

          {/* Si es intercambio, mostrar también el turno del target */}
          {swap.swapType === 'intercambio' && targetTemplate && swap.targetDate && swap.targetDayKey && (
            <div className="bg-accent-bg border border-accent/30 rounded-lg p-3 text-sm">
              <p className="font-semibold mb-1 text-accent inline-flex items-center gap-1.5">
                <RefreshCw size={14} /> A cambio del turno:
              </p>
              <p className="text-accent">
                <span className="font-medium">{DAY_LABELS[parseInt(swap.targetDayKey, 10) as DayOfWeek]}</span>
                {' '}<span className="text-accent">{shortDate(swap.targetDate)}</span>
                {' · '}
                <span className="font-mono">{targetTemplate.start_time.slice(0, 5)}–{targetTemplate.end_time.slice(0, 5)}</span>
                {' · '}
                <span className="font-mono">{targetHours}h</span>
              </p>
              <p className="text-xs text-accent mt-0.5">{targetTemplate.label}</p>
            </div>
          )}

          {/* Notas del solicitante */}
          {swap.requestNotes && (
            <div className="text-sm bg-page border border-border-default rounded p-2.5">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-1">Mensaje del cedente</p>
              <p className="text-text-primary italic">"{swap.requestNotes}"</p>
            </div>
          )}

          {/* Notas del aceptor */}
          {swap.acceptorNotes && (
            <div className="text-sm bg-page border border-border-default rounded p-2.5">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-1">Mensaje de quien lo cogió</p>
              <p className="text-text-primary italic">"{swap.acceptorNotes}"</p>
            </div>
          )}

          {/* Selector de atribución de horas */}
          <div>
            <p className="text-sm font-semibold text-text-primary mb-2 inline-flex items-center gap-1.5">
              <Scale size={14} /> Atribución de horas
            </p>
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
          <div className="bg-warning-bg border border-warning/30 rounded-lg p-3">
            <p className="text-xs font-bold text-warning uppercase mb-2 inline-flex items-center gap-1.5">
              <BarChart3 size={12} /> Impacto en horas trabajadas
            </p>
            <div className="space-y-1.5">
              <ImpactRow name={requester.name.split(' ')[0]} delta={deltaInfo.requester} />
              <ImpactRow name={target.name.split(' ')[0]} delta={deltaInfo.target} />
            </div>
            <p className="text-[11px] text-warning mt-2 italic">{deltaInfo.explanation}</p>
          </div>

          {/* Notas del gestor */}
          <div>
            <p className="text-sm font-semibold text-text-primary mb-1">Notas (opcional)</p>
            <textarea
              value={managerNotes}
              onChange={e => setManagerNotes(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Motivo de la decisión, observaciones..."
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm resize-none"
            />
            <p className="text-[10px] text-text-secondary mt-0.5 text-right">{managerNotes.length}/300</p>
          </div>
        </div>

        {/* Botones */}
        <div className="px-5 py-3 border-t border-border-default bg-page sticky bottom-0 flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={acting !== 'none'}
            className="px-4 py-2 text-sm border border-border-default rounded bg-card text-text-primary hover:bg-page disabled:opacity-40 transition-base"
          >
            Cancelar
          </button>
          <button
            onClick={handleReject}
            disabled={acting !== 'none'}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm border-2 border-danger/30 text-danger rounded bg-card hover:bg-danger-bg disabled:opacity-40 transition-base"
          >
            <X size={14} /> {acting === 'rejecting' ? 'Rechazando...' : 'Rechazar'}
          </button>
          <button
            onClick={handleApprove}
            disabled={acting !== 'none'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-text-on-accent text-sm font-semibold disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          >
            <Check size={14} /> {acting === 'approving' ? 'Aprobando...' : 'Aprobar'}
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
      <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wide">{label}</div>
      {employee.photo ? (
        <img src={employee.photo} alt={employee.name} className="w-12 h-12 rounded-full object-cover border-2 border-card shadow" />
      ) : (
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-text-on-accent font-semibold text-lg border-2 border-card shadow bg-accent">
          {initial}
        </div>
      )}
      <div className="text-xs font-medium text-center max-w-[90px] truncate text-text-primary">{employee.name.split(' ')[0]}</div>
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
      className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-base ${
        selected ? 'border-accent bg-accent-bg' : 'border-border-default bg-card hover:border-accent'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-accent bg-accent' : 'border-border-default'
        }`}>
          {selected && <span className="w-1.5 h-1.5 bg-card rounded-full" />}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{title}</span>
            {recommended && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-success-bg text-success border border-success/30 font-bold">
                RECOMENDADO
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-secondary mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  )
}

function ImpactRow({ name, delta }: { name: string; delta: number }) {
  const isPositive = delta > 0
  const isNegative = delta < 0
  const sign = isPositive ? '+' : ''
  const ArrowIcon = isPositive ? ArrowUp : isNegative ? ArrowDown : Minus
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium text-text-primary">{name}</span>
      <span className={`font-mono font-bold inline-flex items-center gap-1 ${
        isPositive ? 'text-success' :
        isNegative ? 'text-danger' :
        'text-text-secondary'
      }`}>
        {sign}{delta.toFixed(2)}h <ArrowIcon size={14} />
      </span>
    </div>
  )
}
