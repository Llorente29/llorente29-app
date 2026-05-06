import type { Employee, ScheduleDay, Shift, ShiftType } from '../types'

// ─── Constantes del convenio / negocio ───────────────────────────────────────
export const MAX_WEEKLY_HOURS = 40
export const MIN_REST_DAYS = 1.5   // se traduce en: 1 día completo + 1 medio = 2 días libres
export const MIN_REST_BETWEEN_SHIFTS_H = 12  // horas mínimas entre fin y comienzo siguiente turno

// Horarios reales del local
export interface ShiftTemplate {
  type: ShiftType
  label: string
  start: string
  end: string
  hours: number        // horas reales de trabajo
  color: string
  shortLabel: string
}

export const SHIFT_TEMPLATES: Record<ShiftType, ShiftTemplate> = {
  manana: {
    type: 'manana', label: 'Mañana', shortLabel: 'M',
    start: '12:30', end: '16:00', hours: 3.5,
    color: 'bg-amber-100 text-amber-800 border-amber-200'
  },
  partido: {
    type: 'partido', label: 'Partido', shortLabel: 'P',
    start: '12:30', end: '23:30', hours: 7.5,
    color: 'bg-blue-100 text-blue-800 border-blue-200'
  },
  tarde_noche: {
    type: 'tarde_noche', label: 'Tarde/Noche', shortLabel: 'TN',
    start: '12:30', end: '00:15', hours: 11.75,
    color: 'bg-violet-100 text-violet-800 border-violet-200'
  },
  libre: {
    type: 'libre', label: 'Libre', shortLabel: 'L',
    start: '', end: '', hours: 0,
    color: 'bg-gray-100 text-gray-500 border-gray-200'
  }
}

// Requisitos mínimos por día de la semana (0=Lun...6=Dom)
export interface DayRequirements {
  minStaff: number        // mínimo para abrir
  idealStaff: number      // óptimo
  shiftType: ShiftType    // tipo de turno que aplica
  openingHour: string
  closingHour: string
}

export const DAY_REQUIREMENTS: DayRequirements[] = [
  { minStaff: 1, idealStaff: 2, shiftType: 'partido',    openingHour: '12:30', closingHour: '23:30' }, // Lun
  { minStaff: 1, idealStaff: 2, shiftType: 'partido',    openingHour: '12:30', closingHour: '23:30' }, // Mar
  { minStaff: 1, idealStaff: 2, shiftType: 'partido',    openingHour: '12:30', closingHour: '23:30' }, // Mié
  { minStaff: 1, idealStaff: 2, shiftType: 'partido',    openingHour: '12:30', closingHour: '23:30' }, // Jue
  { minStaff: 2, idealStaff: 3, shiftType: 'tarde_noche',openingHour: '12:30', closingHour: '00:15' }, // Vie
  { minStaff: 3, idealStaff: 4, shiftType: 'tarde_noche',openingHour: '12:30', closingHour: '00:15' }, // Sáb
  { minStaff: 2, idealStaff: 3, shiftType: 'tarde_noche',openingHour: '12:30', closingHour: '00:15' }, // Dom
]

// ─── Alertas ──────────────────────────────────────────────────────────────────
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical'
export interface ScheduleAlert {
  id: string
  severity: AlertSeverity
  message: string
  suggestion?: string
  dayIndex?: number
  employeeId?: string
}

