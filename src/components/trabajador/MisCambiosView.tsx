// src/components/trabajador/MisCambiosView.tsx
// Historial de mis solicitudes de cambio (las que YO he creado o están dirigidas a mí).
// Permite cancelar las que aún están abiertas/en propuesta.

import { useEffect, useMemo, useState } from 'react'
import type { Employee } from '../../types'
import type { ShiftSwapRequest, SwapStatus } from '../../types/shiftSwap'
import {
  SWAP_STATUS_LABELS,
  SWAP_STATUS_COLORS,
  SWAP_TYPE_ICONS,
  SWAP_TYPE_LABELS,
} from '../../types/shiftSwap'
import {
  listSwapsForEmployee,
  cancelSwap,
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
  targetName?: string
  targetPhoto?: string
  requesterTemplate?: ShiftTemplate
  targetTemplate?: ShiftTemplate
  iAmRequester: boolean
}

type Filter = 'todos' | 'activos' | 'historial'

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function MisCambiosView({ myEmployee, onChanged }: Props) {
  const [swaps, setSwaps] = useState<EnrichedSwap[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('activos')
  const [acting, setActing] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [mineRaw, allEmployees, templates] = await Promise.all([
      listSwapsForEmployee(myEmployee.id),
      fetchEmployees(),
      myEmployee.locationId ? listShiftTemplates(myEmployee.locationId) : Promise.resolve([] as ShiftTemplate[]),
    ])
    const empMap = new Map((allEmployees || []).map(e => [e.id, e]))
    const tplMap = new Map(templates.map(t => [t.id, t]))

    const enriched: EnrichedSwap[] = (mineRaw || []).map(s => {
      const reqEmp = empMap.get(s.requesterId)
      const tgtEmp = s.targetId ? empMap.get(s.targetId) : undefined
      return {
        ...s,
        requesterName: reqEmp?.name || '(empleado)',
        requesterPhoto: reqEmp?.photo || undefined,
        targetName: tgtEmp?.name,
        targetPhoto: tgtEmp?.photo || undefined,
        requesterTemplate: tplMap.get(s.requesterTemplateId),
        targetTemplate: s.targetTemplateId ? tplMap.get(s.targetTemplateId) : undefined,
        iAmRequester: s.requesterId === myEmployee.id,
      }
    })

    enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    setSwaps(enriched)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmployee.id])

  const visible = useMemo(() => {
    if (filter === 'todos') return swaps
    const active: SwapStatus[] = ['abierta', 'propuesta']
    if (filter === 'activos') return swaps.filter(s => active.includes(s.status))
    return swaps.filter(s => !active.includes(s.status))
  }, [swaps, filter])

  async function handleCancel(swap: EnrichedSwap) {
    if (!confirm('¿Cancelar tu solicitud?')) return
    setActing(swap.id)
    const ok = await cancelSwap(swap.id)
    setActing(null)
    if (ok) {
      await load()
      onChanged?.()
    }
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        <FilterBtn active={filter === 'activos'} onClick={() => setFilter('activos')}>
          Activos
        </FilterBtn>
        <FilterBtn active={filter === 'historial'} onClick={() => setFilter('historial')}>
          Historial
        </FilterBtn>
        <FilterBtn active={filter === 'todos'} onClick={() => setFilter('todos')}>
          Todos
        </FilterBtn>
      </div>

      {loading && (
        <div className="bg-white border rounded-lg p-6 text-center text-sm text-gray-400">
          Cargando...
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="bg-white border rounded-lg p-8 text-center">
          <div className="text-5xl mb-2">📭</div>
          <p className="text-sm text-gray-700 font-medium">
            {filter === 'activos' ? 'No tienes solicitudes activas' : 'Sin solicitudes en este filtro'}
          </p>
        </div>
      )}

      {!loading && visible.map(swap => {
        const dayN = parseInt(swap.requesterDayKey, 10) as DayOfWeek
        const tStart = swap.requesterTemplate?.start_time?.slice(0, 5) || '?'
        const tEnd = swap.requesterTemplate?.end_time?.slice(0, 5) || '?'
        const isActive = swap.status === 'abierta' || swap.status === 'propuesta'
        return (
          <div key={swap.id} className="bg-white border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                  {SWAP_TYPE_ICONS[swap.swapType]} {SWAP_TYPE_LABELS[swap.swapType]}
                </span>
                {!swap.iAmRequester && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-medium">
                    📩 Te lo pidieron
                  </span>
                )}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${SWAP_STATUS_COLORS[swap.status]}`}>
                {SWAP_STATUS_LABELS[swap.status]}
              </span>
            </div>

            <div className="text-sm">
              <p className="font-medium">
                Turno: {DAY_LABELS[dayN] || swap.requesterDayKey}{' '}
                <span className="text-gray-400">{shortDate(swap.requesterDate)}</span>
                {' '}
                <span className="font-mono text-xs text-gray-600">{tStart}–{tEnd}</span>
              </p>
              {swap.iAmRequester && swap.targetName && (
                <p className="text-xs text-gray-600 mt-0.5">
                  Con: <strong>{swap.targetName}</strong>
                </p>
              )}
              {!swap.iAmRequester && (
                <p className="text-xs text-gray-600 mt-0.5">
                  Te lo pidió: <strong>{swap.requesterName}</strong>
                </p>
              )}
            </div>

            {swap.requestNotes && (
              <p className="text-[11px] text-gray-500 italic">"{swap.requestNotes}"</p>
            )}

            {swap.status === 'rechazada' && swap.managerNotes && (
              <p className="text-[11px] text-red-700 bg-red-50 px-2 py-1 rounded">
                <strong>Motivo del rechazo:</strong> {swap.managerNotes}
              </p>
            )}

            {swap.status === 'aprobada' && swap.managerNotes && (
              <p className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                {swap.managerNotes}
              </p>
            )}

            <div className="text-[10px] text-gray-400">
              {new Date(swap.createdAt).toLocaleString('es-ES')}
            </div>

            {isActive && swap.iAmRequester && (
              <button
                onClick={() => handleCancel(swap)}
                disabled={acting === swap.id}
                className="text-xs py-1.5 px-3 rounded border border-gray-300 text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-300 disabled:opacity-40"
              >
                {acting === swap.id ? 'Cancelando...' : 'Cancelar solicitud'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-1 rounded text-xs font-medium transition ${
        active ? 'bg-white shadow text-[#7C1A1A]' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  )
}
