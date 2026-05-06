// ─── Análisis de ventas con granularidad horaria ──────────────────────────────
// Fuente: Excel de tSpoonLab (columnas: DATE, TIME, AMOUNT, SOURCE, NUMTICKET)
// Cada fila = una línea de pedido. Agrupar por NUMTICKET para evitar duplicados.

export interface SaleRecord {
  date: string        // YYYY-MM-DD
  time: string        // HH:MM
  hour: number        // 0-23
  dayOfWeek: number   // 0=Lun…6=Dom
  turno: 'mediodia' | 'noche'  // <17h = mediodía, >=17h = noche
  amount: number
  source: string      // Glovo, Uber, TPV, etc.
  ticket: string
}

export interface HourlyPattern {
  hour: number
  label: string       // "12:00", "19:00", etc.
  avgAmount: number
  totalAmount: number
  ticketCount: number
  days: number
}

export interface DayPattern {
  dayOfWeek: number
  dayName: string
  avgTotal: number
  avgMediadia: number
  avgNoche: number
  ticketsMediadia: number
  ticketsNoche: number
  weeks: number
  demandTotal: number    // 0-1 relativo al max
  demandMediadia: number
  demandNoche: number
}

export interface StaffRecommendation {
  dayOfWeek: number
  dayName: string
  avgTotal: number
  demandTotal: number
  recommendedManana: number
  recommendedNoche: number
  confidence: 'alta' | 'media' | 'baja'
  reason: string
}

export interface SalesAnalysis {
  records: SaleRecord[]
  dayPatterns: DayPattern[]
  hourlyPatterns: HourlyPattern[]
  recommendations: StaffRecommendation[]
  totalWeeks: number
  dateRange: { from: string; to: string }
  brands: string[]
  sources: string[]
  lastUpdated: string
}

const DAY_NAMES = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

// ─── Parser del Excel de tSpoonLab ───────────────────────────────────────────
// Acepta arraybuffer del archivo xlsx
export async function parseExcelFile(buffer: ArrayBuffer): Promise<SaleRecord[]> {
  // Importar xlsx dinámicamente (ya disponible en la app via SheetJS)
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs' as any).catch(() => null)
  if (!XLSX) throw new Error('SheetJS no disponible')

  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: Record<string,any>[] = XLSX.utils.sheet_to_json(ws, { raw: false })

  if (!raw.length) return []

  // Detectar columnas (puede variar mayúsculas/minúsculas)
  const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z]/g,'')
  const cols = Object.keys(raw[0])
  const col = (name: string) => cols.find(c => normalize(c) === normalize(name)) || ''

  const C = {
    date:   col('date') || col('fecha'),
    time:   col('time') || col('hora'),
    amount: col('amount') || col('importe') || col('total'),
    source: col('source') || col('fuente') || col('canal'),
    ticket: col('numticket') || col('ticket') || col('pedido')
  }

  // Agrupar por ticket para no sumar líneas múltiples del mismo pedido
  const byTicket = new Map<string, { date:string; time:string; amount:number; source:string }>()

  raw.forEach(row => {
    const ticket = String(row[C.ticket] || `${row[C.date]}_${row[C.time]}_${Math.random()}`)
    const amount = parseFloat(String(row[C.amount]).replace(',','.')) || 0
    const dateRaw = String(row[C.date] || '')
    const timeRaw = String(row[C.time] || '00:00:00')
    const source  = String(row[C.source] || '—')

    // Normalizar fecha → YYYY-MM-DD
    let date = dateRaw.slice(0, 10)
    if (date.includes('/')) {
      const parts = date.split('/')
      date = parts.length === 3
        ? `${parts[2].length === 4 ? parts[2] : `20${parts[2]}`}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`
        : dateRaw
    }

    if (byTicket.has(ticket)) {
      byTicket.get(ticket)!.amount += amount  // sumar líneas del mismo ticket
    } else {
      byTicket.set(ticket, { date, time: timeRaw.slice(0,5), amount, source })
    }
  })

  const records: SaleRecord[] = []
  byTicket.forEach((v, ticket) => {
    const d = new Date(v.date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1  // 0=Lun…6=Dom
    const hour = parseInt(v.time.slice(0,2)) || 0
    records.push({
      date: v.date, time: v.time, hour, dayOfWeek: dow,
      turno: hour < 17 ? 'mediodia' : 'noche',
      amount: v.amount, source: v.source, ticket
    })
  })

  return records.filter(r => r.amount > 0).sort((a,b) => a.date.localeCompare(b.date))
}

