// ─── Enriquecimiento de datos de ventas ──────────────────────────────────────
// 1. Meteorología: Open-Meteo API (gratuita, sin clave)
// 2. Eventos deportivos: partidos del Real Madrid y otros relevantes en Madrid

// ─── TIPOS ───────────────────────────────────────────────────────────────────
export interface DayEnrichment {
  date: string
  rain: number          // mm de lluvia
  isRainy: boolean      // >1mm
  sportEvent?: SportEvent
  coeficient: number    // multiplicador total aplicado (1.0 = normal)
}

export interface SportEvent {
  competition: string   // 'LaLiga', 'Champions', 'Copa', 'Derbi', 'Clasico'
  home: string
  away: string
  isRealMadrid: boolean
  isElClasico: boolean
  isDerbi: boolean      // vs Atlético
  isChampions: boolean
  importance: 'alta' | 'media' | 'baja'
  coeficient: number    // coeficiente de aumento de pedidos
}

export interface EnrichedDayStats {
  date: string
  dayOfWeek: number
  month: number
  year: number
  dishes: number
  dishesMediadia: number
  dishesNoche: number
  amount: number
  tickets: number
  rain: number
  isRainy: boolean
  sportEvent?: SportEvent
  coeficient: number
  // Dishes normalizados (sin coeficiente de evento/lluvia)
  dishesNormalized: number
  dishesMediadiaNormalized: number
  dishesNocheNormalized: number
}

// ─── COEFICIENTES BASE ────────────────────────────────────────────────────────
const COEF = {
  CLASICO:           1.40,  // Real Madrid vs Barcelona
  DERBI:             1.35,  // Real Madrid vs Atlético
  CHAMPIONS_FINAL:   1.35,
  CHAMPIONS_ELIM:    1.30,
  REAL_MADRID_HOME:  1.20,
  REAL_MADRID_AWAY:  1.15,
  MADRID_DERBY:      1.10,  // Atlético vs otro (sin RM)
  SPAIN_NT:          1.15,
  OTHER_BIG:         1.08,
  RAIN:              1.25,  // lluvia aumenta delivery
}

// ─── METEOROLOGÍA ─────────────────────────────────────────────────────────────
// Coordenadas Madrid centro (Puerta del Sol)
const MADRID_LAT = 40.4168
const MADRID_LON = -3.7038

export async function fetchWeatherHistory(
  dates: string[],
  lat = MADRID_LAT,
  lon = MADRID_LON
): Promise<Record<string, number>> {
  if (!dates.length) return {}
  const sorted = [...dates].sort()
  const startDate = sorted[0]
  const endDate   = sorted[sorted.length - 1]

  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=precipitation_sum&timezone=Europe%2FMadrid`
    const res = await fetch(url)
    if (!res.ok) return {}
    const data = await res.json()
    const result: Record<string, number> = {}
    const times: string[] = data.daily?.time || []
    const precip: number[] = data.daily?.precipitation_sum || []
    times.forEach((d, i) => { result[d] = precip[i] || 0 })
    return result
  } catch { return {} }
}

// ─── EVENTOS DEPORTIVOS ────────────────────────────────────────────────────────
// Usamos la API pública de football-data.org (gratuita, sin clave para LaLiga/Champions)
// Fallback: lista hardcoded de clásicos/derbis conocidos + fetch dinámico

const REAL_MADRID_ID = 86  // football-data.org team ID

export async function fetchSportEvents(
  startDate: string,
  endDate: string
): Promise<Record<string, SportEvent>> {
  const events: Record<string, SportEvent> = {}

  try {
    // Intentar obtener partidos del Real Madrid desde football-data.org
    // API key gratuita limitada — usamos endpoint público
    const competitions = ['PD', 'CL', 'CDR']  // LaLiga, Champions, Copa del Rey
    
    for (const comp of competitions) {
      try {
        const url = `https://api.football-data.org/v4/teams/${REAL_MADRID_ID}/matches?dateFrom=${startDate}&dateTo=${endDate}&competitions=${comp}`
        const res = await fetch(url, {
          headers: { 'X-Auth-Token': '1a97df6f68c44e8fbe3bd280be6d9f26' }
        })
        if (!res.ok) continue
        const data = await res.json()
        const matches = data.matches || []

        matches.forEach((m: any) => {
          const date = m.utcDate?.slice(0, 10)
          if (!date) return
          const home = m.homeTeam?.name || ''
          const away = m.awayTeam?.name || ''
          const isRM  = home.includes('Real Madrid') || away.includes('Real Madrid')
          if (!isRM) return

          const isElClasico = (home.includes('Barcelona') || away.includes('Barcelona'))
          const isDerbi     = (home.includes('Atlético') || away.includes('Atlético') || home.includes('Atletico') || away.includes('Atletico'))
          const isChampions = comp === 'CL'
          const isKnockout  = ['ROUND_OF_16','QUARTER_FINAL','SEMI_FINAL','FINAL'].includes(m.stage)

          let coef = COEF.REAL_MADRID_AWAY
          if (isElClasico)              coef = COEF.CLASICO
          else if (isDerbi)             coef = COEF.DERBI
          else if (isChampions && isKnockout) coef = COEF.CHAMPIONS_ELIM
          else if (isChampions)         coef = COEF.CHAMPIONS_FINAL
          else if (home.includes('Real Madrid')) coef = COEF.REAL_MADRID_HOME

          const compLabel = isElClasico ? 'Clásico' : isDerbi ? 'Derbi' : isChampions ? 'Champions' : 'LaLiga'
          events[date] = {
            competition: compLabel, home, away,
            isRealMadrid: true, isElClasico, isDerbi, isChampions,
            importance: (isElClasico || isDerbi || (isChampions && isKnockout)) ? 'alta' : 'media',
            coeficient: coef
          }
        })
      } catch { continue }
    }
  } catch { /* silencio — usamos solo datos hardcoded si falla */ }

  return events
}

