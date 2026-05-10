// src/components/trabajador/SolicitarCambioModal.tsx
// Modal para que un trabajador solicite un cambio de turno.
// 3 modos: cesión (cualquiera), intercambio (con turno concreto), petición directa (a alguien).

import { useEffect, useMemo, useState } from 'react'
import type { Employee } from '../../types'
import type { ShiftTemplate, Schedule, DayOfWeek } from '../../types/scheduler'
import {
  shiftDurationHours,
  toISODate,
  DAY_LABELS,
} from '../../types/scheduler'
import type { SwapType } from '../../types/shiftSwap'
import { SWAP_TYPE_LABELS, SWAP_TYPE_DESCRIPTIONS, SWAP_TYPE_ICONS } from '../../types/shiftSwap'
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
      const all = await fetchEmployees()
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
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-4 py-3 border-b sticky top-0" style={{ backgroundColor: '#7C1A1A', color: 'white' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">🔄 Solicitar cambio</div>
              <div className="text-xs opacity-90">
                {dayLabel} · {tStart}–{tEnd} · {myShift.template.label}
              </div>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Selector de tipo */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">¿Qué tipo de cambio quieres?</p>
            <div className="space-y-2">
              {(['cesion', 'peticion_directa', 'intercambio'] as SwapType[]).map(t => (
                <button
                  key={t}
                  onClick={() => { setTipo(t); setSelectedCompId(''); setSelectedShiftKey('') }}
                  className={`w-full text-left px-3 py-2 rounded-lg border-2 transition ${
                    tipo === t ? 'border-[#7C1A1A] bg-[#F5E9D9]' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl shrink-0">{SWAP_TYPE_ICONS[t]}</span>
                    <div>
                      <div className="text-sm font-semibold">{SWAP_TYPE_LABELS[t]}</div>
                      <div className="text-[11px] text-gray-500">{SWAP_TYPE_DESCRIPTIONS[t]}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Selector de compañero (intercambio o petición directa) */}
          {tipo !== 'cesion' && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">
                {tipo === 'peticion_directa'
                  ? '¿A qué compañero le pides el cambio?'
                  : '¿Con qué compañero quieres intercambiar?'}
              </p>
              <select
                value={selectedCompId}
                onChange={e => { setSelectedCompId(e.target.value); setSelectedShiftKey('') }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
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
              <p className="text-xs font-semibold text-gray-700 mb-2">¿Qué turno suyo te interesa?</p>
              {compañeroShifts.length === 0 ? (
                <p className="text-xs text-gray-400 italic">
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
                        className={`w-full text-left px-3 py-2 rounded border-2 transition ${
                          selectedShiftKey === key ? 'border-[#7C1A1A] bg-[#F5E9D9]' : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold">
                              {DAY_LABELS[dayN] || s.dayKey} <span className="text-xs text-gray-400">{shortDate(s.date)}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                              {s.template.start_time.slice(0, 5)}–{s.template.end_time.slice(0, 5)} · {s.template.label}
                            </div>
                          </div>
                          <span className="text-xs font-mono text-gray-500">{s.hours}h</span>
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
            <p className="text-xs font-semibold text-gray-700 mb-1">Mensaje (opcional)</p>
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
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            />
            <p className="text-[10px] text-gray-400 mt-0.5 text-right">{notes.length}/300</p>
          </div>

          {/* Aviso final */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800">
            ℹ️ Al confirmar, la solicitud quedará pendiente de aprobación del gestor.
            Hasta entonces, sigues asignado al turno como hasta ahora.
          </div>
        </div>

        {/* Botones */}
        <div className="px-4 py-3 border-t bg-gray-50 sticky bottom-0 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded bg-white hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: '#7C1A1A' }}
          >
            {submitting ? 'Enviando...' : 'Enviar solicitud'}
          </button>
        </div>
      </div>
    </div>
  )
}
