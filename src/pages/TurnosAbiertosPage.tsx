// src/pages/TurnosAbiertosPage.tsx
// Gestión de turnos abiertos: crear, listar, ver candidatos, asignar.
import { useState, useEffect, useMemo } from 'react'
import {
  CircleDot, Check, FileText, Armchair, ChevronDown, ChevronRight,
  Clock, X, RotateCcw, MessageSquare,
} from 'lucide-react'
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
      abierto: { label: 'Abierto', cls: 'bg-success-bg text-success' },
      asignado: { label: 'Asignado', cls: 'bg-accent-bg text-accent' },
      cancelado: { label: 'Cancelado', cls: 'bg-accent-bg text-text-secondary' },
    }
    return map[s]
  }

  return (
    <div className="space-y-4">
      {/* Tabs y botón crear */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {([
            { id: 'abierto' as FilterTab, label: 'Abiertos', Icon: CircleDot },
            { id: 'asignado' as FilterTab, label: 'Asignados', Icon: Check },
            { id: 'todos' as FilterTab, label: 'Todos', Icon: FileText },
          ]).map(t => {
            const TabIcon = t.Icon
            return (
              <button key={t.id} onClick={() => setFilter(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-base ${
                  filter === t.id ? 'bg-accent text-text-on-accent' : 'bg-card border border-border-default text-text-secondary hover:border-accent'
                }`}>
                <TabIcon size={14} /> {t.label}
              </button>
            )
          })}
        </div>
        <Button onClick={() => setShowCreate(true)}>+ Publicar turno</Button>
      </div>

      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-text-secondary">Cargando...</p></Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex justify-center mb-3">
            <Armchair size={48} className="text-accent" />
          </div>
          <p className="font-semibold text-text-primary">
            {filter === 'abierto' ? 'No hay turnos abiertos' : 'Sin turnos'}
          </p>
          <p className="text-xs text-text-secondary mt-1">
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
                        <p className="font-semibold text-text-primary capitalize">{dateLabel}</p>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                        {pendingReqs.length > 0 && s.status === 'abierto' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                            {pendingReqs.length} candidato{pendingReqs.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-primary">
                        {s.startTime} – {s.endTime}
                        <span className="text-text-secondary"> · {shiftHours(s.startTime, s.endTime).toFixed(1)}h</span>
                      </p>
                      <p className="text-xs text-text-secondary">
                        {locationName(s.locationId)}
                        {s.position && <span> · {s.position}</span>}
                      </p>
                      {s.assignedTo && (
                        <p className="text-xs text-accent mt-1 inline-flex items-center gap-1">
                          <Check size={11} /> Asignado a {employeeName(s.assignedTo)}
                        </p>
                      )}
                      {s.notes && <p className="text-xs text-text-secondary mt-1 italic">"{s.notes}"</p>}
                    </div>
                    {expanded
                      ? <ChevronDown size={18} className="text-text-secondary" />
                      : <ChevronRight size={18} className="text-text-secondary" />}
                  </div>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-border-default">
                    {/* Acciones del turno */}
                    {s.status === 'abierto' && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleCancel(s)}
                          className="text-xs px-3 py-1.5 rounded bg-warning-bg text-warning hover:opacity-90 font-medium transition-base">
                          Cancelar turno
                        </button>
                        <button onClick={() => handleDelete(s)}
                          className="text-xs px-3 py-1.5 rounded bg-danger-bg text-danger hover:opacity-90 font-medium transition-base">
                          Eliminar
                        </button>
                      </div>
                    )}
                    {s.status !== 'abierto' && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleDelete(s)}
                          className="text-xs px-3 py-1.5 rounded bg-danger-bg text-danger hover:opacity-90 font-medium transition-base">
                          Eliminar
                        </button>
                      </div>
                    )}

                    {/* Lista de candidatos */}
                    <p className="text-xs uppercase tracking-wide text-text-secondary mt-4 mb-2">
                      Candidatos ({reqs.length})
                    </p>
                    {reqs.length === 0 ? (
                      <p className="text-xs text-text-secondary italic">Aún no hay solicitudes</p>
                    ) : (
                      <div className="space-y-2">
                        {reqs.map(r => {
                          const emp = staff.find(e => e.id === r.employeeId)
                          const initials = (emp?.name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
                          const reqBadge = {
                            pendiente: 'bg-warning-bg text-warning',
                            aceptada: 'bg-success-bg text-success',
                            rechazada: 'bg-danger-bg text-danger',
                            retirada: 'bg-accent-bg text-text-secondary',
                          }[r.status]
                          const reqLabel = {
                            pendiente: 'Pendiente',
                            aceptada: 'Aceptada',
                            rechazada: 'Rechazada',
                            retirada: 'Retirada',
                          }[r.status]
                          const ReqIcon = {
                            pendiente: Clock,
                            aceptada: Check,
                            rechazada: X,
                            retirada: RotateCcw,
                          }[r.status]
                          return (
                            <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-page">
                              <div className="w-8 h-8 shrink-0 rounded-full bg-accent-bg flex items-center justify-center">
                                <span className="text-[10px] font-bold text-accent">{initials || '?'}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate">{emp?.name || '—'}</p>
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${reqBadge}`}>
                                    <ReqIcon size={10} /> {reqLabel}
                                  </span>
                                  <span className="text-[10px] text-text-secondary">{new Date(r.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                {r.notes && <p className="text-[11px] text-text-secondary italic mt-0.5">"{r.notes}"</p>}
                                {r.reviewNotes && (
                                  <p className="text-[11px] text-text-secondary mt-0.5 inline-flex items-center gap-1">
                                    <MessageSquare size={10} /> {r.reviewNotes}
                                  </p>
                                )}
                              </div>
                              {r.status === 'pendiente' && s.status === 'abierto' && (
                                <div className="flex flex-col gap-1 shrink-0">
                                  <button onClick={() => handleAccept(r)}
                                    className="text-xs px-3 py-1 rounded bg-success-bg text-success hover:opacity-90 font-medium transition-base">
                                    Asignar
                                  </button>
                                  <button onClick={() => handleReject(r)}
                                    className="text-xs px-3 py-1 rounded bg-danger-bg text-danger hover:opacity-90 font-medium transition-base">
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
          <div className="bg-card rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
            <p className="font-bold text-lg mb-4 text-text-primary">Publicar turno abierto</p>

            <label className="text-xs text-text-secondary block mb-1">Local</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary mb-3">
              <option value="">Selecciona...</option>
              {locations.filter(l => l.active).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>

            <label className="text-xs text-text-secondary block mb-1">Fecha</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary mb-3" />

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-xs text-text-secondary block mb-1">Inicio</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
              </div>
              <div>
                <label className="text-xs text-text-secondary block mb-1">Fin</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
              </div>
            </div>

            <label className="text-xs text-text-secondary block mb-1">Puesto (opcional)</label>
            <input type="text" value={position} onChange={e => setPosition(e.target.value)}
              placeholder="Ej: Camarero, Cocina"
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary mb-3" />

            <label className="text-xs text-text-secondary block mb-1">Notas (opcional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Ej: cubrir baja por enfermedad"
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm h-16 resize-none bg-card text-text-primary mb-3" />

            {error && <p className="text-sm text-danger mb-2">{error}</p>}

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
