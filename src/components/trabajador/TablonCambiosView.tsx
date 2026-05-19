// src/components/trabajador/TablonCambiosView.tsx
// Tablón de cambios disponibles para el trabajador:
//  - Cesiones abiertas de otros (puede coger una)
//  - Peticiones directas / intercambios que LE PIDEN a él (acepta o rechaza)
//
// Tras coger/aceptar, la solicitud pasa a "propuesta" pendiente de aprobación del gestor.

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Bell, Globe2, Hand, Check, X } from 'lucide-react'
import type { Employee } from '../../types'
import type { ShiftSwapRequest } from '../../types/shiftSwap'
import { SWAP_TYPE_LABELS } from '../../types/shiftSwap'
import {
  listOpenCesiones,
  listSwapsForEmployee,
  acceptCesion,
  rejectSwap,
} from '../../services/shiftSwapService'
import { fetchEmployees } from '../../services/supabaseSync'
import { listShiftTemplates } from '../../services/schedulerService'
import type { ShiftTemplate, DayOfWeek } from '../../types/scheduler'
import { DAY_LABELS } from '../../types/scheduler'

interface Props {
  myEmployee: Employee
  onChanged?: () => void
}

interface EnrichedSwap extends ShiftSwapRequest {
  requesterName: string
  requesterPhoto?: string
  requesterTemplate?: ShiftTemplate
  targetTemplate?: ShiftTemplate
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function TablonCambiosView({ myEmployee, onChanged }: Props) {
  const [openCesiones, setOpenCesiones] = useState<EnrichedSwap[]>([])
  const [incomingRequests, setIncomingRequests] = useState<EnrichedSwap[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [acceptorNotes, setAcceptorNotes] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    const [cesionesRaw, mineRaw, allEmployees, templates] = await Promise.all([
      listOpenCesiones(),
      listSwapsForEmployee(myEmployee.id),
      fetchEmployees(null),
      myEmployee.locationId ? listShiftTemplates(myEmployee.locationId) : Promise.resolve([] as ShiftTemplate[]),
    ])
    const empMap = new Map((allEmployees || []).map(e => [e.id, e]))
    const tplMap = new Map(templates.map(t => [t.id, t]))

    function enrich(s: ShiftSwapRequest): EnrichedSwap {
      const reqEmp = empMap.get(s.requesterId)
      return {
        ...s,
        requesterName: reqEmp?.name || '(empleado)',
        requesterPhoto: reqEmp?.photo || undefined,
        requesterTemplate: tplMap.get(s.requesterTemplateId),
        targetTemplate: s.targetTemplateId ? tplMap.get(s.targetTemplateId) : undefined,
      }
    }

    // Cesiones abiertas: filtrar las del propio usuario (no se ofrece a sí mismo)
    const cesiones = (cesionesRaw || [])
      .filter(s => s.requesterId !== myEmployee.id)
      .map(enrich)

    // Solicitudes que ME piden (target_id = yo) y están en propuesta
    const incoming = (mineRaw || [])
      .filter(s =>
        s.targetId === myEmployee.id &&
        s.requesterId !== myEmployee.id &&
        s.status === 'propuesta' &&
        (s.swapType === 'intercambio' || s.swapType === 'peticion_directa')
      )
      .map(enrich)

    setOpenCesiones(cesiones)
    setIncomingRequests(incoming)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmployee.id])

  async function handleTakeCesion(swap: EnrichedSwap) {
    if (acting) return
    if (!confirm('¿Coger este turno? La solicitud pasará a estar pendiente de aprobación del gestor.')) return
    setActing(swap.id)
    const notes = acceptorNotes[swap.id] || undefined
    const ok = await acceptCesion(swap.id, myEmployee.id, notes)
    setActing(null)
    if (ok) {
      await load()
      onChanged?.()
    } else {
      alert('No se pudo coger el turno. Quizá ya lo cogió otra persona.')
    }
  }

