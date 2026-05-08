// src/pages/trabajador/MiHorario.tsx
// Sub-fase 3.2 — vista del horario PUBLICADO para el empleado.
// Lee el Schedule de la semana actual y muestra solo los turnos del empleado.
// Cálculo correcto de horas con cruce de medianoche.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { listShiftTemplates, getSchedule } from '../../services/schedulerService'
import {
  type ShiftTemplate,
  type Schedule,
  type DayOfWeek,
  shiftDurationHours,
  getMondayOfWeek,
  toISODate,
  DAY_LABELS,
} from '../../types/scheduler'

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function formatWeekLabel(weekStartISO: string): string {
  const [y, m, d] = weekStartISO.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${start.toLocaleDateString('es-ES', opts)} – ${end.toLocaleDateString('es-ES', opts)}`
}

interface MiHorarioProps {
  employeeId: string
  onBack?: () => void
}

interface DayShift {
  templateId: string
  label: string
  start: string
  end: string
  hours: number
  crossesMidnight: boolean
}

export default function MiHorario({ employeeId, onBack }: MiHorarioProps) {
  const { staff } = useApp()
  const employee = staff.find(e => e.id === employeeId)
  const [weekStart, setWeekStart] = useState<string>(() => toISODate(getMondayOfWeek(new Date())))
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(false)

  // Cargar templates + schedule de la semana
  useEffect(() => {
    let cancel = false
    async function load() {
      if (!employee?.locationId) return
      setLoading(true)
      const [tpls, sched] = await Promise.all([
        listShiftTemplates(employee.locationId),
        getSchedule(employee.locationId, weekStart),
      ])
      if (cancel) return
      setTemplates(tpls)
      setSchedule(sched)
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [employee?.locationId, weekStart])

  // Construir mis turnos por día
  const turnosPorDia = useMemo<Record<string, DayShift[]>>(() => {
    const out: Record<string, DayShift[]> = {}
    if (!schedule || templates.length === 0) return out
    const tplById = new Map(templates.map(t => [t.id, t]))
    for (const tid of Object.keys(schedule.cells)) {
      const t = tplById.get(tid)
      if (!t) continue
      for (const dayKey of Object.keys(schedule.cells[tid])) {
        const ids = schedule.cells[tid][dayKey]
        if (!ids.includes(employeeId)) continue
        const start = t.start_time.slice(0, 5)
        const end = t.end_time.slice(0, 5)
        const [sh, sm] = start.split(':').map(Number)
        const [eh, em] = end.split(':').map(Number)
        const crossesMidnight = (eh * 60 + em) <= (sh * 60 + sm)
        const hours = shiftDurationHours(start, end)
        if (!out[dayKey]) out[dayKey] = []
        out[dayKey].push({
          templateId: tid,
          label: t.label,
          start, end, hours, crossesMidnight,
        })
      }
    }
    // Ordenar por hora de entrada en cada día
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => a.start.localeCompare(b.start))
    }
    return out
  }, [schedule, templates, employeeId])

  const totalHoras = useMemo(() => {
    let sum = 0
    for (const k of Object.keys(turnosPorDia)) {
      for (const t of turnosPorDia[k]) sum += t.hours
    }
    return Math.round(sum * 100) / 100
  }, [turnosPorDia])

  const isPublished = schedule?.status === 'published'
  const todayKey = (() => {
    const today = toISODate(new Date())
    for (const d of DAYS) {
      if (addDays(weekStart, d) === today) return String(d)
    }
    return null
  })()

  if (!employee) {
    return (
      <div className="p-4 text-center text-gray-500">
        Empleado no encontrado.
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] pb-20">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="text-[#7C1A1A] text-2xl">←</button>
        )}
        <div className="flex-1">
          <h1 className="text-xl font-bold" style={{ color: '#7C1A1A' }}>Mi horario</h1>
          <p className="text-xs text-gray-500">{employee.name}</p>
        </div>
      </div>

      {/* Selector semana */}
      <div className="px-4 mb-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="px-3 py-1.5 rounded bg-white border text-sm"
        >←</button>
        <div className="text-center text-sm flex-1">
          <div className="font-medium">{formatWeekLabel(weekStart)}</div>
          <button
            onClick={() => setWeekStart(toISODate(getMondayOfWeek(new Date())))}
            className="text-[10px] text-gray-400 hover:underline"
          >
            Hoy
          </button>
        </div>
        <button
          onClick={() => setWeekStart(addDays(weekStart, +7))}
          className="px-3 py-1.5 rounded bg-white border text-sm"
        >→</button>
      </div>

      {/* Estado del schedule */}
      {!loading && !schedule && (
        <div className="mx-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          Aún no se ha generado el horario de esta semana.
        </div>
      )}
      {!loading && schedule && !isPublished && (
        <div className="mx-4 p-3 rounded-lg bg-gray-50 border text-sm text-gray-600">
          📝 El horario de esta semana está en borrador. Tu encargado lo está preparando.
        </div>
      )}

      {/* Total horas */}
      {!loading && schedule && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-white border flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Total horas semana</div>
            <div className="text-2xl font-bold" style={{ color: '#7C1A1A' }}>
              {totalHoras}h
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Contratadas</div>
            <div className="text-lg font-semibold text-gray-700">
              {employee.weeklyHours || 40}h
            </div>
          </div>
        </div>
      )}

      {/* Días */}
      <div className="px-4 space-y-2">
        {DAYS.map(d => {
          const turnos = turnosPorDia[String(d)] || []
          const dateISO = addDays(weekStart, d)
          const isToday = String(d) === todayKey
          const totalDia = turnos.reduce((acc, t) => acc + t.hours, 0)
          const libre = turnos.length === 0
          return (
            <div
              key={d}
              className={`bg-white rounded-lg border p-3 ${isToday ? 'ring-2 ring-[#7C1A1A]' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className={`text-sm font-bold ${isToday ? 'text-[#7C1A1A]' : ''}`}>
                    {DAY_LABELS[d]}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">{shortDate(dateISO)}</span>
                  {isToday && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-[#F5E9D9] text-[#7C1A1A] font-bold">
                      HOY
                    </span>
                  )}
                </div>
                {!libre && (
                  <span className="text-xs font-mono text-gray-500">
                    {totalDia.toFixed(2)}h
                  </span>
                )}
              </div>

              {libre ? (
                <div className="text-sm text-gray-400 italic">Libre</div>
              ) : (
                <div className="space-y-1.5">
                  {turnos.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-[#F5E9D9] rounded px-2.5 py-1.5"
                    >
                      <div>
                        <span className="font-mono text-sm font-bold" style={{ color: '#7C1A1A' }}>
                          {t.start} – {t.end}
                        </span>
                        {t.crossesMidnight && (
                          <span className="ml-2 text-[10px] text-gray-500">(cruza 00:00)</span>
                        )}
                        <div className="text-[11px] text-gray-600">{t.label}</div>
                      </div>
                      <span className="text-xs font-mono text-gray-700">{t.hours}h</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
