// src/pages/trabajador/MiHorario.tsx
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee } from '../../types'
import {
  fetchPublishedAssignmentsForEmployee, mondayOf,
  type ShiftType, type ShiftAssignment,
} from '../../services/calendarService'
import { isSupabaseEnabled, supabase } from '../../lib/supabase'

interface Props {
  employee: Employee
  onBack: () => void
}

const DAYS = [
  { key: 'lunes',     label: 'Lunes',     index: 1 },
  { key: 'martes',    label: 'Martes',    index: 2 },
  { key: 'miercoles', label: 'Miércoles', index: 3 },
  { key: 'jueves',    label: 'Jueves',    index: 4 },
  { key: 'viernes',   label: 'Viernes',   index: 5 },
  { key: 'sabado',    label: 'Sábado',    index: 6 },
  { key: 'domingo',   label: 'Domingo',   index: 0 },
] as const

export default function MiHorario({ employee, onBack }: Props) {
  const { staff } = useApp()
  const current = staff.find(e => e.id === employee.id) || employee
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()))
  const [published, setPublished] = useState<{ assignment: ShiftAssignment; shiftType: ShiftType | null }[]>([])
  const [loading, setLoading] = useState(true)

  // Cargar horario publicado de la semana
  async function loadPublished() {
    setLoading(true)
    const start = weekStart
    const endD = new Date(start + 'T00:00:00')
    endD.setDate(endD.getDate() + 6)
    const ey = endD.getFullYear()
    const em = String(endD.getMonth() + 1).padStart(2, '0')
    const ed = String(endD.getDate()).padStart(2, '0')
    const end = `${ey}-${em}-${ed}`
    const data = await fetchPublishedAssignmentsForEmployee(current.id, start, end)
    setPublished(data)
    setLoading(false)
  }

  useEffect(() => { loadPublished() /* eslint-disable-line */ }, [current.id, weekStart])

  // Realtime
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) return
    const sb = supabase
    const ch = sb.channel('mi-horario-' + current.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_assignments' }, () => loadPublished())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_plans' }, () => loadPublished())
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, weekStart])

  // Index para acceso por fecha
  const byDate = useMemo(() => {
    const m = new Map<string, { assignment: ShiftAssignment; shiftType: ShiftType | null }>()
    for (const p of published) m.set(p.assignment.date, p)
    return m
  }, [published])

  // Calcular horas: priorizamos publicado, fallback a weeklySchedule
  function dayInfo(dayIndex: number, dateIso: string): {
    label: string; subLabel?: string; hours: number; color: string; isFromCalendar: boolean
  } {
    const pub = byDate.get(dateIso)
    if (pub) {
      const t = pub.shiftType
      if (t) {
        if (t.isOff) {
          return { label: 'Libre', hours: 0, color: '#9CA3AF', isFromCalendar: true }
        }
        const sub = t.startTime && t.endTime
          ? `${t.startTime}–${t.endTime}${t.isSplit ? ` + ${t.split2Start}–${t.split2End}` : ''}`
          : ''
        return { label: `${t.code} ${t.label}`, subLabel: sub, hours: t.hours, color: t.color, isFromCalendar: true }
      }
    }
    // Fallback a weeklySchedule
    const ws = current.weeklySchedule
    if (!ws) return { label: 'Libre', hours: 0, color: '#9CA3AF', isFromCalendar: false }
    const dayKey = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][dayIndex]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day = (ws as any)[dayKey]
    if (!day || !day.active || !day.start || !day.end) {
      return { label: 'Libre', hours: 0, color: '#9CA3AF', isFromCalendar: false }
    }
    const [sh, sm] = day.start.split(':').map(Number)
    const [eh, em] = day.end.split(':').map(Number)
    const hours = Math.max(0, (eh + em / 60) - (sh + sm / 60))
    return {
      label: 'Trabajo',
      subLabel: `${day.start}–${day.end}`,
      hours,
      color: '#7C1A1A',
      isFromCalendar: false,
    }
  }

  // Generar fechas de la semana
  const weekDays = useMemo(() => {
    const start = new Date(weekStart + 'T00:00:00')
    return DAYS.map(d => {
      const date = new Date(start)
      const offsetFromMonday = DAYS.findIndex(x => x.key === d.key)
      date.setDate(start.getDate() + offsetFromMonday)
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const dd = String(date.getDate()).padStart(2, '0')
      return {
        ...d,
        dateIso: `${y}-${m}-${dd}`,
        date,
      }
    })
  }, [weekStart])

  const totalHours = weekDays.reduce((acc, d) => acc + dayInfo(d.index, d.dateIso).hours, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function shiftWeek(weeks: number) {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + weeks * 7)
    setWeekStart(mondayOf(d))
  }

  const hasPublishedThisWeek = published.length > 0
  const isCurrentWeek = weekStart === mondayOf(new Date())

  const weekLabel = useMemo(() => {
    const start = new Date(weekStart + 'T00:00:00')
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return `${start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}`
  }, [weekStart])

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Mi horario</p>
            <p className="font-bold text-gray-900">{current.name.split(' ')[0]}</p>
          </div>
        </div>

        {/* Navegación semana */}
        <Card className="p-3 mb-4 flex items-center justify-between">
          <button onClick={() => shiftWeek(-1)}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">←</button>
          <div className="text-center flex-1">
            <p className="text-sm font-bold text-gray-900">{weekLabel}</p>
            {isCurrentWeek && <p className="text-[10px] text-[#7C1A1A] font-medium">Esta semana</p>}
          </div>
          <button onClick={() => shiftWeek(1)}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">→</button>
        </Card>

        {/* Resumen */}
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Horas semanales</p>
              <p className="text-2xl font-bold text-[#7C1A1A]">{totalHours.toFixed(1)}h</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Contrato</p>
              <p className="text-2xl font-bold text-gray-700">{current.weeklyHours || 40}h</p>
            </div>
          </div>
        </Card>

        {/* Aviso si no hay calendario publicado */}
        {!hasPublishedThisWeek && !loading && (
          <Card className="p-3 mb-4 bg-amber-50 border-amber-200">
            <p className="text-xs text-amber-800">
              📋 Aún no hay calendario publicado para esta semana. Te mostramos tu horario base. Cuando tu encargado publique el calendario, lo verás aquí.
            </p>
          </Card>
        )}

        {/* Días de la semana */}
        {loading ? (
          <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
        ) : (
          <div className="space-y-2">
            {weekDays.map(d => {
              const info = dayInfo(d.index, d.dateIso)
              const isToday = d.date.getTime() === today.getTime()
              const isOff = info.label === 'Libre'
              return (
                <Card key={d.key} className={`p-3 ${isToday ? 'border-2 border-[#7C1A1A] bg-[#F5E9D9]/50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-10 rounded-full" style={{ backgroundColor: info.color }} />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">
                          {d.label} {d.date.getDate()}
                          {isToday && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-[#7C1A1A] text-white font-medium">HOY</span>}
                        </p>
                        {isOff ? (
                          <p className="text-xs text-gray-400 mt-0.5">Libre</p>
                        ) : (
                          <>
                            <p className="text-xs font-medium" style={{ color: info.color }}>{info.label}</p>
                            {info.subLabel && <p className="text-[10px] text-gray-400">{info.subLabel}</p>}
                          </>
                        )}
                      </div>
                    </div>
                    {!isOff && info.hours > 0 && (
                      <span className="text-sm font-medium text-gray-700">{info.hours.toFixed(1)}h</span>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {totalHours === 0 && !loading && (
          <Card className="p-4 mt-4 bg-amber-50 border-amber-200">
            <p className="text-xs text-amber-800 text-center">
              Aún no tienes horario asignado. Habla con tu encargado.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
