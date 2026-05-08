// src/pages/CalendarioPage.tsx
// Calendario semanal de horarios. Vista principal del gestor.
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Card, Button } from '../components/ui'
import {
  fetchShiftTypes, getOrCreatePlan, fetchAssignmentsForPlan,
  upsertAssignment, publishPlan, unpublishPlan,
  mondayOf, weekDates, shortDayLabel, isWeekend,
  type ShiftType, type WeeklyPlan, type ShiftAssignment,
} from '../services/calendarService'
import { isSupabaseEnabled, supabase } from '../lib/supabase'
import type { Employee } from '../types'

export default function CalendarioPage() {
  const { staff, locations } = useApp()
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()))
  const [locationId, setLocationId] = useState<string>('')
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ employeeId: string; date: string } | null>(null)

  // Inicializar location al primer local activo
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      const active = locations.find(l => l.active) || locations[0]
      if (active) setLocationId(active.id)
    }
  }, [locations, locationId])

  // Cargar tipos
  useEffect(() => {
    fetchShiftTypes().then(setShiftTypes)
  }, [])

  // Cargar plan + asignaciones cuando cambia semana o local
  async function loadPlan() {
    if (!locationId || !weekStart) return
    setLoading(true)
    const p = await getOrCreatePlan(weekStart, locationId)
    setPlan(p)
    if (p) {
      const a = await fetchAssignmentsForPlan(p.id)
      setAssignments(a)
    }
    setLoading(false)
  }

  useEffect(() => { loadPlan() /* eslint-disable-line */ }, [weekStart, locationId])

  // Realtime para asignaciones de este plan
  useEffect(() => {
    if (!isSupabaseEnabled || !supabase || !plan) return
    const sb = supabase
    const ch = sb.channel('cal-' + plan.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_assignments', filter: `plan_id=eq.${plan.id}` },
        async () => {
          const a = await fetchAssignmentsForPlan(plan.id)
          setAssignments(a)
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'weekly_plans', filter: `id=eq.${plan.id}` },
        () => loadPlan())
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id])

  // Empleados del local actual
  const localEmployees = useMemo(() => {
    return staff
      .filter(e => e.active)
      .filter(e => e.locationId === locationId || (e.assignedLocations || []).includes(locationId))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [staff, locationId])

  const days = useMemo(() => weekDates(weekStart), [weekStart])

  // Index para acceso rápido
  const assignByEmpDate = useMemo(() => {
    const map = new Map<string, ShiftAssignment>()
    for (const a of assignments) map.set(`${a.employeeId}|${a.date}`, a)
    return map
  }, [assignments])

  const typesById = useMemo(() => {
    const map = new Map<string, ShiftType>()
    for (const t of shiftTypes) map.set(t.id, t)
    return map
  }, [shiftTypes])

  // Cargar weeklySchedule como plantilla inicial si la celda está vacía
  function getCellSuggestion(employee: Employee, date: string): string | null {
    if (!employee.weeklySchedule) return null
    const d = new Date(date + 'T00:00:00')
    const dayKey = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][d.getDay()]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dayInfo = (employee.weeklySchedule as any)[dayKey]
    if (!dayInfo || !dayInfo.active || !dayInfo.start || !dayInfo.end) return null
    // Buscar tipo de turno que coincida (start o cercano)
    const match = shiftTypes.find(t => !t.isOff && t.startTime === dayInfo.start)
    return match ? match.id : null
  }

  // Cambiar semana
  function shiftWeek(weeks: number) {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + weeks * 7)
    setWeekStart(mondayOf(d))
  }

  function goToCurrentWeek() {
    setWeekStart(mondayOf(new Date()))
  }

  async function handleAssign(employeeId: string, date: string, shiftTypeId: string | null) {
    if (!plan) return
    await upsertAssignment({ planId: plan.id, employeeId, date, shiftTypeId })
    const a = await fetchAssignmentsForPlan(plan.id)
    setAssignments(a)
    setEditing(null)
  }

  async function handlePublish() {
    if (!plan) return
    if (plan.status === 'publicado') {
      if (!confirm('Esto despublicará el plan. Los trabajadores dejarán de verlo. ¿Seguro?')) return
      await unpublishPlan(plan.id)
    } else {
      if (!confirm('¿Publicar este plan? Los trabajadores podrán ver su horario.')) return
      await publishPlan(plan.id)
    }
    await loadPlan()
  }

  // Cálculo total de horas planificadas por empleado en la semana
  function weeklyHoursOf(employeeId: string): number {
    let total = 0
    for (const d of days) {
      const a = assignByEmpDate.get(`${employeeId}|${d}`)
      if (a && a.shiftTypeId) {
        const t = typesById.get(a.shiftTypeId)
        if (t) total += t.hours
      }
    }
    return total
  }

  const weekRangeLabel = useMemo(() => {
    const start = new Date(weekStart + 'T00:00:00')
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return `${start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}`
  }, [weekStart])

  const isCurrentWeek = weekStart === mondayOf(new Date())

  return (
    <div className="space-y-4">
      {/* Header con navegación */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => shiftWeek(-1)}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">←</button>
            <div className="min-w-[200px] text-center">
              <p className="font-bold text-gray-900">{weekRangeLabel}</p>
              {isCurrentWeek && <p className="text-[10px] text-[#7C1A1A] font-medium">Esta semana</p>}
            </div>
            <button onClick={() => shiftWeek(1)}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">→</button>
            {!isCurrentWeek && (
              <button onClick={goToCurrentWeek} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
                Hoy
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select value={locationId} onChange={e => setLocationId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
              {locations.filter(l => l.active).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            {plan && (
              <>
                <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${
                  plan.status === 'publicado'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {plan.status === 'publicado' ? '✓ Publicado' : '✏️ Borrador'}
                </span>
                <Button size="sm" onClick={handlePublish}>
                  {plan.status === 'publicado' ? 'Despublicar' : 'Publicar'}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Tabla calendario */}
      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
      ) : localEmployees.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-5xl mb-3">👥</p>
          <p className="font-semibold text-gray-700">Sin empleados en este local</p>
          <p className="text-xs text-gray-500 mt-1">Asigna empleados al local desde Personal</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 z-10 min-w-[140px]">Empleado</th>
                {days.map(d => (
                  <th key={d} className={`text-center px-2 py-2 font-medium ${
                    isWeekend(d) ? 'bg-amber-50 text-amber-800' : 'text-gray-600'
                  }`}>
                    {shortDayLabel(d)}
                  </th>
                ))}
                <th className="text-right px-3 py-2 text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {localEmployees.map(emp => {
                const totalHours = weeklyHoursOf(emp.id)
                const overWeekly = emp.weeklyHours && totalHours > emp.weeklyHours
                return (
                  <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <p className="font-medium text-gray-900 text-sm truncate">{emp.name || '—'}</p>
                      <p className="text-[10px] text-gray-400">{emp.position || '—'}</p>
                    </td>
                    {days.map(d => {
                      const a = assignByEmpDate.get(`${emp.id}|${d}`)
                      const t = a?.shiftTypeId ? typesById.get(a.shiftTypeId) : null
                      const suggestion = !a ? getCellSuggestion(emp, d) : null
                      const sugType = suggestion ? typesById.get(suggestion) : null
                      return (
                        <td key={d} className={`p-1 ${isWeekend(d) ? 'bg-amber-50/30' : ''}`}>
                          <button
                            onClick={() => setEditing({ employeeId: emp.id, date: d })}
                            className={`w-full px-2 py-1.5 rounded text-xs font-medium transition-all hover:ring-2 hover:ring-gray-300 ${
                              t
                                ? 'text-white'
                                : sugType
                                  ? 'bg-gray-50 text-gray-400 italic border border-dashed border-gray-300'
                                  : 'bg-gray-100 text-gray-400'
                            }`}
                            style={t ? { backgroundColor: t.color } : undefined}
                            title={t ? `${t.label} (${t.startTime}-${t.endTime})` : sugType ? `Sugerido: ${sugType.code}` : 'Sin asignar'}
                          >
                            {t ? t.code : sugType ? `~${sugType.code}` : '—'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-right">
                      <p className={`text-sm font-bold tabular-nums ${
                        overWeekly ? 'text-amber-600' : 'text-gray-700'
                      }`}>
                        {totalHours.toFixed(1)}h
                      </p>
                      <p className="text-[10px] text-gray-400">
                        de {emp.weeklyHours || 40}h
                      </p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Leyenda de tipos */}
      <Card className="p-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Tipos de turno</p>
        <div className="flex flex-wrap gap-2">
          {shiftTypes.filter(t => !t.isOff).map(t => (
            <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded text-xs">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: t.color }} />
              <span className="font-semibold">{t.code}</span>
              <span className="text-gray-500">{t.label}</span>
              {t.startTime && t.endTime && (
                <span className="text-gray-400">{t.startTime}–{t.endTime}{t.isSplit ? ` + ${t.split2Start}–${t.split2End}` : ''}</span>
              )}
              <span className="text-gray-400">({t.hours}h)</span>
            </div>
          ))}
          <div className="flex items-center gap-2 px-2 py-1 rounded text-xs italic">
            <span className="w-3 h-3 rounded border border-dashed border-gray-400" />
            <span className="text-gray-500">~XX = sugerencia (sin guardar)</span>
          </div>
        </div>
      </Card>

      {/* Modal asignar */}
      {editing && (
        <AssignModal
          employee={localEmployees.find(e => e.id === editing.employeeId)!}
          date={editing.date}
          currentAssignment={assignByEmpDate.get(`${editing.employeeId}|${editing.date}`)}
          shiftTypes={shiftTypes}
          onAssign={(shiftTypeId) => handleAssign(editing.employeeId, editing.date, shiftTypeId)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ─── Modal de asignación ──────────────────────────────────────────────────

function AssignModal({ employee, date, currentAssignment, shiftTypes, onAssign, onClose }: {
  employee: Employee
  date: string
  currentAssignment?: ShiftAssignment
  shiftTypes: ShiftType[]
  onAssign: (shiftTypeId: string | null) => void
  onClose: () => void
}) {
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', {
    weekday: 'long', day: '2-digit', month: 'long'
  })
  const dayOfWeek = new Date(date + 'T00:00:00').getDay()
  const isFriSatSun = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Asignar turno</p>
        <p className="font-bold text-lg text-gray-900">{employee.name}</p>
        <p className="text-sm text-gray-600 capitalize">{dateLabel}</p>

        <div className="grid grid-cols-2 gap-2 mt-4">
          {shiftTypes.map(t => {
            const isCurrent = currentAssignment?.shiftTypeId === t.id
            const showLibreWarning = t.isOff && isFriSatSun
            return (
              <button
                key={t.id}
                onClick={() => onAssign(t.id)}
                className={`p-3 rounded-xl text-left text-sm transition-all ${
                  isCurrent ? 'ring-2 ring-offset-2 ring-[#7C1A1A]' : 'hover:scale-105'
                } ${t.isOff ? 'bg-gray-100 text-gray-700' : 'text-white'}`}
                style={!t.isOff ? { backgroundColor: t.color } : undefined}
              >
                <p className="font-bold">{t.code} {t.label}</p>
                {t.startTime && t.endTime && (
                  <p className="text-xs opacity-90 mt-0.5">
                    {t.startTime}–{t.endTime}
                    {t.isSplit && <span> + {t.split2Start}–{t.split2End}</span>}
                  </p>
                )}
                <p className="text-xs opacity-80 mt-0.5">{t.hours}h</p>
                {showLibreWarning && (
                  <p className="text-[10px] mt-1 px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 inline-block">⚠ V/S/D</p>
                )}
              </button>
            )
          })}
        </div>

        {currentAssignment && (
          <button
            onClick={() => onAssign(null)}
            className="w-full mt-3 text-xs text-red-600 hover:text-red-700 py-2"
          >
            🗑 Quitar asignación
          </button>
        )}

        <button onClick={onClose}
          className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-gray-700 border-t pt-3">
          Cerrar
        </button>
      </div>
    </div>
  )
}
