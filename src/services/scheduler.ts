import type { Employee } from '../types'

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

function isAbsent(emp: Employee, date: string): { absent: boolean; type: string } {
  const v = emp.vacations.find(v => v.status === 'aprobada' && v.startDate <= date && v.endDate >= date)
  return v ? { absent: true, type: v.type } : { absent: false, type: '' }
}

export function createDefaultParams(employees: Employee[]): WeekParams {
  return {
    workers: employees.filter(e => e.active).map(e => ({ employeeId: e.id, hoursAvailable: e.weeklyHours || 40 })),
    days: JSON.parse(JSON.stringify(DEFAULT_DAY_PARAMS)),
    notes: ''
  }
}

// ─── Motor principal ──────────────────────────────────────────────────────────
export function generateSmartSchedule(employees: Employee[], weekStartDate: string, params: WeekParams): GeneratedSchedule {
  const alerts: ScheduleAlert[] = []
  const adjustments: string[] = []

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

  // Detectar ausencias oficiales
  const absences: Record<string, Partial<Record<DayCode, string>>> = {}
  active.forEach(emp => {
    absences[emp.id] = {}
    DAY_CODES.forEach((day, di) => {
      const { absent, type } = isAbsent(emp, addDaysStr(weekStartDate, di))
      if (absent) {
        absences[emp.id][day] = type
        alerts.push({
          id: `abs-${emp.id}-${day}`, severity: type === 'Baja médica' ? 'critical' : 'warning',
          message: `${emp.name}: ${type} el ${DAY_LABELS[day]}`,
          suggestion: type === 'Baja médica' ? 'Busca sustituto urgente' : 'Horario ajustado automáticamente',
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
      const isAbsentToday = !!absences[emp.id][day]
      if (isAbsentToday) {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: absences[emp.id][day] }
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

// ─── Importar horario manual desde datos reales ───────────────────────────────
// Construye un GeneratedSchedule directamente desde turnos predefinidos
// sin ejecutar el generador automático

export interface ManualWorkerDay {
  manana?: TimeSlot
  tarde?: TimeSlot
  libre: boolean
  libreHalfDay?: 'manana' | 'tarde'
  notes?: string
}

export interface ManualWorkerSchedule {
  employeeId: string
  days: Record<DayCode, ManualWorkerDay>
}

export function buildScheduleFromManual(
  employees: Employee[],
  manualData: ManualWorkerSchedule[]
): GeneratedSchedule {
  const workers: WorkerWeek[] = manualData.map(mw => {
    const emp = employees.find(e => e.id === mw.employeeId)
    let totalHours = 0
    let restDays = 0
    let restHalfDays = 0

    const days = {} as Record<DayCode, DayShift>
    DAY_CODES.forEach(day => {
      const d = mw.days[day]
      const mH = d.manana ? calcHours(d.manana.start, d.manana.end) : 0
      const tH = d.tarde ? calcHours(d.tarde.start, d.tarde.end) : 0
      const dayH = mH + tH
      days[day] = {
        manana: d.manana,
        tarde: d.tarde,
        libre: d.libre,
        libreHalfDay: d.libreHalfDay,
        totalHours: dayH,
        notes: d.notes,
        overtime: dayH > 9
      }
      if (d.libre) restDays++
      else if (d.libreHalfDay) restHalfDays++
      totalHours += dayH
    })

    return {
      employeeId: mw.employeeId,
      employeeName: emp?.name || '(Sin nombre)',
      position: emp?.position || '',
      days, totalHours, restDays, restHalfDays
    }
  })

  // Calcular cobertura por día
  const coverageByDay = {} as GeneratedSchedule['coverageByDay']
  DAY_CODES.forEach(day => {
    const dp = DEFAULT_DAY_PARAMS[day]
    const manana = workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].manana).length
    const noche = workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].tarde).length
    coverageByDay[day] = {
      manana, noche,
      minManana: dp.minManana,
      minNoche: dp.minNoche,
      ok: manana >= dp.minManana && noche >= dp.minNoche
    }
  })

  // Alertas de horas
  const alerts: ScheduleAlert[] = []
  workers.forEach(w => {
    if (w.totalHours > MAX_OVERTIME_HOURS) {
      alerts.push({ id:`ot-${w.employeeId}`, severity:'warning', message:`${w.employeeName}: ${w.totalHours.toFixed(2)}h esta semana (máximo recomendado: 40h)`, employeeId: w.employeeId })
    }
    if (w.restDays < 1) {
      alerts.push({ id:`norest-${w.employeeId}`, severity:'error', message:`${w.employeeName}: sin día libre esta semana`, employeeId: w.employeeId })
    }
  })

  return {
    workers,
    alerts,
    adjustments: ['Horario importado manualmente desde plantilla real'],
    coverageByDay
  }
}

// ─── PLANTILLA BASE (horario fijo de referencia) ──────────────────────────────
// Este es el horario estándar del local. Es inmutable — solo se usa como
// referencia para calcular reajustes cuando hay modificaciones.

export const BASE_TEMPLATE_LABEL = 'Plantilla base (horario normal del local)'

// Construye la plantilla base para N trabajadores
// T1=idx 0, T2=idx 1, T3=idx 2
export function getBaseTemplate(employees: Employee[]): ManualWorkerSchedule[] {
  const r: ManualWorkerSchedule[] = []
  if (employees[0]) r.push({ employeeId: employees[0].id, days: {
    lunes:     { libre:false, manana:{start:'12:30',end:'16:45'}, tarde:{start:'19:45',end:'00:15'} },
    martes:    { libre:true },
    miercoles: { libre:false, libreHalfDay:'manana' as const, tarde:{start:'19:45',end:'00:15'}, notes:'Libre mañana' },
    jueves:    { libre:false, tarde:{start:'16:45',end:'00:15'} },
    viernes:   { libre:false, tarde:{start:'14:45',end:'00:15'} },
    sabado:    { libre:false, manana:{start:'12:30',end:'16:45'}, tarde:{start:'19:45',end:'00:15'} },
    domingo:   { libre:false, tarde:{start:'19:45',end:'00:15'} },
  }})
  if (employees[1]) r.push({ employeeId: employees[1].id, days: {
    lunes:     { libre:true },
    martes:    { libre:false, libreHalfDay:'manana' as const, tarde:{start:'19:45',end:'00:15'}, notes:'Libre mañana' },
    miercoles: { libre:false, manana:{start:'12:30',end:'16:45'}, tarde:{start:'19:45',end:'00:15'} },
    jueves:    { libre:false, manana:{start:'12:30',end:'16:45'} },
    viernes:   { libre:false, manana:{start:'12:30',end:'16:45'}, tarde:{start:'19:45',end:'00:15'} },
    sabado:    { libre:false, tarde:{start:'19:45',end:'00:15'} },
    domingo:   { libre:false, manana:{start:'14:45',end:'00:15'} },
  }})
  if (employees[2]) r.push({ employeeId: employees[2].id, days: {
    lunes:     { libre:false, tarde:{start:'19:45',end:'00:15'} },
    martes:    { libre:false, manana:{start:'12:30',end:'16:45'}, tarde:{start:'19:45',end:'00:15'} },
    miercoles: { libre:true },
    jueves:    { libre:false, libreHalfDay:'manana' as const, tarde:{start:'19:45',end:'00:15'}, notes:'Libre mañana' },
    viernes:   { libre:false, tarde:{start:'19:45',end:'00:15'} },
    sabado:    { libre:false, manana:{start:'14:45',end:'00:15'} },
    domingo:   { libre:false, manana:{start:'12:30',end:'16:45'}, tarde:{start:'19:45',end:'00:15'} },
  }})
  return r
}

// ─── TIPOS DE MODIFICACIÓN ────────────────────────────────────────────────────

export type ModType = 'ausencia_dia' | 'ausencia_manana' | 'ausencia_tarde' | 'cambio_horario' | 'dia_libre_extra'

export interface ScheduleModification {
  id: string
  employeeId: string
  dayCode: DayCode
  type: ModType
  reason: string        // 'Baja médica' | 'Permiso' | 'Vacaciones' | 'Petición' | 'Otro'
  newSlot?: TimeSlot    // para cambio_horario
  createdAt: string
}

// ─── MOTOR DE REAJUSTE ────────────────────────────────────────────────────────
// Parte de la plantilla base, aplica las modificaciones, y reajusta el resto
// para mantener los mínimos de cobertura.

export interface AdjustResult {
  schedule: GeneratedSchedule
  alerts: ScheduleAlert[]
  adjustments: string[]
}

export function applyModifications(
  employees: Employee[],
  modifications: ScheduleModification[]
): GeneratedSchedule {
  const alerts: ScheduleAlert[] = []
  const adjustments: string[] = []

  // 1. Partir de la plantilla base
  const base = getBaseTemplate(employees)
  if (base.length === 0) {
    return {
      workers: [], alerts: [{ id:'no-staff', severity:'critical', message:'Sin empleados' }],
      adjustments: [], coverageByDay: {} as GeneratedSchedule['coverageByDay']
    }
  }

  // 2. Aplicar modificaciones sobre la base
  const modified = base.map(w => {
    const mods = modifications.filter(m => m.employeeId === w.employeeId)
    const days = { ...w.days }
    mods.forEach(mod => {
      const cur = days[mod.dayCode] || { libre: true }
      switch (mod.type) {
        case 'ausencia_dia':
          days[mod.dayCode] = { libre: true, notes: mod.reason }
          break
        case 'ausencia_manana':
          days[mod.dayCode] = { ...cur, manana: undefined, libreHalfDay: 'manana', notes: `Libre mañana (${mod.reason})` }
          break
        case 'ausencia_tarde':
          days[mod.dayCode] = { ...cur, tarde: undefined, libreHalfDay: 'tarde', notes: `Libre noche (${mod.reason})` }
          break
        case 'cambio_horario':
          if (mod.newSlot) {
            // Decidir si es manana o tarde según la hora
            const h = parseInt(mod.newSlot.start)
            if (h >= 12 && h < 17) days[mod.dayCode] = { ...cur, manana: mod.newSlot }
            else days[mod.dayCode] = { ...cur, tarde: mod.newSlot }
          }
          break
        case 'dia_libre_extra':
          days[mod.dayCode] = { libre: true, notes: 'Día libre (petición)' }
          break
      }
      adjustments.push(`${employees.find(e=>e.id===w.employeeId)?.name || w.employeeId}: ${mod.type.replace('_',' ')} el ${DAY_LABELS[mod.dayCode]} (${mod.reason})`)
    })
    return { ...w, days }
  })

  // 3. Construir schedule inicial con las modificaciones
  const initial = buildScheduleFromManual(employees, modified)

  // 4. Verificar cobertura y reajustar donde falte
  const reajusted = rebalanceCoverage(employees, modified, initial, adjustments, alerts)

  return {
    ...reajusted,
    alerts: [...alerts, ...reajusted.alerts],
    adjustments: [...adjustments, ...reajusted.adjustments]
  }
}

// ─── Rebalanceo de cobertura ──────────────────────────────────────────────────
function rebalanceCoverage(
  employees: Employee[],
  modified: ManualWorkerSchedule[],
  current: GeneratedSchedule,
  adjustments: string[],
  alerts: ScheduleAlert[]
): GeneratedSchedule {
  const workers = current.workers.map(w => ({ ...w, days: { ...w.days } }))

  DAY_CODES.forEach(day => {
    const dp = DEFAULT_DAY_PARAMS[day]
    const cov = current.coverageByDay[day]
    const isWeekend = isWeekendDay(day)

    // ── Cobertura de NOCHE ──────────────────────────────────────────────────
    if (cov.noche < dp.minNoche) {
      const nocheShort = dp.minNoche - cov.noche
      const empLabel = (id: string) => employees.find(e => e.id === id)?.name || id

      // Buscar trabajadores que ese día tienen solo mañana o están libres (no por ausencia oficial)
      const candidates = workers.filter(w => {
        const d = w.days[day]
        if (!d) return false
        // Solo libre por descanso (no por ausencia registrada)
        const hasOfficialAbsence = modified.find(m => m.employeeId === w.employeeId)?.days[day]?.notes?.includes('Baja') ||
          modified.find(m => m.employeeId === w.employeeId)?.days[day]?.notes?.includes('Vacaciones')
        if (hasOfficialAbsence) return false
        return d.libre || (d.manana && !d.tarde)  // libre o solo mañana
      })

      // Asignar noche a los primeros candidatos necesarios
      const toReassign = candidates.slice(0, nocheShort)
      toReassign.forEach(w => {
        const d = w.days[day]
        const tardeSlot = dp.tarde || { start:'19:45', end:'00:15' }
        w.days[day] = {
          manana: d.libre ? undefined : d.manana,
          tarde: tardeSlot,
          libre: false,
          totalHours: (d.manana ? calcHours(d.manana.start, d.manana.end) : 0) + calcHours(tardeSlot.start, tardeSlot.end),
          notes: 'Reajustado: añadida noche'
        } as DayShift
        w.totalHours = Object.values(w.days).reduce((s, dd) => s + (dd.totalHours || 0), 0)
        adjustments.push(`${empLabel(w.employeeId)}: asignado turno de noche el ${DAY_LABELS[day]} (reajuste por falta de personal)`)
        alerts.push({
          id: `reajuste-noche-${w.employeeId}-${day}`,
          severity: 'warning',
          message: `${empLabel(w.employeeId)}: turno de noche añadido el ${DAY_LABELS[day]} por reajuste`,
          suggestion: 'Descanso cancelado para mantener cobertura mínima',
          dayCode: day, employeeId: w.employeeId
        })
      })

      // Si no hay candidatos suficientes: reducción de horario
      const stillShort = dp.minNoche - workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].tarde).length
      if (stillShort > 0) {
        if (day === 'lunes' && cov.noche === 0) {
          // Cerrar lunes
          workers.forEach(w => {
            if (w.days[day]) { w.days[day] = { libre: true, totalHours: 0, notes: 'Cerrado' }; w.restDays++ }
          })
          adjustments.push('Lunes: CERRADO por falta de personal suficiente en noche')
          alerts.push({ id:'closed-lunes-adj', severity:'critical', message:'Lunes cerrado: sin personal disponible para noche', dayCode:'lunes' })
        } else {
          // Cerrar 30 min antes
          workers.forEach(w => {
            const d = w.days[day]
            if (d && !d.libre && d.tarde) {
              const newEnd = subMins(d.tarde.end, 30)
              d.tarde = { start: d.tarde.start, end: newEnd }
              d.totalHours = (d.manana ? calcHours(d.manana.start, d.manana.end) : 0) + calcHours(d.tarde.start, d.tarde.end)
            }
          })
          adjustments.push(`${DAY_LABELS[day]}: cierre 30 min antes (${isWeekend?'reducción fin de semana':'L-J reducción'}) — ${stillShort} persona(s) menos`)
          alerts.push({
            id:`earlyclose-adj-${day}`, severity:'warning',
            message:`${DAY_LABELS[day]}: cierre adelantado 30 min por personal insuficiente`,
            suggestion:`Faltan ${stillShort} persona(s) para cubrir el mínimo de noche`, dayCode:day
          })
        }
      }
    }

    // ── Cobertura de MAÑANA ─────────────────────────────────────────────────
    if (cov.manana < dp.minManana) {
      const candidates = workers.filter(w => {
        const d = w.days[day]
        return d && !d.libre && d.tarde && !d.manana  // tiene noche pero no mañana
      })
      const toAdd = candidates.slice(0, dp.minManana - cov.manana)
      toAdd.forEach(w => {
        const mSlot = dp.manana || { start:'12:30', end:'16:00' }
        w.days[day] = {
          ...w.days[day],
          manana: mSlot,
          totalHours: calcHours(mSlot.start, mSlot.end) + (w.days[day].tarde ? calcHours(w.days[day].tarde!.start, w.days[day].tarde!.end) : 0)
        } as DayShift
        w.totalHours = Object.values(w.days).reduce((s, dd) => s + (dd.totalHours || 0), 0)
        adjustments.push(`${employees.find(e=>e.id===w.employeeId)?.name}: añadida mañana el ${DAY_LABELS[day]} por reajuste`)
      })
    }
  })

  // Recalcular coverageByDay
  const coverageByDay = {} as GeneratedSchedule['coverageByDay']
  DAY_CODES.forEach(day => {
    const dp = DEFAULT_DAY_PARAMS[day]
    const manana = workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].manana).length
    const noche = workers.filter(w => w.days[day] && !w.days[day].libre && w.days[day].tarde).length
    coverageByDay[day] = { manana, noche, minManana:dp.minManana, minNoche:dp.minNoche, ok: manana>=dp.minManana && noche>=dp.minNoche }
  })

  return { workers, alerts: [], adjustments, coverageByDay }
}