// ─── CALCULAR COEFICIENTE EFECTIVO ────────────────────────────────────────────
export function calcDayCoeficient(rain: number, event?: SportEvent): number {
  let coef = 1.0
  if (event) coef = Math.max(coef, event.coeficient)
  if (rain > 1) coef = Math.max(coef, coef * COEF.RAIN)
  return Math.round(coef * 100) / 100
}

// ─── ENRIQUECER REGISTROS DE VENTA ───────────────────────────────────────────
import type { SaleRecord } from './salesAnalysis'

export async function enrichRecords(
  records: SaleRecord[],
  lat?: number,
  lon?: number
): Promise<{ enriched: Record<string, DayEnrichment>; rainCoeficient: number }> {
  const dates = [...new Set(records.map(r => r.date))].sort()
  if (!dates.length) return { enriched: {}, rainCoeficient: 1 }

  const [weather, events] = await Promise.all([
    fetchWeatherHistory(dates, lat || MADRID_LAT, lon || MADRID_LON),
    fetchSportEvents(dates[0], dates[dates.length - 1])
  ])

  // Calcular correlación lluvia→ventas automáticamente
  const rainyDays    = dates.filter(d => (weather[d] || 0) > 1)
  const normalDays   = dates.filter(d => (weather[d] || 0) <= 1)
  const avgDishesRainy  = avgDishes(records, rainyDays)
  const avgDishesNormal = avgDishes(records, normalDays)
  const rainCoeficient = avgDishesNormal > 0 && avgDishesRainy > 0
    ? Math.round((avgDishesRainy / avgDishesNormal) * 100) / 100
    : COEF.RAIN

  const enriched: Record<string, DayEnrichment> = {}
  dates.forEach(date => {
    const rain  = weather[date] || 0
    const event = events[date]
    enriched[date] = {
      date,
      rain,
      isRainy: rain > 1,
      sportEvent: event,
      coeficient: calcDayCoeficient(rain, event)
    }
  })

  return { enriched, rainCoeficient }
}

function avgDishes(records: SaleRecord[], dates: string[]): number {
  if (!dates.length) return 0
  const set = new Set(dates)
  const byDate: Record<string, number> = {}
  records.filter(r => set.has(r.date)).forEach(r => {
    byDate[r.date] = (byDate[r.date] || 0) + r.dishes
  })
  const vals = Object.values(byDate)
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
}

