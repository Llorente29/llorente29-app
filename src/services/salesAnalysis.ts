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
  dishes: number      // total de platos/raciones en el pedido
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
  rawSample?: unknown[]
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
    totalDays: uniqueDates.length,
    rawSample: allDeliveries.slice(0, 2)  // para debug
  }
}

// ─── Debug: inspeccionar estructura real de la API ────────────────────────────
export async function debugDeliveryStructure(
  token: string, centerId: string
): Promise<{ keys: string[]; sample: unknown; total: number; customers: unknown[] }> {
  const headers = { rememberme: token, order: centerId }
  const end = new Date().toISOString().slice(0,10)
  const start = new Date(Date.now() - 7*24*3600000).toISOString().slice(0,10)

  const [rawDeliveries, rawCustomers] = await Promise.all([
    fetch(`${API_BASE}/integration/sales/deliveries/all?startDate=${start}&endDate=${end}&includeInternal=true`, { headers }).then(r => r.json()).catch(() => []),
    fetch(`${API_BASE}/listCustomers`, { headers }).then(r => r.json()).catch(() => [])
  ])

  const arr: unknown[] = Array.isArray(rawDeliveries) ? rawDeliveries : (rawDeliveries as any)?.results || []
  const cust: unknown[] = Array.isArray(rawCustomers) ? rawCustomers : (rawCustomers as any)?.results || []
  const first = arr[0] as Record<string,unknown> | undefined

  return {
    total: arr.length,
    keys: first ? Object.keys(first) : [],
    sample: first,
    customers: cust.slice(0, 5)
  }
}

function parseDeliveries(deliveries: TspDelivery[], _customers: TspCustomer[]): SaleRecord[] {
  // Estructura real confirmada de tSpoonLab:
  // - d.date = timestamp ms (e.g. 1777499939000)
  // - d.base = importe total del albarán en € (precio venta)
  // - d.customer = nombre de la marca (viene directo en el albarán)
  // - d.listLines = líneas de producto (con quantity y cost, NO price de venta)
  // - d.id = identificador único del albarán → usamos como ticket ID
  // La HORA viene del timestamp del albarán, no de las líneas

  const byTicket = new Map<string, { date:string; time:string; amount:number; dishes:number; source:string; brand:string }>()

  deliveries.forEach(d => {
    const dAny = d as any
    const brand = dAny.customer || dAny.idCustomer || 'Desconocido'

    // Fecha y hora desde timestamp ms
    const tsMs = typeof dAny.date === 'number' ? dAny.date :
                 typeof dAny.date === 'string' && /^\d{10,}$/.test(dAny.date.trim()) ? parseInt(dAny.date) : null
    let dateStr: string
    let timeStr: string
    if (tsMs) {
      const dt = new Date(tsMs)
      dateStr = dt.toISOString().slice(0, 10)
      // Hora local (España = UTC+1 o UTC+2)
      const h = dt.getUTCHours() + 1  // aproximación UTC+1
      timeStr = `${h.toString().padStart(2,'0')}:${dt.getUTCMinutes().toString().padStart(2,'0')}`
    } else {
      dateStr = normalizeDate(dAny.date)
      timeStr = normalizeTime(dAny.time || dAny.hour || '')
    }

    // Importe: usar base (precio venta) del albarán
    const amount = dAny.base || dAny.total || dAny.totalAmount || dAny.amount || 0
    if (amount <= 0) return
    // Contar platos sumando quantity — excluir bebidas y postres (no generan elaboración)
    // Productos excluidos: no generan elaboración en cocina
    const EXCL_NAMES = ['agua','coca cola','coca-cola','cocacola','fanta','mahou','cerveza',
      'tarta tres leches','tarta 3 leches','cheesecake','cheescake',
      'tarrina (cuvo) brownie','tarrina (cuvo) cheescake',
      'tarrina mayo','tarrina mil islas','tarrina salsa','tarrina sweet chilli',
      'delivery','descuento']
    const EXCL_FAMS = ['bebida','drink','postre','dessert','refresco','café','cafe','coffee',
      'cerveza','vino','cocktail','cóctel','pasteleria','pastelería','bolleria','bollería',
      'pastas','salsa','salsas']
    const normalize = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    const lines = dAny.listLines || dAny.deliveryLines || dAny.lines || []
    const dishes = lines.reduce((sum: number, l: any) => {
      const name = normalize(l.component || l.descr || l.description || '')
      const types: string[] = (l.listTypes || []).map((t: any) => normalize(t.descr || t.description || ''))
      // Excluir si el nombre contiene alguna palabra excluida
      const nameExcluded = EXCL_NAMES.some(ex => name.includes(normalize(ex)))
      // Excluir si alguna familia contiene alguna palabra excluida
      const famExcluded = types.some(t => EXCL_FAMS.some(ex => t.includes(normalize(ex))))
      if (nameExcluded || famExcluded) return sum
      return sum + (parseFloat(l.quantity) || 1)
    }, 0) || 1

    // Un albarán = un pedido/ticket
    const ticketId = dAny.id || `${dateStr}_${brand}_${Math.random()}`

    // Fuente: tipo de cliente (Delivery, Sala, etc.)
    const src = dAny.customerType || dAny.customerTypeCode || brand

    byTicket.set(ticketId, { date: dateStr, time: timeStr, amount, dishes, source: src, brand })
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
      dishes: v.dishes,
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

  const byTicket = new Map<string, { date:string; time:string; amount:number; dishes:number; source:string; brand:string }>()
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
      byTicket.set(ticket, { date, time, amount, dishes: 1, source, brand: source })
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
      amount: v.amount, dishes: v.dishes || 1, source: v.source, brand: v.brand, ticket
    })
  })

  return records.filter(r => r.amount > 0).sort((a,b) => a.date.localeCompare(b.date))
}

