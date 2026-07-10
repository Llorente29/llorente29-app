// src/pages/trabajador/MisFichajes.tsx
import { useMemo, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Clock, Plus, AlertTriangle, Check, X, Hourglass, CheckCircle2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee, ClockEntry } from '../../types'
import {
  requestClockCorrection, fetchMyCorrectionRequests,
  type ClockCorrectionRequest, type ClockType, type CorrectionKind,
} from '../../services/clockEditService'

interface Props { employee: Employee; onBack: () => void }

// Motivos prefijados en lenguaje de trabajador (+ "Otro" texto libre).
const REASONS_ADD = ['Me olvidé de fichar la entrada', 'Me olvidé de fichar la salida', 'El GPS no iba', 'La app fallaba', 'Otro']
const REASONS_EDIT = ['Fiché tarde', 'Fiché antes de tiempo', 'La hora está mal', 'Otro']
const REASONS_VOID = ['Fiché dos veces', 'Fiché por error', 'Otro']

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
function effectiveReason(v: string): string { return v === '__other__' ? '' : v.trim() }

export default function MisFichajes({ employee, onBack }: Props) {
  const { staff, locations } = useApp()
  const current = staff.find(e => e.id === employee.id) || employee
  const entries = current.clockEntries || []

  const sorted = useMemo(() => [...entries].sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime()), [entries])
  const grouped = useMemo(() => {
    const g = new Map<string, ClockEntry[]>()
    for (const e of sorted) { const day = e.datetime.slice(0, 10); if (!g.has(day)) g.set(day, []); g.get(day)!.push(e) }
    return Array.from(g.entries())
  }, [sorted])

  function hoursWorked(dayEntries: ClockEntry[]): number {
    const asc = [...dayEntries].filter(e => !e.voided).sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    let total = 0, last: ClockEntry | null = null
    for (const e of asc) {
      if (e.type === 'entrada') last = e
      else if (e.type === 'salida' && last) { total += (new Date(e.datetime).getTime() - new Date(last.datetime).getTime()) / 3600000; last = null }
    }
    return total
  }
  function locationName(id?: string): string { return id ? (locations.find(l => l.id === id)?.name || '') : '' }

  const [requests, setRequests] = useState<ClockCorrectionRequest[]>([])
  const loadRequests = useCallback(async () => { setRequests(await fetchMyCorrectionRequests(employee.id)) }, [employee.id])
  useEffect(() => { void loadRequests() }, [loadRequests])

  const [showAdd, setShowAdd] = useState(false)
  const [entryTarget, setEntryTarget] = useState<ClockEntry | null>(null)

  async function submit(kind: CorrectionKind, reason: string, opts?: { clockEntryId?: string; proposedType?: ClockType; proposedDatetime?: string }) {
    await requestClockCorrection({
      employeeId: employee.id, requestedByEmployeeId: employee.id, kind, reason,
      clockEntryId: opts?.clockEntryId, proposedType: opts?.proposedType, proposedDatetime: opts?.proposedDatetime,
    })
    await loadRequests()
  }

  return (
    <div className="min-h-screen bg-page p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver"><ArrowLeft size={20} /></button>
          <div className="flex-1">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mis fichajes</p>
            <p className="font-bold text-text-primary">{current.name.split(' ')[0]}</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent text-text-on-accent text-xs font-medium hover:bg-accent-hover transition-base"><Plus size={12} /> Reportar olvido</button>
        </div>

        {requests.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 px-1">Mis solicitudes</p>
            <div className="space-y-2">
              {requests.slice(0, 5).map(r => {
                const b = {
                  pending: { label: 'Pendiente', cls: 'bg-warning-bg text-warning', Icon: Hourglass },
                  approved: { label: 'Aprobada', cls: 'bg-success-bg text-success', Icon: Check },
                  rejected: { label: 'Rechazada', cls: 'bg-danger-bg text-danger', Icon: X },
                  cancelled: { label: 'Cancelada', cls: 'bg-accent-bg text-text-secondary', Icon: X },
                }[r.status]
                const BIcon = b.Icon
                const kindTxt = r.kind === 'add' ? 'Añadir' : r.kind === 'edit' ? 'Corregir' : 'Anular'
                return (
                  <Card key={r.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text-primary">
                        {kindTxt}{r.proposedType ? ` ${r.proposedType}` : ''}{r.proposedDatetime ? ` · ${prettyISO(r.proposedDatetime)}` : ''}
                      </p>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${b.cls}`}><BIcon size={11} /> {b.label}</span>
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
              const hrs = hoursWorked(dayEntries)
              const dayLabel = new Date(day).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' })
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
                            {e.type === 'entrada' ? '→ Entrada' : '← Salida'}{e.voided && <span className="ml-1 text-[10px] font-normal text-text-secondary">(anulado)</span>}
                          </p>
                          {e.locationIdAtClock && <p className="text-[10px] text-text-secondary">{locationName(e.locationIdAtClock)}</p>}
                        </div>
                        <p className={`text-sm tabular-nums text-text-secondary font-medium ${e.voided ? 'line-through' : ''}`}>
                          {new Date(e.datetime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {!e.voided && <button onClick={() => setEntryTarget(e)} className="text-[11px] text-accent hover:underline shrink-0">Corregir</button>}
                      </div>
                    ))}
                  </Card>
                </div>
              )
            })}
          </div>
        )}

        {showAdd && (
          <AddRequestModal onClose={() => setShowAdd(false)}
            submit={(type, iso, reason) => submit('add', reason, { proposedType: type, proposedDatetime: iso })} />
        )}
        {entryTarget && (
          <EntryRequestModal entry={entryTarget} onClose={() => setEntryTarget(null)}
            onEdit={(iso, reason) => submit('edit', reason, { clockEntryId: entryTarget.id, proposedType: entryTarget.type, proposedDatetime: iso })}
            onVoid={(reason) => submit('void', reason, { clockEntryId: entryTarget.id })} />
        )}
      </div>
    </div>
  )
}

// ── Piezas de modal ────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // No se cierra al pinchar fuera (no se pierde lo escrito): solo X o botones.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-2 sticky top-0 bg-card">
          <p className="font-bold text-lg">{title}</p>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-full text-text-secondary hover:bg-page flex items-center justify-center transition-base"><X size={18} /></button>
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

function ReasonPicker({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const showOther = value === '__other__' || (value !== '' && !options.includes(value))
  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1.5">¿Qué pasó?</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {options.map(o => {
          const active = o === 'Otro' ? showOther : value === o
          return (
            <button key={o} type="button" onClick={() => onChange(o === 'Otro' ? '__other__' : o)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-base ${active ? 'bg-accent text-text-on-accent border-accent' : 'bg-card border-border-default text-text-secondary hover:border-accent'}`}>{o}</button>
          )
        })}
      </div>
      {showOther && (
        <textarea autoFocus value={value === '__other__' ? '' : value} onChange={e => onChange(e.target.value)} placeholder="Escríbelo"
          className="w-full border border-border-default rounded-lg px-3 py-2 text-sm h-16 resize-none" />
      )}
    </div>
  )
}

