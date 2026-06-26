// src/modules/multitenancy/components/hours/BusinessHoursEditor.tsx
//
// Editor de tramos horarios reutilizable. Lo usan:
//   - La ficha del LOCAL (brandId = null) -> horario general del local.
//   - La pestaña de MARCA (brandId = uuid) -> horario propio de la marca.
//
// Carga los tramos de (locationId, brandId), permite editar/añadir/quitar
// tramos por dia, copiar un dia a otros, cerrar un dia, y guardar (reemplaza
// todos los tramos de ese par). Un tramo cuyo cierre <= apertura cruza
// medianoche (cierra de madrugada) y se avisa.

import { useEffect, useState } from 'react'
import { Plus, Trash2, Clock, Moon, Copy, X } from 'lucide-react'
import { getHours, replaceHours, copyHoursTo, type HoursSlot } from '../../services/businessHoursService'
import HoursExceptions from './HoursExceptions'

const DAYS = [
  { idx: 1, label: 'Lunes' },
  { idx: 2, label: 'Martes' },
  { idx: 3, label: 'Miércoles' },
  { idx: 4, label: 'Jueves' },
  { idx: 5, label: 'Viernes' },
  { idx: 6, label: 'Sábado' },
  { idx: 0, label: 'Domingo' },
]

function crossesMidnight(open: string, close: string): boolean {
  return close <= open
}

