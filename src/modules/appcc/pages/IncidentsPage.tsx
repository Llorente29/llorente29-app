// src/modules/appcc/pages/IncidentsPage.tsx
// Página de gestión de incidencias APPCC.
// Lista las incidencias del local seleccionado con filtros por estado y severidad.
// Permite ver detalle inline, marcar como en curso, añadir acciones y resolver.

import { useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  Play,
  Check,
  Bot,
  Hand,
} from 'lucide-react'
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

const SEVERITY_STYLE: Record<AppccSeverity, { className: string; label: string }> = {
  critical: { className: 'bg-danger-bg text-danger', label: 'Crítica' },
  high:     { className: 'bg-warning-bg text-warning', label: 'Alta' },
  medium:   { className: 'bg-warning-bg text-warning', label: 'Media' },
  low:      { className: 'bg-accent-bg text-accent', label: 'Baja' },
}

const STATUS_STYLE: Record<AppccIncidentStatus, { className: string; label: string }> = {
  open:        { className: 'bg-danger-bg text-danger', label: 'Abierta' },
  in_progress: { className: 'bg-accent-bg text-accent', label: 'En curso' },
  resolved:    { className: 'bg-success-bg text-success', label: 'Resuelta' },
  closed:      { className: 'bg-page text-text-secondary', label: 'Cerrada' },
  cancelled:   { className: 'bg-page text-text-secondary', label: 'Cancelada' },
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
        <h1 className="font-display text-4xl mb-1 text-accent">
          Incidencias APPCC
        </h1>
        <p className="text-base text-text-secondary">
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
                className={`px-4 py-2.5 rounded-lg text-base font-medium transition-base min-h-touch border border-accent ${
                  active
                    ? 'bg-accent text-text-on-accent hover:bg-accent-hover'
                    : 'bg-card text-accent hover:bg-accent-bg'
                }`}
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
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-base min-h-[40px] border ${
            filter === 'open_only'
              ? 'bg-accent text-text-on-accent border-accent hover:bg-accent-hover'
              : 'bg-card text-text-primary border-border-default hover:bg-accent-bg'
          }`}
        >
          Solo abiertas
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-base min-h-[40px] border ${
            filter === 'all'
              ? 'bg-accent text-text-on-accent border-accent hover:bg-accent-hover'
              : 'bg-card text-text-primary border-border-default hover:bg-accent-bg'
          }`}
        >
          Todas (30 días)
        </button>
      </div>

      {/* Estados */}
      {loading && (
        <div className="py-12 text-center text-base text-text-secondary">Cargando incidencias...</div>
      )}

      {error && (
        <div className="py-4 px-4 mb-4 rounded-lg border border-danger/30 bg-danger-bg text-danger text-base">
          {error}
        </div>
      )}

      {!loading && !error && incidents.length === 0 && (
        <div className="py-12 px-4 text-center rounded-xl border-2 border-dashed border-accent bg-accent-bg">
          <div className="flex justify-center mb-3">
            <ShieldCheck size={48} className="text-accent" strokeWidth={2} />
          </div>
          <h3 className="text-xl font-semibold mb-1 text-accent">
            Sin incidencias
          </h3>
          <p className="text-base text-text-primary">
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
                className="bg-card rounded-lg border border-border-default overflow-hidden"
              >
                {/* Fila principal — responsive */}
                <button
                  type="button"
                  onClick={() => handleExpand(inc.id)}
                  className="w-full text-left p-4 sm:p-5 hover:bg-accent-bg transition-base"
                >
                  {/* MÓVIL: línea superior con badges y flecha */}
                  <div className="flex sm:hidden items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-xs px-2.5 py-1 rounded font-semibold uppercase ${sevStyle.className}`}>
                      {sevStyle.label}
                    </span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${stStyle.className}`}>
                      {stStyle.label}
                    </span>
                    <span className="ml-auto text-text-secondary">
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </span>
                  </div>

                  {/* MÓVIL: título + meta */}
                  <div className="sm:hidden">
                    <div className="text-base font-medium mb-1 text-text-primary">{inc.title}</div>
                    <div className="text-sm text-text-secondary flex items-center gap-1.5 flex-wrap">
                      {inc.source === 'auto' ? (
                        <span className="inline-flex items-center gap-1">
                          <Bot size={14} /> Automática
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Hand size={14} /> Manual
                        </span>
                      )}
                      <span>·</span>
                      <span>{new Date(inc.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {isOpen && (
                        <span className={`inline-flex items-center gap-1 ml-1 ${sla.overdue ? 'text-danger' : 'text-text-secondary'}`}>
                          {sla.overdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
                          {sla.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* DESKTOP: layout horizontal */}
                  <div className="hidden sm:flex items-center gap-3">
                    <span className={`text-xs px-2.5 py-1 rounded font-semibold uppercase shrink-0 ${sevStyle.className}`}>
                      {sevStyle.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium truncate text-text-primary">{inc.title}</div>
                      <div className="text-sm text-text-secondary mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {inc.source === 'auto' ? (
                          <span className="inline-flex items-center gap-1">
                            <Bot size={14} /> Automática
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Hand size={14} /> Manual
                          </span>
                        )}
                        <span>·</span>
                        <span>{new Date(inc.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${stStyle.className}`}>
                      {stStyle.label}
                    </span>
                    {isOpen && (
                      <span className={`text-sm shrink-0 inline-flex items-center gap-1 ${sla.overdue ? 'text-danger' : 'text-text-secondary'}`}>
                        {sla.overdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
                        {sla.text}
                      </span>
                    )}
                    <span className="text-text-secondary shrink-0">
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </span>
                  </div>
                </button>

                {/* Detalle desplegable */}
                {expanded && (
                  <div className="border-t border-border-default p-4 sm:p-5 bg-page space-y-4">
                    {inc.description && (
                      <p className="text-base text-text-primary">{inc.description}</p>
                    )}

                    {/* Historial de acciones */}
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-wider text-text-secondary mb-2">
                        Historial de acciones ({actions.length})
                      </div>
                      {actions.length === 0 ? (
                        <p className="text-sm text-text-secondary italic">Aún no se ha registrado ninguna acción.</p>
                      ) : (
                        <div className="space-y-2">
                          {actions.map(a => (
                            <div key={a.id} className="bg-card rounded-md border border-border-default p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold text-text-primary">
                                  {ACTION_TYPE_LABEL[a.action_type ?? ''] ?? 'Acción'}
                                </span>
                                <span className="text-text-secondary text-xs">
                                  {new Date(a.taken_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-text-primary text-base">{a.description}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Acciones disponibles */}
                    {isOpen && (
                      <div className="space-y-4 pt-2 border-t border-border-default">
                        {/* Marcar en curso */}
                        {inc.status === 'open' && (
                          <button
                            type="button"
                            disabled={busyId === inc.id}
                            onClick={() => handleMarkInProgress(inc.id)}
                            className="inline-flex items-center gap-2 text-base px-4 py-2.5 rounded-lg font-medium transition-base disabled:opacity-50 min-h-touch bg-accent text-text-on-accent hover:bg-accent-hover"
                          >
                            <Play size={16} />
                            Marcar en curso
                          </button>
                        )}

                        {/* Añadir acción intermedia */}
                        <div>
                          <label className="text-sm font-semibold uppercase tracking-wider text-text-secondary block mb-2">
                            Registrar acción intermedia
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={newActionText}
                              onChange={e => setNewActionText(e.target.value)}
                              placeholder="Ej: Avisado al técnico..."
                              className="flex-1 px-4 py-2.5 border border-border-default rounded-md text-base focus:outline-none focus:ring-2 focus:ring-accent min-h-touch bg-card text-text-primary"
                            />
                            <button
                              type="button"
                              disabled={!newActionText.trim() || busyId === inc.id}
                              onClick={() => handleAddAction(inc.id)}
                              className="text-base px-4 py-2.5 rounded-md font-medium transition-base disabled:opacity-50 min-h-touch shrink-0 bg-card text-accent border border-accent hover:bg-accent-bg"
                            >
                              Añadir
                            </button>
                          </div>
                        </div>

                        {/* Resolver */}
                        <div>
                          <label className="text-sm font-semibold uppercase tracking-wider text-text-secondary block mb-2">
                            Resolver incidencia
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={resolveText}
                              onChange={e => setResolveText(e.target.value)}
                              placeholder="Describe la resolución final..."
                              className="flex-1 px-4 py-2.5 border border-border-default rounded-md text-base focus:outline-none focus:ring-2 focus:ring-accent min-h-touch bg-card text-text-primary"
                            />
                            <button
                              type="button"
                              disabled={!resolveText.trim() || busyId === inc.id}
                              onClick={() => handleResolve(inc.id)}
                              className="inline-flex items-center justify-center gap-2 text-base px-4 py-2.5 rounded-md font-medium transition-base disabled:opacity-50 min-h-touch shrink-0 bg-success-bg text-success border border-success/30 hover:opacity-90"
                            >
                              <Check size={16} />
                              Resolver
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Si ya está resuelta o cerrada, mostrar info */}
                    {!isOpen && inc.resolved_at && (
                      <div className="text-sm text-text-secondary pt-2 border-t border-border-default">
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
