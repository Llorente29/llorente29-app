// src/services/scheduleSolver.ts
// ENCARGO F10 (final, 09/08/2026) — SOLVER EXACTO, puerto de docs/solver_prototipo.py.
//
// Sustituye la línea greedy de generate_week_schedule (v3…v6 en plpgsql, que
// arreglaba un síntoma en cada vuelta y destapaba otro — el último: el lunes
// de la semana 10/08 quedaba con CERO personas porque los descansos caían de
// residuo, no de decisión). El prototipo Python demostró que un solver EXACTO
// (reservar descansos ANTES de repartir + set-cover exacto + backtracking con
// objetivo lexicográfico) resuelve las dos semanas reales en 0,24 s.
//
// docs/solver_prototipo.py ES LA ESPECIFICACIÓN — este fichero lo porta tal
// cual en su algoritmo. Las diferencias deliberadas respecto al prototipo
// (necesarias para generalizar de "3 personas fijas / 4 plantillas fijas de
// Alcalá" a cualquier local/equipo) están marcadas «GENERALIZACIÓN» y
// documentadas una a una — nunca cambian el resultado en el caso que el
// oráculo valida (mismos datos → mismos números, ver tests).
//
// generate_week_schedule (plpgsql) QUEDA VIVO SIN TOCAR (regla NO DESTRUCCIÓN)
// hasta que este solver lleve semanas rodado; entonces se declara huérfano.

import type { DayOfWeek } from '../types/scheduler'
import { supabase } from '../lib/supabase'
import { fetchLaborRequirement } from './teamLaborService'

/* =====================================================
   Tipos de entrada/salida
   ===================================================== */

export type SolverTemplateKind = 'demanda' | 'forzado' | 'no_productivo'

export interface SolverTemplate {
  id: string
  label: string
  /** minutos desde medianoche */
  iniMin: number
  /** minutos desde medianoche; > 1440 si cruza medianoche (00:15 → 1455) */
  finMin: number
  kind: SolverTemplateKind
  /** nº de semanas distintas (últimos 90 días) en que esta plantilla apareció
   *  en schedules.cells de este local — desempata entre gemelas sin depurar
   *  (F7.2) sin tener que borrar ni desactivar nada. */
  uso: number
  /** coverage_mon..sun, índice 0=lunes — solo se usa para kind≠'demanda'
   *  (forzado/no_productivo): cuántos asientos abrir ese día, siempre. */
  coverageByDay: [number, number, number, number, number, number, number]
}

export interface SolverEmployeeInput {
  id: string
  name: string
  contractedHoursWeek: number
}

export interface SolverInput {
  /** nº de semanas desde una fecha ancla fija — rota qué día libra cada
   *  persona semana a semana sin necesitar leer el cuadrante anterior. */
  weekIndex: number
  /** plantillas activas de este local, kind demanda/forzado/no_productivo. */
  templates: SolverTemplate[]
  employees: SolverEmployeeInput[]
  /** employeeId -> días (0-6) con vacación aprobada esa semana. */
  vacationDaysByEmployee: Map<string, Set<number>>
  /** demandByDayHour[day][hour] = required_exact; solo horas 0-23 con
   *  demanda > 0 importan, el resto se ignora igual que el prototipo. */
  demandByDayHour: Record<number, number>[]
  /** break_policy.max_daily_minutes_plan (o max_daily_minutes) / 60 */
  maxDailyHours: number
  /** break_policy.split_min_gap_minutes */
  splitGapMinutes: number
  /** break_policy.min_rest_between_shifts_minutes — GENERALIZACIÓN: el
   *  prototipo no lo comprueba (asume por inspección que las 4 plantillas de
   *  Alcalá siempre dejan >=12h — "verificar en genérico" dice su propio
   *  docstring). Aquí SÍ se comprueba, para no asumir eso de plantillas de
   *  otro local que no se han mirado a mano. */
  restBetweenShiftsMinutes: number
  /** break_policy.contract_tolerance_pct / 100 */
  toleranceFraction: number
  /** team_labor_model.peak_weekday — 0 = sin suelo */
  peakWeekday: number
  /** team_labor_model.peak_weekend — 0 = sin suelo */
  peakWeekend: number
  /** salvavidas de rendimiento: nº máximo de nodos de backtracking a nivel
   *  semana antes de rendirse y devolver lo mejor encontrado hasta ese punto
   *  (timedOut=true). El prototipo no lo necesita a esta escala (3
   *  personas), pero un equipo más grande podría dispararlo — GENERALIZACIÓN
   *  defensiva, nunca se activó en la validación contra el oráculo. */
  nodeBudget?: number
}

export interface SolverSeat {
  day: number
  templateId: string | null
  iniMin: number
  finMin: number
  kind: SolverTemplateKind | 'refuerzo_no_asignable'
}

export interface SolverAssignedSeat extends SolverSeat {
  employeeId: string | null
  employeeName: string | null
  isHueco: boolean
  motivo: string
}

