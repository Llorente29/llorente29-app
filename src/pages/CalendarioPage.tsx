import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Modal, Alert } from '../components/ui'
import type { WeeklySchedulePlan, ScheduleDay, ShiftType } from '../types'
import { generateSmartSchedule, SHIFT_TEMPLATES, DAY_REQUIREMENTS, type ScheduleAlert } from '../services/scheduler'

const DAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function getMondayStr(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export default function CalendarioPage() {
  const { staff, locations, schedules, setSchedules } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [weekStart, setWeekStart] = useState(() => getMondayStr(new Date()))
  const [editMode, setEditMode] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showAdjustments, setShowAdjustments] = useState(false)
  const [currentResult, setCurrentResult] = useState<{ days: ScheduleDay[]; alerts: ScheduleAlert[]; adjustments: string[] } | null>(null)

  const locEmployees = staff.filter(e => e.active && e.locationId === locId)
  const existingSchedule = schedules.find(s => s.locationId === locId && s.weekStart === weekStart)

  // Load existing when week/loc changes
  useEffect(() => {
    if (existingSchedule) {
      setCurrentResult({ days: existingSchedule.days, alerts: existingSchedule.alerts || [], adjustments: existingSchedule.adjustments || [] })
    } else {
      setCurrentResult(null)
    }
    setEditMode(false)
  }, [locId, weekStart])

  function generate() {
    const result = generateSmartSchedule(locEmployees, weekStart)
    setCurrentResult(result)
    setEditMode(true)
    if (result.alerts.length > 0) setShowAlerts(true)
  }

  function save() {
    if (!currentResult) return
    const plan: WeeklySchedulePlan = {
      id: existingSchedule?.id || `sched-${Date.now()}`,
      locationId: locId, weekStart,
      days: currentResult.days,
      published: false,
      createdAt: existingSchedule?.createdAt || new Date().toISOString(),
      alerts: currentResult.alerts,
      adjustments: currentResult.adjustments,
    } as WeeklySchedulePlan & { alerts: ScheduleAlert[]; adjustments: string[] }
    setSchedules(prev => [...prev.filter(s => !(s.locationId === locId && s.weekStart === weekStart)), plan])
    setEditMode(false)
  }

  function changeShift(dayIdx: number, empId: string, newType: ShiftType) {
    if (!currentResult) return
    const tmpl = SHIFT_TEMPLATES[newType]
    setCurrentResult(prev => {
      if (!prev) return prev
      const days = prev.days.map((day, di) => {
        if (di !== dayIdx) return day
        const shifts = day.shifts.map(s =>
          s.employeeId === empId ? { ...s, type: newType, start: tmpl.start, end: tmpl.end, hours: tmpl.hours } : s
        )
        return { ...day, shifts }
      })
      return { ...prev, days }
    })
  }

  // Totals
  const empTotals = locEmployees.map(emp => {
    if (!currentResult) return { emp, hours: 0, restDays: 0 }
    const hours = currentResult.days.reduce((sum, day) => sum + (day.shifts.find(s => s.employeeId === emp.id)?.hours || 0), 0)
    const restDays = currentResult.days.filter(d => d.shifts.find(s => s.employeeId === emp.id && s.type === 'libre')).length
    return { emp, hours, restDays }
  })

  // Alert counts
  const criticalCount = currentResult?.alerts.filter(a => a.severity === 'critical' || a.severity === 'error').length || 0

  // Week navigation
  const prevWeek = () => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() - 7); setWeekStart(d.toISOString().slice(0, 10)) }
  const nextWeek = () => { const d = new Date(weekStart + 'T12:00:00'); d.setDate(d.getDate() + 7); setWeekStart(d.toISOString().slice(0, 10)) }

  const weekLabel = (() => {
    const from = new Date(weekStart + 'T12:00:00')
    const to = new Date(weekStart + 'T12:00:00'); to.setDate(to.getDate() + 6)
    return `${from.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`
  })()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Calendario de Horarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Convenio hostelería · Máx. 40h/sem · 1.5 días descanso</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {currentResult && currentResult.alerts.length > 0 && (
            <button onClick={() => setShowAlerts(true)} className={`text-xs px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1 ${criticalCount > 0 ? 'bg-red-50 border-red-300 text-red-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
              {criticalCount > 0 ? '🚨' : '⚠️'} {currentResult.alerts.length} alertas
            </button>
          )}
          {currentResult?.adjustments && currentResult.adjustments.length > 0 && (
            <button onClick={() => setShowAdjustments(true)} className="text-xs px-3 py-1.5 rounded-lg border bg-blue-50 border-blue-300 text-blue-700 font-medium">
              📋 {currentResult.adjustments.length} ajustes
            </button>
          )}
          {editMode && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setEditMode(false); if (existingSchedule) setCurrentResult({ days: existingSchedule.days, alerts: (existingSchedule as any).alerts || [], adjustments: (existingSchedule as any).adjustments || [] }) }}>Descartar</Button>
              <Button size="sm" onClick={save}>💾 Guardar semana</Button>
            </>
          )}
          {!editMode && currentResult && (
            <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>✏️ Editar</Button>
          )}
          <Button size="sm" onClick={generate} disabled={locEmployees.length === 0}>
            ⚡ {currentResult ? 'Regenerar' : 'Generar horario'}
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center p-4 bg-gray-50 rounded-2xl border">
        <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
          <option value="">Selecciona local</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={prevWeek}>‹</Button>
          <span className="text-sm font-medium text-gray-700 min-w-[200px] text-center">{weekLabel}</span>
          <Button size="sm" variant="ghost" onClick={nextWeek}>›</Button>
        </div>
        <input type="date" value={weekStart} onChange={e => setWeekStart(getMondayStr(new Date(e.target.value + 'T12:00:00')))}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white" />
        <div className="ml-auto text-xs text-gray-500">
          {locEmployees.length} empleados activos
        </div>
      </div>

      {/* Reglas del convenio */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { icon: '📅', t: 'L-J partido', d: '12:30–16:00 + 20:00–23:30 · 7.5h' },
          { icon: '🌙', t: 'V-S-D continuo', d: '12:30–00:15 · 11.75h' },
          { icon: '👥', t: 'Personal mínimo', d: 'L-J:1 · V:2 · S:3 · D:2' },
          { icon: '😴', t: 'Descanso convenio', d: '1.5 días/sem · preferiblemente seguidos' },
        ].map(r => (
          <div key={r.t} className="bg-white rounded-xl border p-3 text-xs">
            <span className="text-lg">{r.icon}</span>
            <p className="font-semibold mt-1">{r.t}</p>
            <p className="text-gray-400">{r.d}</p>
          </div>
        ))}
      </div>

      {/* Leyenda de turnos */}
      <div className="flex flex-wrap gap-2">
        {Object.values(SHIFT_TEMPLATES).map(t => (
          <span key={t.type} className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${t.color}`}>
            {t.label}{t.hours > 0 ? ` · ${t.start}–${t.end} · ${t.hours}h` : ''}
          </span>
        ))}
      </div>

      {/* No hay local o personal */}
      {locations.length === 0 ? (
        <Alert type="warning">Primero crea un local en la sección Locales</Alert>
      ) : locEmployees.length === 0 ? (
        <Alert type="warning">No hay empleados activos en este local. Añade empleados en Personal → asignarlos a este local</Alert>
      ) : !currentResult ? (
        <Card className="p-12 text-center">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-semibold text-gray-700 mb-1">Sin horario para esta semana</p>
          <p className="text-sm text-gray-400 mb-5">El generador respetará las ausencias, vacaciones y bajas aprobadas, y te avisará si hay problemas de cobertura</p>
          <Button onClick={generate}>⚡ Generar horario automáticamente</Button>
        </Card>
      ) : (
        <>
          {/* ─── Grid de horario ─────────────────────────────────────────── */}
          <div className="border rounded-2xl overflow-x-auto bg-white shadow-sm">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 w-36 sticky left-0 bg-gray-50">Empleado</th>
                  {currentResult.days.map((day, di) => (
                    <th key={di} className={`p-2 text-center text-xs font-semibold min-w-[90px] ${di >= 5 ? 'bg-teal-50 text-teal-700' : 'text-gray-500'}`}>
                      <p className="font-bold">{DAY_SHORT[di]}</p>
                      <p className="font-normal text-[10px]">{fmtDay(day.date)}</p>
                      {/* Minimum coverage indicator */}
                      <p className={`text-[9px] mt-0.5 ${day.shifts.filter(s=>s.type!=='libre').length >= DAY_REQUIREMENTS[di].minStaff ? 'text-emerald-600' : 'text-red-500'}`}>
                        {day.shifts.filter(s=>s.type!=='libre').length}/{DAY_REQUIREMENTS[di].minStaff} mín
                      </p>
                    </th>
                  ))}
                  <th className="p-3 text-center text-xs font-semibold text-gray-500 w-20">Total</th>
                </tr>
              </thead>
              <tbody>
                {locEmployees.map(emp => {
                  const tot = empTotals.find(t => t.emp.id === emp.id)!
                  const overHours = tot.hours > 40
                  const lowRest = tot.restDays < 2

                  return (
                    <tr key={emp.id} className="border-b last:border-0 hover:bg-gray-50/50">
                      <td className="p-3 sticky left-0 bg-white border-r">
                        <p className="font-medium text-sm truncate max-w-[120px]">{emp.name || '(sin nombre)'}</p>
                        <p className="text-[10px] text-gray-400">{emp.position}</p>
                        {/* Vacaciones esta semana */}
                        {emp.vacations.some(v => v.status === 'aprobada' && v.startDate <= addDays(weekStart, 6) && v.endDate >= weekStart) && (
                          <p className="text-[9px] text-amber-600 font-medium mt-0.5">🏖 Ausencia semana</p>
                        )}
                      </td>
                      {currentResult.days.map((day, di) => {
                        const shift = day.shifts.find(s => s.employeeId === emp.id)
                        const tmpl = shift ? SHIFT_TEMPLATES[shift.type] : SHIFT_TEMPLATES.libre

                        return (
                          <td key={di} className="p-1.5">
                            {editMode ? (
                              <select value={shift?.type || 'libre'} onChange={e => changeShift(di, emp.id, e.target.value as ShiftType)}
                                className={`w-full text-[10px] rounded-lg px-1 py-2 border font-semibold cursor-pointer ${tmpl.color}`}
                                title={shift?.notes}>
                                {Object.values(SHIFT_TEMPLATES).map(t => (
                                  <option key={t.type} value={t.type}>{t.label}</option>
                                ))}
                              </select>
                            ) : (
                              <div className={`text-[10px] rounded-lg px-1.5 py-2 text-center border font-semibold ${tmpl.color}`} title={shift?.notes}>
                                {shift?.type === 'libre' ? (
                                  <span className="opacity-60">{shift.notes ? `📋 ${shift.notes.slice(0,8)}` : 'Libre'}</span>
                                ) : (
                                  <>
                                    <p>{tmpl.shortLabel}</p>
                                    <p className="opacity-70">{shift?.start}–{shift?.end}</p>
                                    <p className="opacity-60">{shift?.hours}h</p>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="p-3 text-center border-l">
                        <p className={`font-bold text-sm ${overHours ? 'text-red-600' : tot.hours >= 35 ? 'text-emerald-600' : 'text-gray-600'}`}>
                          {tot.hours.toFixed(1)}h
                        </p>
                        <p className={`text-[10px] mt-0.5 ${lowRest ? 'text-amber-600' : 'text-gray-400'}`}>{tot.restDays}d libre</p>
                        {overHours && <p className="text-[9px] text-red-500">⚠️ +40h</p>}
                      </td>
                    </tr>
                  )
                })}
                {/* Fila de cobertura diaria */}
                <tr className="bg-gray-50 border-t-2">
                  <td className="p-2 text-xs font-semibold text-gray-500 sticky left-0 bg-gray-50">Trabajando</td>
                  {currentResult.days.map((day, di) => {
                    const working = day.shifts.filter(s => s.type !== 'libre').length
                    const min = DAY_REQUIREMENTS[di].minStaff
                    const ideal = DAY_REQUIREMENTS[di].idealStaff
                    const ok = working >= min
                    const great = working >= ideal
                    return (
                      <td key={di} className="p-2 text-center">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${great ? 'bg-emerald-100 text-emerald-700' : ok ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {working} {ok ? '✓' : '!'}
                        </span>
                      </td>
                    )
                  })}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Leyenda de estado */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span>✓ verde = cubre ideal · ✓ amarillo = cubre mínimo · ! rojo = por debajo del mínimo</span>
          </div>
        </>
      )}

      {/* Modal Alertas */}
      <Modal open={showAlerts} onClose={() => setShowAlerts(false)} title={`Alertas del horario (${currentResult?.alerts.length || 0})`} size="md">
        <div className="space-y-2">
          {currentResult?.alerts.map(alert => (
            <div key={alert.id} className={`p-3 rounded-xl border text-sm ${
              alert.severity === 'critical' ? 'bg-red-50 border-red-300 text-red-800' :
              alert.severity === 'error' ? 'bg-orange-50 border-orange-300 text-orange-800' :
              alert.severity === 'warning' ? 'bg-amber-50 border-amber-300 text-amber-800' :
              'bg-blue-50 border-blue-300 text-blue-800'
            }`}>
              <p className="font-medium">{alert.severity === 'critical' ? '🚨' : alert.severity === 'error' ? '❌' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'} {alert.message}</p>
              {alert.suggestion && <p className="text-xs mt-1 opacity-80">💡 {alert.suggestion}</p>}
            </div>
          ))}
          {currentResult?.alerts.length === 0 && <Alert type="success">✅ Sin alertas. El horario cumple todas las condiciones.</Alert>}
          <Button onClick={() => setShowAlerts(false)} className="w-full mt-2">Cerrar</Button>
        </div>
      </Modal>

      {/* Modal Ajustes */}
      <Modal open={showAdjustments} onClose={() => setShowAdjustments(false)} title="Ajustes aplicados automáticamente" size="md">
        <div className="space-y-2">
          {currentResult?.adjustments.map((adj, i) => (
            <div key={i} className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800">
              📋 {adj}
            </div>
          ))}
          {(!currentResult?.adjustments || currentResult.adjustments.length === 0) && (
            <p className="text-gray-400 text-sm text-center py-4">Sin ajustes especiales aplicados</p>
          )}
          <Button onClick={() => setShowAdjustments(false)} className="w-full mt-2">Cerrar</Button>
        </div>
      </Modal>
    </div>
  )
}
