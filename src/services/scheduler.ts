import type { Employee } from '../types'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface TimeSlot { start: string; end: string }
export type DayCode = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo'

export interface DayShift {
  manana?: TimeSlot
  tarde?: TimeSlot
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

// ─── Parámetros semanales (formulario) ───────────────────────────────────────

export interface WorkerParam {
  employeeId: string
  hoursAvailable: number  // horas disponibles esta semana (puede diferir del contrato)
}

export interface DayParams {
  open: boolean
  manana?: TimeSlot
  tarde?: TimeSlot
  minStaff: number  // mínimo para abrir ese día
}

export interface WeekParams {
  workers: WorkerParam[]
  days: Record<DayCode, DayParams>
  notes?: string
}

// ─── Constantes base (valores por defecto) ────────────────────────────────────

export const DAY_CODES: DayCode[] = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
export const DAY_LABELS: Record<DayCode, string> = {
  lunes:'Lunes', martes:'Martes', miercoles:'Miércoles', jueves:'Jueves',
  viernes:'Viernes', sabado:'Sábado', domingo:'Domingo'
}
export const DAY_SHORT: Record<DayCode, string> = {
  lunes:'L', martes:'M', miercoles:'X', jueves:'J', viernes:'V', sabado:'S', domingo:'D'
}

// minStaff = mínimo noche: L-J=2, V-S-D=3
export const DEFAULT_DAY_PARAMS: Record<DayCode, DayParams> = {
  lunes:     { open:true,  manana:{start:'13:00',end:'15:45'}, tarde:{start:'19:00',end:'23:30'}, minStaff:2 },
  martes:    { open:true,  manana:{start:'13:00',end:'15:45'}, tarde:{start:'19:00',end:'23:30'}, minStaff:2 },
  miercoles: { open:true,  manana:{start:'13:00',end:'15:45'}, tarde:{start:'19:00',end:'23:30'}, minStaff:2 },
  jueves:    { open:true,  manana:{start:'13:00',end:'15:45'}, tarde:{start:'19:00',end:'23:30'}, minStaff:2 },
  viernes:   { open:true,  manana:{start:'13:00',end:'15:00'}, tarde:{start:'19:00',end:'02:15'}, minStaff:3 },
  sabado:    { open:true,  manana:{start:'12:00',end:'16:00'}, tarde:{start:'19:00',end:'02:15'}, minStaff:3 },
  domingo:   { open:true,  manana:{start:'12:00',end:'16:00'}, tarde:{start:'19:00',end:'02:15'}, minStaff:3 },
}

export const MAX_WEEKLY_HOURS = 40

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function calcHours(start: string, end: string): number {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let startMin = sh * 60 + sm
  let endMin = eh * 60 + em
  if (endMin <= startMin) endMin += 24 * 60  // past midnight
  return Math.max(0, (endMin - startMin) / 60)
}

function subMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  let total = h * 60 + m - mins
  if (total < 0) total += 24 * 60
  return `${Math.floor(total/60).toString().padStart(2,'0')}:${(total%60).toString().padStart(2,'0')}`
}

