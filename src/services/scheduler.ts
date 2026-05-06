import type { Employee } from '../types'

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface TimeSlot {
  start: string   // "HH:MM"
  end: string     // "HH:MM"
}

export type DayCode = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo'

export interface DayShift {
  manana?: TimeSlot   // turno de mañana (mediodía)
  tarde?: TimeSlot    // turno de tarde/noche
  libre: boolean
  totalHours: number
  notes?: string
}

export interface WorkerWeek {
  employeeId: string
  employeeName: string
  position: string
  days: Record<DayCode, DayShift>
  totalHours: number
  restDays: number
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
  coverageByDay: Record<DayCode, { count: number; min: number; ok: boolean }>
}

// ─── Constantes del negocio (extraídas del Excel) ─────────────────────────────

export const DAY_CODES: DayCode[] = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
export const DAY_LABELS: Record<DayCode, string> = {
  lunes:'Lunes', martes:'Martes', miercoles:'Miércoles', jueves:'Jueves',
  viernes:'Viernes', sabado:'Sábado', domingo:'Domingo'
}
export const DAY_SHORT: Record<DayCode, string> = {
  lunes:'L', martes:'M', miercoles:'X', jueves:'J', viernes:'V', sabado:'S', domingo:'D'
}

// Horario del local según el Excel proporcionado
export const LOCAL_SCHEDULE: Record<DayCode, { manana?: TimeSlot; tarde: TimeSlot }> = {
  lunes:     { manana: { start:'13:00', end:'15:45' }, tarde: { start:'19:00', end:'23:30' } },
  martes:    { manana: { start:'13:00', end:'15:45' }, tarde: { start:'19:00', end:'23:30' } },
  miercoles: { manana: { start:'13:00', end:'15:45' }, tarde: { start:'19:00', end:'23:30' } },
  jueves:    { manana: { start:'13:00', end:'15:45' }, tarde: { start:'19:00', end:'23:30' } },
  viernes:   { manana: { start:'13:00', end:'15:00' }, tarde: { start:'19:00', end:'02:15' } },
  sabado:    { manana: { start:'12:00', end:'16:00' }, tarde: { start:'19:00', end:'02:15' } },
  domingo:   { manana: { start:'12:00', end:'16:00' }, tarde: { start:'19:00', end:'02:15' } },
}

// Mínimo de personal por día y turno
export const MIN_STAFF: Record<DayCode, { manana: number; tarde: number }> = {
  lunes:     { manana: 1, tarde: 1 },
  martes:    { manana: 1, tarde: 1 },
  miercoles: { manana: 1, tarde: 1 },
  jueves:    { manana: 1, tarde: 1 },
  viernes:   { manana: 1, tarde: 2 },
  sabado:    { manana: 2, tarde: 3 },
  domingo:   { manana: 2, tarde: 2 },
}

export const MAX_WEEKLY_HOURS = 40
export const MIN_REST_DAYS = 2  // 1.5 redondeado a 2 para la semana

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseTime(t: string): number {
  // returns minutes from midnight, handles past-midnight (e.g. 00:15 = 24*60+15 if < 6:00)
  const [h, m] = t.split(':').map(Number)
  const mins = h * 60 + m
  return mins < 360 ? mins + 1440 : mins  // past midnight → add 24h
}

