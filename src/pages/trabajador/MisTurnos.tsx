// src/pages/trabajador/MisTurnos.tsx
// El empleado ve los turnos abiertos disponibles y puede solicitar coger alguno.
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { Card, Button } from '../../components/ui'
import {
  fetchOpenShifts, requestShift, withdrawRequest,
  fetchRequestsForEmployee,
  shiftHours,
  type OpenShift, type ShiftRequest,
} from '../../services/openShiftsService'
import { isSupabaseEnabled, supabase } from '../../lib/supabase'
import type { Employee } from '../../types'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MisTurnos({ employee, onBack }: Props) {
  const { locations } = useApp()
  const [shifts, setShifts] = useState<OpenShift[]>([])
  const [myRequests, setMyRequests] = useState<ShiftRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [requestNotes, setRequestNotes] = useState('')
  const [showNotesModal, setShowNotesModal] = useState<OpenShift | null>(null)
  const [tab, setTab] = useState<'disponibles' | 'mis_solicitudes'>('disponibles')

  async function load() {
    setLoading(true)
    const [open, mine] = await Promise.all([
      fetchOpenShifts('open'),
      fetchRequestsForEmployee(employee.id),
    ])
    setShifts(open || [])
    setMyRequests(mine || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [employee.id])

  // Realtime
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb.channel('mis-turnos-' + employee.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_shifts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_shift_requests' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id])

  function locationName(id: string): string {
    return locations.find(l => l.id === id)?.name || 'Local'
  }

  // ¿Ya tengo solicitud pendiente para este turno?
  function myRequestForShift(shiftId: string): ShiftRequest | undefined {
    return myRequests.find(r => r.shiftId === shiftId && r.status === 'pendiente')
  }

  async function handleRequest() {
    if (!showNotesModal) return
    const shift = showNotesModal
    setSubmitting(shift.id)
    try {
      await requestShift(shift.id, employee.id, requestNotes)
      await load()
      setShowNotesModal(null)
      setRequestNotes('')
    } catch (err) {
      alert('No se pudo enviar la solicitud: ' + (err instanceof Error ? err.message : 'error'))
    } finally {
      setSubmitting(null)
    }
  }

  async function handleWithdraw(req: ShiftRequest) {
    if (!confirm('¿Retirar tu solicitud para este turno?')) return
    await withdrawRequest(req.id)
    await load()
  }

  // Para "Mis solicitudes"
  const myRequestsWithShift = useMemo(() => {
    return myRequests
      .map(r => ({ request: r, shift: shifts.find(s => s.id === r.shiftId) }))
      .filter(x => x.shift)
  }, [myRequests, shifts])

  const myActiveRequests = myRequestsWithShift.filter(x => x.request.status === 'pendiente' || x.request.status === 'aceptada')

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Turnos abiertos</p>
            <p className="font-bold text-gray-900">{employee.name.split(' ')[0]}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setTab('disponibles')}
            className={`flex-1 px-3 py-2 rounded-full text-sm font-medium transition-all ${
              tab === 'disponibles' ? 'bg-[#7C1A1A] text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}>
            🟢 Disponibles
          </button>
          <button onClick={() => setTab('mis_solicitudes')}
            className={`flex-1 px-3 py-2 rounded-full text-sm font-medium transition-all relative ${
              tab === 'mis_solicitudes' ? 'bg-[#7C1A1A] text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}>
            📋 Mis solicitudes
            {myActiveRequests.length > 0 && (
              <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                tab === 'mis_solicitudes' ? 'bg-white text-[#7C1A1A]' : 'bg-[#F39C2A] text-white'
              }`}>
                {myActiveRequests.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
        ) : tab === 'disponibles' ? (
          shifts.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-4xl mb-2">🪑</p>
              <p className="font-semibold text-gray-700">Sin turnos disponibles</p>
              <p className="text-xs text-gray-500 mt-1">Cuando tu encargado publique uno, aparecerá aquí</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {shifts.map(s => {
                const myReq = myRequestForShift(s.id)
                const dateLabel = new Date(s.date + 'T00:00:00').toLocaleDateString('es-ES', {
                  weekday: 'short', day: '2-digit', month: 'long'
                })
                return (
                  <Card key={s.id} className="p-3">
                    <p className="font-semibold text-gray-900 text-sm capitalize">{dateLabel}</p>
                    <p className="text-sm text-gray-700 mt-0.5">
                      {s.startTime} – {s.endTime}
                      <span className="text-gray-400"> · {shiftHours(s.startTime, s.endTime).toFixed(1)}h</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {locationName(s.locationId)}
                      {s.position && <span> · {s.position}</span>}
                    </p>
                    {s.notes && <p className="text-xs text-gray-500 italic mt-1">"{s.notes}"</p>}

                    <div className="mt-3">
                      {myReq ? (
                        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                          <p className="text-xs text-amber-800 font-medium">⏳ Solicitud enviada</p>
                          <button onClick={() => handleWithdraw(myReq)}
                            className="text-xs text-amber-700 hover:text-amber-900 underline">
                            Retirar
                          </button>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => setShowNotesModal(s)} disabled={submitting === s.id}
                          className="w-full">
                          {submitting === s.id ? 'Enviando...' : 'Quiero coger este turno'}
                        </Button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )
        ) : (
          // Tab: mis solicitudes
          myRequestsWithShift.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-4xl mb-2">📋</p>
              <p className="font-semibold text-gray-700">Sin solicitudes</p>
              <p className="text-xs text-gray-500 mt-1">No has solicitado ningún turno todavía</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {myRequestsWithShift.map(({ request, shift }) => {
                if (!shift) return null
                const dateLabel = new Date(shift.date + 'T00:00:00').toLocaleDateString('es-ES', {
                  weekday: 'short', day: '2-digit', month: 'long'
                })
                const reqBadge = {
                  pendiente: { label: '⏳ Pendiente', cls: 'bg-amber-100 text-amber-700' },
                  aceptada:  { label: '✓ Aceptada',   cls: 'bg-emerald-100 text-emerald-700' },
                  rechazada: { label: '✕ Rechazada',  cls: 'bg-red-100 text-red-700' },
                  retirada:  { label: '↩ Retirada',   cls: 'bg-gray-100 text-gray-500' },
                }[request.status]
                return (
                  <Card key={request.id} className="p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-semibold text-gray-900 text-sm capitalize">{dateLabel}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${reqBadge.cls}`}>{reqBadge.label}</span>
                    </div>
                    <p className="text-sm text-gray-700">
                      {shift.startTime} – {shift.endTime}
                      <span className="text-gray-400"> · {shiftHours(shift.startTime, shift.endTime).toFixed(1)}h</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {locationName(shift.locationId)}
                      {shift.position && <span> · {shift.position}</span>}
                    </p>
                    {request.notes && <p className="text-xs text-gray-500 italic mt-1">"{request.notes}"</p>}
                    {request.reviewNotes && (
                      <p className="text-xs mt-1 px-2 py-1 rounded bg-gray-50 text-gray-600">💬 {request.reviewNotes}</p>
                    )}
                    {request.status === 'pendiente' && (
                      <button onClick={() => handleWithdraw(request)}
                        className="text-xs text-gray-500 hover:text-red-600 underline mt-2">
                        Retirar solicitud
                      </button>
                    )}
                  </Card>
                )
              })}
            </div>
          )
        )}

        {/* Modal con notas */}
        {showNotesModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5">
              <p className="font-bold text-lg mb-1">Solicitar turno</p>
              <p className="text-sm text-gray-600 mb-3">
                {locationName(showNotesModal.locationId)} · {showNotesModal.startTime}–{showNotesModal.endTime}
              </p>

              <label className="text-xs text-gray-500 block mb-1">Mensaje (opcional)</label>
              <textarea value={requestNotes} onChange={e => setRequestNotes(e.target.value)}
                placeholder="Ej: tengo disponibilidad ese día"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-20 resize-none mb-3" />

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setShowNotesModal(null); setRequestNotes('') }} className="flex-1">Cancelar</Button>
                <Button onClick={handleRequest} disabled={!!submitting} className="flex-1">
                  {submitting ? 'Enviando...' : 'Enviar solicitud'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
