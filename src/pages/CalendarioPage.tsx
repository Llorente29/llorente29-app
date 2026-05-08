// src/pages/CalendarioPage.tsx
// Calendario semanal de horarios. Vista principal del gestor.
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Card, Button } from '../components/ui'
import {
  fetchShiftTypes, getOrCreatePlan, fetchAssignmentsForPlan,
  upsertAssignment, publishPlan, unpublishPlan,
  duplicatePreviousWeek, clearPlanAssignments,
  fetchMinimums,
  mondayOf, weekDates, shortDayLabel, isWeekend,
  type ShiftType, type WeeklyPlan, type ShiftAssignment, type ShiftMinimum,
} from '../services/calendarService'
import {
  validatePlan, shiftCoverage,
  type ValidationIssue,
} from '../services/calendarValidations'
import { autoGenerate, type AutoGenMode } from '../services/calendarAutoGen'
import { isSupabaseEnabled, supabase } from '../lib/supabase'
import type { Employee } from '../types'
import PlantillaLocalPage from './PlantillaLocalPage'

type ViewMode = 'tabla' | 'empleado'

export default function CalendarioPage() {
  const { staff, locations } = useApp()
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()))
  const [locationId, setLocationId] = useState<string>('')
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [minimums, setMinimums] = useState<ShiftMinimum[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ employeeId: string; date: string } | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('tabla')
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null)
  const [showValidations, setShowValidations] = useState(true)
  const [showAutoGen, setShowAutoGen] = useState(false)
  const [showPlantilla, setShowPlantilla] = useState(false)

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

  // Cargar mínimos cuando cambia el local
  useEffect(() => {
    if (locationId) fetchMinimums(locationId).then(setMinimums)
  }, [locationId])

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

  // ─── Validaciones del convenio + cobertura ──────────────────────────────
  const validations = useMemo<ValidationIssue[]>(() => {
    if (!plan || localEmployees.length === 0) return []
    return validatePlan({
      assignments, shiftTypes,
      employees: localEmployees,
      minimums, weekDays: days, locationId,
    })
  }, [assignments, shiftTypes, localEmployees, minimums, days, locationId, plan])

  const errors = validations.filter(v => v.level === 'error')
  const warnings = validations.filter(v => v.level === 'warning')

  const coverage = useMemo(() => shiftCoverage(assignments, shiftTypes, days), [assignments, shiftTypes, days])

  // Acciones planificación rápida
  async function handleDuplicatePrev() {
    if (!plan) return
    if (!confirm('¿Copiar las asignaciones de la semana anterior? Se sobrescribirá lo que ya tengas en esta semana.')) return
    const copied = await duplicatePreviousWeek(plan.id, weekStart, locationId)
    if (copied === null) {
      alert('No hay plan en la semana anterior. Empieza esa semana primero.')
    } else {
      const a = await fetchAssignmentsForPlan(plan.id)
      setAssignments(a)
      alert(`✓ Copiadas ${copied} asignaciones de la semana anterior`)
    }
  }

  async function handleClearWeek() {
    if (!plan) return
    if (!confirm('¿Borrar TODAS las asignaciones de esta semana? No se puede deshacer.')) return
    await clearPlanAssignments(plan.id)
    const a = await fetchAssignmentsForPlan(plan.id)
    setAssignments(a)
  }

  async function handleAutoGenerate(mode: AutoGenMode, weeksAhead: number) {
    if (!plan) return
    let totalCreated = 0
    let totalConflicts = 0

    for (let w = 0; w < weeksAhead; w++) {
      // Calcular fecha de la semana objetivo
      const target = new Date(weekStart + 'T00:00:00')
      target.setDate(target.getDate() + w * 7)
      const ty = target.getFullYear()
      const tm = String(target.getMonth() + 1).padStart(2, '0')
      const td = String(target.getDate()).padStart(2, '0')
      const targetWeekStart = `${ty}-${tm}-${td}`

      // Obtener o crear plan de esa semana
      const targetPlan = await getOrCreatePlan(targetWeekStart, locationId)
      if (!targetPlan) continue

      // Cargar asignaciones existentes de ese plan
      const existingAssigns = await fetchAssignmentsForPlan(targetPlan.id)

      // Calcular días de esa semana
      const targetDays = weekDates(targetWeekStart)

      const result = autoGenerate({
        employees: localEmployees,
        shiftTypes,
        days: targetDays,
        existingAssignments: existingAssigns,
        mode,
      })

      if (result.toUpsert.length === 0) continue

      // Aplicar
      for (const a of result.toUpsert) {
        await upsertAssignment({
          planId: targetPlan.id,
          employeeId: a.employeeId,
          date: a.date,
          shiftTypeId: a.shiftTypeId,
        })
      }
      totalCreated += result.toUpsert.length
      totalConflicts += result.conflicts
    }

    // Recargar plan actual para refrescar la vista
    if (plan) {
      const refreshed = await fetchAssignmentsForPlan(plan.id)
      setAssignments(refreshed)
    }
    setShowAutoGen(false)

    if (totalCreated === 0) {
      alert('No hay nada para generar. Comprueba que los empleados tengan horario semanal configurado.')
    } else {
      const weeksLabel = weeksAhead === 1 ? 'esta semana' : `${weeksAhead} semanas`
      alert(`✓ Generadas ${totalCreated} asignaciones en ${weeksLabel}${totalConflicts > 0 ? ` (${totalConflicts} sobrescrituras)` : ''}`)
    }
  }

  const weekRangeLabel = useMemo(() => {
    const start = new Date(weekStart + 'T00:00:00')
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return `${start.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}`
  }, [weekStart])

  const isCurrentWeek = weekStart === mondayOf(new Date())

  if (showPlantilla) {
    return <PlantillaLocalPage onBack={() => setShowPlantilla(false)} />
  }

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

          <div className="flex items-center gap-2 flex-wrap">
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

        {/* Acciones rápidas y toggle vista */}
        <div className="flex items-center justify-between flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1">
            <button onClick={() => setViewMode('tabla')}
              className={`text-xs px-3 py-1 rounded-l border ${viewMode === 'tabla' ? 'bg-[#7C1A1A] text-white border-[#7C1A1A]' : 'bg-white text-gray-600 border-gray-200'}`}>
              📊 Tabla semanal
            </button>
            <button onClick={() => setViewMode('empleado')}
              className={`text-xs px-3 py-1 rounded-r border ${viewMode === 'empleado' ? 'bg-[#7C1A1A] text-white border-[#7C1A1A]' : 'bg-white text-gray-600 border-gray-200'}`}>
              👤 Por empleado
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowPlantilla(true)}
              className="text-xs px-3 py-1 rounded bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium">
              ⚙️ Plantilla del local
            </button>
            <button onClick={() => setShowAutoGen(true)}
              className="text-xs px-3 py-1 rounded bg-[#7C1A1A] text-white hover:bg-[#5A1212] font-medium">
              🪄 Generar semana
            </button>
            <button onClick={handleDuplicatePrev}
              className="text-xs px-3 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">
              📋 Duplicar semana anterior
            </button>
            <button onClick={handleClearWeek}
              className="text-xs px-3 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium">
              🗑 Limpiar semana
            </button>
          </div>
        </div>
      </Card>

      {/* Panel de validaciones */}
      {(errors.length > 0 || warnings.length > 0) && showValidations && (
        <Card className={`p-3 ${errors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <p className={`text-xs font-bold uppercase tracking-wide ${errors.length > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                  {errors.length > 0 && <>🚨 {errors.length} error{errors.length !== 1 ? 'es' : ''} </>}
                  {warnings.length > 0 && <>⚠ {warnings.length} avis{warnings.length !== 1 ? 'os' : 'o'}</>}
                </p>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {errors.map((v, i) => (
                  <ValidationRow key={`e-${i}`} issue={v} />
                ))}
                {warnings.map((v, i) => (
                  <ValidationRow key={`w-${i}`} issue={v} />
                ))}
              </div>
            </div>
            <button onClick={() => setShowValidations(false)}
              className="text-xs text-gray-500 hover:text-gray-700 shrink-0">✕</button>
          </div>
        </Card>
      )}

      {(errors.length > 0 || warnings.length > 0) && !showValidations && (
        <button onClick={() => setShowValidations(true)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium ${
            errors.length > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
          }`}>
          {errors.length > 0 ? `🚨 Mostrar ${errors.length} error${errors.length !== 1 ? 'es' : ''}` : `⚠ Mostrar ${warnings.length} aviso${warnings.length !== 1 ? 's' : ''}`}
        </button>
      )}

      {/* Tabla calendario */}
      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
      ) : localEmployees.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-5xl mb-3">👥</p>
          <p className="font-semibold text-gray-700">Sin empleados en este local</p>
          <p className="text-xs text-gray-500 mt-1">Asigna empleados al local desde Personal</p>
        </Card>
      ) : viewMode === 'empleado' ? (
        <EmployeeView
          employees={localEmployees}
          selectedId={selectedEmpId}
          onSelect={setSelectedEmpId}
          assignByEmpDate={assignByEmpDate}
          typesById={typesById}
          days={days}
          weeklyHoursOf={weeklyHoursOf}
          onCellClick={(emp, date) => setEditing({ employeeId: emp.id, date })}
        />
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

            {/* Filas de cobertura */}
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="px-3 py-2 sticky left-0 bg-gray-50 z-10 text-[10px] uppercase tracking-wide text-gray-500 font-bold">
                  Cobertura
                </td>
                {days.map(d => (
                  <td key={d} className={`p-1 text-center ${isWeekend(d) ? 'bg-amber-50/30' : ''}`}>&nbsp;</td>
                ))}
                <td className="px-3 py-2"></td>
              </tr>
              {shiftTypes.filter(t => !t.isOff).map(t => (
                <tr key={t.id} className="border-b border-gray-100 bg-gray-50/50 text-xs">
                  <td className="px-3 py-1.5 sticky left-0 bg-gray-50/50 z-10">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                      <span className="text-gray-600 font-medium">{t.code}</span>
                    </span>
                  </td>
                  {days.map(d => {
                    const count = coverage.get(t.id)?.get(d) || 0
                    const min = minimums.find(m => m.shiftTypeId === t.id)
                    const w = isWeekend(d)
                    const required = min ? (w && min.minWeekend != null ? min.minWeekend : min.minDefault) : 0
                    const ok = count >= required
                    const empty = count === 0
                    return (
                      <td key={d} className={`p-1 text-center ${isWeekend(d) ? 'bg-amber-50/30' : ''}`}>
                        <span className={`inline-block w-7 h-5 rounded text-[10px] font-bold leading-5 ${
                          empty && required > 0 ? 'bg-red-100 text-red-700' :
                          !ok ? 'bg-amber-100 text-amber-700' :
                          'bg-emerald-50 text-emerald-700'
                        }`} title={`Asignados: ${count} / Mínimo: ${required}`}>
                          {count}/{required}
                        </span>
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5"></td>
                </tr>
              ))}

              {/* Fila especial: cobertura 20:00–cierre (solo aplica V/S/D, mínimo 3) */}
              <tr className="border-t border-gray-200 bg-amber-50/50 text-xs">
                <td className="px-3 py-1.5 sticky left-0 bg-amber-50/50 z-10">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-amber-700 font-bold">20–cierre</span>
                    <span className="text-[10px] text-amber-600">(V/S/D, mín 3)</span>
                  </span>
                </td>
                {days.map(d => {
                  const dow = new Date(d + 'T00:00:00').getDay()
                  const isVSD = dow === 5 || dow === 6 || dow === 0
                  if (!isVSD) {
                    return <td key={d} className="p-1 text-center text-gray-300">—</td>
                  }
                  // Contar empleados cuyo turno cubra 20:00–00:15
                  let count = 0
                  for (const a of assignments) {
                    if (a.date !== d || !a.shiftTypeId) continue
                    const t = typesById.get(a.shiftTypeId)
                    if (!t || t.isOff) continue
                    const checkRange = (s?: string, e?: string) => {
                      if (!s || !e) return false
                      const [sh, sm] = s.split(':').map(Number)
                      const [eh, em] = e.split(':').map(Number)
                      const s1 = sh * 60 + sm
                      let e1 = eh * 60 + em
                      if (e1 <= s1) e1 += 24 * 60
                      return s1 <= 20 * 60 && e1 >= 20 * 60 + 15
                    }
                    if (checkRange(t.startTime, t.endTime)) { count++; continue }
                    if (t.isSplit && checkRange(t.split2Start, t.split2End)) { count++ }
                  }
                  const ok = count >= 3
                  return (
                    <td key={d} className="p-1 text-center bg-amber-50/30">
                      <span className={`inline-block w-7 h-5 rounded text-[10px] font-bold leading-5 ${
                        count === 0 ? 'bg-red-100 text-red-700' :
                        !ok ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-50 text-emerald-700'
                      }`} title={`Cubriendo 20:00–cierre: ${count} / 3`}>
                        {count}/3
                      </span>
                    </td>
                  )
                })}
                <td className="px-3 py-1.5"></td>
              </tr>
            </tfoot>
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

      {/* Modal auto-generar */}
      {showAutoGen && (
        <AutoGenModal
          onClose={() => setShowAutoGen(false)}
          onGenerate={handleAutoGenerate}
          employeesWithoutSchedule={localEmployees.filter(e => {
            const ws = e.weeklySchedule
            if (!ws) return true
            const allDays = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return !allDays.some(d => (ws as any)[d]?.active)
          })}
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

// ─── ValidationRow ────────────────────────────────────────────────────────

function ValidationRow({ issue }: { issue: ValidationIssue }) {
  const isError = issue.level === 'error'
  return (
    <div className={`flex items-start gap-2 text-xs ${isError ? 'text-red-800' : 'text-amber-800'}`}>
      <span className="shrink-0">{isError ? '🚨' : '⚠'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{issue.title}</p>
        <p className="opacity-80">{issue.description}</p>
      </div>
    </div>
  )
}

// ─── EmployeeView ─────────────────────────────────────────────────────────

function EmployeeView({
  employees, selectedId, onSelect, assignByEmpDate, typesById, days, weeklyHoursOf, onCellClick,
}: {
  employees: Employee[]
  selectedId: string | null
  onSelect: (id: string) => void
  assignByEmpDate: Map<string, ShiftAssignment>
  typesById: Map<string, ShiftType>
  days: string[]
  weeklyHoursOf: (id: string) => number
  onCellClick: (employee: Employee, date: string) => void
}) {
  const selected = selectedId ? employees.find(e => e.id === selectedId) : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
      {/* Lista empleados */}
      <Card className="p-2 max-h-[600px] overflow-y-auto">
        {employees.map(e => {
          const total = weeklyHoursOf(e.id)
          const isSelected = e.id === selectedId
          return (
            <button key={e.id} onClick={() => onSelect(e.id)}
              className={`w-full p-2 rounded-lg text-left transition-all mb-1 ${
                isSelected ? 'bg-[#F5E9D9] border border-[#7C1A1A]' : 'hover:bg-gray-50'
              }`}>
              <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
              <p className="text-[10px] text-gray-400">{e.position || '—'} · {total.toFixed(1)}h</p>
            </button>
          )
        })}
      </Card>

      {/* Detalle del empleado */}
      <div>
        {!selected ? (
          <Card className="p-12 text-center">
            <p className="text-3xl mb-2">👤</p>
            <p className="text-sm text-gray-500">Selecciona un empleado para ver su semana</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="p-4 border-b">
              <p className="font-bold text-gray-900">{selected.name}</p>
              <p className="text-xs text-gray-500">{selected.position || '—'} · {selected.weeklyHours || 40}h contrato</p>
            </div>
            <div className="divide-y">
              {days.map(d => {
                const a = assignByEmpDate.get(`${selected.id}|${d}`)
                const t = a?.shiftTypeId ? typesById.get(a.shiftTypeId) : null
                const date = new Date(d + 'T00:00:00')
                const dayLabel = date.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'short' })
                return (
                  <button key={d}
                    onClick={() => onCellClick(selected, d)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 text-left">
                    <div className="w-2 h-10 rounded-full" style={{ backgroundColor: t?.color || '#E5E7EB' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 capitalize">{dayLabel}</p>
                      {t ? (
                        <p className="text-xs" style={{ color: t.color }}>
                          {t.code} {t.label}
                          {t.startTime && ` · ${t.startTime}–${t.endTime}`}
                          {t.isSplit && ` + ${t.split2Start}–${t.split2End}`}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 italic">Sin asignar</p>
                      )}
                    </div>
                    {t && !t.isOff && <p className="text-sm font-medium text-gray-700">{t.hours}h</p>}
                  </button>
                )
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ─── AutoGenModal ─────────────────────────────────────────────────────────

function AutoGenModal({ onClose, onGenerate, employeesWithoutSchedule }: {
  onClose: () => void
  onGenerate: (mode: AutoGenMode, weeksAhead: number) => void
  employeesWithoutSchedule: Employee[]
}) {
  const [mode, setMode] = useState<AutoGenMode>('solo_vacios')
  const [weeksAhead, setWeeksAhead] = useState<number>(1)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Auto-generar</p>
        <p className="font-bold text-lg text-gray-900">🪄 Generar calendario automáticamente</p>
        <p className="text-xs text-gray-500 mt-1">
          Asignaremos turnos y libras a partir del horario semanal de cada empleado.
        </p>

        {/* Período */}
        <p className="text-xs uppercase tracking-wide text-gray-400 mt-4 mb-2">Período</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { weeks: 1, label: '1 semana' },
            { weeks: 4, label: '4 semanas (mes)' },
            { weeks: 8, label: '8 semanas' },
          ].map(opt => (
            <button key={opt.weeks} onClick={() => setWeeksAhead(opt.weeks)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border-2 ${
                weeksAhead === opt.weeks
                  ? 'border-[#7C1A1A] bg-[#F5E9D9] text-[#7C1A1A]'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Modo */}
        <p className="text-xs uppercase tracking-wide text-gray-400 mt-4 mb-2">Modo</p>
        <div className="space-y-2">
          <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
            mode === 'solo_vacios' ? 'border-[#7C1A1A] bg-[#F5E9D9]' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" name="mode" checked={mode === 'solo_vacios'}
              onChange={() => setMode('solo_vacios')}
              className="mt-1 accent-[#7C1A1A]" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Solo huecos vacíos</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Rellena las celdas vacías con turnos y libras según el horario del empleado. No toca lo ya asignado.
              </p>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
            mode === 'solo_libras' ? 'border-[#7C1A1A] bg-[#F5E9D9]' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" name="mode" checked={mode === 'solo_libras'}
              onChange={() => setMode('solo_libras')}
              className="mt-1 accent-[#7C1A1A]" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Solo libras</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Solo asigna LIBRE a los días que el empleado tiene marcados como inactivos en su horario semanal. No toca turnos.
                <span className="text-amber-700"> Excluye V/S/D</span> (no se libra automáticamente fines de semana).
              </p>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
            mode === 'todo' ? 'border-[#7C1A1A] bg-[#F5E9D9]' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" name="mode" checked={mode === 'todo'}
              onChange={() => setMode('todo')}
              className="mt-1 accent-[#7C1A1A]" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Reasignar todo</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sobrescribe TODAS las celdas con el patrón del horario semanal.
              </p>
            </div>
          </label>
        </div>

        {employeesWithoutSchedule.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            ⚠ {employeesWithoutSchedule.length} empleado{employeesWithoutSchedule.length !== 1 ? 's' : ''} sin horario semanal configurado: {employeesWithoutSchedule.map(e => e.name).join(', ')}.
            No se les generará nada hasta que les asignes uno desde su ficha.
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={() => onGenerate(mode, weeksAhead)} className="flex-1">🪄 Generar</Button>
        </div>
      </div>
    </div>
  )
}
