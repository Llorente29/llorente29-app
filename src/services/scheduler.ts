import type { Employee } from '../types'
import { VACATION_TYPES, type VacationType } from '../types/personal'

const VACATION_LABEL_BY_TYPE: Record<VacationType, string> = Object.fromEntries(
  VACATION_TYPES.map(t => [t.id, t.label])
) as Record<VacationType, string>

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface TimeSlot { start: string; end: string }
export type DayCode = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo'

export interface DayShift {
  manana?: TimeSlot
  tarde?: TimeSlot
  libre: boolean
  libreHalfDay?: 'manana' | 'tarde'  // medio día libre
  totalHours: number
  notes?: string
  overtime?: boolean  // horas extras
}

export interface WorkerWeek {
  employeeId: string
  employeeName: string
  position: string
  days: Record<DayCode, DayShift>
  totalHours: number
  restDays: number        // días completos libres
  restHalfDays: number    // medios días libres
}

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical'
export interface ScheduleAlert {
  id: string
  severity: AlertSeverity
  message: string
  suggestion?: string
  dayCode?: DayCode
  employeeId?: string
}

export interface GeneratedSchedule {
  workers: WorkerWeek[]
  alerts: ScheduleAlert[]
  adjustments: string[]
  coverageByDay: Record<DayCode, { manana: number; noche: number; minManana: number; minNoche: number; ok: boolean }>
}

// ─── Parámetros semanales ─────────────────────────────────────────────────────
export interface WorkerParam {
  employeeId: string
  hoursAvailable: number
}

export interface DayParams {
  open: boolean
  manana?: TimeSlot
  tarde?: TimeSlot
  minManana: number
  minNoche: number
}

export interface WeekParams {
  workers: WorkerParam[]
  days: Record<DayCode, DayParams>
  notes?: string
}

// ─── Reglas del negocio ───────────────────────────────────────────────────────

export const DAY_CODES: DayCode[] = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
export const DAY_LABELS: Record<DayCode, string> = {
  lunes:'Lunes', martes:'Martes', miercoles:'Miércoles', jueves:'Jueves',
  viernes:'Viernes', sabado:'Sábado', domingo:'Domingo'
}
export const DAY_SHORT: Record<DayCode, string> = {
  lunes:'L', martes:'M', miercoles:'X', jueves:'J', viernes:'V', sabado:'S', domingo:'D'
}

// Horarios base del local
export const DEFAULT_DAY_PARAMS: Record<DayCode, DayParams> = {
  // L-J: partido 12:30-16:00 + 19:30-23:59 | mañana=1 noche=2
  lunes:     { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'19:30',end:'23:59'}, minManana:1, minNoche:2 },
  martes:    { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'19:30',end:'23:59'}, minManana:1, minNoche:2 },
  miercoles: { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'19:30',end:'23:59'}, minManana:1, minNoche:2 },
  jueves:    { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'19:30',end:'23:59'}, minManana:1, minNoche:2 },
  // V-S-D: continuo 12:30-23:59 | viernes mañana=1 noche=3 | S-D mañana temprana + noche=3
  viernes:   { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'16:00',end:'23:59'}, minManana:1, minNoche:3 },
  sabado:    { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'16:00',end:'23:59'}, minManana:2, minNoche:3 },
  domingo:   { open:true, manana:{start:'12:30',end:'16:00'}, tarde:{start:'16:00',end:'23:59'}, minManana:2, minNoche:3 },
}

export const MAX_WEEKLY_HOURS = 40
export const MAX_OVERTIME_HOURS = 43  // límite con horas extras

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function calcHours(start: string, end: string): number {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let s = sh * 60 + sm, e = eh * 60 + em
  if (e <= s) e += 1440
  return Math.max(0, (e - s) / 60)
}

function subMins(time: string, m: number): string {
  const [h, min] = time.split(':').map(Number)
  let t = h * 60 + min - m
  if (t < 0) t += 1440
  return `${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`
}


function isWeekendDay(d: DayCode) { return d === 'viernes' || d === 'sabado' || d === 'domingo' }

