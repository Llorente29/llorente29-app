import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Modal, Alert } from '../components/ui'
import type { WeeklySchedulePlan } from '../types'
import {
  generateSmartSchedule, DAY_CODES, DAY_LABELS, DAY_SHORT,
  LOCAL_SCHEDULE, MIN_STAFF, calcHours, type GeneratedSchedule, type ScheduleAlert, type DayCode, type WorkerWeek
} from '../services/scheduler'

function getMondayStr(date: Date): string {
  const d = new Date(date); const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff)
  return d.toISOString().slice(0, 10)
}
function addDaysStr(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
function fmtDateShort(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

// ─── Celda de turno individual ────────────────────────────────────────────────
function ShiftCell({ manana, tarde, libre, notes, hours, editMode, onChangeManana, onChangeTarde }:
  { manana?: {start:string;end:string}; tarde?: {start:string;end:string}; libre: boolean; notes?: string; hours: number
    editMode?: boolean; onChangeManana?: (start:string, end:string)=>void; onChangeTarde?: (start:string, end:string)=>void }) {
  if (libre) return (
    <div className="h-full flex flex-col items-center justify-center min-h-[52px]">
      <span className="text-[10px] text-gray-300 font-medium">{notes ? `📋 ${notes.slice(0,6)}` : 'LIBRE'}</span>
    </div>
  )
  return (
    <div className="space-y-0.5 min-h-[52px]">
      {manana && (
        editMode ? (
          <div className="flex gap-0.5">
            <input type="time" value={manana.start} onChange={e=>onChangeManana?.(e.target.value, manana.end)} className="w-14 text-[9px] border rounded px-0.5 py-0.5 bg-amber-50" />
            <input type="time" value={manana.end} onChange={e=>onChangeManana?.(manana.start, e.target.value)} className="w-14 text-[9px] border rounded px-0.5 py-0.5 bg-amber-50" />
          </div>
        ) : (
          <div className="bg-amber-100 border border-amber-200 rounded px-1 py-0.5 text-center">
            <p className="text-[9px] font-bold text-amber-800">{manana.start}</p>
            <p className="text-[9px] text-amber-600">{manana.end}</p>
          </div>
        )
      )}
      {tarde && (
        editMode ? (
          <div className="flex gap-0.5">
            <input type="time" value={tarde.start} onChange={e=>onChangeTarde?.(e.target.value, tarde.end)} className="w-14 text-[9px] border rounded px-0.5 py-0.5 bg-violet-50" />
            <input type="time" value={tarde.end} onChange={e=>onChangeTarde?.(tarde.start, e.target.value)} className="w-14 text-[9px] border rounded px-0.5 py-0.5 bg-violet-50" />
          </div>
        ) : (
          <div className="bg-violet-100 border border-violet-200 rounded px-1 py-0.5 text-center">
            <p className="text-[9px] font-bold text-violet-800">{tarde.start}</p>
            <p className="text-[9px] text-violet-600">{tarde.end}</p>
          </div>
        )
      )}
      {hours > 0 && !editMode && <p className="text-[9px] text-gray-400 text-center">{hours.toFixed(1)}h</p>}
    </div>
  )
}

// ─── Vista individual del trabajador ─────────────────────────────────────────
function WorkerView({ worker, weekStart }: { worker: WorkerWeek; weekStart: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-2xl border border-teal-200">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-white font-bold">
          {worker.employeeName[0]?.toUpperCase() || '?'}
        </div>
        <div>
          <p className="font-semibold">{worker.employeeName}</p>
          <p className="text-xs text-gray-500">{worker.position} · {worker.totalHours.toFixed(1)}h esta semana · {worker.restDays} días libres</p>
        </div>
      </div>

      <div className="space-y-2">
        {DAY_CODES.map((day, di) => {
          const shift = worker.days[day]
          const date = addDaysStr(weekStart, di)
          if (!shift) return null
          return (
            <div key={day} className={`flex items-start gap-3 p-3 rounded-xl border ${shift.libre ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>
              <div className="w-24 shrink-0">
                <p className={`font-semibold text-sm ${shift.libre ? 'text-gray-400' : ''}`}>{DAY_LABELS[day]}</p>
                <p className="text-xs text-gray-400">{fmtDateShort(date)}</p>
              </div>
              {shift.libre ? (
                <span className="text-sm text-gray-400">{shift.notes || 'Día libre'}</span>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {shift.manana && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
                      <p className="text-xs text-amber-500 font-medium">Mañana</p>
                      <p className="text-sm font-bold text-amber-800">{shift.manana.start} – {shift.manana.end}</p>
                      <p className="text-xs text-amber-500">{calcHours(shift.manana.start, shift.manana.end).toFixed(1)}h</p>
                    </div>
                  )}
                  {shift.tarde && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 text-center">
                      <p className="text-xs text-violet-500 font-medium">Noche</p>
                      <p className="text-sm font-bold text-violet-800">{shift.tarde.start} – {shift.tarde.end}</p>
                      <p className="text-xs text-violet-500">{calcHours(shift.tarde.start, shift.tarde.end).toFixed(1)}h</p>
                    </div>
                  )}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-center">
                    <p className="text-xs text-gray-400">Total</p>
                    <p className="text-sm font-bold text-gray-700">{shift.totalHours.toFixed(1)}h</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-3 bg-gray-50 rounded-xl border text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Total semana</span>
          <span className={`font-bold ${worker.totalHours > 40 ? 'text-red-600' : 'text-emerald-600'}`}>{worker.totalHours.toFixed(1)}h / 40h</span>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-gray-500">Días libres</span>
          <span className={`font-medium ${worker.restDays < 2 ? 'text-amber-600' : 'text-emerald-600'}`}>{worker.restDays}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CalendarioPage() {
  const { staff, locations, schedules, setSchedules } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [weekStart, setWeekStart] = useState(() => getMondayStr(new Date()))
  const [editMode, setEditMode] = useState(false)
  const [view, setView] = useState<'equipo' | 'individual'>('equipo')
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showAdjustments, setShowAdjustments] = useState(false)
  const [currentSchedule, setCurrentSchedule] = useState<GeneratedSchedule | null>(null)

  const locEmployees = staff.filter(e => e.active && e.locationId === locId)
  const existingSchedule = schedules.find(s => s.locationId === locId && s.weekStart === weekStart) as (WeeklySchedulePlan & { generatedData?: GeneratedSchedule }) | undefined

  useEffect(() => {
    if (existingSchedule?.generatedData) {
      setCurrentSchedule(existingSchedule.generatedData)
    } else {
      setCurrentSchedule(null)
    }
    setEditMode(false)
    setSelectedWorker(null)
  }, [locId, weekStart])

  function generate() {
    const result = generateSmartSchedule(locEmployees, weekStart)
    setCurrentSchedule(result)
    setEditMode(true)
    if (result.alerts.filter(a => a.severity === 'critical' || a.severity === 'error').length > 0) {
      setShowAlerts(true)
    }
  }

  function save() {
    if (!currentSchedule) return
    const plan = {
      id: existingSchedule?.id || `sched-${Date.now()}`,
      locationId: locId, weekStart,
      days: [], published: false,
      createdAt: existingSchedule?.createdAt || new Date().toISOString(),
      generatedData: currentSchedule,
    }
    setSchedules(prev => [...prev.filter(s => !(s.locationId === locId && s.weekStart === weekStart)), plan as WeeklySchedulePlan])
    setEditMode(false)
  }

  function updateShift(empId: string, day: DayCode, part: 'manana' | 'tarde', start: string, end: string) {
    setCurrentSchedule(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workers: prev.workers.map(w => {
          if (w.employeeId !== empId) return w
          const dayShift = { ...w.days[day] }
          if (part === 'manana') dayShift.manana = { start, end }
          else dayShift.tarde = { start, end }
          dayShift.totalHours = (dayShift.manana ? calcHours(dayShift.manana.start, dayShift.manana.end) : 0) + (dayShift.tarde ? calcHours(dayShift.tarde.start, dayShift.tarde.end) : 0)
          return { ...w, days: { ...w.days, [day]: dayShift }, totalHours: Object.values({ ...w.days, [day]: dayShift }).reduce((s: number, d: {totalHours: number}) => s + d.totalHours, 0) }
        })
      }
    })
  }

  function toggleLibre(empId: string, day: DayCode) {
    setCurrentSchedule(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workers: prev.workers.map(w => {
          if (w.employeeId !== empId) return w
          const cur = w.days[day]
          const localSched = LOCAL_SCHEDULE[day]
          if (cur.libre) {
            // Asignar turno completo
            const mananaH = localSched.manana ? calcHours(localSched.manana.start, localSched.manana.end) : 0
            const tardeH = calcHours(localSched.tarde.start, localSched.tarde.end)
            return { ...w, days: { ...w.days, [day]: { manana: localSched.manana, tarde: localSched.tarde, libre: false, totalHours: mananaH + tardeH } }, restDays: w.restDays - 1 }
          } else {
            return { ...w, days: { ...w.days, [day]: { libre: true, totalHours: 0 } }, restDays: w.restDays + 1 }
          }
        })
      }
    })
  }

  const weekLabel = (() => {
    const from = new Date(weekStart + 'T12:00:00')
    const to = new Date(weekStart + 'T12:00:00'); to.setDate(to.getDate() + 6)
    return `${from.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`
  })()

  const alertCounts = useMemo(() => ({
    critical: currentSchedule?.alerts.filter(a => a.severity === 'critical').length || 0,
    error: currentSchedule?.alerts.filter(a => a.severity === 'error').length || 0,
    warning: currentSchedule?.alerts.filter(a => a.severity === 'warning').length || 0,
  }), [currentSchedule])

  const selectedWorkerData = currentSchedule?.workers.find(w => w.employeeId === selectedWorker)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Calendario de Horarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Convenio hostelería · Máx. 40h · 1.5 días descanso</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {currentSchedule && (alertCounts.critical + alertCounts.error + alertCounts.warning) > 0 && (
            <button onClick={() => setShowAlerts(true)} className={`text-xs px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1 ${alertCounts.critical > 0 ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : alertCounts.error > 0 ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
              {alertCounts.critical > 0 ? '🚨' : alertCounts.error > 0 ? '❌' : '⚠️'} {alertCounts.critical + alertCounts.error + alertCounts.warning} alertas
            </button>
          )}
          {currentSchedule?.adjustments && currentSchedule.adjustments.length > 0 && (
            <button onClick={() => setShowAdjustments(true)} className="text-xs px-3 py-1.5 rounded-lg border bg-blue-50 border-blue-300 text-blue-700 font-medium">
              📋 {currentSchedule.adjustments.length} ajustes
            </button>
          )}
          {editMode ? (
            <>
              <Button size="sm" variant="outline" onClick={() => { setEditMode(false); if (existingSchedule?.generatedData) setCurrentSchedule(existingSchedule.generatedData) }}>Descartar</Button>
              <Button size="sm" onClick={save}>💾 Guardar</Button>
            </>
          ) : currentSchedule ? (
            <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>✏️ Editar</Button>
          ) : null}
          <Button size="sm" onClick={generate} disabled={locEmployees.length === 0}>
            ⚡ {currentSchedule ? 'Regenerar' : 'Generar horario'}
          </Button>
        </div>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap gap-3 items-center p-3 bg-gray-50 rounded-2xl border">
        <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
          <option value="">Local...</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => { const d = new Date(weekStart+'T12:00:00'); d.setDate(d.getDate()-7); setWeekStart(d.toISOString().slice(0,10)) }}>‹</Button>
          <span className="text-sm font-medium px-2 min-w-[220px] text-center">{weekLabel}</span>
          <Button size="sm" variant="ghost" onClick={() => { const d = new Date(weekStart+'T12:00:00'); d.setDate(d.getDate()+7); setWeekStart(d.toISOString().slice(0,10)) }}>›</Button>
        </div>
        {/* Vista equipo / individual */}
        <div className="ml-auto flex gap-1 bg-white border rounded-lg p-1">
          <button onClick={() => setView('equipo')} className={`text-xs px-3 py-1.5 rounded font-medium ${view==='equipo' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>👥 Equipo</button>
          <button onClick={() => setView('individual')} className={`text-xs px-3 py-1.5 rounded font-medium ${view==='individual' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>👤 Individual</button>
        </div>
      </div>

      {/* Horario del local */}
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {DAY_CODES.map(day => {
          const ls = LOCAL_SCHEDULE[day]
          const isWeekend = day === 'sabado' || day === 'domingo' || day === 'viernes'
          return (
            <div key={day} className={`p-2 rounded-xl border text-center ${isWeekend ? 'bg-teal-50 border-teal-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`font-bold text-xs ${isWeekend ? 'text-teal-700' : 'text-gray-600'}`}>{DAY_SHORT[day]}</p>
              {ls.manana && <p className="text-[9px] text-amber-600">{ls.manana.start}–{ls.manana.end}</p>}
              <p className="text-[9px] text-violet-600">{ls.tarde.start}–{ls.tarde.end}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">mín {Math.max(MIN_STAFF[day].manana, MIN_STAFF[day].tarde)}</p>
            </div>
          )
        })}
      </div>

      {/* Sin datos */}
      {locations.length === 0 ? (
        <Alert type="warning">Primero crea un local en Configuración → Locales</Alert>
      ) : locEmployees.length === 0 ? (
        <Alert type="warning">No hay empleados activos en este local</Alert>
      ) : !currentSchedule ? (
        <Card className="p-10 text-center">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-semibold text-gray-700 mb-1">Sin horario generado para esta semana</p>
          <p className="text-sm text-gray-400 mb-5">El sistema respetará vacaciones y bajas aprobadas, y alertará si hay problemas de cobertura</p>
          <Button onClick={generate}>⚡ Generar horario automáticamente</Button>
        </Card>
      ) : view === 'individual' ? (
        // ─── Vista individual ──────────────────────────────────────────────
        <div className="space-y-4">
          {/* Selector de trabajador */}
          <div className="flex flex-wrap gap-2">
            {currentSchedule.workers.map(w => (
              <button key={w.employeeId} onClick={() => setSelectedWorker(w.employeeId === selectedWorker ? null : w.employeeId)}
                className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${selectedWorker === w.employeeId ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                {w.employeeName} <span className="opacity-60 text-xs">{w.totalHours.toFixed(0)}h</span>
              </button>
            ))}
          </div>
          {selectedWorkerData ? (
            <WorkerView worker={selectedWorkerData} weekStart={weekStart} />
          ) : (
            <Card className="p-8 text-center"><p className="text-gray-400">Selecciona un trabajador arriba para ver su horario</p></Card>
          )}
        </div>
      ) : (
        // ─── Vista de equipo (tabla global) ───────────────────────────────
        <div className="border rounded-2xl overflow-x-auto bg-white shadow-sm">
          <table className="w-full text-xs min-w-[800px]">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left font-semibold text-gray-500 w-32 bg-gray-50 sticky left-0 border-r">Trabajador</th>
                {DAY_CODES.map((day, di) => {
                  const cov = currentSchedule.coverageByDay[day]
                  const isWeekend = day === 'sabado' || day === 'domingo' || day === 'viernes'
                  return (
                    <th key={day} className={`p-2 font-semibold border-r last:border-r-0 min-w-[90px] ${isWeekend ? 'bg-teal-50' : 'bg-gray-50'}`}>
                      <p className={isWeekend ? 'text-teal-700' : 'text-gray-600'}>{DAY_LABELS[day]}</p>
                      <p className="font-normal text-[9px] text-gray-400">{fmtDateShort(addDaysStr(weekStart, di))}</p>
                      <div className={`mt-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${cov?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {cov?.count || 0}/{cov?.min || 1} {cov?.ok ? '✓' : '!'}
                      </div>
                    </th>
                  )
                })}
                <th className="p-3 font-semibold text-gray-500 bg-gray-50 text-center w-20">Total</th>
              </tr>
            </thead>
            <tbody>
              {currentSchedule.workers.map(worker => (
                <tr key={worker.employeeId} className="border-b last:border-0 hover:bg-gray-50/50 group">
                  <td className="p-2.5 sticky left-0 bg-white border-r group-hover:bg-gray-50/50">
                    <button onClick={() => { setView('individual'); setSelectedWorker(worker.employeeId) }} className="text-left w-full hover:text-teal-600">
                      <p className="font-semibold truncate max-w-[110px]">{worker.employeeName}</p>
                      <p className="text-[9px] text-gray-400">{worker.position}</p>
                    </button>
                  </td>
                  {DAY_CODES.map(day => {
                    const shift = worker.days[day]
                    if (!shift) return <td key={day} className="p-1.5 border-r last:border-r-0" />
                    return (
                      <td key={day} className="p-1.5 border-r last:border-r-0 align-top">
                        {editMode ? (
                          <div className="space-y-0.5">
                            <button onClick={() => toggleLibre(worker.employeeId, day)}
                              className={`w-full text-[9px] px-1 py-0.5 rounded border mb-0.5 ${shift.libre ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-600'}`}>
                              {shift.libre ? '+ Asignar turno' : '× Poner libre'}
                            </button>
                            {!shift.libre && (
                              <ShiftCell
                                manana={shift.manana} tarde={shift.tarde} libre={false}
                                hours={shift.totalHours} editMode
                                onChangeManana={(s,e) => updateShift(worker.employeeId, day, 'manana', s, e)}
                                onChangeTarde={(s,e) => updateShift(worker.employeeId, day, 'tarde', s, e)}
                              />
                            )}
                          </div>
                        ) : (
                          <ShiftCell manana={shift.manana} tarde={shift.tarde} libre={shift.libre} notes={shift.notes} hours={shift.totalHours} />
                        )}
                      </td>
                    )
                  })}
                  <td className="p-2.5 text-center bg-gray-50/50">
                    <p className={`font-bold text-sm ${worker.totalHours > 40 ? 'text-red-600' : worker.totalHours >= 35 ? 'text-emerald-600' : 'text-gray-600'}`}>
                      {worker.totalHours.toFixed(1)}h
                    </p>
                    <p className={`text-[9px] mt-0.5 ${worker.restDays < 2 ? 'text-amber-500' : 'text-gray-400'}`}>{worker.restDays}d libre</p>
                    {worker.totalHours > 40 && <p className="text-[9px] text-red-500">⚠️</p>}
                  </td>
                </tr>
              ))}
              {/* Fila resumen: personal por turno mañana y noche */}
              <tr className="bg-amber-50 border-t-2 border-amber-200">
                <td className="p-2 sticky left-0 bg-amber-50 border-r text-[10px] font-bold text-amber-700">Mañana</td>
                {DAY_CODES.map(day => {
                  const count = currentSchedule.workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].manana).length
                  const min = MIN_STAFF[day].manana
                  return (
                    <td key={day} className="p-1 text-center border-r last:border-r-0">
                      <span className={`text-[10px] font-bold ${count >= min ? 'text-amber-700' : 'text-red-600'}`}>{count}</span>
                    </td>
                  )
                })}
                <td />
              </tr>
              <tr className="bg-violet-50">
                <td className="p-2 sticky left-0 bg-violet-50 border-r text-[10px] font-bold text-violet-700">Noche</td>
                {DAY_CODES.map(day => {
                  const count = currentSchedule.workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].tarde).length
                  const min = MIN_STAFF[day].tarde
                  return (
                    <td key={day} className="p-1 text-center border-r last:border-r-0">
                      <span className={`text-[10px] font-bold ${count >= min ? 'text-violet-700' : 'text-red-600'}`}>{count}</span>
                    </td>
                  )
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Leyenda */}
      {currentSchedule && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-500 items-center">
          <span className="bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">🟡 Mañana (mediodía)</span>
          <span className="bg-violet-100 border border-violet-200 px-2 py-0.5 rounded">🟣 Tarde/Noche</span>
          <span className="bg-gray-100 border px-2 py-0.5 rounded">LIBRE</span>
          <span className="ml-2 text-gray-400">· Haz clic en un trabajador para ver su horario individual</span>
        </div>
      )}

      {/* Modal Alertas */}
      <Modal open={showAlerts} onClose={() => setShowAlerts(false)} title={`Alertas (${currentSchedule?.alerts.length || 0})`} size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(currentSchedule?.alerts || []).map((alert: ScheduleAlert) => (
            <div key={alert.id} className={`p-3 rounded-xl border text-sm ${
              alert.severity === 'critical' ? 'bg-red-50 border-red-300 text-red-800' :
              alert.severity === 'error' ? 'bg-orange-50 border-orange-300 text-orange-800' :
              alert.severity === 'warning' ? 'bg-amber-50 border-amber-300 text-amber-800' :
              'bg-blue-50 border-blue-300 text-blue-800'}`}>
              <p className="font-medium">{alert.severity==='critical'?'🚨':alert.severity==='error'?'❌':alert.severity==='warning'?'⚠️':'ℹ️'} {alert.message}</p>
              {alert.suggestion && <p className="text-xs mt-1 opacity-75">💡 {alert.suggestion}</p>}
            </div>
          ))}
        </div>
        <Button onClick={() => setShowAlerts(false)} className="w-full mt-3">Cerrar</Button>
      </Modal>

      {/* Modal Ajustes */}
      <Modal open={showAdjustments} onClose={() => setShowAdjustments(false)} title="Ajustes automáticos" size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(currentSchedule?.adjustments || []).map((adj: string, i: number) => (
            <div key={i} className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800">📋 {adj}</div>
          ))}
        </div>
        <Button onClick={() => setShowAdjustments(false)} className="w-full mt-3">Cerrar</Button>
      </Modal>
    </div>
  )
}
