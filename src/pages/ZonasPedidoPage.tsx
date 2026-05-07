// src/pages/ZonasPedidoPage.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Card } from '../components/ui'
import type { DeliveryRecord, DeliveryZoneConfig } from '../types'
import {
  fetchWebhookRecords, enrichRecords, geocodeBarrios,
  saveRecords, loadRecords, saveZoneConfigs, loadZoneConfigs,
  computeBarrioStats, computeLocationStats, simulateRadius,
  coordsForLocation,
  type LocationStats, type BarrioStats, type RadiusSimResult,
} from '../services/deliveryZones'

// ── Paleta de colores por local ────────────────────────────────────────────
const LOC_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6']
const LOC_BG     = ['bg-blue-500', 'bg-red-500', 'bg-green-500', 'bg-amber-500', 'bg-violet-500']
const LOC_TEXT   = ['text-blue-600', 'text-red-600', 'text-green-600', 'text-amber-600', 'text-violet-600']
const LOC_LIGHT  = ['bg-blue-50', 'bg-red-50', 'bg-green-50', 'bg-amber-50', 'bg-violet-50']

const SOURCE_COLORS: Record<string, string> = {
  Glovo: 'bg-amber-100 text-amber-800',
  Uber: 'bg-gray-800 text-white',
  JustEat: 'bg-orange-100 text-orange-800',
  Shop: 'bg-teal-100 text-teal-800',
  OwnDelivery: 'bg-purple-100 text-purple-800',
}

// ── Componente mini mapa SVG ───────────────────────────────────────────────
// Madrid central: lat 40.28–40.56, lng -3.83–-3.57
const MAP_LAT = [40.28, 40.58]
const MAP_LNG = [-3.84, -3.54]
const W = 600; const H = 400

function latLngToXY(lat: number, lng: number): [number, number] {
  const x = ((lng - MAP_LNG[0]) / (MAP_LNG[1] - MAP_LNG[0])) * W
  const y = ((MAP_LAT[1] - lat) / (MAP_LAT[1] - MAP_LAT[0])) * H
  return [x, y]
}

function radiusToPixels(radiusKm: number): number {
  // 1 grado lng ≈ 82 km en Madrid → W píxeles = (MAP_LNG[1]-MAP_LNG[0])*82 km
  const kmPerPx = ((MAP_LNG[1] - MAP_LNG[0]) * 82) / W
  return radiusKm / kmPerPx
}

interface MapaZonasProps {
  records: DeliveryRecord[]
  locStats: LocationStats[]
  zoneConfigs: DeliveryZoneConfig[]
  locationIndex: (id: string) => number
}