function addDaysStr(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// Forma mínima de una vacación para este scheduler (la satisface VacationRequest
// de types/personal). Se pasan EXPLÍCITAS a generateSmartSchedule/generateFromPrediction
// porque emp.vacations NO se puebla al cargar el staff (AppContext solo adjunta
// clockEntries) → si dependiéramos de emp.vacations, la ausencia nunca bloquearía.
export interface SchedulerVacation {
  employeeId: string
  status: string
  type: VacationType
  startDate: string
  endDate: string
}

// Mapa empleado → tramos de ausencia APROBADA (con tipo, para etiqueta/severidad).
// Une la fuente explícita (fiable) con emp.vacations (por si viniera poblada).
function buildAbsenceMap(
  employees: Employee[],
  extra: SchedulerVacation[] = [],
): Map<string, { start: string; end: string; type: VacationType }[]> {
  const m = new Map<string, { start: string; end: string; type: VacationType }[]>()
  const add = (id: string, start: string, end: string, type: VacationType) => {
    const arr = m.get(id) ?? []
    arr.push({ start, end, type })
    m.set(id, arr)
  }
  for (const v of extra) {
    if (v.status === 'aprobada') add(v.employeeId, v.startDate, v.endDate, v.type)
  }
  for (const e of employees) {
    for (const v of (e.vacations || [])) {
      if (v.status === 'aprobada') add(e.id, v.startDate, v.endDate, v.type as VacationType)
    }
  }
  return m
}

function isAbsent(
  map: Map<string, { start: string; end: string; type: VacationType }[]>,
  empId: string,
  date: string,
): { absent: true; type: VacationType } | { absent: false; type: null } {
  const list = map.get(empId)
  const v = list?.find(x => x.start <= date && date <= x.end)
  return v ? { absent: true, type: v.type } : { absent: false, type: null }
}

export function createDefaultParams(employees: Employee[]): WeekParams {
  return {
    workers: employees.filter(e => e.active).map(e => ({ employeeId: e.id, hoursAvailable: e.weeklyHours || 40 })),
    days: JSON.parse(JSON.stringify(DEFAULT_DAY_PARAMS)),
    notes: ''
  }
}

// ─── Motor principal ──────────────────────────────────────────────────────────
export function generateSmartSchedule(
  employees: Employee[],
  weekStartDate: string,
  params: WeekParams,
  vacations: SchedulerVacation[] = [],
): GeneratedSchedule {
  const alerts: ScheduleAlert[] = []
  const adjustments: string[] = []
  // Ausencias aprobadas → exclusión dura (se consulta en isAbsent()).
  const absenceMap = buildAbsenceMap(employees, vacations)

  const active = employees.filter(e => e.active && params.workers.some(w => w.employeeId === e.id))
  if (active.length === 0) {
    return {
      workers: [], adjustments: [],
      alerts: [{ id:'no-staff', severity:'critical', message:'No hay trabajadores disponibles esta semana', suggestion:'Añade trabajadores en el formulario de parámetros' }],
      coverageByDay: Object.fromEntries(DAY_CODES.map(d => [d, { manana:0, noche:0, minManana:0, minNoche:0, ok:false }])) as GeneratedSchedule['coverageByDay']
    }
  }

  const hoursAvail: Record<string, number> = {}
  active.forEach(e => { hoursAvail[e.id] = params.workers.find(w => w.employeeId === e.id)?.hoursAvailable ?? 40 })

  // Detectar ausencias oficiales y disponibilidad
  const absences: Record<string, Partial<Record<DayCode, VacationType>>> = {}
  // Pre-build unavailability from employee.availability field
  const unavailable: Record<string, DayCode[]> = {}
  active.forEach(emp => {
    unavailable[emp.id] = []
    DAY_CODES.forEach(day => {
      const avail = (emp as any).availability?.[day]
      if (avail && avail.includes('no_disponible')) unavailable[emp.id].push(day)
    })
  })
  active.forEach(emp => {
    absences[emp.id] = {}
    DAY_CODES.forEach((day, di) => {
      const result = isAbsent(absenceMap, emp.id, addDaysStr(weekStartDate, di))
      if (result.absent) {
        const type = result.type
        const typeLabel = VACATION_LABEL_BY_TYPE[type]
        absences[emp.id][day] = type
        alerts.push({
          id: `abs-${emp.id}-${day}`, severity: type === 'baja_medica' ? 'critical' : 'warning',
          message: `${emp.name}: ${typeLabel} el ${DAY_LABELS[day]}`,
          suggestion: type === 'baja_medica' ? 'Busca sustituto urgente' : 'Horario ajustado automáticamente',
          dayCode: day, employeeId: emp.id
        })
      }
    })
  })

  // ── Planificación de descansos ────────────────────────────────────────────
  // Regla: 1 día completo + 1 medio día, preferiblemente seguidos
  // Estrategia: descanso completo en L o M (rotando), medio día en el día siguiente
  // Con fin de semana ocupado, forzamos descanso entre semana
  const n = active.length
  const restPlan: Record<string, { fullRest: DayCode; halfRest: DayCode; halfPart: 'manana' | 'tarde' }> = {}

  active.forEach((emp, idx) => {
    // Día de descanso completo: rotar entre lunes(0), martes(1), miércoles(2), jueves(3)
    const fullRestDay = DAY_CODES[idx % 4] as DayCode
    // Medio día: el día anterior o siguiente según disponibilidad
    // Si descansa lunes → medio día martes mañana (seguido)
    // Si descansa martes → medio día lunes tarde (seguido)
    let halfRestDay: DayCode
    let halfPart: 'manana' | 'tarde'
    if (fullRestDay === 'lunes') {
      halfRestDay = 'martes'; halfPart = 'manana'
    } else if (fullRestDay === 'martes') {
      halfRestDay = 'lunes'; halfPart = 'tarde'
    } else if (fullRestDay === 'miercoles') {
      halfRestDay = 'jueves'; halfPart = 'manana'
    } else {
      halfRestDay = 'miercoles'; halfPart = 'tarde'
    }
    restPlan[emp.id] = { fullRest: fullRestDay, halfRest: halfRestDay, halfPart }
  })

  // ── Inicializar workers ───────────────────────────────────────────────────
  const hoursUsed: Record<string, number> = {}
  active.forEach(e => { hoursUsed[e.id] = 0 })

  const workersMap: Record<string, WorkerWeek> = {}
  active.forEach(emp => {
    workersMap[emp.id] = {
      employeeId: emp.id, employeeName: emp.name || '(Sin nombre)',
      position: emp.position, days: {} as Record<DayCode, DayShift>,
      totalHours: 0, restDays: 0, restHalfDays: 0
    }
  })

  const coverageByDay: GeneratedSchedule['coverageByDay'] = {} as GeneratedSchedule['coverageByDay']

  // ── Iterar días ───────────────────────────────────────────────────────────
  DAY_CODES.forEach(day => {
    const dp = params.days[day]
    const isWeekend = isWeekendDay(day)

    // Día cerrado
    if (!dp.open) {
      active.forEach(emp => {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: 'Cerrado' }
        workersMap[emp.id].restDays++
      })
      coverageByDay[day] = { manana:0, noche:0, minManana:dp.minManana, minNoche:dp.minNoche, ok:true }
      return
    }

    const mananaSlot = dp.manana  // 12:30-16:00
    const tardeSlot = dp.tarde    // 19:30-23:59 (L-J) o 16:00-23:59 (V-S-D)
    const mananaH = mananaSlot ? calcHours(mananaSlot.start, mananaSlot.end) : 0
    const tardeH = tardeSlot ? calcHours(tardeSlot.start, tardeSlot.end) : 0

    // Para V-S-D: turno corrido = mañana+tarde juntos (7.5-9h)
    // Un trabajador hace el corrido, el resto entran a las 19:30 para la noche
    const corridoH = mananaH + tardeH  // horas totales del día (turno corrido)

    // ── Clasificar empleados ───────────────────────────────────────────────
    // Disponibles: no ausentes, con horas suficientes
    const available = active.filter(emp => {
      if (absences[emp.id][day]) return false
      if (unavailable[emp.id]?.includes(day)) return false
      // Check availability by shift type
      const avail = (emp as any).availability?.[day]
      if (avail && !avail.includes('manana') && !avail.includes('tarde')) return false
      return true
    })

    // Quién descansa hoy (según plan de descansos)
    const shouldRestFull = available.filter(emp => restPlan[emp.id]?.fullRest === day)
    const shouldRestHalfManana = available.filter(emp => restPlan[emp.id]?.halfRest === day && restPlan[emp.id]?.halfPart === 'manana')
    const shouldRestHalfTarde = available.filter(emp => restPlan[emp.id]?.halfRest === day && restPlan[emp.id]?.halfPart === 'tarde')

    // Trabajadores activos (no descanso completo)
    let working = available.filter(emp => !shouldRestFull.some(r => r.id === emp.id))

    // ── Verificar cobertura mínima y ajustar descansos si hace falta ──────
    const covNoche = working.filter(emp => {
      const rp = restPlan[emp.id]
      if (rp?.halfRest === day && rp?.halfPart === 'tarde') return false
      return hoursUsed[emp.id] + tardeH <= MAX_OVERTIME_HOURS
    }).length

    // Si no hay suficientes para la noche, rescatar del descanso completo
    if (covNoche < dp.minNoche && shouldRestFull.length > 0) {
      const needed = dp.minNoche - covNoche
      const rescued = shouldRestFull.splice(0, Math.min(needed, shouldRestFull.length))
      working = [...working, ...rescued]
      rescued.forEach(emp => {
        adjustments.push(`${DAY_LABELS[day]}: ${emp.name} — descanso cancelado para cubrir mínimo de noche (${dp.minNoche})`)
        alerts.push({
          id: `rest-cancel-${emp.id}-${day}`, severity: 'warning',
          message: `${emp.name}: descanso de ${DAY_LABELS[day]} cancelado (se necesitan ${dp.minNoche} en noche)`,
          suggestion: 'Considera contratar más personal',
          employeeId: emp.id, dayCode: day
        })
      })
    }

    // Contar cobertura real
    const realNoche = working.filter(emp => !(restPlan[emp.id]?.halfRest === day && restPlan[emp.id]?.halfPart === 'tarde')).length

    // ── Alerta si aún faltan ──────────────────────────────────────────────
    if (realNoche < dp.minNoche) {
      const missing = dp.minNoche - realNoche
      const minLabel = isWeekend ? `3 (${DAY_LABELS[day]} noche)` : `2 (L-J noche)`
      alerts.push({
        id: `short-${day}`, severity: 'error',
        message: `⚠️ ${DAY_LABELS[day]}: ${realNoche}/${dp.minNoche} trabajadores en noche (mínimo obligatorio: ${minLabel})`,
        suggestion: `Faltan ${missing} persona(s). Los disponibles alargan horas para cubrir el turno`,
        dayCode: day
      })
      adjustments.push(`${DAY_LABELS[day]}: ${realNoche}/${dp.minNoche} en noche — trabajadores disponibles hacen horas extras`)

      // Reducción SOLO si hay 1 de 2 en L-J: cerrar 30 min antes
      if (!isWeekend && realNoche === 1 && tardeSlot) {
        const newEnd = subMins(tardeSlot.end, 30)
        adjustments.push(`${DAY_LABELS[day]}: cierre adelantado 30 min (→ ${newEnd}) por personal insuficiente en noche`)
        alerts.push({ id:`early-${day}`, severity:'warning', message:`${DAY_LABELS[day]}: cierre a las ${newEnd} (30 min antes) — 1/2 en noche`, dayCode:day })
        dp.tarde = { start: tardeSlot.start, end: newEnd }  // mutamos para este día
      }
      // Si V-S-D con menos de 2 → cerrar 30 min antes
      if (isWeekend && realNoche <= 1 && tardeSlot) {
        const newEnd = subMins(tardeSlot.end, 30)
        adjustments.push(`${DAY_LABELS[day]}: cierre adelantado 30 min (→ ${newEnd}) — situación crítica`)
        dp.tarde = { start: tardeSlot.start, end: newEnd }
      }
      // Cerrar lunes si 0 disponibles
      if (day === 'lunes' && realNoche === 0) {
        active.forEach(emp => { workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: 'Cerrado' }; workersMap[emp.id].restDays++ })
        coverageByDay[day] = { manana:0, noche:0, minManana:dp.minManana, minNoche:dp.minNoche, ok:false }
        adjustments.push('Lunes: CERRADO (sin personal disponible)')
        alerts.push({ id:'closed-lunes', severity:'critical', message:'Lunes cerrado: sin personal disponible', dayCode:'lunes' })
        return
      }
    }

    // ── Asignar turnos a cada trabajador ──────────────────────────────────
    active.forEach(emp => {
      const absenceType = absences[emp.id][day]
      if (absenceType) {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: VACATION_LABEL_BY_TYPE[absenceType] }
        workersMap[emp.id].restDays++
        return
      }

      const isFullRest = shouldRestFull.some(r => r.id === emp.id) && !working.some(w => w.id === emp.id)
      if (isFullRest) {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0 }
        workersMap[emp.id].restDays++
        return
      }

      const isHalfManana = shouldRestHalfManana.some(r => r.id === emp.id)
      const isHalfTarde = shouldRestHalfTarde.some(r => r.id === emp.id)
      const rp = restPlan[emp.id]

      const remaining = hoursAvail[emp.id] - hoursUsed[emp.id]

      if (isWeekend) {
        // ── V-S-D: lógica especial ─────────────────────────────────────
        // ¿Es este trabajador el candidato para el turno corrido?
        // El corrido va al primero disponible con más horas libres que aún no haya hecho corrido esta semana
        const corridoWorker = working.find(w => {
          const rem = hoursAvail[w.id] - hoursUsed[w.id]
          return rem >= 7.5 && rp?.fullRest !== day && rp?.halfRest !== day
        })
        const hasCorrido = corridoWorker?.id === emp.id

        if (hasCorrido && dp.manana && dp.tarde) {
          // Turno corrido: 12:30 hasta 23:59 (con la pausa entre mediodia y noche incluida como descanso)
          // Horas reales: mañana + tarde
          const totalH = Math.min(corridoH, remaining, MAX_OVERTIME_HOURS - hoursUsed[emp.id])
          const isOT = totalH > 9
          workersMap[emp.id].days[day] = {
            manana: dp.manana, tarde: dp.tarde,
            libre: false, totalHours: totalH,
            notes: `Turno corrido (${totalH.toFixed(1)}h)`,
            overtime: isOT
          }
          hoursUsed[emp.id] += totalH
          if (isOT) {
            alerts.push({ id:`ot-${emp.id}-${day}`, severity:'info', message:`${emp.name}: horas extras en ${DAY_LABELS[day]} (${totalH.toFixed(1)}h)`, employeeId:emp.id, dayCode:day })
          }
        } else if (isHalfManana && dp.tarde) {
          // Medio día libre por la mañana → solo noche
          const h = Math.min(calcHours(dp.tarde.start, dp.tarde.end), remaining)
          workersMap[emp.id].days[day] = { tarde: dp.tarde, libre: false, libreHalfDay: 'manana', totalHours: h, notes: 'Libre mañana' }
          hoursUsed[emp.id] += h
          workersMap[emp.id].restHalfDays++
        } else if (isHalfTarde) {
          // Medio día libre por la tarde → solo mañana
          const h = dp.manana ? Math.min(mananaH, remaining) : 0
          workersMap[emp.id].days[day] = { manana: dp.manana, libre: false, libreHalfDay: 'tarde', totalHours: h, notes: 'Libre noche' }
          hoursUsed[emp.id] += h
          workersMap[emp.id].restHalfDays++
        } else if (dp.tarde) {
          // Sábado/domingo con 2 mínimo en mañana (12:30-14h o 14:30h)
          // Los demás entran a la noche
          const workerIdx = working.indexOf(emp)
          if (day !== 'viernes' && workerIdx < dp.minManana && dp.manana) {
            // Asignar turno completo con mañana
            const h = Math.min(mananaH + calcHours(dp.tarde.start, dp.tarde.end), remaining)
            workersMap[emp.id].days[day] = { manana: dp.manana, tarde: dp.tarde, libre: false, totalHours: h }
            hoursUsed[emp.id] += h
          } else {
            // Solo noche
            const h = Math.min(calcHours(dp.tarde.start, dp.tarde.end), remaining)
            workersMap[emp.id].days[day] = { tarde: dp.tarde, libre: false, totalHours: h }
            hoursUsed[emp.id] += h
          }
        }
      } else {
        // ── L-J: turno partido ─────────────────────────────────────────
        if (isHalfManana && dp.tarde) {
          // Libre por la mañana → solo noche
          const h = Math.min(calcHours(dp.tarde.start, dp.tarde.end), remaining)
          workersMap[emp.id].days[day] = { tarde: dp.tarde, libre: false, libreHalfDay: 'manana', totalHours: h, notes: 'Libre mañana' }
          hoursUsed[emp.id] += h
          workersMap[emp.id].restHalfDays++
        } else if (isHalfTarde && dp.manana) {
          // Libre por la noche → solo mañana
          const h = Math.min(mananaH, remaining)
          workersMap[emp.id].days[day] = { manana: dp.manana, libre: false, libreHalfDay: 'tarde', totalHours: h, notes: 'Libre noche' }
          hoursUsed[emp.id] += h
          workersMap[emp.id].restHalfDays++
        } else {
          // Turno partido completo (cuando el trabajador trabaja este día)
          const isWorking = working.some(w => w.id === emp.id)
          if (!isWorking) {
            workersMap[emp.id].days[day] = { libre: true, totalHours: 0 }
            workersMap[emp.id].restDays++
            return
          }
          // Solo 1 trabajador en mañana (L-V) → el resto entra solo a la noche
          const workerIdx = working.indexOf(emp)
          if (dp.minManana === 1 && workerIdx > 0 && dp.tarde) {
            // Los demás: solo noche
            const h = Math.min(calcHours(dp.tarde.start, dp.tarde.end), remaining)
            workersMap[emp.id].days[day] = { tarde: dp.tarde, libre: false, totalHours: h, notes: 'Solo noche' }
            hoursUsed[emp.id] += h
          } else {
            // Turno completo partido
            const hM = dp.manana && workerIdx === 0 ? Math.min(mananaH, remaining) : 0
            const hT = dp.tarde ? Math.min(calcHours(dp.tarde.start, dp.tarde.end), remaining - hM) : 0
            const totalH = hM + hT
            const isOT = hoursUsed[emp.id] + totalH > MAX_WEEKLY_HOURS
            workersMap[emp.id].days[day] = {
              manana: dp.manana && hM > 0 ? dp.manana : undefined,
              tarde: dp.tarde && hT > 0 ? dp.tarde : undefined,
              libre: false, totalHours: totalH,
              overtime: isOT
            }
            hoursUsed[emp.id] += totalH
            if (isOT) alerts.push({ id:`ot-${emp.id}-${day}`, severity:'info', message:`${emp.name}: horas extras el ${DAY_LABELS[day]}`, employeeId:emp.id, dayCode:day })
          }
        }
      }
    })

    // Cobertura real
    const covM = active.filter(e => workersMap[e.id].days[day] && !workersMap[e.id].days[day].libre && workersMap[e.id].days[day].manana).length
    const covN = active.filter(e => workersMap[e.id].days[day] && !workersMap[e.id].days[day].libre && workersMap[e.id].days[day].tarde).length
    coverageByDay[day] = { manana:covM, noche:covN, minManana:dp.minManana, minNoche:dp.minNoche, ok: covM>=dp.minManana && covN>=dp.minNoche }
  })

  // ── Totales y alertas finales ─────────────────────────────────────────────
  active.forEach(emp => {
    const w = workersMap[emp.id]
    w.totalHours = Object.values(w.days).reduce((s, d) => s + (d.totalHours || 0), 0)
    if (w.totalHours > MAX_OVERTIME_HOURS) {
      alerts.push({ id:`overhours-${emp.id}`, severity:'error', message:`${emp.name}: ${w.totalHours.toFixed(1)}h esta semana (máximo con extras: ${MAX_OVERTIME_HOURS}h)`, employeeId:emp.id })
    } else if (w.totalHours > MAX_WEEKLY_HOURS) {
      alerts.push({ id:`overtime-${emp.id}`, severity:'warning', message:`${emp.name}: ${w.totalHours.toFixed(1)}h — horas extras permitidas excepcionalmente`, employeeId:emp.id })
    }
    if (w.restDays < 1) {
      alerts.push({ id:`norest-${emp.id}`, severity:'error', message:`${emp.name}: sin día libre esta semana (obligatorio por convenio)`, employeeId:emp.id })
    } else if (w.restHalfDays < 1) {
      alerts.push({ id:`nohalf-${emp.id}`, severity:'warning', message:`${emp.name}: sin medio día libre (convenio: 1 día + medio)`, employeeId:emp.id })
    }
  })

  const understaffed = Object.values(coverageByDay).filter(c => !c.ok).length
  if (understaffed >= 3) {
    alerts.unshift({ id:'need-more', severity:'critical', message:`⚠️ ${understaffed} días sin cobertura mínima — se necesita más personal`, suggestion:`Con ${n} trabajadores no se cubren todos los mínimos. Mínimo recomendado: ${Math.ceil((n*40)/7/6)} empleados por turno pico` })
  }

  return { workers: Object.values(workersMap), alerts, adjustments, coverageByDay }
}

