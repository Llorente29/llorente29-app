// src/pages/trabajador/MiHorario.tsx
// Sub-fase 3.2 — vista del horario PUBLICADO para el empleado.
// Lee el Schedule de la semana actual y muestra solo los turnos del empleado.
// Cálculo correcto de horas con cruce de medianoche.

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Globe2, Clock, FileText,
} from 'lucide-react'
import type { Employee, Location } from '../../types'
import { listShiftTemplates, getSchedule } from '../../services/schedulerService'
import { fetchLocations } from '../../services/supabaseSync'
import {
  listSwapsForEmployee,
  cancelSwap,
} from '../../services/shiftSwapService'
import type { ShiftSwapRequest } from '../../types/shiftSwap'
import MiBolsaHoras from '../../components/MiBolsaHoras'
import SolicitarCambioModal from '../../components/trabajador/SolicitarCambioModal'
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
  employee: Employee
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

export default function MiHorario({ employee, onBack }: MiHorarioProps) {
  const employeeId = employee.id
  const [weekStart, setWeekStart] = useState<string>(() => toISODate(getMondayOfWeek(new Date())))
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(false)
  const [location, setLocation] = useState<Location | undefined>(undefined)
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([])
  const [swapModalShift, setSwapModalShift] = useState<{
    scheduleId: string
    templateId: string
    template: ShiftTemplate
    dayKey: string
    date: string
  } | null>(null)

  // Cargar el local del empleado (para configuración de bolsa de horas)
  useEffect(() => {
    let cancel = false
    async function loadLoc() {
      if (!employee?.locationId) return
      const all = await fetchLocations(null)
      if (cancel || !all) return
      setLocation(all.find(l => l.id === employee.locationId))
    }
    loadLoc()
    return () => { cancel = true }
  }, [employee?.locationId])

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

  // Cargar mis solicitudes de cambio (activas: abierta o propuesta)
  async function loadSwaps() {
    const all = await listSwapsForEmployee(employeeId)
    setSwaps(all)
  }
  useEffect(() => {
    let cancel = false
    async function load() {
      const all = await listSwapsForEmployee(employeeId)
      if (cancel) return
      setSwaps(all)
    }
    load()
    return () => { cancel = true }
  }, [employeeId])

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

  // Helper: ¿hay solicitud activa para este turno (templateId + dayKey)?
  function findActiveSwap(templateId: string, dayKey: string): ShiftSwapRequest | undefined {
    return swaps.find(s =>
      (s.status === 'abierta' || s.status === 'propuesta') &&
      s.requesterId === employeeId &&
      s.requesterTemplateId === templateId &&
      s.requesterDayKey === dayKey &&
      schedule && s.requesterScheduleId === schedule.id
    )
  }

  async function handleCancelSwap(swapId: string) {
    if (!confirm('¿Cancelar tu solicitud de cambio?')) return
    const ok = await cancelSwap(swapId)
    if (ok) await loadSwaps()
  }

  return (
    <div className="min-h-screen bg-page pb-20">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="text-accent w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
            aria-label="Volver"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="flex-1">
          <h1 className="font-display text-xl text-accent">Mi horario</h1>
          <p className="text-xs text-text-secondary">{employee.name}</p>
        </div>
      </div>

      {/* Selector semana */}
      <div className="px-4 mb-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="px-3 py-1.5 rounded bg-card border border-border-default text-sm text-text-primary hover:bg-accent-bg transition-base inline-flex items-center"
        ><ChevronLeft size={16} /></button>
        <div className="text-center text-sm flex-1">
          <div className="font-medium text-text-primary">{formatWeekLabel(weekStart)}</div>
          <button
            onClick={() => setWeekStart(toISODate(getMondayOfWeek(new Date())))}
            className="text-[10px] text-text-secondary hover:underline"
          >
            Hoy
          </button>
        </div>
        <button
          onClick={() => setWeekStart(addDays(weekStart, +7))}
          className="px-3 py-1.5 rounded bg-card border border-border-default text-sm text-text-primary hover:bg-accent-bg transition-base inline-flex items-center"
        ><ChevronRight size={16} /></button>
      </div>

      {/* Estado del schedule */}
      {!loading && !schedule && (
        <div className="mx-4 p-3 rounded-lg bg-warning-bg border border-warning/30 text-sm text-warning">
          Aún no se ha generado el horario de esta semana.
        </div>
      )}
      {!loading && schedule && !isPublished && (
        <div className="mx-4 p-3 rounded-lg bg-page border border-border-default text-sm text-text-secondary inline-flex items-center gap-1.5">
          <FileText size={14} /> El horario de esta semana está en borrador. Tu encargado lo está preparando.
        </div>
      )}

      {/* Total horas */}
      {!loading && schedule && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-card border border-border-default flex items-center justify-between">
          <div>
            <div className="text-xs text-text-secondary">Total horas semana</div>
            <div className="text-2xl font-bold text-accent">
              {totalHoras}h
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-secondary">Contratadas</div>
            <div className="text-lg font-semibold text-text-primary">
              {employee.weeklyHours || 40}h
            </div>
          </div>
        </div>
      )}

      {/* Bolsa de horas (si el empleado tiene visibilidad activa) */}
      <div className="mx-4 mb-3">
        <MiBolsaHoras employee={employee} location={location} />
      </div>

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
              className={`bg-card rounded-lg border border-border-default p-3 ${isToday ? 'ring-2 ring-accent' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className={`text-sm font-bold ${isToday ? 'text-accent' : 'text-text-primary'}`}>
                    {DAY_LABELS[d]}
                  </span>
                  <span className="ml-2 text-xs text-text-secondary">{shortDate(dateISO)}</span>
                  {isToday && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-accent font-bold">
                      HOY
                    </span>
                  )}
                </div>
                {!libre && (
                  <span className="text-xs font-mono text-text-secondary">
                    {totalDia.toFixed(2)}h
                  </span>
                )}
              </div>

              {libre ? (
                <div className="text-sm text-text-secondary italic">Libre</div>
              ) : (
                <div className="space-y-1.5">
                  {turnos.map((t, i) => {
                    const activeSwap = findActiveSwap(t.templateId, String(d))
                    const dateISO_t = dateISO
                    return (
                      <div
                        key={i}
                        className="bg-accent-bg rounded px-2.5 py-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-mono text-sm font-bold text-accent">
                              {t.start} – {t.end}
                            </span>
                            {t.crossesMidnight && (
                              <span className="ml-2 text-[10px] text-text-secondary">(cruza 00:00)</span>
                            )}
                            <div className="text-[11px] text-text-secondary">{t.label}</div>
                          </div>
                          <span className="text-xs font-mono text-text-primary">{t.hours}h</span>
                        </div>

                        {/* Estado del cambio o botón solicitar */}
                        {isPublished && schedule && (
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            {activeSwap ? (
                              <>
                                <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  activeSwap.status === 'abierta'
                                    ? 'bg-accent-bg text-accent'
                                    : 'bg-warning-bg text-warning'
                                }`}>
                                  {activeSwap.status === 'abierta' ? <><Globe2 size={10} /> Abierta</> : <><Clock size={10} /> Pendiente del gestor</>}
                                </span>
                                <button
                                  onClick={() => handleCancelSwap(activeSwap.id)}
                                  className="text-[10px] px-2 py-0.5 rounded text-text-secondary hover:text-danger hover:bg-danger-bg transition-base"
                                >
                                  Cancelar solicitud
                                </button>
                              </>
                            ) : (
                              <>
                                <span></span>
                                <button
                                  onClick={() => setSwapModalShift({
                                    scheduleId: schedule.id,
                                    templateId: t.templateId,
                                    template: templates.find(x => x.id === t.templateId)!,
                                    dayKey: String(d),
                                    date: dateISO_t,
                                  })}
                                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded text-accent hover:bg-accent/10 font-medium transition-base"
                                >
                                  <RefreshCw size={10} /> Solicitar cambio
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal de solicitar cambio */}
      {swapModalShift && schedule && (
        <SolicitarCambioModal
          myShift={swapModalShift}
          myEmployee={employee}
          schedule={schedule}
          templates={templates}
          onClose={() => setSwapModalShift(null)}
          onSubmitted={async () => {
            setSwapModalShift(null)
            await loadSwaps()
          }}
        />
      )}
    </div>
  )
}