// ─── Helpers de normalización ─────────────────────────────────────────────────
function normalizeDate(raw: unknown): string {
  try {
    if (!raw) return new Date().toISOString().slice(0,10)
    // Si ya es un objeto Date
    if (raw instanceof Date) return raw.toISOString().slice(0,10)
    // Convertir a string de forma segura
    let s = String(raw).trim()
    if (!s || s === 'null' || s === 'undefined') return new Date().toISOString().slice(0,10)
    // Timestamp numérico (ms desde epoch)
    if (/^\d{10,}$/.test(s)) return new Date(parseInt(s)).toISOString().slice(0,10)
    // Timestamp largo: "2026-05-05T12:00:00" o "2026-05-05 00:00:00"
    if (s.length > 10) s = s.slice(0, 10)
    // DD/MM/YYYY → YYYY-MM-DD
    if (s.includes('/')) {
      const parts = s.split('/')
      if (parts.length === 3) {
        const [d, m, y] = parts
        return `${y.length===4?y:'20'+y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
      }
    }
    return s
  } catch { return new Date().toISOString().slice(0,10) }
}

function normalizeTime(raw: unknown): string {
  try {
    if (!raw) return '13:00'
    const clean = String(raw).trim()
    if (!clean || clean === 'null') return '13:00'
    if (/^\d{2}:\d{2}/.test(clean)) return clean.slice(0,5)
    if (/^\d{1,2}$/.test(clean)) return `${clean.padStart(2,'0')}:00`
    return '13:00'
  } catch { return '13:00' }
}

// ─── Motor de análisis ────────────────────────────────────────────────────────
export interface DayPattern {
  dayOfWeek: number; dayName: string
  avgTotal: number; avgMediadia: number; avgNoche: number
  avgDishesMediadia: number; avgDishesNoche: number   // platos/raciones por turno
  ticketsMediadia: number; ticketsNoche: number
  weeks: number
  demandTotal: number; demandMediadia: number; demandNoche: number
  demandDishesMediadia: number; demandDishesNoche: number
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
    if (!weeks) return { dayOfWeek:i, dayName:DAY_NAMES[i], avgTotal:0, avgMediadia:0, avgNoche:0, avgDishesMediadia:0, avgDishesNoche:0, ticketsMediadia:0, ticketsNoche:0, weeks:0, demandTotal:0, demandMediadia:0, demandNoche:0, demandDishesMediadia:0, demandDishesNoche:0 }

    const byDate: Record<string,{total:number;med:number;noch:number;tMed:number;tNoch:number;dMed:number;dNoch:number}> = {}
    dateSet.forEach(d => { byDate[d] = {total:0,med:0,noch:0,tMed:0,tNoch:0,dMed:0,dNoch:0} })
    recs.forEach(r => {
      byDate[r.date].total += r.amount
      if (r.turno==='mediodia') { byDate[r.date].med += r.amount; byDate[r.date].tMed++; byDate[r.date].dMed += (r.dishes||1) }
      else { byDate[r.date].noch += r.amount; byDate[r.date].tNoch++; byDate[r.date].dNoch += (r.dishes||1) }
    })
    const days = Object.values(byDate)
    const avg = (a: number[]) => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0
    return {
      dayOfWeek:i, dayName:DAY_NAMES[i],
      avgTotal:    Math.round(avg(days.map(d=>d.total))),
      avgMediadia: Math.round(avg(days.map(d=>d.med))),
      avgNoche:    Math.round(avg(days.map(d=>d.noch))),
      avgDishesMediadia: Math.round(avg(days.map(d=>d.dMed))),
      avgDishesNoche:    Math.round(avg(days.map(d=>d.dNoch))),
      ticketsMediadia: Math.round(avg(days.map(d=>d.tMed))),
      ticketsNoche:    Math.round(avg(days.map(d=>d.tNoch))),
      weeks, demandTotal:0, demandMediadia:0, demandNoche:0, demandDishesMediadia:0, demandDishesNoche:0
    }
  })

  const maxTotal = Math.max(...dayPatterns.map(p=>p.avgTotal),1)
  const maxMed   = Math.max(...dayPatterns.map(p=>p.avgMediadia),1)
  const maxNoch  = Math.max(...dayPatterns.map(p=>p.avgNoche),1)
  const maxDMed  = Math.max(...dayPatterns.map(p=>p.avgDishesMediadia),1)
  const maxDNoch = Math.max(...dayPatterns.map(p=>p.avgDishesNoche),1)
  dayPatterns.forEach(p => {
    p.demandTotal    = p.avgTotal    / maxTotal
    p.demandMediadia = p.avgMediadia / maxMed
    p.demandNoche    = p.avgNoche    / maxNoch
    p.demandDishesMediadia = p.avgDishesMediadia / maxDMed
    p.demandDishesNoche    = p.avgDishesNoche    / maxDNoch
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
    // Calcular personal por platos: ~15 platos/hora por trabajador en cocina dark kitchen
    // Turno mañana ≈ 3.5h · turno noche ≈ 4.5h
    const DISHES_PER_WORKER_HOUR = 15
    const mananaHours = 3.5
    const nocheHours = 4.5
    const workersByDishesManana = p.avgDishesMediadia > 0
      ? Math.ceil(p.avgDishesMediadia / (DISHES_PER_WORKER_HOUR * mananaHours))
      : 1
    const workersByDishesNoche = p.avgDishesNoche > 0
      ? Math.ceil(p.avgDishesNoche / (DISHES_PER_WORKER_HOUR * nocheHours))
      : minNoche
    // Tomar el máximo entre el mínimo del convenio y el calculado por platos
    const recManana = Math.max(1, workersByDishesManana)
    const recNoche  = Math.max(minNoche, workersByDishesNoche)
    const confidence: StaffRecommendation['confidence'] = p.weeks >= 8 ? 'alta' : p.weeks >= 3 ? 'media' : 'baja'
    const reasons = []
    if (p.avgDishesMediadia > 0) reasons.push(`${p.avgDishesMediadia} platos mediodía`)
    if (p.avgDishesNoche > 0) reasons.push(`${p.avgDishesNoche} platos noche`)
    if (p.avgTotal > 0) reasons.push(`${p.avgTotal.toLocaleString('es-ES')}€/día`)
    if (p.weeks < 3) reasons.push(`solo ${p.weeks} día(s)`)
    return {
      dayOfWeek: p.dayOfWeek, dayName: p.dayName,
      avgTotal: p.avgTotal, demandTotal: p.demandTotal,
      recommendedManana: recManana,
      recommendedNoche: recNoche,
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

// ─── Extraer productos únicos de los albaranes descargados ──────────────────
export async function fetchAllProducts(token: string, centerId: string): Promise<{
  name: string; family: string; codi?: string
}[]> {
  const API = 'https://app.tspoonlab.com/recipes/api'
  const headers = { rememberme: token, order: centerId }

  // Usar los albaranes (que SÍ tienen listLines con component y listTypes)
  const end = new Date().toISOString().slice(0,10)
  const start = new Date(Date.now() - 60*24*3600000).toISOString().slice(0,10)
  const raw = await fetch(`${API}/integration/sales/deliveries/all?startDate=${start}&endDate=${end}&includeInternal=true`, { headers })
    .then(r => r.json()).catch(() => [])
  const deliveries: any[] = Array.isArray(raw) ? raw : raw?.results || []

  // Extraer productos únicos de todas las líneas
  const seen = new Map<string, { name: string; family: string }>()
  deliveries.forEach(d => {
    const lines: any[] = d.listLines || d.deliveryLines || d.lines || []
    lines.forEach(l => {
      const name = (l.component || l.descr || '').trim()
      if (!name) return
      const key = name.toLowerCase()
      if (!seen.has(key)) {
        const families = (l.listTypes || []).map((t: any) => t.descr || t.description || '').filter(Boolean).join(', ')
        seen.set(key, { name, family: families || '(sin familia)' })
      }
    })
  })

  return [...seen.values()].sort((a,b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name))
}