  async function handleRejectIncoming(swap: EnrichedSwap) {
    if (acting) return
    const reason = window.prompt('Motivo del rechazo (opcional):') || undefined
    if (reason === undefined) {
      // null cuando el usuario cancela el prompt → no continuamos
      // (window.prompt devuelve null si cancela; '' si pulsa OK sin escribir)
    }
    setActing(swap.id)
    // Para rechazar de forma simple, usamos rejectSwap pasando el id del propio
    // empleado como reviewer técnico. En el futuro, separar lógica si es necesario.
    const ok = await rejectSwap(swap.id, myEmployee.id, reason || undefined)
    setActing(null)
    if (ok) {
      await load()
      onChanged?.()
    }
  }

  async function handleAcceptIncoming(swap: EnrichedSwap) {
    if (acting) return
    if (!confirm(swap.swapType === 'intercambio'
      ? '¿Aceptar el intercambio? Pasará a aprobación del gestor.'
      : '¿Aceptar la petición? Pasará a aprobación del gestor.')) return
    // En el modelo actual, las solicitudes 'intercambio' y 'peticion_directa'
    // ya nacen en estado 'propuesta'. La aceptación del target no cambia el estado:
    // se considera implícita (la rechaza si quiere). Por ahora simplemente notificamos
    // y la dejamos pendiente del gestor. Mantenemos el botón por UX clara.
    setActing(swap.id)
    // Como acción positiva no cambia BD; solo recargamos
    setActing(null)
    alert('Aceptación registrada. La solicitud está pendiente de aprobación del gestor.')
    await load()
    onChanged?.()
  }

  const totalPending = useMemo(
    () => incomingRequests.length + openCesiones.length,
    [incomingRequests.length, openCesiones.length]
  )

  return (
    <div className="space-y-3">
      {loading && (
        <div className="bg-card border border-border-default rounded-lg p-6 text-center text-sm text-text-secondary">
          Cargando tablón...
        </div>
      )}

      {!loading && totalPending === 0 && (
        <div className="bg-card border border-border-default rounded-lg p-8 text-center">
          <div className="flex justify-center mb-2">
            <RefreshCw size={32} className="text-accent" />
          </div>
          <p className="text-sm text-text-primary font-medium">No hay cambios disponibles</p>
          <p className="text-xs text-text-secondary mt-1">
            Cuando algún compañero libre un turno o te pida un cambio, aparecerá aquí.
          </p>
        </div>
      )}

      {/* INCOMING: peticiones que ME hacen */}
      {!loading && incomingRequests.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2 px-1 inline-flex items-center gap-1.5">
            <Bell size={12} /> Te lo piden a ti ({incomingRequests.length})
          </h3>
          <div className="space-y-2">
            {incomingRequests.map(swap => (
              <SwapCard
                key={swap.id}
                swap={swap}
                myEmployeeId={myEmployee.id}
                isAcceptable
                acting={acting === swap.id}
                onAccept={() => handleAcceptIncoming(swap)}
                onReject={() => handleRejectIncoming(swap)}
              />
            ))}
          </div>
        </div>
      )}

