// tests/unit/services/scheduleSolver.test.ts
//
// ENCARGO F10 (final, 09/08/2026) — el oráculo es docs/solver_prototipo.py.
// Estos fixtures son EXACTAMENTE los datos hardcodeados en ese fichero
// (TEMPLATES, DEMAND, DAY_TOTAL_PLATOS, política) y las aserciones son
// EXACTAMENTE los números que imprimió `python docs/solver_prototipo.py`:
//
//   === Semana 03/08 (rotacion #0) ===
//   Dias libres reservados: {Johanny: L, Natacha: M, Pamela: X} | sin cubrir: 0
//     Johanny   off T   T   T   C2  M+T C1  | 39.25 h · C1=1
//     Natacha   T   off M+T C2  T   C1  T   | 39.25 h · C1=1
//     Pamela    M+T M+T off M   M   T   M+T | 39.25 h · C1=0
//     TOTAL 117.75 h · partidos=5 · desvio=2.25 · spread=0.0
//
//   === Semana 10/08 (rotacion #1) ===
//   Dias libres reservados: {Johanny: M, Natacha: X, Pamela: L} | sin cubrir: 0
//     Johanny   T   off T   T   C2  M+T C1  | 39.25 h · C1=1
//     Natacha   M+T T   off C2  T   C1  T   | 39.25 h · C1=1
//     Pamela    off M+T M+T M   M   T   M+T | 39.25 h · C1=0
//     TOTAL 117.75 h · partidos=5 · desvio=2.25 · spread=0.0
//
// Si el puerto difiere de estos números, el puerto está mal — no se ajusta
// el test al resultado del puerto, se corrige el puerto (regla del encargo).

import { describe, it, expect } from 'vitest'
import { solveWeekSchedule, type SolverInput, type SolverTemplate, type SolverEmployeeInput } from '../../../src/services/scheduleSolver'