// ─── Resultado del generador ──────────────────────────────────────────────────
export interface ScheduleResult {
  days: ScheduleDay[]
  alerts: ScheduleAlert[]
  adjustments: string[]   // registro de decisiones tomadas
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isAbsent(emp: Employee, date: string): { absent: boolean; type: string } {
  const vac = emp.vacations.find(v => {
    if (v.status !== 'aprobada') return false
    return v.startDate <= date && v.endDate >= date
  })
  if (vac) return { absent: true, type: vac.type }
  return { absent: false, type: '' }
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// ─── Motor principal ──────────────────────────────────────────────────────────
export function generateSmartSchedule(employees: Employee[], weekStartDate: string): ScheduleResult {
  const alerts: ScheduleAlert[] = []
  const adjustments: string[] = []

  // Solo empleados activos
  const active = employees.filter(e => e.active)

  if (active.length === 0) {
    return {
      days: [],
      alerts: [{ id: 'no-staff', severity: 'critical', message: 'No hay empleados activos en este local', suggestion: 'Añade empleados en el módulo Personal' }],
      adjustments: []
    }
  }

  // Verificar ausencias de la semana
  const absences: Record<string, { date: string; type: string }[]> = {}
  active.forEach(emp => {
    absences[emp.id] = []
    for (let di = 0; di < 7; di++) {
      const date = addDays(weekStartDate, di)
      const { absent, type } = isAbsent(emp, date)
      if (absent) {
        absences[emp.id].push({ date, type })
        alerts.push({
          id: `absence-${emp.id}-${di}`,
          severity: type === 'Baja médica' ? 'critical' : 'warning',
          message: `${emp.name}: ${type} el ${['lunes','martes','miércoles','jueves','viernes','sábado','domingo'][di]}`,
          suggestion: type === 'Baja médica' ? 'Considera buscar sustituto urgente' : 'Horario ajustado automáticamente',
          employeeId: emp.id,
          dayIndex: di
        })
      }
    }
  })

  // Horas acumuladas y días de descanso por empleado
  const weeklyHours: Record<string, number> = {}
  const restDaysCount: Record<string, number> = {}
  const consecutiveRest: Record<string, number> = {}  // días de descanso consecutivos actuales
  active.forEach(e => {
    weeklyHours[e.id] = 0
    restDaysCount[e.id] = 0
    consecutiveRest[e.id] = 0
  })

  const days: ScheduleDay[] = []

  // Distribución de descanso: rotar quién descansa cada día
  // Meta: que cada empleado tenga 1.5-2 días libre, preferiblemente lun o lun+mar
  const restRotation = distributeRestDays(active)

  for (let di = 0; di < 7; di++) {
    const date = addDays(weekStartDate, di)
    const req = DAY_REQUIREMENTS[di]
    const shifts: Shift[] = []

    // Empleados disponibles este día (no ausentes, no asignados a descanso forzado)
    const availableIds = active.map(e => e.id).filter(id => {
      const emp = active.find(e => e.id === id)!
      const absence = isAbsent(emp, date)
      if (absence.absent) return false  // ausente por vacaciones/baja
      return true
    })

    // Quién descansa hoy según rotación
    const scheduledRestIds = restRotation[di] || []
    // Pero si hay un ausente oficial, esa persona ya descansa, no necesitamos asignar más descanso del necesario
    const absentIds = active.filter(e => isAbsent(e, date).absent).map(e => e.id)

    const workingIds = availableIds.filter(id => {
      if (scheduledRestIds.includes(id)) return false
      // Verificar que no supera 40h
      const shiftHours = SHIFT_TEMPLATES[req.shiftType].hours
      return weeklyHours[id] + shiftHours <= MAX_WEEKLY_HOURS
    })

    // Forzar descanso a quien está cerca del límite
    const forcedRest = availableIds.filter(id => {
      const remaining = MAX_WEEKLY_HOURS - weeklyHours[id]
      return remaining < SHIFT_TEMPLATES[req.shiftType].hours
    })
    const finalWorking = workingIds.filter(id => !forcedRest.includes(id))
    const finalResting = [...new Set([...scheduledRestIds, ...forcedRest, ...absentIds])]

    // ─── Verificar cobertura mínima ────────────────────────────────────────
    if (finalWorking.length < req.minStaff) {
      const dayName = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][di]

      if (finalWorking.length === 0) {
        // Cierre total del día
        adjustments.push(`${dayName}: sin personal disponible → DÍA CERRADO`)
        alerts.push({
          id: `closed-${di}`,
          severity: 'critical',
          message: `${dayName}: sin personal disponible. DÍA CERRADO`,
          suggestion: 'Necesitas personal de refuerzo urgente',
          dayIndex: di
        })
      } else {
        // Reducción de horario
        const closingAdjustment = calculateReducedSchedule(req, finalWorking.length)
        adjustments.push(`${dayName}: solo ${finalWorking.length} trabajador(es) vs ${req.minStaff} mínimo → ${closingAdjustment.description}`)
        alerts.push({
          id: `understaffed-${di}`,
          severity: 'error',
          message: `${dayName}: ${finalWorking.length} trabajador(es), mínimo ${req.minStaff}. ${closingAdjustment.description}`,
          suggestion: closingAdjustment.suggestion,
          dayIndex: di
        })

        // Aplicar horario reducido al turno
        finalWorking.forEach(id => {
          shifts.push({
            employeeId: id,
            type: closingAdjustment.shiftType,
            start: closingAdjustment.start,
            end: closingAdjustment.end,
            hours: closingAdjustment.hours,
            notes: closingAdjustment.description
          })
          weeklyHours[id] += closingAdjustment.hours
          consecutiveRest[id] = 0
        })
      }
    } else {
      // Cobertura OK
      if (finalWorking.length > req.idealStaff + 1) {
        // Demasiado personal: mover alguno a descanso
        const excess = finalWorking.splice(req.idealStaff)
        excess.forEach(id => finalResting.push(id))
        adjustments.push(`${['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][di]}: exceso de personal, ${excess.length} persona(s) reubicadas a descanso`)
      }

      finalWorking.forEach(id => {
        const tmpl = SHIFT_TEMPLATES[req.shiftType]
        shifts.push({
          employeeId: id, type: req.shiftType,
          start: tmpl.start, end: tmpl.end, hours: tmpl.hours
        })
        weeklyHours[id] += tmpl.hours
        consecutiveRest[id] = 0
      })
    }

    // Marcar descansos
    const allAssigned = shifts.map(s => s.employeeId)
    active.forEach(emp => {
      if (!allAssigned.includes(emp.id)) {
        const isOfficialAbsence = isAbsent(emp, date).absent
        shifts.push({
          employeeId: emp.id, type: 'libre', start: '', end: '', hours: 0,
          notes: isOfficialAbsence ? isAbsent(emp, date).type : undefined
        })
        restDaysCount[emp.id] += 1
        consecutiveRest[emp.id] += 1
      }
    })

    days.push({ date, shifts })
  }

  // ─── Alertas de horas totales ─────────────────────────────────────────────
  active.forEach(emp => {
    const h = weeklyHours[emp.id]
    const rd = restDaysCount[emp.id]
    if (h > MAX_WEEKLY_HOURS) {
      alerts.push({ id: `overhours-${emp.id}`, severity: 'error', message: `${emp.name}: ${h.toFixed(1)}h esta semana (máximo ${MAX_WEEKLY_HOURS}h)`, employeeId: emp.id })
    }
    if (rd < 1) {
      alerts.push({ id: `norest-${emp.id}`, severity: 'error', message: `${emp.name}: sin días de descanso esta semana`, suggestion: 'Obligatorio por convenio', employeeId: emp.id })
    } else if (rd < 2) {
      alerts.push({ id: `lowrest-${emp.id}`, severity: 'warning', message: `${emp.name}: solo ${rd} día libre (mínimo 1.5 por convenio)`, employeeId: emp.id })
    }
  })

  // ─── Alerta de necesidad de más personal ─────────────────────────────────
  const daysUnderstaffed = days.filter((day, di) => {
    const working = day.shifts.filter(s => s.type !== 'libre').length
    return working < DAY_REQUIREMENTS[di].minStaff
  }).length

  if (daysUnderstaffed >= 3) {
    alerts.unshift({
      id: 'need-more-staff',
      severity: 'critical',
      message: `⚠️ ${daysUnderstaffed} días de la semana con personal insuficiente`,
      suggestion: `Necesitas al menos ${Math.ceil(MAX_WEEKLY_HOURS / 7.5)} empleados para cubrir todos los turnos`
    })
  } else if (daysUnderstaffed > 0) {
    alerts.push({
      id: 'some-understaffed',
      severity: 'warning',
      message: `${daysUnderstaffed} día(s) con personal por debajo del mínimo`,
      suggestion: 'Considera contratar personal adicional o de refuerzo'
    })
  }

  return { days, alerts, adjustments }
}

// ─── Distribución de descansos ────────────────────────────────────────────────
function distributeRestDays(employees: Employee[]): Record<number, string[]> {
  const restPlan: Record<number, string[]> = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] }
  const n = employees.length

  // Preferencia: descanso lunes (o lunes+martes si es posible)
  // Rotar: cada empleado descansa 1 día entre lunes-jueves (el menos concurrido)
  // + no asignar descanso en fin de semana (máxima demanda) a menos que sea necesario
  employees.forEach((emp, idx) => {
    // Día de descanso principal: rotar entre lunes(0), martes(1), miercoles(2), jueves(3)
    const mainRest = idx % 4
    restPlan[mainRest].push(emp.id)

    // Medio día extra: el siguiente lunes-jueves (para conseguir los 1.5)
    // Si tiene suficientes horas, le damos el martes también
    if (n <= 3) {
      // Con poco personal, solo 1 día libre entre semana
      // El "medio día" se cuenta como salir antes el viernes
    } else {
      // Con más personal: 2 días libres entre semana rotativos
      const secondRest = (mainRest + 2) % 4
      if (!restPlan[secondRest].includes(emp.id)) {
        restPlan[secondRest].push(emp.id)
      }
    }
  })

  return restPlan
}

