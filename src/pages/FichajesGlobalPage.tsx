import { useState, useEffect, useCallback } from 'react'
import {
  LogIn, LogOut, Users, Clock, Activity, Plus, Pencil, Ban, History,
  Check, X, AlertTriangle, Inbox,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { Badge, Card } from '../components/ui'
import type { ClockEntry } from '../types'
import {
  addManualClockEntry, editClockEntry, voidClockEntry, resolveClockCorrection,
  fetchCorrectionRequests, fetchClockAudit,
  type ClockCorrectionRequest, type ClockEntryAudit, type ClockType,
} from '../services/clockEditService'

const DEFAULT_RADIUS_M = 200

// Distancia en metros entre dos coordenadas (Haversine).
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// ── Helpers de fecha para <input type="datetime-local"> ───────────────────
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localToISO(local: string): string {
  return new Date(local).toISOString()  // interpreta en la zona del navegador (Madrid) → instante correcto
}

export default function FichajesGlobalPage() {
  const { staff, locations } = useApp()
  const today = new Date()
  const [dateFrom, setDateFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10))
  const [empFilter, setEmpFilter] = useState('')
  const [locFilter, setLocFilter] = useState('todas')

  // El selector global de local manda: local activo → ese local; consolidado → 'todas'.
  const { resolvedLocationId } = useLocationScope()
  useEffect(() => {
    setLocFilter(resolvedLocationId ?? 'todas')
  }, [resolvedLocationId])

  // ── Estado de corrección ─────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<(ClockEntry & { employeeName: string }) | null>(null)
  const [voidTarget, setVoidTarget] = useState<(ClockEntry & { employeeName: string }) | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ entry: ClockEntry & { employeeName: string }; rows: ClockEntryAudit[] | null } | null>(null)
  const [resolveTarget, setResolveTarget] = useState<ClockCorrectionRequest | null>(null)

  const [requests, setRequests] = useState<ClockCorrectionRequest[]>([])
  const loadRequests = useCallback(async () => {
    setRequests(await fetchCorrectionRequests('pending'))
  }, [])
  useEffect(() => { void loadRequests() }, [loadRequests])

  function empName(id: string): string {
    return staff.find(e => e.id === id)?.name || '—'
  }

  const filtered = staff.filter(e =>
    (!empFilter || e.id === empFilter) &&
    (locFilter === 'todas' || e.locationId === locFilter)
  )

  const allEntries = filtered
    .flatMap(e => e.clockEntries
      .filter(c => c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
      .map(c => ({ ...c, employeeName: e.name, employeePos: e.position, employeeId: e.id, employeeLocationId: e.locationId }))
    )
    .sort((a, b) => b.datetime.localeCompare(a.datetime))

  // Las horas y las estadísticas EXCLUYEN los fichajes anulados (voided); la tabla
  // de "todos los fichajes" sí los muestra tachados, por transparencia.
  const summary = filtered.map(e => {
    const entries = e.clockEntries.filter(c => !c.voided && c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
    let hours = 0
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'entrada' && entries[i - 1]?.type === 'salida') {
        hours += (new Date(entries[i - 1].datetime).getTime() - new Date(entries[i].datetime).getTime()) / 3600000
      }
    }
    return { ...e, totalEntries: entries.length, totalHours: hours.toFixed(1) }
  })

  const liveEntries = allEntries.filter(e => !e.voided)
  const stats = [
    { label: 'Fichajes', val: liveEntries.length, icon: Clock },
    { label: 'Empleados activos', val: filtered.filter(e => e.clockEntries.some(c => !c.voided && c.datetime >= dateFrom)).length, icon: Users },
    { label: 'Fichajes hoy', val: liveEntries.filter(e => e.datetime.startsWith(today.toISOString().slice(0, 10))).length, icon: Activity },
    { label: 'Trabajando ahora', val: filtered.filter(e => e.clockEntries.filter(c => !c.voided)[0]?.type === 'entrada').length, icon: LogIn },
  ]

  // ── Acciones ─────────────────────────────────────────────────────────
  async function runAction(fn: () => Promise<void>, after?: () => void) {
    setBusy(true); setErr(null)
    try {
      await fn()
      after?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo completar la acción')
    } finally {
      setBusy(false)
    }
  }

  async function openHistory(entry: ClockEntry & { employeeName: string }) {
    setHistoryTarget({ entry, rows: null })
    const rows = await fetchClockAudit(entry.id)
    setHistoryTarget({ entry, rows })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-accent">Control Horario</h1>
          <p className="text-sm text-text-secondary mt-0.5">{liveEntries.length} fichajes en el periodo</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setErr(null) }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-base shrink-0"
        >
          <Plus size={16} /> Añadir fichaje
        </button>
      </div>

      {/* Solicitudes de corrección del trabajador (olvido / tardío / error) */}
      {requests.length > 0 && (
        <Card className="border-warning/40">
          <div className="p-4 border-b border-border-default bg-warning-bg rounded-t-xl flex items-center gap-2">
            <Inbox size={16} className="text-warning" />
            <h3 className="font-semibold text-sm text-warning">
              {requests.length} solicitud{requests.length > 1 ? 'es' : ''} de corrección pendiente{requests.length > 1 ? 's' : ''}
            </h3>
          </div>
          <div className="divide-y divide-border-default">
            {requests.map(r => (
              <div key={r.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {empName(r.employeeId)}
                    <span className="text-text-secondary font-normal">
                      {' · '}
                      {r.kind === 'add' ? 'Añadir' : r.kind === 'edit' ? 'Corregir' : 'Anular'}
                      {r.proposedType ? ` ${r.proposedType}` : ''}
                      {r.proposedDatetime ? ` → ${new Date(r.proposedDatetime).toLocaleString('es-ES')}` : ''}
                    </span>
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5 italic">"{r.reason}"</p>
                  {r.requestedByEmployeeId !== r.employeeId && (
                    <p className="text-[10px] text-text-secondary mt-0.5">Solicitado por {empName(r.requestedByEmployeeId)}</p>
                  )}
                </div>
                <button
                  onClick={() => { setResolveTarget(r); setErr(null) }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent-bg text-accent font-medium hover:bg-accent hover:text-text-on-accent transition-base shrink-0"
                >
                  Revisar
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-page rounded-xl border border-border-default">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Desde</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Hasta</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Empleado</label>
          <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary">
            <option value="">Todos</option>
            {staff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Local</label>
          <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
            className="border border-border-default rounded-md px-2 py-1.5 text-sm bg-card text-text-primary">
            <option value="todas">Todos</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="p-4 rounded-lg border border-border-default bg-accent-bg text-accent">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={18} />
                <p className="text-2xl font-bold">{s.val}</p>
              </div>
              <p className="text-xs">{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Fichajes table */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl">
          <h3 className="font-semibold text-sm text-text-primary">Todos los fichajes</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border-default bg-page">
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Empleado</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Tipo</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Fecha y hora</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary hidden sm:table-cell">Turno</th>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary hidden sm:table-cell">Distancia</th>
              <th className="p-3 text-right text-xs font-semibold text-text-secondary">Acciones</th>
            </tr></thead>
            <tbody>
              {allEntries.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-text-secondary text-sm">Sin fichajes en este periodo</td></tr>
              ) : allEntries.map(e => (
                <tr key={e.id + e.datetime} className={`border-b border-border-default last:border-0 hover:bg-accent-bg ${e.voided ? 'opacity-50' : ''}`}>
                  <td className="p-3">
                    <p className="font-medium text-sm text-text-primary">{e.employeeName}</p>
                    <p className="text-xs text-text-secondary">{e.employeePos}</p>
                  </td>
                  <td className="p-3">
                    <Badge color={e.voided ? 'gray' : e.type === 'entrada' ? 'green' : 'red'}>
                      <span className="inline-flex items-center gap-1">
                        {e.type === 'entrada' ? <LogIn size={12} /> : <LogOut size={12} />}
                        {e.type === 'entrada' ? 'Entrada' : 'Salida'}
                      </span>
                    </Badge>
                  </td>
                  <td className="p-3 text-text-primary">
                    <span className={`font-medium ${e.voided ? 'line-through' : ''}`}>{new Date(e.datetime).toLocaleString('es-ES')}</span>
                    {e.voided && <Badge color="gray" className="ml-1">anulado</Badge>}
                    {!e.voided && e.roundingApplied && <Badge color="yellow" className="ml-1">redondeado</Badge>}
                    {!e.voided && !e.roundingApplied && (e.diffMinutes || 0) > 10 && <Badge color="red" className="ml-1">+{e.diffMinutes}min</Badge>}
                    {e.source === 'manual' && <Badge color="gray" className="ml-1">manual</Badge>}
                  </td>
                  <td className="p-3 text-xs text-text-secondary hidden sm:table-cell">{e.scheduled || '—'}</td>
                  <td className="p-3 text-xs hidden sm:table-cell">
                    {(() => {
                      const loc = locations.find(l => l.id === (e.locationIdAtClock || e.employeeLocationId))
                      if (e.lat == null || e.lng == null || !loc || loc.lat == null || loc.lng == null) {
                        return <span className="text-text-secondary">sin GPS</span>
                      }
                      const dist = Math.round(haversineM(e.lat, e.lng, loc.lat, loc.lng))
                      const radius = loc.clockRadiusM ?? DEFAULT_RADIUS_M
                      const lejos = dist > radius
                      return (
                        <span className={`inline-flex items-center gap-1 font-semibold ${lejos ? 'text-danger' : 'text-success'}`}>
                          {lejos && <span aria-hidden>⚠️</span>}
                          {dist} m
                          {lejos && <span className="font-normal text-text-secondary">· fuera</span>}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Historial de cambios" onClick={() => openHistory(e)}
                        className="w-8 h-8 rounded-lg text-text-secondary hover:bg-accent-bg hover:text-accent flex items-center justify-center transition-base">
                        <History size={15} />
                      </button>
                      {!e.voided && (
                        <>
                          <button title="Editar hora" onClick={() => { setEditTarget(e); setErr(null) }}
                            className="w-8 h-8 rounded-lg text-text-secondary hover:bg-accent-bg hover:text-accent flex items-center justify-center transition-base">
                            <Pencil size={15} />
                          </button>
                          <button title="Anular" onClick={() => { setVoidTarget(e); setErr(null) }}
                            className="w-8 h-8 rounded-lg text-text-secondary hover:bg-danger-bg hover:text-danger flex items-center justify-center transition-base">
                            <Ban size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Summary table */}
      <Card>
        <div className="p-4 border-b border-border-default bg-page rounded-t-xl">
          <h3 className="font-semibold text-sm text-text-primary">Resumen por empleado</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border-default bg-page">
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">Empleado</th>
              <th className="p-3 text-center text-xs font-semibold text-text-secondary">Fichajes</th>
              <th className="p-3 text-center text-xs font-semibold text-text-secondary">Horas</th>
              <th className="p-3 text-center text-xs font-semibold text-text-secondary">Estado</th>
            </tr></thead>
            <tbody>
              {summary.map(e => {
                const live = e.clockEntries.filter(c => !c.voided)
                return (
                  <tr key={e.id} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                    <td className="p-3">
                      <p className="font-medium text-text-primary">{e.name}</p>
                      <p className="text-xs text-text-secondary">{e.position}</p>
                    </td>
                    <td className="p-3 text-center text-text-primary">{e.totalEntries}</td>
                    <td className="p-3 text-center font-medium text-text-primary">{e.totalHours}h</td>
                    <td className="p-3 text-center">
                      <Badge color={live[0]?.type === 'entrada' ? 'green' : 'gray'}>
                        {live[0]?.type === 'entrada' ? 'Dentro' : 'Fuera'}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Modales ──────────────────────────────────────────────────────── */}
      {showAdd && (
        <AddModal
          staff={staff.map(s => ({ id: s.id, name: s.name }))}
          busy={busy} err={err}
          onClose={() => setShowAdd(false)}
          onSubmit={(empId, type, iso, reason) =>
            runAction(() => addManualClockEntry(empId, type, iso, reason), () => setShowAdd(false))}
        />
      )}

      {editTarget && (
        <EditModal
          entry={editTarget} busy={busy} err={err}
          onClose={() => setEditTarget(null)}
          onSubmit={(iso, type, reason) =>
            runAction(() => editClockEntry(editTarget.id, iso, reason, type), () => setEditTarget(null))}
        />
      )}

      {voidTarget && (
        <ReasonModal
          title="Anular fichaje" danger
          subtitle={`${voidTarget.employeeName} · ${voidTarget.type} · ${new Date(voidTarget.datetime).toLocaleString('es-ES')}`}
          note="El fichaje se conserva anulado para el rastro legal. Indica el motivo."
          confirmLabel="Anular"
          busy={busy} err={err}
          onClose={() => setVoidTarget(null)}
          onSubmit={(reason) => runAction(() => voidClockEntry(voidTarget.id, reason), () => setVoidTarget(null))}
        />
      )}

      {resolveTarget && (
        <ResolveModal
          request={resolveTarget} empName={empName} busy={busy} err={err}
          onClose={() => setResolveTarget(null)}
          onResolve={(approve, note) =>
            runAction(() => resolveClockCorrection(resolveTarget.id, approve, note), () => { setResolveTarget(null); void loadRequests() })}
        />
      )}

      {historyTarget && (
        <HistoryModal
          entry={historyTarget.entry} rows={historyTarget.rows}
          empName={empName}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  )
}

// ── Piezas modales ──────────────────────────────────────────────────────

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function ErrLine({ err }: { err: string | null }) {
  if (!err) return null
  return <p className="text-sm text-danger mb-3 inline-flex items-center gap-1"><AlertTriangle size={14} /> {err}</p>
}

function AddModal({ staff, busy, err, onClose, onSubmit }: {
  staff: { id: string; name: string }[]
  busy: boolean; err: string | null
  onClose: () => void
  onSubmit: (empId: string, type: ClockType, iso: string, reason: string) => void
}) {
  const [empId, setEmpId] = useState('')
  const [type, setType] = useState<ClockType>('entrada')
  const [dt, setDt] = useState(() => toLocalInput(new Date()))
  const [reason, setReason] = useState('')
  const valid = empId && dt && reason.trim().length > 0
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-4">Añadir fichaje</p>
      <label className="text-xs text-text-secondary block mb-1">Empleado</label>
      <select value={empId} onChange={e => setEmpId(e.target.value)}
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary mb-3">
        <option value="">Elegir…</option>
        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">Tipo</label>
          <select value={type} onChange={e => setType(e.target.value as ClockType)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">Fecha y hora reales</label>
          <input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        </div>
      </div>

      <label className="text-xs text-text-secondary block mb-1">Motivo (obligatorio)</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)}
        placeholder='Ej: "olvidó fichar la entrada", "GPS no funcionaba"'
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

      <ErrLine err={err} />
      <button disabled={!valid || busy} onClick={() => onSubmit(empId, type, localToISO(dt), reason.trim())}
        className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
        {busy ? 'Guardando…' : 'Añadir fichaje'}
      </button>
      <button onClick={onClose} className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
    </ModalShell>
  )
}

function EditModal({ entry, busy, err, onClose, onSubmit }: {
  entry: ClockEntry & { employeeName: string }
  busy: boolean; err: string | null
  onClose: () => void
  onSubmit: (iso: string, type: ClockType, reason: string) => void
}) {
  const [dt, setDt] = useState(() => toLocalInput(new Date(entry.datetime)))
  const [type, setType] = useState<ClockType>(entry.type)
  const [reason, setReason] = useState('')
  const valid = dt && reason.trim().length > 0
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-1">Editar fichaje</p>
      <p className="text-sm text-text-secondary mb-4">{entry.employeeName} · original {new Date(entry.datetime).toLocaleString('es-ES')}</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">Tipo</label>
          <select value={type} onChange={e => setType(e.target.value as ClockType)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">Fecha y hora correctas</label>
          <input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        </div>
      </div>

      <label className="text-xs text-text-secondary block mb-1">Motivo de la corrección (obligatorio)</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)}
        placeholder='Ej: "fichó tarde por error, la entrada real fue a las 9:00"'
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />
      <p className="text-[10px] text-text-secondary mb-3">Queda registrado el cambio (antes/después, quién y por qué). El original no se pierde.</p>

      <ErrLine err={err} />
      <button disabled={!valid || busy} onClick={() => onSubmit(localToISO(dt), type, reason.trim())}
        className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
        {busy ? 'Guardando…' : 'Guardar corrección'}
      </button>
      <button onClick={onClose} className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
    </ModalShell>
  )
}

function ReasonModal({ title, subtitle, note, confirmLabel, danger, busy, err, onClose, onSubmit }: {
  title: string; subtitle?: string; note?: string; confirmLabel: string; danger?: boolean
  busy: boolean; err: string | null
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-1">{title}</p>
      {subtitle && <p className="text-sm text-text-secondary mb-3">{subtitle}</p>}
      {note && <p className="text-xs text-text-secondary mb-3">{note}</p>}
      <label className="text-xs text-text-secondary block mb-1">Motivo (obligatorio)</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)}
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />
      <ErrLine err={err} />
      <button disabled={reason.trim().length === 0 || busy} onClick={() => onSubmit(reason.trim())}
        className={`w-full py-3 rounded-xl font-medium text-text-on-accent disabled:opacity-50 transition-base ${danger ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover'}`}>
        {busy ? 'Guardando…' : confirmLabel}
      </button>
      <button onClick={onClose} className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
    </ModalShell>
  )
}

function ResolveModal({ request, empName, busy, err, onClose, onResolve }: {
  request: ClockCorrectionRequest
  empName: (id: string) => string
  busy: boolean; err: string | null
  onClose: () => void
  onResolve: (approve: boolean, note?: string) => void
}) {
  const [note, setNote] = useState('')
  const kindLabel = request.kind === 'add' ? 'Añadir fichaje' : request.kind === 'edit' ? 'Corregir fichaje' : 'Anular fichaje'
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-1">Solicitud de corrección</p>
      <p className="text-sm text-text-secondary mb-3">{empName(request.employeeId)} · {kindLabel}</p>

      <div className="bg-page rounded-lg p-3 text-sm text-text-primary space-y-1 mb-3">
        {request.proposedType && <p><span className="text-text-secondary">Tipo:</span> {request.proposedType}</p>}
        {request.proposedDatetime && <p><span className="text-text-secondary">Hora propuesta:</span> {new Date(request.proposedDatetime).toLocaleString('es-ES')}</p>}
        <p className="italic">"{request.reason}"</p>
        {request.requestedByEmployeeId !== request.employeeId && (
          <p className="text-[10px] text-text-secondary">Solicitado por {empName(request.requestedByEmployeeId)}</p>
        )}
      </div>

      <label className="text-xs text-text-secondary block mb-1">Nota (opcional)</label>
      <textarea value={note} onChange={e => setNote(e.target.value)}
        placeholder="Se le muestra al trabajador"
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-16 resize-none" />

      <ErrLine err={err} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onResolve(false, note.trim() || undefined)}
          className="flex-1 py-3 rounded-xl border border-border-default text-text-secondary font-medium hover:bg-page disabled:opacity-50 transition-base inline-flex items-center justify-center gap-1">
          <X size={16} /> Rechazar
        </button>
        <button disabled={busy} onClick={() => onResolve(true, note.trim() || undefined)}
          className="flex-1 py-3 rounded-xl bg-success text-text-on-accent font-medium hover:opacity-90 disabled:opacity-50 transition-base inline-flex items-center justify-center gap-1">
          <Check size={16} /> Aprobar
        </button>
      </div>
      <button onClick={onClose} className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">Cerrar</button>
    </ModalShell>
  )
}

const ACTION_LABEL: Record<ClockEntryAudit['action'], string> = {
  create_manual: 'Alta manual', edit: 'Editado', void: 'Anulado', restore: 'Reactivado',
  request: 'Solicitud', approve: 'Aprobado', reject: 'Rechazado',
}

function HistoryModal({ entry, rows, empName, onClose }: {
  entry: ClockEntry & { employeeName: string }
  rows: ClockEntryAudit[] | null
  empName: (id: string) => string
  onClose: () => void
}) {
  function snapTime(v: unknown): string {
    const o = v as { datetime?: string } | null
    return o?.datetime ? new Date(o.datetime).toLocaleString('es-ES') : '—'
  }
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-1">Historial de cambios</p>
      <p className="text-sm text-text-secondary mb-4">{entry.employeeName} · {new Date(entry.datetime).toLocaleString('es-ES')}</p>

      {rows === null ? (
        <p className="text-sm text-text-secondary py-6 text-center">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary py-6 text-center">Sin cambios registrados en este fichaje.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="border border-border-default rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge color={r.action === 'void' ? 'red' : r.action === 'edit' ? 'yellow' : r.action === 'approve' ? 'green' : 'gray'}>
                  {ACTION_LABEL[r.action]}
                </Badge>
                <span className="text-xs text-text-secondary">{new Date(r.createdAt).toLocaleString('es-ES')}</span>
              </div>
              {(Boolean(r.before) || Boolean(r.after)) && (
                <p className="text-xs text-text-primary mt-2">
                  {snapTime(r.before)} <span className="text-text-secondary">→</span> {snapTime(r.after)}
                </p>
              )}
              {r.reason && <p className="text-xs text-text-secondary mt-1 italic">"{r.reason}"</p>}
              <p className="text-[10px] text-text-secondary mt-1">
                {r.actorLabel || (r.actorEmployeeId ? empName(r.actorEmployeeId) : r.actorUserId ? 'Gestor' : 'Sistema')}
              </p>
            </div>
          ))}
        </div>
      )}
      <button onClick={onClose} className="w-full py-2 mt-4 text-sm text-text-secondary hover:text-text-primary">Cerrar</button>
    </ModalShell>
  )
}
