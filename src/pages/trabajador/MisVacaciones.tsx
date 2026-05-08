// src/pages/trabajador/MisVacaciones.tsx
import { useState, useEffect, useMemo } from 'react'
import { Card } from '../../components/ui'
import type { Employee } from '../../types'
import type { VacationRequest, VacationType, VacationSettings } from '../../types/personal'
import { VACATION_TYPES } from '../../types/personal'
import {
  fetchVacations, requestVacation, cancelVacation,
  fetchVacationSettings, workingDaysBetween, leadDays, availableDays,
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

  // Saldos
  const saldoVacaciones = useMemo(() => {
    if (!settings) return null
    return availableDays(employee, vacations, 'vacaciones', settings.vacationDaysPerYear)
  }, [vacations, settings, employee])

  const saldoAsuntos = useMemo(() => {
    if (!settings) return null
    return availableDays(employee, vacations, 'asuntos_propios', settings.asuntosPropiosPerYear)
  }, [vacations, settings, employee])

  // Validaciones del form
  const dias = startDate && endDate ? workingDaysBetween(startDate, endDate) : 0
  const lead = startDate ? leadDays(startDate) : 0
  const minLead = settings?.minLeadDays || 30
  const leadAlert = startDate && lead < minLead

  async function handleSubmit() {
    if (!startDate || !endDate) { setError('Indica fechas de inicio y fin'); return }
    if (new Date(endDate) < new Date(startDate)) { setError('La fecha de fin no puede ser anterior a la de inicio'); return }
    if (dias === 0) { setError('El rango no incluye días laborables'); return }

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
      solicitada: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
      aprobada:   { label: 'Aprobada',   cls: 'bg-emerald-100 text-emerald-700' },
      rechazada:  { label: 'Rechazada',  cls: 'bg-red-100 text-red-700' },
      cancelada:  { label: 'Cancelada',  cls: 'bg-gray-100 text-gray-600' },
    }
    return map[s]
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div className="flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Mis vacaciones</p>
            <p className="font-bold text-gray-900">{employee.name.split(' ')[0]}</p>
          </div>
          <button onClick={() => setShowRequest(true)}
            className="px-3 py-1.5 rounded-full bg-teal-600 text-white text-xs font-medium hover:bg-teal-700">
            + Solicitar
          </button>
        </div>

        {loading ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-gray-500">Cargando...</p>
          </Card>
        ) : (
          <>
            {/* Saldos */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Card className="p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Vacaciones</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1">{saldoVacaciones?.available.toFixed(1) || '-'}</p>
                <p className="text-[10px] text-gray-500">de {saldoVacaciones?.prorrateado.toFixed(1) || '-'} días</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Asuntos propios</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{saldoAsuntos?.available.toFixed(1) || '-'}</p>
                <p className="text-[10px] text-gray-500">de {saldoAsuntos?.prorrateado.toFixed(1) || '-'} días</p>
              </Card>
            </div>

            {/* Lista */}
            {vacations.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-4xl mb-2">🏖️</p>
                <p className="font-semibold text-gray-700">Sin solicitudes</p>
                <p className="text-xs text-gray-500 mt-1">Pulsa "Solicitar" para pedir un día libre</p>
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
                            <p className="font-semibold text-gray-900 text-sm">{typeLabel(v.type)}</p>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600">
                            {new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                            {' – '}
                            {new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{v.days} día{v.days !== 1 ? 's' : ''} laborables</p>
                          {v.notes && <p className="text-xs text-gray-500 mt-1 italic">"{v.notes}"</p>}
                          {v.reviewNotes && (
                            <p className="text-xs mt-1 px-2 py-1 rounded bg-gray-50 text-gray-600">
                              💬 {v.reviewNotes}
                            </p>
                          )}
                        </div>
                        {v.status === 'solicitada' && (
                          <button onClick={() => handleCancel(v)}
                            className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 shrink-0">
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
            <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
              <p className="font-bold text-lg mb-4">Solicitar ausencia</p>

              <label className="text-xs text-gray-500 block mb-1">Tipo</label>
              <select value={type} onChange={e => setType(e.target.value as VacationType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-3">
                {VACATION_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Desde</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Hasta</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {dias > 0 && (
                <div className="bg-gray-50 rounded-lg p-2 mb-3 text-xs text-gray-600">
                  {dias} día{dias !== 1 ? 's' : ''} laborable{dias !== 1 ? 's' : ''}
                </div>
              )}

              {leadAlert && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-800">
                  ⚠️ Estás pidiendo con solo {lead} día{lead !== 1 ? 's' : ''} de antelación. La política recomienda {minLead} días. La solicitud quedará marcada para que el encargado lo valore.
                </div>
              )}

              <label className="text-xs text-gray-500 block mb-1">Motivo (opcional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Ej: Boda de un familiar..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

              {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

              <button onClick={handleSubmit} disabled={submitting || !startDate || !endDate}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-50">
                {submitting ? 'Enviando...' : 'Enviar solicitud'}
              </button>

              <button onClick={() => { setShowRequest(false); setError('') }}
                className="w-full py-2 mt-2 text-sm text-gray-500 hover:text-gray-700">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