export function calcHours(start: string, end: string): number {
  if (!start || !end) return 0
  return Math.max(0, (parseTime(end) - parseTime(start)) / 60)
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function isAbsent(emp: Employee, date: string): { absent: boolean; type: string } {
  const vac = emp.vacations.find(v =>
    v.status === 'aprobada' && v.startDate <= date && v.endDate >= date
  )
  if (vac) return { absent: true, type: vac.type }
  return { absent: false, type: '' }
}

function emptyDayShift(libre = false, notes?: string): DayShift {
  return { libre, totalHours: 0, notes }
}

// ─── Motor principal ──────────────────────────────────────────────────────────
export function generateSmartSchedule(employees: Employee[], weekStartDate: string): GeneratedSchedule {
  const alerts: ScheduleAlert[] = []
  const adjustments: string[] = []

  const active = employees.filter(e => e.active)

  if (active.length === 0) {
    return {
      workers: [], adjustments: [],
      alerts: [{ id: 'no-staff', severity: 'critical', message: 'No hay empleados activos', suggestion: 'Añade empleados en Personal' }],
      coverageByDay: Object.fromEntries(DAY_CODES.map(d => [d, { count: 0, min: 1, ok: false }])) as GeneratedSchedule['coverageByDay']
    }
  }

  // Paso 1: detectar ausencias y alertar
  const absencesByEmp: Record<string, Record<DayCode, string>> = {}
  active.forEach(emp => {
    absencesByEmp[emp.id] = {} as Record<DayCode, string>
    DAY_CODES.forEach((day, _di) => {
      const date = addDays(weekStartDate, DAY_CODES.indexOf(day))
      const { absent, type } = isAbsent(emp, date)
      if (absent) {
        absencesByEmp[emp.id][day] = type
        alerts.push({
          id: `abs-${emp.id}-${day}`,
          severity: type === 'Baja médica' ? 'critical' : 'warning',
          message: `${emp.name}: ${type} el ${DAY_LABELS[day]}`,
          suggestion: type === 'Baja médica' ? 'Busca sustituto urgente' : 'Horario ajustado',
          dayCode: day, employeeId: emp.id
        })
      }
    })
  })

  // Paso 2: distribuir descansos
  // Preferencia: lunes o lunes+martes (días más tranquilos)
  // Rotamos: con N trabajadores, en L-J siempre hay N-restantes trabajando
  const n = active.length
  const restAssignment: Record<string, DayCode[]> = {}

  // Calcular cuántos pueden descansar cada día sin bajar del mínimo
  // Lunes-Jueves: mínimo 1 → pueden descansar n-1 personas por día
  // Viernes-Dom: mínimo 2-3 → solo pueden descansar n-min personas
  active.forEach((emp, idx) => {
    const restDays: DayCode[] = []

    // Día principal de descanso rotativo (L, M, X, J alternando)
    const mainRestDay = DAY_CODES[idx % 4]  // solo entre semana
    restDays.push(mainRestDay)

    // Segundo día de descanso: si hay suficiente personal
    if (n >= 3) {
      const secondRestDay = DAY_CODES[(idx + 2) % 4]
      if (!restDays.includes(secondRestDay)) restDays.push(secondRestDay)
    }

    restAssignment[emp.id] = restDays
  })

  // Paso 3: construir el horario semana a semana
  const weeklyHours: Record<string, number> = {}
  active.forEach(e => { weeklyHours[e.id] = 0 })

  const workersMap: Record<string, WorkerWeek> = {}
  active.forEach(emp => {
    workersMap[emp.id] = {
      employeeId: emp.id,
      employeeName: emp.name || '(Sin nombre)',
      position: emp.position,
      days: {} as Record<DayCode, DayShift>,
      totalHours: 0,
      restDays: 0
    }
  })

  const coverageByDay: GeneratedSchedule['coverageByDay'] = {} as GeneratedSchedule['coverageByDay']

  DAY_CODES.forEach((day, _di) => {
    const localSched = LOCAL_SCHEDULE[day]
    const minStaff = MIN_STAFF[day]

    // Horario completo de este día (mañana + tarde)
    const mananaHours = localSched.manana ? calcHours(localSched.manana.start, localSched.manana.end) : 0
    const tardeHours = calcHours(localSched.tarde.start, localSched.tarde.end)

    // Empleados disponibles (no ausentes, no sobre el límite 40h)
    const available = active.filter(emp => {
      if (absencesByEmp[emp.id][day]) return false
      if (weeklyHours[emp.id] + mananaHours > MAX_WEEKLY_HOURS) return false
      return true
    })

    // Quién descansa hoy
    const resting = available.filter(emp => restAssignment[emp.id]?.includes(day))
    let working = available.filter(emp => !restAssignment[emp.id]?.includes(day))

    // Si con descansos no llegamos al mínimo, quitamos descansos
    const minNeeded = Math.max(minStaff.manana, minStaff.tarde)
    if (working.length < minNeeded) {
      const needed = minNeeded - working.length
      const borrowedFromRest = resting.slice(0, needed)
      working = [...working, ...borrowedFromRest]
      borrowedFromRest.forEach(emp => {
        adjustments.push(`${DAY_LABELS[day]}: ${emp.name} trabaja (descanso cancelado por falta de personal)`)
        alerts.push({
          id: `rest-cancelled-${emp.id}-${day}`, severity: 'warning',
          message: `${emp.name}: descanso de ${DAY_LABELS[day]} cancelado por falta de cobertura`,
          suggestion: 'Considera contratar más personal', employeeId: emp.id, dayCode: day
        })
      })
    }

    // Cobertura real
    const coverCount = working.length
    const ok = coverCount >= minNeeded

    if (!ok) {
      // Personal insuficiente → reducir horario
      const reducedSchedule = getReducedSchedule(day, coverCount, minStaff)
      adjustments.push(`${DAY_LABELS[day]}: solo ${coverCount} trabajador(es), mínimo ${minNeeded} → ${reducedSchedule.description}`)
      alerts.push({
        id: `understaffed-${day}`, severity: coverCount === 0 ? 'critical' : 'error',
        message: `${DAY_LABELS[day]}: ${coverCount} trabajador(es) disponibles (mínimo ${minNeeded}). ${reducedSchedule.description}`,
        suggestion: reducedSchedule.suggestion, dayCode: day
      })
    }

    coverageByDay[day] = { count: coverCount, min: minNeeded, ok }

    // Asignar turnos
    active.forEach(emp => {
      const isAbsent = !!absencesByEmp[emp.id][day]
      const isWorking = working.find(w => w.id === emp.id)

      if (isAbsent) {
        workersMap[emp.id].days[day] = emptyDayShift(true, absencesByEmp[emp.id][day])
        workersMap[emp.id].restDays++
        return
      }

      if (!isWorking) {
        workersMap[emp.id].days[day] = emptyDayShift(true)
        workersMap[emp.id].restDays++
        return
      }

      // Construir turno del día
      // Verificar si le queda margen para turno completo o solo partido
      const hoursLeft = MAX_WEEKLY_HOURS - weeklyHours[emp.id]
      let manana: TimeSlot | undefined = undefined
      let tarde: TimeSlot | undefined = undefined
      let dayHours = 0

      if (localSched.manana && hoursLeft >= mananaHours) {
        manana = localSched.manana
        dayHours += mananaHours
      }

      const tardeH = Math.min(tardeHours, hoursLeft - dayHours)
      if (tardeH > 0) {
        if (tardeH >= tardeHours) {
          tarde = localSched.tarde
          dayHours += tardeHours
        } else {
          // Turno tarde reducido por límite 40h
          const newEnd = addMinutesToTime(localSched.tarde.start, Math.round(tardeH * 60))
          tarde = { start: localSched.tarde.start, end: newEnd }
          dayHours += tardeH
          adjustments.push(`${emp.name} ${DAY_LABELS[day]}: turno tarde reducido (límite 40h)`)
        }
      }

      workersMap[emp.id].days[day] = { manana, tarde, libre: false, totalHours: dayHours }
      weeklyHours[emp.id] += dayHours
    })
  })

  // Paso 4: calcular totales y alertas de horas
  active.forEach(emp => {
    const worker = workersMap[emp.id]
    worker.totalHours = Object.values(worker.days).reduce((s, d) => s + d.totalHours, 0)
    if (worker.totalHours > MAX_WEEKLY_HOURS) {
      alerts.push({ id: `overhours-${emp.id}`, severity: 'error', message: `${emp.name}: ${worker.totalHours.toFixed(1)}h (máximo 40h)`, employeeId: emp.id })
    }
    if (worker.restDays < 1) {
      alerts.push({ id: `norest-${emp.id}`, severity: 'error', message: `${emp.name}: sin días de descanso`, suggestion: 'Obligatorio por convenio', employeeId: emp.id })
    } else if (worker.restDays < 2) {
      alerts.push({ id: `lowrest-${emp.id}`, severity: 'warning', message: `${emp.name}: solo ${worker.restDays} día libre (convenio: 1.5)`, employeeId: emp.id })
    }
  })

  // Alerta global de personal insuficiente
  const understaffedDays = Object.values(coverageByDay).filter(c => !c.ok).length
  if (understaffedDays >= 3) {
    alerts.unshift({
      id: 'need-more-staff', severity: 'critical',
      message: `⚠️ ${understaffedDays} días sin cobertura mínima. Necesitas más personal.`,
      suggestion: `Con ${active.length} empleados no se cubren todos los turnos. Mínimo recomendado: ${Math.ceil(MAX_WEEKLY_HOURS / 7) + 1} empleados`
    })
  }

  return {
    workers: Object.values(workersMap),
    alerts,
    adjustments,
    coverageByDay
  }
}

// ─── Reducción de horario por falta de personal ───────────────────────────────
function getReducedSchedule(day: DayCode, available: number, min: { manana: number; tarde: number }): { description: string; suggestion: string } {
  const isWeekend = day === 'sabado' || day === 'domingo' || day === 'viernes'
  if (available === 0) return { description: 'Local cerrado por falta de personal', suggestion: 'Busca personal de refuerzo urgente' }
  if (isWeekend && available < min.tarde) {
    return { description: `Cierre 30 min antes del horario (${available}/${min.tarde} para noche)`, suggestion: `Necesitas ${min.tarde - available} persona(s) más para cubrir la noche` }
  }
  return { description: `Solo servicio mediodía (${available}/${min.manana} mínimo noche)`, suggestion: 'Cierra a las 16:00, sin servicio de noche' }
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}`
}
