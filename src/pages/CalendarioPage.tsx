import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Modal, Alert } from '../components/ui'
import type { WeeklySchedulePlan } from '../types'
import ModificacionesPanel from './ModificacionesPanel'
import type { ScheduleModification } from '../services/scheduler'
import {
  generateSmartSchedule, createDefaultParams, buildScheduleFromManual, getBaseTemplate,
  DAY_CODES, DAY_LABELS, calcHours,
  type GeneratedSchedule, type ScheduleAlert, type DayCode, type WorkerWeek, type WeekParams, type DayParams, type DayShift, type ManualWorkerSchedule
} from '../services/scheduler'

// ─── Helpers de fecha ─────────────────────────────────────────────────────────
function getMondayStr(d: Date): string {
  const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(new Date(d).setDate(diff)).toISOString().slice(0, 10)
}
function addDaysStr(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
function fmtShort(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

// ─── Formulario de parámetros ─────────────────────────────────────────────────
function ParamsForm({ params, setParams, employees, onGenerate, loading }:
  { params: WeekParams; setParams: (p: WeekParams) => void; employees: ReturnType<typeof useApp>['staff']; onGenerate: () => void; loading: boolean }) {

  function updWorker(id: string, hours: number) {
    setParams({ ...params, workers: params.workers.map(w => w.employeeId === id ? { ...w, hoursAvailable: hours } : w) })
  }

  function toggleWorker(id: string) {
    const exists = params.workers.some(w => w.employeeId === id)
    if (exists) {
      setParams({ ...params, workers: params.workers.filter(w => w.employeeId !== id) })
    } else {
      const emp = employees.find(e => e.id === id)
      setParams({ ...params, workers: [...params.workers, { employeeId: id, hoursAvailable: emp?.weeklyHours || 40 }] })
    }
  }

  function updDay(day: DayCode, field: Partial<DayParams>) {
    setParams({ ...params, days: { ...params.days, [day]: { ...params.days[day], ...field } } })
  }

  function updDayTime(day: DayCode, turno: 'manana' | 'tarde', part: 'start' | 'end', val: string) {
    const cur = params.days[day]
    if (turno === 'manana') {
      const m = cur.manana ? { ...cur.manana, [part]: val } : { start: '13:00', end: '15:45', [part]: val }
      updDay(day, { manana: m })
    } else {
      const t = cur.tarde ? { ...cur.tarde, [part]: val } : { start: '19:00', end: '23:30', [part]: val }
      updDay(day, { tarde: t })
    }
  }

  const activeWorkers = employees.filter(e => e.active)

  return (
    <div className="space-y-6">
      {/* Bloque 1: Trabajadores */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center font-bold">1</div>
          <h3 className="font-semibold text-gray-800">Trabajadores disponibles esta semana</h3>
        </div>
        <div className="space-y-2">
          {activeWorkers.map(emp => {
            const wp = params.workers.find(w => w.employeeId === emp.id)
            const included = !!wp
            return (
              <div key={emp.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${included ? 'bg-white border-teal-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                <input type="checkbox" checked={included} onChange={() => toggleWorker(emp.id)} className="w-4 h-4 accent-teal-600 rounded shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{emp.name || '(Sin nombre)'}</p>
                  <p className="text-xs text-gray-400">{emp.position}</p>
                  {/* Alertar si tiene ausencias esta semana */}
                  {emp.vacations.some(v => v.status === 'aprobada') && (
                    <p className="text-xs text-amber-600">⚠️ Tiene ausencias registradas</p>
                  )}
                </div>
                {included && (
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-xs text-gray-500">Horas disponibles:</label>
                    <input
                      type="number" min={0} max={40} step={0.5}
                      value={wp.hoursAvailable}
                      onChange={e => updWorker(emp.id, parseFloat(e.target.value) || 0)}
                      className="w-16 border rounded-lg px-2 py-1.5 text-sm text-center font-semibold"
                    />
                    <span className="text-xs text-gray-400">h</span>
                  </div>
                )}
              </div>
            )
          })}
          {activeWorkers.length === 0 && (
            <Alert type="warning">No hay empleados activos. Añádelos en Personal primero.</Alert>
          )}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-gray-400">
          <span>Total trabajadores: <strong className="text-gray-600">{params.workers.length}</strong></span>
          <span>Total horas disponibles: <strong className="text-gray-600">{params.workers.reduce((s,w)=>s+w.hoursAvailable,0)}h</strong></span>
        </div>
      </div>

      {/* Bloque 2: Horario por día */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center font-bold">2</div>
          <h3 className="font-semibold text-gray-800">Horario propuesto por día</h3>
          <span className="text-xs text-gray-400">(modifica si hay cambios esta semana)</span>
        </div>
        <div className="space-y-2">
          {DAY_CODES.map(day => {
            const dp = params.days[day]
            const isWeekend = day === 'sabado' || day === 'domingo' || day === 'viernes'
            const mananaH = dp.manana && dp.open ? calcHours(dp.manana.start, dp.manana.end) : 0
            const tardeH = dp.tarde && dp.open ? calcHours(dp.tarde.start, dp.tarde.end) : 0
            return (
              <div key={day} className={`rounded-xl border transition-all ${dp.open ? (isWeekend ? 'bg-teal-50 border-teal-200' : 'bg-white border-gray-200') : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                <div className="flex items-center gap-3 p-3">
                  {/* Toggle abierto/cerrado */}
                  <input type="checkbox" checked={dp.open} onChange={e => updDay(day, { open: e.target.checked })} className="w-4 h-4 accent-teal-600 rounded shrink-0" />
                  <div className="w-24 shrink-0">
                    <p className={`font-semibold text-sm ${isWeekend ? 'text-teal-700' : ''}`}>{DAY_LABELS[day]}</p>
                    {dp.open && <p className="text-[10px] text-gray-400">{(mananaH + tardeH).toFixed(1)}h/día</p>}
                    {!dp.open && <p className="text-[10px] text-gray-400">Cerrado</p>}
                  </div>

                  {dp.open && (
                    <div className="flex flex-wrap gap-3 flex-1">
                      {/* Mañana */}
                      <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <span className="text-[10px] text-amber-600 font-semibold w-12">Mediodía</span>
                        <input type="time" value={dp.manana?.start || ''} onChange={e => updDayTime(day, 'manana', 'start', e.target.value)} className="text-xs border rounded px-1.5 py-1 bg-white w-24" />
                        <span className="text-gray-300 text-xs">–</span>
                        <input type="time" value={dp.manana?.end || ''} onChange={e => updDayTime(day, 'manana', 'end', e.target.value)} className="text-xs border rounded px-1.5 py-1 bg-white w-24" />
                        {mananaH > 0 && <span className="text-[10px] text-amber-500">{mananaH.toFixed(1)}h</span>}
                        <button onClick={() => updDay(day, { manana: undefined })} className="text-gray-300 hover:text-red-400 text-xs" title="Sin turno de mediodía">×</button>
                      </div>

                      {/* Noche */}
                      <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5">
                        <span className="text-[10px] text-violet-600 font-semibold w-12">Noche</span>
                        <input type="time" value={dp.tarde?.start || ''} onChange={e => updDayTime(day, 'tarde', 'start', e.target.value)} className="text-xs border rounded px-1.5 py-1 bg-white w-24" />
                        <span className="text-gray-300 text-xs">–</span>
                        <input type="time" value={dp.tarde?.end || ''} onChange={e => updDayTime(day, 'tarde', 'end', e.target.value)} className="text-xs border rounded px-1.5 py-1 bg-white w-24" />
                        {tardeH > 0 && <span className="text-[10px] text-violet-500">{tardeH.toFixed(1)}h</span>}
                      </div>

                      {/* Mínimo */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">Mín:</span>
                        <input type="number" min={1} max={10} value={dp.minNoche} onChange={e => updDay(day, { minNoche: parseInt(e.target.value) || 1 })} className="w-12 border rounded px-1.5 py-1 text-xs text-center" />
                        <span className="text-xs text-gray-400">pers.</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bloque 3: Notas */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center font-bold">3</div>
          <h3 className="font-semibold text-gray-800">Notas de la semana</h3>
          <span className="text-xs text-gray-400">(opcional)</span>
        </div>
        <textarea
          value={params.notes || ''} onChange={e => setParams({ ...params, notes: e.target.value })}
          rows={2} placeholder="Ej: semana de Navidad, evento especial el sábado, etc."
          className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {/* Resumen y botón generar */}
      <div className="bg-gray-50 rounded-2xl border p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resumen de parámetros</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-teal-600">{params.workers.length}</p>
            <p className="text-xs text-gray-500">trabajadores</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-teal-600">{params.workers.reduce((s,w)=>s+w.hoursAvailable,0)}</p>
            <p className="text-xs text-gray-500">horas disponibles</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-teal-600">{Object.values(params.days).filter(d=>d.open).length}</p>
            <p className="text-xs text-gray-500">días abiertos</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-teal-600">{Object.values(params.days).filter(d=>d.open).reduce((s,d)=>{
              const m = d.manana ? calcHours(d.manana.start, d.manana.end) : 0
              const t = d.tarde ? calcHours(d.tarde.start, d.tarde.end) : 0
              return s + m + t
            }, 0).toFixed(0)}</p>
            <p className="text-xs text-gray-500">h/sem a cubrir</p>
          </div>
        </div>
        <Alert type="info">
          Si falta personal, el sistema adelantará 30 min el cierre de noche, o cerrará el lunes completo — sin otras reducciones.
        </Alert>
        <Button onClick={onGenerate} disabled={loading || params.workers.length === 0} className="w-full">
          {loading ? '⚙️ Generando...' : '⚡ Generar horario con estos parámetros'}
        </Button>
      </div>
    </div>
  )
}

// ─── Celda de turno ───────────────────────────────────────────────────────────
function ShiftCell({ shift, editMode, onToggleLibre, onChangeManana, onChangeTarde }:
  { shift: DayShift; editMode?: boolean; onToggleLibre?: () => void
    onChangeManana?: (s: string, e: string) => void; onChangeTarde?: (s: string, e: string) => void }) {

  if (shift.libre) return (
    <div className="min-h-[56px] flex flex-col items-center justify-center">
      <span className="text-[9px] text-gray-300 font-medium uppercase">{shift.notes || 'Libre'}</span>
      {editMode && <button onClick={onToggleLibre} className="text-[9px] text-teal-600 mt-0.5 hover:underline">+ turno</button>}
    </div>
  )

  return (
    <div className="space-y-0.5 min-h-[56px] py-0.5">
      {shift.manana && (
        editMode ? (
          <div className="flex gap-0.5">
            <input type="time" value={shift.manana.start} onChange={e => onChangeManana?.(e.target.value, shift.manana!.end)} className="w-[52px] text-[8px] border rounded px-0.5 py-0.5 bg-amber-50" />
            <input type="time" value={shift.manana.end} onChange={e => onChangeManana?.(shift.manana!.start, e.target.value)} className="w-[52px] text-[8px] border rounded px-0.5 py-0.5 bg-amber-50" />
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded px-1 py-0.5 text-center">
            <p className="text-[9px] font-bold text-amber-800 leading-tight">{shift.manana.start}</p>
            <p className="text-[9px] text-amber-500 leading-tight">{shift.manana.end}</p>
          </div>
        )
      )}
      {shift.tarde && (
        editMode ? (
          <div className="flex gap-0.5">
            <input type="time" value={shift.tarde.start} onChange={e => onChangeTarde?.(e.target.value, shift.tarde!.end)} className="w-[52px] text-[8px] border rounded px-0.5 py-0.5 bg-violet-50" />
            <input type="time" value={shift.tarde.end} onChange={e => onChangeTarde?.(shift.tarde!.start, e.target.value)} className="w-[52px] text-[8px] border rounded px-0.5 py-0.5 bg-violet-50" />
          </div>
        ) : (
          <div className="bg-violet-50 border border-violet-200 rounded px-1 py-0.5 text-center">
            <p className="text-[9px] font-bold text-violet-800 leading-tight">{shift.tarde.start}</p>
            <p className="text-[9px] text-violet-500 leading-tight">{shift.tarde.end}</p>
          </div>
        )
      )}
      {!editMode && shift.totalHours > 0 && (
        <p className="text-[8px] text-gray-400 text-center">{shift.totalHours.toFixed(1)}h</p>
      )}
      {editMode && <button onClick={onToggleLibre} className="text-[8px] text-gray-300 hover:text-red-400 w-full text-center">× libre</button>}
    </div>
  )
}

// ─── Vista individual ─────────────────────────────────────────────────────────
function WorkerView({ worker, weekStart }: { worker: WorkerWeek; weekStart: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-2xl border border-teal-200">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-white font-bold text-lg">
          {worker.employeeName[0]?.toUpperCase() || '?'}
        </div>
        <div>
          <p className="font-semibold">{worker.employeeName}</p>
          <p className="text-sm text-gray-500">{worker.position}</p>
          <p className="text-xs text-gray-400 mt-0.5">{worker.totalHours.toFixed(1)}h esta semana · {worker.restDays} día{worker.restDays !== 1 ? 's' : ''} libre{worker.restDays !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div className="space-y-2">
        {DAY_CODES.map((day, di) => {
          const shift = worker.days[day]
          if (!shift) return null
          return (
            <div key={day} className={`flex items-start gap-3 p-3 rounded-xl border ${shift.libre ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>
              <div className="w-24 shrink-0">
                <p className={`font-semibold text-sm ${shift.libre ? 'text-gray-400' : 'text-gray-800'}`}>{DAY_LABELS[day]}</p>
                <p className="text-xs text-gray-400">{fmtShort(addDaysStr(weekStart, di))}</p>
              </div>
              {shift.libre ? (
                <span className="text-sm text-gray-400 pt-0.5">{shift.notes || 'Día libre 😊'}</span>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {shift.manana && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center min-w-[90px]">
                      <p className="text-[10px] text-amber-500 font-semibold">Mediodía</p>
                      <p className="text-sm font-bold text-amber-800">{shift.manana.start} – {shift.manana.end}</p>
                      <p className="text-xs text-amber-400">{calcHours(shift.manana.start, shift.manana.end).toFixed(1)}h</p>
                    </div>
                  )}
                  {shift.tarde && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-center min-w-[90px]">
                      <p className="text-[10px] text-violet-500 font-semibold">Noche</p>
                      <p className="text-sm font-bold text-violet-800">{shift.tarde.start} – {shift.tarde.end}</p>
                      <p className="text-xs text-violet-400">{calcHours(shift.tarde.start, shift.tarde.end).toFixed(1)}h</p>
                    </div>
                  )}
                  <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-center min-w-[60px]">
                    <p className="text-[10px] text-gray-400">Total</p>
                    <p className="text-sm font-bold text-gray-700">{shift.totalHours.toFixed(1)}h</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border text-sm">
        <div className="text-center">
          <p className={`text-2xl font-bold ${worker.totalHours > 40 ? 'text-red-600' : 'text-emerald-600'}`}>{worker.totalHours.toFixed(1)}h</p>
          <p className="text-xs text-gray-400">Total semana</p>
        </div>
        <div className="text-center">
          <p className={`text-2xl font-bold ${worker.restDays < 2 ? 'text-amber-500' : 'text-emerald-600'}`}>{worker.restDays}</p>
          <p className="text-xs text-gray-400">Días libres</p>
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

// Wrapper: fuente única de verdad en getBaseTemplate() del scheduler
function buildExcelSchedule(emps: ReturnType<typeof useApp>['staff']): ManualWorkerSchedule[] | null {
  if (emps.length < 1) return null
  return getBaseTemplate(emps)
}

export default function CalendarioPage() {
  const { staff, locations, schedules, setSchedules } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [weekStart, setWeekStart] = useState(() => getMondayStr(new Date()))
  const [step, setStep] = useState<'params' | 'schedule'>('params')
  const [params, setParams] = useState<WeekParams>(() => createDefaultParams(staff.filter(e => e.active && e.locationId === locations[0]?.id)))
  const [editMode, setEditMode] = useState(false)
  const [view, setView] = useState<'equipo' | 'individual'>('equipo')
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showAdjustments, setShowAdjustments] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [currentSchedule, setCurrentSchedule] = useState<GeneratedSchedule | null>(null)
  const [modifications, setModifications] = useState<ScheduleModification[]>([])
  const [scheduleTab, setScheduleTab] = useState<'horario' | 'modificaciones'>('horario')

  const locEmployees = staff.filter(e => e.active && e.locationId === locId)
  type SavedPlan = WeeklySchedulePlan & { generatedData?: GeneratedSchedule; params?: WeekParams; modifications?: ScheduleModification[] }
  const existingSchedule = schedules.find(s => s.locationId === locId && s.weekStart === weekStart) as SavedPlan | undefined

  // Recargar al cambiar semana/local
  useEffect(() => {
    const newParams = existingSchedule?.params || createDefaultParams(staff.filter(e => e.active && e.locationId === locId))
    setParams(newParams)
    if (existingSchedule?.generatedData) {
      setCurrentSchedule(existingSchedule.generatedData)
      setStep('schedule')
    } else {
      setCurrentSchedule(null)
      setStep('params')
    }
    setEditMode(false)
    setSelectedWorker(null)
    setModifications((existingSchedule as any)?.modifications || [])
  }, [locId, weekStart])

  // Sincronizar empleados del local cuando cambia locId
  useEffect(() => {
    if (!existingSchedule) {
      setParams(createDefaultParams(staff.filter(e => e.active && e.locationId === locId)))
    }
  }, [locId, staff.length])

  function handleGenerate() {
    setGenerating(true)
    setTimeout(() => {
      const result = generateSmartSchedule(locEmployees, weekStart, params)
      setCurrentSchedule(result)
      setStep('schedule')
      setGenerating(false)
      if (result.alerts.filter(a => a.severity === 'critical' || a.severity === 'error').length > 0) {
        setShowAlerts(true)
      }
    }, 300)
  }

  function handleSave() {
    if (!currentSchedule) return
    const plan: SavedPlan = {
      id: existingSchedule?.id || `sched-${Date.now()}`,
      locationId: locId, weekStart, days: [], published: false,
      createdAt: existingSchedule?.createdAt || new Date().toISOString(),
      generatedData: currentSchedule, params,
      modifications,
    }
    setSchedules(prev => [...prev.filter(s => !(s.locationId === locId && s.weekStart === weekStart)), plan as WeeklySchedulePlan])
    setEditMode(false)
  }

  function loadTemplate() {
    const manual = buildExcelSchedule(locEmployees)
    if (!manual || manual.length === 0) { alert('Necesitas al menos 1 empleado activo en este local'); return }
    const result = buildScheduleFromManual(locEmployees, manual)
    setCurrentSchedule(result)
    setModifications([])
    setStep('schedule')
    setEditMode(false)
  }

  function updateShift(empId: string, day: DayCode, part: 'manana' | 'tarde', start: string, end: string) {
    setCurrentSchedule(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workers: prev.workers.map(w => {
          if (w.employeeId !== empId) return w
          const ds = { ...w.days[day] }
          if (part === 'manana') ds.manana = { start, end }
          else ds.tarde = { start, end }
          ds.totalHours = (ds.manana ? calcHours(ds.manana.start, ds.manana.end) : 0) + (ds.tarde ? calcHours(ds.tarde.start, ds.tarde.end) : 0)
          const newDays = { ...w.days, [day]: ds }
          const total = Object.values(newDays).reduce((s, d) => s + d.totalHours, 0)
          return { ...w, days: newDays, totalHours: total }
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
          const dp = params.days[day]
          if (cur.libre) {
            const m = dp.manana ? calcHours(dp.manana.start, dp.manana.end) : 0
            const t = dp.tarde ? calcHours(dp.tarde.start, dp.tarde.end) : 0
            const newDays = { ...w.days, [day]: { manana: dp.manana, tarde: dp.tarde, libre: false, totalHours: m + t } }
            return { ...w, days: newDays, totalHours: Object.values(newDays).reduce((s,d)=>s+d.totalHours,0), restDays: w.restDays - 1 }
          } else {
            const newDays = { ...w.days, [day]: { libre: true, totalHours: 0 } }
            return { ...w, days: newDays, totalHours: Object.values(newDays).reduce((s,d)=>s+d.totalHours,0), restDays: w.restDays + 1 }
          }
        })
      }
    })
  }

  const alertCounts = useMemo(() => ({
    critical: currentSchedule?.alerts.filter(a => a.severity === 'critical').length || 0,
    error: currentSchedule?.alerts.filter(a => a.severity === 'error').length || 0,
    warning: currentSchedule?.alerts.filter(a => a.severity === 'warning').length || 0,
  }), [currentSchedule])

  const weekLabel = (() => {
    const f = new Date(weekStart + 'T12:00:00')
    const t = new Date(weekStart + 'T12:00:00'); t.setDate(t.getDate() + 6)
    return `${f.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`
  })()

  const selectedWorkerData = currentSchedule?.workers.find(w => w.employeeId === selectedWorker)

  return (
    <div className="space-y-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Calendario de Horarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Convenio hostelería · Máx. 40h · 1.5 días descanso mínimo</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {step === 'schedule' && currentSchedule && (alertCounts.critical + alertCounts.error + alertCounts.warning) > 0 && (
            <button onClick={() => setShowAlerts(true)} className={`text-xs px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1 ${alertCounts.critical > 0 ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : alertCounts.error > 0 ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
              {alertCounts.critical > 0 ? '🚨' : alertCounts.error > 0 ? '❌' : '⚠️'} {alertCounts.critical + alertCounts.error + alertCounts.warning} alertas
            </button>
          )}
          {step === 'schedule' && currentSchedule?.adjustments && currentSchedule.adjustments.length > 0 && (
            <button onClick={() => setShowAdjustments(true)} className="text-xs px-3 py-1.5 rounded-lg border bg-blue-50 border-blue-300 text-blue-700 font-medium">
              📋 {currentSchedule.adjustments.length} ajuste{currentSchedule.adjustments.length > 1 ? 's' : ''}
            </button>
          )}
          {step === 'schedule' && (
            <>
              {editMode ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => { setEditMode(false); if (existingSchedule?.generatedData) setCurrentSchedule(existingSchedule.generatedData) }}>Descartar</Button>
                  <Button size="sm" onClick={handleSave}>💾 Guardar</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>✏️ Editar</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setStep('params')}>← Parámetros</Button>
              <Button size="sm" variant="outline" onClick={() => {
                if (confirm('¿Restaurar el horario base oficial? Se perderán los cambios de esta semana.')) {
                  loadTemplate(); setModifications([])
                }
              }} className="border-emerald-400 text-emerald-700 hover:bg-emerald-50 font-semibold" title="Volver al horario oficial del local">
                🔒 Restaurar base
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Navegación de semana y local */}
      <div className="flex flex-wrap gap-3 items-center p-3 bg-gray-50 rounded-2xl border">
        <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
          <option value="">Selecciona local...</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => { const d=new Date(weekStart+'T12:00:00'); d.setDate(d.getDate()-7); setWeekStart(d.toISOString().slice(0,10)) }}>‹</Button>
          <span className="text-sm font-medium px-2 min-w-[220px] text-center">{weekLabel}</span>
          <Button size="sm" variant="ghost" onClick={() => { const d=new Date(weekStart+'T12:00:00'); d.setDate(d.getDate()+7); setWeekStart(d.toISOString().slice(0,10)) }}>›</Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setWeekStart(getMondayStr(new Date()))} className="text-teal-600">Hoy</Button>
        <div className="ml-auto flex gap-1 bg-white border rounded-lg p-1">
          <button onClick={() => setStep('params')} className={`text-xs px-3 py-1.5 rounded font-medium transition-all ${step==='params' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            📋 Parámetros
          </button>
          <button onClick={() => step==='schedule' && setStep('schedule')} disabled={!currentSchedule}
            className={`text-xs px-3 py-1.5 rounded font-medium transition-all ${step==='schedule' ? 'bg-teal-600 text-white' : currentSchedule ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'}`}>
            📅 Horario
          </button>
        </div>
      </div>

      {/* Sin local */}
      {locations.length === 0 ? (
        <Alert type="warning">Crea un local en Configuración → Locales antes de generar horarios</Alert>
      ) : !locId ? (
        <Alert type="info">Selecciona un local para continuar</Alert>
      ) : step === 'params' ? (
        // ─── Paso 1: Parámetros ────────────────────────────────────────────
        <div className="space-y-4">
          {/* Banner horario base — inmutable */}
          <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-2xl">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="font-bold text-emerald-800 flex items-center gap-2 text-sm">
                  🔒 Horario base oficial del local
                </p>
                <p className="text-xs text-emerald-700 mt-1">
                  Plantilla verificada e inmutable. Pulsa para cargarla como punto de partida de la semana.
                </p>
                {locEmployees.length >= 1 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {locEmployees.slice(0,3).map((e,i) => (
                      <span key={e.id} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                        T{i+1}: {e.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={loadTemplate} disabled={locEmployees.length < 1} className="shrink-0">
                🔒 Cargar horario base
              </Button>
            </div>
          </div>
          <Card className="p-6">
            <ParamsForm params={params} setParams={setParams} employees={locEmployees} onGenerate={handleGenerate} loading={generating} />
          </Card>
        </div>
      ) : !currentSchedule ? (
        <Card className="p-10 text-center">
          <Button onClick={() => setStep('params')}>← Volver a parámetros</Button>
        </Card>
      ) : (
        // ─── Paso 2: Horario generado ──────────────────────────────────────
        <div className="space-y-4">
          {/* Switcher equipo/individual */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-1 bg-white border rounded-lg p-1">
              <button onClick={() => setScheduleTab('horario')} className={`text-xs px-3 py-2 rounded font-medium ${scheduleTab==='horario' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>📅 Horario</button>
              <button onClick={() => setScheduleTab('modificaciones')} className={`text-xs px-3 py-2 rounded font-medium flex items-center gap-1 ${scheduleTab==='modificaciones' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                🔧 Modificaciones {modifications.length > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${scheduleTab==='modificaciones' ? 'bg-white/30' : 'bg-amber-500 text-white'}`}>{modifications.length}</span>}
              </button>
            </div>
            {scheduleTab === 'horario' && (
            <div className="flex gap-1 bg-white border rounded-lg p-1">
              <button onClick={() => setView('equipo')} className={`text-xs px-4 py-2 rounded font-medium ${view==='equipo' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>👥 Equipo</button>
              <button onClick={() => setView('individual')} className={`text-xs px-4 py-2 rounded font-medium ${view==='individual' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>👤 Individual</button>
            </div>
            )}
            {params.notes && (
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">📝 {params.notes}</p>
            )}
          </div>

          {view === 'individual' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {currentSchedule.workers.map(w => (
                  <button key={w.employeeId} onClick={() => setSelectedWorker(w.employeeId === selectedWorker ? null : w.employeeId)}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${selectedWorker === w.employeeId ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                    {w.employeeName}
                    <span className={`ml-2 text-xs ${w.totalHours > 40 ? 'text-red-400' : 'opacity-60'}`}>{w.totalHours.toFixed(0)}h</span>
                  </button>
                ))}
              </div>
              {selectedWorkerData ? (
                <WorkerView worker={selectedWorkerData} weekStart={weekStart} />
              ) : (
                <Card className="p-8 text-center"><p className="text-gray-400">Selecciona un trabajador para ver su horario</p></Card>
              )}
            </div>
          ) : (
            // Vista equipo — tabla global
            <div className="border rounded-2xl overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-xs min-w-[800px]">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="p-3 text-left font-semibold text-gray-500 w-32 sticky left-0 bg-gray-50 border-r">Trabajador</th>
                    {DAY_CODES.map((day, di) => {
                      const cov = currentSchedule.coverageByDay[day]
                      const dp = params.days[day]
                      const isWeekend = day === 'sabado' || day === 'domingo' || day === 'viernes'
                      return (
                        <th key={day} className={`p-2 font-semibold border-r last:border-r-0 min-w-[95px] ${isWeekend ? 'bg-teal-50' : 'bg-gray-50'} ${!dp.open ? 'opacity-50' : ''}`}>
                          <p className={isWeekend ? 'text-teal-700' : 'text-gray-600'}>{DAY_LABELS[day]}</p>
                          <p className="text-[9px] font-normal text-gray-400">{fmtShort(addDaysStr(weekStart, di))}</p>
                          {dp.open ? (
                            <span className={`mt-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${cov?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {cov?.noche || 0}/{cov?.minNoche || 0} {cov?.ok ? '✓' : '!'}
                            </span>
                          ) : (
                            <span className="mt-1 inline-flex text-[9px] text-gray-400">Cerrado</span>
                          )}
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
                        <button onClick={() => { setView('individual'); setSelectedWorker(worker.employeeId) }} className="text-left w-full hover:text-teal-600 transition-colors">
                          <p className="font-semibold truncate max-w-[110px]">{worker.employeeName}</p>
                          <p className="text-[9px] text-gray-400">{worker.position}</p>
                        </button>
                      </td>
                      {DAY_CODES.map(day => {
                        const shift = worker.days[day]
                        if (!shift) return <td key={day} className="p-1.5 border-r last:border-r-0" />
                        return (
                          <td key={day} className={`p-1.5 border-r last:border-r-0 align-top ${!params.days[day].open ? 'bg-gray-50' : ''}`}>
                            <ShiftCell
                              shift={shift} editMode={editMode}
                              onToggleLibre={() => toggleLibre(worker.employeeId, day)}
                              onChangeManana={(s, e) => updateShift(worker.employeeId, day, 'manana', s, e)}
                              onChangeTarde={(s, e) => updateShift(worker.employeeId, day, 'tarde', s, e)}
                            />
                          </td>
                        )
                      })}
                      <td className="p-2.5 text-center bg-gray-50/50 border-l">
                        <p className={`font-bold text-sm ${worker.totalHours > 40 ? 'text-red-600' : worker.totalHours >= 35 ? 'text-emerald-600' : 'text-gray-600'}`}>{worker.totalHours.toFixed(1)}h</p>
                        <p className={`text-[9px] mt-0.5 ${worker.restDays < 2 ? 'text-amber-500' : 'text-gray-400'}`}>{worker.restDays}d libre</p>
                      </td>
                    </tr>
                  ))}
                  {/* Filas de cobertura */}
                  {(['manana','tarde'] as const).map(turno => (
                    <tr key={turno} className={`border-t ${turno==='manana' ? 'bg-amber-50' : 'bg-violet-50'}`}>
                      <td className={`p-2 sticky left-0 border-r text-[10px] font-bold ${turno==='manana' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'}`}>
                        {turno==='manana' ? '☀️ Mediodía' : '🌙 Noche'}
                      </td>
                      {DAY_CODES.map(day => {
                        const count = currentSchedule.workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day][turno]).length
                        const dp = params.days[day]
                        return (
                          <td key={day} className={`p-1.5 text-center border-r last:border-r-0 ${!dp.open ? 'opacity-30' : ''}`}>
                            {dp.open && <span className={`text-[10px] font-bold ${count >= 1 ? (turno==='manana'?'text-amber-700':'text-violet-700') : 'text-red-500'}`}>{count}</span>}
                          </td>
                        )
                      })}
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {scheduleTab === 'modificaciones' && (
            <ModificacionesPanel
              locationId={locId}
              weekStart={weekStart}
              existingMods={modifications}
              onApply={(result, mods) => {
                setCurrentSchedule(result)
                setModifications(mods)
                setScheduleTab('horario')
              }}
            />
          )}

          {/* Leyenda */}
          {scheduleTab === 'horario' && <div className="flex flex-wrap gap-2 text-[10px] text-gray-400 items-center">
            <span className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-amber-600">☀️ Mediodía</span>
            <span className="bg-violet-50 border border-violet-200 px-2 py-0.5 rounded text-violet-600">🌙 Noche</span>
            <span className="bg-gray-100 border px-2 py-0.5 rounded">Libre</span>
            <span className="ml-2">· Clic en nombre → ver horario individual</span>
            {editMode && <span className="text-teal-600 font-medium">· Modo edición activo</span>}
          </div>}
        </div>
      )}

      {/* Modal Alertas */}
      <Modal open={showAlerts} onClose={() => setShowAlerts(false)} title={`Alertas del horario (${currentSchedule?.alerts.length || 0})`} size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(currentSchedule?.alerts || []).map((alert: ScheduleAlert) => (
            <div key={alert.id} className={`p-3 rounded-xl border text-sm ${alert.severity==='critical'?'bg-red-50 border-red-300 text-red-800':alert.severity==='error'?'bg-orange-50 border-orange-300 text-orange-800':alert.severity==='warning'?'bg-amber-50 border-amber-300 text-amber-800':'bg-blue-50 border-blue-300 text-blue-800'}`}>
              <p className="font-medium">{alert.severity==='critical'?'🚨':alert.severity==='error'?'❌':'⚠️'} {alert.message}</p>
              {alert.suggestion && <p className="text-xs mt-1 opacity-75">💡 {alert.suggestion}</p>}
            </div>
          ))}
        </div>
        <Button onClick={() => setShowAlerts(false)} className="w-full mt-3">Cerrar</Button>
      </Modal>

      {/* Modal Ajustes */}
      <Modal open={showAdjustments} onClose={() => setShowAdjustments(false)} title="Ajustes automáticos aplicados" size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(currentSchedule?.adjustments || []).map((adj: string, i: number) => (
            <div key={i} className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800">📋 {adj}</div>
          ))}
          {(!currentSchedule?.adjustments || currentSchedule.adjustments.length === 0) && (
            <p className="text-center text-gray-400 py-4">Sin ajustes necesarios — horario óptimo</p>
          )}
        </div>
        <Button onClick={() => setShowAdjustments(false)} className="w-full mt-3">Cerrar</Button>
      </Modal>
    </div>
  )
}