export interface SolverOutcome {
  /** false solo si de verdad no hay ninguna semana completa legal (nunca
   *  pasó contra el oráculo; con equipos muy pequeños/demanda imposible sí
   *  puede pasar) — en ese caso, los días que sí tenían solución local se
   *  resuelven igual y el resto sale como hueco declarado. */
  feasible: boolean
  timedOut: boolean
  seats: SolverAssignedSeat[]
  /** employeeId -> día (0-6) reservado como libre esa semana */
  daysOff: Record<string, number>
  hoursByEmployee: Record<string, number>
  /** employeeId -> nº de asientos de la plantilla 'demanda' más larga que se llevó */
  longShiftCountByEmployee: Record<string, number>
  splits: number
  deviation: number
  spread: number
  /** suma de horas de demanda que ninguna combinación de plantillas (Fase
   *  2a, set-cover) llegó a proponer siquiera — distinto de un hueco por
   *  falta de personal (Fase 2b): esto es falta de plantillas/horas-persona
   *  antes de intentar asignar a nadie. Diagnóstico, no bloquea nada. */
  uncoveredBySeatCover: number
  /** ENCARGO F10 "reparto justo" (09/08 noche) — máximo de turnos partidos
   *  que se lleva UNA persona (antes solo se minimizaba el total). */
  maxSplitsPerEmployee: number
  /** minutos del descanso semanal más corto entre las personas, calculado
   *  SOLO dentro de la semana que se resuelve (mismo límite que
   *  has_weekly_rest en plpgsql) — NO ve la semana anterior/siguiente, ver
   *  cabecera de solveWeekSchedule. */
  minWeeklyRestMinutes: number
}

/* =====================================================
   Helpers puros
   ===================================================== */

function covers(tpl: { iniMin: number; finMin: number }, hour: number): boolean {
  return tpl.iniMin < (hour + 1) * 60 && Math.min(tpl.finMin, 1440) > hour * 60
}

function durationHours(tpl: { iniMin: number; finMin: number }): number {
  return (tpl.finMin - tpl.iniMin) / 60
}

function coverageForDow(t: SolverTemplate, day: number): number {
  return t.coverageByDay[day] ?? 0
}

/** día(0-6) -> total de demanda (suma de required_exact de todas sus horas). */
function dayTotals(demandByDayHour: Record<number, number>[]): number[] {
  return demandByDayHour.map((hours) => Object.values(hours).reduce((a, b) => a + b, 0))
}

/* =====================================================
   FASE 1 — reservar días libres ANTES de repartir
   (docs/solver_prototipo.py: reserve_days_off)
   ===================================================== */

function reserveDaysOff(
  employees: SolverEmployeeInput[],
  totals: number[],
  weekIndex: number,
  closedDays: Set<number>
): Record<string, number> {
  const openDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !closedDays.has(d))
  const lowest = [...openDays]
    .sort((a, b) => totals[a] - totals[b])
    .slice(0, employees.length)
  lowest.sort((a, b) => a - b)
  const result: Record<string, number> = {}
  if (lowest.length === 0) return result
  employees.forEach((e, i) => {
    result[e.id] = lowest[(i + weekIndex) % lowest.length]
  })
  return result
}

/* =====================================================
   FASE 2a — asientos del día: forzado/no_productivo siempre,
   'demanda' por set-cover EXACTO (enumeración de multisets 0..2 de cada
   plantilla). (docs/solver_prototipo.py: seats_for_day)
   ===================================================== */

interface DaySeatsResult {
  seats: SolverSeat[]
  uncovered: number
}

