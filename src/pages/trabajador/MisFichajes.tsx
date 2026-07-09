// src/pages/trabajador/MisFichajes.tsx
import { useMemo, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Clock, Plus, AlertTriangle, Check, X, Hourglass } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee, ClockEntry } from '../../types'
import {
  requestClockCorrection, fetchMyCorrectionRequests,
  type ClockCorrectionRequest, type ClockType, type CorrectionKind,
} from '../../services/clockEditService'

interface Props {
  employee: Employee
  onBack: () => void
}

// Helpers de fecha para <input type="datetime-local">.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localToISO(local: string): string { return new Date(local).toISOString() }

export default function MisFichajes({ employee, onBack }: Props) {
  const { staff, locations } = useApp()
  const current = staff.find(e => e.id === employee.id) || employee
  const entries = current.clockEntries || []

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
  }, [entries])

  // Agrupar por día
  const grouped = useMemo(() => {
    const groups = new Map<string, ClockEntry[]>()
    for (const e of sorted) {
      const day = e.datetime.slice(0, 10)
      if (!groups.has(day)) groups.set(day, [])
      groups.get(day)!.push(e)
    }
    return Array.from(groups.entries())
  }, [sorted])

  // Horas por día (excluye anulados)
  function hoursWorked(dayEntries: ClockEntry[]): number {
    const asc = [...dayEntries].filter(e => !e.voided).sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    let total = 0
    let lastEntry: ClockEntry | null = null
    for (const e of asc) {
      if (e.type === 'entrada') lastEntry = e
      else if (e.type === 'salida' && lastEntry) {
        total += (new Date(e.datetime).getTime() - new Date(lastEntry.datetime).getTime()) / 3600000
        lastEntry = null
      }
    }
    return total
  }

  function locationName(id?: string): string {
    if (!id) return ''
    return locations.find(l => l.id === id)?.name || ''
  }

  // ── Solicitudes de corrección ────────────────────────────────────────
  const [requests, setRequests] = useState<ClockCorrectionRequest[]>([])
  const loadRequests = useCallback(async () => {
    setRequests(await fetchMyCorrectionRequests(employee.id))
  }, [employee.id])
  useEffect(() => { void loadRequests() }, [loadRequests])

  const [showAdd, setShowAdd] = useState(false)
  const [entryTarget, setEntryTarget] = useState<ClockEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  async function submit(kind: CorrectionKind, reason: string, opts?: { clockEntryId?: string; proposedType?: ClockType; proposedDatetime?: string }) {
    setBusy(true); setErr(null)
    try {
      await requestClockCorrection({
        employeeId: employee.id,
        requestedByEmployeeId: employee.id,
        kind, reason,
        clockEntryId: opts?.clockEntryId,
        proposedType: opts?.proposedType,
        proposedDatetime: opts?.proposedDatetime,
      })
      setShowAdd(false); setEntryTarget(null)
      setOkMsg('Solicitud enviada. Tu encargado la revisará.')
      await loadRequests()
      setTimeout(() => setOkMsg(null), 3500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo enviar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-page p-4 pb-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mis fichajes</p>
            <p className="font-bold text-text-primary">{current.name.split(' ')[0]}</p>
          </div>
          <button onClick={() => { setShowAdd(true); setErr(null) }}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent text-text-on-accent text-xs font-medium hover:bg-accent-hover transition-base">
            <Plus size={12} /> Reportar olvido
          </button>
        </div>

        {okMsg && (
          <div className="mb-4 bg-success-bg border border-success/30 rounded-xl px-3 py-2 flex items-center gap-2">
            <Check size={14} className="text-success" />
            <span className="text-xs text-success font-medium">{okMsg}</span>
          </div>
        )}

        {/* Mis solicitudes */}
        {requests.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 px-1">Mis solicitudes</p>
            <div className="space-y-2">
              {requests.slice(0, 5).map(r => {
                const badge = {
                  pending:   { label: 'Pendiente', cls: 'bg-warning-bg text-warning', Icon: Hourglass },
                  approved:  { label: 'Aprobada',  cls: 'bg-success-bg text-success', Icon: Check },
                  rejected:  { label: 'Rechazada', cls: 'bg-danger-bg text-danger',  Icon: X },
                  cancelled: { label: 'Cancelada', cls: 'bg-accent-bg text-text-secondary', Icon: X },
                }[r.status]
                const BIcon = badge.Icon
                const kindTxt = r.kind === 'add' ? 'Añadir' : r.kind === 'edit' ? 'Corregir' : 'Anular'
                return (
                  <Card key={r.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text-primary">
                        {kindTxt}
                        {r.proposedType ? ` ${r.proposedType}` : ''}
                        {r.proposedDatetime ? ` · ${new Date(r.proposedDatetime).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                      </p>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                        <BIcon size={11} /> {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5 italic">"{r.reason}"</p>
                    {r.resolutionNote && <p className="text-xs mt-1 px-2 py-1 rounded bg-page text-text-secondary">{r.resolutionNote}</p>}
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {grouped.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="flex justify-center mb-2"><Clock size={32} className="text-accent" /></div>
            <p className="font-semibold text-text-primary">Sin fichajes aún</p>
            <p className="text-xs text-text-secondary mt-1">Tus fichajes aparecerán aquí</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {grouped.map(([day, dayEntries]) => {
              const date = new Date(day)
              const hrs = hoursWorked(dayEntries)
              const dayLabel = date.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' })
              return (
                <div key={day}>
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{dayLabel}</p>
                    {hrs > 0 && <p className="text-xs font-bold text-accent">{hrs.toFixed(1)}h</p>}
                  </div>
                  <Card className="overflow-hidden">
                    {dayEntries.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()).map((e, i) => (
                      <div key={e.id || i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border-default' : ''} ${e.voided ? 'opacity-40' : ''}`}>
                        <span className={`w-2 h-2 rounded-full ${e.voided ? 'bg-text-secondary' : e.type === 'entrada' ? 'bg-success' : 'bg-warning'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium text-text-primary ${e.voided ? 'line-through' : ''}`}>
                            {e.type === 'entrada' ? '→ Entrada' : '← Salida'}
                            {e.voided && <span className="ml-1 text-[10px] font-normal text-text-secondary">(anulado)</span>}
                          </p>
                          {e.locationIdAtClock && (
                            <p className="text-[10px] text-text-secondary">{locationName(e.locationIdAtClock)}</p>
                          )}
                        </div>
                        <p className={`text-sm tabular-nums text-text-secondary font-medium ${e.voided ? 'line-through' : ''}`}>
                          {new Date(e.datetime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {!e.voided && (
                          <button onClick={() => { setEntryTarget(e); setErr(null) }}
                            className="text-[11px] text-accent hover:underline shrink-0">
                            Corregir
                          </button>
                        )}
                      </div>
                    ))}
                  </Card>
                </div>
              )
            })}
          </div>
        )}

        {/* Modal: olvidé fichar (add) */}
        {showAdd && (
          <AddRequestModal busy={busy} err={err}
            onClose={() => setShowAdd(false)}
            onSubmit={(type, iso, reason) => submit('add', reason, { proposedType: type, proposedDatetime: iso })} />
        )}

        {/* Modal: corregir/anular un fichaje concreto */}
        {entryTarget && (
          <EntryRequestModal entry={entryTarget} busy={busy} err={err}
            onClose={() => setEntryTarget(null)}
            onEdit={(iso, reason) => submit('edit', reason, { clockEntryId: entryTarget.id, proposedType: entryTarget.type, proposedDatetime: iso })}
            onVoid={(reason) => submit('void', reason, { clockEntryId: entryTarget.id })} />
        )}
      </div>
    </div>
  )
}