// ─── Horario reducido cuando falta personal ───────────────────────────────────
function calculateReducedSchedule(req: DayRequirements, availableStaff: number): {
  shiftType: ShiftType; start: string; end: string; hours: number; description: string; suggestion: string
} {
  const isWeekend = req.shiftType === 'tarde_noche'

  if (availableStaff === 0) {
    return { shiftType: 'libre', start: '', end: '', hours: 0, description: 'Local cerrado por falta de personal', suggestion: 'Busca personal de refuerzo urgente' }
  }

  if (isWeekend) {
    if (availableStaff === 1) {
      // Solo apertura mediodía, cierre temprano 20:00
      return { shiftType: 'manana', start: '12:30', end: '20:00', hours: 7.5, description: 'Cierre a las 20:00 (1 trabajador, fin de semana)', suggestion: 'Necesitas al menos 2 para turno completo' }
    } else {
      // 2 disponibles en fin de semana: cierre 30 min antes
      return { shiftType: 'tarde_noche', start: '12:30', end: '23:45', hours: 11.25, description: 'Cierre 30 min antes (personal reducido)', suggestion: `Ideal ${req.idealStaff} trabajadores para este día` }
    }
  } else {
    // Entre semana con 1 persona: solo mañana
    return { shiftType: 'manana', start: '12:30', end: '16:00', hours: 3.5, description: 'Solo servicio mediodía (personal mínimo)', suggestion: 'Cierra a las 16:00 por falta de personal noche' }
  }
}
