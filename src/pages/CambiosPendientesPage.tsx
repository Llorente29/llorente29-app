// src/pages/CambiosPendientesPage.tsx
// Gestión de solicitudes de cambio de turno desde el lado del gestor.
// Muestra pendientes y permite aprobar/rechazar.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/ui'
import type { ShiftSwapRequest, SwapStatus } from '../types/shiftSwap'
import {
  SWAP_STATUS_LABELS,
  SWAP_STATUS_COLORS,
  SWAP_TYPE_ICONS,
  SWAP_TYPE_LABELS,
} from '../types/shiftSwap'
import { listAllSwaps } from '../services/shiftSwapService'
import { listShiftTemplates } from '../services/schedulerService'
import type { ShiftTemplate, DayOfWeek } from '../types/scheduler'
import { DAY_LABELS } from '../types/scheduler'
import AprobarCambioModal from '../components/AprobarCambioModal'

type FilterTab = 'pendientes' | 'aprobados' | 'historial' | 'todos'

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function CambiosPendientesPage() {
  const { staff, locations } = useApp()
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('pendientes')
  const [openSwap, setOpenSwap] = useState<ShiftSwapRequest | null>(null)

  async function load() {
    setLoading(true)
    const all = await listAllSwaps({ limit: 200 })
    setSwaps(all)
    // Cargar templates de TODOS los locales para resolver labels en cualquier solicitud
    const tplArrs = await Promise.all(locations.map(l => listShiftTemplates(l.id)))
    setTemplates(tplArrs.flat())
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations.length])

  const counts = useMemo(() => {
    const out = { pendientes: 0, aprobados: 0, historial: 0, todos: swaps.length }
    for (const s of swaps) {
      if (s.status === 'propuesta') out.pendientes++
      else if (s.status === 'aprobada') out.aprobados++
      else out.historial++
    }
    return out
  }, [swaps])

  const visible = useMemo(() => {
    if (filter === 'todos') return swaps
    if (filter === 'pendientes') return swaps.filter(s => s.status === 'propuesta')
    if (filter === 'aprobados') return swaps.filter(s => s.status === 'aprobada')
    // historial = rechazada, cancelada, abierta
    const histStates: SwapStatus[] = ['rechazada', 'cancelada', 'abierta']
    return swaps.filter(s => histStates.includes(s.status))
  }, [swaps, filter])

  // Helper: ID del primer empleado activo como "managerEmployeeId" representativo.
  // En tu sistema no hay un manager con sesión por separado; usamos un ID válido
  // para registrar quién aprobó. Si tienes un sistema de roles más rico,
  // sustituir por el id real del gestor logueado.
  const managerEmployeeId = useMemo(() => {
    const someActive = staff.find(e => e.active)
    return someActive?.id || ''
  }, [staff])

  function findEmp(id: string) {
    return staff.find(e => e.id === id)
  }
  function findTpl(id?: string) {
    if (!id) return undefined
    return templates.find(t => t.id === id)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Cambios de turno</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Aprueba o rechaza las solicitudes de cambio entre empleados.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <FilterPill active={filter === 'pendientes'} onClick={() => setFilter('pendientes')}>
          ⏳ Pendientes ({counts.pendientes})
        </FilterPill>
        <FilterPill active={filter === 'aprobados'} onClick={() => setFilter('aprobados')}>
          ✅ Aprobados ({counts.aprobados})
        </FilterPill>
        <FilterPill active={filter === 'historial'} onClick={() => setFilter('historial')}>
          📜 Historial ({counts.historial})
        </FilterPill>
        <FilterPill active={filter === 'todos'} onClick={() => setFilter('todos')}>
          Todos ({counts.todos})
        </FilterPill>
      </div>

      {loading && (
        <Card className="p-6 text-center text-sm text-gray-400">Cargando solicitudes...</Card>
      )}

      {!loading && visible.length === 0 && (
        <Card className="p-8 text-center">
          <div className="text-5xl mb-2">
            {filter === 'pendientes' ? '✨' : '📭'}
          </div>
          <p className="text-sm text-gray-700 font-medium">
            {filter === 'pendientes'
              ? 'No hay solicitudes pendientes de aprobación.'
              : 'Sin solicitudes en este filtro.'}
          </p>
          {filter === 'pendientes' && (
            <p className="text-xs text-gray-500 mt-1">
              Todo al día. Cuando los trabajadores soliciten cambios, aparecerán aquí.
            </p>
          )}
        </Card>
      )}

      {!loading && visible.length > 0 && (
        <div className="space-y-2">
          {visible.map(swap => {
            const requester = findEmp(swap.requesterId)
            const target = swap.targetId ? findEmp(swap.targetId) : undefined
            const reqTpl = findTpl(swap.requesterTemplateId)
            const tgtTpl = findTpl(swap.targetTemplateId)
            const reqDayN = parseInt(swap.requesterDayKey, 10) as DayOfWeek
            const tStart = reqTpl?.start_time?.slice(0, 5) || '?'
            const tEnd = reqTpl?.end_time?.slice(0, 5) || '?'
            const isPending = swap.status === 'propuesta'

            return (
              <Card key={swap.id} className="p-3">
                <div className="flex items-start gap-3">
                  {/* Avatar requester */}
                  <Avatar employee={requester} size="md" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-semibold">
                        {SWAP_TYPE_ICONS[swap.swapType]} {SWAP_TYPE_LABELS[swap.swapType]}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${SWAP_STATUS_COLORS[swap.status]}`}>
                        {SWAP_STATUS_LABELS[swap.status]}
                      </span>
                    </div>
                    <p className="text-sm">
                      <strong>{requester?.name || '(borrado)'}</strong>
                      {target && <> → <strong>{target.name}</strong></>}
                      {!target && <span className="text-gray-400"> · sin asignar</span>}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      <span className="font-medium">{DAY_LABELS[reqDayN] || swap.requesterDayKey}</span>
                      {' '}<span className="text-gray-400">{shortDate(swap.requesterDate)}</span>
                      {' · '}
                      <span className="font-mono">{tStart}–{tEnd}</span>
                      {reqTpl?.label && <> · {reqTpl.label}</>}
                    </p>
                    {swap.swapType === 'intercambio' && tgtTpl && swap.targetDate && (
                      <p className="text-[11px] text-blue-700 mt-0.5">
                        🔄 A cambio: {DAY_LABELS[parseInt(swap.targetDayKey || '0', 10) as DayOfWeek]}{' '}
                        <span className="text-blue-500">{shortDate(swap.targetDate)}</span>
                        {' · '}
                        <span className="font-mono">{tgtTpl.start_time.slice(0, 5)}–{tgtTpl.end_time.slice(0, 5)}</span>
                      </p>
                    )}
                    {swap.requestNotes && (
                      <p className="text-[11px] text-gray-500 italic mt-1">"{swap.requestNotes}"</p>
                    )}
                    {swap.status === 'aprobada' && swap.hoursAttribution && (
                      <p className="text-[10px] text-emerald-700 mt-1">
                        Atribución: {swap.hoursAttribution === 'worker' ? 'Quien trabaja cobra' : 'Imputado al cedente'}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">
                      Solicitada {new Date(swap.createdAt).toLocaleString('es-ES')}
                      {swap.reviewedAt && (
                        <> · Resuelta {new Date(swap.reviewedAt).toLocaleString('es-ES')}</>
                      )}
                    </p>
                  </div>

                  {/* Botón acción si pendiente */}
                  {isPending && requester && target && (
                    <button
                      onClick={() => setOpenSwap(swap)}
                      className="text-xs px-3 py-1.5 rounded text-white font-medium shrink-0"
                      style={{ backgroundColor: '#7C1A1A' }}
                    >
                      Revisar →
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal aprobación */}
      {openSwap && (() => {
        const req = findEmp(openSwap.requesterId)
        const tgt = openSwap.targetId ? findEmp(openSwap.targetId) : undefined
        if (!req || !tgt || !managerEmployeeId) {
          return null
        }
        return (
          <AprobarCambioModal
            swap={openSwap}
            requester={req}
            target={tgt}
            requesterTemplate={findTpl(openSwap.requesterTemplateId)}
            targetTemplate={findTpl(openSwap.targetTemplateId)}
            managerEmployeeId={managerEmployeeId}
            onClose={() => setOpenSwap(null)}
            onResolved={async () => {
              setOpenSwap(null)
              await load()
            }}
          />
        )
      })()}
    </div>
  )
}

/* =====================================================
   COMPONENTES AUXILIARES
   ===================================================== */

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
        active
          ? 'bg-[#7C1A1A] text-white border-[#7C1A1A]'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

function Avatar({ employee, size = 'md' }: { employee?: { name: string; photo?: string }; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  if (!employee) return <div className={`${px} rounded-full bg-gray-200 shrink-0`} />
  if (employee.photo) {
    return <img src={employee.photo} alt={employee.name} className={`${px} rounded-full object-cover shrink-0 border-2 border-white shadow-sm`} />
  }
  return (
    <div className={`${px} rounded-full flex items-center justify-center text-white font-semibold shrink-0 border-2 border-white shadow-sm`} style={{ backgroundColor: '#7C1A1A' }}>
      {(employee.name[0] || '?').toUpperCase()}
    </div>
  )
}