// ─── VALIDACIÓN 12H DESCANSO ENTRE TURNOS ────────────────────────────────────
export interface RestViolation {
  employeeId: string
  employeeName: string
  dayFrom: DayCode
  dayTo: DayCode
  closingHour: string  // hora cierre día anterior
  openingHour: string  // hora apertura día siguiente
  restHours: number    // horas reales de descanso
}

export function checkRestViolations(schedule: GeneratedSchedule): RestViolation[] {
  const violations: RestViolation[] = []
  schedule.workers.forEach(worker => {
    DAY_CODES.forEach((day, di) => {
      if (di === 6) return
      const today = worker.days[day]
      const tomorrow = worker.days[DAY_CODES[di + 1]]
      if (!today || !tomorrow) return
      if (today.libre || tomorrow.libre) return

      const closingSlot = today.tarde || today.manana
      const openingSlot = tomorrow.manana || tomorrow.tarde
      if (!closingSlot || !openingSlot) return

      const closeMin = parseTimeToMin(closingSlot.end)
      const openMin = parseTimeToMin(openingSlot.start)
      // si cierre es pasada medianoche (e.g. 00:15 = 24h+15min)
      const closeAdj = closeMin < 360 ? closeMin + 1440 : closeMin
      const restHours = (openMin + 1440 - closeAdj) / 60
      if (restHours < 12) {
        violations.push({
          employeeId: worker.employeeId,
          employeeName: worker.employeeName,
          dayFrom: day, dayTo: DAY_CODES[di + 1],
          closingHour: closingSlot.end,
          openingHour: openingSlot.start,
          restHours: Math.round(restHours * 10) / 10
        })
      }
    })
  })
  return violations
}

function parseTimeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ─── COSTE LABORAL ESTIMADO ───────────────────────────────────────────────────
export interface LaborCost {
  employeeId: string
  employeeName: string
  hours: number
  hourlyRate: number
  cost: number
  overtime: number  // horas >40h
  overtimeCost: number
  totalCost: number
}

export function calcLaborCosts(schedule: GeneratedSchedule, employees: Employee[]): {
  byEmployee: LaborCost[]
  totalHours: number
  totalCost: number
  overtimeCost: number
} {
  const byEmployee: LaborCost[] = schedule.workers.map(w => {
    const emp = employees.find(e => e.id === w.employeeId)
    const annualSalary = emp?.salary || 0
    const weeklyHours = emp?.weeklyHours || 40
    const hourlyRate = annualSalary > 0 ? annualSalary / 52 / weeklyHours : 0
    const overtime = Math.max(0, w.totalHours - 40)
    const normalHours = w.totalHours - overtime
    const overtimeRate = hourlyRate * 1.25  // +25% horas extras
    const cost = normalHours * hourlyRate
    const overtimeCost = overtime * overtimeRate
    return {
      employeeId: w.employeeId, employeeName: w.employeeName,
      hours: w.totalHours, hourlyRate,
      cost, overtime, overtimeCost, totalCost: cost + overtimeCost
    }
  })
  const totalHours = byEmployee.reduce((s, e) => s + e.hours, 0)
  const totalCost = byEmployee.reduce((s, e) => s + e.cost, 0)
  const overtimeCost = byEmployee.reduce((s, e) => s + e.overtimeCost, 0)
  return { byEmployee, totalHours, totalCost, overtimeCost }
}