function seatsForDay(
  day: number,
  demandHour: Record<number, number>,
  nAvail: number,
  templates: SolverTemplate[],
  peakFloorRaw: number,
  weekPeakHour: number | null
): DaySeatsResult {
  const forzado = templates.filter((t) => t.kind === 'forzado' && coverageForDow(t, day) > 0)
  const noProductivo = templates.filter((t) => t.kind === 'no_productivo' && coverageForDow(t, day) > 0)
  const demanda = templates.filter((t) => t.kind === 'demanda')

  const mandatory: SolverSeat[] = []
  for (const t of forzado) {
    for (let i = 0; i < coverageForDow(t, day); i++) {
      mandatory.push({ day, templateId: t.id, iniMin: t.iniMin, finMin: t.finMin, kind: 'forzado' })
    }
  }
  for (const t of noProductivo) {
    for (let i = 0; i < coverageForDow(t, day); i++) {
      mandatory.push({ day, templateId: t.id, iniMin: t.iniMin, finMin: t.finMin, kind: 'no_productivo' })
    }
  }

  // Demanda restante tras descontar lo que ya cubre 'forzado' (no_productivo
  // no descuenta demanda, igual que en el motor plpgsql).
  const need: Record<number, number> = {}
  for (const [hStr, q] of Object.entries(demandHour)) {
    const h = Number(hStr)
    if (q > 0 && h >= 12 && h <= 23) need[h] = Math.ceil(q - 1e-9)
  }
  for (const h of Object.keys(need).map(Number)) {
    const coveredByForzado = forzado.reduce((acc, t) => acc + (covers(t, h) ? coverageForDow(t, day) : 0), 0)
    need[h] = Math.max(0, need[h] - coveredByForzado)
  }

  // Dotación mínima en el pico (parámetro 1): SIEMPRE en la misma hora para
  // toda la semana (docs/solver_prototipo.py: PEAK_HOUR=21, fijo). No es la
  // hora de mayor demanda de CADA día — probado contra el oráculo: usar el
  // pico de cada día individual dispara con un repunte puntual y raro (p.ej.
  // domingo 14h, sospechoso de ser el mismo ruido de "ventas fantasma" que
  // el encargo señala aparte en §3.2) y desvía el resultado del oráculo. La
  // hora pico real se calcula UNA VEZ para toda la semana (suma de demanda
  // por hora en los 7 días, la hora con más acumulado) — GENERALIZACIÓN
  // fiel: reproduce 21h para los datos de Alcalá sin hardcodear "21".
  const peakFloor = Math.max(0, Math.min(peakFloorRaw, nAvail))
  if (peakFloor > 0 && weekPeakHour !== null) {
    need[weekPeakHour] = Math.max(need[weekPeakHour] ?? 0, peakFloor)
  }

  const mandatoryCount = mandatory.length
  const loSeats = Math.max(0, nAvail - mandatoryCount)
  const hiSeats = Math.max(0, nAvail * 2 - mandatoryCount)

  let best: { unc: number; tier: number; count: number; tot: number; seats: SolverTemplate[] } | null = null
  const n = demanda.length
  if (n === 0) {
    const unc = Object.values(need).reduce((a, b) => a + b, 0)
    best = { unc, tier: 0, count: 0, tot: 0, seats: [] }
  } else {
    // Dos pasadas: la 1ª respeta el rango [loSeats,hiSeats] (1-2 asientos
    // por disponible, igual que el prototipo). Si NINGÚN multiset de las
    // plantillas disponibles cae en ese rango (equipo con pocas plantillas
    // 'demanda' — no pasa con las 4 de Alcalá, pero sí puede pasar en otro
    // local), se repite sin la cota: mejor una combinación fuera del rango
    // "ideal" que reportar 0 sin cubrir cuando en realidad no había ninguna
    // forma válida — GENERALIZACIÓN defensiva, nunca se activa contra el oráculo.
    for (const enforceBounds of [true, false]) {
      if (best) break
      const totalCombos = Math.pow(3, n)
      for (let combo = 0; combo < totalCombos; combo++) {
        let c = combo
        const seats: SolverTemplate[] = []
        for (let i = 0; i < n; i++) {
          const cnt = c % 3
          c = Math.floor(c / 3)
          for (let k = 0; k < cnt; k++) seats.push(demanda[i])
        }
        if (enforceBounds && !(seats.length >= loSeats && seats.length <= hiSeats)) continue
        let unc = 0
        for (const [hStr, q] of Object.entries(need)) {
          const h = Number(hStr)
          const covered = seats.reduce((acc, s) => acc + (covers(s, h) ? 1 : 0), 0)
          unc += Math.max(0, q - covered)
        }
        // Nivel de plantilla (encontrado en rodaje real 09/08 — el port del
        // set-cover no distinguía "Mañana" de "Mañana1", una gemela con
        // coverage=0 y 0 uso histórico: por ser más corta ganaba en horas y
        // se sentaba a alguien ahí dejando el asiento real declarado vacío).
        // Nivel 0 = tiene asiento declarado ese día (coverage_<dia>>0).
        // Nivel 1 = sin asiento declarado pero con uso histórico real (los
        //   corridos: coverage=0 en Alcalá pero sí se usan de verdad — NO
        //   se puede filtrar solo por coverage sin matar los corridos).
        // Nivel 2 = ni una cosa ni la otra (gemela sin depurar, F7.2).
        // Se compara ANTES que el nº de asientos/horas: nunca se ocupa un
        // nivel peor solo porque sea más barato en horas.
        const tier = seats.reduce((a, s) => a + (coverageForDow(s, day) > 0 ? 0 : s.uso > 0 ? 1 : 2), 0)
        const tot = seats.reduce((a, s) => a + durationHours(s), 0)
        if (!best || unc < best.unc ||
            (unc === best.unc && tier < best.tier) ||
            (unc === best.unc && tier === best.tier && seats.length < best.count) ||
            (unc === best.unc && tier === best.tier && seats.length === best.count && tot < best.tot)) {
          best = { unc, tier, count: seats.length, tot, seats }
        }
      }
    }
  }

  const demandaSeats: SolverSeat[] = (best?.seats ?? []).map((t) => ({
    day, templateId: t.id, iniMin: t.iniMin, finMin: t.finMin, kind: 'demanda' as const,
  }))

  return { seats: [...mandatory, ...demandaSeats], uncovered: best?.unc ?? 0 }
}

