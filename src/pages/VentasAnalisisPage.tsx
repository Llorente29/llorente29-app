import { useState, useEffect, useRef } from 'react'
import { Trash2, RefreshCw, FolderOpen, Search, ClipboardList, Calendar, Tag, Wallet, BarChart3, Users, Check, X, Inbox, Sun, Moon } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Alert } from '../components/ui'
import {
  syncAllBrands, parseExcelFile, analyzeHistory, saveAnalysis, loadSavedAnalysis, debugDeliveryStructure, fetchAllProducts,
  type SaleRecord, type SalesAnalysis, type BrandSyncResult
} from '../services/salesAnalysis'

const DAY_SHORT  = ['L','M','X','J','V','S','D']
const DAY_COLORS = ['bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-slate-100 text-slate-700','bg-accent-bg text-accent','bg-violet-100 text-violet-700','bg-violet-100 text-violet-700']

function Bar({ pct, color='bg-accent' }: { pct:number; color?:string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-accent-bg rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{width:`${Math.round(pct*100)}%`}}/>
      </div>
      <span className="text-[10px] text-text-secondary w-7 text-right">{Math.round(pct*100)}%</span>
    </div>
  )
}

function HeatmapHour({ patterns }: { patterns: SalesAnalysis['hourlyPatterns'] }) {
  if (!patterns.length) return null
  const max = Math.max(...patterns.map(p => p.avgAmount), 1)
  const HOURS = Array.from({length:14},(_,i)=>i+10)
  return (
    <div>
      <p className="text-xs font-semibold text-text-secondary uppercase mb-3">Venta media por franja horaria</p>
      <div className="flex gap-1 items-end" style={{height:'80px'}}>
        {HOURS.map(h => {
          const p = patterns.find(x => x.hour === h)
          const pct = p ? p.avgAmount/max : 0
          return (
            <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={p?`${h}:00 · ${p.avgAmount}€ · ${p.ticketCount} pedidos`:''}>
              <div className="w-full flex flex-col justify-end" style={{height:'64px'}}>
                <div className={`w-full rounded-t ${h<17?'bg-amber-400':'bg-violet-500'} ${pct===0?'opacity-10':''}`} style={{height:`${Math.max(pct*100,pct>0?6:0)}%`}}/>
              </div>
              <span className="text-[7px] text-text-secondary">{h}</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 mt-2 text-[10px] text-text-secondary">
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
  const [debugInfo, setDebugInfo] = useState<any>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [products, setProducts] = useState<{name:string;family:string;codi?:string}[]>([])
  const [showProducts, setShowProducts] = useState(false)
  const [prodSearch, setProdSearch] = useState('')
  // Mapeo local Andy → centro tSpoonLab (guardado en localStorage)
  const [centerMapping, setCenterMapping] = useState<Record<string,string>>(() => {
    try { return JSON.parse(localStorage.getItem('andy-center-mapping') || '{}') } catch { return {} }
  })
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
  function saveCenterMapping(mapping: Record<string,string>) {
    setCenterMapping(mapping)
    localStorage.setItem('andy-center-mapping', JSON.stringify(mapping))
  }

  async function handleAutoSync() {
    if (!isConnected) return
    const centerId = centerMapping[locId]
    if (!centerId) {
      setError('Asigna un centro de tSpoonLab a este local antes de sincronizar')
      return
    }
    setSyncing(true); setProgress([]); setError('')
    const log: string[] = []
    const addLog = (msg: string) => { log.push(msg); setProgress([...log]) }

    try {
      const result = await syncAllBrands(tspoon.token, centerId, daysBack, addLog)
      setBrandResults(result.brands)

      if (result.records.length > 0) {
        // Usar directamente los records del sync (todas las marcas incluidas)
        const combined = result.records.sort((a,b) => a.date.localeCompare(b.date))

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
          <h1 className="font-display text-2xl text-accent">Análisis de Ventas</h1>
          <p className="text-sm text-text-secondary mt-0.5">Sincroniza todas las marcas automáticamente · Granularidad horaria · Predicción de personal</p>
        </div>
        {records.length > 0 && <Button size="sm" variant="outline" onClick={clearData}><span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Limpiar</span></Button>}
      </div>

      {/* Controles principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ── Bloque 1: Sync automático ──────────────────────────────── */}
        <div className={`p-5 rounded-xl border-2 space-y-4 ${isConnected ? 'border-accent bg-accent-bg/50' : 'border-border-default bg-page opacity-70'}`}>
          <div className="flex items-center gap-2">
            <RefreshCw size={20} className="text-accent" />
            <div>
              <p className="font-semibold text-text-primary">Sincronización automática</p>
              <p className="text-xs text-text-secondary">Descarga todas las marcas y canales de una vez via API tSpoonLab</p>
            </div>
          </div>
          {!isConnected && (
            <Alert type="warning">Conecta tSpoonLab en Fichas Técnicas para usar esta opción</Alert>
          )}
          {isConnected && (
            <>
              <div className="flex items-center gap-3">
                {/* Selector local */}
                <div className="flex-1 space-y-1.5">
                  <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-full">
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                  {/* Vincular este local a un centro tSpoonLab */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-secondary shrink-0">Centro tSpoonLab:</span>
                    <select
                      value={centerMapping[locId] || ''}
                      onChange={e => saveCenterMapping({ ...centerMapping, [locId]: e.target.value })}
                      className="flex-1 text-xs border rounded-lg px-2 py-1 bg-card"
                    >
                      <option value="">— seleccionar centro —</option>
                      {(tspoon.centers || []).map((ctr: any) => (
                        <option key={ctr.id} value={ctr.id}>{ctr.description || ctr.descr || ctr.name || ctr.id}</option>
                      ))}
                    </select>
                    {centerMapping[locId] && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-success shrink-0"><Check size={10} /> vinculado</span>
                    )}
                  </div>
                </div>
                <Select value={daysBack} onChange={e => setDaysBack(parseInt(e.target.value))} className="w-36">
                  <option value={30}>Último mes</option>
                  <option value={60}>Últimos 2 meses</option>
                  <option value={90}>Últimos 3 meses</option>
                  <option value={180}>Últimos 6 meses</option>
                </Select>
              </div>
              <Button onClick={handleAutoSync} disabled={syncing || !centerMapping[locId]} className="w-full">
                <span className="inline-flex items-center justify-center gap-1.5">
                  <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Sincronizando...' : !centerMapping[locId]
                    ? 'Selecciona un centro tSpoonLab primero'
                    : `Sincronizar ${locations.find(l=>l.id===locId)?.name || 'local'} (${daysBack} días)`}
                </span>
              </Button>
              <div className="flex gap-2 flex-wrap">
                <button onClick={async () => {
                  setShowDebug(true)
                  const info = await debugDeliveryStructure(tspoon.token, centerMapping[locId] || tspoon.selectedCenter)
                  setDebugInfo(info)
                }} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary underline">
                  <Search size={12} /> Ver estructura API
                </button>
                <button onClick={async () => {
                  const cid = centerMapping[locId] || tspoon.selectedCenter
                  const prods = await fetchAllProducts(tspoon.token, cid)
                  setProducts(prods)
                  setShowProducts(true)
                  setProdSearch('')
                }} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary underline">
                  <ClipboardList size={12} /> Ver productos
                </button>
              </div>
              {tspoon.centers?.length > 0 && (
                <p className="text-xs text-text-secondary">
                  {tspoon.centers.length} centro(s) disponibles · 
                  {Object.keys(centerMapping).length > 0
                    ? ` ${Object.keys(centerMapping).length} local(es) vinculados`
                    : ' Vincula cada local a su centro'}
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Bloque 2: Upload manual ─────────────────────────────────── */}
        <div className="p-5 rounded-xl border-2 border-border-default space-y-3">
          <div className="flex items-center gap-2">
            <FolderOpen size={20} className="text-accent" />
            <div>
              <p className="font-semibold text-text-primary">Subida manual de Excel</p>
              <p className="text-xs text-text-secondary">Para datos históricos o si la API no devuelve el detalle horario</p>
            </div>
          </div>
          <div onClick={() => inputRef.current?.click()} onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();handleFiles(e.dataTransfer.files)}}
            className="border-2 border-dashed border-border-default rounded-xl px-4 py-5 text-center cursor-pointer hover:bg-page transition-colors">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
              onChange={e=>handleFiles(e.target.files)}/>
            {syncing
              ? <p className="text-sm text-accent animate-pulse inline-flex items-center justify-center gap-1.5"><RefreshCw size={14} className="animate-spin" /> Procesando...</p>
              : <>
                  <p className="text-sm font-medium text-text-secondary">Arrastra aquí o haz clic</p>
                  <p className="text-xs text-text-secondary mt-1">Exporta desde tSpoonLab → Clientes → Excel de ventas<br/>Puedes subir varios archivos a la vez, se acumulan</p>
                </>
            }
          </div>
          {filesUploaded > 0 && <p className="text-xs text-success font-medium inline-flex items-center gap-1"><Check size={12} /> {filesUploaded} archivo(s) procesado(s)</p>}
        </div>
      </div>

      {/* Log de progreso */}
      {progress.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 max-h-40 overflow-y-auto">
          {progress.map((line, i) => (
            <p key={i} className={`text-xs font-mono ${line.startsWith('✅')?'text-success':line.startsWith('❌')?'text-danger':line.startsWith('⚠️')?'text-warning':'text-text-secondary'}`}>
              {line}
            </p>
          ))}
        </div>
      )}
      {error && <Alert type="error">{error}</Alert>}

      {/* Sin datos */}
      {!analysis || !records.length ? (
        <Card className="p-12 text-center space-y-3">
          <div className="flex justify-center">
            <BarChart3 size={48} className="text-accent" strokeWidth={2} />
          </div>
          <p className="font-semibold text-text-primary">Sin datos de ventas todavía</p>
          <p className="text-sm text-text-secondary max-w-lg mx-auto">
            Usa la sincronización automática (recomendado) para descargar el histórico de <strong>todas las marcas</strong> de un golpe.<br/>
            O sube los Excel exportados desde tSpoonLab → Clientes → cada marca.
          </p>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {icon: Calendar, val:analysis.totalWeeks+' sem.',  label:'Historial analizado'},
              {icon: Calendar, val:uniqueDates+' días',          label:'Días con ventas'},
              {icon: Tag, val:uniqueBrands.length+' marcas', label:'Canales/marcas'},
              {icon: Wallet, val:totalAmount.toLocaleString('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}), label:'Ventas totales'},
            ].map(s=>{
              const Icon = s.icon
              return (
                <Card key={s.label} className="p-3">
                  <Icon size={18} className="text-accent" />
                  <p className="font-bold text-sm text-text-primary mt-1">{s.val}</p>
                  <p className="text-xs text-text-secondary">{s.label}</p>
                </Card>
              )
            })}
          </div>

          {/* Heatmap siempre visible */}
          <Card className="p-5"><HeatmapHour patterns={analysis.hourlyPatterns}/></Card>

          {/* Tabs */}
          <div className="flex gap-1 bg-card border border-border-default rounded-xl p-1 w-fit flex-wrap">
            {([
              {v:'recomendaciones',l:'Personal', Icon: Users},
              {v:'horario',l:'Por día', Icon: BarChart3},
              {v:'marcas',l:`Marcas (${uniqueBrands.length})`, Icon: Tag},
              {v:'datos',l:'Datos', Icon: ClipboardList},
            ] as const).map(({v,l,Icon})=>(
              <button key={v} onClick={()=>setTab(v)}
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-base ${tab===v?'bg-accent text-text-on-accent':'text-text-secondary hover:bg-accent-bg'}`}>
                <Icon size={14} /> {l}
              </button>
            ))}
          </div>

          {/* ── RECOMENDACIONES ───────────────────────────────────────── */}
          {tab==='recomendaciones' && (
            <div className="space-y-4">
              {analysis.totalWeeks < 3 && <Alert type="warning">Solo {analysis.totalWeeks} semana(s). Con más datos las predicciones mejoran.</Alert>}
              <Card>
                <div className="p-4 border-b">
                  <p className="font-semibold">Personal recomendado por día y turno</p>
                  <p className="text-xs text-text-secondary mt-0.5">Basado en platos/hora · ~15 platos por trabajador/hora · Mínimos del convenio garantizados</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead><tr className="border-b border-border-default bg-page text-xs">
                      <th className="p-3 text-left">Día</th>
                      <th className="p-3 text-center text-amber-600">
                        <span className="inline-flex items-center gap-1 justify-center"><Sun size={14} /> Mediodía</span>
                      </th>
                      <th className="p-3 text-center text-violet-600">
                        <span className="inline-flex items-center gap-1 justify-center"><Moon size={14} /> Noche</span>
                      </th>
                      <th className="p-3 text-center w-28">Platos med.</th>
                      <th className="p-3 text-center w-28">Platos noch.</th>
                      <th className="p-3 text-center">Confianza</th>
                      <th className="p-3 text-left">Detalle</th>
                    </tr></thead>
                    <tbody>
                      {analysis.recommendations.map((rec,i)=>{
                        const dp = analysis.dayPatterns[i]
                        const minN = i>=4?3:2; const extra = rec.recommendedNoche - minN
                        return (
                          <tr key={i} className={`border-b last:border-0 ${i>=4?'bg-accent-bg':''}`}>
                            <td className="p-3"><span className={`font-bold text-xs px-2 py-1 rounded-lg ${DAY_COLORS[i]}`}>{rec.dayName}</span></td>
                            <td className="p-3 text-center">
                              <span className="text-xl font-bold text-amber-700">{rec.recommendedManana}</span>
                              <p className="text-[9px] text-text-secondary">{dp.avgDishesMediadia>0?`${dp.avgDishesMediadia} pl.`:dp.avgMediadia>0?`${dp.avgMediadia}€`:''}</p>
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-xl font-bold text-violet-700">{rec.recommendedNoche}</span>
                                {extra>0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">+{extra}</span>}
                              </div>
                              <p className="text-[9px] text-text-secondary">{dp.avgDishesNoche>0?`${dp.avgDishesNoche} pl.`:dp.avgNoche>0?`${dp.avgNoche}€`:''}</p>
                            </td>
                            <td className="p-3 text-center">
                              {dp.avgDishesMediadia>0?<span className="font-bold text-amber-600">{dp.avgDishesMediadia}</span>:<span className="text-text-secondary">—</span>}
                            </td>
                            <td className="p-3 text-center">
                              {dp.avgDishesNoche>0?<span className="font-bold text-violet-600">{dp.avgDishesNoche}</span>:<span className="text-text-secondary">—</span>}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${rec.confidence==='alta'?'bg-success-bg text-success':rec.confidence==='media'?'bg-amber-100 text-amber-700':'bg-accent-bg text-text-secondary'}`}>
                                {rec.confidence==='alta'?'●●●':rec.confidence==='media'?'●●○':'●○○'} {rec.confidence}
                              </span>
                            </td>
                            <td className="p-3 text-xs text-text-secondary">{rec.reason}</td>
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
                          <span className="text-[10px] text-text-secondary w-14 text-right">{p.avgMediadia>0?`${p.avgMediadia}€`:'—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-violet-500 w-14 shrink-0">Noche</span>
                          <Bar pct={p.demandNoche} color="bg-violet-500"/>
                          <span className="text-[10px] text-text-secondary w-14 text-right">{p.avgNoche>0?`${p.avgNoche}€`:'—'}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-text-secondary w-6 text-right">{p.weeks}s</span>
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
                        <div className="flex-1 bg-accent-bg rounded-full h-6 overflow-hidden flex">
                          <div className="bg-amber-400 h-6 transition-all" style={{width:`${p.avgTotal>0?(p.avgMediadia/p.avgTotal)*(p.avgTotal/maxT)*100:0}%`}}/>
                          <div className="bg-violet-500 h-6 transition-all" style={{width:`${p.avgTotal>0?(p.avgNoche/p.avgTotal)*(p.avgTotal/maxT)*100:0}%`}}/>
                        </div>
                        <span className="text-sm font-bold text-text-primary w-20 text-right">{p.avgTotal>0?`${p.avgTotal.toLocaleString('es-ES')}€`:'—'}</span>
                        <span className="text-[10px] text-text-secondary w-5">{p.weeks}s</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
              <Card className="p-5">
                <HeatmapHour patterns={analysis.hourlyPatterns}/>
                {analysis.hourlyPatterns.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs font-semibold text-text-secondary uppercase mb-2">Horas de mayor actividad</p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[...analysis.hourlyPatterns].sort((a,b)=>b.avgAmount-a.avgAmount).slice(0,6).map(p=>(
                        <div key={p.hour} className={`p-2 rounded-xl border text-center text-xs ${p.hour<17?'bg-amber-50 border-amber-200':'bg-violet-50 border-violet-200'}`}>
                          <p className="font-bold">{p.hour}:00</p>
                          <p className="text-text-secondary">{p.avgAmount}€</p>
                          <p className="text-text-secondary">{p.ticketCount} ped.</p>
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
                      <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${b.status==='ok'?'bg-success-bg':b.status==='empty'?'bg-page':'bg-danger-bg'}`}>
                        {b.status==='ok'
                          ? <Check size={14} className="text-success" />
                          : b.status==='empty'
                            ? <Inbox size={14} className="text-text-secondary" />
                            : <X size={14} className="text-danger" />}
                        <span className="font-medium text-sm flex-1 text-text-primary">{b.brand}</span>
                        <span className="text-xs text-text-secondary">{b.records>0?`${b.records} tickets`:b.message||'sin datos'}</span>
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
                        <div className="flex-1 bg-accent-bg rounded-full h-4 overflow-hidden">
                          <div className="bg-accent h-4 transition-all" style={{width:`${(total/maxBrand)*100}%`}}/>
                        </div>
                        <span className="text-xs font-bold text-text-primary w-24 text-right">{total.toLocaleString('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0})}</span>
                        <span className="text-[10px] text-text-secondary w-12 text-right">{days}d · {bRecs.length}t</span>
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
                <p className="text-xs text-text-secondary">{analysis.dateRange.from} → {analysis.dateRange.to}</p>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b text-text-secondary">
                    <tr>{['Fecha','Hora','Turno','Marca','Canal','Importe'].map(h=>(
                      <th key={h} className="p-2 text-left font-semibold">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {[...records].reverse().slice(0,200).map((r,i)=>(
                      <tr key={i} className="border-b last:border-0 hover:bg-page">
                        <td className="p-2 font-medium">{r.date}</td>
                        <td className="p-2">{r.time}</td>
                        <td className="p-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${r.turno==='mediodia'?'bg-amber-100 text-amber-700':'bg-violet-100 text-violet-700'}`}>
                            {r.turno==='mediodia'?<Sun size={10} />:<Moon size={10} />}
                            {r.turno==='mediodia'?'Med.':'Noch.'}
                          </span>
                        </td>
                        <td className="p-2 text-text-secondary max-w-28 truncate">{r.brand}</td>
                        <td className="p-2 text-text-secondary">{r.source}</td>
                        <td className="p-2 font-semibold">{r.amount.toLocaleString('es-ES',{style:'currency',currency:'EUR'})}</td>
                      </tr>
                    ))}
                    {records.length > 200 && (
                      <tr><td colSpan={6} className="p-3 text-center text-xs text-text-secondary">... y {records.length-200} más</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
      {/* Products panel */}
      {showProducts && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowProducts(false)}>
          <div className="bg-card rounded-xl p-5 max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <p className="font-bold text-text-primary inline-flex items-center gap-1.5">
                <ClipboardList size={16} className="text-accent" />
                Productos en tSpoonLab ({products.length})
              </p>
              <button onClick={() => setShowProducts(false)} className="text-text-secondary hover:text-text-primary">
                <X size={20} />
              </button>
            </div>
            <input
              placeholder="Buscar producto o familia..."
              value={prodSearch} onChange={e => setProdSearch(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm mb-3 w-full"
              autoFocus
            />
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card border-b">
                  <tr className="text-text-secondary">
                    <th className="p-2 text-left font-semibold">Producto</th>
                    <th className="p-2 text-left font-semibold">Familia</th>
                    <th className="p-2 text-center font-semibold">Excluido</th>
                  </tr>
                </thead>
                <tbody>
                  {products
                    .filter(p => !prodSearch || p.name.toLowerCase().includes(prodSearch.toLowerCase()) || p.family.toLowerCase().includes(prodSearch.toLowerCase()))
                    .map((p, i) => {
                      const EXCL_NAMES = ['agua','coca cola','coca-cola','cocacola','fanta','mahou','cerveza',
                        'tarta tres leches','tarta 3 leches','cheesecake','cheescake',
                        'tarrina (cuvo) brownie','tarrina (cuvo) cheescake',
                        'tarrina mayo','tarrina mil islas','tarrina salsa','tarrina sweet chilli',
                        'delivery','descuento']
                      const EXCL_FAMS = ['bebida','drink','postre','dessert','refresco','café','cafe','coffee',
                        'cerveza','vino','cocktail','cóctel','pasteleria','pastelería','bolleria','bollería',
                        'pastas','salsa','salsas']
                      const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                      const nameLow = norm(p.name)
                      const famLow  = norm(p.family)
                      const excluded = EXCL_NAMES.some(ex => nameLow.includes(norm(ex)))
                        || EXCL_FAMS.some(ex => famLow.includes(norm(ex)))
                      return (
                        <tr key={i} className={`border-b last:border-0 ${excluded ? 'bg-danger-bg' : ''}`}>
                          <td className="p-2 font-medium">{p.name}</td>
                          <td className="p-2 text-text-secondary">{p.family}</td>
                          <td className="p-2 text-center">{excluded ? <X size={14} className="text-danger inline" /> : <Check size={14} className="text-success inline" />}</td>
                        </tr>
                      )
                    })
                  }
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text-secondary mt-3 inline-flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1"><X size={12} className="text-danger" /> excluido del cálculo</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><Check size={12} className="text-success" /> incluido</span>
            </p>
          </div>
        </div>
      )}

      {/* Debug panel */}
      {showDebug && debugInfo && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowDebug(false)}>
          <div className="bg-gray-900 text-green-400 rounded-xl p-5 max-w-3xl w-full max-h-[80vh] overflow-auto font-mono text-xs" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <p className="font-bold text-white inline-flex items-center gap-1.5">
                <Search size={14} />
                Estructura real de la API tSpoonLab
              </p>
              <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="text-yellow-400 mb-2">Total albaranes (últimos 7 días): {debugInfo.total}</p>
            <p className="text-yellow-400 mb-2">Clientes/marcas: {debugInfo.customers?.length || 0}</p>
            <p className="text-blue-400 mb-1">Keys del 1er albarán:</p>
            <p className="text-green-300 mb-3">{debugInfo.keys?.join(', ') || 'ninguna'}</p>
            <p className="text-blue-400 mb-1">Muestra (primer albarán):</p>
            <pre className="text-green-300 overflow-auto max-h-64">{JSON.stringify(debugInfo.sample, null, 2)}</pre>
            <p className="text-blue-400 mt-3 mb-1">Clientes (primeros 3):</p>
            <pre className="text-green-300">{JSON.stringify(debugInfo.customers?.slice(0,3), null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}