// Convierte 'HH:MM' a minutos desde medianoche.
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Vista gráfica: 7 días × 24h, una barra por tramo. Los que cruzan medianoche
// se pintan hasta el borde derecho.
function HoursGraph({ slots }: { slots: HoursSlot[] }) {
  const DAYS_G = [
    { idx: 1, label: 'L' }, { idx: 2, label: 'M' }, { idx: 3, label: 'X' },
    { idx: 4, label: 'J' }, { idx: 5, label: 'V' }, { idx: 6, label: 'S' }, { idx: 0, label: 'D' },
  ]
  const DAY_MIN = 24 * 60
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  return (
    <div className="rounded-md border border-border-default p-3 overflow-x-auto">
      <div style={{ minWidth: 520 }}>
        {/* Escala de horas */}
        <div className="flex items-center mb-1" style={{ paddingLeft: 28 }}>
          <div className="relative flex-1 h-4 text-[10px] text-text-tertiary">
            {hours.map((h) => (
              <span key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)' }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        {DAYS_G.map((d) => {
          const daySlots = slots.filter((s) => s.weekday === d.idx)
          return (
            <div key={d.idx} className="flex items-center gap-2 mb-1.5">
              <span className="w-5 text-xs font-medium text-text-secondary shrink-0">{d.label}</span>
              <div className="relative flex-1 h-6 rounded bg-page border border-border-default overflow-hidden">
                {/* líneas de hora */}
                {hours.slice(1, -1).map((h) => (
                  <div key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--color-border-default, #eee)' }} />
                ))}
                {daySlots.map((s, i) => {
                  const start = toMin(s.openTime)
                  const end = crossesMidnight(s.openTime, s.closeTime) ? DAY_MIN : toMin(s.closeTime)
                  const left = (start / DAY_MIN) * 100
                  const width = Math.max(1, ((end - start) / DAY_MIN) * 100)
                  return (
                    <div
                      key={i}
                      title={`${s.openTime}–${s.closeTime}`}
                      style={{
                        position: 'absolute', left: `${left}%`, width: `${width}%`, top: 3, bottom: 3,
                        background: 'var(--color-accent, #FF5436)', opacity: 0.85, borderRadius: 4,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


/** Un posible destino al que copiar este horario (otra marca, otro local…). */
export interface CopyTarget {
  key: string         // identificador único para la UI
  label: string       // texto mostrado
  locationId: string
  brandId: string | null
}

interface Props {
  accountId: string
  locationId: string
  brandId: string | null
  /** Si se pasan, muestra "Copiar este horario a…" con estos destinos. */
  copyTargets?: CopyTarget[]
  /** Texto del bloque de copia (ej. "otras marcas de este local"). */
  copyLabel?: string
}

export default function BusinessHoursEditor({ accountId, locationId, brandId, copyTargets, copyLabel }: Props) {
  const [slots, setSlots] = useState<HoursSlot[]>([])
  const [view, setView] = useState<'list' | 'graph'>('list')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [copyFromDay, setCopyFromDay] = useState<number | null>(null)
  const [copyTargetsState, setCopyTargetsState] = useState<Set<number>>(new Set())
  const [showCopyTo, setShowCopyTo] = useState(false)
  const [copyToSel, setCopyToSel] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (!locationId) return
    let alive = true
    setLoading(true)
    setFeedback(null)
    getHours(locationId, brandId)
      .then((s) => { if (alive) setSlots(s) })
      .catch((e) => { if (alive) setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error' }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [locationId, brandId])

  function addSlot(weekday: number) {
    setSlots((prev) => [...prev, { weekday, openTime: '12:00', closeTime: '23:00' }])
  }
  function removeSlot(target: HoursSlot) {
    setSlots((prev) => prev.filter((s) => s !== target))
  }
  function updateSlot(target: HoursSlot, field: 'openTime' | 'closeTime', value: string) {
    setSlots((prev) => prev.map((s) => (s === target ? { ...s, [field]: value } : s)))
  }
  function clearDay(weekday: number) {
    setSlots((prev) => prev.filter((s) => s.weekday !== weekday))
  }
  function openCopyPanel(weekday: number) {
    setCopyFromDay(weekday)
    setCopyTargetsState(new Set())
  }
  function toggleCopyTarget(weekday: number) {
    setCopyTargetsState((prev) => {
      const next = new Set(prev)
      next.has(weekday) ? next.delete(weekday) : next.add(weekday)
      return next
    })
  }
  function applyCopy() {
    if (copyFromDay === null) return
    const source = slots.filter((s) => s.weekday === copyFromDay)
    setSlots((prev) => {
      const kept = prev.filter((s) => !copyTargetsState.has(s.weekday))
      const pasted: HoursSlot[] = []
      copyTargetsState.forEach((wd) => {
        source.forEach((s) => pasted.push({ weekday: wd, openTime: s.openTime, closeTime: s.closeTime }))
      })
      return [...kept, ...pasted]
    })
    setCopyFromDay(null)
    setCopyTargetsState(new Set())
  }

  async function handleSave() {
    if (!accountId || !locationId) return
    setSaving(true)
    setFeedback(null)
    try {
      await replaceHours(accountId, locationId, brandId, slots)
      setFeedback({ kind: 'ok', msg: 'Horario guardado.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo guardar.' })
    } finally {
      setSaving(false)
    }
  }

  function toggleCopyTo(key: string) {
    setCopyToSel((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function applyCopyTo() {
    if (!copyTargets || copyToSel.size === 0) return
    setCopying(true)
    setFeedback(null)
    try {
      // Guarda primero el horario actual (por si hay cambios sin guardar)
      await replaceHours(accountId, locationId, brandId, slots)
      const targets = copyTargets
        .filter((t) => copyToSel.has(t.key))
        .map((t) => ({ locationId: t.locationId, brandId: t.brandId }))
      await copyHoursTo(accountId, locationId, brandId, targets)
      setFeedback({ kind: 'ok', msg: `Horario copiado a ${targets.length} destino${targets.length === 1 ? '' : 's'}.` })
      setShowCopyTo(false)
      setCopyToSel(new Set())
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo copiar.' })
    } finally {
      setCopying(false)
    }
  }

  const slotsByDay = (weekday: number) => slots.filter((s) => s.weekday === weekday)

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-lg p-2.5 text-sm" style={feedback.kind === 'ok'
          ? { background: '#E3F0E6', border: '1px solid #A8D0B5', color: '#1F6B3B' }
          : { background: '#FDECEC', border: '1px solid #E5A0A0', color: '#A12626' }}>
          {feedback.msg}
        </div>
      )}

      {/* Conmutador Lista / Gráfico */}
      <div className="inline-flex rounded-lg border border-border-default overflow-hidden text-sm">
        <button
          type="button"
          onClick={() => setView('list')}
          className={'px-3 py-1.5 font-medium ' + (view === 'list' ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:text-text-primary')}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setView('graph')}
          className={'px-3 py-1.5 font-medium ' + (view === 'graph' ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:text-text-primary')}
        >
          Gráfico
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-secondary">Cargando horario…</p>
      ) : view === 'graph' ? (
        <HoursGraph slots={slots} />
      ) : (
        <div className="rounded-md border border-border-default overflow-hidden">
          {DAYS.map((day) => {
            const daySlots = slotsByDay(day.idx)
            return (
              <div key={day.idx} className="flex items-start gap-3 px-3 py-3 border-b border-border-default last:border-0">
                <div className="w-24 shrink-0 pt-1.5 text-sm font-medium text-text-primary">{day.label}</div>
                <div className="flex-1 space-y-2">
                  {daySlots.length === 0 && (
                    <span className="text-sm text-text-secondary">Cerrado</span>
                  )}
                  {daySlots.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 flex-wrap">
                      <Clock size={14} className="text-text-secondary" />
                      <input
                        type="time"
                        value={s.openTime}
                        onChange={(e) => updateSlot(s, 'openTime', e.target.value)}
                        className="px-2 py-1 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-text-secondary">–</span>
                      <input
                        type="time"
                        value={s.closeTime}
                        onChange={(e) => updateSlot(s, 'closeTime', e.target.value)}
                        className="px-2 py-1 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      {crossesMidnight(s.openTime, s.closeTime) && (
                        <span className="inline-flex items-center gap-1 text-xs text-text-secondary" title="Cierra al día siguiente">
                          <Moon size={12} /> día siguiente
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeSlot(s)}
                        className="p-1 rounded-md hover:bg-accent-bg text-text-secondary"
                        aria-label="Quitar tramo"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => addSlot(day.idx)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80"
                    >
                      <Plus size={13} /> Añadir tramo
                    </button>
                    {daySlots.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => openCopyPanel(day.idx)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                        >
                          <Copy size={13} /> Copiar a…
                        </button>
                        <button
                          type="button"
                          onClick={() => clearDay(day.idx)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                        >
                          <X size={13} /> Cerrar día
                        </button>
                      </>
                    )}
                  </div>

                  {copyFromDay === day.idx && (
                    <div className="mt-2 p-3 rounded-md border border-border-default bg-page space-y-2">
                      <p className="text-xs text-text-secondary">Copiar los tramos de {day.label} a:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS.filter((d) => d.idx !== day.idx).map((d) => {
                          const on = copyTargetsState.has(d.idx)
                          return (
                            <button
                              key={d.idx}
                              type="button"
                              onClick={() => toggleCopyTarget(d.idx)}
                              className={
                                'px-2.5 py-1 rounded-full text-xs font-medium border transition-base ' +
                                (on
                                  ? 'bg-accent text-text-on-accent border-accent'
                                  : 'bg-card text-text-secondary border-border-default hover:text-text-primary')
                              }
                            >
                              {d.label.slice(0, 3)}
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={applyCopy}
                          disabled={copyTargetsState.size === 0}
                          className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40"
                        >
                          Pegar en {copyTargetsState.size} día{copyTargetsState.size === 1 ? '' : 's'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCopyFromDay(null); setCopyTargetsState(new Set()) }}
                          className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {copyTargets && copyTargets.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowCopyTo((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-card border border-border-default text-text-primary hover:bg-accent-bg transition-base"
          >
            <Copy size={15} /> Copiar este horario a…
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar horario'}
        </button>
      </div>

      {showCopyTo && copyTargets && (
        <div className="p-3 rounded-md border border-border-default bg-page space-y-2">
          <p className="text-xs text-text-secondary">
            Copiar el horario actual a {copyLabel ?? 'estos destinos'} (reemplaza el suyo):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {copyTargets.map((t) => {
              const on = copyToSel.has(t.key)
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleCopyTo(t.key)}
                  className={
                    'px-2.5 py-1 rounded-full text-xs font-medium border transition-base ' +
                    (on
                      ? 'bg-accent text-text-on-accent border-accent'
                      : 'bg-card text-text-secondary border-border-default hover:text-text-primary')
                  }
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={applyCopyTo}
              disabled={copyToSel.size === 0 || copying}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              {copying ? 'Copiando…' : `Copiar a ${copyToSel.size} destino${copyToSel.size === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={() => { setShowCopyTo(false); setCopyToSel(new Set()) }}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Días especiales / festivos */}
      <div className="pt-4 mt-2 border-t border-border-default">
        <HoursExceptions accountId={accountId} locationId={locationId} brandId={brandId} />
      </div>
    </div>
  )
}