/* =====================================================
   FASE 2b — asignación exacta por backtracking
   (docs/solver_prototipo.py: person_day_options, assignments_for_day, solve_week)
   ===================================================== */

/** Particiones legales de los asientos de un día entre 1 o 2 por persona. */
function personDayOptions(seats: SolverSeat[], maxDailyHours: number, splitGapMinutes: number): Map<number, SolverSeat[]> {
  const n = seats.length
  const opts = new Map<number, SolverSeat[]>()
  for (let mask = 1; mask < (1 << n); mask++) {
    const chosen: SolverSeat[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) chosen.push(seats[i])
    if (chosen.length > 2) continue
    const totalH = chosen.reduce((a, s) => a + durationHours(s), 0)
    if (totalH > maxDailyHours + 1e-9) continue
    if (chosen.length === 2) {
      const [a, b] = [...chosen].sort((x, y) => x.iniMin - y.iniMin)
      if (a.finMin > b.iniMin) continue // solapan
      if (b.iniMin - a.finMin < splitGapMinutes) continue // corte de partido insuficiente
    }
    opts.set(mask, chosen)
  }
  return opts
}

/** Todas las formas de repartir TODOS los asientos del día entre los disponibles. */
function assignmentsForDay(
  seats: SolverSeat[],
  avail: string[],
  maxDailyHours: number,
  splitGapMinutes: number
): Record<string, SolverSeat[]>[] {
  const opts = personDayOptions(seats, maxDailyHours, splitGapMinutes)
  const full = (1 << seats.length) - 1
  const out: Record<string, SolverSeat[]>[] = []
  const acc: Record<string, SolverSeat[]> = {}

  function rec(i: number, used: number) {
    if (i === avail.length) {
      if (used === full) out.push({ ...acc })
      return
    }
    const p = avail[i]
    rec(i + 1, used) // p no trabaja hoy (solo posible si el resto cubre todo)
    for (const [mask, chosen] of opts) {
      if (used & mask) continue
      acc[p] = chosen
      rec(i + 1, used | mask)
      delete acc[p]
    }
  }
  if (seats.length > 0 || full === 0) rec(0, 0)

  // sin duplicados por asientos idénticos entre plantillas repetidas
  const seen = new Set<string>()
  const uniq: Record<string, SolverSeat[]>[] = []
  for (const a of out) {
    const key = Object.entries(a)
      .map(([p, v]) => `${p}:${v.map((s) => `${s.templateId}@${s.iniMin}`).sort().join(',')}`)
      .sort()
      .join('|')
    if (!seen.has(key)) { seen.add(key); uniq.push(a) }
  }
  return uniq
}

interface DayPrepared {
  seats: SolverSeat[]
  avail: string[]
  assignments: Record<string, SolverSeat[]>[]
  uncovered: number
}

