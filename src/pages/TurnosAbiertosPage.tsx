// src/pages/TurnosAbiertosPage.tsx
// Gestión de turnos abiertos: crear, listar, ver candidatos, asignar.
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Card, Button } from '../components/ui'
import {
  fetchOpenShifts, createOpenShift, cancelOpenShift, deleteOpenShift,
  fetchRequestsForShift, acceptRequest, rejectRequest,
  shiftHours,
  type OpenShift, type ShiftRequest,
} from '../services/openShiftsService'
import { isSupabaseEnabled, supabase } from '../lib/supabase'

type FilterTab = 'abierto' | 'asignado' | 'todos'

export default function TurnosAbiertosPage() {
  const { staff, locations } = useApp()
  const [filter, setFilter] = useState<FilterTab>('abierto')
  const [shifts, setShifts] = useState<OpenShift[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedShift, setExpandedShift] = useState<string | null>(null)
  const [requests, setRequests] = useState<Record<string, ShiftRequest[]>>({})

  // Form crear
  const [locationId, setLocationId] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [position, setPosition] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const all = await fetchOpenShifts('all')
    setShifts(all || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Realtime
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb.channel('turnos-abiertos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_shifts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_shift_requests' }, () => {
        if (expandedShift) loadRequests(expandedShift)
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [expandedShift])

  // Filtrar
  const filtered = useMemo(() => {
    if (filter === 'todos') return shifts
    return shifts.filter(s => s.status === filter)
  }, [shifts, filter])

  async function loadRequests(shiftId: string) {
    const list = await fetchRequestsForShift(shiftId)
    setRequests(prev => ({ ...prev, [shiftId]: list || [] }))
  }

  function toggleExpand(shiftId: string) {
    if (expandedShift === shiftId) {
      setExpandedShift(null)
    } else {
      setExpandedShift(shiftId)
      if (!requests[shiftId]) loadRequests(shiftId)
    }
  }

  async function handleCreate() {
    if (!locationId || !date || !startTime || !endTime) {
      setError('Completa los campos obligatorios')
      return
    }
    setCreating(true); setError('')
    try {
      await createOpenShift({ locationId, date, startTime, endTime, position, notes })
      setShowCreate(false)
      setLocationId(''); setDate(''); setStartTime('09:00'); setEndTime('17:00'); setPosition(''); setNotes('')
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setCreating(false)
    }
  }

  async function handleCancel(s: OpenShift) {
    if (!confirm('¿Cancelar este turno? Las solicitudes pendientes se mantendrán pero no podrán aceptarse.')) return
    await cancelOpenShift(s.id)
    await load()
  }

  async function handleDelete(s: OpenShift) {
    if (!confirm('¿Eliminar este turno permanentemente? Se borrarán también todas las solicitudes asociadas.')) return
    await deleteOpenShift(s.id)
    await load()
  }

  async function handleAccept(req: ShiftRequest) {
    const emp = staff.find(e => e.id === req.employeeId)
    if (!confirm(`¿Asignar el turno a ${emp?.name || 'este empleado'}? Las demás solicitudes quedarán rechazadas automáticamente.`)) return
    await acceptRequest(req.id)
    await load()
    if (expandedShift) await loadRequests(expandedShift)
  }

  async function handleReject(req: ShiftRequest) {
    await rejectRequest(req.id)
    if (expandedShift) await loadRequests(expandedShift)
  }

  function locationName(id: string): string {
    return locations.find(l => l.id === id)?.name || 'Local'
  }

  function employeeName(id: string): string {
    return staff.find(e => e.id === id)?.name || 'Empleado'
  }

  function statusBadge(s: OpenShift['status']) {
    const map = {
      abierto: { label: '🟢 Abierto', cls: 'bg-emerald-100 text-emerald-700' },
      asignado: { label: '✓ Asignado', cls: 'bg-blue-100 text-blue-700' },
      cancelado: { label: '✕ Cancelado', cls: 'bg-gray-100 text-gray-500' },
    }
    return map[s]
  }

  return (
    <div className="space-y-4">
      {/* Tabs y botón crear */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {([
            { id: 'abierto' as FilterTab, label: 'Abiertos', icon: '🟢' },
            { id: 'asignado' as FilterTab, label: 'Asignados', icon: '✓' },
            { id: 'todos' as FilterTab, label: 'Todos', icon: '📋' },
          ]).map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                filter === t.id ? 'bg-[#7C1A1A] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setShowCreate(true)}>+ Publicar turno</Button>
      </div>

      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-5xl mb-3">🪑</p>
          <p className="font-semibold text-gray-700">
            {filter === 'abierto' ? 'No hay turnos abiertos' : 'Sin turnos'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {filter === 'abierto' ? 'Pulsa "+ Publicar turno" para empezar' : 'Aún no se han publicado turnos en este filtro'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => {
            const badge = statusBadge(s.status)
            const reqs = requests[s.id] || []
            const pendingReqs = reqs.filter(r => r.status === 'pendiente')
            const expanded = expandedShift === s.id
            const dateLabel = new Date(s.date + 'T00:00:00').toLocaleDateString('es-ES', {
              weekday: 'short', day: '2-digit', month: 'long'
            })

            return (
              <Card key={s.id}>
                <button onClick={() => toggleExpand(s.id)} className="w-full text-left p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-gray-900 capitalize">{dateLabel}</p>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                        {pendingReqs.length > 0 && s.status === 'abierto' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            {pendingReqs.length} candidato{pendingReqs.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700">
                        {s.startTime} – {s.endTime}
                        <span className="text-gray-400"> · {shiftHours(s.startTime, s.endTime).toFixed(1)}h</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {locationName(s.locationId)}
                        {s.position && <span> · {s.position}</span>}
                      </p>
                      {s.assignedTo && (
                        <p className="text-xs text-blue-700 mt-1">
                          ✓ Asignado a {employeeName(s.assignedTo)}
                        </p>
                      )}
                      {s.notes && <p className="text-xs text-gray-500 mt-1 italic">"{s.notes}"</p>}
                    </div>
                    <span className="text-gray-300 text-lg">{expanded ? '▾' : '▸'}</span>
                  </div>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    {/* Acciones del turno */}
                    {s.status === 'abierto' && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleCancel(s)}
                          className="text-xs px-3 py-1.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium">
                          Cancelar turno
                        </button>
                        <button onClick={() => handleDelete(s)}
                          className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium">
                          Eliminar
                        </button>
                      </div>
                    )}
                    {s.status !== 'abierto' && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleDelete(s)}
                          className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium">
                          Eliminar
                        </button>
                      </div>
                    )}

                    {/* Lista de candidatos */}
                    <p className="text-xs uppercase tracking-wide text-gray-400 mt-4 mb-2">
                      Candidatos ({reqs.length})
                    </p>
                    {reqs.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Aún no hay solicitudes</p>
                    ) : (
                      <div className="space-y-2">
                        {reqs.map(r => {
                          const emp = staff.find(e => e.id === r.employeeId)
                          const initials = (emp?.name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
                          const reqBadge = {
                            pendiente: 'bg-amber-100 text-amber-700',
                            aceptada: 'bg-emerald-100 text-emerald-700',
                            rechazada: 'bg-red-100 text-red-700',
                            retirada: 'bg-gray-100 text-gray-500',
                          }[r.status]
                          const reqLabel = {
                            pendiente: '⏳ Pendiente',
                            aceptada: '✓ Aceptada',
                            rechazada: '✕ Rechazada',
                            retirada: '↩ Retirada',
                          }[r.status]
                          return (
                            <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                              <div className="w-8 h-8 shrink-0 rounded-full bg-[#F5E9D9] flex items-center justify-center">
                                <span className="text-[10px] font-bold text-[#7C1A1A]">{initials || '?'}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{emp?.name || '—'}</p>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${reqBadge}`}>{reqLabel}</span>
                                  <span className="text-[10px] text-gray-400">{new Date(r.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                {r.notes && <p className="text-[11px] text-gray-500 italic mt-0.5">"{r.notes}"</p>}
                                {r.reviewNotes && <p className="text-[11px] text-gray-500 mt-0.5">💬 {r.reviewNotes}</p>}
                              </div>
                              {r.status === 'pendiente' && s.status === 'abierto' && (
                                <div className="flex flex-col gap-1 shrink-0">
                                  <button onClick={() => handleAccept(r)}
                                    className="text-xs px-3 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium">
                                    Asignar
                                  </button>
                                  <button onClick={() => handleReject(r)}
                                    className="text-xs px-3 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium">
                                    Rechazar
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal crear */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
            <p className="font-bold text-lg mb-4">Publicar turno abierto</p>

            <label className="text-xs text-gray-500 block mb-1">Local</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-3">
              <option value="">Selecciona...</option>
              {locations.filter(l => l.active).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>

            <label className="text-xs text-gray-500 block mb-1">Fecha</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Inicio</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Fin</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <label className="text-xs text-gray-500 block mb-1">Puesto (opcional)</label>
            <input type="text" value={position} onChange={e => setPosition(e.target.value)}
              placeholder="Ej: Camarero, Cocina"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />

            <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Ej: cubrir baja por enfermedad"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-16 resize-none mb-3" />

            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowCreate(false); setError('') }} className="flex-1">Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating || !locationId || !date} className="flex-1">
                {creating ? 'Publicando...' : 'Publicar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