// ── Modales ──────────────────────────────────────────────────────────────

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function ErrLine({ err }: { err: string | null }) {
  if (!err) return null
  return <p className="text-sm text-danger mb-3 inline-flex items-center gap-1"><AlertTriangle size={14} /> {err}</p>
}

function AddRequestModal({ busy, err, onClose, onSubmit }: {
  busy: boolean; err: string | null
  onClose: () => void
  onSubmit: (type: ClockType, iso: string, reason: string) => void
}) {
  const [type, setType] = useState<ClockType>('entrada')
  const [dt, setDt] = useState(() => toLocalInput(new Date()))
  const [reason, setReason] = useState('')
  const valid = dt && reason.trim().length > 0
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-1">Reportar un olvido</p>
      <p className="text-sm text-text-secondary mb-4">Dile a tu encargado qué fichaje falta. Él lo revisa y lo añade.</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1">¿Qué olvidaste?</label>
          <select value={type} onChange={e => setType(e.target.value as ClockType)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1">¿A qué hora fue?</label>
          <input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        </div>
      </div>

      <label className="text-xs text-text-secondary block mb-1">Explica qué pasó</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Ej: me olvidé de fichar al entrar"
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

      <ErrLine err={err} />
      <button disabled={!valid || busy} onClick={() => onSubmit(type, localToISO(dt), reason.trim())}
        className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">
        {busy ? 'Enviando…' : 'Enviar solicitud'}
      </button>
      <button onClick={onClose} className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
    </ModalShell>
  )
}

function EntryRequestModal({ entry, busy, err, onClose, onEdit, onVoid }: {
  entry: ClockEntry
  busy: boolean; err: string | null
  onClose: () => void
  onEdit: (iso: string, reason: string) => void
  onVoid: (reason: string) => void
}) {
  const [mode, setMode] = useState<'edit' | 'void'>('edit')
  const [dt, setDt] = useState(() => toLocalInput(new Date(entry.datetime)))
  const [reason, setReason] = useState('')
  const valid = reason.trim().length > 0 && (mode === 'void' || !!dt)
  return (
    <ModalShell>
      <p className="font-bold text-lg mb-1">Corregir fichaje</p>
      <p className="text-sm text-text-secondary mb-4">
        {entry.type === 'entrada' ? 'Entrada' : 'Salida'} · {new Date(entry.datetime).toLocaleString('es-ES')}
      </p>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setMode('edit')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${mode === 'edit' ? 'bg-accent text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}>
          La hora está mal
        </button>
        <button onClick={() => setMode('void')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${mode === 'void' ? 'bg-danger text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}>
          Este fichaje sobra
        </button>
      </div>

      {mode === 'edit' && (
        <div className="mb-3">
          <label className="text-xs text-text-secondary block mb-1">¿A qué hora fue de verdad?</label>
          <input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        </div>
      )}

      <label className="text-xs text-text-secondary block mb-1">Explica qué pasó</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)}
        placeholder={mode === 'edit' ? 'Ej: fiché tarde, la entrada fue a las 9:00' : 'Ej: fiché dos veces sin querer'}
        className="w-full border border-border-default rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

      <ErrLine err={err} />
      <button disabled={!valid || busy}
        onClick={() => mode === 'edit' ? onEdit(localToISO(dt), reason.trim()) : onVoid(reason.trim())}
        className={`w-full py-3 rounded-xl font-medium text-text-on-accent disabled:opacity-50 transition-base ${mode === 'void' ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover'}`}>
        {busy ? 'Enviando…' : 'Enviar solicitud'}
      </button>
      <button onClick={onClose} className="w-full py-2 mt-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
    </ModalShell>
  )
}
