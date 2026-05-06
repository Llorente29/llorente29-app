import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Modal, Label, Alert } from '../components/ui'
import type { WeeklySchedulePlan, ScheduleDay, Shift, ShiftType, Employee } from '../types'

// ─── Reglas del negocio ────────────────────────────────────────────────────────
// Horarios del local:
//   L-J: 12:30-16:00 y 20:00-23:30 (partido)
//   V-S-D: 12:30-00:15 (tarde/noche continuo)
// Mínimos de personal:
//   L-V mañana (12:30-16:00): 1 trabajador
//   S-D 14:00-16:00: mínimo 2
//   S-D 20:00-cierre: mínimo 3
//   V-S-D tarde/noche: 2 trabajadores
// Descansos: 1,5 días por semana, preferiblemente seguidos
// Máximo 40h/semana

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const DAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

interface ShiftDef {
  type: ShiftType
  label: string
  start: string
  end: string
  hours: number
  days: number[]  // 0=lun, 1=mar, ..., 6=dom
  color: string
  minStaff: number
}

const SHIFT_DEFS: ShiftDef[] = [
  { type: 'manana',     label: 'Mañana',       start: '12:30', end: '16:00', hours: 3.5,  days: [0,1,2,3,4],   color: 'bg-amber-100 text-amber-800 border-amber-200',  minStaff: 1 },
  { type: 'partido',    label: 'Partido',      start: '12:30', end: '23:30', hours: 7.5,  days: [0,1,2,3],     color: 'bg-blue-100 text-blue-800 border-blue-200',     minStaff: 1 },
  { type: 'tarde_noche',label: 'Tarde/Noche',  start: '12:30', end: '00:15', hours: 11.75,days: [4,5,6],       color: 'bg-violet-100 text-violet-800 border-violet-200',minStaff: 2 },
  { type: 'libre',      label: 'Libre',        start: '',      end: '',      hours: 0,    days: [0,1,2,3,4,5,6],color: 'bg-gray-100 text-gray-500 border-gray-200',     minStaff: 0 },
]

