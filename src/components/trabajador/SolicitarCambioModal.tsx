// src/components/trabajador/SolicitarCambioModal.tsx
// Modal para que un trabajador solicite un cambio de turno.
// 3 modos: cesión (cualquiera), intercambio (con turno concreto), petición directa (a alguien).

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, X, Info } from 'lucide-react'
import type { Employee } from '../../types'
import type { ShiftTemplate, Schedule, DayOfWeek } from '../../types/scheduler'
import {
  shiftDurationHours,
  toISODate,
  DAY_LABELS,
} from '../../types/scheduler'
import type { SwapType } from '../../types/shiftSwap'
import { SWAP_TYPE_LABELS, SWAP_TYPE_DESCRIPTIONS } from '../../types/shiftSwap'
import { fetchEmployees } from '../../services/supabaseSync'
import {
  createCesionRequest,
  createIntercambioRequest,
  createPeticionDirectaRequest,
} from '../../services/shiftSwapService'

interface MyShift {
  scheduleId: string
  templateId: string
  template: ShiftTemplate
  dayKey: string         // '0'..'6'
  date: string           // YYYY-MM-DD
}

interface Props {
  myShift: MyShift
  myEmployee: Employee
  schedule: Schedule
  templates: ShiftTemplate[]
  onClose: () => void
  onSubmitted: () => void
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

interface Compañero {
  id: string
  name: string
  photo?: string
}

interface CompañeroShift extends MyShift {
  employeeId: string
  hours: number
}

export default function SolicitarCambioModal({
  myShift,
  myEmployee,
  schedule,
  templates,
  onClose,
  onSubmitted,
}: Props) {
  const [tipo, setTipo] = useState<SwapType>('cesion')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [compañeros, setCompañeros] = useState<Compañero[]>([])
  const [selectedCompId, setSelectedCompId] = useState<string>('')
  const [selectedShiftKey, setSelectedShiftKey] = useState<string>('')

  // Cargar empleados (para petición directa e intercambio)
  useEffect(() => {
    let cancel = false
    async function load() {
      const all = await fetchEmployees(null)
      if (cancel || !all) return
      const list = all
        .filter(e => e.id !== myEmployee.id && e.active)
        .map(e => ({ id: e.id, name: e.name, photo: e.photo || undefined }))
      list.sort((a, b) => a.name.localeCompare(b.name))
      setCompañeros(list)
    }
    load()
    return () => { cancel = true }
  }, [myEmployee.id])

  // Para intercambio: turnos de la semana del compañero seleccionado
  const compañeroShifts: CompañeroShift[] = useMemo(() => {
    if (!selectedCompId || tipo !== 'intercambio') return []
    const out: CompañeroShift[] = []
    const tplById = new Map(templates.map(t => [t.id, t]))
    for (const tid of Object.keys(schedule.cells)) {
      const t = tplById.get(tid)
      if (!t) continue
      for (const dayKey of Object.keys(schedule.cells[tid])) {
        const ids = schedule.cells[tid][dayKey]
        if (!ids.includes(selectedCompId)) continue
        // Saltarse el mismo turno del solicitante (sería absurdo)
        if (tid === myShift.templateId && dayKey === myShift.dayKey) continue
        const start = t.start_time.slice(0, 5)
        const end = t.end_time.slice(0, 5)
        const hours = shiftDurationHours(start, end)
        const dayKeyNum = parseInt(dayKey, 10)
        const date = addDays(schedule.week_start, dayKeyNum === 0 ? 6 : dayKeyNum - 1)
        // ↑ ojo: en el sistema actual los días en cells parecen ser 1=L..6=S, 0=D
        // pero por seguridad usamos la fecha derivada del weekStart sumando dayKeyNum-1 si es 1-6, o 6 si es 0
        out.push({
          employeeId: selectedCompId,
          scheduleId: schedule.id,
          templateId: tid,
          template: t,
          dayKey,
          date,
          hours,
        })
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date))
    return out
  }, [selectedCompId, tipo, schedule, templates, myShift])

  async function handleSubmit() {
    setSubmitting(true)
    try {
      let ok: boolean | unknown = false
      if (tipo === 'cesion') {
        const result = await createCesionRequest(
          myEmployee.id,
          myShift.scheduleId,
          myShift.templateId,
          myShift.dayKey,
          myShift.date,
          notes.trim() || undefined
        )
        ok = !!result
      } else if (tipo === 'peticion_directa') {
        if (!selectedCompId) { alert('Elige un compañero'); setSubmitting(false); return }
        const result = await createPeticionDirectaRequest(
          myEmployee.id,
          myShift.scheduleId,
          myShift.templateId,
          myShift.dayKey,
          myShift.date,
          selectedCompId,
          notes.trim() || undefined
        )
        ok = !!result
      } else if (tipo === 'intercambio') {
        if (!selectedCompId || !selectedShiftKey) {
          alert('Elige un compañero y el turno suyo que quieres'); setSubmitting(false); return
        }
        const target = compañeroShifts.find(s => `${s.templateId}|${s.dayKey}` === selectedShiftKey)
        if (!target) { alert('Turno no encontrado'); setSubmitting(false); return }
        const result = await createIntercambioRequest(
          myEmployee.id,
          {
            scheduleId: myShift.scheduleId,
            templateId: myShift.templateId,
            dayKey: myShift.dayKey,
            date: myShift.date,
          },
          selectedCompId,
          {
            scheduleId: target.scheduleId,
            templateId: target.templateId,
            dayKey: target.dayKey,
            date: target.date,
          },
          notes.trim() || undefined
        )
        ok = !!result
      }
      if (ok) {
        onSubmitted()
      } else {
        alert('Error al crear la solicitud. Inténtalo de nuevo.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const dayLabel = DAY_LABELS[parseInt(myShift.dayKey, 10) as DayOfWeek] || myShift.dayKey
  const tStart = myShift.template.start_time.slice(0, 5)
  const tEnd = myShift.template.end_time.slice(0, 5)

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-xl sm:rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-default sticky top-0 bg-accent text-text-on-accent">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold inline-flex items-center gap-1.5">
                <RefreshCw size={16} /> Solicitar cambio
              </div>
              <div className="text-xs opacity-90">
                {dayLabel} · {tStart}–{tEnd} · {myShift.template.label}
              </div>
            </div>
            <button onClick={onClose} className="text-text-on-accent/80 hover:text-text-on-accent">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Selector de tipo */}
          <div>
            <p className="text-xs font-semibold text-text-primary mb-2">¿Qué tipo de cambio quieres?</p>
            <div className="space-y-2">
              {(['cesion', 'peticion_directa', 'intercambio'] as SwapType[]).map(t => (
                <button
                  key={t}
                  onClick={() => { setTipo(t); setSelectedCompId(''); setSelectedShiftKey('') }}
                  className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-base ${
                    tipo === t ? 'border-accent bg-accent-bg' : 'border-border-default bg-card hover:border-accent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{SWAP_TYPE_LABELS[t]}</div>
                      <div className="text-[11px] text-text-secondary">{SWAP_TYPE_DESCRIPTIONS[t]}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Selector de compañero (intercambio o petición directa) */}
          {tipo !== 'cesion' && (
            <div>
              <p className="text-xs font-semibold text-text-primary mb-2">
                {tipo === 'peticion_directa'
                  ? '¿A qué compañero le pides el cambio?'
                  : '¿Con qué compañero quieres intercambiar?'}
              </p>
              <select
                value={selectedCompId}
                onChange={e => { setSelectedCompId(e.target.value); setSelectedShiftKey('') }}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card"
              >
                <option value="">— Elige un compañero —</option>
                {compañeros.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Selector de turno del compañero (solo intercambio) */}
          {tipo === 'intercambio' && selectedCompId && (
            <div>
              <p className="text-xs font-semibold text-text-primary mb-2">¿Qué turno suyo te interesa?</p>
              {compañeroShifts.length === 0 ? (
                <p className="text-xs text-text-secondary italic">
                  Este compañero no tiene turnos esta semana.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {compañeroShifts.map(s => {
                    const key = `${s.templateId}|${s.dayKey}`
                    const dayN = parseInt(s.dayKey, 10) as DayOfWeek
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedShiftKey(key)}
                        className={`w-full text-left px-3 py-2 rounded border-2 transition-base ${
                          selectedShiftKey === key ? 'border-accent bg-accent-bg' : 'border-border-default bg-card hover:border-accent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-text-primary">
                              {DAY_LABELS[dayN] || s.dayKey} <span className="text-xs text-text-secondary">{shortDate(s.date)}</span>
                            </div>
                            <div className="text-[11px] text-text-secondary">
                              {s.template.start_time.slice(0, 5)}–{s.template.end_time.slice(0, 5)} · {s.template.label}
                            </div>
                          </div>
                          <span className="text-xs font-mono text-text-secondary">{s.hours}h</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Notas */}
          <div>
            <p className="text-xs font-semibold text-text-primary mb-1">Mensaje (opcional)</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder={tipo === 'cesion'
                ? 'Ej: Tengo un imprevisto familiar, gracias quien lo coja!'
                : tipo === 'peticion_directa'
                  ? 'Ej: ¿Podrías cogerlo? Me harías un gran favor.'
                  : 'Ej: Te propongo intercambiar este turno por el tuyo del...'}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-sm resize-none"
            />
            <p className="text-[10px] text-text-secondary mt-0.5 text-right">{notes.length}/300</p>
          </div>

          {/* Aviso final */}
          <div className="bg-accent-bg border border-accent/30 rounded-lg p-3 text-[11px] text-accent inline-flex items-start gap-1.5">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>Al confirmar, la solicitud quedará pendiente de aprobación del gestor.
            Hasta entonces, sigues asignado al turno como hasta ahora.</span>
          </div>
        </div>

        {/* Botones */}
        <div className="px-4 py-3 border-t border-border-default bg-page sticky bottom-0 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border-default rounded bg-card text-text-primary hover:bg-page transition-base"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded text-text-on-accent text-sm font-medium disabled:opacity-40 bg-accent hover:bg-accent-hover transition-base"
          >
            {submitting ? 'Enviando...' : 'Enviar solicitud'}
          </button>
        </div>
      </div>
    </div>
  )
}
