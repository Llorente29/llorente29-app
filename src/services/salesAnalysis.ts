// ─── Servicio de análisis de ventas ──────────────────────────────────────────
// Fuentes: tSpoonLab (albaranes por día) y/o entrada manual
// Genera predicciones de personal necesario por día y turno

const API_BASE = 'https://app.tspoonlab.com/recipes/api'

export interface SaleRecord {
  date: string        // YYYY-MM-DD
  dayOfWeek: number   // 0=Lun … 6=Dom
  totalAmount: number // € brutos
  covers?: number     // comensales si disponible
  source: 'tspoon' | 'manual' | 'lastapp'
}

export interface DayPattern {
  dayOfWeek: number
  dayName: string
  avgSales: number
  maxSales: number
  minSales: number
  weeks: number
  relativeDemand: number  // 0-1 respecto al día de mayor venta
}

export interface StaffRecommendation {
  dayOfWeek: number
  dayName: string
  avgSales: number
  relativeDemand: number
  recommendedManana: number
  recommendedNoche: number
  totalRecommended: number
  confidence: 'alta' | 'media' | 'baja'
  reason: string
}

export interface SalesAnalysis {
  patterns: DayPattern[]
  recommendations: StaffRecommendation[]
  totalWeeksAnalyzed: number
  dateRange: { from: string; to: string }
  source: string
  lastUpdated: string
}

// ─── Umbrales de personal por nivel de demanda ────────────────────────────────
// Basado en las reglas del negocio:
//   Mañana L-V: 1 trabajador siempre
//   Noche L-J: 2 mín, 3 si demanda alta
//   Noche V-S-D: 3 mín, 4 si demanda muy alta
function calcStaffFromDemand(dayOfWeek: number, demand: number): { manana: number; noche: number } {
  const isWeekend = dayOfWeek >= 4  // vier, sab, dom
  const isWeekenNight = dayOfWeek >= 4

  // Mañana
  const manana = isWeekend
    ? demand >= 0.7 ? 2 : 1        // fin de semana: 1-2 en mediodía
    : 1                             // entre semana: siempre 1

  // Noche
  let noche: number
  if (isWeekenNight) {
    if (demand >= 0.85) noche = 4
    else if (demand >= 0.5) noche = 3
    else noche = 3  // mínimo obligatorio fin de semana
  } else {
    if (demand >= 0.75) noche = 3
    else noche = 2  // mínimo obligatorio entre semana
  }

  return { manana, noche }
}

// ─── Analizar historial de ventas ─────────────────────────────────────────────
export function analyzeHistory(records: SaleRecord[]): SalesAnalysis {
  const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

  if (records.length === 0) {
    return {
      patterns: [], recommendations: [], totalWeeksAnalyzed: 0,
      dateRange: { from: '', to: '' }, source: '', lastUpdated: new Date().toISOString()
    }
  }

  // Agrupar por día de semana
  const byDay: Record<number, number[]> = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] }
  records.forEach(r => { byDay[r.dayOfWeek].push(r.totalAmount) })

  // Calcular patrones
  const patterns: DayPattern[] = Array.from({ length: 7 }, (_, i) => {
    const vals = byDay[i]
    if (vals.length === 0) return { dayOfWeek: i, dayName: DAY_NAMES[i], avgSales: 0, maxSales: 0, minSales: 0, weeks: 0, relativeDemand: 0 }
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    return {
      dayOfWeek: i, dayName: DAY_NAMES[i],
      avgSales: Math.round(avg),
      maxSales: Math.max(...vals),
      minSales: Math.min(...vals),
      weeks: vals.length,
      relativeDemand: 0  // calculado después
    }
  })

  // Normalizar demanda relativa (0-1)
  const maxAvg = Math.max(...patterns.map(p => p.avgSales))
  patterns.forEach(p => { p.relativeDemand = maxAvg > 0 ? p.avgSales / maxAvg : 0 })

  // Generar recomendaciones
  const recommendations: StaffRecommendation[] = patterns.map(p => {
    const { manana, noche } = calcStaffFromDemand(p.dayOfWeek, p.relativeDemand)
    const confidence: StaffRecommendation['confidence'] =
      p.weeks >= 8 ? 'alta' : p.weeks >= 4 ? 'media' : 'baja'

    const reasons: string[] = []
    if (p.weeks < 4) reasons.push(`solo ${p.weeks} semana(s) de datos`)
    if (p.relativeDemand >= 0.85) reasons.push('día de alta demanda')
    else if (p.relativeDemand <= 0.3) reasons.push('día de baja demanda')
    if (noche > 2 && p.dayOfWeek < 4) reasons.push('demanda alta para entre semana')

    return {
      dayOfWeek: p.dayOfWeek, dayName: p.dayName,
      avgSales: p.avgSales, relativeDemand: p.relativeDemand,
      recommendedManana: manana, recommendedNoche: noche,
      totalRecommended: manana + noche,
      confidence,
      reason: reasons.length > 0 ? reasons.join(' · ') : 'Basado en histórico'
    }
  })

  const dates = records.map(r => r.date).sort()
  const weeks = Math.ceil(records.length / 7)
  const sources = [...new Set(records.map(r => r.source))]

  return {
    patterns, recommendations,
    totalWeeksAnalyzed: weeks,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    source: sources.join(' + '),
    lastUpdated: new Date().toISOString()
  }
}

