// src/modules/appcc/audits/AuditsPage.tsx
// Lista de auditorías + botón "Nueva auditoría" + acceso a ejecución.
//
// BLOQUE C Fases 2-3 (17/05/2026):
//   - Eliminada prop `onOpenAudit`.
//   - Navegación a ejecución de auditoría vía useNavigate +
//     pageToRoute('appcc_audit_execution', ...).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, Plus, Calendar, Filter, CheckCircle2,
  AlertTriangle, PlayCircle, XCircle, User,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { pageToRoute } from '@/routes'
import * as auditsService from './auditsService'
import type {
  Audit,
  AuditStatus,
  AuditTemplate,
} from './types'
import { STATUS_LABEL, RECURRENCE_LABEL } from './types'

const STATUS_STYLE: Record<AuditStatus, string> = {
  scheduled:    'bg-accent-bg text-accent',
  in_progress:  'bg-warning-bg text-warning',
  completed:    'bg-success-bg text-success',
  overdue:      'bg-danger-bg text-danger',
  cancelled:    'bg-page text-text-secondary',
}

type FilterTab = 'pending' | 'completed' | 'all'

export default function AuditsPage() {
  const { locations } = useApp()
  const { activeAccount } = useActiveAccount()
  const navigate = useNavigate()
  const slug = activeAccount?.slug ?? 'folvy'

  const activeLocations = useMemo(
    () => locations.filter(l => l.active),
    [locations]
  )

  const [locationId, setLocationId] = useState<string>(
    activeLocations[0]?.id ?? ''
  )
  const [audits, setAudits] = useState<Audit[]>([])
  const [tab, setTab] = useState<FilterTab>('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    if (!locationId && activeLocations.length > 0) {
      setLocationId(activeLocations[0].id)
    }
  }, [activeLocations, locationId])

  async function reload() {
    if (!locationId) return
    setLoading(true)
    setError(null)
    try {
      const statuses: AuditStatus[] | undefined =
        tab === 'pending' ? ['scheduled', 'in_progress', 'overdue']
        : tab === 'completed' ? ['completed']
        : undefined
      const data = await auditsService.listAudits(locationId, statuses)
      setAudits(data)
    } catch (err) {
      console.error('[AuditsPage] reload error', err)
      setError(err instanceof Error ? err.message : 'Error cargando auditorías')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, tab])

  function openAudit(auditId: string) {
    navigate(pageToRoute('appcc_audit_execution', slug, { auditId }))
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display text-text-primary flex items-center gap-2">
            <ClipboardCheck size={26} className="text-accent" />
            Auditorías APPCC
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Revisiones periódicas con scoring y trazabilidad
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          disabled={!locationId}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
        >
          <Plus size={15} /> Nueva auditoría
        </button>
      </div>

      {/* FILTROS */}
      <div className="bg-card rounded-lg border border-border-default p-3 sm:p-4 grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5">
            Local
          </label>
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
            className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
          >
            {activeLocations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1.5 inline-flex items-center gap-1">
            <Filter size={11} /> Estado
          </label>
          <div className="flex gap-1 flex-wrap">
            <FilterBtn active={tab === 'pending'} onClick={() => setTab('pending')} label="Pendientes" />
            <FilterBtn active={tab === 'completed'} onClick={() => setTab('completed')} label="Completadas" />
            <FilterBtn active={tab === 'all'} onClick={() => setTab('all')} label="Todas" />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg text-danger rounded-md p-3 text-sm">{error}</div>
      )}

      {/* LISTA */}
      {loading ? (
        <div className="text-center text-text-secondary py-8">Cargando…</div>
      ) : audits.length === 0 ? (
        <div className="text-center text-text-secondary py-12 bg-card rounded-lg border border-border-default">
          <ClipboardCheck size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium text-text-primary mb-1">Sin auditorías</p>
          <p className="text-sm">
            {tab === 'pending'
              ? 'No tienes auditorías pendientes. Crea una con "Nueva auditoría".'
              : tab === 'completed'
              ? 'Aún no se ha completado ninguna auditoría.'
              : 'Sin auditorías en este local.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {audits.map(a => (
            <AuditCard
              key={a.id}
              audit={a}
              onOpen={() => openAudit(a.id)}
            />
          ))}
        </div>
      )}

      {/* MODAL NUEVA */}
      {showNew && locationId && (
        <NewAuditModal
          locationId={locationId}
          onClose={() => setShowNew(false)}
          onCreated={(auditId) => {
            setShowNew(false)
            void reload()
            openAudit(auditId)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// CARD
// ============================================================

function AuditCard({ audit, onOpen }: { audit: Audit; onOpen: () => void }) {
  const isCompleted = audit.status === 'completed'
  const scoreColor = audit.final_score == null ? 'text-text-secondary'
    : audit.passed ? 'text-success' : 'text-danger'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full bg-card rounded-lg border border-border-default hover:shadow-sm transition-base text-left p-3 sm:p-4"
    >
      <div className="flex items-start sm:items-center gap-3 flex-col sm:flex-row">
        {/* Icono según estado */}
        <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          isCompleted
            ? (audit.passed ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger')
            : audit.status === 'in_progress' ? 'bg-warning-bg text-warning'
            : audit.status === 'overdue' ? 'bg-danger-bg text-danger'
            : 'bg-accent-bg text-accent'
        }`}>
          {isCompleted
            ? (audit.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />)
            : audit.status === 'in_progress' ? <PlayCircle size={18} />
            : audit.status === 'overdue' ? <AlertTriangle size={18} />
            : <Calendar size={18} />
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[audit.status]}`}>
              {STATUS_LABEL[audit.status]}
            </span>
            <span className="text-xs text-text-secondary">
              {new Date(audit.scheduled_date).toLocaleDateString('es-ES', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </span>
          </div>
          <div className="text-sm sm:text-base font-medium text-text-primary">
            Auditoría #{audit.id.slice(0, 8)}
          </div>
          <div className="text-xs text-text-secondary mt-1 inline-flex items-center gap-1">
            <User size={11} />
            {audit.auditor_name ? `Auditor: ${audit.auditor_name}` : 'Sin auditor asignado'}
          </div>
          {audit.notes && (
            <div className="text-xs text-text-secondary mt-1 line-clamp-1">
              {audit.notes}
            </div>
          )}
        </div>

        {/* Score */}
        {audit.final_score != null && (
          <div className="text-right shrink-0">
            <div className={`text-2xl sm:text-3xl font-bold tabular-nums ${scoreColor}`}>
              {audit.final_score}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-secondary">
              {audit.passed ? 'Aprobada' : 'No aprobada'}
            </div>
          </div>
        )}
      </div>
    </button>
  )
}

// ============================================================
// MODAL NUEVA AUDITORÍA
// ============================================================

function NewAuditModal({
  locationId, onClose, onCreated,
}: {
  locationId: string
  onClose: () => void
  onCreated: (auditId: string) => void
}) {
  const { staff } = useApp()
  const { requireActiveAccountId } = useActiveAccount()
  const [templates, setTemplates] = useState<AuditTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [scheduledDate, setScheduledDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [auditorId, setAuditorId] = useState<string>('')  // '' = sin asignar
  const [busy, setBusy] = useState(false)
  const [loadingTpl, setLoadingTpl] = useState(true)

  const activeStaff = useMemo(
    () => staff.filter(e => e.active)
      .map(e => ({ id: e.id, name: e.name || '(sin nombre)' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [staff]
  )

  useEffect(() => {
    auditsService.listTemplates().then(t => {
      setTemplates(t)
      if (t.length > 0) setSelectedTemplateId(t[0].id)
      setLoadingTpl(false)
    }).catch(err => {
      console.error(err)
      setLoadingTpl(false)
    })
  }, [])

  async function submit() {
    if (!selectedTemplateId) return
    setBusy(true)
    try {
      const accountId = requireActiveAccountId()
      const auditorName = auditorId
        ? activeStaff.find(s => s.id === auditorId)?.name ?? null
        : null
      const audit = await auditsService.createAudit({
        accountId,
        locationId,
        templateId: selectedTemplateId,
        scheduledDate,
        auditorId: auditorId || null,
        auditorName,
      })
      onCreated(audit.id)
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
        className="bg-card w-full sm:max-w-md max-h-[95vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border-default p-4 sm:p-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Nueva auditoría</h2>
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loadingTpl ? (
            <div className="text-center text-text-secondary py-4">Cargando plantillas…</div>
          ) : templates.length === 0 ? (
            <div className="text-sm text-text-secondary">
              No hay plantillas de auditoría disponibles. Ejecuta el SQL de seed.
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-2">
                  Plantilla
                </label>
                <div className="space-y-2">
                  {templates.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(t.id)}
                      className={`w-full text-left p-3 rounded-md border-2 transition-base ${
                        selectedTemplateId === t.id
                          ? 'border-accent bg-accent-bg'
                          : 'border-border-default bg-card hover:border-accent'
                      }`}
                    >
                      <div className="font-medium text-sm text-text-primary">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-text-secondary mt-1">{t.description}</div>
                      )}
                      <div className="text-[10px] uppercase tracking-wider text-text-secondary mt-2">
                        {RECURRENCE_LABEL[t.recurrence]} · Umbral aprobado: {t.pass_score}%
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                  Fecha programada
                </label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
                />
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                  Auditor (opcional)
                </label>
                <select
                  value={auditorId}
                  onChange={e => setAuditorId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
                >
                  <option value="">— Asignar al ejecutar —</option>
                  {activeStaff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <p className="text-xs text-text-secondary mt-1">
                  Si no asignas, será el primero en abrirla.
                </p>
              </div>
            </>
          )}
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
            disabled={!selectedTemplateId || busy || templates.length === 0}
            className="flex-1 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
          >
            {busy ? 'Creando…' : 'Crear y empezar'}
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
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-base ${
        active
          ? 'bg-accent text-text-on-accent'
          : 'bg-card border border-border-default text-text-secondary hover:bg-page'
      }`}
    >
      {label}
    </button>
  )
}
