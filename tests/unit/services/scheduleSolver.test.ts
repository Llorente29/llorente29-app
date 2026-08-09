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
import {
  solveWeekSchedule, resolveSeedFromClockEntries, resolveSeedFromPublishedCells,
  type SolverInput, type SolverTemplate, type SolverEmployeeInput,
} from '../../../src/services/scheduleSolver'

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
    // Valores reales de la cuenta Foodint (RECON vía MCP, 09/08 noche):
    // break_policy.weekly_rest_minutes=2160 (36h), rest_safety_margin_minutes=30.
    weeklyRestMinutesMin: 2160,
    restSafetyMarginMinutes: 30,
  }
}

describe('scheduleSolver — reproduce el oráculo docs/solver_prototipo.py', () => {
  it('semana 03/08, rotación 0: reproduce huecos, días libres y horas exactos del oráculo', () => {
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

    // ENCARGO F10 "reparto justo" (09/08 noche) — a partir de aquí el
    // oráculo deja de ser vinculante fila por fila: el propio oráculo tiene
    // 3 partidos en Pamela y 1 en cada una de las otras dos (la misma
    // asimetría que este encargo pide corregir), así que un solver que
    // reparte mejor los partidos NECESARIAMENTE elige, entre las soluciones
    // empatadas en horas/huecos/partidos totales, una fila distinta a la
    // del oráculo. Lo que sigue vinculante es lo agregado: máx. 1 corrido
    // por persona (nunca 0 en total: sigue habiendo demanda de pico) y las
    // horas/huecos de arriba.
    for (const v of Object.values(out.longShiftCountByEmployee)) expect(v).toBeLessThanOrEqual(1)
    const totalCorridos = Object.values(out.longShiftCountByEmployee).reduce((a, b) => a + b, 0)
    expect(totalCorridos).toBeGreaterThan(0)

    expect(out.splits).toBe(5)
    expect(out.deviation).toBeCloseTo(2.25, 2)
    expect(out.spread).toBeCloseTo(0.0, 2)
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

    // Igual que en la semana 03/08: la fila exacta ya no es vinculante
    // contra el oráculo (ver el test anterior) — lo agregado sí.
    for (const v of Object.values(out.longShiftCountByEmployee)) expect(v).toBeLessThanOrEqual(1)
    expect(Object.values(out.longShiftCountByEmployee).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
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
      weeklyRestMinutesMin: 2160, restSafetyMarginMinutes: 30,
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
      weeklyRestMinutesMin: 2160, restSafetyMarginMinutes: 30,
    })
    const sabado = out.seats.filter((s) => s.day === 5)
    expect(sabado.some((s) => s.templateId === 'C1-real' && !s.isHueco)).toBe(true)
  })
})