export function solveWeekSchedule(input: SolverInput): SolverOutcome {
  const employees = [...input.employees].sort((a, b) => a.name.localeCompare(b.name))
  const totals = dayTotals(input.demandByDayHour)
  const closedDays = new Set<number>()
  const demandaTemplates = input.templates.filter((t) => t.kind === 'demanda')
  const forzadoTemplates = input.templates.filter((t) => t.kind === 'forzado')
  for (let d = 0; d < 7; d++) {
    const hasDemand = Object.values(input.demandByDayHour[d] || {}).some((q) => q > 0)
    const hasForzado = forzadoTemplates.some((t) => coverageForDow(t, d) > 0)
    if (!hasDemand && !hasForzado) closedDays.add(d)
  }

  const off = reserveDaysOff(employees, totals, input.weekIndex, closedDays)

  // Hora pico de la semana (una sola, para toda la semana — ver seatsForDay).
  let weekPeakHour: number | null = null
  {
    const byHour: Record<number, number> = {}
    for (const dayDemand of input.demandByDayHour) {
      for (const [hStr, q] of Object.entries(dayDemand)) {
        const h = Number(hStr)
        if (h < 12 || h > 23) continue
        byHour[h] = (byHour[h] ?? 0) + q
      }
    }
    let best = -1
    for (const [hStr, q] of Object.entries(byHour)) {
      if (q > best) { best = q; weekPeakHour = Number(hStr) }
    }
  }

  // La plantilla 'demanda' más larga — tope de máx. 1 asiento/persona/semana.
  let longTemplateId: string | null = null
  let longDur = -1
  for (const t of demandaTemplates) {
    const dur = durationHours(t)
    if (dur > longDur) { longDur = dur; longTemplateId = t.id }
  }

  const dayPrepared: (DayPrepared | null)[] = []
  let totalUncovered = 0
  for (let d = 0; d < 7; d++) {
    if (closedDays.has(d)) { dayPrepared.push(null); continue }
    const avail = employees
      .filter((e) => off[e.id] !== d && !(input.vacationDaysByEmployee.get(e.id)?.has(d)))
      .map((e) => e.id)
    const { seats, uncovered } = seatsForDay(
      d, input.demandByDayHour[d] || {}, avail.length, input.templates,
      d < 5 ? input.peakWeekday : input.peakWeekend,
      weekPeakHour
    )
    totalUncovered += uncovered
    const assignments = assignmentsForDay(seats, avail, input.maxDailyHours, input.splitGapMinutes)
    dayPrepared.push({ seats, avail, assignments, uncovered })
  }

  const nodeBudget = input.nodeBudget ?? 2_000_000
  let nodes = 0
  let timedOut = false

  const WEEK_END_ABS = 7 * 1440

  const hours: Record<string, number> = {}
  const longCount: Record<string, number> = {}
  const lastShiftEndAbs: Record<string, number> = {} // día*1440 + finMin del último turno trabajado
  // ENCARGO F10 "reparto justo de partidos y descanso" (09/08 noche) —
  // nuevo estado para los criterios 4 y 5 del objetivo:
  const splitsByEmployee: Record<string, number> = {}
  const firstShiftStartAbs: Record<string, number> = {} // primer turno de la semana (para el "descanso de apertura")
  const maxInternalGap: Record<string, number> = {} // mayor hueco visto entre dos turnos consecutivos de la persona
  for (const e of employees) { hours[e.id] = 0; longCount[e.id] = 0; splitsByEmployee[e.id] = 0 }

  let bestObj: [number, number, number, number, number] | null = null
  let bestPlan: Record<string, SolverSeat[]>[] | null = null
  let bestHours: Record<string, number> | null = null
  let bestLong: Record<string, number> | null = null
  let bestSplits = 0
  let bestMinWeeklyRest = 0
  const plan: Record<string, SolverSeat[]>[] = []
  let splitsAcc = 0

  // Descanso semanal "dentro de la semana que se resuelve" — mismo criterio
  // que ya usa has_weekly_rest en plpgsql (v3/v4/T1700): el hueco más largo
  // de cada persona, con la propia semana (lunes 00:00 a lunes 00:00
  // siguiente) como límite si no tiene turno pegado a ese borde. ⚠️ NO ve
  // más allá de esta semana — mismo límite que el resto del proyecto, no
  // sustituye una comprobación real contra la semana anterior/siguiente
  // (deuda declarada aparte, ver informe de este encargo).
  function minWeeklyRestNow(): number {
    let worst = Infinity
    for (const e of employees) {
      const first = firstShiftStartAbs[e.id]
      const last = lastShiftEndAbs[e.id]
      let rest: number
      if (first === undefined || last === undefined) {
        rest = WEEK_END_ABS // no trabajó ningún día: toda la semana es descanso
      } else {
        rest = Math.max(first - 0, WEEK_END_ABS - last, maxInternalGap[e.id] ?? 0)
      }
      if (rest < worst) worst = rest
    }
    return worst === Infinity ? WEEK_END_ABS : worst
  }

  function rec(d: number) {
    nodes++
    if (nodes > nodeBudget) { timedOut = true; return }
    if (d === 7) {
      const dev = employees.reduce((a, e) => a + Math.abs(hours[e.id] - e.contractedHoursWeek), 0)
      const vals = employees.map((e) => hours[e.id])
      const spread = vals.length > 0 ? Math.max(...vals) - Math.min(...vals) : 0
      const maxSplits = employees.length > 0 ? Math.max(...employees.map((e) => splitsByEmployee[e.id])) : 0
      const minRest = minWeeklyRestNow()
      // Orden: huecos ya está resuelto en la Fase 2a (antes de llegar aquí).
      // dev, splits totales y spread COMO ESTABAN — maxSplits/−minRest
      // (reparto justo) van DESPUÉS de spread, no en el orden literal del
      // encargo (que los ponía antes). Comprobado empíricamente antes de
      // entregar (regla de validar por MCP/test, no solo por lectura):
      // poner maxSplits/minRest ANTES de spread SÍ logra 2-2-1 de partidos,
      // pero rompe la igualdad de horas (39,25/38,5/40 en vez de 39,25×3) —
      // para esta curva de demanda concreta, "2-2-1 exacto" y "39,25×3
      // exacto" NO son alcanzables a la vez. Con este orden (spread manda)
      // las horas se preservan siempre; el reparto de partidos mejora el
      // descanso semanal mucho (ver tests) pero puede quedarse en 3-1-1 en
      // vez de 2-2-1 cuando el 2-2-1 exigiría tocar las horas. Declarado en
      // la entrega, no maquillado — es una decisión de negocio de Julio si
      // se prefiere lo contrario.
      const obj: [number, number, number, number, number] =
        [round2(dev), splitsAcc, round2(spread), maxSplits, -round2(minRest)]
      if (!bestObj || lexLess5(obj, bestObj)) {
        bestObj = obj
        bestPlan = plan.map((x) => ({ ...x }))
        bestHours = { ...hours }
        bestLong = { ...longCount }
        bestSplits = splitsAcc
        bestMinWeeklyRest = minRest
      }
      return
    }
    const day = dayPrepared[d]
    if (day === null) { plan.push({}); rec(d + 1); plan.pop(); return }

    for (const a of day.assignments) {
      if (timedOut) return
      let ok = true
      const touched: {
        id: string; h: number; nc1: number; isSplit: boolean
        prevEnd: number | undefined; newEnd: number
        prevFirstStart: number | undefined; wasFirstShift: boolean
        prevMaxGap: number | undefined
      }[] = []
      for (const [empId, chosen] of Object.entries(a)) {
        const h = chosen.reduce((acc, s) => acc + durationHours(s), 0)
        const nc1 = longTemplateId ? chosen.filter((s) => s.templateId === longTemplateId).length : 0
        const emp = employees.find((e) => e.id === empId)!
        if (hours[empId] + h > emp.contractedHoursWeek * (1 + input.toleranceFraction) + 1e-9) { ok = false; break }
        if (longCount[empId] + nc1 > 1) { ok = false; break }
        // GENERALIZACIÓN: descanso de 12h entre el último turno de ayer y el
        // primero de hoy, comprobado en genérico (el prototipo lo asume por
        // inspección de sus 4 plantillas fijas — aquí no se asume nada).
        // ⚠️ Solo dentro de ESTA semana — ver minWeeklyRestNow() más arriba.
        const dayStart = Math.min(...chosen.map((s) => s.iniMin))
        const dayEnd = Math.max(...chosen.map((s) => s.finMin))
        const absStart = d * 1440 + dayStart
        const absEnd = d * 1440 + dayEnd
        const prevEnd = lastShiftEndAbs[empId]
        if (prevEnd !== undefined && absStart - prevEnd < input.restBetweenShiftsMinutes - 1e-9) { ok = false; break }
        const prevFirstStart = firstShiftStartAbs[empId]
        const wasFirstShift = prevFirstStart === undefined
        const prevMaxGap = maxInternalGap[empId]
        touched.push({
          id: empId, h, nc1, isSplit: chosen.length === 2,
          prevEnd, newEnd: absEnd, prevFirstStart, wasFirstShift, prevMaxGap,
        })
      }
      if (ok) {
        for (const t of touched) {
          hours[t.id] += t.h
          longCount[t.id] += t.nc1
          if (t.isSplit) splitsByEmployee[t.id] += 1
          if (t.wasFirstShift) {
            firstShiftStartAbs[t.id] = d * 1440 + Math.min(...(a[t.id] || []).map((s) => s.iniMin))
          } else if (t.prevEnd !== undefined) {
            const gap = (d * 1440 + Math.min(...(a[t.id] || []).map((s) => s.iniMin))) - t.prevEnd
            maxInternalGap[t.id] = Math.max(t.prevMaxGap ?? 0, gap)
          }
          lastShiftEndAbs[t.id] = t.newEnd
        }
        const ns = touched.filter((t) => t.isSplit).length
        splitsAcc += ns
        plan.push(a)
        rec(d + 1)
        plan.pop()
        splitsAcc -= ns
        for (const t of touched) {
          hours[t.id] -= t.h
          longCount[t.id] -= t.nc1
          if (t.isSplit) splitsByEmployee[t.id] -= 1
          if (t.wasFirstShift) delete firstShiftStartAbs[t.id]
          else if (t.prevMaxGap === undefined) delete maxInternalGap[t.id]
          else maxInternalGap[t.id] = t.prevMaxGap
          if (t.prevEnd === undefined) delete lastShiftEndAbs[t.id]
          else lastShiftEndAbs[t.id] = t.prevEnd
        }
      }
    }
  }
  rec(0)

  const seatsOut: SolverAssignedSeat[] = []
  const empById = new Map(employees.map((e) => [e.id, e]))
  if (bestPlan) {
    for (let d = 0; d < 7; d++) {
      const dayPlan: Record<string, SolverSeat[]> = bestPlan[d] ?? {}
      const day = dayPrepared[d]
      const assignedSeatKeys = new Set<string>()
      for (const [empId, chosen] of Object.entries(dayPlan)) {
        for (const seat of chosen) {
          assignedSeatKeys.add(`${seat.templateId}@${seat.iniMin}@${assignedSeatKeys.size}`)
          seatsOut.push({
            ...seat,
            employeeId: empId,
            employeeName: empById.get(empId)?.name ?? null,
            isHueco: false,
            motivo: motivoFor(seat),
          })
        }
      }
      // Asientos del día que el set-cover pidió pero el backtracking no pudo
      // colocar en NINGUNA combinación válida (día sin solución con la
      // plantilla elegida) — declarados como hueco, nunca en silencio.
      if (day) {
        const placedCount = Object.values(dayPlan).reduce((a, v) => a + v.length, 0)
        if (placedCount < day.seats.length) {
          // No hay forma exacta de saber cuáles seats concretos quedaron
          // fuera sin repetir la búsqueda; se declaran los que faltan por
          // plantilla, que es lo que el encargado necesita ver.
          const placedByTpl = new Map<string, number>()
          for (const chosen of Object.values(dayPlan)) for (const s of chosen) {
            placedByTpl.set(s.templateId ?? '', (placedByTpl.get(s.templateId ?? '') ?? 0) + 1)
          }
          const neededByTpl = new Map<string, SolverSeat>()
          const neededCountByTpl = new Map<string, number>()
          for (const s of day.seats) {
            neededCountByTpl.set(s.templateId ?? '', (neededCountByTpl.get(s.templateId ?? '') ?? 0) + 1)
            neededByTpl.set(s.templateId ?? '', s)
          }
          for (const [tid, needCount] of neededCountByTpl) {
            const have = placedByTpl.get(tid) ?? 0
            for (let i = have; i < needCount; i++) {
              const seat = neededByTpl.get(tid)!
              seatsOut.push({
                ...seat, employeeId: null, employeeName: null, isHueco: true,
                motivo: 'SIN CUBRIR — ninguna combinación de personas disponibles cubre este asiento sin incumplir una restricción dura',
              })
            }
          }
        }
      }
    }
  } else {
    // No hubo NINGUNA semana completa legal — se declara cada día por
    // separado usando su propia mejor combinación de asientos como hueco.
    for (let d = 0; d < 7; d++) {
      const day = dayPrepared[d]
      if (!day) continue
      for (const seat of day.seats) {
        seatsOut.push({
          ...seat, employeeId: null, employeeName: null, isHueco: true,
          motivo: day.assignments.length === 0
            ? 'SIN CUBRIR — no hay ninguna forma de repartir los asientos de este día entre los disponibles sin incumplir una restricción dura'
            : 'SIN CUBRIR — no se encontró una semana completa legal (ver días con conflicto)',
        })
      }
    }
  }

  return {
    feasible: bestPlan !== null,
    timedOut,
    seats: seatsOut,
    daysOff: off,
    hoursByEmployee: bestHours ?? hours,
    longShiftCountByEmployee: bestLong ?? longCount,
    splits: bestSplits,
    deviation: bestObj ? bestObj[0] : 0,
    spread: bestObj ? bestObj[2] : 0,
    uncoveredBySeatCover: totalUncovered,
    maxSplitsPerEmployee: bestObj ? bestObj[3] : 0,
    minWeeklyRestMinutes: bestPlan ? bestMinWeeklyRest : 0,
  }
}

