// ─── Análisis de ventas con granularidad horaria ──────────────────────────────
// Fuente primaria: API tSpoonLab /integration/sales/deliveries/all (JSON)
// Fuente secundaria: Excel exportado manualmente desde tSpoonLab
// Columnas Excel: DATE, TIME, AMOUNT, SOURCE/CODI, NUMTICKET

const API_BASE = 'https://app.tspoonlab.com/recipes/api'

export interface SaleRecord {
  date: string        // YYYY-MM-DD
  time: string        // HH:MM
  hour: number        // 0-23
  dayOfWeek: number   // 0=Lun…6=Dom
  turno: 'mediodia' | 'noche'
  amount: number
  source: string      // marca/canal: "Glovo", "Uber", "Dos Coyotes"...
  brand: string       // cliente/marca de tSpoonLab
  ticket: string
}

export interface BrandSyncResult {
  brand: string
  customerId: string
  records: number
  status: 'ok' | 'error' | 'empty'
  message?: string
}

export interface SyncResult {
  records: SaleRecord[]
  brands: BrandSyncResult[]
  dateRange: { from: string; to: string }
  totalDays: number
}

// ─── Tipos internos de la API de tSpoonLab ────────────────────────────────────
interface TspDelivery {
  id: string
  idCustomer: string
  customer: string
  customerCode?: string
  date: string        // "YYYY-MM-DD" o timestamp
  deliveryLines?: TspLine[]
  listLines?: TspLine[]
  lines?: TspLine[]
  total?: number
  totalAmount?: number
}

interface TspLine {
  id?: string
  descr?: string
  date?: string
  time?: string       // "HH:MM:SS" — la hora del pedido
  hour?: string
  quantity?: number
  unitPrice?: number
  amount?: number
  total?: number
  numTicket?: string
  numticket?: string
  ticket?: string
  source?: string
}

interface TspCustomer {
  id: string
  descr: string
  codi?: string
}

// ─── AUTO-SYNC: descargar ventas de todas las marcas via API ─────────────────