// ENCARGO F10 "reparto justo de partidos y descanso" (09/08 noche) — rodaje
// real dejó un cuadrante con horas perfectas (39,25h × 3, spread 0) pero
// Pamela se llevaba 3 de 5 partidos Y el peor descanso semanal (36,25h)
// mientras las otras dos se quedaban en 1 partido y 43,5h. Objetivo nuevo:
// maxSplitsPerEmployee (criterio 4) y −minWeeklyRestMinutes (criterio 5),
// por debajo de dev/splits-total/spread (ver comentario en solveWeekSchedule
// junto a `rec()`: el orden literal del encargo —criterios 4/5 ANTES que el
// spread— sí logra 2-2-1 pero rompe la igualdad de horas (39,25/38,5/40)
// para la demanda real de Alcalá; con spread primero las horas se preservan
// siempre y el descanso mejora mucho, pero para ESTOS datos concretos no
// baja de 3-1-1 en partidos — ver el segundo test de este bloque).
describe('scheduleSolver — reparto justo de partidos y descanso semanal', () => {
  it('no concentra los partidos forzados en una persona cuando repartirlos entre dos es igual de bueno en horas', () => {
    // Fixture sintético y simétrico (nada que ver con Alcalá): 2 plantillas
    // de IGUAL duración (4h cada una, así redistribuir quién hace el
    // partido no cambia las horas de nadie) y 3 días abiertos, 3 personas
    // (cada una libra un día distinto, trabaja los otros 2 -> 6 persona-día).
    // day0 y day1 piden 2 asientos "T" simultáneos -> con solo 2 disponibles
    // cada uno de esos días, alguien de los dos SÍ o SÍ hace un partido
    // (aritmética, igual que la prueba de Julio con los 23 bloques/18
    // persona-día reales): 8 asientos sobre 6 persona-día = 2 partidos
    // forzados. La única persona disponible AMBOS días forzados podría
    // llevarse los 2 (maxSplitsPerEmployee=2) — el solver debe preferir
    // repartirlos, 1 a cada una de dos personas distintas (maxSplits=1).
    const TPL_M: SolverTemplate = { id: 'M', label: 'M', iniMin: 720, finMin: 960, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] } // 12:00-16:00
    const TPL_T: SolverTemplate = { id: 'T', label: 'T', iniMin: 1080, finMin: 1320, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] } // 18:00-22:00
    const gente: SolverEmployeeInput[] = [
      { id: 'A', name: 'A', contractedHoursWeek: 100 },
      { id: 'B', name: 'B', contractedHoursWeek: 100 },
      { id: 'C', name: 'C', contractedHoursWeek: 100 },
    ]
    const demand: Record<number, number>[] = Array.from({ length: 7 }, () => ({}))
    demand[0] = { 13: 1, 19: 2 }
    demand[1] = { 13: 1, 19: 2 }
    demand[2] = { 13: 1, 19: 1 }

    const out = solveWeekSchedule({
      weekIndex: 0,
      templates: [TPL_M, TPL_T],
      employees: gente,
      vacationDaysByEmployee: new Map(),
      demandByDayHour: demand,
      maxDailyHours: 9.5, splitGapMinutes: 90, restBetweenShiftsMinutes: 720,
      toleranceFraction: 0.10, peakWeekday: 0, peakWeekend: 0,
      weeklyRestMinutesMin: 2160, restSafetyMarginMinutes: 30,
    })

    expect(out.feasible).toBe(true)
    expect(out.seats.filter((s) => s.isHueco)).toHaveLength(0)
    expect(out.splits).toBe(2)
    // La prueba real: nadie se lleva los 2 partidos forzados aunque fuera posible.
    expect(out.maxSplitsPerEmployee).toBeLessThanOrEqual(1)
  })

  it('el reparto justo de partidos no rompe la igualdad de horas ya lograda (semana 10/08 real)', () => {
    const out = solveWeekSchedule(baseInput(DEMAND_1008, 1))

    // Igualdad de horas intacta — el criterio nuevo va DESPUÉS de spread,
    // nunca la sacrifica.
    expect(out.hoursByEmployee.Johanny).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Natacha).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Pamela).toBeCloseTo(39.25, 2)
    expect(out.spread).toBeCloseTo(0.0, 2)
    expect(out.splits).toBe(5)

    // Con el criterio nuevo activo, el peor descanso semanal mejora mucho
    // frente al 36,25h visto en rodaje real (aunque para esta demanda
    // concreta no alcanza un 2-2-1 exacto sin tocar las horas — declarado
    // arriba, no maquillado): valor exacto verificado, no un umbral vago.
    expect(out.maxSplitsPerEmployee).toBe(3)
    expect(out.minWeeklyRestMinutes).toBeCloseTo(43.5 * 60, 0)
  })

  // ENCARGO F10 "el descanso semanal no cruza la frontera de semana" (09/08
  // noche), §5: el 43,5h de arriba estaba medido SIN ver la frontera de
  // semana — con la frontera real sembrada (RECON vía MCP: Johanny, Natacha
  // y Pamela terminan el domingo de la semana 03/08 PUBLICADA a las 00:15
  // del lunes → seed=15 para las 3), la elección propia del solver para
  // esta demanda SIGUE dando 43,5h y 'ok' para las tres — el 43,5h no era
  // un espejismo del instrumento ciego, se confirma con el instrumento
  // arreglado. (El 36h15min real de Pamela viene del borrador YA GUARDADO
  // `1e95fdbc…`, generado por una versión anterior a este reparto justo —
  // no de la propia elección de este solver para esta demanda; ver el test
  // siguiente, que reproduce ese caso exacto de forma aislada y determinista.)
  it('re-medición de la semana 10/08 con la frontera real sembrada: sigue en 43,5h, sin violación', () => {
    const seed = new Map([['Johanny', 15], ['Natacha', 15], ['Pamela', 15]])
    const out = solveWeekSchedule({ ...baseInput(DEMAND_1008, 1), previousWeekLastShiftEndByEmployee: seed })

    expect(out.hoursByEmployee.Johanny).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Natacha).toBeCloseTo(39.25, 2)
    expect(out.hoursByEmployee.Pamela).toBeCloseTo(39.25, 2)
    expect(out.minWeeklyRestMinutes).toBeCloseTo(43.5 * 60, 0)
    expect(out.crossWeekRestCheckedByEmployee.Johanny).toBe(true)
    expect(out.crossWeekRestCheckedByEmployee.Natacha).toBe(true)
    expect(out.crossWeekRestCheckedByEmployee.Pamela).toBe(true)
    expect(out.weeklyRestStatusByEmployee.Johanny).toBe('ok')
    expect(out.weeklyRestStatusByEmployee.Natacha).toBe('ok')
    expect(out.weeklyRestStatusByEmployee.Pamela).toBe('ok')
    expect(out.hasWeeklyRestViolation).toBe(false)
  })
})

