// src/pages/trabajador/MisVacaciones.tsx
import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Plus, Sun } from 'lucide-react'
import { Card } from '../../components/ui'
import type { Employee } from '../../types'
import type { VacationRequest, VacationType, VacationSettings } from '../../types/personal'
import { VACATION_TYPES, ALWAYS_AVAILABLE_VACATION_TYPE } from '../../types/personal'
import {
  fetchVacations, requestVacation, cancelVacation,
  fetchVacationSettings, naturalDaysBetween, leadDays, availableDays,
} from '../../services/vacationsService'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MisVacaciones({ employee, onBack }: Props) {
  const [vacations, setVacations] = useState<VacationRequest[]>([])
  const [settings, setSettings] = useState<VacationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRequest, setShowRequest] = useState(false)

  // Form state
  const [type, setType] = useState<VacationType>('vacaciones')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const [vs, settingsList] = await Promise.all([
      fetchVacations(employee.id),
      fetchVacationSettings(),
    ])
    setVacations(vs || [])
    const global = (settingsList || []).find(s => s.scope === 'global')
    setSettings(global || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [employee.id])

  // Tipos que el trabajador PUEDE solicitar: todos los del catálogo menos los
  // deshabilitados por el gestor. 'vacaciones' es núcleo y siempre se muestra,
  // aunque por error estuviera en la lista negra. Si los ajustes aún cargan
  // (settings null), la lista negra es vacía → se muestran todos (no ocultamos
  // nada por error mientras carga).
  const availableTypes = useMemo(() => {
    const disabled = settings?.requestTypesDisabled ?? []
    return VACATION_TYPES.filter(
      t => t.id === ALWAYS_AVAILABLE_VACATION_TYPE || !disabled.includes(t.id)
    )
  }, [settings])

  // Saldo
  const saldoVacaciones = useMemo(() => {
    if (!settings) return null
    return availableDays(employee, vacations, 'vacaciones', settings.vacationDaysPerYear)
  }, [vacations, settings, employee])

  // Validaciones del form
  const dias = startDate && endDate ? naturalDaysBetween(startDate, endDate) : 0
  const lead = startDate ? leadDays(startDate) : 0
  const minLead = settings?.minLeadDays || 30
  const leadAlert = startDate && lead < minLead

  function openRequest() {
    // Asegurar que el tipo seleccionado es uno disponible (por defecto vacaciones).
    setType(availableTypes.some(t => t.id === type) ? type : ALWAYS_AVAILABLE_VACATION_TYPE)
    setShowRequest(true)
  }

  async function handleSubmit() {
    if (!startDate || !endDate) { setError('Indica fechas de inicio y fin'); return }
    if (new Date(endDate) < new Date(startDate)) { setError('La fecha de fin no puede ser anterior a la de inicio'); return }
    if (dias === 0) { setError('Indica un rango de fechas válido'); return }

    setSubmitting(true); setError('')
    try {
      await requestVacation(employee.id, type, startDate, endDate, dias, notes, !!leadAlert)
      await load()
      setShowRequest(false)
      setType('vacaciones'); setStartDate(''); setEndDate(''); setNotes('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(v: VacationRequest) {
    if (!confirm('¿Cancelar esta solicitud?')) return
    await cancelVacation(v.id)
    await load()
  }

  function typeLabel(t: string): string {
    return VACATION_TYPES.find(x => x.id === t)?.label || t
  }

  function statusBadge(s: VacationRequest['status']) {
    const map = {
      solicitada: { label: 'Pendiente', cls: 'bg-warning-bg text-warning' },
      aprobada:   { label: 'Aprobada',   cls: 'bg-success-bg text-success' },
      rechazada:  { label: 'Rechazada',  cls: 'bg-danger-bg text-danger' },
      cancelada:  { label: 'Cancelada',  cls: 'bg-accent-bg text-text-secondary' },
    }
    return map[s]
  }

  return (
    <div className="min-h-screen bg-page p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver"><ArrowLeft size={20} /></button>
          <div className="flex-1">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mis vacaciones</p>
            <p className="font-bold text-text-primary">{employee.name.split(' ')[0]}</p>
          </div>
          <button onClick={openRequest}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent text-text-on-accent text-xs font-medium hover:bg-accent-hover transition-base">
            <Plus size={12} /> Solicitar
          </button>
        </div>

        {loading ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-text-secondary">Cargando...</p>
          </Card>
        ) : (
          <>
            {/* Saldo */}
            <div className="mb-4">
              <Card className="p-4 text-center">
                <p className="text-[10px] text-text-secondary uppercase tracking-wide">Vacaciones</p>
                <p className="text-3xl font-bold text-success mt-1">{saldoVacaciones?.available.toFixed(1) || '-'}</p>
                <p className="text-[10px] text-text-secondary">de {saldoVacaciones?.prorrateado.toFixed(1) || '-'} días disponibles</p>
              </Card>
            </div>

            {/* Lista */}
            {vacations.length === 0 ? (
              <Card className="p-6 text-center">
                <div className="flex justify-center mb-2"><Sun size={32} className="text-accent" /></div>
                <p className="font-semibold text-text-primary">Sin solicitudes</p>
                <p className="text-xs text-text-secondary mt-1">Pulsa "Solicitar" para pedir un día libre</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {vacations.map(v => {
                  const badge = statusBadge(v.status)
                  return (
                    <Card key={v.id} className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-text-primary text-sm">{typeLabel(v.type)}</p>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary">
                            {new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                            {' – '}
                            {new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                          <p className="text-[10px] text-text-secondary mt-0.5">{v.days} día{v.days !== 1 ? 's' : ''} naturales</p>
                          {v.notes && <p className="text-xs text-text-secondary mt-1 italic">"{v.notes}"</p>}
                          {v.reviewNotes && (
                            <p className="text-xs mt-1 px-2 py-1 rounded bg-page text-text-secondary">
                              {v.reviewNotes}
                            </p>
                          )}
                        </div>
                        {v.status === 'solicitada' && (
                          <button onClick={() => handleCancel(v)}
                            className="text-xs px-2 py-1 rounded bg-danger-bg text-danger hover:bg-danger-bg shrink-0">
                            Cancelar
                          </button>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Modal solicitud */}
        {showRequest && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
            <div className="bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
              <p className="font-bold text-lg mb-4">Solicitar ausencia</p>

              <label className="text-xs text-text-secondary block mb-1">Tipo</label>
              <select value={type} onChange={e => setType(e.target.value as VacationType)}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card mb-3">
                {availableTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-xs text-text-secondary block mb-1">Desde</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full border border-border-default rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-text-secondary block mb-1">Hasta</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full border border-border-default rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {dias > 0 && (
                <div className="bg-page rounded-lg p-2 mb-3 text-xs text-text-secondary">
                  {dias} día{dias !== 1 ? 's' : ''} natural{dias !== 1 ? 'es' : ''}
                </div>
              )}

              {leadAlert && (
                <div className="bg-warning-bg border border-warning/30 rounded-lg p-2 mb-3 text-xs text-warning">
                  Estás pidiendo con solo {lead} día{lead !== 1 ? 's' : ''} de antelación. La política recomienda {minLead} días. La solicitud quedará marcada para que el encargado lo valore.
                </div>
              )}

              <label className="text-xs text-text-secondary block mb-1">Motivo (opcional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Ej: Boda de un familiar..."
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

              {error && <p className="text-sm text-danger mb-2">{error}</p>}

              <button onClick={handleSubmit} disabled={submitting || !startDate || !endDate}
                className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
                {submitting ? 'Enviando...' : 'Enviar solicitud'}
              </button>

              <button onClick={() => { setShowRequest(false); setError('') }}
                className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