// ─── GENERACIÓN DE HORARIO DESDE PREDICCIÓN DE VENTAS ────────────────────────

export type PredictionMode = 'alert' | 'reorganize' | 'generate'

export interface PredictionScheduleResult {
  schedule: GeneratedSchedule
  mode: PredictionMode
  coverageIssues: {
    day: DayCode
    dayName: string
    turno: 'manana' | 'noche'
    needed: number
    available: number
    deficit: number
  }[]
  reorganizationsApplied: string[]
}

export function generateFromPrediction(
  employees: Employee[],
  weekStartDate: string,
  params: WeekParams,
  staffNeeds: Record<DayCode, { manana: number; noche: number }>,
  mode: PredictionMode,
  vacations: SchedulerVacation[] = [],
): PredictionScheduleResult {
  const issues: PredictionScheduleResult['coverageIssues'] = []
  const reorganizations: string[] = []

  // Construir params ajustados con los mínimos de la predicción
  const adjustedParams: WeekParams = {
    ...params,
    days: Object.fromEntries(
      DAY_CODES.map(day => {
        const need = staffNeeds[day] || { manana: 1, noche: 2 }
        const existing = params.days[day]
        return [day, {
          ...existing,
          minManana: Math.max(existing.minManana ?? 1, need.manana),
          minNoche:  Math.max(existing.minNoche  ?? 2, need.noche),
        }]
      })
    ) as WeekParams['days']
  }

  // Detectar problemas de cobertura antes de generar
  const active = employees.filter(e => e.active && params.workers.some(w => w.employeeId === e.id))

  DAY_CODES.forEach(day => {
    const dp = adjustedParams.days[day]
    if (!dp.open) return
    const need = staffNeeds[day] || { manana: 1, noche: 2 }
    const availToday = active.filter(e => {
      const avail = (e as any).availability?.[day]
      if (avail?.includes('no_disponible')) return false
      return true
    }).length

    if (availToday < need.noche) {
      issues.push({
        day, dayName: DAY_LABELS[day], turno: 'noche',
        needed: need.noche, available: availToday,
        deficit: need.noche - availToday
      })
    }
    if (availToday < need.manana) {
      issues.push({
        day, dayName: DAY_LABELS[day], turno: 'manana',
        needed: need.manana, available: availToday,
        deficit: need.manana - availToday
      })
    }
  })

  if (mode === 'alert') {
    // Solo generar con los mínimos base sin reorganizar
    const schedule = generateSmartSchedule(employees, weekStartDate, params, vacations)
    return { schedule, mode, coverageIssues: issues, reorganizationsApplied: [] }
  }

  if (mode === 'reorganize' && issues.length > 0) {
    // Intentar redistribuir descansos para cubrir días con déficit
    const criticalDays = issues.map(i => i.day)
    const adjustedWorkers = params.workers.map(w => {
      const emp = employees.find(e => e.id === w.employeeId)
      if (!emp) return w
      // Si el trabajador tiene disponibilidad en días críticos, aumentar horas disponibles
      const availInCritical = criticalDays.filter(day => {
        const avail = (emp as any).availability?.[day]
        return !avail?.includes('no_disponible')
      }).length
      if (availInCritical > 0) {
        reorganizations.push(`${emp.name}: descanso redistribuido para cubrir días con déficit`)
        return { ...w, hoursAvailable: Math.min(w.hoursAvailable + 8, 48) }
      }
      return w
    })
    const reorganizedParams = { ...adjustedParams, workers: adjustedWorkers }
    const schedule = generateSmartSchedule(employees, weekStartDate, reorganizedParams, vacations)
    return { schedule, mode, coverageIssues: issues, reorganizationsApplied: reorganizations }
  }

  // mode === 'generate': generar con los mínimos de la predicción, marcar problemas en rojo
  const schedule = generateSmartSchedule(employees, weekStartDate, adjustedParams, vacations)
  return { schedule, mode, coverageIssues: issues, reorganizationsApplied: [] }
}
