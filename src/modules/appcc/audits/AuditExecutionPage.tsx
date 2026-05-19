// src/modules/appcc/audits/AuditExecutionPage.tsx
// Página de ejecución de una auditoría: ítem por ítem, scoring en vivo, cierre con firma.
//
// BLOQUE C Fases 2-3 (17/05/2026):
//   - Eliminadas props `auditId` y `onBack`.
//   - auditId leído con useParams.
//   - Navegación de "Volver" vía useNavigate + pageToRoute('appcc_audits', ...).
//   - Si la URL llega sin auditId válido, se redirige a appcc_audits.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Check, X, Minus, AlertTriangle, ClipboardCheck,
  Lock, Loader2, Eye, FileDown, ChevronRight, User,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { pageToRoute } from '@/routes'
import * as auditsService from './auditsService'
import * as auditPdfService from './auditPdfExportService'
import ReportPreviewModal from '@/components/ReportPreviewModal'
import type { PdfPreviewResult } from '@/modules/appcc/services/pdfExportService'
import type {
  AuditDetail,
  AuditScoring,
} from './auditsService'
import type { AuditItem, AuditResponse } from './types'

export default function AuditExecutionPage() {
  const { auditId } = useParams<{ auditId: string }>()
  const navigate = useNavigate()
  const { currentEmployee, isAdmin, adminEmail, locations } = useApp()
  const { activeAccount } = useActiveAccount()
  const slug = activeAccount?.slug ?? 'foodint'
  const actorId = currentEmployee?.id ?? null
  const actorName = currentEmployee?.name ?? (isAdmin ? (adminEmail ?? 'Admin') : 'Anónimo')

  // Si la URL no trae auditId, volver a Auditorías con replace.
  useEffect(() => {
    if (!auditId) {
      navigate(pageToRoute('appcc_audits', slug), { replace: true })
    }
  }, [auditId, navigate, slug])

  function goBack() {
    navigate(pageToRoute('appcc_audits', slug))
  }

  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingItem, setSavingItem] = useState<string | null>(null)
  const [closingNotes, setClosingNotes] = useState('')
  const [closing, setClosing] = useState(false)
  const [preview, setPreview] = useState<PdfPreviewResult | null>(null)

  const locationName = useMemo(() => {
    const l = locations.find(loc => loc.id === detail?.audit.location_id)
    return l?.name ?? 'Local'
  }, [locations, detail?.audit.location_id])

  async function load() {
    if (!auditId) return
    setLoading(true)
    setError(null)
    try {
      const d = await auditsService.getAuditDetail(auditId)
      if (!d) throw new Error('Auditoría no encontrada')
      setDetail(d)
      setClosingNotes(d.audit.notes ?? '')

      // Si está scheduled, marcarla como in_progress al abrir
      if (d.audit.status === 'scheduled') {
        await auditsService.startAudit(auditId, actorId, actorName)
        const refreshed = await auditsService.getAuditDetail(auditId)
        if (refreshed) setDetail(refreshed)
      }
    } catch (err) {
      console.error('[AuditExecutionPage] load error', err)
      setError(err instanceof Error ? err.message : 'Error cargando auditoría')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId])

  // Scoring en vivo
  const scoring: AuditScoring | null = useMemo(() => {
    if (!detail) return null
    return auditsService.calculateScoring(detail.template, detail.responses)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail])

  const isLocked = detail?.audit.status === 'completed' || detail?.audit.status === 'cancelled'

  // ---------- Guardar respuesta ----------
  async function saveResponse(item: AuditItem, value: string | null) {
    if (!detail || isLocked) return
    setSavingItem(item.id)
    try {
      const section = detail.template.sections.find(s => s.items.some(i => i.id === item.id))
      if (!section) return
      const response = await auditsService.upsertResponse({
        auditId: detail.audit.id,
        itemId: item.id,
        value,
        actorId,
        item,
        audit: detail.audit,
        templateName: detail.template.name,
        sectionName: section.name,
      })
      // Actualizar local
      setDetail(prev => {
        if (!prev) return prev
        const others = prev.responses.filter(r => r.item_id !== item.id)
        return { ...prev, responses: [...others, response] }
      })
    } catch (err) {
      console.error('[AuditExecutionPage] saveResponse error', err)
      alert((err as Error).message)
    } finally {
      setSavingItem(null)
    }
  }

  // ---------- Cerrar auditoría ----------
  async function handleClose() {
    if (!detail) return
    if (!window.confirm('¿Cerrar auditoría? Se calculará el scoring final y se firmará.')) return
    setClosing(true)
    try {
      await auditsService.completeAudit(detail.audit.id, actorId, closingNotes.trim() || null)
      const refreshed = await auditsService.getAuditDetail(detail.audit.id)
      if (refreshed) setDetail(refreshed)
    } catch (err) {
      console.error('[AuditExecutionPage] close error', err)
      alert((err as Error).message)
    } finally {
      setClosing(false)
    }
  }

  // ---------- PDF ----------
  async function handlePdf(mode: 'preview' | 'download') {
    if (!detail) return
    try {
      const result = await auditPdfService.generateAuditPdf(
        detail.audit.id,
        { name: locationName },
        { mode },
      )
      if (mode === 'preview' && result) setPreview(result)
    } catch (err) {
      console.error('[AuditExecutionPage] pdf error', err)
      alert((err as Error).message)
    }
  }

  // Guard: sin auditId, no renderizar nada (el useEffect ya redirigió).
  if (!auditId) {
    return null
  }

  // ---------- Render ----------
  if (loading) {
    return <div className="text-center py-12 text-text-secondary">Cargando auditoría…</div>
  }
  if (error || !detail) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={goBack} className="text-accent text-sm inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Volver
        </button>
        <div className="bg-danger-bg text-danger rounded-md p-3 text-sm">{error}</div>
      </div>
    )
  }

  const total = detail.template.sections.reduce((acc, s) => acc + s.items.length, 0)
  const answered = detail.responses.filter(r => r.value).length
  const completion = total > 0 ? Math.round((answered / total) * 100) : 0
  const canClose = !isLocked && answered === total

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-12">
      {/* HEADER */}
      <button
        type="button"
        onClick={goBack}
        className="text-accent text-sm inline-flex items-center gap-1 hover:underline"
      >
        <ArrowLeft size={14} /> Volver
      </button>

      <div className="bg-card rounded-lg border border-border-default p-4 sm:p-5">
        <div className="flex items-start gap-3 flex-wrap">
          <ClipboardCheck size={28} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-display text-text-primary">
              {detail.template.name}
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {locationName} · {new Date(detail.audit.scheduled_date).toLocaleDateString('es-ES')}
            </p>
            <p className="text-sm text-text-secondary mt-0.5 inline-flex items-center gap-1">
              <User size={12} />
              {detail.audit.auditor_name ?? 'Auditor sin asignar'}
            </p>
            {detail.template.description && (
              <p className="text-sm text-text-primary mt-2">{detail.template.description}</p>
            )}
          </div>
        </div>

        {/* Scoring en vivo */}
        {scoring && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <ScoreBox label="Score actual" value={`${scoring.totalScore}`} suffix="/100"
              tone={scoring.totalScore >= detail.template.pass_score ? 'success' : 'danger'} />
            <ScoreBox label="Progreso" value={`${completion}`} suffix="%" tone="neutral"
              subtitle={`${answered}/${total} ítems`} />
            <ScoreBox label="Fallos" value={`${scoring.itemsFailures}`}
              tone={scoring.itemsFailures > 0 ? 'warning' : 'neutral'} />
          </div>
        )}

        {/* Barra de progreso */}
        <div className="mt-3 h-2 bg-page rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      {/* Si está cerrada, banner de estado */}
      {isLocked && (
        <div className={`rounded-lg p-3 sm:p-4 border ${
          detail.audit.passed
            ? 'bg-success-bg border-success/30 text-success'
            : 'bg-danger-bg border-danger/30 text-danger'
        }`}>
          <div className="flex items-center gap-2 font-semibold">
            <Lock size={16} />
            Auditoría cerrada — {detail.audit.passed ? 'APROBADA' : 'NO APROBADA'}
          </div>
          {detail.audit.completed_at && (
            <div className="text-xs mt-1 opacity-80">
              {new Date(detail.audit.completed_at).toLocaleString('es-ES')}
            </div>
          )}
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handlePdf('preview')}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-current/30 rounded-md text-xs font-medium hover:bg-page transition-base"
            >
              <Eye size={13} /> Vista previa
            </button>
            <button
              type="button"
              onClick={() => handlePdf('download')}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-current/30 rounded-md text-xs font-medium hover:bg-page transition-base"
            >
              <FileDown size={13} /> Descargar PDF
            </button>
          </div>
        </div>
      )}

      {/* SECCIONES */}
      {detail.template.sections.map((section, sIdx) => {
        const secScore = scoring?.sectionScores.find(s => s.sectionId === section.id)
        return (
          <div key={section.id} className="bg-card rounded-lg border border-border-default overflow-hidden">
            <div className="bg-page px-4 py-3 border-b border-border-default flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-text-primary inline-flex items-center gap-2">
                  <ChevronRight size={14} className="text-accent" />
                  {sIdx + 1}. {section.name}
                </h2>
                {section.description && (
                  <p className="text-xs text-text-secondary mt-0.5">{section.description}</p>
                )}
              </div>
              {secScore && (
                <span className={`text-base font-bold tabular-nums ${
                  secScore.score >= detail.template.pass_score ? 'text-success' : 'text-warning'
                }`}>
                  {secScore.score}%
                </span>
              )}
            </div>

            <div className="divide-y divide-border-default">
              {section.items.map(item => {
                const response = detail.responses.find(r => r.item_id === item.id)
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    response={response}
                    disabled={isLocked || savingItem === item.id}
                    saving={savingItem === item.id}
                    onChange={(value) => saveResponse(item, value)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {/* CIERRE */}
      {!isLocked && (
        <div className="bg-card rounded-lg border border-border-default p-4 sm:p-5 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">Notas finales</h3>
          <textarea
            value={closingNotes}
            onChange={e => setClosingNotes(e.target.value)}
            rows={3}
            placeholder="Observaciones generales de la auditoría (opcional)"
            className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />

          {!canClose && (
            <div className="text-xs text-text-secondary inline-flex items-center gap-1.5">
              <AlertTriangle size={12} />
              Responde todos los ítems para poder cerrar la auditoría
              ({total - answered} pendientes)
            </div>
          )}

          <button
            type="button"
            disabled={!canClose || closing}
            onClick={handleClose}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-accent text-text-on-accent rounded-md text-base font-semibold hover:bg-accent-hover transition-base disabled:opacity-50 min-h-[52px]"
          >
            {closing ? (
              <><Loader2 size={16} className="animate-spin" /> Cerrando…</>
            ) : (
              <><Lock size={16} /> Cerrar auditoría con firma</>
            )}
          </button>
          <p className="text-[10px] text-text-secondary text-center">
            Firmada por {actorName}
          </p>
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <ReportPreviewModal
          preview={preview}
          title={`Auditoría ${detail.template.name}`}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

// ============================================================
// SUB-COMPONENTES
// ============================================================

function ScoreBox({
  label, value, suffix, subtitle, tone,
}: {
  label: string; value: string; suffix?: string; subtitle?: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  const colors = {
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
    neutral: 'bg-accent-bg text-accent',
  }[tone]
  return (
    <div className={`rounded-md p-3 ${colors}`}>
      <div className="text-xl sm:text-2xl font-bold tabular-nums">
        {value}{suffix && <span className="text-base font-normal opacity-70">{suffix}</span>}
      </div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5">{label}</div>
      {subtitle && <div className="text-xs opacity-70 mt-0.5">{subtitle}</div>}
    </div>
  )
}

function ItemRow({
  item, response, disabled, saving, onChange,
}: {
  item: AuditItem
  response: AuditResponse | undefined
  disabled: boolean
  saving: boolean
  onChange: (value: string | null) => void
}) {
  const value = response?.value ?? null

  return (
    <div className="p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 text-xs font-mono text-text-secondary mt-1 min-w-[2.5rem]">
          {item.code}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">{item.question}</div>
          {item.help_text && (
            <div className="text-xs text-text-secondary mt-1">{item.help_text}</div>
          )}
          {item.creates_incident_on_fail && (
            <div className="text-[10px] uppercase tracking-wider text-warning mt-1 inline-flex items-center gap-1">
              <AlertTriangle size={10} />
              Genera incidencia si falla
            </div>
          )}

          {/* Botones de respuesta */}
          <div className="mt-2.5 flex gap-1.5 flex-wrap items-center">
            {item.scoring_type === 'binary' || item.scoring_type === 'na_allowed' ? (
              <>
                <ResponseBtn
                  active={value === 'yes'} onClick={() => onChange('yes')}
                  disabled={disabled} Icon={Check} label="Sí" tone="success"
                />
                <ResponseBtn
                  active={value === 'no'} onClick={() => onChange('no')}
                  disabled={disabled} Icon={X} label="No" tone="danger"
                />
                {item.scoring_type === 'na_allowed' && (
                  <ResponseBtn
                    active={value === 'na'} onClick={() => onChange('na')}
                    disabled={disabled} Icon={Minus} label="N/A" tone="neutral"
                  />
                )}
              </>
            ) : (
              <>
                {(['0', '1', '2', '3', '4', '5'] as const).map(n => (
                  <ResponseBtn
                    key={n}
                    active={value === n} onClick={() => onChange(n)}
                    disabled={disabled} label={n}
                    tone={parseInt(n) >= 4 ? 'success' : parseInt(n) >= 3 ? 'neutral' : 'danger'}
                  />
                ))}
                <ResponseBtn
                  active={value === 'na'} onClick={() => onChange('na')}
                  disabled={disabled} Icon={Minus} label="N/A" tone="neutral"
                />
              </>
            )}
            {saving && <Loader2 size={14} className="animate-spin text-accent ml-1" />}
            {response?.incident_id && (
              <span className="text-[10px] uppercase tracking-wider text-danger ml-2 inline-flex items-center gap-1">
                <AlertTriangle size={10} /> Incidencia generada
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResponseBtn({
  active, onClick, disabled, Icon, label, tone,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  Icon?: typeof Check
  label: string
  tone: 'success' | 'danger' | 'neutral'
}) {
  const colors = active
    ? tone === 'success' ? 'bg-success text-text-on-accent'
      : tone === 'danger' ? 'bg-danger text-text-on-accent'
      : 'bg-accent text-text-on-accent'
    : 'bg-card border border-border-default text-text-secondary hover:bg-page'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[44px] h-9 px-2.5 rounded-md text-xs font-medium transition-base disabled:opacity-50 inline-flex items-center justify-center gap-1 ${colors}`}
    >
      {Icon && <Icon size={13} />}
      {label}
    </button>
  )
}
