// src/modules/appcc/pages/IncidentsPage.tsx
// Página de gestión de incidencias APPCC.
// Lista las incidencias del local seleccionado con filtros por estado y severidad.
// Permite ver detalle inline, marcar como en curso, añadir acciones y resolver.

import { useEffect, useMemo, useState } from 'react'
import type { Location } from '@/types'
import { useApp } from '@/context/AppContext'
import { supabase } from '@/lib/supabase'
import * as incidentsService from '@/modules/appcc/services/incidentsService'
import type {
  AppccIncident,
  AppccSeverity,
  AppccIncidentStatus,
} from '@/modules/appcc/types'
import type { AppccIncidentAction } from '@/modules/appcc/services/incidentsService'

const GRANATE = '#7C1A1A'
const BEIGE = '#F5E9D9'

const SEVERITY_STYLE: Record<AppccSeverity, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#fee2e2', fg: '#991b1b', label: 'Crítica' },
  high:     { bg: '#fed7aa', fg: '#9a3412', label: 'Alta' },
  medium:   { bg: '#fef3c7', fg: '#92400e', label: 'Media' },
  low:      { bg: '#dbeafe', fg: '#1e40af', label: 'Baja' },
}

const STATUS_STYLE: Record<AppccIncidentStatus, { bg: string; fg: string; label: string }> = {
  open:        { bg: '#fee2e2', fg: '#991b1b', label: 'Abierta' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af', label: 'En curso' },
  resolved:    { bg: '#dcfce7', fg: '#166534', label: 'Resuelta' },
  closed:      { bg: '#f3f4f6', fg: '#374151', label: 'Cerrada' },
  cancelled:   { bg: '#f3f4f6', fg: '#6b7280', label: 'Cancelada' },
}

const ACTION_TYPE_LABEL: Record<string, string> = {
  corrective: 'Correctiva',
  preventive: 'Preventiva',
  observation: 'Observación',
  escalation: 'Escalado',
}

type Filter = 'open_only' | 'all'

export default function IncidentsPage() {
  const { locations } = useApp()

  const activeLocations = useMemo<Location[]>(
    () => locations.filter(l => l.active),
    [locations]
  )

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [incidents, setIncidents] = useState<AppccIncident[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open_only')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionsByIncident, setActionsByIncident] = useState<Map<string, AppccIncidentAction[]>>(new Map())
  const [userId, setUserId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newActionText, setNewActionText] = useState('')
  const [resolveText, setResolveText] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [])

  useEffect(() => {
    if (!selectedLocationId && activeLocations.length > 0) {
      setSelectedLocationId(activeLocations[0].id)
    }
  }, [activeLocations, selectedLocationId])

  async function reload() {
    if (!selectedLocationId) return
    setLoading(true)
    setError(null)
    try {
      let data: AppccIncident[]
      if (filter === 'open_only') {
        data = await incidentsService.listOpenIncidents(selectedLocationId)
      } else {
        const today = new Date().toISOString().slice(0, 10)
        const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        data = await incidentsService.listIncidentsByDateRange(selectedLocationId, from, today)
      }
      setIncidents(data)
    } catch (err) {
      console.error('[IncidentsPage] reload error', err)
      setError(err instanceof Error ? err.message : 'Error cargando incidencias')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId, filter])

  async function handleExpand(incidentId: string) {
    if (expandedId === incidentId) {
      setExpandedId(null)
      return
    }
    setExpandedId(incidentId)
    setNewActionText('')
    setResolveText('')

    if (!actionsByIncident.has(incidentId)) {
      try {
        const detail = await incidentsService.getIncidentWithActions(incidentId)
        if (detail) {
          setActionsByIncident(prev => {
            const m = new Map(prev)
            m.set(incidentId, detail.actions)
            return m
          })
        }
      } catch (err) {
        console.error('[IncidentsPage] expand error', err)
      }
    }
  }

  async function handleMarkInProgress(incidentId: string) {
    if (!userId) return
    setBusyId(incidentId)
    try {
      await incidentsService.markInProgress(incidentId, userId)
      await reload()
    } catch (err) {
      console.error('[IncidentsPage] markInProgress error', err)
    } finally {
      setBusyId(null)
    }
  }

  async function handleAddAction(incidentId: string) {
    if (!userId || !newActionText.trim()) return
    setBusyId(incidentId)
    try {
      const action = await incidentsService.addAction(
        incidentId,
        newActionText.trim(),
        'corrective',
        userId
      )
      setActionsByIncident(prev => {
        const m = new Map(prev)
        const existing = m.get(incidentId) ?? []
        m.set(incidentId, [...existing, action])
        return m
      })
      setNewActionText('')
    } catch (err) {
      console.error('[IncidentsPage] addAction error', err)
    } finally {
      setBusyId(null)
    }
  }

  async function handleResolve(incidentId: string) {
    if (!userId || !resolveText.trim()) return
    setBusyId(incidentId)
    try {
      await incidentsService.resolveIncident(incidentId, userId, resolveText.trim())
      const detail = await incidentsService.getIncidentWithActions(incidentId)
      if (detail) {
        setActionsByIncident(prev => {
          const m = new Map(prev)
          m.set(incidentId, detail.actions)
          return m
        })
      }
      setResolveText('')
      await reload()
    } catch (err) {
      console.error('[IncidentsPage] resolve error', err)
    } finally {
      setBusyId(null)
    }
  }

  function formatSlaCountdown(sla: string | null): { text: string; overdue: boolean } {
    if (!sla) return { text: '—', overdue: false }
    const diffMs = new Date(sla).getTime() - Date.now()
    if (diffMs < 0) {
      const hours = Math.abs(Math.floor(diffMs / (1000 * 60 * 60)))
      return { text: `Vencido hace ${hours}h`, overdue: true }
    }
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    if (hours >= 24) {
      const days = Math.floor(hours / 24)
      return { text: `${days}d restantes`, overdue: false }
    }
    return { text: `${hours}h ${mins}m`, overdue: false }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1
          className="text-4xl mb-1"
          style={{ fontFamily: '"Instrument Serif", serif', color: GRANATE }}
        >
          Incidencias APPCC
        </h1>
        <p className="text-base text-gray-600">
          Acciones correctivas pendientes y resueltas por local.
        </p>
      </header>

      {/* Selector de local */}
      {activeLocations.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {activeLocations.map(loc => {
            const active = loc.id === selectedLocationId
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => { setSelectedLocationId(loc.id); setExpandedId(null) }}
                className="px-4 py-2.5 rounded-lg text-base font-medium transition min-h-[44px]"
                style={{
                  backgroundColor: active ? GRANATE : '#fff',
                  color: active ? BEIGE : GRANATE,
                  border: `1px solid ${GRANATE}`,
                }}
              >
                {loc.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Filtro estado */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          type="button"
          onClick={() => setFilter('open_only')}
          className="px-4 py-2 rounded-lg text-sm font-medium transition min-h-[40px]"
          style={{
            backgroundColor: filter === 'open_only' ? GRANATE : '#fff',
            color: filter === 'open_only' ? BEIGE : '#374151',
            border: '1px solid #d1d5db',
          }}
        >
          Solo abiertas
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className="px-4 py-2 rounded-lg text-sm font-medium transition min-h-[40px]"
          style={{
            backgroundColor: filter === 'all' ? GRANATE : '#fff',
            color: filter === 'all' ? BEIGE : '#374151',
            border: '1px solid #d1d5db',
          }}
        >
          Todas (30 días)
        </button>
      </div>

      {/* Estados */}
      {loading && (
        <div className="py-12 text-center text-base text-gray-500">Cargando incidencias...</div>
      )}

      {error && (
        <div className="py-4 px-4 mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-base">
          {error}
        </div>
      )}

      {!loading && !error && incidents.length === 0 && (
        <div
          className="py-12 px-4 text-center rounded-xl border-2 border-dashed"
          style={{ borderColor: GRANATE, backgroundColor: BEIGE }}
        >
          <div className="text-5xl mb-3">✓</div>
          <h3 className="text-xl font-semibold mb-1" style={{ color: GRANATE }}>
            Sin incidencias
          </h3>
          <p className="text-base text-gray-700">
            {filter === 'open_only'
              ? 'No hay incidencias abiertas en este local.'
              : 'No hay incidencias en los últimos 30 días.'}
          </p>
        </div>
      )}

      {/* Lista */}
      {!loading && !error && incidents.length > 0 && (
        <div className="space-y-3">
          {incidents.map(inc => {
            const sevStyle = SEVERITY_STYLE[inc.severity]
            const stStyle = STATUS_STYLE[inc.status]
            const expanded = expandedId === inc.id
            const sla = formatSlaCountdown(inc.sla_due_at)
            const actions = actionsByIncident.get(inc.id) ?? []
            const isOpen = inc.status === 'open' || inc.status === 'in_progress'

            return (
              <div
                key={inc.id}
                className="bg-white rounded-lg border border-gray-200 overflow-hidden"
              >
                {/* Fila principal — responsive */}
                <button
                  type="button"
                  onClick={() => handleExpand(inc.id)}
                  className="w-full text-left p-4 sm:p-5 hover:bg-gray-50 transition"
                >
                  {/* MÓVIL: línea superior con badges y flecha */}
                  <div className="flex sm:hidden items-center gap-2 mb-2 flex-wrap">
                    <span
                      className="text-xs px-2.5 py-1 rounded font-semibold uppercase"
                      style={{ backgroundColor: sevStyle.bg, color: sevStyle.fg }}
                    >
                      {sevStyle.label}
                    </span>
                    <span
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ backgroundColor: stStyle.bg, color: stStyle.fg }}
                    >
                      {stStyle.label}
                    </span>
                    <span className="ml-auto text-gray-400 text-base">{expanded ? '▲' : '▼'}</span>
                  </div>

                  {/* MÓVIL: título + meta */}
                  <div className="sm:hidden">
                    <div className="text-base font-medium mb-1">{inc.title}</div>
                    <div className="text-sm text-gray-500">
                      {inc.source === 'auto' ? '🤖 Automática' : '✋ Manual'}
                      {' · '}
                      {new Date(inc.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {isOpen && (
                        <span
                          className="ml-2"
                          style={{ color: sla.overdue ? '#dc2626' : '#6b7280' }}
                        >
                          {sla.overdue ? '⚠ ' : '· ⏱ '}
                          {sla.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* DESKTOP: layout horizontal */}
                  <div className="hidden sm:flex items-center gap-3">
                    <span
                      className="text-xs px-2.5 py-1 rounded font-semibold uppercase shrink-0"
                      style={{ backgroundColor: sevStyle.bg, color: sevStyle.fg }}
                    >
                      {sevStyle.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium truncate">{inc.title}</div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {inc.source === 'auto' ? '🤖 Automática' : '✋ Manual'}
                        {' · '}
                        {new Date(inc.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span
                      className="text-xs px-2.5 py-1 rounded-full font-medium shrink-0"
                      style={{ backgroundColor: stStyle.bg, color: stStyle.fg }}
                    >
                      {stStyle.label}
                    </span>
                    {isOpen && (
                      <span
                        className="text-sm shrink-0"
                        style={{ color: sla.overdue ? '#dc2626' : '#6b7280' }}
                      >
                        {sla.overdue ? '⚠ ' : '⏱ '}
                        {sla.text}
                      </span>
                    )}
                    <span className="text-gray-400 text-base shrink-0">{expanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Detalle desplegable */}
                {expanded && (
                  <div className="border-t border-gray-200 p-4 sm:p-5 bg-gray-50 space-y-4">
                    {inc.description && (
                      <p className="text-base text-gray-700">{inc.description}</p>
                    )}

                    {/* Historial de acciones */}
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
                        Historial de acciones ({actions.length})
                      </div>
                      {actions.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">Aún no se ha registrado ninguna acción.</p>
                      ) : (
                        <div className="space-y-2">
                          {actions.map(a => (
                            <div key={a.id} className="bg-white rounded-md border border-gray-200 p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold text-gray-700">
                                  {ACTION_TYPE_LABEL[a.action_type ?? ''] ?? 'Acción'}
                                </span>
                                <span className="text-gray-400 text-xs">
                                  {new Date(a.taken_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-gray-700 text-base">{a.description}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Acciones disponibles */}
                    {isOpen && (
                      <div className="space-y-4 pt-2 border-t border-gray-200">
                        {/* Marcar en curso */}
                        {inc.status === 'open' && (
                          <button
                            type="button"
                            disabled={busyId === inc.id}
                            onClick={() => handleMarkInProgress(inc.id)}
                            className="text-base px-4 py-2.5 rounded-lg font-medium transition disabled:opacity-50 min-h-[44px]"
                            style={{ backgroundColor: '#2563eb', color: '#fff' }}
                          >
                            ▶ Marcar en curso
                          </button>
                        )}

                        {/* Añadir acción intermedia */}
                        <div>
                          <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 block mb-2">
                            Registrar acción intermedia
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={newActionText}
                              onChange={e => setNewActionText(e.target.value)}
                              placeholder="Ej: Avisado al técnico..."
                              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 min-h-[44px]"
                            />
                            <button
                              type="button"
                              disabled={!newActionText.trim() || busyId === inc.id}
                              onClick={() => handleAddAction(inc.id)}
                              className="text-base px-4 py-2.5 rounded-md font-medium transition disabled:opacity-50 min-h-[44px] shrink-0"
                              style={{ backgroundColor: '#fff', color: GRANATE, border: `1px solid ${GRANATE}` }}
                            >
                              Añadir
                            </button>
                          </div>
                        </div>

                        {/* Resolver */}
                        <div>
                          <label className="text-sm font-semibold uppercase tracking-wider text-gray-500 block mb-2">
                            Resolver incidencia
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={resolveText}
                              onChange={e => setResolveText(e.target.value)}
                              placeholder="Describe la resolución final..."
                              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 min-h-[44px]"
                            />
                            <button
                              type="button"
                              disabled={!resolveText.trim() || busyId === inc.id}
                              onClick={() => handleResolve(inc.id)}
                              className="text-base px-4 py-2.5 rounded-md font-medium transition disabled:opacity-50 min-h-[44px] shrink-0"
                              style={{ backgroundColor: '#16a34a', color: '#fff' }}
                            >
                              ✓ Resolver
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Si ya está resuelta o cerrada, mostrar info */}
                    {!isOpen && inc.resolved_at && (
                      <div className="text-sm text-gray-500 pt-2 border-t border-gray-200">
                        Resuelta el {new Date(inc.resolved_at).toLocaleString('es-ES')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}