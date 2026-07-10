import { useState, useEffect, useCallback } from 'react'
import {
  LogIn, LogOut, Users, Clock, Activity, Plus, Pencil, Ban, History,
  Check, X, AlertTriangle, Inbox, Search, CheckCircle2,
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

// Motivos prefijados (Inspección quiere consistencia; "Otro" abre texto libre).
const REASONS_ADD = ['No fichó la entrada', 'No fichó la salida', 'El GPS no funcionaba', 'La app fallaba', 'Fuera de cobertura', 'Otro']
const REASONS_EDIT = ['Fichó tarde por error', 'Fichó antes de tiempo', 'Hora incorrecta', 'Corrección de turno', 'Otro']
const REASONS_VOID = ['Fichaje duplicado', 'Fichaje por error', 'Local equivocado', 'Prueba', 'Otro']

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// ── Helpers de fecha/hora (campos separados date + time) ──────────────────
const pad = (n: number) => String(n).padStart(2, '0')
function dateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function timeStr(d: Date) { return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function combineISO(date: string, time: string): string { return new Date(`${date}T${time}`).toISOString() }
function prettyDT(date: string, time: string): string {
  return new Date(`${date}T${time}`).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function prettyISO(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function FichajesGlobalPage() {
  const { staff, locations } = useApp()
  const today = new Date()
  const [dateFrom, setDateFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10))
  const [empFilter, setEmpFilter] = useState('')
  const [locFilter, setLocFilter] = useState('todas')

  const { resolvedLocationId } = useLocationScope()
  useEffect(() => { setLocFilter(resolvedLocationId ?? 'todas') }, [resolvedLocationId])

  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<(ClockEntry & { employeeName: string }) | null>(null)
  const [voidTarget, setVoidTarget] = useState<(ClockEntry & { employeeName: string }) | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ entry: ClockEntry & { employeeName: string }; rows: ClockEntryAudit[] | null } | null>(null)
  const [resolveTarget, setResolveTarget] = useState<ClockCorrectionRequest | null>(null)

  const [requests, setRequests] = useState<ClockCorrectionRequest[]>([])
  const loadRequests = useCallback(async () => { setRequests(await fetchCorrectionRequests('pending')) }, [])
  useEffect(() => { void loadRequests() }, [loadRequests])

  function empName(id: string): string { return staff.find(e => e.id === id)?.name || '—' }

  const filtered = staff.filter(e =>
    (!empFilter || e.id === empFilter) &&
    (locFilter === 'todas' || e.locationId === locFilter))

  const allEntries = filtered
    .flatMap(e => e.clockEntries
      .filter(c => c.datetime >= dateFrom && c.datetime <= dateTo + 'T23:59:59')
      .map(c => ({ ...c, employeeName: e.name, employeePos: e.position, employeeId: e.id, employeeLocationId: e.locationId })))
    .sort((a, b) => b.datetime.localeCompare(a.datetime))

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

  async function openHistory(entry: ClockEntry & { employeeName: string }) {
    setHistoryTarget({ entry, rows: null })
    setHistoryTarget({ entry, rows: await fetchClockAudit(entry.id) })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-accent">Control Horario</h1>
          <p className="text-sm text-text-secondary mt-0.5">{liveEntries.length} fichajes en el periodo</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-base shrink-0">
          <Plus size={16} /> Añadir fichaje
        </button>
      </div>

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
                      {' · '}{r.kind === 'add' ? 'Añadir' : r.kind === 'edit' ? 'Corregir' : 'Anular'}
                      {r.proposedType ? ` ${r.proposedType}` : ''}
                      {r.proposedDatetime ? ` → ${prettyISO(r.proposedDatetime)}` : ''}
                    </span>
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5 italic">"{r.reason}"</p>
                  {r.requestedByEmployeeId !== r.employeeId && (
                    <p className="text-[10px] text-text-secondary mt-0.5">Solicitado por {empName(r.requestedByEmployeeId)}</p>
                  )}
                </div>
                <button onClick={() => setResolveTarget(r)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent-bg text-accent font-medium hover:bg-accent hover:text-text-on-accent transition-base shrink-0">
                  Revisar
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="p-4 rounded-lg border border-border-default bg-accent-bg text-accent">
              <div className="flex items-center gap-2 mb-1"><Icon size={18} /><p className="text-2xl font-bold">{s.val}</p></div>
              <p className="text-xs">{s.label}</p>
            </div>
          )
        })}
      </div>

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
                      if (e.lat == null || e.lng == null || !loc || loc.lat == null || loc.lng == null) return <span className="text-text-secondary">sin GPS</span>
                      const dist = Math.round(haversineM(e.lat, e.lng, loc.lat, loc.lng))
                      const lejos = dist > (loc.clockRadiusM ?? DEFAULT_RADIUS_M)
                      return (
                        <span className={`inline-flex items-center gap-1 font-semibold ${lejos ? 'text-danger' : 'text-success'}`}>
                          {lejos && <span aria-hidden>⚠️</span>}{dist} m{lejos && <span className="font-normal text-text-secondary">· fuera</span>}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Historial de cambios" onClick={() => openHistory(e)}
                        className="w-8 h-8 rounded-lg text-text-secondary hover:bg-accent-bg hover:text-accent flex items-center justify-center transition-base"><History size={15} /></button>
                      {!e.voided && (<>
                        <button title="Editar hora" onClick={() => setEditTarget(e)}
                          className="w-8 h-8 rounded-lg text-text-secondary hover:bg-accent-bg hover:text-accent flex items-center justify-center transition-base"><Pencil size={15} /></button>
                        <button title="Anular" onClick={() => setVoidTarget(e)}
                          className="w-8 h-8 rounded-lg text-text-secondary hover:bg-danger-bg hover:text-danger flex items-center justify-center transition-base"><Ban size={15} /></button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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
                    <td className="p-3"><p className="font-medium text-text-primary">{e.name}</p><p className="text-xs text-text-secondary">{e.position}</p></td>
                    <td className="p-3 text-center text-text-primary">{e.totalEntries}</td>
                    <td className="p-3 text-center font-medium text-text-primary">{e.totalHours}h</td>
                    <td className="p-3 text-center"><Badge color={live[0]?.type === 'entrada' ? 'green' : 'gray'}>{live[0]?.type === 'entrada' ? 'Dentro' : 'Fuera'}</Badge></td>
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
          onClose={() => setShowAdd(false)}
          submit={(empId, type, iso, reason) => addManualClockEntry(empId, type, iso, reason)}
        />
      )}
      {editTarget && (
        <EditModal
          entry={editTarget}
          onClose={() => setEditTarget(null)}
          submit={(iso, type, reason) => editClockEntry(editTarget.id, iso, reason, type)}
        />
      )}
      {voidTarget && (
        <VoidModal
          entry={voidTarget}
          onClose={() => setVoidTarget(null)}
          submit={(reason) => voidClockEntry(voidTarget.id, reason)}
        />
      )}
      {resolveTarget && (
        <ResolveModal
          request={resolveTarget} empName={empName}
          onClose={() => setResolveTarget(null)}
          onDone={loadRequests}
          submit={(approve, note) => resolveClockCorrection(resolveTarget.id, approve, note)}
        />
      )}
      {historyTarget && (
        <HistoryModal entry={historyTarget.entry} rows={historyTarget.rows} empName={empName} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// Piezas de UI de los modales
// ════════════════════════════════════════════════════════════════════════

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // NO se cierra al pinchar fuera (dato serio, no se pierde lo escrito): el
  // backdrop no tiene onClick; solo la X o los botones cierran.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-2 sticky top-0 bg-card">
          <p className="font-bold text-lg">{title}</p>
          <button onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-full text-text-secondary hover:bg-page flex items-center justify-center transition-base"><X size={18} /></button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}

function ErrLine({ err }: { err: string | null }) {
  if (!err) return null
  return <p className="text-sm text-danger mb-3 inline-flex items-center gap-1"><AlertTriangle size={14} /> {err}</p>
}

// Selector de motivo prefijado + "Otro" con texto libre.
function ReasonPicker({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const showOther = value === '__other__' || (value !== '' && !options.includes(value))
  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1.5">Motivo (obligatorio)</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {options.map(o => {
          const active = o === 'Otro' ? showOther : value === o
          return (
            <button key={o} type="button"
              onClick={() => onChange(o === 'Otro' ? '__other__' : o)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-base ${active ? 'bg-accent text-text-on-accent border-accent' : 'bg-card border-border-default text-text-secondary hover:border-accent'}`}>
              {o}
            </button>
          )
        })}
      </div>
      {showOther && (
        <textarea autoFocus value={value === '__other__' ? '' : value} onChange={e => onChange(e.target.value)}
          placeholder="Escribe el motivo"
          className="w-full border border-border-default rounded-lg px-3 py-2 text-sm h-16 resize-none" />
      )}
    </div>
  )
}
// El motivo efectivo: el chip elegido, o el texto libre; '' si aún nada válido.
function effectiveReason(v: string): string { return v === '__other__' ? '' : v.trim() }

// Campo fecha + hora separados, con chips Hoy/Ayer y vista previa.
function DateTimeField({ date, time, onDate, onTime }: {
  date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void
}) {
  const setDayOffset = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); onDate(dateStr(d)) }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-text-secondary">Fecha y hora reales</label>
        <div className="flex gap-1">
          <button type="button" onClick={() => setDayOffset(0)} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent hover:bg-accent hover:text-text-on-accent transition-base">Hoy</button>
          <button type="button" onClick={() => setDayOffset(-1)} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent hover:bg-accent hover:text-text-on-accent transition-base">Ayer</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={date} onChange={e => onDate(e.target.value)}
          className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        <input type="time" value={time} onChange={e => onTime(e.target.value)}
          className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
      </div>
      {date && time && (
        <p className="text-xs text-accent mt-1.5 font-medium">Quedará: {prettyDT(date, time)}</p>
      )}
    </div>
  )
}

function SuccessPanel({ lines, onClose }: { lines: { label: string; value: string }[]; onClose: () => void }) {
  return (
    <div className="text-center py-2">
      <div className="flex justify-center mb-3"><CheckCircle2 size={56} className="text-success" /></div>
      <p className="font-bold text-lg text-success mb-3">Hecho</p>
      <div className="bg-page rounded-lg p-3 text-left text-sm space-y-1 mb-4">
        {lines.map((l, i) => (
          <p key={i}><span className="text-text-secondary">{l.label}:</span> <span className="text-text-primary font-medium">{l.value}</span></p>
        ))}
      </div>
      <button onClick={onClose} className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover transition-base">Cerrar</button>
    </div>
  )
}

// ── Modales concretos ─────────────────────────────────────────────────────

function AddModal({ staff, onClose, submit }: {
  staff: { id: string; name: string }[]
  onClose: () => void
  submit: (empId: string, type: ClockType, iso: string, reason: string) => Promise<void>
}) {
  const now = new Date()
  const [empId, setEmpId] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ClockType>('entrada')
  const [date, setDate] = useState(dateStr(now))
  const [time, setTime] = useState(timeStr(now))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ label: string; value: string }[] | null>(null)

  const list = staff.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const chosen = staff.find(s => s.id === empId)
  const finalReason = effectiveReason(reason)
  const valid = empId && date && time && finalReason.length > 0

  async function go() {
    setBusy(true); setErr(null)
    try {
      await submit(empId, type, combineISO(date, time), finalReason)
      setDone([
        { label: 'Empleado', value: chosen?.name || '' },
        { label: 'Fichaje', value: `${type === 'entrada' ? 'Entrada' : 'Salida'} · ${prettyDT(date, time)}` },
        { label: 'Motivo', value: finalReason },
      ])
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setBusy(false) }
  }

  return (
    <ModalShell title={done ? 'Fichaje añadido' : 'Añadir fichaje'} onClose={onClose}>
      {done ? <SuccessPanel lines={done} onClose={onClose} /> : (
        <>
          {/* Empleado con buscador */}
          <label className="text-xs text-text-secondary block mb-1">Empleado</label>
          {chosen ? (
            <button onClick={() => setEmpId('')} className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-accent-bg border border-accent mb-3">
              <span className="text-sm font-medium text-text-primary">{chosen.name}</span>
              <span className="text-xs text-accent">Cambiar</span>
            </button>
          ) : (
            <div className="mb-3">
              <div className="relative mb-2">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar empleado…" autoFocus
                  className="w-full border border-border-default rounded-lg pl-9 pr-3 py-2 text-sm bg-card text-text-primary" />
              </div>
              <div className="max-h-40 overflow-y-auto border border-border-default rounded-lg divide-y divide-border-default">
                {list.length === 0 ? <p className="p-3 text-xs text-text-secondary text-center">Sin resultados</p>
                  : list.map(s => (
                    <button key={s.id} onClick={() => setEmpId(s.id)} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-accent-bg transition-base">{s.name}</button>
                  ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="text-xs text-text-secondary block mb-1">Tipo</label>
            <div className="flex gap-2">
              <button onClick={() => setType('entrada')} className={`flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1 transition-base ${type === 'entrada' ? 'bg-success text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}><LogIn size={14} /> Entrada</button>
              <button onClick={() => setType('salida')} className={`flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1 transition-base ${type === 'salida' ? 'bg-warning text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}><LogOut size={14} /> Salida</button>
            </div>
          </div>

          <div className="mb-3"><DateTimeField date={date} time={time} onDate={setDate} onTime={setTime} /></div>
          <div className="mb-4"><ReasonPicker options={REASONS_ADD} value={reason} onChange={setReason} /></div>

          <ErrLine err={err} />
          <button disabled={!valid || busy} onClick={go}
            className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
            {busy ? 'Guardando…' : 'Añadir fichaje'}
          </button>
        </>
      )}
    </ModalShell>
  )
}

function EditModal({ entry, onClose, submit }: {
  entry: ClockEntry & { employeeName: string }
  onClose: () => void
  submit: (iso: string, type: ClockType, reason: string) => Promise<void>
}) {
  const orig = new Date(entry.datetime)
  const [date, setDate] = useState(dateStr(orig))
  const [time, setTime] = useState(timeStr(orig))
  const [type, setType] = useState<ClockType>(entry.type)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ label: string; value: string }[] | null>(null)
  const finalReason = effectiveReason(reason)
  const valid = date && time && finalReason.length > 0

  async function go() {
    setBusy(true); setErr(null)
    try {
      await submit(combineISO(date, time), type, finalReason)
      setDone([
        { label: 'Empleado', value: entry.employeeName },
        { label: 'Antes', value: `${entry.type === 'entrada' ? 'Entrada' : 'Salida'} · ${prettyISO(entry.datetime)}` },
        { label: 'Después', value: `${type === 'entrada' ? 'Entrada' : 'Salida'} · ${prettyDT(date, time)}` },
        { label: 'Motivo', value: finalReason },
      ])
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setBusy(false) }
  }

  return (
    <ModalShell title={done ? 'Fichaje corregido' : 'Editar fichaje'} onClose={onClose}>
      {done ? <SuccessPanel lines={done} onClose={onClose} /> : (
        <>
          <div className="bg-page rounded-lg px-3 py-2 text-sm mb-3">
            <span className="text-text-secondary">Original:</span> <span className="text-text-primary font-medium">{entry.employeeName} · {entry.type === 'entrada' ? 'Entrada' : 'Salida'} · {prettyISO(entry.datetime)}</span>
          </div>

          <div className="mb-3">
            <label className="text-xs text-text-secondary block mb-1">Tipo</label>
            <div className="flex gap-2">
              <button onClick={() => setType('entrada')} className={`flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1 transition-base ${type === 'entrada' ? 'bg-success text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}><LogIn size={14} /> Entrada</button>
              <button onClick={() => setType('salida')} className={`flex-1 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1 transition-base ${type === 'salida' ? 'bg-warning text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}><LogOut size={14} /> Salida</button>
            </div>
          </div>

          <div className="mb-3"><DateTimeField date={date} time={time} onDate={setDate} onTime={setTime} /></div>
          <div className="mb-3"><ReasonPicker options={REASONS_EDIT} value={reason} onChange={setReason} /></div>
          <p className="text-[10px] text-text-secondary mb-3">Queda registrado el cambio (antes/después, quién y por qué). El original no se pierde.</p>

          <ErrLine err={err} />
          <button disabled={!valid || busy} onClick={go}
            className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
            {busy ? 'Guardando…' : 'Guardar corrección'}
          </button>
        </>
      )}
    </ModalShell>
  )
}

function VoidModal({ entry, onClose, submit }: {
  entry: ClockEntry & { employeeName: string }
  onClose: () => void
  submit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ label: string; value: string }[] | null>(null)
  const finalReason = effectiveReason(reason)

  async function go() {
    setBusy(true); setErr(null)
    try {
      await submit(finalReason)
      setDone([
        { label: 'Anulado', value: `${entry.employeeName} · ${entry.type === 'entrada' ? 'Entrada' : 'Salida'} · ${prettyISO(entry.datetime)}` },
        { label: 'Motivo', value: finalReason },
      ])
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo anular') } finally { setBusy(false) }
  }

  return (
    <ModalShell title={done ? 'Fichaje anulado' : 'Anular fichaje'} onClose={onClose}>
      {done ? <SuccessPanel lines={done} onClose={onClose} /> : (
        <>
          <div className="bg-page rounded-lg px-3 py-2 text-sm mb-3">
            <span className="text-text-secondary">Fichaje:</span> <span className="text-text-primary font-medium">{entry.employeeName} · {entry.type === 'entrada' ? 'Entrada' : 'Salida'} · {prettyISO(entry.datetime)}</span>
          </div>
          <p className="text-xs text-text-secondary mb-3">Se conserva anulado para el rastro legal (no se borra).</p>
          <div className="mb-4"><ReasonPicker options={REASONS_VOID} value={reason} onChange={setReason} /></div>
          <ErrLine err={err} />
          <button disabled={finalReason.length === 0 || busy} onClick={go}
            className="w-full py-3 rounded-xl bg-danger text-text-on-accent font-medium hover:opacity-90 disabled:opacity-50 transition-base">
            {busy ? 'Anulando…' : 'Anular fichaje'}
          </button>
        </>
      )}
    </ModalShell>
  )
}

function ResolveModal({ request, empName, onClose, onDone, submit }: {
  request: ClockCorrectionRequest
  empName: (id: string) => string
  onClose: () => void
  onDone: () => void
  submit: (approve: boolean, note?: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ label: string; value: string }[] | null>(null)
  const kindLabel = request.kind === 'add' ? 'Añadir fichaje' : request.kind === 'edit' ? 'Corregir fichaje' : 'Anular fichaje'

  async function go(approve: boolean) {
    setBusy(true); setErr(null)
    try {
      await submit(approve, note.trim() || undefined)
      onDone()
      setDone([
        { label: 'Empleado', value: empName(request.employeeId) },
        { label: 'Solicitud', value: kindLabel + (request.proposedDatetime ? ` · ${prettyISO(request.proposedDatetime)}` : '') },
        { label: 'Resultado', value: approve ? 'Aprobada y aplicada' : 'Rechazada' },
      ])
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo resolver') } finally { setBusy(false) }
  }

  return (
    <ModalShell title={done ? 'Solicitud resuelta' : 'Solicitud de corrección'} onClose={onClose}>
      {done ? <SuccessPanel lines={done} onClose={onClose} /> : (
        <>
          <p className="text-sm text-text-secondary mb-3">{empName(request.employeeId)} · {kindLabel}</p>
          <div className="bg-page rounded-lg p-3 text-sm text-text-primary space-y-1 mb-3">
            {request.proposedType && <p><span className="text-text-secondary">Tipo:</span> {request.proposedType}</p>}
            {request.proposedDatetime && <p><span className="text-text-secondary">Hora propuesta:</span> {prettyISO(request.proposedDatetime)}</p>}
            <p className="italic">"{request.reason}"</p>
            {request.requestedByEmployeeId !== request.employeeId && (
              <p className="text-[10px] text-text-secondary">Solicitado por {empName(request.requestedByEmployeeId)}</p>
            )}
          </div>
          <label className="text-xs text-text-secondary block mb-1">Nota para el trabajador (opcional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-16 resize-none" />
          <ErrLine err={err} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => go(false)}
              className="flex-1 py-3 rounded-xl border border-border-default text-text-secondary font-medium hover:bg-page disabled:opacity-50 transition-base inline-flex items-center justify-center gap-1"><X size={16} /> Rechazar</button>
            <button disabled={busy} onClick={() => go(true)}
              className="flex-1 py-3 rounded-xl bg-success text-text-on-accent font-medium hover:opacity-90 disabled:opacity-50 transition-base inline-flex items-center justify-center gap-1"><Check size={16} /> Aprobar</button>
          </div>
        </>
      )}
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
    return o?.datetime ? prettyISO(o.datetime) : '—'
  }
  return (
    <ModalShell title="Historial de cambios" onClose={onClose}>
      <p className="text-sm text-text-secondary mb-4">{entry.employeeName} · {prettyISO(entry.datetime)}</p>
      {rows === null ? <p className="text-sm text-text-secondary py-6 text-center">Cargando…</p>
        : rows.length === 0 ? <p className="text-sm text-text-secondary py-6 text-center">Sin cambios registrados en este fichaje.</p>
        : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="border border-border-default rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge color={r.action === 'void' ? 'red' : r.action === 'edit' ? 'yellow' : r.action === 'approve' ? 'green' : 'gray'}>{ACTION_LABEL[r.action]}</Badge>
                  <span className="text-xs text-text-secondary">{prettyISO(r.createdAt)}</span>
                </div>
                {(Boolean(r.before) || Boolean(r.after)) && (
                  <p className="text-xs text-text-primary mt-2">{snapTime(r.before)} <span className="text-text-secondary">→</span> {snapTime(r.after)}</p>
                )}
                {r.reason && <p className="text-xs text-text-secondary mt-1 italic">"{r.reason}"</p>}
                <p className="text-[10px] text-text-secondary mt-1">{r.actorLabel || (r.actorEmployeeId ? empName(r.actorEmployeeId) : r.actorUserId ? 'Gestor' : 'Sistema')}</p>
              </div>
            ))}
          </div>
        )}
    </ModalShell>
  )
}