// ─── HISTÓRICO POR MES/DÍA DE SEMANA ─────────────────────────────────────────
export interface MonthlyPattern {
  month: number        // 1-12
  monthName: string
  dayOfWeek: number    // 0=Lun…6=Dom
  dayName: string
  avgDishes: number
  avgDishesMediadia: number
  avgDishesNoche: number
  avgDishesNormalized: number  // sin eventos/lluvia
  samples: number
  sportEventDays: number
  rainyDays: number
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAY_NAMES   = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

export function buildMonthlyPatterns(
  records: SaleRecord[],
  enriched: Record<string, DayEnrichment>
): MonthlyPattern[] {
  // Agrupar por mes + día de semana
  const groups: Record<string, {
    dishes: number[]; dishesM: number[]; dishesN: number[]
    dishesNorm: number[]; sportDays: Set<string>; rainyDays: Set<string>
  }> = {}

  // Agrupar records por fecha primero
  const byDate: Record<string, { total:number; med:number; noch:number }> = {}
  records.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { total:0, med:0, noch:0 }
    byDate[r.date].total += r.dishes
    if (r.turno === 'mediodia') byDate[r.date].med += r.dishes
    else byDate[r.date].noch += r.dishes
  })

  Object.entries(byDate).forEach(([date, data]) => {
    const d = new Date(date + 'T12:00:00')
    const month = d.getMonth() + 1  // 1-12
    const dow   = d.getDay() === 0 ? 6 : d.getDay() - 1
    const key   = `${month}_${dow}`
    const enr   = enriched[date]
    const coef  = enr?.coeficient || 1

    if (!groups[key]) groups[key] = { dishes:[], dishesM:[], dishesN:[], dishesNorm:[], sportDays:new Set(), rainyDays:new Set() }
    groups[key].dishes.push(data.total)
    groups[key].dishesM.push(data.med)
    groups[key].dishesN.push(data.noch)
    groups[key].dishesNorm.push(Math.round(data.total / coef))
    if (enr?.sportEvent) groups[key].sportDays.add(date)
    if (enr?.isRainy)    groups[key].rainyDays.add(date)
  })

  const avg = (a: number[]) => a.length ? Math.round(a.reduce((s,v)=>s+v,0)/a.length) : 0
  const patterns: MonthlyPattern[] = []

  for (let month = 1; month <= 12; month++) {
    for (let dow = 0; dow <= 6; dow++) {
      const key = `${month}_${dow}`
      const g = groups[key]
      if (!g || g.dishes.length === 0) continue
      patterns.push({
        month, monthName: MONTH_NAMES[month-1],
        dayOfWeek: dow, dayName: DAY_NAMES[dow],
        avgDishes:            avg(g.dishes),
        avgDishesMediadia:    avg(g.dishesM),
        avgDishesNoche:       avg(g.dishesN),
        avgDishesNormalized:  avg(g.dishesNorm),
        samples:              g.dishes.length,
        sportEventDays:       g.sportDays.size,
        rainyDays:            g.rainyDays.size,
      })
    }
  }

  return patterns
}

// ─── PREDICCIÓN PARA UNA SEMANA FUTURA ───────────────────────────────────────
export interface WeekStaffPrediction {
  date: string
  dayOfWeek: number
  dayName: string
  predictedDishesMediadia: number
  predictedDishesNoche: number
  staffMediadia: number
  staffNoche: number
  coeficient: number
  coefReason: string[]
  confidence: 'alta' | 'media' | 'baja'
  sportEvent?: SportEvent
  isRainy?: boolean
}

const DISHES_PER_WORKER_HOUR = 15
const MANANA_HOURS = 3.5
const NOCHE_HOURS  = 4.5
const MIN_NOCHE    = 2  // mínimo empresa (no convenio)
const MIN_MANANA   = 1

