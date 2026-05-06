import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Alert } from '../components/ui'
import {
  parseExcelFile, analyzeHistory, saveAnalysis, loadSavedAnalysis,
  type SaleRecord, type SalesAnalysis, type StaffRecommendation, type DayPattern
} from '../services/salesAnalysis'

const DAY_SHORT  = ['L','M','X','J','V','S','D']
const DAY_COLORS = ['bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-teal-100 text-teal-700','bg-violet-100 text-violet-700','bg-violet-100 text-violet-700']

function Bar({ pct, color = 'bg-teal-500' }: { pct: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 w-7 text-right">{Math.round(pct * 100)}%</span>
    </div>
  )
}

function HeatmapHour({ patterns }: { patterns: SalesAnalysis['hourlyPatterns'] }) {
  if (!patterns.length) return null
  const max = Math.max(...patterns.map(p => p.avgAmount), 1)
  const HOURS = Array.from({ length: 14 }, (_, i) => i + 10)
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Venta media por franja horaria</p>
      <div className="flex gap-1 items-end" style={{height:'80px'}}>
        {HOURS.map(h => {
          const p = patterns.find(x => x.hour === h)
          const pct = p ? p.avgAmount / max : 0
          const isMediadia = h < 17
          return (
            <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={p ? `${h}:00 · ${p.avgAmount}€ media · ${p.ticketCount} pedidos` : `${h}:00 sin datos`}>
              <div className="w-full flex flex-col justify-end" style={{height:'64px'}}>
                <div className={`w-full rounded-t transition-all ${isMediadia ? 'bg-amber-400' : 'bg-violet-500'} ${pct===0?'opacity-10':''}`}
                  style={{height:`${Math.max(pct*100,pct>0?6:0)}%`}} />
              </div>
              <span className="text-[7px] text-gray-400">{h}</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 mt-2 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-sm inline-block"/>&lt;17h mediodía</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-500 rounded-sm inline-block"/>≥17h noche</span>
      </div>
    </div>
  )
}

function RecommendationTable({ recs, patterns }: { recs: StaffRecommendation[]; patterns: DayPattern[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[750px]">
        <thead>
          <tr className="border-b bg-gray-50 text-xs">
            <th className="p-3 text-left font-semibold text-gray-500">Día</th>
            <th className="p-3 text-center font-semibold text-amber-600">☀️ Mediodía</th>
            <th className="p-3 text-center font-semibold text-violet-600">🌙 Noche</th>
            <th className="p-3 text-left font-semibold text-amber-500 w-36">Demanda mediodía</th>
            <th className="p-3 text-left font-semibold text-violet-500 w-36">Demanda noche</th>
            <th className="p-3 text-center font-semibold text-gray-400">Confianza</th>
            <th className="p-3 text-left font-semibold text-gray-400">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {recs.map((rec, i) => {
            const dp = patterns[i]
            const minNoche  = i >= 4 ? 3 : 2
            const extraNoche = rec.recommendedNoche - minNoche
            return (
              <tr key={i} className={`border-b last:border-0 ${i >= 4 ? 'bg-teal-50/30' : ''}`}>
                <td className="p-3">
                  <span className={`font-bold text-xs px-2 py-1 rounded-lg ${DAY_COLORS[i]}`}>{rec.dayName}</span>
                </td>
                <td className="p-3 text-center">
                  <span className="text-xl font-bold text-amber-700">{rec.recommendedManana}</span>
                  {dp.avgMediadia > 0 && <p className="text-[10px] text-gray-400">{dp.avgMediadia}€ · {dp.ticketsMediadia} ped.</p>}
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-xl font-bold text-violet-700">{rec.recommendedNoche}</span>
                    {extraNoche > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">+{extraNoche}</span>}
                  </div>
                  {dp.avgNoche > 0 && <p className="text-[10px] text-gray-400">{dp.avgNoche}€ · {dp.ticketsNoche} ped.</p>}
                </td>
                <td className="p-3"><Bar pct={dp.demandMediadia} color="bg-amber-400" /></td>
                <td className="p-3"><Bar pct={dp.demandNoche} color="bg-violet-500" /></td>
                <td className="p-3 text-center">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${rec.confidence==='alta'?'bg-emerald-100 text-emerald-700':rec.confidence==='media'?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-500'}`}>
                    {rec.confidence==='alta'?'●●●':rec.confidence==='media'?'●●○':'●○○'} {rec.confidence}
                  </span>
                </td>
                <td className="p-3 text-xs text-gray-400">{rec.reason}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function VentasAnalisisPage() {
  const { locations } = useApp()
  const [locId, setLocId]       = useState(locations[0]?.id || '')
  const [analysis, setAnalysis] = useState<SalesAnalysis | null>(null)
  const [records, setRecords]   = useState<SaleRecord[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState<'recomendaciones'|'horario'|'datos'>('recomendaciones')
  const [filesLoaded, setFilesLoaded] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const saved = loadSavedAnalysis(locId)
    if (saved?.records?.length) { setRecords(saved.records); setAnalysis(saved.analysis) }
    else { setRecords([]); setAnalysis(null) }
    setFilesLoaded(0)
  }, [locId])

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setLoading(true); setError(''); setFilesLoaded(0)
    let allRecords = [...records]
    let loaded = 0
    for (const file of Array.from(files)) {
      try {
        const recs = await parseExcelFile(await file.arrayBuffer())
        const newDates = new Set(recs.map(r => r.date))
        allRecords = [...allRecords.filter(r => !newDates.has(r.date)), ...recs]
        loaded++
      } catch (e: unknown) {
        setError(`Error en ${file.name}: ${e instanceof Error ? e.message : 'formato no reconocido'}`)
      }
    }
    if (loaded > 0) {
      allRecords.sort((a, b) => a.date.localeCompare(b.date))
      const result = analyzeHistory(allRecords)
      setRecords(allRecords); setAnalysis(result); setFilesLoaded(loaded)
      saveAnalysis(locId, { records: allRecords, analysis: result })
    }
    setLoading(false)
  }

  function clearData() {
    if (!confirm('¿Eliminar todos los datos de ventas?')) return
    setRecords([]); setAnalysis(null); setFilesLoaded(0)
    saveAnalysis(locId, { records: [], analysis: analyzeHistory([]) })
  }

  const totalAmount  = records.reduce((s, r) => s + r.amount, 0)
  const uniqueDates  = new Set(records.map(r => r.date)).size

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily:'Instrument Serif, serif' }}>Análisis de Ventas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sube los Excel de tSpoonLab → granularidad horaria → predicción de personal por día y turno</p>
        </div>
        {records.length > 0 && <Button size="sm" variant="outline" onClick={clearData}>🗑 Limpiar datos</Button>}
      </div>

      {/* Upload + local */}
      <div className="p-4 bg-gray-50 rounded-2xl border space-y-4">
        <div className="flex flex-wrap gap-4 items-start">
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Local</label>
            <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-64">
            <label className="text-xs font-medium text-gray-500 uppercase block mb-1">
              Excel de tSpoonLab — puedes subir varios a la vez y se acumulan
            </label>
            <div onClick={() => inputRef.current?.click()} onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();handleFiles(e.dataTransfer.files)}}
              className="border-2 border-dashed border-teal-300 rounded-xl px-6 py-4 text-center cursor-pointer hover:bg-teal-50 transition-colors">
              <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
                onChange={e=>handleFiles(e.target.files)} />
              {loading
                ? <p className="text-sm text-teal-600 animate-pulse">⚙️ Procesando...</p>
                : <>
                    <p className="text-sm font-medium text-teal-700">📂 Arrastra los Excel aquí o haz clic</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Columnas requeridas: DATE · TIME · AMOUNT · SOURCE · NUMTICKET<br/>
                      Un archivo por día es lo habitual en tSpoonLab — súbelos todos juntos
                    </p>
                  </>
              }
            </div>
          </div>
        </div>
        {filesLoaded > 0 && <Alert type="success">✅ {filesLoaded} archivo(s) · {uniqueDates} días · {totalAmount.toLocaleString('es-ES',{style:'currency',currency:'EUR'})} analizados</Alert>}
        {error && <Alert type="error">{error}</Alert>}
      </div>

      {!analysis || !records.length ? (
        <Card className="p-12 text-center space-y-3">
          <p className="text-5xl">📊</p>
          <p className="font-semibold text-gray-700">Sin datos de ventas</p>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            En tSpoonLab → Clientes → selecciona la marca → exporta el Excel de ventas de cada día.<br/>
            Súbelos todos a la vez aquí para obtener el análisis horario y la predicción de personal.
          </p>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {icon:'📅', val:analysis.totalWeeks,  label:'Semanas analizadas'},
              {icon:'🗓', val:uniqueDates,           label:'Días con datos'},
              {icon:'🏷', val:analysis.brands.slice(0,3).join(' · ')||'—', label:'Canales'},
              {icon:'💶', val:totalAmount.toLocaleString('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}), label:'Total analizado'},
            ].map(s=>(
              <Card key={s.label} className="p-3">
                <p className="text-lg mb-0.5">{s.icon}</p>
                <p className="font-bold text-sm truncate">{s.val}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Heatmap siempre visible */}
          <Card className="p-5"><HeatmapHour patterns={analysis.hourlyPatterns} /></Card>

          {/* Tabs */}
          <div className="flex gap-1 bg-white border rounded-xl p-1 w-fit">
            {([{v:'recomendaciones',l:'👥 Personal recomendado'},{v:'horario',l:'📈 Ventas por día'},{v:'datos',l:'📋 Registros'}] as const).map(({v,l})=>(
              <button key={v} onClick={()=>setTab(v)}
                className={`text-xs px-3 py-2 rounded-lg font-medium ${tab===v?'bg-teal-600 text-white':'text-gray-500 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>

          {tab==='recomendaciones' && (
            <div className="space-y-4">
              {analysis.totalWeeks < 3 && <Alert type="warning">Solo {analysis.totalWeeks} semana(s) de datos. Sube más archivos para mayor precisión.</Alert>}
              <Card>
                <div className="p-4 border-b">
                  <p className="font-semibold">Personal recomendado por día y turno</p>
                  <p className="text-xs text-gray-500 mt-0.5">Mínimos del convenio garantizados · +1 si la demanda histórica lo justifica</p>
                </div>
                <RecommendationTable recs={analysis.recommendations} patterns={analysis.dayPatterns} />
              </Card>
              <Card className="p-5">
                <p className="font-semibold text-sm mb-4">Demanda relativa mediodía vs noche</p>
                <div className="space-y-3">
                  {analysis.dayPatterns.map((p,i)=>(
                    <div key={i} className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg w-8 text-center shrink-0 ${DAY_COLORS[i]}`}>{DAY_SHORT[i]}</span>
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-amber-500 w-14 shrink-0">Mediodía</span>
                          <Bar pct={p.demandMediadia} color="bg-amber-400" />
                          <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">{p.avgMediadia>0?`${p.avgMediadia}€`:'—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-violet-500 w-14 shrink-0">Noche</span>
                          <Bar pct={p.demandNoche} color="bg-violet-500" />
                          <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">{p.avgNoche>0?`${p.avgNoche}€`:'—'}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-300 w-8 text-right">{p.weeks}s</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {tab==='horario' && (
            <div className="space-y-4">
              <Card className="p-5">
                <p className="font-semibold mb-4 text-sm">Ventas medias por día</p>
                <div className="space-y-3">
                  {analysis.dayPatterns.map((p,i)=>{
                    const maxT = Math.max(...analysis.dayPatterns.map(x=>x.avgTotal),1)
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded-lg w-24 text-center ${DAY_COLORS[i]}`}>{p.dayName}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden flex">
                          <div className="bg-amber-400 h-5" style={{width:`${p.avgTotal>0?(p.avgMediadia/p.avgTotal)*(p.avgTotal/maxT)*100:0}%`}} />
                          <div className="bg-violet-500 h-5" style={{width:`${p.avgTotal>0?(p.avgNoche/p.avgTotal)*(p.avgTotal/maxT)*100:0}%`}} />
                        </div>
                        <span className="text-sm font-bold text-gray-700 w-20 text-right">{p.avgTotal>0?`${p.avgTotal.toLocaleString('es-ES')}€`:'—'}</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
              <Card className="p-5">
                <HeatmapHour patterns={analysis.hourlyPatterns} />
                {analysis.hourlyPatterns.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Horas de mayor actividad</p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[...analysis.hourlyPatterns].sort((a,b)=>b.avgAmount-a.avgAmount).slice(0,6).map(p=>(
                        <div key={p.hour} className={`p-2 rounded-xl border text-center text-xs ${p.hour<17?'bg-amber-50 border-amber-200':'bg-violet-50 border-violet-200'}`}>
                          <p className="font-bold">{p.hour}:00</p>
                          <p className="text-gray-600">{p.avgAmount}€</p>
                          <p className="text-gray-400">{p.ticketCount} ped.</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {tab==='datos' && (
            <Card>
              <div className="p-3 border-b flex justify-between items-center">
                <p className="text-sm font-medium">{records.length} tickets · {uniqueDates} días</p>
                <p className="text-xs text-gray-400">{analysis.dateRange.from} → {analysis.dateRange.to}</p>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white border-b text-gray-500">
                    <tr>
                      {['Fecha','Hora','Turno','Canal','Importe','Ticket'].map(h=>(
                        <th key={h} className="p-2 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...records].reverse().map((r,i)=>(
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-2 font-medium">{r.date}</td>
                        <td className="p-2">{r.time}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.turno==='mediodia'?'bg-amber-100 text-amber-700':'bg-violet-100 text-violet-700'}`}>
                            {r.turno==='mediodia'?'☀️ Mediodía':'🌙 Noche'}
                          </span>
                        </td>
                        <td className="p-2 text-gray-500">{r.source}</td>
                        <td className="p-2 font-semibold">{r.amount.toLocaleString('es-ES',{style:'currency',currency:'EUR'})}</td>
                        <td className="p-2 text-gray-300 truncate max-w-20">{r.ticket}</td>
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
  )
}
