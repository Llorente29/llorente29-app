// src/modules/appcc/components/IncidentDetailModal.tsx
// Modal completo de gestión de incidencia con workflow CAPA.
// Pasos visibles según estado:
//   1. Asignación (si open)
//   2. Investigación + Root Cause (5 Whys)
//   3. Acción correctiva + foto evidencia
//   4. Acción preventiva (opcional)
//   5. Verificación por supervisor
//   6. Cierre con firma
//   + Timeline visual + Fotos + Acciones rápidas

import { useEffect, useMemo, useState } from 'react'
import {
  X as XIcon,
  AlertTriangle,
  Clock,
  Bot,
  Hand,
  UserPlus,
  Search,
  Wrench,
  Lightbulb,
  ShieldCheck,
  Lock,
  RotateCcw,
  Trash2,
  Camera,
  ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/context/AppContext'
import * as incidentsService from '@/modules/appcc/services/incidentsService'
import * as photosService from '@/modules/appcc/services/photosService'
import IncidentTimeline from './IncidentTimeline'
import type {
  AppccIncident,
  AppccIncidentEvent,
  AppccIncidentPhoto,
  AppccRootCauseMethod,
} from '@/modules/appcc/types'
import { SEVERITY_LABEL, STATUS_LABEL, OPEN_STATUSES } from '@/modules/appcc/types'

interface Props {
  incidentId: string
  onClose: () => void
  onUpdated: () => void
}

export default function IncidentDetailModal({ incidentId, onClose, onUpdated }: Props) {
  const { staff, currentEmployee, isAdmin, adminEmail } = useApp()

  // Identidad operativa para registrar quién hace cada acción:
  // - Si hay employee seleccionado (PIN): usamos su employee.id como actor
  // - Si es admin sin employee: actor_id = null, actor_name = email del admin
  const actorId: string | null = currentEmployee?.id ?? null
  const actorName: string = currentEmployee?.name ?? (isAdmin ? (adminEmail ?? 'Admin') : 'Anónimo')
  const canOperate: boolean = !!currentEmployee || isAdmin

  const [incident, setIncident] = useState<AppccIncident | null>(null)
  const [events, setEvents] = useState<AppccIncidentEvent[]>([])
  const [photos, setPhotos] = useState<AppccIncidentPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'workflow' | 'timeline' | 'photos'>('workflow')

  // Lista de empleados disponibles para asignar (solo activos)
  const users = useMemo(
    () =>
      staff
        .filter(e => e.active)
        .map(e => ({ id: e.id, display_name: e.name || '(sin nombre)' }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'es')),
    [staff]
  )

  // Estado de formularios (workflow CAPA)
  const [assignTo, setAssignTo] = useState<string>('')
  const [rootCauseText, setRootCauseText] = useState('')
  const [rootCauseMethod, setRootCauseMethod] = useState<AppccRootCauseMethod>('direct')
  const [whys, setWhys] = useState<string[]>(['', '', '', '', ''])
  const [correctiveText, setCorrectiveText] = useState('')
  const [preventiveText, setPreventiveText] = useState('')
  const [verifyEffective, setVerifyEffective] = useState<boolean | null>(null)
  const [verifyNotes, setVerifyNotes] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoEvidenceType, setPhotoEvidenceType] = useState<'problem' | 'corrective' | 'verification'>('problem')


  // ---------- Cargar detalle ----------
  async function load() {
    setLoading(true)
    try {
      const detail = await incidentsService.getIncidentDetail(incidentId)
      if (detail) {
        setIncident(detail.incident)
        setEvents(detail.events)
        setPhotos(detail.photos)
        // Prefill desde estado actual
        setAssignTo(detail.incident.assigned_to ?? '')
        setRootCauseText(detail.incident.root_cause ?? '')
        setRootCauseMethod(detail.incident.root_cause_method ?? 'direct')
        if (
          detail.incident.root_cause_data &&
          Array.isArray((detail.incident.root_cause_data as { whys?: string[] }).whys)
        ) {
          const ws = (detail.incident.root_cause_data as { whys: string[] }).whys
          setWhys([...ws, '', '', '', '', ''].slice(0, 5))
        }
        setCorrectiveText(detail.incident.corrective_action ?? '')
        setPreventiveText(detail.incident.preventive_action ?? '')
      }
    } catch (err) {
      console.error('[IncidentDetailModal] load error', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId])

  // ---------- Cerrar con ESC ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // ---------- Estado del SLA ----------
  const sla = useMemo(() => {
    if (!incident?.due_at) return null
    const due = new Date(incident.due_at).getTime()
    const now = Date.now()
    const diffMs = due - now
    const overdue = diffMs < 0 && OPEN_STATUSES.includes(incident.status)
    const absMs = Math.abs(diffMs)
    const hours = Math.floor(absMs / (60 * 60 * 1000))
    const minutes = Math.floor((absMs % (60 * 60 * 1000)) / (60 * 1000))
    return {
      overdue,
      label: overdue
        ? `Vencido hace ${hours}h ${minutes}m`
        : `Quedan ${hours}h ${minutes}m`,
      escalated: incident.escalated,
    }
  }, [incident])

  // ---------- Acciones ----------
  async function withBusy(fn: () => Promise<unknown>) {
    if (!incident) return
    setBusy(true)
    try {
      await fn()
      await load()
      onUpdated()
    } catch (err) {
      console.error('[IncidentDetailModal] action error', err)
      alert((err as Error).message || 'Error en la operación')
    } finally {
      setBusy(false)
    }
  }

  async function doAssign() {
    if (!canOperate || !assignTo) return
    await withBusy(() =>
      incidentsService.assignIncident({
        incidentId,
        userId: assignTo,
        byUserId: actorId,
        byUserName: actorName,
      })
    )
  }

  async function doStartInvestigation() {
    if (!canOperate) return
    await withBusy(() =>
      incidentsService.startInvestigation(incidentId, actorId, actorName)
    )
  }

  async function doSaveRootCause() {
    if (!canOperate || !rootCauseText.trim()) return
    const data: Record<string, unknown> | undefined =
      rootCauseMethod === '5whys' ? { whys: whys.filter(w => w.trim()) } : undefined
    await withBusy(() =>
      incidentsService.setRootCause({
        incidentId,
        rootCause: rootCauseText.trim(),
        method: rootCauseMethod,
        data,
        byUserId: actorId,
        byUserName: actorName,
      })
    )
  }

  async function doApplyCorrective() {
    if (!canOperate || !correctiveText.trim()) return
    await withBusy(() =>
      incidentsService.applyCorrective({
        incidentId,
        correctiveAction: correctiveText.trim(),
        byUserId: actorId,
        byUserName: actorName,
      })
    )
  }

  async function doApplyPreventive() {
    if (!canOperate || !preventiveText.trim()) return
    await withBusy(() =>
      incidentsService.applyPreventive({
        incidentId,
        preventiveAction: preventiveText.trim(),
        byUserId: actorId,
        byUserName: actorName,
      })
    )
  }

  async function doVerify() {
    if (!canOperate || verifyEffective === null) return
    await withBusy(() =>
      incidentsService.verifyIncident({
        incidentId,
        effective: verifyEffective,
        notes: verifyNotes.trim() || undefined,
        byUserId: actorId,
        byUserName: actorName,
      })
    )
    setVerifyEffective(null)
    setVerifyNotes('')
  }

  async function doClose() {
    if (!canOperate || !incident) return
    // Firma SHA-256 simple de timestamp + actorId + incidentId
    const payload = `${incidentId}|${actorId ?? "admin"}|${Date.now()}`
    const buf = new TextEncoder().encode(payload)
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    const signature = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    await withBusy(() =>
      incidentsService.closeIncident({
        incidentId,
        signature,
        byUserId: actorId,
        byUserName: actorName,
      })
    )
  }

  async function doReject() {
    if (!canOperate || !rejectReason.trim()) return
    await withBusy(() =>
      incidentsService.rejectIncident({
        incidentId,
        reason: rejectReason.trim(),
        byUserId: actorId,
        byUserName: actorName,
      })
    )
    setRejectReason('')
  }

  async function doReopen() {
    if (!canOperate) return
    const reason = window.prompt('Motivo de la reapertura:')
    if (!reason) return
    await withBusy(() =>
      incidentsService.reopenIncident(incidentId, reason, actorId, actorName)
    )
  }

  async function handlePhotoUpload(file: File) {
    if (!canOperate || !incident) return
    setPhotoUploading(true)
    try {
      const path = `incidents/${incident.account_id}/${incidentId}/${Date.now()}-${file.name}`
      const compressed = await photosService.compressImage(file)
      const { error: upErr } = await (supabase!).storage
        .from('appcc-photos')
        .upload(path, compressed, { contentType: compressed.type })
      if (upErr) throw upErr
      await incidentsService.addIncidentPhoto(
        incidentId,
        path,
        photoEvidenceType,
        null,
        actorId
      )
      await load()
      onUpdated()
    } catch (err) {
      console.error('[IncidentDetailModal] handlePhotoUpload error', err)
      alert((err as Error).message)
    } finally {
      setPhotoUploading(false)
    }
  }

  async function deletePhoto(photoId: string) {
    if (!window.confirm('¿Eliminar esta foto?')) return
    setBusy(true)
    try {
      await incidentsService.deleteIncidentPhoto(photoId)
      await load()
      onUpdated()
    } finally {
      setBusy(false)
    }
  }

  if (loading || !incident) {
    return (
      <ModalShell onClose={onClose}>
        <div className="p-8 text-center text-text-secondary">Cargando…</div>
      </ModalShell>
    )
  }

  const isOpen = OPEN_STATUSES.includes(incident.status)
  const isClosed = incident.status === 'closed' || incident.status === 'verified' || incident.status === 'rejected'

  // Determinar qué pasos están activos/completados
  const canAssign = incident.status === 'open'
  const canStartInvestigation = incident.status === 'assigned'
  const canSetRootCause = ['assigned', 'investigating'].includes(incident.status)
  const canApplyCorrective = ['investigating', 'assigned'].includes(incident.status)
  const canApplyPreventive = incident.status === 'corrected' || !!incident.corrective_action
  const canVerify = incident.status === 'corrected'
  const canClose = incident.status === 'verified'
  const canReopen = isClosed
  const canReject = isOpen && incident.status !== 'corrected'

  return (
    <ModalShell onClose={onClose}>
      {/* ============================ HEADER ============================ */}
      <div className="border-b border-border-default p-4 sm:p-5 shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <SeverityPill severity={incident.severity} />
              <StatusPill status={incident.status} />
              {incident.escalated && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-danger-bg text-danger font-semibold uppercase tracking-wider inline-flex items-center gap-1">
                  <AlertTriangle size={11} /> Escalada
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-text-primary leading-tight">
              {incident.title}
            </h2>
            <div className="text-sm text-text-secondary mt-1 flex items-center gap-2 flex-wrap">
              {incident.source === 'auto' ? (
                <span className="inline-flex items-center gap-1">
                  <Bot size={13} /> Auto
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Hand size={13} /> Manual
                </span>
              )}
              <span>·</span>
              <span>
                Creada{' '}
                {new Date(incident.created_at).toLocaleString('es-ES', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
              {sla && (
                <>
                  <span>·</span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      sla.overdue ? 'text-danger font-medium' : 'text-text-secondary'
                    }`}
                  >
                    {sla.overdue ? <AlertTriangle size={13} /> : <Clock size={13} />}
                    {sla.label}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 -mt-2 text-text-secondary hover:text-text-primary hover:bg-page rounded-md transition-base"
            aria-label="Cerrar"
          >
            <XIcon size={20} />
          </button>
        </div>

        {incident.description && (
          <p className="mt-3 text-sm text-text-primary bg-page p-3 rounded-md">
            {incident.description}
          </p>
        )}

        {/* Tabs */}
        <div className="mt-4 flex border-b border-border-default -mb-px overflow-x-auto -mx-4 px-4 sm:-mx-5 sm:px-5">
          {(['workflow', 'timeline', 'photos'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-base whitespace-nowrap ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t === 'workflow' && 'Workflow CAPA'}
              {t === 'timeline' && `Timeline (${events.length})`}
              {t === 'photos' && `Fotos (${photos.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ============================ BODY ============================ */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
        {/* -------------------- WORKFLOW TAB -------------------- */}
        {tab === 'workflow' && (
          <>
            {/* PASO 1: ASIGNACIÓN */}
            <Step
              number={1}
              title="Asignación"
              Icon={UserPlus}
              completed={!!incident.assigned_to}
              active={canAssign}
              disabled={!canAssign && !incident.assigned_to}
            >
              {incident.assigned_to ? (
                <div className="text-sm text-text-secondary">
                  Asignada a{' '}
                  <span className="font-medium text-text-primary">
                    {users.find(u => u.id === incident.assigned_to)?.display_name ?? incident.assigned_to}
                  </span>
                  {incident.assigned_at && (
                    <> el {new Date(incident.assigned_at).toLocaleString('es-ES')}</>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    value={assignTo}
                    onChange={e => setAssignTo(e.target.value)}
                    className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
                  >
                    <option value="">— Selecciona responsable —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={doAssign}
                    disabled={!assignTo || busy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
                  >
                    <UserPlus size={15} /> Asignar
                  </button>
                </div>
              )}
              {canStartInvestigation && (
                <button
                  type="button"
                  onClick={doStartInvestigation}
                  disabled={busy}
                  className="mt-2 inline-flex items-center gap-2 px-3 py-2 bg-card border border-accent text-accent rounded-md text-sm font-medium hover:bg-accent-bg transition-base disabled:opacity-50"
                >
                  <Search size={14} /> Empezar investigación
                </button>
              )}
            </Step>

            {/* PASO 2: ROOT CAUSE */}
            <Step
              number={2}
              title="Análisis de causa raíz"
              Icon={Search}
              completed={!!incident.root_cause}
              active={canSetRootCause}
              disabled={!canSetRootCause && !incident.root_cause}
            >
              {incident.root_cause && !canSetRootCause ? (
                <div className="text-sm text-text-primary bg-page p-3 rounded-md">
                  <div className="text-xs uppercase tracking-wider text-text-secondary mb-1">
                    Método: {incident.root_cause_method}
                  </div>
                  {incident.root_cause}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">Método</label>
                    <div className="flex gap-2 flex-wrap">
                      {(['direct', '5whys', 'fishbone', 'other'] as const).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setRootCauseMethod(m)}
                          className={`px-3 py-1.5 text-xs rounded-md font-medium transition-base ${
                            rootCauseMethod === m
                              ? 'bg-accent text-text-on-accent'
                              : 'bg-card border border-border-default text-text-secondary hover:bg-page'
                          }`}
                        >
                          {m === 'direct' && 'Directo'}
                          {m === '5whys' && '5 Porqués'}
                          {m === 'fishbone' && 'Ishikawa'}
                          {m === 'other' && 'Otro'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {rootCauseMethod === '5whys' && (
                    <div className="space-y-2 bg-page p-3 rounded-md">
                      <div className="text-xs uppercase tracking-wider text-text-secondary">
                        Cinco porqués
                      </div>
                      {whys.map((w, i) => (
                        <input
                          key={i}
                          type="text"
                          value={w}
                          onChange={e => {
                            const copy = [...whys]
                            copy[i] = e.target.value
                            setWhys(copy)
                          }}
                          placeholder={`¿Por qué? #${i + 1}`}
                          className="w-full px-3 py-2 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      ))}
                    </div>
                  )}

                  <textarea
                    value={rootCauseText}
                    onChange={e => setRootCauseText(e.target.value)}
                    placeholder="Conclusión: ¿cuál es la causa raíz?"
                    rows={3}
                    className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={doSaveRootCause}
                    disabled={!rootCauseText.trim() || busy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
                  >
                    Guardar análisis
                  </button>
                </div>
              )}
            </Step>

            {/* PASO 3: ACCIÓN CORRECTIVA */}
            <Step
              number={3}
              title="Acción correctiva"
              Icon={Wrench}
              completed={!!incident.corrective_action}
              active={canApplyCorrective}
              disabled={!canApplyCorrective && !incident.corrective_action}
            >
              {incident.corrective_action && incident.status !== 'investigating' ? (
                <div className="text-sm text-text-primary bg-success-bg p-3 rounded-md border border-success/20">
                  <div className="text-xs uppercase tracking-wider text-success mb-1">
                    Aplicada{incident.corrective_action_at &&
                      ` el ${new Date(incident.corrective_action_at).toLocaleString('es-ES')}`}
                  </div>
                  {incident.corrective_action}
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={correctiveText}
                    onChange={e => setCorrectiveText(e.target.value)}
                    placeholder="Describe la acción aplicada para corregir el problema (qué, quién, cuándo)"
                    rows={3}
                    className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={doApplyCorrective}
                    disabled={!correctiveText.trim() || busy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-success-bg text-success border border-success/30 rounded-md text-sm font-medium hover:opacity-90 transition-base disabled:opacity-50 min-h-touch"
                  >
                    <Wrench size={15} /> Aplicar acción correctiva
                  </button>
                </div>
              )}
            </Step>

            {/* PASO 4: ACCIÓN PREVENTIVA */}
            <Step
              number={4}
              title="Acción preventiva (opcional)"
              Icon={Lightbulb}
              completed={!!incident.preventive_action}
              active={canApplyPreventive && !incident.preventive_action}
              disabled={!canApplyPreventive}
            >
              {incident.preventive_action ? (
                <div className="text-sm text-text-primary bg-page p-3 rounded-md">
                  {incident.preventive_action}
                </div>
              ) : canApplyPreventive ? (
                <div className="space-y-2">
                  <textarea
                    value={preventiveText}
                    onChange={e => setPreventiveText(e.target.value)}
                    placeholder="¿Qué se hará para evitar que vuelva a ocurrir?"
                    rows={2}
                    className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={doApplyPreventive}
                    disabled={!preventiveText.trim() || busy}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border-default text-text-primary rounded-md text-sm font-medium hover:bg-page transition-base disabled:opacity-50"
                  >
                    <Lightbulb size={14} /> Añadir prevención
                  </button>
                </div>
              ) : (
                <div className="text-sm text-text-secondary italic">
                  Disponible tras aplicar la acción correctiva.
                </div>
              )}
            </Step>

            {/* PASO 5: VERIFICACIÓN */}
            <Step
              number={5}
              title="Verificación de efectividad"
              Icon={ShieldCheck}
              completed={!!incident.verified_at}
              active={canVerify}
              disabled={!canVerify && !incident.verified_at}
            >
              {incident.verified_at ? (
                <div
                  className={`text-sm p-3 rounded-md ${
                    incident.verification_effective
                      ? 'bg-success-bg text-success border border-success/20'
                      : 'bg-warning-bg text-warning border border-warning/20'
                  }`}
                >
                  <div className="text-xs uppercase tracking-wider mb-1">
                    {incident.verification_effective ? 'Efectiva ✓' : 'No efectiva ⚠'}
                  </div>
                  {incident.verification_notes && (
                    <div>{incident.verification_notes}</div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-text-secondary">
                    ¿La acción correctiva ha sido efectiva?
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVerifyEffective(true)}
                      className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-base ${
                        verifyEffective === true
                          ? 'bg-success text-text-on-accent'
                          : 'bg-card border border-border-default text-text-secondary hover:bg-page'
                      }`}
                    >
                      ✓ Sí, efectiva
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerifyEffective(false)}
                      className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-base ${
                        verifyEffective === false
                          ? 'bg-warning text-text-on-accent'
                          : 'bg-card border border-border-default text-text-secondary hover:bg-page'
                      }`}
                    >
                      ✗ No, revisar
                    </button>
                  </div>
                  <textarea
                    value={verifyNotes}
                    onChange={e => setVerifyNotes(e.target.value)}
                    placeholder="Notas de verificación (opcional)"
                    rows={2}
                    className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={doVerify}
                    disabled={verifyEffective === null || busy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
                  >
                    <ShieldCheck size={15} /> Verificar
                  </button>
                </div>
              )}
            </Step>

            {/* PASO 6: CIERRE */}
            <Step
              number={6}
              title="Cierre formal"
              Icon={Lock}
              completed={incident.status === 'closed'}
              active={canClose}
              disabled={!canClose && incident.status !== 'closed'}
            >
              {incident.status === 'closed' ? (
                <div className="text-sm text-success">
                  Cerrada{incident.closed_at &&
                    ` el ${new Date(incident.closed_at).toLocaleString('es-ES')}`}
                  {incident.closure_signature && (
                    <div className="text-xs text-text-secondary mt-1 font-mono">
                      Firma: {incident.closure_signature.slice(0, 16)}…
                    </div>
                  )}
                </div>
              ) : canClose ? (
                <button
                  type="button"
                  onClick={doClose}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50 min-h-touch"
                >
                  <Lock size={15} /> Cerrar con firma electrónica
                </button>
              ) : (
                <div className="text-sm text-text-secondary italic">
                  Disponible tras verificar la efectividad.
                </div>
              )}
            </Step>

            {/* Acciones secundarias */}
            <div className="pt-3 border-t border-border-default flex gap-2 flex-wrap">
              {canReopen && (
                <button
                  type="button"
                  onClick={doReopen}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm text-warning border border-warning/30 rounded-md hover:bg-warning-bg transition-base disabled:opacity-50"
                >
                  <RotateCcw size={14} /> Reabrir
                </button>
              )}
              {canReject && (
                <details className="group">
                  <summary className="inline-flex items-center gap-2 px-3 py-2 text-sm text-text-secondary border border-border-default rounded-md hover:bg-page transition-base cursor-pointer list-none">
                    <XIcon size={14} /> Descartar
                    <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="mt-2 p-3 bg-page rounded-md space-y-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Motivo (duplicada, no aplica…)"
                      className="w-full px-3 py-2 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={doReject}
                      disabled={!rejectReason.trim() || busy}
                      className="px-3 py-1.5 bg-danger text-text-on-accent rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      Confirmar descarte
                    </button>
                  </div>
                </details>
              )}
            </div>
          </>
        )}

        {/* -------------------- TIMELINE TAB -------------------- */}
        {tab === 'timeline' && (
          <IncidentTimeline events={events} />
        )}

        {/* -------------------- PHOTOS TAB -------------------- */}
        {tab === 'photos' && (
          <PhotosSection
            photos={photos}
            uploading={photoUploading}
            evidenceType={photoEvidenceType}
            setEvidenceType={setPhotoEvidenceType}
            onUpload={handlePhotoUpload}
            onDelete={deletePhoto}
            canEdit={isOpen}
          />
        )}
      </div>
    </ModalShell>
  )
}

// ============================================================
// SUB-COMPONENTES
// ============================================================

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function Step({
  number, title, Icon, completed, active, disabled, children,
}: {
  number: number
  title: string
  Icon: typeof Search
  completed: boolean
  active: boolean
  disabled: boolean
  children: React.ReactNode
}) {
  const tone = completed
    ? { bg: 'bg-success-bg', icon: 'text-success', border: 'border-success/30' }
    : active
    ? { bg: 'bg-accent-bg', icon: 'text-accent', border: 'border-accent/30' }
    : { bg: 'bg-page', icon: 'text-text-secondary', border: 'border-border-default' }

  return (
    <section
      className={`border rounded-lg p-3 sm:p-4 ${tone.border} ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`shrink-0 w-9 h-9 rounded-full ${tone.bg} ${tone.icon} flex items-center justify-center font-bold text-sm`}
        >
          {completed ? '✓' : number}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={16} className={tone.icon} />
          <h3 className="font-semibold text-sm sm:text-base text-text-primary truncate">
            {title}
          </h3>
        </div>
      </div>
      <div className="pl-0 sm:pl-12">{children}</div>
    </section>
  )
}

function SeverityPill({ severity }: { severity: AppccIncident['severity'] }) {
  const classes = {
    critical: 'bg-danger text-text-on-accent',
    high: 'bg-warning text-text-on-accent',
    medium: 'bg-warning-bg text-warning',
    low: 'bg-accent-bg text-accent',
  }[severity]
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-semibold uppercase tracking-wider ${classes}`}>
      {SEVERITY_LABEL[severity]}
    </span>
  )
}

function StatusPill({ status }: { status: AppccIncident['status'] }) {
  const classes: Record<typeof status, string> = {
    open: 'bg-danger-bg text-danger',
    assigned: 'bg-warning-bg text-warning',
    investigating: 'bg-accent-bg text-accent',
    corrected: 'bg-success-bg text-success',
    verified: 'bg-success-bg text-success',
    closed: 'bg-page text-text-secondary',
    rejected: 'bg-page text-text-secondary',
  } as const
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${classes[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function PhotosSection({
  photos, uploading, evidenceType, setEvidenceType, onUpload, onDelete, canEdit,
}: {
  photos: AppccIncidentPhoto[]
  uploading: boolean
  evidenceType: 'problem' | 'corrective' | 'verification'
  setEvidenceType: (v: 'problem' | 'corrective' | 'verification') => void
  onUpload: (f: File) => void
  onDelete: (id: string) => void
  canEdit: boolean
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    Promise.all(
      photos.map(async p => {
        const { data } = await supabase!.storage
          .from('appcc-photos')
          .createSignedUrl(p.storage_path, 3600)
        return [p.id, data?.signedUrl ?? ''] as const
      })
    ).then(entries => {
      if (cancelled) return
      setUrls(new Map(entries))
    })
    return () => {
      cancelled = true
    }
  }, [photos])

  const grouped = useMemo(() => {
    const map: Record<string, AppccIncidentPhoto[]> = {
      problem: [], corrective: [], verification: [], other: [],
    }
    photos.forEach(p => {
      const k = p.photo_kind ?? 'other'
      map[k] = map[k] || []
      map[k].push(p)
    })
    return map
  }, [photos])

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="border border-border-default rounded-lg p-3 bg-page space-y-3">
          <div className="text-xs uppercase tracking-wider text-text-secondary">
            Añadir evidencia
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['problem', 'corrective', 'verification'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setEvidenceType(t)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-base ${
                  evidenceType === t
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-card border border-border-default text-text-secondary hover:bg-page'
                }`}
              >
                {t === 'problem' && '🔴 Del problema'}
                {t === 'corrective' && '🔧 De la corrección'}
                {t === 'verification' && '✅ De verificación'}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium cursor-pointer hover:bg-accent-hover transition-base min-h-touch">
            <Camera size={15} />
            {uploading ? 'Subiendo…' : 'Tomar foto / Subir'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={uploading}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-text-secondary italic">
          Sin fotos adjuntas todavía.
        </p>
      ) : (
        (['problem', 'corrective', 'verification', 'other'] as const).map(group => {
          const arr = grouped[group]
          if (!arr || arr.length === 0) return null
          const labelMap = {
            problem: 'Del problema',
            corrective: 'De la corrección',
            verification: 'De verificación',
            other: 'Otras',
          }
          return (
            <div key={group}>
              <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">
                {labelMap[group]} ({arr.length})
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {arr.map(p => {
                  const url = urls.get(p.id)
                  return (
                    <div
                      key={p.id}
                      className="relative aspect-square rounded-md overflow-hidden bg-page border border-border-default group"
                    >
                      {url ? (
                        <img
                          src={url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-text-secondary text-xs">
                          …
                        </div>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onDelete(p.id)}
                          className="absolute top-1 right-1 p-1 bg-card/90 text-danger rounded shadow opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Eliminar"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