// ─── Descargar ventas de tSpoonLab ────────────────────────────────────────────
export async function fetchTSpoonSales(
  token: string,
  centerId: string,
  weeks: number = 8,
  onProgress?: (msg: string) => void
): Promise<SaleRecord[]> {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const url = `${API_BASE}/integration/sales/deliveries/all?startDate=${fmt(startDate)}&endDate=${fmt(endDate)}&includeInternal=true`

  onProgress?.(`Descargando albaranes de ${fmt(startDate)} a ${fmt(endDate)}...`)

  try {
    const res = await fetch(url, {
      headers: { rememberme: token, order: centerId }
    })
    if (!res.ok) throw new Error(`Error ${res.status}`)
    const raw = await res.json()
    const deliveries = Array.isArray(raw) ? raw : raw?.results || []

    onProgress?.(`✓ ${deliveries.length} albaranes recibidos`)

    // Agrupar albaranes por día sumando importes
    const byDay: Record<string, number> = {}
    deliveries.forEach((d: { date?: string; dateDelivery?: string; total?: number; totalAmount?: number }) => {
      const dateStr = d.date || d.dateDelivery || ''
      if (!dateStr) return
      const day = dateStr.slice(0, 10)
      const amount = d.total || d.totalAmount || 0
      byDay[day] = (byDay[day] || 0) + amount
    })

    const records: SaleRecord[] = Object.entries(byDay).map(([date, amount]) => {
      const d = new Date(date + 'T12:00:00')
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1  // 0=Lun..6=Dom
      return { date, dayOfWeek: dow, totalAmount: amount, source: 'tspoon' }
    })

    onProgress?.(`✓ ${records.length} días con datos de venta`)
    return records
  } catch (e: unknown) {
    onProgress?.(`❌ Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    return []
  }
}

// ─── Guardar/cargar análisis en localStorage ──────────────────────────────────
const STORAGE_KEY = 'andy-sales-analysis-v1'

export function saveAnalysis(locationId: string, analysis: SalesAnalysis, records: SaleRecord[]) {
  try {
    const existing = loadAllAnalyses()
    existing[locationId] = { analysis, records, savedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
  } catch { console.warn('Sales analysis storage full') }
}

export function loadAnalysis(locationId: string): { analysis: SalesAnalysis; records: SaleRecord[] } | null {
  try {
    const all = loadAllAnalyses()
    return all[locationId] || null
  } catch { return null }
}

function loadAllAnalyses(): Record<string, { analysis: SalesAnalysis; records: SaleRecord[]; savedAt: string }> {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}

// ─── Exportar datos de ventas manuales (CSV simple) ──────────────────────────
export function exportRecordsCSV(records: SaleRecord[]): string {
  const header = 'Fecha,DiaSemana,Ventas(€),Fuente'
  const DAY = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
  const rows = records.map(r => `${r.date},${DAY[r.dayOfWeek]},${r.totalAmount.toFixed(2)},${r.source}`)
  return [header, ...rows].join('\n')
}