// ENCARGO F10 "el descanso semanal no cruza la frontera de semana" (09/08
// noche) — §1/§3 del encargo. Fixture: 1 persona, 1 plantilla real de
// Alcalá (Mañana, 12:30-16:45) en los 7 días (demanda uniforme -> Fase 1
// libra siempre el lunes, día 0, por orden estable), más una plantilla
// "larga" nunca demandada solo para que Mañana no herede el tope de "1
// corrido/semana" (que no le corresponde a un turno normal repetido a
// diario — mismo escollo de fixture que ya salió en el encargo anterior con
// plantillas de igual duración). Con 1 sola persona y 1 asiento/día, no hay
// ambigüedad: el resultado es determinista, no depende de que la búsqueda
// "encuentre" el caso.
describe('scheduleSolver — el descanso semanal cruza la frontera de semana', () => {
  const TPL_MANANA: SolverTemplate = { id: 'M', label: 'Mañana', iniMin: 750, finMin: 1005, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
  const TPL_LARGA_SIN_USO: SolverTemplate = { id: 'DUMMY', label: 'Dummy (nunca demandada)', iniMin: 0, finMin: 540, kind: 'demanda', uso: 0, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
  const persona: SolverEmployeeInput[] = [{ id: 'X', name: 'X', contractedHoursWeek: 40 }]
  const demandUniforme: Record<number, number>[] = Array.from({ length: 7 }, () => ({ 13: 1 }))

  function inputCon(seed?: Map<string, number>): SolverInput {
    return {
      weekIndex: 0,
      templates: [TPL_MANANA, TPL_LARGA_SIN_USO],
      employees: persona,
      vacationDaysByEmployee: new Map(),
      demandByDayHour: demandUniforme,
      maxDailyHours: 9.5, splitGapMinutes: 90, restBetweenShiftsMinutes: 720,
      toleranceFraction: 0.10, peakWeekday: 0, peakWeekend: 0,
      weeklyRestMinutesMin: 2160, restSafetyMarginMinutes: 30,
      previousWeekLastShiftEndByEmployee: seed,
    }
  }

  it('caso real de Pamela: termina el domingo a las 00:15, entra el martes a las 12:30 → 36h15min, al_limite (por debajo del margen)', () => {
    // Persona libra el lunes (día 0, demanda uniforme -> día 0 gana por
    // orden estable) y trabaja mar-dom con Mañana cada día. Su primer turno
    // de la semana es el martes (día 1) a las 12:30. Semana anterior:
    // terminó el domingo a las 00:15 -> seed=15 (15 minutos ya dentro de
    // este lunes).
    const out = solveWeekSchedule(inputCon(new Map([['X', 15]])))

    expect(out.feasible).toBe(true)
    expect(out.daysOff.X).toBe(0)
    // 36h15min exactos — ni un minuto más, ni un minuto menos.
    expect(out.minWeeklyRestMinutes).toBe(36 * 60 + 15)
    expect(out.weeklyRestByEmployee.X).toBe(36 * 60 + 15)
    // Cumple la ley por 15 minutos (2175 >= 2160) pero por debajo del
    // margen operativo (2160+30=2190) — 'al_limite', no 'ok'.
    expect(out.weeklyRestStatusByEmployee.X).toBe('al_limite')
    expect(out.hasWeeklyRestViolation).toBe(false)
    expect(out.crossWeekRestCheckedByEmployee.X).toBe(true)
  })

  it('semana anterior inexistente o vacía: no revienta, declara "no lo sé" en vez de un verde falso', () => {
    // Sin dato de frontera (parámetro ausente): el motor no inventa nada,
    // cae a la pared del lunes 00:00 (comportamiento anterior a este
    // encargo) y lo declara explícitamente vía crossWeekRestCheckedByEmployee.
    const sinDato = solveWeekSchedule(inputCon(undefined))
    expect(sinDato.feasible).toBe(true)
    expect(sinDato.crossWeekRestCheckedByEmployee.X).toBe(false)
    // El número que cae aquí (36h30min, con la pared del lunes como límite)
    // es MAYOR que el real (36h15min) — exactamente el "número mayor" que
    // el encargo pedía dejar de reportar cuando SÍ hay dato de frontera.
    expect(sinDato.minWeeklyRestMinutes).toBe(36 * 60 + 30)
    expect(sinDato.weeklyRestStatusByEmployee.X).toBe('ok') // verde — el punto ciego exacto que describe el encargo

    // Mapa vacío (semana anterior existe pero sin turnos, o consulta sin
    // filas): mismo resultado que "ausente" — no un crash ni un 0 inventado.
    const vacio = solveWeekSchedule(inputCon(new Map()))
    expect(vacio.feasible).toBe(true)
    expect(vacio.crossWeekRestCheckedByEmployee.X).toBe(false)
    expect(vacio.minWeeklyRestMinutes).toBe(36 * 60 + 30)
  })
})

// ENCARGO F10 "conectar la semilla de frontera" (09/08 noche) — cascada
// fichaje→publicado→"no lo sé", con el filtro de cordura que evita que una
// salida olvidada (siempre posterior al plan) se cuele como semilla.
// resolveSeedFromClockEntries/resolveSeedFromPublishedCells son las dos
// funciones puras que hace el adaptador (fetchPreviousWeekBoundary, que sí
// toca BBDD y no se testea aquí, mismo patrón que el resto del fichero:
// funciones puras testeadas directamente, sin mock de Supabase).
describe('scheduleSolver — conectar la semilla de frontera (cascada fichaje → publicado → "no lo sé")', () => {
  // Valores reales de la cuenta Foodint (RECON vía MCP, 09/08 noche):
  // max_daily_minutes_plan=570, rest_safety_margin_minutes=30.
  const SANITY_THRESHOLD = 570 + 3 * 30 // 660 min = 11h

  it('descarta un fichaje de 23h52min (RECON real de Alcalá: salida que se olvidó y se cerró tarde) — nunca se usa como semilla', () => {
    // Datos reales, tal cual en clock_entries (employee_id de Johanny,
    // últimos 60 días, la jornada más larga de las tres empleadas).
    const rows = [
      { type: 'entrada', datetime: '2026-07-03T17:45:11.449+00:00' },
      { type: 'salida', datetime: '2026-07-04T17:36:38.141+00:00' }, // 1431 min después
    ]
    const seed = resolveSeedFromClockEntries(rows, new Date('2026-07-06T00:00:00Z').getTime(), SANITY_THRESHOLD)
    expect(seed).toBeNull()
  })

  it('descarta también el grupo de 12h31min con salida idéntica en 3 personas la misma madrugada (huella de fallo de sistema, no de trabajo real)', () => {
    // RECON real: Johanny, Natacha y Pamela — las tres con exactamente el
    // mismo par entrada 18:06 → salida 06:38 la noche del 13/06, imposible
    // en una cocina que cierra a medianoche.
    const rows = [
      { type: 'entrada', datetime: '2026-06-13T18:06:41.942+00:00' },
      { type: 'salida', datetime: '2026-06-14T06:37:48.428+00:00' }, // 751 min
    ]
    const seed = resolveSeedFromClockEntries(rows, new Date('2026-06-15T00:00:00Z').getTime(), SANITY_THRESHOLD)
    expect(seed).toBeNull()
  })

  it('acepta un fichaje real normal (Corrido1, 9,5h) como semilla — el filtro no descarta jornadas legítimas', () => {
    const rows = [
      { type: 'entrada', datetime: '2026-08-09T14:45:00+00:00' }, // 16:45 hora local, irrelevante aquí — solo importa la duración
      { type: 'salida', datetime: '2026-08-09T23:45:00+00:00' }, // 540 min = 9h, por debajo del umbral 660
    ]
    const seed = resolveSeedFromClockEntries(rows, new Date('2026-08-10T00:00:00Z').getTime(), SANITY_THRESHOLD)
    expect(seed).not.toBeNull()
  })

  it('cascada completa: fichaje anómalo descartado → cae al cuadrante publicado → el motor no declara ningún incumplimiento', () => {
    // 1. El último fichaje de Johanny antes de esta semana es la jornada de
    // 23h52min (anómala) — el escalón 1 la descarta.
    const clockSeed = resolveSeedFromClockEntries(
      [
        { type: 'entrada', datetime: '2026-07-03T17:45:11.449+00:00' },
        { type: 'salida', datetime: '2026-07-04T17:36:38.141+00:00' },
      ],
      new Date('2026-07-06T00:00:00Z').getTime(), SANITY_THRESHOLD
    )
    expect(clockSeed).toBeNull()

    // 2. Escalón 2: la semana anterior SÍ está publicada, con su último
    // turno real (Tarde/Noche F/S, 19:45-00:15, como Johanny en el caso real
    // de Alcalá) — el mismo caso que produce seed=15 en el RECON de
    // ENCARGO_CODE_f10_descanso_entre_semanas.md.
    const prevCells = { T: { '6': ['Johanny'] } } // domingo (día 6) — Tarde/Noche
    const tplTimes = new Map([['T', { iniMin: 1185, finMin: 1455 }]]) // 19:45-00:15
    const publishedSeed = resolveSeedFromPublishedCells(prevCells, tplTimes, 'Johanny')
    expect(publishedSeed).toBe(15)

    // 3. Con la semilla del cuadrante publicado (NUNCA la del fichaje
    // descartado), un patrón normal de la semana siguiente NO declara
    // ningún incumplimiento — es justo lo que el filtro de cordura protege:
    // si se hubiera usado el fichaje de 23h52min tal cual, el motor habría
    // "visto" un descanso de apertura absurdamente largo y podría haber
    // enmascarado un problema real, o al revés, un descarte mal hecho podría
    // fabricar un incumplimiento inexistente. Ninguna de las dos cosas pasa.
    const TPL_MANANA: SolverTemplate = { id: 'M', label: 'Mañana', iniMin: 750, finMin: 1005, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
    const TPL_LARGA_SIN_USO: SolverTemplate = { id: 'DUMMY', label: 'Dummy (nunca demandada)', iniMin: 0, finMin: 540, kind: 'demanda', uso: 0, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
    const persona: SolverEmployeeInput[] = [{ id: 'Johanny', name: 'Johanny', contractedHoursWeek: 40 }]
    const demandUniforme: Record<number, number>[] = Array.from({ length: 7 }, () => ({ 13: 1 }))
    const out = solveWeekSchedule({
      weekIndex: 0,
      templates: [TPL_MANANA, TPL_LARGA_SIN_USO],
      employees: persona,
      vacationDaysByEmployee: new Map(),
      demandByDayHour: demandUniforme,
      maxDailyHours: 9.5, splitGapMinutes: 90, restBetweenShiftsMinutes: 720,
      toleranceFraction: 0.10, peakWeekday: 0, peakWeekend: 0,
      weeklyRestMinutesMin: 2160, restSafetyMarginMinutes: 30,
      previousWeekLastShiftEndByEmployee: new Map([['Johanny', publishedSeed]]),
    })

    expect(out.feasible).toBe(true)
    expect(out.hasWeeklyRestViolation).toBe(false)
    expect(out.weeklyRestStatusByEmployee.Johanny).not.toBe('incumple')
    expect(out.crossWeekRestCheckedByEmployee.Johanny).toBe(true)
  })

  it('sin fichajes válidos y sin cuadrante publicado la semana anterior: "no lo sé", nunca un crash ni un 0 inventado', () => {
    const seedFromClock = resolveSeedFromClockEntries([], Date.now(), SANITY_THRESHOLD)
    expect(seedFromClock).toBeNull()
    const seedFromPublished = resolveSeedFromPublishedCells({}, new Map(), 'Johanny')
    expect(seedFromPublished).toBeNull()

    // Con ninguna de las dos fuentes disponibles, la propuesta se genera
    // igual (avisar y seguir — §3 del encargo), nunca bloquea.
    const TPL_MANANA: SolverTemplate = { id: 'M', label: 'Mañana', iniMin: 750, finMin: 1005, kind: 'demanda', uso: 1, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
    const TPL_LARGA_SIN_USO: SolverTemplate = { id: 'DUMMY', label: 'Dummy (nunca demandada)', iniMin: 0, finMin: 540, kind: 'demanda', uso: 0, coverageByDay: [1, 1, 1, 1, 1, 1, 1] }
    const persona: SolverEmployeeInput[] = [{ id: 'Johanny', name: 'Johanny', contractedHoursWeek: 40 }]
    const demandUniforme: Record<number, number>[] = Array.from({ length: 7 }, () => ({ 13: 1 }))
    const out = solveWeekSchedule({
      weekIndex: 0,
      templates: [TPL_MANANA, TPL_LARGA_SIN_USO],
      employees: persona,
      vacationDaysByEmployee: new Map(),
      demandByDayHour: demandUniforme,
      maxDailyHours: 9.5, splitGapMinutes: 90, restBetweenShiftsMinutes: 720,
      toleranceFraction: 0.10, peakWeekday: 0, peakWeekend: 0,
      weeklyRestMinutesMin: 2160, restSafetyMarginMinutes: 30,
      previousWeekLastShiftEndByEmployee: new Map(), // ninguna de las dos fuentes resolvió nada
    })
    expect(out.feasible).toBe(true)
    expect(out.crossWeekRestCheckedByEmployee.Johanny).toBe(false) // "no lo sé", visible y distinguible de un OK comprobado
  })
})