function DateTimeField({ date, time, onDate, onTime }: { date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void }) {
  const setDayOffset = (off: number) => { const d = new Date(); d.setDate(d.getDate() + off); onDate(dateStr(d)) }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-text-secondary">¿Qué día y a qué hora?</label>
        <div className="flex gap-1">
          <button type="button" onClick={() => setDayOffset(0)} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent">Hoy</button>
          <button type="button" onClick={() => setDayOffset(-1)} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent">Ayer</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={date} onChange={e => onDate(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        <input type="time" value={time} onChange={e => onTime(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
      </div>
      {date && time && <p className="text-xs text-accent mt-1.5 font-medium">{prettyDT(date, time)}</p>}
    </div>
  )
}

function SentPanel({ lines, onClose }: { lines: { label: string; value: string }[]; onClose: () => void }) {
  return (
    <div className="text-center py-2">
      <div className="flex justify-center mb-3"><CheckCircle2 size={56} className="text-success" /></div>
      <p className="font-bold text-lg text-success mb-1">Solicitud enviada</p>
      <p className="text-xs text-text-secondary mb-3">Tu encargado la revisará. Verás el resultado en "Mis solicitudes".</p>
      <div className="bg-page rounded-lg p-3 text-left text-sm space-y-1 mb-4">
        {lines.map((l, i) => <p key={i}><span className="text-text-secondary">{l.label}:</span> <span className="text-text-primary font-medium">{l.value}</span></p>)}
      </div>
      <button onClick={onClose} className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover transition-base">Cerrar</button>
    </div>
  )
}

