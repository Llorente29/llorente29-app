// src/pages/ZonasPedidoPage.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Card } from '../components/ui'
import type { DeliveryRecord, DeliveryZoneConfig } from '../types'
import {
  fetchWebhookRecords, enrichRecords, geocodeBarrios,
  saveRecords, loadRecords, saveZoneConfigs, loadZoneConfigs,
  computeBarrioStats, computeLocationStats, simulateRadius,
  coordsForLocation, haversineKm,
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
  const [hover, setHover] = useState<string | null>(null)

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
  }, [])

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
          {records.length === 0 ? <EmptyState /> : sharedBarrios.length === 0 ? (
            <Card className="p-8 text-center text-gray-400">
              <p className="text-3xl mb-2">✅</p>
              <p className="font-medium">Sin solapes detectados</p>
              <p className="text-sm mt-1">Ningún barrio tiene pedidos de más de un local.</p>
            </Card>
          ) : (
            <>
              {/* Resumen de impacto */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{sharedBarrios.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Barrios con solape</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-gray-800">
                    {sharedBarrios.reduce((s, b) => s + b.total, 0)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">Entregas en zona solapada</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-teal-600">
                    €{sharedBarrios.reduce((s, b) => s + b.totalAmount, 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">Ventas en disputa</p>
                </Card>
              </div>

              {/* Lista de barrios solapados con análisis */}
              <div className="space-y-3">
                {sharedBarrios.map(b => {
                  const entries = Object.entries(b.byLocation).sort(([,a],[,b]) => b.count - a.count)
                  const dominant = entries[0]
                  const minor = entries.slice(1)
                  const dominantIdx = locStats.findIndex(s => s.locationId === dominant[0])
                  const hasMalAsig = b.malAsignadosPct != null

                  return (
                    <Card key={b.barrio} className="p-4">
                      <div className="flex items-start justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-bold text-gray-900">{b.barrio}</p>
                          <p className="text-xs text-gray-400">{b.total} entregas · €{b.totalAmount.toFixed(0)}</p>
                        </div>
                        {hasMalAsig && b.malAsignadosPct! > 0.15 && (
                          <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
                            ⚠️ {(b.malAsignadosPct! * 100).toFixed(0)}% mal asignado
                          </span>
                        )}
                        {hasMalAsig && b.malAsignadosPct! <= 0.15 && (
                          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                            ✅ Bien asignado
                          </span>
                        )}
                      </div>

                      {/* Barra de distribución */}
                      <div className="mt-3 flex rounded-full overflow-hidden h-4">
                        {entries.map(([locId, v]) => {
                          const idx = locStats.findIndex(s => s.locationId === locId)
                          const pct = (v.count / b.total) * 100
                          return (
                            <div
                              key={locId}
                              style={{ width: `${pct}%`, background: LOC_COLORS[idx % LOC_COLORS.length] }}
                              title={`${locStats.find(s => s.locationId === locId)?.locationName}: ${v.count} (${pct.toFixed(0)}%)`}
                            />
                          )
                        })}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-3">
                        {entries.map(([locId, v]) => {
                          const idx = locStats.findIndex(s => s.locationId === locId)
                          const stat = locStats.find(s => s.locationId === locId)
                          return (
                            <div key={locId} className="flex items-center gap-1.5 text-xs">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: LOC_COLORS[idx % LOC_COLORS.length] }} />
                              <span className="text-gray-600">{stat?.locationName.split(' ').slice(-2).join(' ')}</span>
                              <span className="font-bold text-gray-900">{v.count}</span>
                              <span className="text-gray-400">({((v.count / b.total) * 100).toFixed(0)}%)</span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Recomendación */}
                      <div className="mt-3 p-2.5 bg-gray-50 rounded-lg text-xs text-gray-600">
                        <span className="font-semibold">Recomendación: </span>
                        {!hasMalAsig
                          ? `Asignar ${b.barrio} a ${locStats.find(s => s.locationId === dominant[0])?.locationName} (local dominante). Ajustar radio de ${minor.map(([id]) => locStats.find(s => s.locationId === id)?.locationName).join(', ')} para no cubrir este barrio.`
                          : b.malAsignadosPct! > 0.5
                            ? `Más del 50% de pedidos están más cerca de otro local. Considera reasignar este barrio.`
                            : `Solape moderado. El local dominante es ${locStats.find(s => s.locationId === dominant[0])?.locationName}.`
                        }
                      </div>
                    </Card>
                  )
                })}
              </div>

              {/* Simulador aquí también */}
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-800">Simulador de radios</p>
                  <span className="text-xs text-gray-400">Ajusta para reducir solapes</span>
                </div>
                {zoneConfigs.map(z => {
                  const idx = locationIndex(z.locationId)
                  const stat = locStats.find(s => s.locationId === z.locationId)
                  const sim = simResults.find(s => s.locationId === z.locationId)
                  return (
                    <div key={z.locationId} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full" style={{ background: LOC_COLORS[idx] }} />
                          <span className="text-sm font-medium">{stat?.locationName || z.locationId}</span>
                        </div>
                        <span className="text-sm font-bold">{z.radiusKm.toFixed(1)} km</span>
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
