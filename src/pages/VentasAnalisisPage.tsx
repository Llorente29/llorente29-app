import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Alert } from '../components/ui'
import {
  fetchTSpoonSales, analyzeHistory, saveAnalysis, loadAnalysis, exportRecordsCSV,
  type SaleRecord, type SalesAnalysis, type StaffRecommendation
} from '../services/salesAnalysis'

const DAY_SHORT = ['L','M','X','J','V','S','D']
const DAY_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-blue-100 text-blue-800',
  'bg-blue-100 text-blue-800',
  'bg-blue-100 text-blue-800',
  'bg-teal-100 text-teal-800',
  'bg-violet-100 text-violet-800',
  'bg-violet-100 text-violet-800',
]

function DemandBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const color = pct >= 80 ? 'bg-red-400' : pct >= 60 ? 'bg-amber-400' : pct >= 40 ? 'bg-teal-400' : 'bg-gray-300'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{Math.round(pct)}%</span>
    </div>
  )
}

function ConfidenceBadge({ c }: { c: StaffRecommendation['confidence'] }) {
  const cfg = { alta: 'bg-emerald-100 text-emerald-700', media: 'bg-amber-100 text-amber-700', baja: 'bg-gray-100 text-gray-500' }
  const icon = { alta: '●●●', media: '●●○', baja: '●○○' }
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cfg[c]}`}>{icon[c]} {c}</span>
}

export default function VentasAnalisisPage() {
  const { locations } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [weeks, setWeeks] = useState(8)
  const [analysis, setAnalysis] = useState<SalesAnalysis | null>(null)
  const [records, setRecords] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [view, setView] = useState<'dashboard' | 'datos' | 'manual'>('dashboard')
  const [manualEntry, setManualEntry] = useState({ date: '', amount: '' })

  // tSpoon connection
  const [tspoonState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('andy-tspoon-v4') || '{}') } catch { return {} }
  })
  const isConnected = !!tspoonState?.token && !!tspoonState?.selectedCenter

  // Cargar análisis guardado al cambiar local
  useEffect(() => {
    if (!locId) return
    const saved = loadAnalysis(locId)
    if (saved) {
      setAnalysis(saved.analysis)
      setRecords(saved.records)
    } else {
      setAnalysis(null)
      setRecords([])
    }
  }, [locId])

  async function syncTSpoon() {
    if (!isConnected) return
    setLoading(true)
    setProgress('')
    const recs = await fetchTSpoonSales(
      tspoonState.token,
      tspoonState.selectedCenter,
      weeks,
      msg => setProgress(msg)
    )
    if (recs.length > 0) {
      const combined = mergeRecords([...records.filter(r => r.source !== 'tspoon'), ...recs])
      const result = analyzeHistory(combined)
      setRecords(combined)
      setAnalysis(result)
      saveAnalysis(locId, result, combined)
      setProgress(`✅ Análisis actualizado con ${recs.length} días de datos`)
    } else {
      setProgress('⚠️ No se encontraron datos de ventas en tSpoonLab para ese período')
    }
    setLoading(false)
  }

  function addManualRecord() {
    if (!manualEntry.date || !manualEntry.amount) return
    const d = new Date(manualEntry.date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
    const rec: SaleRecord = {
      date: manualEntry.date,
      dayOfWeek: dow,
      totalAmount: parseFloat(manualEntry.amount),
      source: 'manual'
    }
    const combined = mergeRecords([...records, rec])
    const result = analyzeHistory(combined)
    setRecords(combined)
    setAnalysis(result)
    saveAnalysis(locId, result, combined)
    setManualEntry({ date: '', amount: '' })
  }

  function mergeRecords(recs: SaleRecord[]): SaleRecord[] {
    const byDate: Record<string, SaleRecord> = {}
    recs.forEach(r => { byDate[r.date] = r })  // último gana
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
  }

  function clearData() {
    if (!confirm('¿Eliminar todos los datos de ventas de este local?')) return
    setRecords([]); setAnalysis(null)
    saveAnalysis(locId, analyzeHistory([]), [])
  }

  function downloadCSV() {
    const csv = exportRecordsCSV(records)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `ventas-${locId}.csv`; a.click()
  }

  const maxAvgSales = analysis ? Math.max(...analysis.patterns.map(p => p.avgSales)) : 0

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Análisis de Ventas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Predicción automática de personal necesario según histórico de ventas
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {records.length > 0 && <Button size="sm" variant="outline" onClick={downloadCSV}>⬇ CSV</Button>}
          {records.length > 0 && <Button size="sm" variant="outline" onClick={clearData}>🗑 Limpiar</Button>}
        </div>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap gap-3 items-end p-4 bg-gray-50 rounded-2xl border">
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Local</label>
          <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Semanas a analizar</label>
          <Select value={weeks} onChange={e => setWeeks(parseInt(e.target.value))} className="w-32">
            {[4, 8, 12, 16, 24].map(w => <option key={w} value={w}>{w} semanas</option>)}
          </Select>
        </div>
        <div className="flex gap-2">
          {isConnected ? (
            <Button onClick={syncTSpoon} disabled={loading}>
              {loading ? '🔄 Sincronizando...' : '🔄 Sync tSpoonLab'}
            </Button>
          ) : (
            <Alert type="warning">Conecta tSpoonLab primero en Fichas Técnicas</Alert>
          )}
          <Button variant="outline" onClick={() => setView('manual')}>+ Datos manuales</Button>
        </div>
      </div>

      {/* Progreso */}
      {progress && (
        <Alert type={progress.startsWith('✅') ? 'success' : progress.startsWith('❌') ? 'error' : 'info'}>
          {progress}
        </Alert>
      )}

      {/* Sin datos */}
      {!analysis || analysis.patterns.length === 0 ? (
        <Card className="p-10 text-center space-y-4">
          <p className="text-4xl">📊</p>
          <div>
            <p className="font-semibold text-gray-700">Sin datos de ventas aún</p>
            <p className="text-sm text-gray-400 mt-1">
              Sincroniza con tSpoonLab o introduce datos manualmente para ver las predicciones de personal
            </p>
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            {isConnected && (
              <Button onClick={syncTSpoon} disabled={loading}>
                🔄 Sincronizar {weeks} semanas de tSpoonLab
              </Button>
            )}
            <Button variant="outline" onClick={() => setView('manual')}>+ Introducir manualmente</Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Semanas analizadas', val: analysis.totalWeeksAnalyzed, icon: '📅' },
              { label: 'Días con datos', val: records.length, icon: '📊' },
              { label: 'Mejor día', val: analysis.patterns.reduce((best, p) => p.avgSales > best.avgSales ? p : best, analysis.patterns[0]).dayName, icon: '🔥' },
              { label: 'Fuente', val: analysis.source, icon: '🔗' },
            ].map(s => (
              <Card key={s.label} className="p-3">
                <p className="text-xl mb-0.5">{s.icon}</p>
                <p className="font-bold text-sm">{s.val}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white border rounded-xl p-1 w-fit">
            {(['dashboard', 'datos'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-xs px-4 py-2 rounded-lg font-medium ${view === v ? 'bg-teal-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                {v === 'dashboard' ? '📊 Predicciones' : '📋 Datos históricos'}
              </button>
            ))}
          </div>

          {/* ── DASHBOARD DE PREDICCIONES ─────────────────────────────────── */}
          {view === 'dashboard' && (
            <div className="space-y-4">
              {/* Resumen visual: barras de demanda */}
              <Card className="p-5">
                <p className="font-semibold text-gray-800 mb-4">Demanda relativa por día de la semana</p>
                <div className="space-y-3">
                  {analysis.patterns.map((p, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg w-8 text-center ${DAY_COLORS[i]}`}>{DAY_SHORT[i]}</span>
                      <div className="flex-1">
                        <DemandBar value={p.avgSales} max={maxAvgSales} />
                      </div>
                      <span className="text-xs text-gray-500 w-20 text-right font-medium">
                        {p.avgSales > 0 ? `${p.avgSales.toLocaleString('es-ES')}€` : '—'}
                      </span>
                      <span className="text-xs text-gray-400 w-16 text-right">{p.weeks} sem.</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Tabla de recomendaciones */}
              <Card>
                <div className="p-4 border-b">
                  <p className="font-semibold text-gray-800">Trabajadores recomendados por día</p>
                  <p className="text-xs text-gray-500 mt-0.5">Basado en histórico · Respeta mínimos del convenio</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-xs">
                        <th className="p-3 text-left font-semibold text-gray-500">Día</th>
                        <th className="p-3 text-center font-semibold text-amber-600">☀️ Mediodía</th>
                        <th className="p-3 text-center font-semibold text-violet-600">🌙 Noche</th>
                        <th className="p-3 text-center font-semibold text-gray-500">Total</th>
                        <th className="p-3 text-center font-semibold text-gray-500">Venta media</th>
                        <th className="p-3 text-center font-semibold text-gray-500">Confianza</th>
                        <th className="p-3 text-left font-semibold text-gray-500">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.recommendations.map((rec, i) => (
                        <tr key={i} className={`border-b last:border-0 ${i >= 4 ? 'bg-teal-50/30' : ''}`}>
                          <td className="p-3">
                            <span className={`font-bold text-xs px-2 py-1 rounded-lg ${DAY_COLORS[i]}`}>{rec.dayName}</span>
                          </td>
                          <td className="p-3 text-center">
                            <span className="text-lg font-bold text-amber-700">{rec.recommendedManana}</span>
                          </td>
                          <td className="p-3 text-center">
                            <span className="text-lg font-bold text-violet-700">{rec.recommendedNoche}</span>
                          </td>
                          <td className="p-3 text-center">
                            <span className={`font-bold text-base ${rec.totalRecommended >= 5 ? 'text-red-600' : rec.totalRecommended >= 4 ? 'text-amber-600' : 'text-gray-700'}`}>
                              {rec.totalRecommended}
                            </span>
                          </td>
                          <td className="p-3 text-center text-xs text-gray-600">
                            {rec.avgSales > 0 ? `${rec.avgSales.toLocaleString('es-ES')}€` : '—'}
                          </td>
                          <td className="p-3 text-center"><ConfidenceBadge c={rec.confidence} /></td>
                          <td className="p-3 text-xs text-gray-400">{rec.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Alerta si datos insuficientes */}
              {analysis.totalWeeksAnalyzed < 4 && (
                <Alert type="warning">
                  Con solo {analysis.totalWeeksAnalyzed} semana(s) de datos las predicciones son orientativas.
                  Recomendado: mínimo 8 semanas para confianza alta.
                </Alert>
              )}

              {/* Comparativa con mínimos del convenio */}
              <Card className="p-4">
                <p className="font-semibold text-sm text-gray-700 mb-3">📋 Comparativa con mínimos del convenio</p>
                <div className="grid grid-cols-7 gap-1.5">
                  {analysis.recommendations.map((rec, i) => {
                    const minNoche = i >= 4 ? 3 : 2
                    const extraNoche = rec.recommendedNoche - minNoche
                    return (
                      <div key={i} className={`p-2 rounded-xl border text-center text-xs ${i >= 4 ? 'bg-teal-50 border-teal-200' : 'bg-gray-50 border-gray-200'}`}>
                        <p className={`font-bold text-xs mb-1 ${DAY_COLORS[i].split(' ')[1]}`}>{DAY_SHORT[i]}</p>
                        <p className="text-[10px] text-gray-400 mb-1">Noche</p>
                        <p className={`font-bold text-base ${extraNoche > 0 ? 'text-amber-600' : 'text-gray-600'}`}>{rec.recommendedNoche}</p>
                        {extraNoche > 0 && <p className="text-[9px] text-amber-500">+{extraNoche} extra</p>}
                        {extraNoche === 0 && <p className="text-[9px] text-gray-300">mínimo</p>}
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">Los valores en naranja indican que la demanda histórica sugiere más personal del mínimo obligatorio</p>
              </Card>

              {/* Info Last.app */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                <p className="font-semibold text-blue-800 text-sm mb-1">🔌 ¿Necesitas más precisión horaria?</p>
                <p className="text-xs text-blue-700">
                  tSpoonLab ofrece datos por día (albaranes). Para análisis por franja horaria (mediodía vs noche por separado),
                  conecta <strong>Last.app</strong> (tu TPV) que tiene datos por hora desde las comandas.
                  Cuando tengas las credenciales de la API de Last.app, podemos añadir esa fuente en minutos.
                </p>
              </div>
            </div>
          )}

          {/* ── DATOS HISTÓRICOS ─────────────────────────────────────────── */}
          {view === 'datos' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">{records.length} registros · {analysis.dateRange.from} → {analysis.dateRange.to}</p>
                <Button size="sm" variant="outline" onClick={() => setView('manual')}>+ Añadir registro</Button>
              </div>
              <Card>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white border-b">
                      <tr>
                        <th className="p-2 text-left font-semibold text-gray-500">Fecha</th>
                        <th className="p-2 text-left font-semibold text-gray-500">Día</th>
                        <th className="p-2 text-right font-semibold text-gray-500">Ventas</th>
                        <th className="p-2 text-center font-semibold text-gray-500">Fuente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...records].reverse().map((r, i) => {
                        const DAY = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
                        return (
                          <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="p-2 font-medium">{r.date}</td>
                            <td className="p-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${DAY_COLORS[r.dayOfWeek]}`}>
                                {DAY[r.dayOfWeek]}
                              </span>
                            </td>
                            <td className="p-2 text-right font-semibold">{r.totalAmount.toLocaleString('es-ES', { style:'currency', currency:'EUR' })}</td>
                            <td className="p-2 text-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.source === 'tspoon' ? 'bg-teal-100 text-teal-700' : r.source === 'lastapp' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                {r.source}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── ENTRADA MANUAL ────────────────────────────────────────────── */}
          {view === 'manual' && (
            <Card className="p-5 space-y-4 max-w-md">
              <p className="font-semibold text-gray-800">Añadir datos de ventas manualmente</p>
              <p className="text-xs text-gray-500">Útil si no tienes tSpoonLab o quieres completar datos que faltan</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Fecha</label>
                  <input type="date" value={manualEntry.date} onChange={e => setManualEntry(p => ({ ...p, date: e.target.value }))}
                    className="mt-1 w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Ventas totales del día (€)</label>
                  <input type="number" min={0} step={10} placeholder="ej: 1250"
                    value={manualEntry.amount} onChange={e => setManualEntry(p => ({ ...p, amount: e.target.value }))}
                    className="mt-1 w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setView('dashboard')} className="flex-1">Cancelar</Button>
                  <Button onClick={addManualRecord} disabled={!manualEntry.date || !manualEntry.amount} className="flex-1">Añadir</Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