// ─── Motor de análisis ────────────────────────────────────────────────────────
export function analyzeHistory(records: SaleRecord[]): SalesAnalysis {
  if (!records.length) return empty()

  const dates = [...new Set(records.map(r => r.date))].sort()
  const totalWeeks = Math.max(1, Math.ceil(dates.length / 7))
  const brands  = [...new Set(records.map(r => r.source))]

  // ── Patrones por día de semana ────────────────────────────────────────────
  const byDow: Record<number, SaleRecord[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]}
  records.forEach(r => byDow[r.dayOfWeek].push(r))

  const dayPatterns: DayPattern[] = Array.from({length:7},(_,i) => {
    const recs = byDow[i]
    const dateSet = [...new Set(recs.map(r => r.date))]
    const weeks = dateSet.length || 0
    if (!weeks) return { dayOfWeek:i, dayName:DAY_NAMES[i], avgTotal:0, avgMediadia:0, avgNoche:0, ticketsMediadia:0, ticketsNoche:0, weeks:0, demandTotal:0, demandMediadia:0, demandNoche:0 }

    // Agrupar por fecha para calcular totales diarios
    const byDate: Record<string,{total:number;med:number;noch:number;tMed:number;tNoch:number}> = {}
    dateSet.forEach(d => { byDate[d] = {total:0,med:0,noch:0,tMed:0,tNoch:0} })
    recs.forEach(r => {
      byDate[r.date].total += r.amount
      if (r.turno === 'mediodia') { byDate[r.date].med += r.amount; byDate[r.date].tMed++ }
      else { byDate[r.date].noch += r.amount; byDate[r.date].tNoch++ }
    })

    const days = Object.values(byDate)
    const avg = (arr: number[]) => arr.reduce((s,v)=>s+v,0) / arr.length

    return {
      dayOfWeek:i, dayName:DAY_NAMES[i],
      avgTotal:    Math.round(avg(days.map(d=>d.total))),
      avgMediadia: Math.round(avg(days.map(d=>d.med))),
      avgNoche:    Math.round(avg(days.map(d=>d.noch))),
      ticketsMediadia: Math.round(avg(days.map(d=>d.tMed))),
      ticketsNoche:    Math.round(avg(days.map(d=>d.tNoch))),
      weeks, demandTotal:0, demandMediadia:0, demandNoche:0
    }
  })

  // Normalizar demanda 0-1
  const maxTotal = Math.max(...dayPatterns.map(p=>p.avgTotal),1)
  const maxMed   = Math.max(...dayPatterns.map(p=>p.avgMediadia),1)
  const maxNoch  = Math.max(...dayPatterns.map(p=>p.avgNoche),1)
  dayPatterns.forEach(p => {
    p.demandTotal    = p.avgTotal    / maxTotal
    p.demandMediadia = p.avgMediadia / maxMed
    p.demandNoche    = p.avgNoche    / maxNoch
  })

  // ── Patrones horarios ─────────────────────────────────────────────────────
  const byHour: Record<number,{total:number;count:number;dates:Set<string>}> = {}
  records.forEach(r => {
    const h = Math.floor(r.hour / 1) // por hora exacta
    if (!byHour[h]) byHour[h] = {total:0,count:0,dates:new Set()}
    byHour[h].total += r.amount
    byHour[h].count++
    byHour[h].dates.add(r.date)
  })
  const hourlyPatterns: HourlyPattern[] = Object.entries(byHour)
    .map(([h,v]) => ({
      hour: parseInt(h),
      label: `${h.toString().padStart(2,'0')}:00`,
      totalAmount: Math.round(v.total),
      avgAmount: Math.round(v.total / v.dates.size),
      ticketCount: v.count,
      days: v.dates.size
    }))
    .sort((a,b) => a.hour - b.hour)

  // ── Recomendaciones de personal ───────────────────────────────────────────
  const recommendations: StaffRecommendation[] = dayPatterns.map(p => {
    const isWeekend = p.dayOfWeek >= 4
    const minNoche  = isWeekend ? 3 : 2
    const minManana = 1

    // Mediodía: añadir 1 extra si demanda alta en fin de semana
    const extraManana = isWeekend && p.demandMediadia >= 0.6 ? 1 : 0
    // Noche: añadir 1 extra si demanda muy alta
    const extraNoche  = p.demandNoche >= 0.85 ? 1 : 0

    const recManana = minManana + extraManana
    const recNoche  = minNoche  + extraNoche
    const confidence: StaffRecommendation['confidence'] = p.weeks >= 8 ? 'alta' : p.weeks >= 3 ? 'media' : 'baja'

    const reasons: string[] = []
    if (p.avgTotal > 0) reasons.push(`media ${p.avgTotal.toLocaleString('es-ES')}€/día`)
    if (extraNoche) reasons.push('demanda noche muy alta')
    if (extraManana) reasons.push('fin de semana con mediodía activo')
    if (p.weeks < 3) reasons.push(`solo ${p.weeks} día(s) de datos`)

    return {
      dayOfWeek: p.dayOfWeek, dayName: p.dayName,
      avgTotal: p.avgTotal, demandTotal: p.demandTotal,
      recommendedManana: recManana, recommendedNoche: recNoche,
      confidence, reason: reasons.join(' · ') || '—'
    }
  })

  return {
    records, dayPatterns, hourlyPatterns, recommendations,
    totalWeeks, dateRange:{from:dates[0],to:dates[dates.length-1]},
    brands, sources: brands, lastUpdated: new Date().toISOString()
  }
}

function empty(): SalesAnalysis {
  return { records:[], dayPatterns:[], hourlyPatterns:[], recommendations:[], totalWeeks:0, dateRange:{from:'',to:''}, brands:[], sources:[], lastUpdated:'' }
}

// ─── Persistencia ─────────────────────────────────────────────────────────────
const KEY = 'andy-sales-v2'

export function saveAnalysis(locId: string, data: { records: SaleRecord[]; analysis: SalesAnalysis }) {
  try {
    const all = loadAll()
    all[locId] = { ...data, savedAt: new Date().toISOString() }
    // Guardar sin los records completos si pesa mucho (solo summary)
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { console.warn('localStorage lleno, guardando solo análisis') }
}

export function loadSavedAnalysis(locId: string): { records: SaleRecord[]; analysis: SalesAnalysis } | null {
  try { return loadAll()[locId] || null } catch { return null }
}

function loadAll(): Record<string, any> {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : {} } catch { return {} }
}
