// src/modules/appcc/pages/IncidentsPage.tsx
// Página de gestión de incidencias APPCC.
// - Lista por local con filtros por estado y severidad
// - Badge visual de escaladas (SLA vencido)
// - Click en una incidencia → IncidentDetailModal con todo el workflow CAPA
// - Botón "Nueva incidencia manual"

import { useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  Bot,
  Hand,
  Plus,
  Filter,
  FileDown,
  Eye,
} from 'lucide-react'
import type { Location } from '@/types'
import { useApp } from '@/context/AppContext'
import * as incidentsService from '@/modules/appcc/services/incidentsService'
import * as pdfExportService from '@/modules/appcc/services/pdfExportService'
import type { PdfPreviewResult } from '@/modules/appcc/services/pdfExportService'
import IncidentDetailModal from '@/modules/appcc/components/IncidentDetailModal'
import ReportPreviewModal from '@/components/ReportPreviewModal'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import type {
  AppccIncident,
  AppccSeverity,
  AppccIncidentStatus,
} from '@/modules/appcc/types'
import {
  SEVERITY_LABEL,
  STATUS_LABEL,
  OPEN_STATUSES,
} from '@/modules/appcc/types'

const SEVERITY_STYLE: Record<AppccSeverity, string> = {
  critical: 'bg-danger text-text-on-accent',
  high:     'bg-warning text-text-on-accent',
  medium:   'bg-warning-bg text-warning',
  low:      'bg-accent-bg text-accent',
}

const STATUS_STYLE: Record<AppccIncidentStatus, string> = {
  open:          'bg-danger-bg text-danger',
  assigned:      'bg-warning-bg text-warning',
  investigating: 'bg-accent-bg text-accent',
  corrected:     'bg-success-bg text-success',
  verified:      'bg-success-bg text-success',
  closed:        'bg-page text-text-secondary',
  rejected:      'bg-page text-text-secondary',
}

type StatusFilter = 'open_only' | 'all' | 'escalated'
type SeverityFilter = 'all' | AppccSeverity