function AddRequestModal({ onClose, submit }: {
  onClose: () => void
  submit: (type: ClockType, iso: string, reason: string) => Promise<void>
}) {
  const now = new Date()
  const [type, setType] = useState<ClockType>('entrada')
  const [date, setDate] = useState(dateStr(now))
  const [time, setTime] = useState(timeStr(now))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ label: string; value: string }[] | null>(null)
  const finalReason = effectiveReason(reason)
  const valid = date && time && finalReason.length > 0

  async function go() {
    setBusy(true); setErr(null)
    try {
      await submit(type, combineISO(date, time), finalReason)
      setDone([
        { label: 'Fichaje', value: `${type === 'entrada' ? 'Entrada' : 'Salida'} · ${prettyDT(date, time)}` },
        { label: 'Motivo', value: finalReason },
      ])
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo enviar') } finally { setBusy(false) }
  }

  return (
    <ModalShell title={done ? 'Enviada' : 'Reportar un olvido'} onClose={onClose}>
      {done ? <SentPanel lines={done} onClose={onClose} /> : (
        <>
          <p className="text-sm text-text-secondary mb-4">Dile a tu encargado qué fichaje falta. Él lo revisa y lo añade.</p>
          <div className="mb-3">
            <label className="text-xs text-text-secondary block mb-1">¿Qué olvidaste?</label>
            <div className="flex gap-2">
              <button onClick={() => setType('entrada')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${type === 'entrada' ? 'bg-success text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}>Entrada</button>
              <button onClick={() => setType('salida')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${type === 'salida' ? 'bg-warning text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}>Salida</button>
            </div>
          </div>
          <div className="mb-3"><DateTimeField date={date} time={time} onDate={setDate} onTime={setTime} /></div>
          <div className="mb-4"><ReasonPicker options={REASONS_ADD} value={reason} onChange={setReason} /></div>
          <ErrLine err={err} />
          <button disabled={!valid || busy} onClick={go} className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover disabled:opacity-50 transition-base">{busy ? 'Enviando…' : 'Enviar solicitud'}</button>
        </>
      )}
    </ModalShell>
  )
}

function EntryRequestModal({ entry, onClose, onEdit, onVoid }: {
  entry: ClockEntry
  onClose: () => void
  onEdit: (iso: string, reason: string) => Promise<void>
  onVoid: (reason: string) => Promise<void>
}) {
  const orig = new Date(entry.datetime)
  const [mode, setMode] = useState<'edit' | 'void'>('edit')
  const [date, setDate] = useState(dateStr(orig))
  const [time, setTime] = useState(timeStr(orig))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ label: string; value: string }[] | null>(null)
  const finalReason = effectiveReason(reason)
  const valid = finalReason.length > 0 && (mode === 'void' || (!!date && !!time))

  async function go() {
    setBusy(true); setErr(null)
    try {
      if (mode === 'edit') await onEdit(combineISO(date, time), finalReason)
      else await onVoid(finalReason)
      setDone([
        { label: 'Fichaje', value: `${entry.type === 'entrada' ? 'Entrada' : 'Salida'} · ${prettyISO(entry.datetime)}` },
        { label: 'Pides', value: mode === 'edit' ? `Cambiar a ${prettyDT(date, time)}` : 'Anularlo' },
        { label: 'Motivo', value: finalReason },
      ])
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo enviar') } finally { setBusy(false) }
  }

  return (
    <ModalShell title={done ? 'Enviada' : 'Corregir fichaje'} onClose={onClose}>
      {done ? <SentPanel lines={done} onClose={onClose} /> : (
        <>
          <div className="bg-page rounded-lg px-3 py-2 text-sm mb-4">
            <span className="text-text-secondary">Fichaje:</span> <span className="text-text-primary font-medium">{entry.type === 'entrada' ? 'Entrada' : 'Salida'} · {prettyISO(entry.datetime)}</span>
          </div>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode('edit')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${mode === 'edit' ? 'bg-accent text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}>La hora está mal</button>
            <button onClick={() => setMode('void')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${mode === 'void' ? 'bg-danger text-text-on-accent' : 'bg-card border border-border-default text-text-secondary'}`}>Este sobra</button>
          </div>
          {mode === 'edit' && <div className="mb-3"><DateTimeField date={date} time={time} onDate={setDate} onTime={setTime} /></div>}
          <div className="mb-4"><ReasonPicker options={mode === 'edit' ? REASONS_EDIT : REASONS_VOID} value={reason} onChange={setReason} /></div>
          <ErrLine err={err} />
          <button disabled={!valid || busy} onClick={go}
            className={`w-full py-3 rounded-xl font-medium text-text-on-accent disabled:opacity-50 transition-base ${mode === 'void' ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover'}`}>{busy ? 'Enviando…' : 'Enviar solicitud'}</button>
        </>
      )}
    </ModalShell>
  )
}