function addDaysStr(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function isAbsent(emp: Employee, date: string): { absent: boolean; type: string } {
  const vac = emp.vacations.find(v => v.status === 'aprobada' && v.startDate <= date && v.endDate >= date)
  if (vac) return { absent: true, type: vac.type }
  return { absent: false, type: '' }
}

// ─── Motor principal ──────────────────────────────────────────────────────────

export function generateSmartSchedule(
  employees: Employee[],
  weekStartDate: string,
  params: WeekParams
): GeneratedSchedule {
  const alerts: ScheduleAlert[] = []
  const adjustments: string[] = []

  // Solo empleados incluidos en los parámetros, activos
  const active = employees.filter(e => e.active && params.workers.some(w => w.employeeId === e.id))
  if (active.length === 0) {
    return {
      workers: [], adjustments: [],
      alerts: [{ id:'no-staff', severity:'critical', message:'No hay trabajadores disponibles para esta semana', suggestion:'Añade trabajadores en el formulario de parámetros' }],
      coverageByDay: Object.fromEntries(DAY_CODES.map(d=>[d,{count:0,min:1,ok:false}])) as GeneratedSchedule['coverageByDay']
    }
  }

  // Horas disponibles por trabajador esta semana
  const hoursAvailable: Record<string, number> = {}
  active.forEach(emp => {
    const p = params.workers.find(w => w.employeeId === emp.id)
    hoursAvailable[emp.id] = p?.hoursAvailable ?? emp.weeklyHours ?? 40
  })

  // Detectar ausencias
  const absenceByEmpDay: Record<string, Partial<Record<DayCode, string>>> = {}
  active.forEach(emp => {
    absenceByEmpDay[emp.id] = {}
    DAY_CODES.forEach((day) => {
      const date = addDaysStr(weekStartDate, DAY_CODES.indexOf(day))
      const { absent, type } = isAbsent(emp, date)
      if (absent) {
        absenceByEmpDay[emp.id][day] = type
        alerts.push({
          id: `abs-${emp.id}-${day}`, severity: type === 'Baja médica' ? 'critical' : 'warning',
          message: `${emp.name}: ${type} el ${DAY_LABELS[day]}`,
          suggestion: type === 'Baja médica' ? 'Busca sustituto urgente' : 'Horario ajustado automáticamente',
          dayCode: day, employeeId: emp.id
        })
      }
    })
  })

  // Estado acumulado por trabajador
  const hoursUsed: Record<string, number> = {}
  active.forEach(e => { hoursUsed[e.id] = 0 })

  // Distribuir descansos: entre semana (L-J), rotando por trabajador
  const n = active.length
  const restByEmp: Record<string, DayCode[]> = {}
  active.forEach((emp, idx) => {
    const r: DayCode[] = []
    const main = DAY_CODES[idx % 4] as DayCode  // L, M, X, J rotando
    r.push(main)
    if (n >= 3) {
      const second = DAY_CODES[(idx + 2) % 4] as DayCode
      if (second !== main) r.push(second)
    }
    restByEmp[emp.id] = r
  })

  // Inicializar resultado
  const workersMap: Record<string, WorkerWeek> = {}
  active.forEach(emp => {
    workersMap[emp.id] = {
      employeeId: emp.id, employeeName: emp.name || '(Sin nombre)',
      position: emp.position,
      days: {} as Record<DayCode, DayShift>,
      totalHours: 0, restDays: 0
    }
  })

  const coverageByDay: GeneratedSchedule['coverageByDay'] = {} as GeneratedSchedule['coverageByDay']

  // ── Iterar por día ─────────────────────────────────────────────────────────
  DAY_CODES.forEach((day) => {
    const dp = params.days[day]

    // Día cerrado por parámetro
    if (!dp.open) {
      active.forEach(emp => {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: 'Cerrado' }
        workersMap[emp.id].restDays++
      })
      coverageByDay[day] = { count: 0, min: dp.minStaff, ok: true }  // ok porque es cierre voluntario
      adjustments.push(`${DAY_LABELS[day]}: día cerrado (configurado en parámetros)`)
      return
    }

    const mananaSlot = dp.manana
    const tardeSlot = dp.tarde
    const mananaH = mananaSlot ? calcHours(mananaSlot.start, mananaSlot.end) : 0

    // Empleados disponibles: no ausentes, con horas restantes
    const available = active.filter(emp => {
      if (absenceByEmpDay[emp.id][day]) return false
      const remaining = hoursAvailable[emp.id] - hoursUsed[emp.id]
      return remaining >= mananaH  // al menos puede hacer la mañana
    })

    // Quitar a quienes descansan hoy (si hay suficiente cobertura)
    const wantRest = available.filter(emp => restByEmp[emp.id]?.includes(day))
    let working = available.filter(emp => !restByEmp[emp.id]?.includes(day))

    // Si no llegamos al mínimo, recuperar de descanso
    if (working.length < dp.minStaff) {
      const needed = dp.minStaff - working.length
      const rescued = wantRest.slice(0, needed)
      working = [...working, ...rescued]
      rescued.forEach(emp => {
        adjustments.push(`${DAY_LABELS[day]}: ${emp.name} — descanso cancelado, se necesita cobertura mínima`)
        alerts.push({
          id: `rest-cancel-${emp.id}-${day}`, severity: 'warning',
          message: `${emp.name}: descanso de ${DAY_LABELS[day]} cancelado (cobertura mínima)`,
          suggestion: `Con ${n} trabajadores es difícil cubrir todos los días. Considera contratar más personal`,
          employeeId: emp.id, dayCode: day
        })
      })
    }

    // ── Gestión de personal insuficiente ─────────────────────────────────────
    // Mínimos OBLIGATORIOS: L-J noche=2, V-S-D noche=3
    // Si faltan: los disponibles alargan horas + aviso urgente
    // Reducciones SOLO si no hay nadie: -30min noche, o cerrar lunes
    // SOLO dos opciones permitidas:
    //   1. Adelantar 30 min el cierre de noche
    //   2. Cerrar el lunes completo
    let efectiveTarde = tardeSlot ? { ...tardeSlot } : undefined
    let efectiveManana = mananaSlot ? { ...mananaSlot } : undefined
    let dayOpen = true

    if (working.length === 0) {
      // Sin nadie disponible → opción 2 si es lunes, si no → alerta crítica
      if (day === 'lunes') {
        dayOpen = false
        adjustments.push('Lunes: CERRADO (sin personal disponible — reducción aplicada)')
        alerts.push({ id:'closed-lunes', severity:'critical', message:'Lunes cerrado por falta de personal', suggestion:'Opción de reducción aplicada automáticamente', dayCode:day })
      } else {
        dayOpen = false
        adjustments.push(`${DAY_LABELS[day]}: CERRADO por falta total de personal`)
        alerts.push({ id:`closed-${day}`, severity:'critical', message:`${DAY_LABELS[day]}: cerrado, sin personal disponible`, suggestion:'Busca personal de refuerzo urgente', dayCode:day })
      }
    } else if (working.length < dp.minStaff) {
      const missing = dp.minStaff - working.length
      const isWeekendNight = day === 'viernes' || day === 'sabado' || day === 'domingo'
      const minLabel = isWeekendNight ? '3 (V-S-D noche)' : '2 (L-J noche)'

      // Los disponibles alargan horas para cubrir el turno completo
      if (efectiveTarde) {
        const tardeHoursTotal = calcHours(efectiveTarde.start, efectiveTarde.end)
        const extraPerWorker = (tardeHoursTotal * missing) / working.length
        adjustments.push(
          `${DAY_LABELS[day]}: ${working.length}/${dp.minStaff} en noche — cada trabajador extiende ~${extraPerWorker.toFixed(1)}h adicionales`
        )
        alerts.push({
          id: `short-${day}`, severity: 'error',
          message: `⚠️ ${DAY_LABELS[day]}: solo ${working.length} trabajador(es) en noche (mínimo obligatorio: ${minLabel})`,
          suggestion: `Los ${working.length} disponibles cubren el turno. Faltan ${missing} persona(s). Considera contratar refuerzo o reorganizar descansos`,
          dayCode: day
        })
        // Reducción adicional solo en casos extremos: 1 de 3 en V-S-D → cerrar 30 min antes
        if (isWeekendNight && working.length <= 1 && missing >= 2) {
          const newEnd = subMinutes(efectiveTarde.end, 30)
          efectiveTarde = { start: efectiveTarde.start, end: newEnd }
          adjustments.push(`${DAY_LABELS[day]}: cierre adelantado 30 min (→ ${newEnd}) — situación crítica de personal`)
          alerts.push({ id:`earlyclose-${day}`, severity:'warning', message:`${DAY_LABELS[day]}: cierre a las ${newEnd} (30 min antes)`, dayCode:day })
        }
        // Lunes con 1 de 2 → cerrar 30 min antes como primera reducción
        else if (day === 'lunes' && working.length === 1) {
          const newEnd = subMinutes(efectiveTarde.end, 30)
          efectiveTarde = { start: efectiveTarde.start, end: newEnd }
          adjustments.push(`Lunes: cierre adelantado 30 min (→ ${newEnd}) — 1/2 trabajadores en noche`)
          alerts.push({ id:'earlyclose-lunes', severity:'warning', message:`Lunes: cierre a las ${newEnd} (30 min antes) con 1/2 trabajadores`, dayCode:day })
        }
      }
    }

    // Si cerrado, asignar libre a todos
    if (!dayOpen) {
      active.forEach(emp => {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: 'Cerrado' }
        workersMap[emp.id].restDays++
      })
      coverageByDay[day] = { count: 0, min: dp.minStaff, ok: false }
      return
    }

    // ── Asignar turnos ─────────────────────────────────────────────────────
    const efectivaMananaH = efectiveManana ? calcHours(efectiveManana.start, efectiveManana.end) : 0
    const efectivaTardeH = efectiveTarde ? calcHours(efectiveTarde.start, efectiveTarde.end) : 0

    active.forEach(emp => {
      const isAbsent = !!absenceByEmpDay[emp.id][day]
      if (isAbsent) {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0, notes: absenceByEmpDay[emp.id][day] }
        workersMap[emp.id].restDays++
        return
      }
      const isWorking = working.some(w => w.id === emp.id)
      if (!isWorking) {
        workersMap[emp.id].days[day] = { libre: true, totalHours: 0 }
        workersMap[emp.id].restDays++
        return
      }

      // Calcular cuántas horas le quedan al trabajador
      const remaining = hoursAvailable[emp.id] - hoursUsed[emp.id]
      let manana: TimeSlot | undefined = undefined
      let tarde: TimeSlot | undefined = undefined
      let dayH = 0

      if (efectiveManana && remaining >= efectivaMananaH) {
        manana = efectiveManana
        dayH += efectivaMananaH
      }

      if (efectiveTarde) {
        const leftAfterManana = remaining - dayH
        if (leftAfterManana >= efectivaTardeH) {
          tarde = efectiveTarde
          dayH += efectivaTardeH
        } else if (leftAfterManana > 0) {
          // Reducir tarde por límite personal de este trabajador
          const [sh, sm] = efectiveTarde.start.split(':').map(Number)
          const maxEnd = sh * 60 + sm + Math.floor(leftAfterManana * 60)
          const hh = Math.floor(maxEnd / 60) % 24
          const mm = maxEnd % 60
          const capEnd = `${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}`
          tarde = { start: efectiveTarde.start, end: capEnd }
          dayH += leftAfterManana
          adjustments.push(`${emp.name} ${DAY_LABELS[day]}: tarde reducida hasta ${capEnd} (límite ${hoursAvailable[emp.id]}h/sem)`)
        }
      }

      const totalDay = dayH
      workersMap[emp.id].days[day] = { manana, tarde, libre: false, totalHours: totalDay }
      hoursUsed[emp.id] += totalDay
    })

    coverageByDay[day] = { count: working.length, min: dp.minStaff, ok: working.length >= dp.minStaff }
  })

  // ── Totales y alertas de horas ─────────────────────────────────────────────
  active.forEach(emp => {
    const w = workersMap[emp.id]
    w.totalHours = Object.values(w.days).reduce((s, d) => s + (d.totalHours || 0), 0)
    if (w.totalHours > hoursAvailable[emp.id]) {
      alerts.push({ id:`overhours-${emp.id}`, severity:'error', message:`${emp.name}: ${w.totalHours.toFixed(1)}h asignadas (disponible: ${hoursAvailable[emp.id]}h)`, employeeId: emp.id })
    }
    if (w.restDays < 1) {
      alerts.push({ id:`norest-${emp.id}`, severity:'error', message:`${emp.name}: sin días libres esta semana`, suggestion:'Obligatorio por convenio', employeeId: emp.id })
    } else if (w.restDays < 2) {
      alerts.push({ id:`lowrest-${emp.id}`, severity:'warning', message:`${emp.name}: solo ${w.restDays} día libre (convenio: 1.5 días)`, employeeId: emp.id })
    }
  })

  // Alerta de personal insuficiente global
  const understaffedDays = Object.entries(coverageByDay).filter(([,c]) => !c.ok && c.min > 0).length
  if (understaffedDays >= 3) {
    alerts.unshift({
      id:'need-more', severity:'critical',
      message:`⚠️ ${understaffedDays} días sin cobertura mínima. Necesitas más trabajadores.`,
      suggestion:`Reducción automática aplicada: cierre 30 min antes donde es posible, cierre de lunes si no hay personal`
    })
  }

  return { workers: Object.values(workersMap), alerts, adjustments, coverageByDay }
}

// ─── Crear parámetros por defecto para una semana ────────────────────────────
export function createDefaultParams(employees: Employee[]): WeekParams {
  return {
    workers: employees.filter(e => e.active).map(e => ({
      employeeId: e.id,
      hoursAvailable: e.weeklyHours || 40
    })),
    days: { ...DEFAULT_DAY_PARAMS },
    notes: ''
  }
}