function getShiftDef(type: ShiftType): ShiftDef {
  return SHIFT_DEFS.find(s => s.type === type) || SHIFT_DEFS[3]
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ─── Motor de generación automática ───────────────────────────────────────────
function generateSchedule(employees: Employee[], weekStart: Date, locationId: string): ScheduleDay[] {
  const active = employees.filter(e => e.active && e.locationId === locationId)
  if (active.length === 0) return []

  const days: ScheduleDay[] = []
  const weeklyHours: Record<string, number> = {}
  const restDays: Record<string, number> = {}

  active.forEach(e => { weeklyHours[e.id] = 0; restDays[e.id] = 0 })

  for (let di = 0; di < 7; di++) {
    const date = fmtDate(addDays(weekStart, di))
    const shifts: Shift[] = []
    const isWeekend = di >= 5  // sábado=5, domingo=6
    const isFridayOrWeekend = di >= 4  // viernes=4 en adelante

    // Determinar qué tipo de turno va en este día
    const availableEmployees = active.filter(e => {
      // No superar 40h/semana
      const shiftHours = isFridayOrWeekend ? SHIFT_DEFS[2].hours : SHIFT_DEFS[1].hours
      return weeklyHours[e.id] + shiftHours <= 40
    })

    // Empleados que necesitan descanso (ya tienen 1.5 días, ≥2 days contando medios)
    const needRest = active.filter(e => restDays[e.id] >= 2)
    const canWork = availableEmployees.filter(e => !needRest.includes(e) || restDays[e.id] < 1)

    // Asignar turnos según reglas
    if (isWeekend) {
      // Sábado/Domingo: mínimo 2 en tarde/noche, 3 en noche fin de semana
      const needed = di === 6 ? 3 : 2  // domingo 3, sábado 2
      const workers = canWork.slice(0, Math.max(needed, Math.min(canWork.length, needed + 1)))
      const resting = active.filter(e => !workers.includes(e))

      workers.forEach(e => {
        const sh = SHIFT_DEFS[2]
        shifts.push({ employeeId: e.id, type: 'tarde_noche', start: sh.start, end: sh.end, hours: sh.hours })
        weeklyHours[e.id] += sh.hours
      })
      resting.forEach(e => {
        shifts.push({ employeeId: e.id, type: 'libre', start: '', end: '', hours: 0 })
        restDays[e.id] += 1
      })
    } else if (di === 4) {
      // Viernes: tarde/noche, mínimo 2
      const needed = 2
      const workers = canWork.slice(0, Math.max(needed, Math.min(canWork.length, needed + 1)))
      const resting = active.filter(e => !workers.includes(e))

      workers.forEach(e => {
        const sh = SHIFT_DEFS[2]
        shifts.push({ employeeId: e.id, type: 'tarde_noche', start: sh.start, end: sh.end, hours: sh.hours })
        weeklyHours[e.id] += sh.hours
      })
      resting.forEach(e => {
        shifts.push({ employeeId: e.id, type: 'libre', start: '', end: '', hours: 0 })
        restDays[e.id] += 1
      })
    } else {
      // Lunes-Jueves: turno partido, 1 mínimo en mañana
      // Dar descanso a quien más horas lleva o quien cumple los 1.5 días
      const restCandidates = active.filter(e => restDays[e.id] >= 1).slice(0, Math.floor(active.length / 3))
      const workers = active.filter(e => !restCandidates.includes(e) && weeklyHours[e.id] + SHIFT_DEFS[1].hours <= 40)
      const resting = restCandidates

      // Asegurar mínimo 1 trabajador
      if (workers.length === 0 && active.length > 0) {
        const fallback = active.sort((a, b) => weeklyHours[a.id] - weeklyHours[b.id])[0]
        const sh = SHIFT_DEFS[0]  // solo mañana si están al límite
        shifts.push({ employeeId: fallback.id, type: 'manana', start: sh.start, end: sh.end, hours: sh.hours })
        weeklyHours[fallback.id] += sh.hours
        active.filter(e => e.id !== fallback.id).forEach(e => {
          shifts.push({ employeeId: e.id, type: 'libre', start: '', end: '', hours: 0 })
          restDays[e.id] += 1
        })
      } else {
        workers.forEach(e => {
          const sh = SHIFT_DEFS[1]  // partido
          shifts.push({ employeeId: e.id, type: 'partido', start: sh.start, end: sh.end, hours: sh.hours })
          weeklyHours[e.id] += sh.hours
        })
        resting.forEach(e => {
          shifts.push({ employeeId: e.id, type: 'libre', start: '', end: '', hours: 0 })
          restDays[e.id] += 1
        })
      }
    }

    days.push({ date, shifts })
  }

  return days
}

// ─── Componente principal ──────────────────────────────────────────────────────
export default function CalendarioPage() {
  const { staff, locations, schedules, setSchedules } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [weekStart, setWeekStart] = useState(() => fmtDate(getMondayOfWeek(new Date())))
  const [editMode, setEditMode] = useState(false)
  const [showValidation, setShowValidation] = useState(false)

  const locEmployees = staff.filter(e => e.active && e.locationId === locId)

  // Find existing schedule for this week+location
  const existingSchedule = schedules.find(s => s.locationId === locId && s.weekStart === weekStart)
  const [currentDays, setCurrentDays] = useState<ScheduleDay[]>(existingSchedule?.days || [])

  // Sync when week/loc changes
  useMemo(() => {
    const s = schedules.find(s => s.locationId === locId && s.weekStart === weekStart)
    setCurrentDays(s?.days || [])
    setEditMode(false)
  }, [locId, weekStart, schedules])

  function generateAuto() {
    const monday = new Date(weekStart + 'T12:00:00')
    const days = generateSchedule(locEmployees, monday, locId)
    setCurrentDays(days)
    setEditMode(true)
  }

  function saveSchedule() {
    const plan: WeeklySchedulePlan = {
      id: existingSchedule?.id || `sched-${Date.now()}`,
      locationId: locId,
      weekStart,
      days: currentDays,
      published: false,
      createdAt: existingSchedule?.createdAt || new Date().toISOString(),
    }
    setSchedules(prev => {
      const filtered = prev.filter(s => !(s.locationId === locId && s.weekStart === weekStart))
      return [...filtered, plan]
    })
    setEditMode(false)
  }

  // ─── Validación ───────────────────────────────────────────────────────────
  const validation = useMemo(() => {
    const errors: string[] = []
    const warnings: string[] = []

    if (currentDays.length === 0) return { errors, warnings }

    // Check weekly hours per employee
    locEmployees.forEach(emp => {
      const totalHours = currentDays.reduce((sum, day) => {
        const shift = day.shifts.find(s => s.employeeId === emp.id)
        return sum + (shift?.hours || 0)
      }, 0)
      if (totalHours > 40) errors.push(`${emp.name}: supera 40h/semana (${totalHours.toFixed(1)}h)`)
      if (totalHours < 20 && totalHours > 0) warnings.push(`${emp.name}: solo ${totalHours.toFixed(1)}h esta semana`)
    })

    // Check rest days (1.5 days minimum)
    locEmployees.forEach(emp => {
      const restCount = currentDays.filter(d => d.shifts.find(s => s.employeeId === emp.id && s.type === 'libre')).length
      if (restCount < 1) errors.push(`${emp.name}: no tiene días de descanso esta semana`)
      else if (restCount < 2) warnings.push(`${emp.name}: solo ${restCount} día de descanso (mínimo 1.5)`)
    })

    // Check minimum staff per day
    currentDays.forEach((day, di) => {
      const working = day.shifts.filter(s => s.type !== 'libre').length
      const isWeekend = di >= 5
      const isFriday = di === 4
      const minNeeded = isWeekend ? 3 : isFriday ? 2 : 1
      if (working < minNeeded) {
        errors.push(`${DAY_NAMES[di]}: solo ${working} trabajador(es), mínimo ${minNeeded}`)
      }
    })

    return { errors, warnings }
  }, [currentDays, locEmployees])

  // ─── Cambiar turno manualmente ─────────────────────────────────────────────
  function changeShift(dayIdx: number, empId: string, newType: ShiftType) {
    const def = getShiftDef(newType)
    setCurrentDays(prev => prev.map((day, di) => {
      if (di !== dayIdx) return day
      return {
        ...day,
        shifts: day.shifts.map(s =>
          s.employeeId === empId
            ? { ...s, type: newType, start: def.start, end: def.end, hours: def.hours }
            : s
        )
      }
    }))
  }


  // Weekly totals per employee
  const empTotals = locEmployees.map(emp => {
    const hours = currentDays.reduce((sum, day) => {
      const s = day.shifts.find(s => s.employeeId === emp.id)
      return sum + (s?.hours || 0)
    }, 0)
    const restDays = currentDays.filter(d => d.shifts.find(s => s.employeeId === emp.id && s.type === 'libre')).length
    return { emp, hours, restDays }
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Calendario de Horarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Generador automático · Convenio hostelería · Máx. 40h/semana · 1.5 días de descanso
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {editMode && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowValidation(true)}>
                {validation.errors.length > 0 ? `⚠️ ${validation.errors.length} errores` : '✅ Validar'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancelar</Button>
              <Button size="sm" onClick={saveSchedule}>💾 Guardar</Button>
            </>
          )}
          {!editMode && currentDays.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>✏️ Editar</Button>
          )}
          <Button size="sm" onClick={generateAuto} disabled={locEmployees.length === 0}>
            ⚡ Generar automático
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-2xl border items-end">
        <div>
          <Label>Local</Label>
          <Select className="mt-1 w-52" value={locId} onChange={e => setLocId(e.target.value)}>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Semana (lunes)</Label>
          <input
            type="date"
            value={weekStart}
            onChange={e => {
              const d = new Date(e.target.value + 'T12:00:00')
              setWeekStart(fmtDate(getMondayOfWeek(d)))
            }}
            className="mt-1 border rounded-lg px-3 py-2 text-sm bg-white block"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => {
            const d = new Date(weekStart + 'T12:00:00')
            d.setDate(d.getDate() - 7)
            setWeekStart(fmtDate(d))
          }}>← Anterior</Button>
          <Button size="sm" variant="outline" onClick={() => {
            const d = new Date(weekStart + 'T12:00:00')
            d.setDate(d.getDate() + 7)
            setWeekStart(fmtDate(d))
          }}>Siguiente →</Button>
        </div>
        {locEmployees.length === 0 && (
          <Alert type="warning">No hay empleados activos en este local</Alert>
        )}
      </div>

      {/* Reglas del convenio */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Reglas aplicadas</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            { icon: '⏰', label: 'L-J: Partido', val: '12:30–16:00 + 20:00–23:30' },
            { icon: '🌙', label: 'V-S-D: Continuo', val: '12:30–00:15' },
            { icon: '👥', label: 'Mín. fin de semana', val: '2 tarde, 3 noche 20h' },
            { icon: '😴', label: 'Descanso', val: '1.5 días/semana (seguidos si posible)' },
          ].map(r => (
            <div key={r.label} className="bg-gray-50 rounded-xl p-3 border">
              <p className="text-base mb-1">{r.icon}</p>
              <p className="font-medium">{r.label}</p>
              <p className="text-gray-500">{r.val}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Grid calendar */}
      {currentDays.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-medium text-gray-700">Sin horario para esta semana</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Pulsa "Generar automático" para crear el horario respetando todas las reglas</p>
          <Button onClick={generateAuto} disabled={locEmployees.length === 0}>⚡ Generar automático</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Desktop grid */}
          <div className="hidden md:block border rounded-2xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 w-36">Empleado</th>
                  {currentDays.map((day, di) => (
                    <th key={di} className={`p-2 text-center text-xs font-semibold ${di >= 5 ? 'text-teal-700 bg-teal-50' : 'text-gray-500'}`}>
                      <p>{DAY_SHORT[di]}</p>
                      <p className="font-normal">{fmtShort(day.date).split(' ')[1]} {fmtShort(day.date).split(' ')[2]}</p>
                    </th>
                  ))}
                  <th className="p-3 text-center text-xs font-semibold text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {locEmployees.map(emp => {
                  const totData = empTotals.find(t => t.emp.id === emp.id)!
                  return (
                    <tr key={emp.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-3">
                        <p className="font-medium text-sm truncate max-w-[120px]">{emp.name || 'Sin nombre'}</p>
                        <p className="text-xs text-gray-400">{emp.position}</p>
                      </td>
                      {currentDays.map((day, di) => {
                        const shift = day.shifts.find(s => s.employeeId === emp.id)
                        const def = shift ? getShiftDef(shift.type) : null
                        const isEditing = editMode
                        return (
                          <td key={di} className="p-1.5">
                            {isEditing ? (
                              <select
                                value={shift?.type || 'libre'}
                                onChange={e => changeShift(di, emp.id, e.target.value as ShiftType)}
                                className={`w-full text-xs rounded-lg px-1.5 py-1.5 border font-medium ${def?.color || 'bg-gray-100 text-gray-500 border-gray-200'}`}
                              >
                                {SHIFT_DEFS.map(sd => (
                                  <option key={sd.type} value={sd.type}>{sd.label}</option>
                                ))}
                              </select>
                            ) : (
                              <div className={`text-xs rounded-lg px-2 py-1.5 text-center border font-medium ${def?.color || 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                {def?.type === 'libre' ? 'Libre' : shift ? `${shift.start}–${shift.end}` : '—'}
                                {shift && shift.type !== 'libre' && <span className="block text-[10px] opacity-70">{shift.hours}h</span>}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="p-3 text-center">
                        <p className={`font-bold text-sm ${totData.hours > 40 ? 'text-red-600' : totData.hours >= 35 ? 'text-emerald-600' : 'text-gray-700'}`}>
                          {totData.hours.toFixed(1)}h
                        </p>
                        <p className="text-xs text-gray-400">{totData.restDays}d libre</p>
                      </td>
                    </tr>
                  )
                })}
                {/* Daily totals row */}
                <tr className="bg-gray-50 border-t">
                  <td className="p-3 text-xs font-semibold text-gray-500">Total por día</td>
                  {currentDays.map((day, di) => {
                    const working = day.shifts.filter(s => s.type !== 'libre').length
                    const isWeekend = di >= 5
                    const needed = isWeekend ? 3 : di === 4 ? 2 : 1
                    const ok = working >= needed
                    return (
                      <td key={di} className="p-2 text-center">
                        <span className={`text-xs font-bold ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
                          {working} {ok ? '✓' : '⚠'}
                        </span>
                      </td>
                    )
                  })}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile: card per employee */}
          <div className="md:hidden space-y-3">
            {locEmployees.map(emp => {
              const totData = empTotals.find(t => t.emp.id === emp.id)!
              return (
                <Card key={emp.id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium">{emp.name}</p>
                      <p className="text-xs text-gray-500">{emp.position}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${totData.hours > 40 ? 'text-red-600' : 'text-emerald-600'}`}>{totData.hours.toFixed(1)}h</p>
                      <p className="text-xs text-gray-400">{totData.restDays}d libre</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {currentDays.map((day, di) => {
                      const shift = day.shifts.find(s => s.employeeId === emp.id)
                      const def = shift ? getShiftDef(shift.type) : null
                      return (
                        <div key={di} className="text-center">
                          <p className="text-[10px] text-gray-400 mb-1">{DAY_SHORT[di]}</p>
                          <div className={`text-[9px] rounded px-0.5 py-1 border font-medium ${def?.color || 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                            {shift?.type === 'libre' ? 'L' : shift ? def?.label?.[0] || '?' : '—'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-xl">
            <p className="text-xs font-medium text-gray-500 w-full mb-1">Leyenda:</p>
            {SHIFT_DEFS.map(sd => (
              <span key={sd.type} className={`text-xs px-2 py-1 rounded-lg border font-medium ${sd.color}`}>
                {sd.label} {sd.start ? `(${sd.start}–${sd.end}, ${sd.hours}h)` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Validation modal */}
      <Modal open={showValidation} onClose={() => setShowValidation(false)} title="Validación del horario" size="md">
        <div className="space-y-4">
          {validation.errors.length === 0 && validation.warnings.length === 0 ? (
            <Alert type="success">✅ El horario cumple todas las reglas del convenio y las restricciones del negocio.</Alert>
          ) : (
            <>
              {validation.errors.length > 0 && (
                <div>
                  <p className="font-medium text-red-700 mb-2">❌ Errores ({validation.errors.length})</p>
                  <div className="space-y-1">
                    {validation.errors.map((e, i) => <Alert key={i} type="error">{e}</Alert>)}
                  </div>
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div>
                  <p className="font-medium text-amber-700 mb-2">⚠️ Avisos ({validation.warnings.length})</p>
                  <div className="space-y-1">
                    {validation.warnings.map((w, i) => <Alert key={i} type="warning">{w}</Alert>)}
                  </div>
                </div>
              )}
            </>
          )}
          <Button onClick={() => setShowValidation(false)} className="w-full">Cerrar</Button>
        </div>
      </Modal>
    </div>
  )
}