export async function syncAllBrands(
  token: string,
  centerId: string,
  days: number = 30,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const end = new Date()
  const start = new Date(); start.setDate(start.getDate() - days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const startDate = fmt(start)
  const endDate   = fmt(end)

  onProgress?.(`Iniciando sync: ${startDate} → ${endDate} (${days} días)`)

  const headers = { rememberme: token, order: centerId }

  // 1. Listar todos los clientes/marcas del centro
  onProgress?.('Obteniendo lista de marcas...')
  let customers: TspCustomer[] = []
  try {
    const raw = await fetch(`${API_BASE}/listCustomers`, { headers }).then(r => r.json()).catch(() => [])
    customers = Array.isArray(raw) ? raw : raw?.results || []
    onProgress?.(`✓ ${customers.length} marcas encontradas`)
  } catch {
    onProgress?.('⚠️ No se pudo obtener la lista de marcas, intentando con datos globales...')
  }

  // 2. Descargar todos los albaranes de venta en el rango (todas las marcas juntas)
  onProgress?.('Descargando albaranes de venta...')
  let allDeliveries: TspDelivery[] = []
  try {
    const url = `${API_BASE}/integration/sales/deliveries/all?startDate=${startDate}&endDate=${endDate}&includeInternal=true`
    const raw = await fetch(url, { headers }).then(r => r.json()).catch(() => [])
    allDeliveries = Array.isArray(raw) ? raw : raw?.results || []
    onProgress?.(`✓ ${allDeliveries.length} albaranes recibidos`)
  } catch (e: unknown) {
    onProgress?.(`❌ Error descargando albaranes: ${e instanceof Error ? e.message : 'desconocido'}`)
  }

  // 3. Parsear albaranes → SaleRecord[]
  const records = parseDeliveries(allDeliveries, customers)
  onProgress?.(`✓ ${records.length} tickets procesados de ${new Set(records.map(r=>r.brand)).size} marca(s)`)

  // 4. Resultado por marca
  const brandMap: Record<string, BrandSyncResult> = {}
  customers.forEach(c => {
    brandMap[c.id] = { brand: c.descr, customerId: c.id, records: 0, status: 'empty', message: 'Sin ventas en el período' }
  })
  records.forEach(r => {
    if (!brandMap[r.brand]) brandMap[r.brand] = { brand: r.brand, customerId: '', records: 0, status: 'ok' }
    brandMap[r.brand].records++
    brandMap[r.brand].status = 'ok'
    delete brandMap[r.brand].message
  })

  const uniqueDates = [...new Set(records.map(r => r.date))].sort()
  return {
    records,
    brands: Object.values(brandMap),
    dateRange: { from: startDate, to: endDate },
    totalDays: uniqueDates.length
  }
}

function parseDeliveries(deliveries: TspDelivery[], customers: TspCustomer[]): SaleRecord[] {
  const customerMap: Record<string, string> = {}
  customers.forEach(c => { customerMap[c.id] = c.descr })

  // Agrupar por ticket para no duplicar líneas del mismo pedido
  const byTicket = new Map<string, { date:string; time:string; amount:number; source:string; brand:string }>()

  deliveries.forEach(d => {
    const brand = customerMap[d.idCustomer] || d.customer || 'Desconocido'
    const lines = d.deliveryLines || d.listLines || d.lines || []
    const dateBase = normalizeDate(d.date)

    if (lines.length === 0) {
      // Albaran sin líneas: usar total del albarán
      const ticketId = d.id || `${dateBase}_${brand}_${Math.random()}`
      const amount = d.total || d.totalAmount || 0
      if (amount > 0) {
        byTicket.set(ticketId, { date: dateBase, time: '13:00', amount, source: brand, brand })
      }
      return
    }

    lines.forEach((line, li) => {
      const ticketId = line.numTicket || line.numticket || line.ticket || `${d.id}_${li}`
      const amount = line.amount || line.total || (line.quantity || 1) * (line.unitPrice || 0)
      const lineDate = line.date ? normalizeDate(line.date) : dateBase
      const lineTime = normalizeTime(line.time || line.hour || '')
      const src = line.source || brand

      if (amount <= 0) return

      if (byTicket.has(ticketId)) {
        byTicket.get(ticketId)!.amount += amount
      } else {
        byTicket.set(ticketId, { date: lineDate, time: lineTime, amount, source: src, brand })
      }
    })
  })

  const records: SaleRecord[] = []
  byTicket.forEach((v, ticket) => {
    const d = new Date(v.date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
    const hour = parseInt(v.time.slice(0, 2)) || 12
    records.push({
      date: v.date, time: v.time, hour, dayOfWeek: dow,
      turno: hour < 17 ? 'mediodia' : 'noche',
      amount: Math.round(v.amount * 100) / 100,
      source: v.source, brand: v.brand, ticket
    })
  })

  return records.filter(r => r.amount > 0).sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Parser de Excel (subida manual) ─────────────────────────────────────────
export async function parseExcelFile(buffer: ArrayBuffer): Promise<SaleRecord[]> {
  // Usar SheetJS via CDN si está disponible, si no caer a parsing manual
  let XLSX: any = null
  try {
    // Intentar importar SheetJS desde CDN
    XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs' as any)
  } catch {
    // SheetJS no disponible, usar parser básico de CSV-dentro-de-xlsx
  }

  if (!XLSX) throw new Error('SheetJS no disponible en este entorno')

  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' })

  if (!raw.length) return []

  const cols = Object.keys(raw[0])
  const col = (name: string) => cols.find(c => c.toLowerCase().replace(/[^a-z]/g,'') === name.toLowerCase().replace(/[^a-z]/g,'')) || ''
  const C = {
    date:   col('date')   || col('fecha'),
    time:   col('time')   || col('hora'),
    amount: col('amount') || col('importe') || col('total'),
    source: col('source') || col('fuente')  || col('canal'),
    ticket: col('numticket') || col('ticket') || col('pedido')
  }

  const byTicket = new Map<string, { date:string; time:string; amount:number; source:string; brand:string }>()
  raw.forEach(row => {
    const amount = parseFloat(String(row[C.amount] || '0').replace(',', '.')) || 0
    if (amount <= 0) return
    const ticket = String(row[C.ticket] || `${row[C.date]}_${Math.random()}`)
    const date   = normalizeDate(String(row[C.date] || ''))
    const time   = normalizeTime(String(row[C.time] || ''))
    const source = String(row[C.source] || 'Excel')

    if (byTicket.has(ticket)) {
      byTicket.get(ticket)!.amount += amount
    } else {
      byTicket.set(ticket, { date, time, amount, source, brand: source })
    }
  })

  const records: SaleRecord[] = []
  byTicket.forEach((v, ticket) => {
    const d = new Date(v.date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
    const hour = parseInt(v.time.slice(0,2)) || 12
    records.push({
      date: v.date, time: v.time, hour, dayOfWeek: dow,
      turno: hour < 17 ? 'mediodia' : 'noche',
      amount: v.amount, source: v.source, brand: v.brand, ticket
    })
  })

  return records.filter(r => r.amount > 0).sort((a,b) => a.date.localeCompare(b.date))
}

// ─── Helpers de normalización ─────────────────────────────────────────────────
function normalizeDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0,10)
  // Timestamp largo: "2026-05-05T12:00:00" o "2026-05-05 00:00:00"
  if (raw.length > 10) raw = raw.slice(0, 10)
  // DD/MM/YYYY → YYYY-MM-DD
  if (raw.includes('/')) {
    const [d, m, y] = raw.split('/')
    return `${y.length===4?y:'20'+y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  return raw
}

function normalizeTime(raw: string): string {
  if (!raw) return '13:00'
  const clean = raw.trim()
  // HH:MM:SS → HH:MM
  if (clean.match(/^\d{2}:\d{2}/)) return clean.slice(0,5)
  // Solo hora: "12" → "12:00"
  if (clean.match(/^\d{1,2}$/)) return `${clean.padStart(2,'0')}:00`
  return '13:00'
}

// ─── Motor de análisis ────────────────────────────────────────────────────────
export interface DayPattern {
  dayOfWeek: number; dayName: string
  avgTotal: number; avgMediadia: number; avgNoche: number
  ticketsMediadia: number; ticketsNoche: number
  weeks: number
  demandTotal: number; demandMediadia: number; demandNoche: number
}
export interface HourlyPattern {
  hour: number; label: string
  avgAmount: number; totalAmount: number; ticketCount: number; days: number
}
export interface StaffRecommendation {
  dayOfWeek: number; dayName: string; avgTotal: number; demandTotal: number
  recommendedManana: number; recommendedNoche: number
  confidence: 'alta' | 'media' | 'baja'; reason: string
}
export interface SalesAnalysis {
  records: SaleRecord[]; dayPatterns: DayPattern[]; hourlyPatterns: HourlyPattern[]
  recommendations: StaffRecommendation[]
  totalWeeks: number; dateRange: { from: string; to: string }
  brands: string[]; sources: string[]; lastUpdated: string
}

const DAY_NAMES = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

export function analyzeHistory(records: SaleRecord[]): SalesAnalysis {
  if (!records.length) return empty()

  const dates = [...new Set(records.map(r => r.date))].sort()
  const totalWeeks = Math.max(1, Math.ceil(dates.length / 7))
  const brands = [...new Set(records.map(r => r.brand))]
  const sources = [...new Set(records.map(r => r.source))]

  // Patrones por día de semana
  const byDow: Record<number, SaleRecord[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]}
  records.forEach(r => byDow[r.dayOfWeek].push(r))

  const dayPatterns: DayPattern[] = Array.from({length:7},(_,i) => {
    const recs = byDow[i]
    const dateSet = [...new Set(recs.map(r => r.date))]
    const weeks = dateSet.length
    if (!weeks) return { dayOfWeek:i, dayName:DAY_NAMES[i], avgTotal:0, avgMediadia:0, avgNoche:0, ticketsMediadia:0, ticketsNoche:0, weeks:0, demandTotal:0, demandMediadia:0, demandNoche:0 }

    const byDate: Record<string,{total:number;med:number;noch:number;tMed:number;tNoch:number}> = {}
    dateSet.forEach(d => { byDate[d] = {total:0,med:0,noch:0,tMed:0,tNoch:0} })
    recs.forEach(r => {
      byDate[r.date].total += r.amount
      if (r.turno==='mediodia') { byDate[r.date].med += r.amount; byDate[r.date].tMed++ }
      else { byDate[r.date].noch += r.amount; byDate[r.date].tNoch++ }
    })
    const days = Object.values(byDate)
    const avg = (a: number[]) => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0
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

  const maxTotal = Math.max(...dayPatterns.map(p=>p.avgTotal),1)
  const maxMed   = Math.max(...dayPatterns.map(p=>p.avgMediadia),1)
  const maxNoch  = Math.max(...dayPatterns.map(p=>p.avgNoche),1)
  dayPatterns.forEach(p => {
    p.demandTotal    = p.avgTotal    / maxTotal
    p.demandMediadia = p.avgMediadia / maxMed
    p.demandNoche    = p.avgNoche    / maxNoch
  })

  // Patrones horarios
  const byHour: Record<number,{total:number;count:number;dates:Set<string>}> = {}
  records.forEach(r => {
    if (!byHour[r.hour]) byHour[r.hour] = {total:0,count:0,dates:new Set()}
    byHour[r.hour].total += r.amount
    byHour[r.hour].count++
    byHour[r.hour].dates.add(r.date)
  })
  const hourlyPatterns: HourlyPattern[] = Object.entries(byHour).map(([h,v]) => ({
    hour: parseInt(h),
    label: `${h.toString().padStart(2,'0')}:00`,
    totalAmount: Math.round(v.total),
    avgAmount: Math.round(v.total / v.dates.size),
    ticketCount: v.count,
    days: v.dates.size
  })).sort((a,b) => a.hour - b.hour)

  // Recomendaciones de personal
  const recommendations: StaffRecommendation[] = dayPatterns.map(p => {
    const isWeekend = p.dayOfWeek >= 4
    const minNoche = isWeekend ? 3 : 2
    const extraManana = isWeekend && p.demandMediadia >= 0.6 ? 1 : 0
    const extraNoche  = p.demandNoche >= 0.85 ? 1 : 0
    const confidence: StaffRecommendation['confidence'] = p.weeks >= 8 ? 'alta' : p.weeks >= 3 ? 'media' : 'baja'
    const reasons = []
    if (p.avgTotal > 0) reasons.push(`media ${p.avgTotal.toLocaleString('es-ES')}€/día`)
    if (extraNoche) reasons.push('noche de alta demanda')
    if (extraManana) reasons.push('fin de semana con mediodía activo')
    if (p.weeks < 3) reasons.push(`solo ${p.weeks} día(s)`)
    return {
      dayOfWeek: p.dayOfWeek, dayName: p.dayName,
      avgTotal: p.avgTotal, demandTotal: p.demandTotal,
      recommendedManana: 1 + extraManana,
      recommendedNoche: minNoche + extraNoche,
      confidence, reason: reasons.join(' · ') || '—'
    }
  })

  return { records, dayPatterns, hourlyPatterns, recommendations, totalWeeks, dateRange:{from:dates[0],to:dates[dates.length-1]}, brands, sources, lastUpdated:new Date().toISOString() }
}

function empty(): SalesAnalysis {
  return { records:[], dayPatterns:[], hourlyPatterns:[], recommendations:[], totalWeeks:0, dateRange:{from:'',to:''}, brands:[], sources:[], lastUpdated:'' }
}

// ─── Persistencia ─────────────────────────────────────────────────────────────
const KEY = 'andy-sales-v2'
export function saveAnalysis(locId: string, data: { records: SaleRecord[]; analysis: SalesAnalysis }) {
  try { const all = loadAll(); all[locId] = {...data, savedAt:new Date().toISOString()}; localStorage.setItem(KEY, JSON.stringify(all)) }
  catch { console.warn('storage full') }
}
export function loadSavedAnalysis(locId: string): { records: SaleRecord[]; analysis: SalesAnalysis } | null {
  try { return loadAll()[locId] || null } catch { return null }
}
function loadAll(): Record<string,any> {
  try { const s = localStorage.getItem(KEY); return s?JSON.parse(s):{} } catch { return {} }
}