export default function IncidentsPage() {
  const { locations } = useApp()

  // Mostramos TODOS los locales en el selector de incidencias (no solo activos):
  // las incidencias de locales que se desactivaron también deben poder consultarse,
  // si no quedarían "huérfanas" e invisibles. Los inactivos van marcados.
  const allLocations = useMemo<Location[]>(
    () => [...locations].sort((a, b) => {
      // Activos primero, luego por nombre
      if (a.active !== b.active) return a.active ? -1 : 1
      return (a.name || '').localeCompare(b.name || '', 'es')
    }),
    [locations]
  )
  const activeLocations = useMemo<Location[]>(
    () => locations.filter(l => l.active),
    [locations]
  )

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [incidents, setIncidents] = useState<AppccIncident[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open_only')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [preview, setPreview] = useState<PdfPreviewResult | null>(null)
  const [previewTitle, setPreviewTitle] = useState<string>('Informe de incidencia')

  // Auto-seleccionar primer local (prefiere activo, fallback a cualquiera)
  useEffect(() => {
    if (!selectedLocationId) {
      const first = activeLocations[0] ?? allLocations[0]
      if (first) setSelectedLocationId(first.id)
    }
  }, [activeLocations, allLocations, selectedLocationId])

  // ---------- Cargar incidencias ----------
  async function reload() {
    if (!selectedLocationId) return
    setLoading(true)
    setError(null)
    try {
      let data: AppccIncident[]
      if (statusFilter === 'open_only') {
        data = await incidentsService.listOpenIncidents(selectedLocationId)
      } else if (statusFilter === 'escalated') {
        data = await incidentsService.listEscalatedIncidents(selectedLocationId)
      } else {
        const today = new Date().toISOString().slice(0, 10)
        const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        data = await incidentsService.listIncidentsByDateRange(
          selectedLocationId,
          from,
          today
        )
      }
      setIncidents(data)
      console.info(
        `[IncidentsPage] cargadas ${data.length} incidencias (status=${statusFilter}, location=${selectedLocationId})`
      )
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
  }, [selectedLocationId, statusFilter])

  // ---------- Filtro por severidad (cliente) ----------
  const filtered = useMemo(() => {
    if (severityFilter === 'all') return incidents
    return incidents.filter(i => i.severity === severityFilter)
  }, [incidents, severityFilter])

  // ---------- Contadores para badges de filtros ----------
  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0, escalated: 0 }
    incidents.forEach(i => {
      c[i.severity]++
      if (i.escalated) c.escalated++
    })
    return c
  }, [incidents])

  const selectedLocation = allLocations.find(l => l.id === selectedLocationId)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ============================ HEADER ============================ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display text-text-primary flex items-center gap-2">
            <ShieldCheck size={26} className="text-accent" />
            Incidencias APPCC
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Workflow CAPA: detectar · investigar · corregir · verificar · cerrar
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          disabled={!selectedLocationId}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
        >
          <Plus size={15} /> Nueva incidencia
        </button>
      </div>

      {/* ============================ FILTROS ============================ */}
      <div className="bg-card rounded-lg border border-border-default p-3 sm:p-4 space-y-3">
        {/* Local */}
        <div>
          <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5">
            Local
          </label>
          <select
            value={selectedLocationId ?? ''}
            onChange={e => setSelectedLocationId(e.target.value || null)}
            className="w-full sm:w-auto px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
          >
            {allLocations.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}{!l.active && ' (inactivo)'}
              </option>
            ))}
          </select>
        </div>

        {/* Filtros de estado y severidad */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5 flex items-center gap-1">
              <Filter size={11} /> Estado
            </label>
            <div className="flex gap-1 flex-wrap">
              <FilterBtn
                active={statusFilter === 'open_only'}
                onClick={() => setStatusFilter('open_only')}
                label="Abiertas"
              />
              <FilterBtn
                active={statusFilter === 'escalated'}
                onClick={() => setStatusFilter('escalated')}
                label={`Escaladas${counts.escalated > 0 ? ` (${counts.escalated})` : ''}`}
                tone={counts.escalated > 0 ? 'danger' : 'default'}
              />
              <FilterBtn
                active={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
                label="Últimos 30 días"
              />
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5">
              Severidad
            </label>
            <div className="flex gap-1 flex-wrap">
              <FilterBtn
                active={severityFilter === 'all'}
                onClick={() => setSeverityFilter('all')}
                label="Todas"
              />
              {(['critical', 'high', 'medium', 'low'] as const).map(s => (
                <FilterBtn
                  key={s}
                  active={severityFilter === s}
                  onClick={() => setSeverityFilter(s)}
                  label={`${SEVERITY_LABEL[s]}${counts[s] > 0 ? ` (${counts[s]})` : ''}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ============================ LISTA ============================ */}
      {error && (
        <div className="bg-danger-bg text-danger rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-text-secondary py-8">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-text-secondary py-12 bg-card rounded-lg border border-border-default">
          <ShieldCheck size={48} className="mx-auto mb-3 text-success opacity-50" />
          <p className="text-base font-medium text-text-primary mb-1">
            Sin incidencias
          </p>
          <p className="text-sm">
            {incidents.length > 0 && severityFilter !== 'all'
              ? `Hay ${incidents.length} incidencia(s) cargada(s) pero el filtro de severidad "${SEVERITY_LABEL[severityFilter]}" no muestra ninguna. Pulsa "Todas" para verlas.`
              : statusFilter === 'open_only'
              ? 'No hay incidencias abiertas en este local. ¡Bien!'
              : statusFilter === 'escalated'
              ? 'No hay incidencias escaladas. Todo bajo control.'
              : 'No hay incidencias en los últimos 30 días.'}
          </p>
          {selectedLocation && !selectedLocation.active && (
            <p className="text-xs text-warning mt-2">
              ⚠ Este local está marcado como inactivo
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(inc => (
            <IncidentCard
              key={inc.id}
              incident={inc}
              onClick={() => setOpenIncidentId(inc.id)}
              onPreview={async () => {
                try {
                  if (!selectedLocation) return
                  const result = await pdfExportService.generateIncidentCapaPdf(
                    inc.id,
                    { name: selectedLocation.name },
                    { mode: 'preview' },
                  )
                  if (result) {
                    setPreviewTitle(`Incidencia: ${inc.title}`)
                    setPreview(result)
                  }
                } catch (err) {
                  console.error(err)
                  alert('Error generando vista previa')
                }
              }}
              onPdf={async () => {
                try {
                  if (!selectedLocation) return
                  await pdfExportService.generateIncidentCapaPdf(inc.id, {
                    name: selectedLocation.name,
                  })
                } catch (err) {
                  console.error(err)
                  alert('Error generando PDF')
                }
              }}
            />
          ))}
        </div>
      )}

      {/* ============================ MODALES ============================ */}
      {openIncidentId && (
        <IncidentDetailModal
          incidentId={openIncidentId}
          onClose={() => setOpenIncidentId(null)}
          onUpdated={() => void reload()}
        />
      )}

      {showNewModal && selectedLocationId && (
        <NewIncidentModal
          locationId={selectedLocationId}
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            setShowNewModal(false)
            void reload()
          }}
        />
      )}

      {preview && (
        <ReportPreviewModal
          preview={preview}
          title={previewTitle}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

// ============================================================
// CARD DE INCIDENCIA EN LA LISTA
// ============================================================

function IncidentCard({
  incident, onClick, onPdf, onPreview,
}: {
  incident: AppccIncident
  onClick: () => void
  onPdf: () => void
  onPreview: () => void
}) {
  const isOpen = OPEN_STATUSES.includes(incident.status)

  const sla = useMemo(() => {
    if (!incident.due_at) return null
    const due = new Date(incident.due_at).getTime()
    const now = Date.now()
    const overdue = due < now && isOpen
    const diff = Math.abs(due - now)
    const h = Math.floor(diff / 3_600_000)
    const m = Math.floor((diff % 3_600_000) / 60_000)
    return {
      overdue,
      text: overdue ? `Vencido ${h}h ${m}m` : `${h}h ${m}m`,
    }
  }, [incident, isOpen])

  return (
    <div
      className={`bg-card rounded-lg border ${
        incident.escalated ? 'border-danger/40 ring-1 ring-danger/20' : 'border-border-default'
      } hover:shadow-sm transition-base overflow-hidden`}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left p-3 sm:p-4 hover:bg-page transition-base"
      >
        {/* Móvil: vertical */}
        <div className="sm:hidden space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${SEVERITY_STYLE[incident.severity]}`}>
              {SEVERITY_LABEL[incident.severity]}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[incident.status]}`}>
              {STATUS_LABEL[incident.status]}
            </span>
            {incident.escalated && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-danger text-text-on-accent font-semibold uppercase tracking-wider inline-flex items-center gap-0.5">
                <AlertTriangle size={9} /> ESC
              </span>
            )}
          </div>
          <div className="text-base font-medium text-text-primary">
            {incident.title}
          </div>
          <div className="text-xs text-text-secondary flex items-center gap-1.5 flex-wrap">
            {incident.source === 'auto' ? (
              <span className="inline-flex items-center gap-0.5"><Bot size={11} /> Auto</span>
            ) : (
              <span className="inline-flex items-center gap-0.5"><Hand size={11} /> Manual</span>
            )}
            <span>·</span>
            <span>{new Date(incident.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            {sla && (
              <span className={`inline-flex items-center gap-0.5 ${sla.overdue ? 'text-danger font-medium' : ''}`}>
                <span>·</span>
                {sla.overdue ? <AlertTriangle size={11} /> : <Clock size={11} />}
                {sla.text}
              </span>
            )}
          </div>
        </div>

        {/* Desktop: horizontal */}
        <div className="hidden sm:flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded font-semibold uppercase tracking-wider shrink-0 ${SEVERITY_STYLE[incident.severity]}`}>
            {SEVERITY_LABEL[incident.severity]}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium text-text-primary truncate">
              {incident.title}
            </div>
            <div className="text-xs text-text-secondary mt-0.5 flex items-center gap-2">
              {incident.source === 'auto' ? (
                <span className="inline-flex items-center gap-1"><Bot size={12} /> Auto</span>
              ) : (
                <span className="inline-flex items-center gap-1"><Hand size={12} /> Manual</span>
              )}
              <span>·</span>
              <span>{new Date(incident.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${STATUS_STYLE[incident.status]}`}>
            {STATUS_LABEL[incident.status]}
          </span>
          {incident.escalated && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-danger text-text-on-accent font-semibold uppercase tracking-wider inline-flex items-center gap-1 shrink-0">
              <AlertTriangle size={11} /> Escalada
            </span>
          )}
          {sla && (
            <span className={`text-xs shrink-0 inline-flex items-center gap-1 ${sla.overdue ? 'text-danger font-medium' : 'text-text-secondary'}`}>
              {sla.overdue ? <AlertTriangle size={12} /> : <Clock size={12} />}
              {sla.text}
            </span>
          )}
        </div>
      </button>

      {/* Acciones secundarias en una fila aparte */}
      <div className="px-3 sm:px-4 pb-2 sm:pb-3 -mt-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreview() }}
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-accent transition-base px-2 py-1"
        >
          <Eye size={12} /> Vista previa
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPdf() }}
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-accent transition-base px-2 py-1"
        >
          <FileDown size={12} /> PDF
        </button>
      </div>
    </div>
  )
}

// ============================================================
// MODAL "NUEVA INCIDENCIA MANUAL"
// ============================================================

function NewIncidentModal({
  locationId, onClose, onCreated,
}: {
  locationId: string
  onClose: () => void
  onCreated: () => void
}) {
  const { currentEmployee, isAdmin } = useApp()
  const { requireActiveAccountId } = useActiveAccount()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<AppccSeverity>('medium')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)

  const canCreate = !!currentEmployee || isAdmin
  const actorId: string | null = currentEmployee?.id ?? null

  async function submit() {
    if (!title.trim() || !canCreate) return
    setBusy(true)
    try {
      const accountId = requireActiveAccountId()
      await incidentsService.createManualIncident({
        accountId,
        locationId,
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        category: category.trim() || null,
        createdBy: actorId,
      })
      onCreated()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border-default p-4 sm:p-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Nueva incidencia</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary p-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Título *
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ej: Frigorífico fuera de temperatura"
              className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Severidad
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['low', 'medium', 'high', 'critical'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`px-2 py-2 text-xs rounded-md font-medium transition-base ${
                    severity === s
                      ? SEVERITY_STYLE[s]
                      : 'bg-card border border-border-default text-text-secondary hover:bg-page'
                  }`}
                >
                  {SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-secondary mt-1">
              SLA automático: crítica 2h · alta 8h · media 24h · baja 72h
            </p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="¿Qué ocurrió? ¿Qué impacto tiene?"
              rows={3}
              className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Categoría (opcional)
            </label>
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="Ej: temperaturas, limpieza, equipamiento…"
              className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
            />
          </div>
        </div>

        <div className="border-t border-border-default p-4 sm:p-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 bg-card border border-border-default text-text-secondary rounded-md text-sm font-medium hover:bg-page transition-base disabled:opacity-50 min-h-touch"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || busy}
            className="flex-1 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
          >
            {busy ? 'Creando…' : 'Crear incidencia'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// HELPERS
// ============================================================

function FilterBtn({
  active, onClick, label, tone = 'default',
}: {
  active: boolean
  onClick: () => void
  label: string
  tone?: 'default' | 'danger'
}) {
  const baseActive =
    tone === 'danger'
      ? 'bg-danger text-text-on-accent'
      : 'bg-accent text-text-on-accent'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-base ${
        active
          ? baseActive
          : 'bg-card border border-border-default text-text-secondary hover:bg-page'
      }`}
    >
      {label}
    </button>
  )
}