function MapaZonas({ records, locStats, zoneConfigs, locationIndex }: MapaZonasProps) {
  const [_hover, setHover] = useState<string | null>(null)

  // Cluster por barrio para no pintar 1271 puntos
  const clustered = (() => {
    const m = new Map<string, { lat: number; lng: number; count: number; locationId: string; amount: number }>()
    for (const r of records) {
      if (!r.lat || !r.lng) continue
      const key = `${r.barrio}_${r.locationId}`
      if (!m.has(key)) m.set(key, { lat: r.lat, lng: r.lng, count: 0, locationId: r.locationId, amount: 0 })
      const c = m.get(key)!
      c.count++; c.amount += r.amount
    }
    return [...m.values()]
  })()

  return (
    <div className="relative bg-slate-50 rounded-xl border border-gray-200 overflow-hidden" style={{ height: 400 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Fondo */}
        <rect width={W} height={H} fill="#f8fafc" />

        {/* Radios de cada zona */}
        {zoneConfigs.map(z => {
          const [cx, cy] = latLngToXY(z.lat, z.lng)
          const r = radiusToPixels(z.radiusKm)
          const idx = locationIndex(z.locationId)
          return (
            <g key={z.locationId}>
              <circle cx={cx} cy={cy} r={r}
                fill={LOC_COLORS[idx % LOC_COLORS.length]}
                fillOpacity={0.08}
                stroke={LOC_COLORS[idx % LOC_COLORS.length]}
                strokeWidth={1.5}
                strokeDasharray="6 3"
              />
            </g>
          )
        })}

        {/* Clusters de entregas */}
        {clustered.map((c, i) => {
          const [cx, cy] = latLngToXY(c.lat, c.lng)
          const idx = locationIndex(c.locationId)
          const r = Math.min(3 + Math.sqrt(c.count) * 1.5, 14)
          const key = `${c.lat}_${c.lng}_${c.locationId}`
          return (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill={LOC_COLORS[idx % LOC_COLORS.length]}
              fillOpacity={0.65}
              stroke="white" strokeWidth={0.5}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${c.count} entregas · ${c.amount.toFixed(0)}€`}</title>
            </circle>
          )
        })}

        {/* Marcadores de locales */}
        {zoneConfigs.map(z => {
          const [cx, cy] = latLngToXY(z.lat, z.lng)
          const idx = locationIndex(z.locationId)
          const stat = locStats.find(s => s.locationId === z.locationId)
          return (
            <g key={`marker_${z.locationId}`}>
              <circle cx={cx} cy={cy} r={8}
                fill={LOC_COLORS[idx % LOC_COLORS.length]}
                stroke="white" strokeWidth={2}
              />
              <text x={cx} y={cy + 20} textAnchor="middle"
                fontSize={9} fill="#1e293b" fontWeight="600"
              >
                {stat?.locationName.split(' ').slice(-1)[0] || ''}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Leyenda */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1">
        {locStats.map((s, i) => (
          <div key={s.locationId} className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-0.5 text-[10px] font-medium shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: LOC_COLORS[i % LOC_COLORS.length] }} />
            {s.locationName}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tabs ───────────────────────────────────────────────────────────────────
type Tab = 'mapa' | 'barrios' | 'comparativa' | 'solape'

// ── Página principal ───────────────────────────────────────────────────────
export default function ZonasPedidoPage() {
  const { locations } = useApp()
  const [tab, setTab] = useState<Tab>('comparativa')
  const [records, setRecords] = useState<DeliveryRecord[]>([])
  const [locStats, setLocStats] = useState<LocationStats[]>([])
  const [barrioStats, setBarrioStats] = useState<BarrioStats[]>([])
  const [zoneConfigs, setZoneConfigs] = useState<DeliveryZoneConfig[]>([])
  const [simResults, setSimResults] = useState<RadiusSimResult[]>([])
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [daysBack, setDaysBack] = useState(30)
  const [error, setError] = useState('')
  const [csvUpdatedAt, setCsvUpdatedAt] = useState<string | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  // Índice de color por locationId
  const locationIndex = useCallback((id: string) => {
    const idx = locStats.findIndex(s => s.locationId === id)
    return idx >= 0 ? idx : 0
  }, [locStats])

  // Inicializar zonas desde locations de Andy + localStorage
  useEffect(() => {
    const saved = loadZoneConfigs()
    if (saved.length) {
      setZoneConfigs(saved)
    } else {
      // Generar defaults desde locations de AppContext
      const defaults: DeliveryZoneConfig[] = locations
        .filter(l => l.active)
        .map(l => {
          const coords = coordsForLocation(l.name) || { lat: 40.4168, lng: -3.7038 }
          return { locationId: l.id, radiusKm: 3.5, lat: coords.lat, lng: coords.lng }
        })
      setZoneConfigs(defaults)
    }
  }, [locations])

  // Cargar datos guardados
  useEffect(() => {
    const saved = loadRecords()
    if (saved?.records?.length) {
      setRecords(saved.records)
      setSavedAt(saved.savedAt)
    }
    // Cargar fecha del último CSV
    const csvDate = localStorage.getItem('andy-geodata-csv-date')
    if (csvDate) setCsvUpdatedAt(csvDate)
  }, [])

  // Parsear CSV de Last.app y geocodificar direcciones
  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProgress('Leyendo CSV...')
    const text = await file.text()

    // Detectar separador: coma o punto y coma
    const firstLine = text.split('\n')[0]
    const sep = firstLine.includes(';') ? ';' : ','

    // Parser que respeta comillas (campos con comas dentro van entre "...")
    function parseLine(line: string): string[] {
      const result: string[] = []
      let cur = ''; let inQ = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"') { inQ = !inQ }
        else if (c === sep && !inQ) { result.push(cur.trim()); cur = '' }
        else { cur += c }
      }
      result.push(cur.trim())
      return result
    }

    const lines = text.split('\n').filter(l => l.trim())
    const header = parseLine(lines[0]).map(h => h.replace(/"/g, '').trim())

    // Columnas del CSV de Last.app
    const idxLocal   = header.findIndex(h => h === 'Ubicación' || h.toLowerCase().includes('ubicaci'))
    const idxAddr    = header.findIndex(h => h === 'Dirección del cliente' || h.toLowerCase().includes('direcci'))
    const idxImporte = header.findIndex(h => h === 'Total' || h.toLowerCase() === 'total')
    const idxFuente  = header.findIndex(h => h === 'Fuente' || h.toLowerCase() === 'fuente')
    const idxFecha   = header.findIndex(h => h === 'Hora de creación' || h.toLowerCase().includes('creaci'))
    const idxBrand   = header.findIndex(h => h === 'Marca virtual' || h.toLowerCase().includes('marca'))

    if (idxLocal < 0 || idxAddr < 0) {
      setError(`CSV no reconocido. Columnas encontradas: ${header.slice(0,5).join(', ')}`)
      setProgress('')
      e.target.value = ''
      return
    }

    const csvRecords: DeliveryRecord[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i])
      if (cols.length < 3) continue
      const address    = idxAddr >= 0    ? cols[idxAddr].replace(/"/g, '').trim()   : ''
      const locationName = idxLocal >= 0 ? cols[idxLocal].replace(/"/g, '').trim()  : 'Desconocido'
      const amountStr  = idxImporte >= 0 ? cols[idxImporte].replace(/"/g, '').trim(): '0'
      const amount     = parseFloat(amountStr.replace(',', '.')) || 0
      const source     = idxFuente >= 0  ? cols[idxFuente].replace(/"/g, '').trim() : 'Desconocido'
      const dateRaw    = idxFecha >= 0   ? cols[idxFecha].replace(/"/g, '').trim()  : ''
      // brand disponible en cols[idxBrand] si se necesita en el futuro
      // Extraer fecha YYYY-MM-DD del timestamp ISO
      const date       = dateRaw.slice(0, 10)
      // Extraer barrio de la dirección (segundo componente separado por coma)
      const addrParts  = address.split(',')
      const barrio     = addrParts.length > 1 ? addrParts[addrParts.length - 2]?.trim() : 'Desconocido'
      if (!address) continue
      csvRecords.push({
        id: `csv-${i}`, locationId: locationName, locationName,
        date, amount, source, barrio: barrio || 'Desconocido',
        address,
      })
    }

    setProgress(`${csvRecords.length} registros del CSV. Geocodificando direcciones nuevas...`)

    // Geocodificar direcciones únicas que no tengan coordenadas ya
    const existingAddrs = new Set(records.filter(r => r.lat).map(r => r.address || ''))
    const newAddrs = [...new Set(csvRecords.map(r => r.address || '').filter(a => a && !existingAddrs.has(a)))]

    const coordsCache: Record<string, { lat: number; lng: number }> = JSON.parse(localStorage.getItem('andy-geo-cache') || '{}')
    const toGeocode = newAddrs.filter(a => !coordsCache[a])

    if (toGeocode.length > 0) {
      const BATCH = 5
      for (let i = 0; i < toGeocode.length; i += BATCH) {
        const batch = toGeocode.slice(i, i + BATCH)
        setProgress(`Geocodificando ${i + batch.length}/${toGeocode.length}...`)
        try {
          const res = await fetch('https://lastapp-webhook.vercel.app/api/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: batch }),
          })
          if (res.ok) {
            const data = await res.json()
            for (const [addr, coords] of Object.entries(data.results || {})) {
              const c = coords as { lat?: number; lng?: number; ok?: boolean }
              if (c.ok && c.lat && c.lng) coordsCache[addr] = { lat: c.lat, lng: c.lng }
            }
          }
        } catch { /* silencioso */ }
      }
      localStorage.setItem('andy-geo-cache', JSON.stringify(coordsCache))
    }

    // Añadir coordenadas a los registros CSV
    const enrichedCsv: DeliveryRecord[] = csvRecords.map(r => {
      const coords = coordsCache[r.address || '']
      return coords ? { ...r, lat: coords.lat, lng: coords.lng } : r
    })

    // Combinar con records existentes (evitar duplicados por address+date)
    const existingKeys = new Set(records.map(r => `${r.address}_${r.date}`))
    const newRecords = enrichedCsv.filter(r => !existingKeys.has(`${r.address}_${r.date}`))
    const combined = [...records, ...newRecords]

    setRecords(combined)
    saveRecords(combined)
    const now = new Date().toISOString()
    setSavedAt(now)
    setCsvUpdatedAt(now)
    localStorage.setItem('andy-geodata-csv-date', now)
    setProgress('')
    e.target.value = ''
  }

  // Recalcular estadísticas cuando cambian records o zonas
  useEffect(() => {
    if (!records.length) return
    setLocStats(computeLocationStats(records))
    setBarrioStats(computeBarrioStats(records))
  }, [records])

  // Recalcular simulación cuando cambian zonas o records
  useEffect(() => {
    if (!records.length || !zoneConfigs.length) return
    setSimResults(simulateRadius(records, zoneConfigs))
  }, [records, zoneConfigs])

  // Sync completo desde webhook
  async function handleSync() {
    setSyncing(true); setError(''); setProgress('Conectando con Last.app...')
    try {
      setProgress('Descargando pedidos...')
      const raw = await fetchWebhookRecords(daysBack)
      setProgress(`${raw.length} pedidos descargados. Geocodificando barrios...`)

      // Recoger barrios únicos
      const barrios = [...new Set(raw.map(r => r.barrio).filter(Boolean))]
      const barrioCoords = await geocodeBarrios(barrios as string[])
      setProgress('Enriqueciendo datos...')

      // Asegurar que zoneConfigs tienen coords
      const configs: DeliveryZoneConfig[] = zoneConfigs.length > 0 ? zoneConfigs : []

      const enriched = enrichRecords(raw, configs, barrioCoords)
      setRecords(enriched)
      saveRecords(enriched)
      setSavedAt(new Date().toISOString())
      setProgress('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setProgress('')
    }
    setSyncing(false)
  }

  // Actualizar radio de una zona
  function updateRadius(locationId: string, radiusKm: number) {
    const updated = zoneConfigs.map(z => z.locationId === locationId ? { ...z, radiusKm } : z)
    setZoneConfigs(updated)
    saveZoneConfigs(updated)
  }

  const totalAmount = records.reduce((s, r) => s + r.amount, 0)
  const uniqueBarrios = new Set(records.map(r => r.barrio)).size
  const sharedBarrios = barrioStats.filter(b => b.isShared)

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'mapa',        label: 'Mapa',        icon: '🗺️' },
    { id: 'barrios',     label: 'Barrios',      icon: '📍' },
    { id: 'comparativa', label: 'Comparativa',  icon: '📊' },
    { id: 'solape',      label: 'Solape',       icon: '⚠️' },
  ]

  return (
    <div className="space-y-5">
      {/* Header + sync */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-gray-400 mt-0.5">
            {records.length > 0
              ? `${records.length} entregas · guardado ${savedAt ? new Date(savedAt).toLocaleDateString('es-ES') : '—'}`
              : 'Sin datos. Pulsa Sincronizar para cargar.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={daysBack}
            onChange={e => setDaysBack(+e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
            disabled={syncing}
          >
            {[15, 30, 60, 90].map(d => <option key={d} value={d}>{d} días</option>)}
          </select>
          <Button onClick={handleSync} disabled={syncing} size="sm">
            {syncing ? '⏳ Sincronizando...' : '🔄 Sincronizar'}
          </Button>
        </div>
      </div>

      {/* CSV status + subida */}
      <div className="flex items-center gap-3 flex-wrap">
        {csvUpdatedAt ? (
          <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${
            (new Date().getTime() - new Date(csvUpdatedAt).getTime()) < 7 * 86400000
              ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            ✅ CSV actualizado {new Date(csvUpdatedAt).toLocaleDateString('es-ES')}
          </span>
        ) : (
          <span className="text-xs px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 font-medium">
            ⚠️ Sin datos CSV de Last.app
          </span>
        )}
        <button
          onClick={() => csvInputRef.current?.click()}
          className="cursor-pointer text-xs px-3 py-1.5 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-teal-400 hover:text-teal-600 transition-all"
        >
          📄 Subir CSV de Last.app
        </button>
        <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
        <span className="text-xs text-gray-400">Last.app → Reportes → Registros financieros → Cuentas → Exportar CSV</span>
      </div>

      {progress && (
        <div className="flex items-center gap-2 text-sm text-teal-700 bg-teal-50 rounded-lg px-4 py-2.5 border border-teal-100">
          <span className="animate-spin text-base">⏳</span> {progress}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-2.5 border border-red-100">
          ❌ {error}
        </div>
      )}

      {/* KPIs */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total entregas',      value: records.length.toLocaleString('es-ES'), icon: '📦' },
            { label: 'Importe total',       value: `€${totalAmount.toLocaleString('es-ES', { maximumFractionDigits: 0 })}`, icon: '💶' },
            { label: 'Ticket medio',        value: `€${(totalAmount / records.length).toFixed(2)}`, icon: '🧾' },
            { label: 'Barrios distintos',   value: uniqueBarrios.toString(), icon: '📍' },
          ].map(k => (
            <Card key={k.label} className="text-center py-4">
              <div className="text-2xl mb-1">{k.icon}</div>
              <div className="text-xl font-bold text-gray-900">{k.value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
              tab === t.id
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            } ${t.id === 'solape' && sharedBarrios.length > 0 ? 'relative' : ''}`}
          >
            {t.icon} {t.label}
            {t.id === 'solape' && sharedBarrios.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full">
                {sharedBarrios.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: MAPA ── */}
      {tab === 'mapa' && (
        <div className="space-y-4">
          {records.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <MapaZonas
                records={records}
                locStats={locStats}
                zoneConfigs={zoneConfigs}
                locationIndex={locationIndex}
              />

              {/* Simulador de radios */}
              <Card className="p-4 space-y-4">
                <p className="text-sm font-semibold text-gray-700">Simulador de radios</p>
                {zoneConfigs.map(z => {
                  const idx = locationIndex(z.locationId)
                  const stat = locStats.find(s => s.locationId === z.locationId)
                  const sim = simResults.find(s => s.locationId === z.locationId)
                  return (
                    <div key={z.locationId} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full" style={{ background: LOC_COLORS[idx] }} />
                          <span className="text-sm font-medium text-gray-700">{stat?.locationName || z.locationId}</span>
                        </div>
                        <span className="text-sm font-bold text-gray-900">{z.radiusKm.toFixed(1)} km</span>
                      </div>
                      <input
                        type="range" min={0.5} max={8} step={0.1}
                        value={z.radiusKm}
                        onChange={e => updateRadius(z.locationId, +e.target.value)}
                        className="w-full accent-teal-600"
                      />
                      {sim && (
                        <div className="flex gap-4 text-[11px]">
                          <span className="text-green-700 font-medium">
                            ✅ {sim.covered} pedidos ({(sim.coveredPct * 100).toFixed(0)}%) · €{sim.coveredAmount.toFixed(0)}
                          </span>
                          {sim.lost > 0 && (
                            <span className="text-red-600 font-medium">
                              ❌ {sim.lost} fuera · €{sim.lostAmount.toFixed(0)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── TAB: BARRIOS ── */}
      {tab === 'barrios' && (
        <div className="space-y-3">
          {records.length === 0 ? <EmptyState /> : (
            <>
              <p className="text-xs text-gray-400">{barrioStats.length} barrios · {sharedBarrios.length} con solape entre locales</p>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold">Barrio</th>
                      {locStats.map((s, i) => (
                        <th key={s.locationId} className="text-center px-3 py-2.5 font-semibold">
                          <span className={`px-2 py-0.5 rounded-full text-white text-[10px] ${LOC_BG[i % LOC_BG.length]}`}>
                            {s.locationName.split(' ').slice(-2).join(' ')}
                          </span>
                        </th>
                      ))}
                      <th className="text-right px-4 py-2.5 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {barrioStats.slice(0, 40).map(b => (
                      <tr key={b.barrio}
                        className={`hover:bg-gray-50 transition-colors ${b.isShared ? 'bg-amber-50/40' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-800">
                          {b.isShared && <span className="mr-1.5 text-amber-500">⚡</span>}
                          {b.barrio}
                        </td>
                        {locStats.map((s, i) => {
                          const v = b.byLocation[s.locationId]
                          return (
                            <td key={s.locationId} className="px-3 py-2.5 text-center">
                              {v ? (
                                <span className={`px-2 py-0.5 rounded-full text-sm font-semibold ${LOC_LIGHT[i % LOC_LIGHT.length]} ${LOC_TEXT[i % LOC_TEXT.length]}`}>
                                  {v.count}
                                </span>
                              ) : (
                                <span className="text-gray-200">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-700">{b.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB: COMPARATIVA ── */}
      {tab === 'comparativa' && (
        <div className="space-y-4">
          {records.length === 0 ? <EmptyState /> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {locStats.map((s, i) => (
                  <Card key={s.locationId} className="p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ background: LOC_COLORS[i % LOC_COLORS.length] }} />
                      <p className="font-bold text-gray-900 text-sm">{s.locationName}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div>
                        <p className="text-2xl font-bold" style={{ color: LOC_COLORS[i % LOC_COLORS.length] }}>{s.count}</p>
                        <p className="text-[10px] text-gray-400">entregas</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-gray-700">€{s.ticketMedio.toFixed(0)}</p>
                        <p className="text-[10px] text-gray-400">ticket medio</p>
                      </div>
                    </div>

                    {s.distP50 != null && (
                      <div className="text-[11px] text-gray-500 space-y-0.5">
                        <p className="font-semibold text-gray-600 mb-1">Distancia al local</p>
                        <div className="flex justify-between"><span>P50</span><span className="font-medium text-gray-700">{s.distP50.toFixed(1)} km</span></div>
                        <div className="flex justify-between"><span>P75</span><span className="font-medium text-gray-700">{s.distP75?.toFixed(1)} km</span></div>
                        <div className="flex justify-between"><span>P90</span><span className="font-medium text-gray-700">{s.distP90?.toFixed(1)} km</span></div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Top barrios</p>
                      <div className="space-y-1">
                        {s.topBarrios.slice(0, 5).map(b => (
                          <div key={b.barrio} className="flex items-center justify-between">
                            <span className="text-xs text-gray-600 truncate max-w-[120px]">{b.barrio}</span>
                            <span className="text-xs font-bold" style={{ color: LOC_COLORS[i % LOC_COLORS.length] }}>{b.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Por fuente</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(s.bySource).sort(([,a],[,b]) => b - a).map(([src, cnt]) => (
                          <span key={src} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLORS[src] || 'bg-gray-100 text-gray-700'}`}>
                            {src} {cnt}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Tabla barrios compartidos */}
              {sharedBarrios.length > 0 && (
                <Card className="p-5">
                  <p className="font-semibold text-gray-800 mb-3">Barrios compartidos entre locales</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                        <tr>
                          <th className="text-left py-2 font-semibold">Barrio</th>
                          {locStats.map((s, i) => (
                            <th key={s.locationId} className="text-center py-2 font-semibold">
                              <span style={{ color: LOC_COLORS[i] }}>{s.locationName.split(' ').slice(-2).join(' ')}</span>
                            </th>
                          ))}
                          <th className="text-right py-2 font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sharedBarrios.map(b => (
                          <tr key={b.barrio} className="hover:bg-gray-50">
                            <td className="py-2 font-medium text-gray-800">{b.barrio}</td>
                            {locStats.map((s, i) => {
                              const v = b.byLocation[s.locationId]
                              return (
                                <td key={s.locationId} className="py-2 text-center">
                                  {v ? (
                                    <span className={`px-2.5 py-1 rounded-full text-sm font-bold ${LOC_LIGHT[i]} ${LOC_TEXT[i]}`}>
                                      {v.count}
                                    </span>
                                  ) : '—'}
                                </td>
                              )
                            })}
                            <td className="py-2 text-right font-semibold">{b.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: SOLAPE ── */}
      {tab === 'solape' && (
        <div className="space-y-4">
          {records.length === 0 ? <EmptyState /> : <SolapeAnalysis records={records} locStats={locStats} />}
        </div>
      )}
    </div>
  )
}

// ── Coordenadas de barrios para cálculo de distancias ─────────────────────
const BARRIO_CENTROIDES: Record<string, { lat: number; lng: number }> = {
  'Cdad. Lineal':          { lat: 40.4423, lng: -3.6501 },
  'Ciudad Lineal':         { lat: 40.4423, lng: -3.6501 },
  'Salamanca':             { lat: 40.4286, lng: -3.6784 },
  'San Blas-Canillejas':   { lat: 40.4266, lng: -3.6079 },
  'Chamartín':             { lat: 40.4597, lng: -3.6770 },
  'Retiro':                { lat: 40.4082, lng: -3.6843 },
  'Carabanchel':           { lat: 40.3866, lng: -3.7366 },
  'Latina':                { lat: 40.4068, lng: -3.7285 },
  'Calle Piedrahita':      { lat: 40.3910, lng: -3.7280 },
  'Arganzuela':            { lat: 40.3959, lng: -3.7037 },
  'Tetuán':                { lat: 40.4597, lng: -3.7037 },
  'Fuencarral-El Pardo':   { lat: 40.5049, lng: -3.7101 },
  'Calle de Orense':       { lat: 40.4581, lng: -3.6938 },
  'Moncloa - Aravaca':     { lat: 40.4357, lng: -3.7248 },
  'Moratalaz':             { lat: 40.4052, lng: -3.6487 },
  'Vallecas':              { lat: 40.3836, lng: -3.6549 },
  'Hortaleza':             { lat: 40.4777, lng: -3.6385 },
  'Centro':                { lat: 40.4168, lng: -3.7038 },
  'Villaverde':            { lat: 40.3534, lng: -3.7078 },
  'Usera':                 { lat: 40.3909, lng: -3.7136 },
  'Calle de Arturo Soria': { lat: 40.4550, lng: -3.6450 },
  'Calle de López de Hoyos': { lat: 40.4500, lng: -3.6700 },
  'Calle del Príncipe de Vergara': { lat: 40.4380, lng: -3.6750 },
  'Paseo de la Castellana': { lat: 40.4530, lng: -3.6920 },
  'Calle Francolin':       { lat: 40.3875, lng: -3.7395 },
  'Calle Franckolín':      { lat: 40.3875, lng: -3.7395 },
  'España':                { lat: 40.4200, lng: -3.7100 },
  'Calle de Cronos':       { lat: 40.4480, lng: -3.6380 },
  'Calle de Sambara':      { lat: 40.4260, lng: -3.6500 },
}

// Factor urbano: línea recta × 1.40 ≈ distancia de recorrido en Madrid
const URBAN_FACTOR = 1.40

// Coordenadas conocidas de los 3 locales
const LOCAL_COORDS_FIXED: Record<string, { lat: number; lng: number }> = {
  'alcal':       { lat: 40.4346, lng: -3.6528 },  // C. Florencio Llorente 29
  'carabanchel': { lat: 40.3912, lng: -3.7399 },  // C. Camichi 4
  'castilla':    { lat: 40.4698, lng: -3.6928 },  // C. Cañaveral 75
}

function getLocalCoords(name: string): { lat: number; lng: number } | null {
  const n = name.toLowerCase()
  for (const [k, v] of Object.entries(LOCAL_COORDS_FIXED)) {
    if (n.includes(k)) return v
  }
  return null
}

interface SolapeItem {
  barrio: string
  total: number
  totalImporte: number
  porLocal: Record<string, { count: number; amount: number; distLinea: number; distRuta: number }>
  localMasCercano: string
  localDominante: string
  grado: 'alto' | 'medio' | 'bajo'
  pedidosMal: number
  importeMal: number
}

function SolapeAnalysis({ records, locStats }: { records: DeliveryRecord[]; locStats: LocationStats[] }) {
  const [filtro, setFiltro] = useState<'todos' | 'alto' | 'medio'>('todos')
  const [orden, setOrden] = useState<'mal' | 'pedidos' | 'importe'>('mal')

  const solapes: SolapeItem[] = useMemo(() => {
    // Agrupar por barrio
    const byBarrio = new Map<string, DeliveryRecord[]>()
    for (const r of records) {
      const b = r.barrio || 'Desconocido'
      if (b === 'Desconocido') continue
      if (!byBarrio.has(b)) byBarrio.set(b, [])
      byBarrio.get(b)!.push(r)
    }

    const resultado: SolapeItem[] = []
    for (const [barrio, entries] of byBarrio) {
      if (entries.length < 3) continue

      const porLocal: SolapeItem['porLocal'] = {}
      const centroide = BARRIO_CENTROIDES[barrio]

      for (const r of entries) {
        if (!porLocal[r.locationId]) {
          const locCoords = getLocalCoords(r.locationName)
          let distLinea = 0
          if (locCoords && centroide) {
            const dLat = ((centroide.lat - locCoords.lat) * Math.PI) / 180
            const dLng = ((centroide.lng - locCoords.lng) * Math.PI) / 180
            const a = Math.sin(dLat/2)**2 + Math.cos(locCoords.lat*Math.PI/180)*Math.cos(centroide.lat*Math.PI/180)*Math.sin(dLng/2)**2
            distLinea = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
          }
          porLocal[r.locationId] = { count: 0, amount: 0, distLinea, distRuta: distLinea * URBAN_FACTOR }
        }
        porLocal[r.locationId].count++
        porLocal[r.locationId].amount += r.amount
      }

      const localesConPedidos = Object.keys(porLocal).filter(id => porLocal[id].count > 0)
      if (localesConPedidos.length < 2) continue

      const total = entries.length
      const totalImporte = entries.reduce((s, e) => s + e.amount, 0)
      const localDominante = [...localesConPedidos].sort((a, b) => porLocal[b].count - porLocal[a].count)[0]
      const localMasCercano = centroide
        ? [...localesConPedidos].sort((a, b) => porLocal[a].distRuta - porLocal[b].distRuta)[0]
        : localDominante

      let pedidosMal = 0; let importeMal = 0
      for (const [locId, s] of Object.entries(porLocal)) {
        if (locId !== localMasCercano) { pedidosMal += s.count; importeMal += s.amount }
      }

      const pctNoD = (total - porLocal[localDominante].count) / total
      const grado: SolapeItem['grado'] = pctNoD > 0.30 ? 'alto' : pctNoD > 0.12 ? 'medio' : 'bajo'

      resultado.push({ barrio, total, totalImporte, porLocal, localMasCercano, localDominante, grado, pedidosMal, importeMal })
    }
    return resultado
  }, [records, locStats])

  const filtrados = solapes
    .filter(s => filtro === 'todos' || s.grado === filtro)
    .sort((a, b) => orden === 'mal' ? b.pedidosMal - a.pedidosMal : orden === 'pedidos' ? b.total - a.total : b.totalImporte - a.totalImporte)

  const totalMal = solapes.reduce((s, b) => s + b.pedidosMal, 0)
  const importeMalTotal = solapes.reduce((s, b) => s + b.importeMal, 0)
  const altos = solapes.filter(s => s.grado === 'alto').length

  if (solapes.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-400">
        <p className="text-3xl mb-2">✅</p>
        <p className="font-medium">Sin solapes detectados</p>
        <p className="text-sm mt-1">Ningún barrio tiene pedidos de más de un local.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Nota metodológica */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-xs text-blue-700">
        <strong>Metodología:</strong> Distancia de recorrido estimada = distancia línea recta × 1.40 (factor empírico para Madrid urbano).
        Los radios de las plataformas (3.5 km) son fijos. La acción correcta es <strong>activar el local más cercano en la plataforma</strong> para cada barrio en disputa.
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Barrios solapados', value: solapes.length.toString(), color: 'text-amber-600' },
          { label: 'Solape alto (>30%)', value: altos.toString(), color: 'text-red-600' },
          { label: 'Pedidos a revisar', value: totalMal.toString(), color: 'text-gray-800' },
          { label: 'Ventas afectadas', value: `€${importeMalTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 })}`, color: 'text-teal-600' },
        ].map(k => (
          <Card key={k.label} className="p-4 text-center">
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.label}</p>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">Filtrar:</span>
        {(['todos', 'alto', 'medio'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`text-xs px-3 py-1 rounded-full font-medium border transition-all ${
              filtro === f ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {f === 'todos' ? 'Todos' : f === 'alto' ? '🔴 Alto' : '🟡 Medio'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Ordenar:</span>
          <select value={orden} onChange={e => setOrden(e.target.value as typeof orden)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
            <option value="mal">Por pedidos a revisar</option>
            <option value="pedidos">Por volumen</option>
            <option value="importe">Por importe</option>
          </select>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {filtrados.map(b => {
          const entries = Object.entries(b.porLocal).sort(([,a],[,b]) => b.count - a.count)
          const esBien = b.localMasCercano === b.localDominante
          const cercanoNombre = locStats.find(s => s.locationId === b.localMasCercano)?.locationName || b.localMasCercano
          const dominanteNombre = locStats.find(s => s.locationId === b.localDominante)?.locationName || b.localDominante
          const distCercano = b.porLocal[b.localMasCercano]?.distRuta?.toFixed(1)
          const distDominante = b.porLocal[b.localDominante]?.distRuta?.toFixed(1)

          return (
            <Card key={b.barrio} className={`p-4 space-y-3 ${
              b.grado === 'alto' ? 'border-red-200' : b.grado === 'medio' ? 'border-amber-200' : ''
            }`}>
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <p className="font-bold text-gray-900">{b.barrio}</p>
                  <p className="text-xs text-gray-400">{b.total} pedidos · €{b.totalImporte.toFixed(0)}</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {b.grado === 'alto' && <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-full">🔴 Solape alto</span>}
                  {b.grado === 'medio' && <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">🟡 Solape medio</span>}
                  {esBien
                    ? <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">✅ Bien asignado</span>
                    : <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-full">⚠️ {b.pedidosMal} pedidos a revisar</span>
                  }
                </div>
              </div>

              {/* Barra */}
              <div className="flex rounded-full overflow-hidden h-3">
                {entries.map(([locId, v]) => {
                  const idx = locStats.findIndex(s => s.locationId === locId)
                  return (
                    <div key={locId}
                      style={{ width: `${(v.count/b.total)*100}%`, background: LOC_COLORS[idx % LOC_COLORS.length] }}
                      title={`${locStats.find(s => s.locationId === locId)?.locationName}: ${v.count}`}
                    />
                  )
                })}
              </div>

              {/* Detalle por local */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {entries.map(([locId, v]) => {
                  const idx = locStats.findIndex(s => s.locationId === locId)
                  const locName = locStats.find(s => s.locationId === locId)?.locationName || locId
                  const esCercano = locId === b.localMasCercano
                  const esDom = locId === b.localDominante
                  return (
                    <div key={locId} className={`rounded-lg p-3 ${LOC_LIGHT[idx % LOC_LIGHT.length]} ${esCercano ? 'ring-1 ring-teal-400' : ''}`}>
                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: LOC_COLORS[idx % LOC_COLORS.length] }} />
                        <span className={`text-xs font-semibold ${LOC_TEXT[idx % LOC_TEXT.length]} truncate`}>{locName}</span>
                        {esCercano && <span className="text-[9px] bg-teal-600 text-white px-1 py-0.5 rounded shrink-0">MÁS CERCA</span>}
                        {esDom && <span className="text-[9px] bg-gray-700 text-white px-1 py-0.5 rounded shrink-0">DOMINANTE</span>}
                      </div>
                      <div className="space-y-0.5 text-[11px]">
                        <div className="flex justify-between"><span className="text-gray-500">Pedidos</span><span className="font-bold">{v.count} ({((v.count/b.total)*100).toFixed(0)}%)</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Importe</span><span>€{v.amount.toFixed(0)}</span></div>
                        {v.distLinea > 0 && <>
                          <div className="flex justify-between"><span className="text-gray-500">Línea recta</span><span>{v.distLinea.toFixed(1)} km</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Recorrido est.</span><span className={`font-bold ${esCercano ? 'text-teal-700' : ''}`}>{v.distRuta.toFixed(1)} km</span></div>
                        </>}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Recomendación */}
              <div className={`rounded-lg px-3 py-2.5 text-xs ${esBien ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                {esBien
                  ? `✅ ${dominanteNombre} es el local más cercano (${distCercano} km de recorrido estimado) y el dominante. Asignación correcta.`
                  : `⚠️ ${b.pedidosMal} pedidos (€${b.importeMal.toFixed(0)}) están siendo servidos por ${dominanteNombre} (${distDominante} km) cuando ${cercanoNombre} está más cerca (${distCercano} km). Acción recomendada: activar ${cercanoNombre} en Glovo/Uber para este barrio o hablar con las plataformas para ajustar la zona de cobertura.`
                }
              </div>
            </Card>
          )
        })}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
        <p className="font-semibold text-gray-700 mb-1">Cómo actuar sobre los solapes</p>
        <p>Los radios de 3.5 km los fijan las plataformas y no se pueden cambiar libremente. La vía correcta es entrar en el panel de partner de <strong>Glovo</strong> o <strong>Uber Eats</strong> y ajustar qué barrios cubre cada local en la configuración de zona de entrega. Para barrios frontera, contacta con tu gestor de cuenta en cada plataforma.</p>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <Card className="p-12 text-center text-gray-400">
      <p className="text-4xl mb-3">🗺️</p>
      <p className="font-semibold text-gray-600">Sin datos de entregas</p>
      <p className="text-sm mt-1">Pulsa <strong>Sincronizar</strong> para cargar los pedidos desde Last.app.</p>
    </Card>
  )
}
