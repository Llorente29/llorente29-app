// src/pages/SolicitudesPendientesPage.tsx
// Panel del gestor con todas las solicitudes pendientes de aprobar.
import { useState, useEffect } from 'react'
import { Clock, Check, FileText, CheckCircle2, Inbox, AlertTriangle, MessageSquare, X, Settings, Lock } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useActiveAccount } from '../modules/multitenancy/hooks/useActiveAccount'
import { Card, Button } from '../components/ui'
import type { VacationRequest, VacationStatus, VacationType, VacationSettings } from '../types/personal'
import { VACATION_TYPES, ALWAYS_AVAILABLE_VACATION_TYPE } from '../types/personal'
import {
  fetchPendingVacations, fetchVacations, reviewVacation,
  fetchVacationSettings, updateDisabledRequestTypes,
} from '../services/vacationsService'
import { isSupabaseEnabled } from '../lib/supabase'
import { supabase } from '../lib/supabase'

type FilterTab = 'pendientes' | 'aprobadas' | 'todas'

export default function SolicitudesPendientesPage() {
  const { staff } = useApp()
  const { activeAccountId } = useActiveAccount()
  const [filter, setFilter] = useState<FilterTab>('pendientes')
  const [vacations, setVacations] = useState<VacationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewModal, setReviewModal] = useState<{ vac: VacationRequest; action: 'aprobar' | 'rechazar' } | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  // Configuración: tipos de ausencia que los empleados pueden solicitar.
  const [settings, setSettings] = useState<VacationSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [savingType, setSavingType] = useState<VacationType | null>(null)
  const [settingsError, setSettingsError] = useState('')

  async function load() {
    setLoading(true)
    if (filter === 'pendientes') {
      const list = await fetchPendingVacations()
      setVacations(list || [])
    } else {
      const list = await fetchVacations()
      const filtered = filter === 'aprobadas'
        ? (list || []).filter(v => v.status === 'aprobada')
        : (list || [])
      setVacations(filtered)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  // Cargar la configuración global de LA CUENTA ACTIVA. Un superadmin puede ver
  // varias cuentas, así que acotamos por account_id; sin cuenta activa no hay
  // qué configurar.
  useEffect(() => {
    let cancelled = false
    if (!activeAccountId) { setSettings(null); return }
    fetchVacationSettings(activeAccountId).then(list => {
      if (cancelled) return
      const global = (list || []).find(s => s.scope === 'global')
      setSettings(global || null)
    })
    return () => { cancelled = true }
  }, [activeAccountId])

  // Realtime: refrescar cuando cambian las vacaciones
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb.channel('solicitudes-pendientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  function employeeName(id: string): string {
    return staff.find(e => e.id === id)?.name || 'Empleado desconocido'
  }

  function employeePosition(id: string): string {
    return staff.find(e => e.id === id)?.position || ''
  }

  // Calcular si quedaría poco personal el día solicitado
  function staffAvailableOnDay(employeeId: string, date: string, locationId?: string): { total: number; afterApproval: number } {
    // Empleados activos del mismo local (usar location_id principal o assigned_locations)
    const emp = staff.find(e => e.id === employeeId)
    const targetLoc = locationId || emp?.locationId || ''
    const peers = staff.filter(e =>
      e.active && e.id !== employeeId &&
      (e.locationId === targetLoc || (e.assignedLocations || []).includes(targetLoc))
    )
    // Contar cuántos están de vacaciones aprobadas ese día (de los datos cargados)
    const onLeave = vacations.filter(v =>
      v.status === 'aprobada' &&
      peers.some(p => p.id === v.employeeId) &&
      date >= v.startDate && date <= v.endDate
    )
    const total = peers.length - onLeave.length
    return { total: total + 1, afterApproval: total } // +1 = el solicitante (si estuviera trabajando)
  }

  async function doReview() {
    if (!reviewModal) return
    // Comprobar si saltaría aviso de mínimo de plantilla
    let alertMin = false
    if (reviewModal.action === 'aprobar') {
      const { afterApproval } = staffAvailableOnDay(reviewModal.vac.employeeId, reviewModal.vac.startDate)
      // settings min_staff es 2 por defecto
      if (afterApproval < 2) alertMin = true
    }
    await reviewVacation(reviewModal.vac.id, reviewModal.action === 'aprobar' ? 'aprobada' : 'rechazada', null, reviewNotes, alertMin)
    setReviewModal(null); setReviewNotes('')
    await load()
  }

  // Activar/desactivar un tipo en el selector del trabajador (lista negra),
  // en la fila global de la cuenta activa.
  async function toggleType(t: VacationType, enabled: boolean) {
    if (t === ALWAYS_AVAILABLE_VACATION_TYPE) return // núcleo, no se apaga
    if (!activeAccountId) { setSettingsError('No hay una empresa activa seleccionada.'); return }
    setSettingsError('')
    const current = settings?.requestTypesDisabled ?? []
    const next = enabled ? current.filter(x => x !== t) : Array.from(new Set([...current, t]))
    setSavingType(t)
    const ok = await updateDisabledRequestTypes(activeAccountId, next)
    if (ok && settings) {
      setSettings({ ...settings, requestTypesDisabled: next })
    } else if (!ok) {
      setSettingsError('No se pudo guardar. Revisa que exista la configuración de vacaciones de esta empresa.')
    }
    setSavingType(null)
  }

  function statusBadge(s: VacationStatus) {
    const map = {
      solicitada: { label: 'Pendiente', cls: 'bg-warning-bg text-warning' },
      aprobada:   { label: 'Aprobada',  cls: 'bg-success-bg text-success' },
      rechazada:  { label: 'Rechazada', cls: 'bg-danger-bg text-danger' },
      cancelada:  { label: 'Cancelada', cls: 'bg-accent-bg text-text-secondary' },
    }
    return map[s]
  }

  function typeLabel(t: string): string {
    return VACATION_TYPES.find(x => x.id === t)?.label || t
  }

  // Para el modal de aprobación: mostrar cuántos quedarían
  const reviewStaffInfo = reviewModal && reviewModal.action === 'aprobar'
    ? staffAvailableOnDay(reviewModal.vac.employeeId, reviewModal.vac.startDate)
    : null
  const reviewMinStaffWarning = reviewStaffInfo && reviewStaffInfo.afterApproval < 2

  const disabledTypes = settings?.requestTypesDisabled ?? []

  return (
    <div className="space-y-4">
      {/* Tabs + ajustes */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {([
            { id: 'pendientes' as FilterTab, label: 'Pendientes', Icon: Clock },
            { id: 'aprobadas' as FilterTab,  label: 'Aprobadas',  Icon: Check },
            { id: 'todas' as FilterTab,      label: 'Todas',      Icon: FileText },
          ]).map(t => {
            const TabIcon = t.Icon
            return (
              <button key={t.id} onClick={() => setFilter(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-base ${
                  filter === t.id
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-card border border-border-default text-text-secondary hover:border-accent'
                }`}>
                <TabIcon size={14} /> {t.label}
              </button>
            )
          })}
        </div>
        <button onClick={() => { setShowSettings(true); setSettingsError('') }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-card border border-border-default text-text-secondary hover:border-accent transition-base"
          title="Configurar qué pueden solicitar los empleados">
          <Settings size={14} /> Ajustes
        </button>
      </div>

      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-text-secondary">Cargando...</p></Card>
      ) : vacations.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex justify-center mb-3">
            {filter === 'pendientes'
              ? <CheckCircle2 size={48} className="text-success" />
              : <Inbox size={48} className="text-text-secondary" />}
          </div>
          <p className="font-semibold text-text-primary">
            {filter === 'pendientes' ? '¡Todo al día!' : 'Sin solicitudes'}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {filter === 'pendientes' ? 'No hay solicitudes pendientes de aprobar' : 'Aún no se han registrado solicitudes'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {vacations.map(v => {
            const badge = statusBadge(v.status)
            const employee = staff.find(e => e.id === v.employeeId)
            const initials = (employee?.name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
            return (
              <Card key={v.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-accent-bg flex items-center justify-center">
                    <span className="text-sm font-bold text-accent">{initials || '?'}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-text-primary text-sm">{employeeName(v.employeeId)}</p>
                      <span className="text-xs text-text-secondary">{employeePosition(v.employeeId)}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    </div>

                    <p className="text-sm font-medium text-text-primary">{typeLabel(v.type)}</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      {' – '}
                      {new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                      <span className="ml-2 text-text-secondary">({v.days} día{v.days !== 1 ? 's' : ''})</span>
                    </p>

                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {v.alertLeadTime && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                          <AlertTriangle size={10} /> Antelación corta
                        </span>
                      )}
                      {v.alertMinStaff && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                          <AlertTriangle size={10} /> Mínimo de plantilla
                        </span>
                      )}
                    </div>

                    {v.notes && <p className="text-xs text-text-secondary mt-2 italic">"{v.notes}"</p>}
                    {v.reviewNotes && (
                      <p className="text-xs mt-2 px-2 py-1 rounded bg-page text-text-secondary inline-flex items-center gap-1">
                        <MessageSquare size={11} /> {v.reviewNotes}
                      </p>
                    )}
                    <p className="text-[10px] text-text-secondary mt-1.5">
                      Solicitada el {new Date(v.requestedAt).toLocaleDateString('es-ES')}
                      {v.reviewedAt && ` · Revisada el ${new Date(v.reviewedAt).toLocaleDateString('es-ES')}`}
                    </p>
                  </div>

                  {v.status === 'solicitada' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="sm" onClick={() => setReviewModal({ vac: v, action: 'aprobar' })}>
                        Aprobar
                      </Button>
                      <button onClick={() => setReviewModal({ vac: v, action: 'rechazar' })}
                        className="text-xs px-3 py-1.5 rounded bg-danger-bg text-danger hover:bg-danger-bg font-medium">
                        Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal review */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl max-w-md w-full p-5">
            <p className="font-bold text-lg inline-flex items-center gap-1.5 text-text-primary">
              {reviewModal.action === 'aprobar' ? <><Check size={18} className="text-success" /> Aprobar solicitud</> : <><X size={18} className="text-danger" /> Rechazar solicitud</>}
            </p>
            <p className="text-sm text-text-secondary mt-1">
              {employeeName(reviewModal.vac.employeeId)} · {typeLabel(reviewModal.vac.type)} · {reviewModal.vac.days} día{reviewModal.vac.days !== 1 ? 's' : ''}
            </p>

            {reviewMinStaffWarning && (
              <div className="bg-warning-bg border border-warning/30 rounded-lg p-3 mt-3 text-xs text-warning inline-flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span><strong>Mínimo de plantilla:</strong> si apruebas, ese día solo quedarían {reviewStaffInfo?.afterApproval} personas trabajando en su local. ¿Seguro?</span>
              </div>
            )}

            {reviewModal.vac.alertLeadTime && reviewModal.action === 'aprobar' && (
              <div className="bg-warning-bg border border-warning/30 rounded-lg p-3 mt-3 text-xs text-warning inline-flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span><strong>Antelación corta:</strong> esta solicitud se hizo con menos antelación de la recomendada.</span>
              </div>
            )}

            <label className="text-xs text-text-secondary block mt-4 mb-1">Comentario (opcional)</label>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
              placeholder={reviewModal.action === 'aprobar' ? 'Disfrútalas' : 'Motivo del rechazo'}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm h-20 resize-none mb-3" />

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setReviewModal(null); setReviewNotes('') }} className="flex-1">Cancelar</Button>
              <Button onClick={doReview} className="flex-1">
                {reviewModal.action === 'aprobar' ? 'Aprobar' : 'Rechazar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajustes: tipos que los empleados pueden solicitar */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
            <p className="font-bold text-lg inline-flex items-center gap-1.5 text-text-primary">
              <Settings size={18} className="text-accent" /> Tipos que pueden solicitar
            </p>
            <p className="text-xs text-text-secondary mt-1 mb-4">
              Elige qué tipos de ausencia ven tus empleados al solicitar desde el portal.
              Lo que apagues deja de aparecer en su selector; no afecta a solicitudes ya
              hechas, y tú puedes seguir registrando cualquier tipo manualmente.
            </p>

            {!activeAccountId ? (
              <div className="bg-warning-bg border border-warning/30 rounded-lg p-3 text-xs text-warning">
                Selecciona una empresa para configurar los tipos de solicitud.
              </div>
            ) : (
              <>
                {settingsError && (
                  <div className="bg-danger-bg border border-danger/30 rounded-lg p-2 mb-3 text-xs text-danger">
                    {settingsError}
                  </div>
                )}

                <div className="space-y-1.5">
                  {VACATION_TYPES.map(t => {
                    const isCore = t.id === ALWAYS_AVAILABLE_VACATION_TYPE
                    const enabled = isCore || !disabledTypes.includes(t.id)
                    const saving = savingType === t.id
                    return (
                      <label key={t.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-base ${
                          isCore
                            ? 'border-border-default bg-page cursor-default'
                            : 'border-border-default hover:border-accent cursor-pointer'
                        }`}>
                        <span className="text-sm text-text-primary inline-flex items-center gap-1.5">
                          {t.label}
                          {isCore && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary">
                              <Lock size={10} /> Siempre disponible
                            </span>
                          )}
                        </span>
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded accent-accent disabled:opacity-60"
                          checked={enabled}
                          disabled={isCore || saving || !settings}
                          onChange={e => toggleType(t.id, e.target.checked)}
                        />
                      </label>
                    )
                  })}
                </div>

                {!settings && (
                  <p className="text-[11px] text-text-secondary mt-3">
                    No se ha podido cargar la configuración de vacaciones de esta empresa.
                  </p>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="w-full mt-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-base">
              Hecho
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