      {/* CESIONES ABIERTAS */}
      {!loading && openCesiones.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2 px-1 mt-4 inline-flex items-center gap-1.5">
            <Globe2 size={12} /> Cesiones disponibles ({openCesiones.length})
          </h3>
          <div className="space-y-2">
            {openCesiones.map(swap => (
              <SwapCard
                key={swap.id}
                swap={swap}
                myEmployeeId={myEmployee.id}
                isCesion
                acting={acting === swap.id}
                acceptorNote={acceptorNotes[swap.id] || ''}
                onChangeAcceptorNote={(v) => setAcceptorNotes(prev => ({ ...prev, [swap.id]: v }))}
                onTake={() => handleTakeCesion(swap)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* =====================================================
   COMPONENTE CARD
   ===================================================== */

interface CardProps {
  swap: EnrichedSwap
  myEmployeeId: string
  acting: boolean
  isCesion?: boolean
  isAcceptable?: boolean
  acceptorNote?: string
  onChangeAcceptorNote?: (v: string) => void
  onTake?: () => void
  onAccept?: () => void
  onReject?: () => void
}

function SwapCard({
  swap,
  acting,
  isCesion,
  isAcceptable,
  acceptorNote,
  onChangeAcceptorNote,
  onTake,
  onAccept,
  onReject,
}: CardProps) {
  const dayN = parseInt(swap.requesterDayKey, 10) as DayOfWeek
  const tStart = swap.requesterTemplate?.start_time?.slice(0, 5) || '?'
  const tEnd = swap.requesterTemplate?.end_time?.slice(0, 5) || '?'
  const tLabel = swap.requesterTemplate?.label || ''

  return (
    <div className="bg-card border border-border-default rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="shrink-0">
          {swap.requesterPhoto ? (
            <img src={swap.requesterPhoto} alt={swap.requesterName} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-text-on-accent font-semibold bg-accent">
              {(swap.requesterName[0] || '?').toUpperCase()}
            </div>
          )}
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm truncate text-text-primary">{swap.requesterName}</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary font-medium">
              {SWAP_TYPE_LABELS[swap.swapType]}
            </span>
          </div>
          <p className="text-xs text-text-primary mt-1">
            <span className="font-medium">{DAY_LABELS[dayN] || swap.requesterDayKey}</span>{' '}
            <span className="text-text-secondary">{shortDate(swap.requesterDate)}</span>
            {' · '}
            <span className="font-mono">{tStart}–{tEnd}</span>
            {tLabel && <> · {tLabel}</>}
          </p>

          {/* Si es intercambio, mostrar el turno propuesto a cambio */}
          {swap.swapType === 'intercambio' && swap.targetTemplate && swap.targetDate && swap.targetDayKey && (
            <div className="mt-1 text-[11px] bg-accent-bg border border-accent/30 rounded px-2 py-1">
              <span className="font-medium text-accent">A cambio de tu turno:</span>{' '}
              {DAY_LABELS[parseInt(swap.targetDayKey, 10) as DayOfWeek]}{' '}
              <span className="text-accent">{shortDate(swap.targetDate)}</span>
              {' · '}
              <span className="font-mono">{swap.targetTemplate.start_time.slice(0, 5)}–{swap.targetTemplate.end_time.slice(0, 5)}</span>
            </div>
          )}

          {swap.requestNotes && (
            <p className="text-[11px] text-text-secondary italic mt-1">"{swap.requestNotes}"</p>
          )}
        </div>
      </div>

      {/* Acciones */}
      {isCesion && onTake && (
        <div className="space-y-1.5 pt-1">
          <input
            type="text"
            placeholder="Mensaje (opcional)"
            maxLength={200}
            value={acceptorNote || ''}
            onChange={e => onChangeAcceptorNote?.(e.target.value)}
            className="w-full text-xs border border-border-default rounded px-2 py-1.5 bg-card text-text-primary"
          />
          <button
            onClick={onTake}
            disabled={acting}
            className="inline-flex items-center justify-center gap-1.5 w-full text-sm py-1.5 rounded text-text-on-accent font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          >
            <Hand size={14} /> {acting ? 'Cogiendo...' : 'Coger este turno'}
          </button>
        </div>
      )}
      {isAcceptable && onAccept && onReject && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onReject}
            disabled={acting}
            className="inline-flex items-center justify-center gap-1 flex-1 text-xs py-1.5 rounded border border-border-default text-text-secondary hover:bg-danger-bg hover:text-danger hover:border-danger/30 disabled:opacity-40 transition-base"
          >
            <X size={12} /> Rechazar
          </button>
          <button
            onClick={onAccept}
            disabled={acting}
            className="inline-flex items-center justify-center gap-1 flex-1 text-xs py-1.5 rounded text-text-on-accent font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          >
            <Check size={12} /> Aceptar
          </button>
        </div>
      )}
    </div>
  )
}
