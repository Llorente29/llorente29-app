// src/components/personal/VacacionesTab.tsx
// Pestaña de Vacaciones del empleado en la ficha del gestor.
import { useState, useEffect, useMemo } from 'react'
import { Card, Button } from '../ui'
import type { Employee } from '../../types'
import type { VacationRequest, VacationStatus, VacationType, VacationSettings } from '../../types/personal'
import { VACATION_TYPES } from '../../types/personal'
import {
  fetchVacations, reviewVacation, deleteVacation,
  fetchVacationSettings, availableDays, workingDaysBetween,
  requestVacation, updateVacationPaid,
} from '../../services/vacationsService'
import { createNotification } from '../../services/notificationsService'

interface Props {
  employee: Employee
}

export default function VacacionesTab({ employee }: Props) {
  const [vacations, setVacations] = useState<VacationRequest[]>([])
  const [settings, setSettings] = useState<VacationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewModal, setReviewModal] = useState<{ vac: VacationRequest; action: 'aprobar' | 'rechazar' } | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewPaid, setReviewPaid] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  // Form añadir manualmente
  const [type, setType] = useState<VacationType>('vacaciones')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [paid, setPaid] = useState(true)

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

  // Cuando se abre el modal de revisar, inicializar el toggle paid según el tipo y valor actual
  useEffect(() => {
    if (reviewModal) {
      const currentPaid = reviewModal.vac.paid
      if (currentPaid !== undefined) {
        setReviewPaid(currentPaid)
      } else {
        // Default según tipo
        const typeMeta = VACATION_TYPES.find(t => t.id === reviewModal.vac.type)
        setReviewPaid(typeMeta?.defaultPaid ?? true)
      }
    }
  }, [reviewModal])

  // Cuando cambia el tipo en el modal de añadir, ajustar el default de paid
  useEffect(() => {
    const typeMeta = VACATION_TYPES.find(t => t.id === type)
    setPaid(typeMeta?.defaultPaid ?? true)
  }, [type])

  const saldoVacaciones = useMemo(() => {
    if (!settings) return null
    return availableDays(employee, vacations, 'vacaciones', settings.vacationDaysPerYear)
  }, [vacations, settings, employee])

  const saldoAsuntos = useMemo(() => {
    if (!settings) return null
    return availableDays(employee, vacations, 'asuntos_propios', settings.asuntosPropiosPerYear)
  }, [vacations, settings, employee])

  async function doReview() {
    if (!reviewModal) return
    await reviewVacation(reviewModal.vac.id, reviewModal.action === 'aprobar' ? 'aprobada' : 'rechazada', null, reviewNotes, false)
    // Si se aprueba, actualizar también el flag paid (para que cuente correctamente en bolsa de horas)
    if (reviewModal.action === 'aprobar') {
      await updateVacationPaid(reviewModal.vac.id, reviewPaid)
    }

    // Crear notificación in-app para el trabajador (sin bloquear si falla)
    try {
      const v = reviewModal.vac
      const tipoLabel = typeLabel(v.type).toLowerCase()
      const fechaInicio = new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
      const fechaFin = new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
      const rangoFechas = v.startDate === v.endDate ? `el ${fechaInicio}` : `del ${fechaInicio} al ${fechaFin}`

      if (reviewModal.action === 'aprobar') {
        await createNotification(
          employee.id,
          'vacation_approved',
          '✅ Ausencia aprobada',
          `Tu solicitud de ${tipoLabel} ${rangoFechas} ha sido aprobada.`,
          { vacationId: v.id, type: v.type, startDate: v.startDate, endDate: v.endDate }
        )
      } else {
        const motivoTexto = reviewNotes.trim() ? `\nMotivo: ${reviewNotes.trim()}` : ''
        await createNotification(
          employee.id,
          'vacation_rejected',
          '❌ Ausencia rechazada',
          `Tu solicitud de ${tipoLabel} ${rangoFechas} ha sido rechazada.${motivoTexto}`,
          { vacationId: v.id, type: v.type, startDate: v.startDate, endDate: v.endDate }
        )
      }
    } catch (e) {
      console.warn('[VacacionesTab] No se pudo crear notificación:', e)
    }

    setReviewModal(null); setReviewNotes(''); setReviewPaid(true)
    await load()
  }

  async function handleDelete(v: VacationRequest) {
    if (!confirm(`¿Eliminar la solicitud del ${v.startDate}?`)) return
    await deleteVacation(v.id)
    await load()
  }

  async function togglePaid(v: VacationRequest) {
    const newPaid = !(v.paid ?? true)
    await updateVacationPaid(v.id, newPaid)
    await load()
  }

  async function handleAdd() {
    if (!startDate || !endDate) return
    const dias = workingDaysBetween(startDate, endDate)
    await requestVacation(employee.id, type, startDate, endDate, dias, notes, false, paid)
    // Si lo crea el gestor, lo aprobamos automáticamente
    const refreshed = await fetchVacations(employee.id)
    if (refreshed) {
      const last = refreshed.find(v => v.startDate === startDate && v.endDate === endDate && v.status === 'solicitada')
      if (last) {
        await reviewVacation(last.id, 'aprobada', null, '', false)
        // Asegurar que el campo paid queda con el valor que eligió el gestor
        await updateVacationPaid(last.id, paid)
      }
    }
    setShowAdd(false); setStartDate(''); setEndDate(''); setNotes(''); setType('vacaciones'); setPaid(true)
    await load()
  }

  function statusBadge(s: VacationStatus) {
    const map = {
      solicitada: { label: '⏳ Pendiente', cls: 'bg-amber-100 text-amber-700' },
      aprobada:   { label: '✓ Aprobada',   cls: 'bg-emerald-100 text-emerald-700' },
      rechazada:  { label: '✕ Rechazada',  cls: 'bg-red-100 text-red-700' },
      cancelada:  { label: 'Cancelada',    cls: 'bg-gray-100 text-gray-600' },
    }
    return map[s]
  }

  function typeLabel(t: string): string {
    return VACATION_TYPES.find(x => x.id === t)?.label || t
  }

  return (
    <div className="space-y-4">
      {/* Saldos */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Vacaciones</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{saldoVacaciones?.available.toFixed(1) || '-'}</p>
          <p className="text-[10px] text-gray-500">
            {saldoVacaciones?.used.toFixed(1) || '0'} de {saldoVacaciones?.prorrateado.toFixed(1) || '-'} días
          </p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Asuntos propios</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{saldoAsuntos?.available.toFixed(1) || '-'}</p>
          <p className="text-[10px] text-gray-500">
            {saldoAsuntos?.used.toFixed(1) || '0'} de {saldoAsuntos?.prorrateado.toFixed(1) || '-'} días
          </p>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{vacations.length} solicitud{vacations.length !== 1 ? 'es' : ''}</p>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Añadir manualmente</Button>
      </div>

      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
      ) : vacations.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-3xl mb-2">🏖️</p>
          <p className="text-sm text-gray-700">Sin ausencias registradas</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {vacations.map(v => {
            const badge = statusBadge(v.status)
            const isPaid = v.paid ?? true
            const isApproved = v.status === 'aprobada'
            return (
              <Card key={v.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-gray-900 text-sm">{typeLabel(v.type)}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      {isApproved && (
                        <button
                          onClick={() => togglePaid(v)}
                          title={isPaid ? 'Retribuida (cuenta como horas trabajadas en bolsa). Click para cambiar.' : 'No retribuida (descuenta del contrato del periodo). Click para cambiar.'}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition cursor-pointer ${
                            isPaid
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300'
                          }`}
                        >
                          {isPaid ? '💰 Retribuida' : '🚫 Sin sueldo'}
                        </button>
                      )}
                      {v.alertLeadTime && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⚠ Antelación corta</span>
                      )}
                      {v.alertMinStaff && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⚠ Mínimo de plantilla</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">
                      {new Date(v.startDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      {' – '}
                      {new Date(v.endDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                      <span className="ml-2 text-gray-400">({v.days} día{v.days !== 1 ? 's' : ''})</span>
                    </p>
                    {v.notes && <p className="text-xs text-gray-500 mt-1 italic">"{v.notes}"</p>}
                    {v.reviewNotes && (
                      <p className="text-xs mt-1 px-2 py-1 rounded bg-gray-50 text-gray-600">💬 {v.reviewNotes}</p>
                    )}
                    <p className="text-[10px] text-gray-300 mt-1">Solicitada: {new Date(v.requestedAt).toLocaleDateString('es-ES')}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {v.status === 'solicitada' && (
                      <>
                        <button onClick={() => setReviewModal({ vac: v, action: 'aprobar' })}
                          className="text-xs px-3 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium">
                          Aprobar
                        </button>
                        <button onClick={() => setReviewModal({ vac: v, action: 'rechazar' })}
                          className="text-xs px-3 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium">
                          Rechazar
                        </button>
                      </>
                    )}
                    <button onClick={() => handleDelete(v)}
                      className="text-xs px-3 py-1 rounded text-gray-400 hover:text-red-600">
                      Borrar
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal review */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5">
            <p className="font-bold text-lg mb-1">{reviewModal.action === 'aprobar' ? 'Aprobar solicitud' : 'Rechazar solicitud'}</p>
            <p className="text-xs text-gray-500 mb-3">
              {typeLabel(reviewModal.vac.type)} · {reviewModal.vac.days} días
            </p>

            {reviewModal.action === 'aprobar' && (
              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reviewPaid}
                    onChange={e => setReviewPaid(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#7C1A1A]"
                  />
                  <span className="text-sm font-medium">
                    {reviewPaid ? '💰 Ausencia retribuida' : '🚫 Ausencia sin sueldo'}
                  </span>
                </label>
                <p className="text-[11px] text-gray-500 mt-1.5 pl-6">
                  {reviewPaid
                    ? 'Cuenta como horas trabajadas en la bolsa de horas (no penaliza al trabajador).'
                    : 'No cuenta como trabajada. Descuenta del contrato del periodo (permiso sin sueldo).'}
                </p>
              </div>
            )}

            <label className="text-xs text-gray-500 block mb-1">Comentario (opcional)</label>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
              placeholder={reviewModal.action === 'aprobar' ? 'Ej: Aprobado, disfrútalas' : 'Ej: No es buen momento, plantéalo en otra fecha'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-20 resize-none mb-3" />

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setReviewModal(null); setReviewNotes(''); setReviewPaid(true) }} className="flex-1">Cancelar</Button>
              <Button onClick={doReview} className="flex-1">
                {reviewModal.action === 'aprobar' ? 'Aprobar' : 'Rechazar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal añadir */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5">
            <p className="font-bold text-lg mb-3">Añadir ausencia (aprobada)</p>

            <label className="text-xs text-gray-500 block mb-1">Tipo</label>
            <select value={type} onChange={e => setType(e.target.value as VacationType)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-3">
              {VACATION_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
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

            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={paid}
                  onChange={e => setPaid(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#7C1A1A]"
                />
                <span className="text-sm font-medium">
                  {paid ? '💰 Ausencia retribuida' : '🚫 Ausencia sin sueldo'}
                </span>
              </label>
              <p className="text-[11px] text-gray-500 mt-1.5 pl-6">
                {paid
                  ? 'Cuenta como horas trabajadas en la bolsa de horas.'
                  : 'No cuenta como trabajada. Descuenta del contrato del periodo.'}
              </p>
            </div>

            <label className="text-xs text-gray-500 block mb-1">Notas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-16 resize-none mb-3" />

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setStartDate(''); setEndDate(''); setNotes(''); setPaid(true) }} className="flex-1">Cancelar</Button>
              <Button onClick={handleAdd} disabled={!startDate || !endDate} className="flex-1">Añadir</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