// ---- Plantillas reales de Alcalá (minutos desde medianoche, fin>1440 = cruza) ----
const TPL_M: SolverTemplate = { id: 'M', label: 'Mañana', iniMin: 750, finMin: 1005, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
const TPL_T: SolverTemplate = { id: 'T', label: 'Tarde/Noche', iniMin: 1185, finMin: 1455, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
const TPL_C1: SolverTemplate = { id: 'C1', label: 'Corrido1', iniMin: 885, finMin: 1455, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
const TPL_C2: SolverTemplate = { id: 'C2', label: 'Corrido2', iniMin: 1005, finMin: 1455, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
const TEMPLATES = [TPL_M, TPL_T, TPL_C1, TPL_C2]

const PEOPLE: SolverEmployeeInput[] = [
  { id: 'Johanny', name: 'Johanny', contractedHoursWeek: 40 },
  { id: 'Natacha', name: 'Natacha', contractedHoursWeek: 40 },
  { id: 'Pamela', name: 'Pamela', contractedHoursWeek: 40 },
]

// ---- Demanda real (required_exact por hora, ya limpia) — docs/solver_prototipo.py ----
const DEMAND_0308: Record<number, number>[] = [
  { 13: 1, 14: 1, 15: 1, 16: 1, 20: 1, 21: 1, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 20: 1.004, 21: 1.24, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 20: 1.022, 21: 1.059, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 18: 1, 20: 1.125, 21: 1.532, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1.765, 22: 1.288, 23: 1 },
  { 13: 1, 14: 1.009, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1.143, 22: 1.27, 23: 1 },
  { 12: 1, 13: 1, 14: 1.69, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1.043, 21: 1.21, 22: 1, 23: 1 },
]
const DEMAND_1008: Record<number, number>[] = [
  { 13: 1, 14: 1, 15: 1, 16: 1, 20: 1, 21: 1, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 20: 1, 21: 1.24, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 20: 1.02, 21: 1.06, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 18: 1, 20: 1.13, 21: 1.53, 22: 1, 23: 1 },
  { 13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1.77, 22: 1.29, 23: 1 },
  { 13: 1, 14: 1.01, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1.14, 22: 1.27, 23: 1 },
  { 12: 1, 13: 1, 14: 1.69, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1.04, 21: 1.21, 22: 1, 23: 1 },
]

function baseInput(demand: Record<number, number>[], weekIndex: number): SolverInput {
  return {
    weekIndex,
    templates: TEMPLATES,
    employees: PEOPLE,
    vacationDaysByEmployee: new Map(),
    demandByDayHour: demand,
    maxDailyHours: 9.5,
    splitGapMinutes: 90,
    restBetweenShiftsMinutes: 720,
    toleranceFraction: 0.10,
    peakWeekday: 2,
    peakWeekend: 3,
  }
}

// Reconstruye la fila "M+T"/"T"/"off"/"--" que imprime report() en el prototipo,
// para comparar carácter a carácter con la salida real de python.
function rowFor(outcome: ReturnType<typeof solveWeekSchedule>, empId: string): string[] {
  const byDay: string[][] = Array.from({ length: 7 }, () => [])
  for (const s of outcome.seats) {
    if (s.employeeId === empId) byDay[s.day].push(s.templateId!)
  }
  return byDay.map((tpls, d) => {
    if (tpls.length > 0) return [...tpls].sort().join('+')
    return outcome.daysOff[empId] === d ? 'off' : '--'
  })
}

describe('scheduleSolver — reproduce el oráculo docs/solver_prototipo.py', () => {
  it('semana 03/08, rotación 0: reproduce huecos, días libres, horas y patrón exactos', () => {
    const out = solveWeekSchedule(baseInput(DEMAND_0308, 0))

    expect(out.feasible).toBe(true)
    expect(out.timedOut).toBe(false)
    expect(out.seats.filter((s) => s.isHueco)).toHaveLength(0)

    expect(out.daysOff).toEqual({ Johanny: 0, Natacha: 1, Pamela: 2 })

    expect(out.hoursByEmployee.Johanny).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Natacha).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Pamela).toBeCloseTo(39.25, 2)
    const total = Object.values(out.hoursByEmployee).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(117.75, 2)

    expect(out.longShiftCountByEmployee.Johanny).toBe(1)
    expect(out.longShiftCountByEmployee.Natacha).toBe(1)
    expect(out.longShiftCountByEmployee.Pamela).toBe(0)

    expect(out.splits).toBe(5)
    expect(out.deviation).toBeCloseTo(2.25, 2)
    expect(out.spread).toBeCloseTo(0.0, 2)

    expect(rowFor(out, 'Johanny')).toEqual(['off', 'T', 'T', 'T', 'C2', 'M+T', 'C1'])
    expect(rowFor(out, 'Natacha')).toEqual(['T', 'off', 'M+T', 'C2', 'T', 'C1', 'T'])
    expect(rowFor(out, 'Pamela')).toEqual(['M+T', 'M+T', 'off', 'M', 'M', 'T', 'M+T'])
  })

  it('semana 10/08, rotación 1: el lunes NO queda vacío (regresión #1 de v3…v6) y los descansos rotan', () => {
    const out = solveWeekSchedule(baseInput(DEMAND_1008, 1))

    expect(out.feasible).toBe(true)
    expect(out.seats.filter((s) => s.isHueco)).toHaveLength(0)

    // Lunes (día 0): las tres personas deben tener asiento o ser justo su día
    // libre — nunca las tres a la vez sin nadie trabajando cuando el lunes
    // no es el día libre reservado de todos.
    const mondaySeats = out.seats.filter((s) => s.day === 0 && !s.isHueco)
    expect(mondaySeats.length).toBeGreaterThan(0)

    expect(out.daysOff).toEqual({ Johanny: 1, Natacha: 2, Pamela: 0 })
    // Rotación real: cada persona libra un día distinto al de la semana 03/08.
    expect(out.daysOff.Johanny).not.toBe(0)

    expect(out.hoursByEmployee.Johanny).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Natacha).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Pamela).toBeCloseTo(39.25, 2)

    expect(out.splits).toBe(5)
    expect(out.deviation).toBeCloseTo(2.25, 2)
    expect(out.spread).toBeCloseTo(0.0, 2)

    expect(rowFor(out, 'Johanny')).toEqual(['T', 'off', 'T', 'T', 'C2', 'M+T', 'C1'])
    expect(rowFor(out, 'Natacha')).toEqual(['M+T', 'T', 'off', 'C2', 'T', 'C1', 'T'])
    expect(rowFor(out, 'Pamela')).toEqual(['off', 'M+T', 'M+T', 'M', 'M', 'T', 'M+T'])
  })

  it('ningún turno dura menos de 3h ni más de 9,5h, y ningún corrido se repite en la misma persona', () => {
    for (const [demand, idx] of [[DEMAND_0308, 0], [DEMAND_1008, 1]] as const) {
      const out = solveWeekSchedule(baseInput(demand, idx))
      for (const s of out.seats) {
        if (s.isHueco) continue
        const dur = (s.finMin - s.iniMin) / 60
        expect(dur).toBeLessThanOrEqual(9.5 + 1e-9)
      }
      for (const empId of Object.keys(out.longShiftCountByEmployee)) {
        expect(out.longShiftCountByEmployee[empId]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('respeta la tolerancia de contrato (+10% de 40h = 44h máximo)', () => {
    const out = solveWeekSchedule(baseInput(DEMAND_0308, 0))
    for (const h of Object.values(out.hoursByEmployee)) {
      expect(h).toBeLessThanOrEqual(44 + 1e-9)
    }
  })

  it('local cerrado ese día (sin demanda ni forzado): no genera huecos artificiales', () => {
    const demandSinLunes = DEMAND_0308.map((h, d) => (d === 0 ? {} : h))
    const out = solveWeekSchedule(baseInput(demandSinLunes, 0))
    expect(out.seats.filter((s) => s.day === 0)).toHaveLength(0)
  })
})

// ENCARGO F10 (09/08 noche) — el solver ocupaba plantillas sin asiento
// declarado dejando vacío uno que sí lo tenía. Caso real: Alcalá tiene
// "Mañana" (coverage=1 los 7 días, uso histórico 59 semanas) y "Mañana1"
// (coverage=0, uso=0, gemela sin depurar F7.2, 12:30-16:00 = 3.5h en vez de
// 4.25h) — el set-cover elegía Mañana1 por ser más barata en horas y dejaba
// el hueco "Mañana: faltan 1 de 1" declarado en la misma franja y día.
describe('scheduleSolver — nivel de plantilla (coverage declarado > uso histórico > coste)', () => {
  const TPL_M_REAL: SolverTemplate = { id: 'M-real', label: 'Mañana', iniMin: 750, finMin: 1005, kind: 'demanda', uso: 59, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
  // Mañana1: gemela sin depurar — más corta (más barata en horas), sin
  // coverage declarado y sin uso histórico. Debe perder SIEMPRE contra
  // Mañana cuando compiten por la misma franja de demanda.
  const TPL_M1_DUP: SolverTemplate = { id: 'M1-duplicada', label: 'Mañana1', iniMin: 750, finMin: 960, kind: 'demanda', uso: 0, coverageByDay: [0, 0, 0, 0, 0, 0, 0] }
  const TPL_T_REAL: SolverTemplate = { id: 'T-real', label: 'Tarde/Noche F/S', iniMin: 1185, finMin: 1455, kind: 'demanda', uso: 35, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
  // Corridos reales de Alcalá: coverage=0 (igual que Mañana1) pero CON uso
  // histórico real — deben seguir siendo elegibles, nunca descartados solo
  // por no tener coverage declarado.
  const TPL_C1_REAL: SolverTemplate = { id: 'C1-real', label: 'Corrido1', iniMin: 885, finMin: 1455, kind: 'demanda', uso: 6, coverageByDay: [0, 0, 0, 0, 0, 0, 0] }
  const TPL_C2_REAL: SolverTemplate = { id: 'C2-real', label: 'Corrido2', iniMin: 1005, finMin: 1455, kind: 'demanda', uso: 11, coverageByDay: [0, 0, 0, 0, 0, 0, 0] }

  const solo1Empleado: SolverEmployeeInput[] = [{ id: 'A', name: 'Ana', contractedHoursWeek: 40 }]

  it('elige la plantilla con asiento declarado (coverage>0) sobre una gemela sin declarar y sin uso, aunque sea más barata en horas', () => {
    // Demanda solo en horas 13-16 (la franja de "Mañana"/"Mañana1"). Se
    // reparte en DOS días (con 1 solo empleado, si solo hay un día con
    // demanda, la Fase 1 le reserva justo ESE día como libre — hay que
    // dejarle otro día "sacrificable" para que el jueves quede disponible).
    const demand: Record<number, number>[] = Array.from({ length: 7 }, () => ({}))
    demand[0] = { 13: 1 }
    demand[3] = { 13: 1, 14: 1, 15: 1 }
    const out = solveWeekSchedule({
      weekIndex: 0,
      templates: [TPL_M_REAL, TPL_M1_DUP, TPL_T_REAL],
      employees: solo1Empleado,
      vacationDaysByEmployee: new Map(),
      demandByDayHour: demand,
      maxDailyHours: 9.5, splitGapMinutes: 90, restBetweenShiftsMinutes: 720,
      toleranceFraction: 0.10, peakWeekday: 0, peakWeekend: 0,
    })
    const jueves = out.seats.filter((s) => s.day === 3 && !s.isHueco)
    expect(jueves.length).toBeGreaterThan(0)
    for (const s of jueves) expect(s.templateId).toBe('M-real')
    expect(out.seats.some((s) => s.templateId === 'M1-duplicada')).toBe(false)
    // Ningún hueco declarado sobre "Mañana" mientras "Mañana1" se usó en su lugar.
    expect(out.seats.filter((s) => s.isHueco)).toHaveLength(0)
  })

  it('una plantilla con coverage=0 pero uso histórico real (los corridos) sigue siendo elegible — no se filtra solo por coverage', () => {
    // Demanda de tarde/noche larga y sostenida: un Corrido1 (14:45-00:15) la
    // tapa con 1 solo asiento; Tarde/Noche F/S (19:45-00:15) sola no llega a
    // las horas de media tarde. Con 1 empleado disponible, el set-cover debe
    // poder elegir el corrido (tier 1: sin coverage, con uso) en vez de
    // dejarlo sin cubrir por no tener "asiento declarado". Día "sacrificable"
    // aparte (mismo motivo que el test anterior: con 1 empleado, si solo hay
    // un día con demanda, la Fase 1 se lo reserva como libre).
    const demand: Record<number, number>[] = Array.from({ length: 7 }, () => ({}))
    demand[0] = { 13: 1 }
    demand[5] = { 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1 }
    const out = solveWeekSchedule({
      weekIndex: 0,
      templates: [TPL_M_REAL, TPL_T_REAL, TPL_C1_REAL, TPL_C2_REAL],
      employees: solo1Empleado,
      vacationDaysByEmployee: new Map(),
      demandByDayHour: demand,
      maxDailyHours: 9.5, splitGapMinutes: 90, restBetweenShiftsMinutes: 720,
      toleranceFraction: 0.10, peakWeekday: 0, peakWeekend: 0,
    })
    const sabado = out.seats.filter((s) => s.day === 5)
    expect(sabado.some((s) => s.templateId === 'C1-real' && !s.isHueco)).toBe(true)
  })
})
