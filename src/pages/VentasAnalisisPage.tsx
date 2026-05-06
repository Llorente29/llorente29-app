import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Alert } from '../components/ui'
import {
  syncAllBrands, parseExcelFile, analyzeHistory, saveAnalysis, loadSavedAnalysis,
  type SaleRecord, type SalesAnalysis, type BrandSyncResult
} from '../services/salesAnalysis'

const DAY_SHORT  = ['L','M','X','J','V','S','D']
const DAY_COLORS = ['bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-teal-100 text-teal-700','bg-violet-100 text-violet-700','bg-violet-100 text-violet-700']

function Bar({ pct, color='bg-teal-500' }: { pct:number; color?:string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{width:`${Math.round(pct*100)}%`}}/>
      </div>
      <span className="text-[10px] text-gray-400 w-7 text-right">{Math.round(pct*100)}%</span>
    </div>
  )
}

function HeatmapHour({ patterns }: { patterns: SalesAnalysis['hourlyPatterns'] }) {
  if (!patterns.length) return null
  const max = Math.max(...patterns.map(p => p.avgAmount), 1)
  const HOURS = Array.from({length:14},(_,i)=>i+10)
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Venta media por franja horaria</p>
      <div className="flex gap-1 items-end" style={{height:'80px'}}>
        {HOURS.map(h => {
          const p = patterns.find(x => x.hour === h)
          const pct = p ? p.avgAmount/max : 0
          return (
            <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={p?`${h}:00 · ${p.avgAmount}€ · ${p.ticketCount} pedidos`:''}>
              <div className="w-full flex flex-col justify-end" style={{height:'64px'}}>
                <div className={`w-full rounded-t ${h<17?'bg-amber-400':'bg-violet-500'} ${pct===0?'opacity-10':''}`} style={{height:`${Math.max(pct*100,pct>0?6:0)}%`}}/>
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

export default function VentasAnalisisPage() {
  const { locations } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [analysis, setAnalysis] = useState<SalesAnalysis | null>(null)
  const [records, setRecords] = useState<SaleRecord[]>([])
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [brandResults, setBrandResults] = useState<BrandSyncResult[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'recomendaciones'|'horario'|'marcas'|'datos'>('recomendaciones')
  const [daysBack, setDaysBack] = useState(30)
  const [filesUploaded, setFilesUploaded] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const tspoon = (() => { try { return JSON.parse(localStorage.getItem('andy-tspoon-v4')||'{}') } catch { return {} } })()
  const isConnected = !!tspoon?.token && !!tspoon?.selectedCenter

  useEffect(() => {
    const saved = loadSavedAnalysis(locId)
    if (saved?.records?.length) { setRecords(saved.records); setAnalysis(saved.analysis) }
    else { setRecords([]); setAnalysis(null) }
    setProgress([]); setBrandResults([]); setFilesUploaded(0)
  }, [locId])

  // ─── Sync automático desde API ────────────────────────────────────────────
  async function handleAutoSync() {
    if (!isConnected) return
    setSyncing(true); setProgress([]); setError('')
    const log: string[] = []
    const addLog = (msg: string) => { log.push(msg); setProgress([...log]) }

    try {
      const result = await syncAllBrands(tspoon.token, tspoon.selectedCenter, daysBack, addLog)
      setBrandResults(result.brands)

      if (result.records.length > 0) {
        // Mezclar con records existentes de otras fuentes (Excel manual)
        const manualRecords = records.filter(r => r.source !== 'tspoon-api')
        const newDates = new Set(result.records.map(r => r.date))
        const combined = [...manualRecords.filter(r => !newDates.has(r.date)), ...result.records]
          .sort((a,b) => a.date.localeCompare(b.date))

        const an = analyzeHistory(combined)
        setRecords(combined); setAnalysis(an)
        saveAnalysis(locId, { records: combined, analysis: an })
        addLog(`✅ Análisis completado: ${combined.length} tickets · ${result.totalDays} días · ${result.brands.filter(b=>b.status==='ok').length} marcas con datos`)
        setTab('recomendaciones')
      } else {
        addLog('⚠️ No se encontraron datos de ventas. Comprueba el rango de fechas.')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setError(msg); addLog(`❌ ${msg}`)
    }
    setSyncing(false)
  }

  // ─── Subida manual de Excel ───────────────────────────────────────────────
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setSyncing(true); setError(''); setFilesUploaded(0)
    let all = [...records]; let loaded = 0
    for (const file of Array.from(files)) {
      try {
        const recs = await parseExcelFile(await file.arrayBuffer())
        const newDates = new Set(recs.map(r => r.date))
        all = [...all.filter(r => !newDates.has(r.date)), ...recs]
        loaded++
        setProgress(p => [...p, `✓ ${file.name}: ${recs.length} tickets`])
      } catch (e: unknown) {
        setError(`${file.name}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    if (loaded > 0) {
      all.sort((a,b) => a.date.localeCompare(b.date))
      const an = analyzeHistory(all)
      setRecords(all); setAnalysis(an); setFilesUploaded(loaded)
      saveAnalysis(locId, { records: all, analysis: an })
      setTab('recomendaciones')
    }
    setSyncing(false)
  }

  function clearData() {
    if (!confirm('¿Eliminar todos los datos de ventas?')) return
    setRecords([]); setAnalysis(null); setProgress([]); setBrandResults([])
    saveAnalysis(locId, { records: [], analysis: analyzeHistory([]) })
  }

  const totalAmount = records.reduce((s,r)=>s+r.amount,0)
  const uniqueDates = new Set(records.map(r=>r.date)).size
  const uniqueBrands = [...new Set(records.map(r=>r.brand))]

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{fontFamily:'Instrument Serif, serif'}}>Análisis de Ventas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sincroniza todas las marcas automáticamente · Granularidad horaria · Predicción de personal</p>
        </div>
        {records.length > 0 && <Button size="sm" variant="outline" onClick={clearData}>🗑 Limpiar</Button>}
      </div>

      {/* Controles principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ── Bloque 1: Sync automático ──────────────────────────────── */}
        <div className={`p-5 rounded-2xl border-2 space-y-4 ${isConnected ? 'border-teal-300 bg-teal-50/50' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔄</span>
            <div>
              <p className="font-semibold text-gray-800">Sincronización automática</p>
              <p className="text-xs text-gray-500">Descarga todas las marcas y canales de una vez via API tSpoonLab</p>
            </div>
          </div>
          {!isConnected && (
            <Alert type="warning">Conecta tSpoonLab en Fichas Técnicas para usar esta opción</Alert>
          )}
          {isConnected && (
            <>
              <div className="flex items-center gap-3">
                <Select value={locId} onChange={e => setLocId(e.target.value)} className="flex-1">
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
                <Select value={daysBack} onChange={e => setDaysBack(parseInt(e.target.value))} className="w-36">
                  <option value={30}>Último mes</option>
                  <option value={60}>Últimos 2 meses</option>
                  <option value={90}>Últimos 3 meses</option>
                  <option value={180}>Últimos 6 meses</option>
                </Select>
              </div>
              <Button onClick={handleAutoSync} disabled={syncing} className="w-full">
                {syncing ? '⚙️ Sincronizando...' : `⚡ Sincronizar todas las marcas (${daysBack} días)`}
              </Button>
              {tspoon.centers?.length > 0 && (
                <p className="text-xs text-gray-500">Centro activo: <strong>{tspoon.selectedCenterName || tspoon.selectedCenter}</strong> · {tspoon.centers.length} centro(s)</p>
              )}
            </>
          )}
        </div>

        {/* ── Bloque 2: Upload manual ─────────────────────────────────── */}
        <div className="p-5 rounded-2xl border-2 border-gray-200 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📂</span>
            <div>
              <p className="font-semibold text-gray-800">Subida manual de Excel</p>
              <p className="text-xs text-gray-500">Para datos históricos o si la API no devuelve el detalle horario</p>
            </div>
          </div>
          <div onClick={() => inputRef.current?.click()} onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();handleFiles(e.dataTransfer.files)}}
            className="border-2 border-dashed border-gray-300 rounded-xl px-4 py-5 text-center cursor-pointer hover:bg-gray-50 transition-colors">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
              onChange={e=>handleFiles(e.target.files)}/>
            {syncing
              ? <p className="text-sm text-teal-600 animate-pulse">⚙️ Procesando...</p>
              : <>
                  <p className="text-sm font-medium text-gray-600">Arrastra aquí o haz clic</p>
                  <p className="text-xs text-gray-400 mt-1">Exporta desde tSpoonLab → Clientes → Excel de ventas<br/>Puedes subir varios archivos a la vez, se acumulan</p>
                </>
            }
          </div>
          {filesUploaded > 0 && <p className="text-xs text-emerald-600 font-medium">✓ {filesUploaded} archivo(s) procesado(s)</p>}
        </div>
      </div>

      {/* Log de progreso */}
      {progress.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 max-h-40 overflow-y-auto">
          {progress.map((line, i) => (
            <p key={i} className={`text-xs font-mono ${line.startsWith('✅')?'text-emerald-400':line.startsWith('❌')?'text-red-400':line.startsWith('⚠️')?'text-amber-400':'text-gray-300'}`}>
              {line}
            </p>
          ))}
        </div>
      )}
      {error && <Alert type="error">{error}</Alert>}

      {/* Sin datos */}
      {!analysis || !records.length ? (
        <Card className="p-12 text-center space-y-3">
          <p className="text-5xl">📊</p>
          <p className="font-semibold text-gray-700">Sin datos de ventas todavía</p>
          <p className="text-sm text-gray-400 max-w-lg mx-auto">
            Usa la sincronización automática (recomendado) para descargar el histórico de <strong>todas las marcas</strong> de un golpe.<br/>
            O sube los Excel exportados desde tSpoonLab → Clientes → cada marca.
          </p>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {icon:'📅', val:analysis.totalWeeks+' sem.',  label:'Historial analizado'},
              {icon:'🗓', val:uniqueDates+' días',          label:'Días con ventas'},
              {icon:'🏷', val:uniqueBrands.length+' marcas', label:'Canales/marcas'},
              {icon:'💶', val:totalAmount.toLocaleString('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}), label:'Ventas totales'},
            ].map(s=>(
              <Card key={s.label} className="p-3">
                <p className="text-lg">{s.icon}</p>
                <p className="font-bold text-sm">{s.val}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Heatmap siempre visible */}
          <Card className="p-5"><HeatmapHour patterns={analysis.hourlyPatterns}/></Card>

          {/* Tabs */}
          <div className="flex gap-1 bg-white border rounded-xl p-1 w-fit flex-wrap">
            {([
              {v:'recomendaciones',l:'👥 Personal'},
              {v:'horario',l:'📈 Por día'},
              {v:'marcas',l:`🏷 Marcas (${uniqueBrands.length})`},
              {v:'datos',l:'📋 Datos'},
            ] as const).map(({v,l})=>(
              <button key={v} onClick={()=>setTab(v)}
                className={`text-xs px-3 py-2 rounded-lg font-medium ${tab===v?'bg-teal-600 text-white':'text-gray-500 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>

          {/* ── RECOMENDACIONES ───────────────────────────────────────── */}
          {tab==='recomendaciones' && (
            <div className="space-y-4">
              {analysis.totalWeeks < 3 && <Alert type="warning">Solo {analysis.totalWeeks} semana(s). Con más datos las predicciones mejoran.</Alert>}
              <Card>
                <div className="p-4 border-b">
                  <p className="font-semibold">Personal recomendado por día y turno</p>
                  <p className="text-xs text-gray-500 mt-0.5">Mínimos del convenio garantizados · +1 cuando la demanda histórica lo justifica</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead><tr className="border-b bg-gray-50 text-xs">
                      <th className="p-3 text-left">Día</th>
                      <th className="p-3 text-center text-amber-600">☀️ Mediodía</th>
                      <th className="p-3 text-center text-violet-600">🌙 Noche</th>
                      <th className="p-3 text-left w-36">Dem. mediodía</th>
                      <th className="p-3 text-left w-36">Dem. noche</th>
                      <th className="p-3 text-center">Confianza</th>
                      <th className="p-3 text-left">Detalle</th>
                    </tr></thead>
                    <tbody>
                      {analysis.recommendations.map((rec,i)=>{
                        const dp = analysis.dayPatterns[i]
                        const minN = i>=4?3:2; const extra = rec.recommendedNoche - minN
                        return (
                          <tr key={i} className={`border-b last:border-0 ${i>=4?'bg-teal-50/30':''}`}>
                            <td className="p-3"><span className={`font-bold text-xs px-2 py-1 rounded-lg ${DAY_COLORS[i]}`}>{rec.dayName}</span></td>
                            <td className="p-3 text-center">
                              <span className="text-xl font-bold text-amber-700">{rec.recommendedManana}</span>
                              {dp.avgMediadia>0 && <p className="text-[10px] text-gray-400">{dp.avgMediadia}€</p>}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-xl font-bold text-violet-700">{rec.recommendedNoche}</span>
                                {extra>0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">+{extra}</span>}
                              </div>
                              {dp.avgNoche>0 && <p className="text-[10px] text-gray-400">{dp.avgNoche}€</p>}
                            </td>
                            <td className="p-3"><Bar pct={dp.demandMediadia} color="bg-amber-400"/></td>
                            <td className="p-3"><Bar pct={dp.demandNoche} color="bg-violet-500"/></td>
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
              </Card>
              {/* Barchart compacto */}
              <Card className="p-5">
                <p className="font-semibold text-sm mb-3">Demanda relativa por turno</p>
                <div className="space-y-2.5">
                  {analysis.dayPatterns.map((p,i)=>(
                    <div key={i} className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg w-8 text-center ${DAY_COLORS[i]}`}>{DAY_SHORT[i]}</span>
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-amber-500 w-14 shrink-0">Mediodía</span>
                          <Bar pct={p.demandMediadia} color="bg-amber-400"/>
                          <span className="text-[10px] text-gray-400 w-14 text-right">{p.avgMediadia>0?`${p.avgMediadia}€`:'—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-violet-500 w-14 shrink-0">Noche</span>
                          <Bar pct={p.demandNoche} color="bg-violet-500"/>
                          <span className="text-[10px] text-gray-400 w-14 text-right">{p.avgNoche>0?`${p.avgNoche}€`:'—'}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-300 w-6 text-right">{p.weeks}s</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ── POR DÍA ───────────────────────────────────────────────── */}
          {tab==='horario' && (
            <div className="space-y-4">
              <Card className="p-5">
                <p className="font-semibold mb-4 text-sm">Venta media por día de semana (mediodía + noche)</p>
                <div className="space-y-3">
                  {analysis.dayPatterns.map((p,i)=>{
                    const maxT = Math.max(...analysis.dayPatterns.map(x=>x.avgTotal),1)
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded-lg w-24 text-center ${DAY_COLORS[i]}`}>{p.dayName}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden flex">
                          <div className="bg-amber-400 h-6 transition-all" style={{width:`${p.avgTotal>0?(p.avgMediadia/p.avgTotal)*(p.avgTotal/maxT)*100:0}%`}}/>
                          <div className="bg-violet-500 h-6 transition-all" style={{width:`${p.avgTotal>0?(p.avgNoche/p.avgTotal)*(p.avgTotal/maxT)*100:0}%`}}/>
                        </div>
                        <span className="text-sm font-bold text-gray-700 w-20 text-right">{p.avgTotal>0?`${p.avgTotal.toLocaleString('es-ES')}€`:'—'}</span>
                        <span className="text-[10px] text-gray-300 w-5">{p.weeks}s</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
              <Card className="p-5">
                <HeatmapHour patterns={analysis.hourlyPatterns}/>
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

          {/* ── MARCAS ───────────────────────────────────────────────── */}
          {tab==='marcas' && (
            <div className="space-y-3">
              {/* Resultado del último sync */}
              {brandResults.length > 0 && (
                <Card className="p-4">
                  <p className="font-semibold text-sm mb-3">Resultado de la última sincronización</p>
                  <div className="space-y-1.5">
                    {brandResults.map((b,i)=>(
                      <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${b.status==='ok'?'bg-emerald-50':b.status==='empty'?'bg-gray-50':'bg-red-50'}`}>
                        <span className="text-sm">{b.status==='ok'?'✅':b.status==='empty'?'⚪':'❌'}</span>
                        <span className="font-medium text-sm flex-1">{b.brand}</span>
                        <span className="text-xs text-gray-500">{b.records>0?`${b.records} tickets`:b.message||'sin datos'}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {/* Ventas por marca (de los datos cargados) */}
              <Card className="p-4">
                <p className="font-semibold text-sm mb-3">Ventas por marca/canal</p>
                <div className="space-y-2">
                  {uniqueBrands.map(brand=>{
                    const bRecs = records.filter(r=>r.brand===brand)
                    const total = bRecs.reduce((s,r)=>s+r.amount,0)
                    const days  = new Set(bRecs.map(r=>r.date)).size
                    const maxBrand = Math.max(...uniqueBrands.map(b=>records.filter(r=>r.brand===b).reduce((s,r)=>s+r.amount,0)),1)
                    return (
                      <div key={brand} className="flex items-center gap-3">
                        <span className="text-xs font-medium w-36 truncate">{brand}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                          <div className="bg-teal-500 h-4 transition-all" style={{width:`${(total/maxBrand)*100}%`}}/>
                        </div>
                        <span className="text-xs font-bold text-gray-700 w-24 text-right">{total.toLocaleString('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0})}</span>
                        <span className="text-[10px] text-gray-400 w-12 text-right">{days}d · {bRecs.length}t</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>
          )}

          {/* ── DATOS ────────────────────────────────────────────────── */}
          {tab==='datos' && (
            <Card>
              <div className="p-3 border-b flex justify-between items-center">
                <p className="text-sm font-medium">{records.length} tickets · {uniqueDates} días · {uniqueBrands.length} marcas</p>
                <p className="text-xs text-gray-400">{analysis.dateRange.from} → {analysis.dateRange.to}</p>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white border-b text-gray-500">
                    <tr>{['Fecha','Hora','Turno','Marca','Canal','Importe'].map(h=>(
                      <th key={h} className="p-2 text-left font-semibold">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {[...records].reverse().slice(0,200).map((r,i)=>(
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-2 font-medium">{r.date}</td>
                        <td className="p-2">{r.time}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.turno==='mediodia'?'bg-amber-100 text-amber-700':'bg-violet-100 text-violet-700'}`}>
                            {r.turno==='mediodia'?'☀️ Med.':'🌙 Noch.'}
                          </span>
                        </td>
                        <td className="p-2 text-gray-600 max-w-28 truncate">{r.brand}</td>
                        <td className="p-2 text-gray-400">{r.source}</td>
                        <td className="p-2 font-semibold">{r.amount.toLocaleString('es-ES',{style:'currency',currency:'EUR'})}</td>
                      </tr>
                    ))}
                    {records.length > 200 && (
                      <tr><td colSpan={6} className="p-3 text-center text-xs text-gray-400">... y {records.length-200} más</td></tr>
                    )}
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