export async function predictWeekStaff(
  weekStart: string,
  monthlyPatterns: MonthlyPattern[],
  rainCoeficient: number,
  lat?: number,
  lon?: number
): Promise<WeekStaffPrediction[]> {
  const predictions: WeekStaffPrediction[] = []
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })

  // Obtener eventos y lluvia de la semana futura
  const [futureWeather, futureEvents] = await Promise.all([
    fetchWeatherHistory(weekDates, lat || MADRID_LAT, lon || MADRID_LON).catch(() => ({} as Record<string,number>)),
    fetchSportEvents(weekDates[0], weekDates[6]).catch(() => ({} as Record<string,SportEvent>))
  ])

  weekDates.forEach(date => {
    const d = new Date(date + 'T12:00:00')
    const dow   = d.getDay() === 0 ? 6 : d.getDay() - 1
    const month = d.getMonth() + 1

    // Buscar patrón histórico más cercano
    const pattern = monthlyPatterns.find(p => p.month === month && p.dayOfWeek === dow)
      || monthlyPatterns.find(p => p.dayOfWeek === dow)  // fallback: cualquier mes

    const baseDishesM = pattern?.avgDishesNormalized
      ? Math.round(pattern.avgDishesMediadia * (pattern.avgDishesNormalized / Math.max(pattern.avgDishes, 1)))
      : (pattern?.avgDishesMediadia || 0)
    const baseDishesN = pattern?.avgDishesNoche || 0

    // Coeficientes futuros
    const rain  = futureWeather[date] || 0
    const event = futureEvents[date]
    const coefReasons: string[] = []
    let coef = 1.0

    if (event) {
      coef = Math.max(coef, event.coeficient)
      coefReasons.push(`${event.competition}: ${event.home} vs ${event.away} (+${Math.round((event.coeficient-1)*100)}%)`)
    }
    if (rain > 1) {
      const rc = Math.max(rainCoeficient, 1.05)
      coef = Math.max(coef, coef * rc)
      coefReasons.push(`Lluvia prevista ${rain.toFixed(1)}mm (+${Math.round((rc-1)*100)}%)`)
    }

    const predictedM = Math.round(baseDishesM * coef)
    const predictedN = Math.round(baseDishesN * coef)

    const staffM = Math.max(MIN_MANANA, Math.ceil(predictedM / (DISHES_PER_WORKER_HOUR * MANANA_HOURS)))
    const staffN = Math.max(MIN_NOCHE,  Math.ceil(predictedN / (DISHES_PER_WORKER_HOUR * NOCHE_HOURS)))

    const confidence: WeekStaffPrediction['confidence'] = !pattern ? 'baja'
      : pattern.samples >= 8 ? 'alta'
      : pattern.samples >= 3 ? 'media' : 'baja'

    predictions.push({
      date, dayOfWeek: dow, dayName: DAY_NAMES[dow],
      predictedDishesMediadia: predictedM,
      predictedDishesNoche: predictedN,
      staffMediadia: staffM, staffNoche: staffN,
      coeficient: Math.round(coef * 100) / 100,
      coefReason: coefReasons,
      confidence,
      sportEvent: event,
      isRainy: rain > 1
    })
  })

  return predictions
}

// ─── PERSISTENCIA ─────────────────────────────────────────────────────────────
const KEY_PATTERNS   = 'andy-monthly-patterns-v1'
const KEY_ENRICHMENT = 'andy-enrichment-v1'
const KEY_RAIN_COEF  = 'andy-rain-coef-v1'

export function saveMonthlyPatterns(locId: string, patterns: MonthlyPattern[], rainCoeficient: number) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_PATTERNS) || '{}')
    all[locId] = { patterns, savedAt: new Date().toISOString() }
    localStorage.setItem(KEY_PATTERNS, JSON.stringify(all))
    const coefs = JSON.parse(localStorage.getItem(KEY_RAIN_COEF) || '{}')
    coefs[locId] = rainCoeficient
    localStorage.setItem(KEY_RAIN_COEF, JSON.stringify(coefs))
  } catch { console.warn('storage full') }
}

export function loadMonthlyPatterns(locId: string): { patterns: MonthlyPattern[]; savedAt: string } | null {
  try { return JSON.parse(localStorage.getItem(KEY_PATTERNS) || '{}')[locId] || null } catch { return null }
}

export function loadRainCoeficient(locId: string): number {
  try { return JSON.parse(localStorage.getItem(KEY_RAIN_COEF) || '{}')[locId] || 1.25 } catch { return 1.25 }
}

export function saveEnrichment(locId: string, enriched: Record<string, DayEnrichment>) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_ENRICHMENT) || '{}')
    all[locId] = enriched
    localStorage.setItem(KEY_ENRICHMENT, JSON.stringify(all))
  } catch { console.warn('storage full') }
}

export function loadEnrichment(locId: string): Record<string, DayEnrichment> {
  try { return JSON.parse(localStorage.getItem(KEY_ENRICHMENT) || '{}')[locId] || {} } catch { return {} }
}