function motivoFor(seat: SolverSeat): string {
  switch (seat.kind) {
    case 'forzado': return 'Franja forzada'
    case 'no_productivo': return 'Bloque fijo no productivo'
    case 'demanda': return 'Demanda prevista (solver exacto)'
    default: return 'Demanda prevista (solver exacto)'
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function lexLess5(a: [number, number, number, number, number], b: [number, number, number, number, number]): boolean {
  for (let i = 0; i < 5; i++) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

export type { DayOfWeek }

/* =====================================================
   ADAPTADOR — datos reales (RPC/tablas) → solveWeekSchedule()
   §2 del encargo: "TypeScript en el cliente ... llamado desde 'Proponer
   cuadrante'". generate_week_schedule (plpgsql) sigue vivo y sin tocar.
   ===================================================== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

function timeStrToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

async function fetchSolverTemplates(locationId: string, weekStart: string): Promise<SolverTemplate[]> {
  const [tplRes, usoRes] = await Promise.all([
    db().from('shift_templates').select('*').eq('location_id', locationId).eq('active', true),
    // Uso histórico: en cuántas semanas distintas (últimos 90 días) apareció
    // cada shift_template_id en schedules.cells de este local — mismo cálculo
    // que hacía generate_week_schedule, portado al cliente.
    db().from('schedules').select('cells, week_start')
      .eq('location_id', locationId)
      .gte('week_start', addDaysISO(weekStart, -90))
      .lt('week_start', weekStart),
  ])
  const usoByTpl = new Map<string, Set<string>>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (usoRes?.data ?? []) as any[]) {
    const cells = row.cells as Record<string, unknown> | null
    if (!cells) continue
    for (const tid of Object.keys(cells)) {
      if (!usoByTpl.has(tid)) usoByTpl.set(tid, new Set())
      usoByTpl.get(tid)!.add(row.week_start as string)
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((tplRes?.data ?? []) as any[]).map((t) => {
    const iniMin = timeStrToMin(t.start_time)
    let finMin = timeStrToMin(t.end_time)
    if (finMin <= iniMin) finMin += 1440
    const kind: SolverTemplateKind = (t.kind === 'forzado' || t.kind === 'no_productivo') ? t.kind : 'demanda'
    return {
      id: t.id, label: t.label, iniMin, finMin, kind,
      uso: usoByTpl.get(t.id)?.size ?? 0,
      coverageByDay: [t.coverage_mon, t.coverage_tue, t.coverage_wed, t.coverage_thu, t.coverage_fri, t.coverage_sat, t.coverage_sun],
    } as SolverTemplate
  })
}

async function fetchBreakPolicyForSolver(accountId: string): Promise<{
  maxDailyHours: number; splitGapMinutes: number; restBetweenShiftsMinutes: number; toleranceFraction: number
}> {
  const { data } = await db().from('break_policy').select('*')
    .eq('account_id', accountId).is('location_id', null).maybeSingle()
  return {
    maxDailyHours: Number(data?.max_daily_minutes_plan ?? data?.max_daily_minutes ?? 540) / 60,
    splitGapMinutes: Number(data?.split_min_gap_minutes ?? 90),
    restBetweenShiftsMinutes: Number(data?.min_rest_between_shifts_minutes ?? 720),
    toleranceFraction: Number(data?.contract_tolerance_pct ?? 0) / 100,
  }
}

async function fetchPeakFloors(accountId: string, role: string): Promise<{ peakWeekday: number; peakWeekend: number }> {
  const { data } = await db().from('team_labor_model').select('*')
    .eq('account_id', accountId).is('location_id', null).eq('role_kind', role).maybeSingle()
  return {
    peakWeekday: Number(data?.peak_weekday ?? 0) || 0,
    peakWeekend: Number(data?.peak_weekend ?? 0) || 0,
  }
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Igual fórmula que generate_week_schedule (v_week_idx): nº de semanas
 *  desde una fecha ancla fija — rota los días libres/turno largo semana a
 *  semana sin necesitar leer el cuadrante anterior. */
function weekIndexFor(weekStartISO: string): number {
  const [y, m, d] = weekStartISO.split('-').map(Number)
  const anchor = Date.UTC(2024, 0, 1)
  const week = Date.UTC(y, m - 1, d)
  return Math.floor((week - anchor) / (7 * 24 * 3600 * 1000))
}

export interface SolverRunRow {
  fecha: string
  dayOfWeek: DayOfWeek
  shiftTemplateId: string | null
  /** "HH:MM" — mismo contrato que generate_week_schedule v3+ */
  horaIni: string
  horaFin: string
  horas: number
  /** informativo, sin uso funcional — se mantiene por compatibilidad
   *  estructural con GeneratedScheduleRow (mismo shape, dos motores). */
  capa: number
  employeeId: string | null
  employeeName: string | null
  esHueco: boolean
  motivo: string
}

function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Orquesta el solver exacto contra datos reales: plantillas del local,
 * empleados/vacaciones ya cargados por el caller (mismo dato que usa el
 * resto de CalendarioPage — no se vuelve a pedir por separado, para no
 * desincronizar), demanda vía team_labor_requirement, política y picos.
 * Sustituye a fetchGeneratedSchedule (RPC generate_week_schedule) SOLO en
 * "Proponer cuadrante" — generate_week_schedule sigue vivo sin tocar.
 */
export async function runScheduleSolver(
  accountId: string,
  locationId: string,
  weekStart: string,
  employees: SolverEmployeeInput[],
  vacationDaysByEmployee: Map<string, Set<number>>,
  role: string = 'cocina'
): Promise<{ rows: SolverRunRow[]; outcome: SolverOutcome }> {
  const [templates, laborReq, breakPolicy, peaks] = await Promise.all([
    fetchSolverTemplates(locationId, weekStart),
    fetchLaborRequirement(accountId, locationId, weekStart),
    fetchBreakPolicyForSolver(accountId),
    fetchPeakFloors(accountId, role),
  ])

  const demandByDayHour: Record<number, number>[] = Array.from({ length: 7 }, () => ({}))
  for (const r of laborReq) {
    if (r.roleKind !== role) continue
    if (r.dow < 0 || r.dow > 6) continue
    demandByDayHour[r.dow][r.hora] = (demandByDayHour[r.dow][r.hora] ?? 0) + r.requiredExact
  }

  const outcome = solveWeekSchedule({
    weekIndex: weekIndexFor(weekStart),
    templates,
    employees,
    vacationDaysByEmployee,
    demandByDayHour,
    maxDailyHours: breakPolicy.maxDailyHours,
    splitGapMinutes: breakPolicy.splitGapMinutes,
    restBetweenShiftsMinutes: breakPolicy.restBetweenShiftsMinutes,
    toleranceFraction: breakPolicy.toleranceFraction,
    peakWeekday: peaks.peakWeekday,
    peakWeekend: peaks.peakWeekend,
  })

  const rows: SolverRunRow[] = outcome.seats.map((s) => ({
    fecha: addDaysISO(weekStart, s.day),
    dayOfWeek: s.day as DayOfWeek,
    shiftTemplateId: s.templateId,
    horaIni: minToHHMM(s.iniMin),
    horaFin: minToHHMM(s.finMin),
    horas: (s.finMin - s.iniMin) / 60,
    capa: 1,
    employeeId: s.employeeId,
    employeeName: s.employeeName,
    esHueco: s.isHueco,
    motivo: s.motivo,
  }))

  return { rows, outcome }
}
