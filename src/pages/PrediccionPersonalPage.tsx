import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Select, Card, Alert } from '../components/ui'
import { loadSavedAnalysis } from '../services/salesAnalysis'
import {
  enrichRecords, buildMonthlyPatterns, predictWeekStaff,
  saveMonthlyPatterns, loadMonthlyPatterns, loadRainCoeficient,
  saveEnrichment, loadEnrichment,
  type MonthlyPattern, type WeekStaffPrediction, type DayEnrichment
} from '../services/enrichment'
import {
  generateFromPrediction, DAY_CODES, createDefaultParams,
  type PredictionMode
} from '../services/scheduler'

const DAY_SHORT = ['L','M','X','J','V','S','D']
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function getWeekStart(offset = 0): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - dow + offset * 7)
  return d.toISOString().slice(0, 10)
}

function ConfBadge({ c }: { c: 'alta'|'media'|'baja' }) {
  const cfg = { alta:'bg-emerald-100 text-emerald-700', media:'bg-amber-100 text-amber-700', baja:'bg-gray-100 text-gray-500' }
  const dot = { alta:'●●●', media:'●●○', baja:'●○○' }
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cfg[c]}`}>{dot[c]} {c}</span>
}

export default function PrediccionPersonalPage() {
  const { locations, staff, setSchedules } = useApp()
  const [locId, setLocId] = useState(locations[0]?.id || '')
  const [tab, setTab] = useState<'prediccion'|'historico'|'ajustes'>('prediccion')
  const [weekOffset, setWeekOffset] = useState(1)
  const [loading, setLoading] = useState(false)
  const [buildingPatterns, setBuildingPatterns] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [patterns, setPatterns] = useState<MonthlyPattern[]>([])
  const [patternsDate, setPatternsDate] = useState('')
  const [predictions, setPredictions] = useState<WeekStaffPrediction[]>([])
  const [rainCoef, setRainCoef] = useState(1.25)
  const [, setEnriched] = useState<Record<string, DayEnrichment>>({})
  const [dishesPerWorkerHour, setDishesPerWorkerHour] = useState(15)
  const [filterMonth, setFilterMonth] = useState<number>(0)
  const [genMode, setGenMode] = useState<PredictionMode>('generate')
  const [genResult, setGenResult] = useState<any>(null)

  const hasSalesData = !!loadSavedAnalysis(locId)?.records?.length
  const weekStart = getWeekStart(weekOffset)
  const weekStartNext = getWeekStart(weekOffset + 1)

  useEffect(() => {
    const saved = loadMonthlyPatterns(locId)
    if (saved) { setPatterns(saved.patterns); setPatternsDate(saved.savedAt) }
    else { setPatterns([]) }
    setRainCoef(loadRainCoeficient(locId))
    setEnriched(loadEnrichment(locId))
    setPredictions([])
    setGenResult(null)
    setLog([])
  }, [locId])

  async function buildPatterns() {
    const saved = loadSavedAnalysis(locId)
    if (!saved?.records?.length) {
      setLog(['❌ Sincroniza primero los datos de ventas en Análisis de Ventas'])
      return
    }
    setBuildingPatterns(true)
    setLog([])
    const logs: string[] = []
    const addLog = (m: string) => { logs.push(m); setLog([...logs]) }

    addLog(`📊 ${saved.records.length} tickets cargados`)
    addLog('🌧 Descargando histórico meteorológico de Madrid...')
    const { enriched: enr, rainCoeficient } = await enrichRecords(saved.records)
    addLog(`✓ Coeficiente lluvia: ${rainCoeficient}x`)
    addLog('⚽ Descargando partidos del Real Madrid...')
    const sportDays = Object.values(enr).filter(e => e.sportEvent).length
    addLog(`✓ ${sportDays} días con partido detectados`)
    const pats = buildMonthlyPatterns(saved.records, enr)
    addLog(`✓ ${pats.length} patrones mes/día construidos`)
    saveMonthlyPatterns(locId, pats, rainCoeficient)
    saveEnrichment(locId, enr)
    setPatterns(pats)
    setRainCoef(rainCoeficient)
    setEnriched(enr)
    setPatternsDate(new Date().toISOString())
    addLog('✅ Patrones guardados')
    setBuildingPatterns(false)
  }

  async function predictWeek() {
    if (!patterns.length) { setLog(['❌ Construye primero los patrones históricos']); return }
    setLoading(true)
    setLog([])
    setGenResult(null)
    const logs: string[] = []
    const addLog = (m: string) => { logs.push(m); setLog([...logs]) }
    addLog(`📅 Calculando semana del ${weekStart}...`)
    addLog('⚽ Consultando eventos deportivos...')
    addLog('🌧 Consultando previsión meteorológica...')
    try {
      const preds = await predictWeekStaff(weekStart, patterns, rainCoef)
      const adjusted = preds.map(p => ({
        ...p,
        staffMediadia: Math.max(1, Math.ceil(p.predictedDishesMediadia / (dishesPerWorkerHour * 3.5))),
        staffNoche:    Math.max(2, Math.ceil(p.predictedDishesNoche    / (dishesPerWorkerHour * 4.5))),
      }))
      setPredictions(adjusted)
      const hasEvents = adjusted.filter(p => p.sportEvent).length
      const hasRain   = adjusted.filter(p => p.isRainy).length
      addLog(`✓ ${hasEvents} día(s) con partido · ${hasRain} día(s) con lluvia prevista`)
      addLog('✅ Predicción lista')
    } catch (e: unknown) {
      addLog(`❌ ${e instanceof Error ? e.message : 'Error'}`)
    }
    setLoading(false)
  }

  function generateCalendar() {
    if (!predictions.length) return
    setGenerating(true)
    const locStaff = staff.filter(e => e.active && e.locationId === locId)
    if (!locStaff.length) {
      setLog(l => [...l, '❌ No hay trabajadores activos en este local'])
      setGenerating(false)
      return
    }
    const staffNeeds: Record<string, { manana: number; noche: number }> = {}
    predictions.forEach(p => {
      staffNeeds[DAY_CODES[p.dayOfWeek]] = { manana: p.staffMediadia, noche: p.staffNoche }
    })
    const baseParams = createDefaultParams(locStaff)
    const result = generateFromPrediction(locStaff, weekStart, baseParams, staffNeeds as any, genMode)
    setGenResult(result)
    if (genMode !== 'alert' || !result.coverageIssues.length) {
      const plan = {
        id: `pred-${Date.now()}`,
        locationId: locId, weekStart,
        days: [], published: false,
        createdAt: new Date().toISOString(),
        generatedData: result.schedule,
        params: baseParams,
        modifications: [],
        tMapping: ['','',''] as [string,string,string]
      }
      setSchedules((prev: any[]) => [...prev.filter((s: any) => !(s.locationId === locId && s.weekStart === weekStart)), plan])
      setLog(l => [...l, `✅ Horario guardado en Calendario para la semana del ${weekStart}`])
    }
    setGenerating(false)
  }

  const patternsFiltered = filterMonth > 0 ? patterns.filter(p => p.month === filterMonth) : patterns

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily:'Instrument Serif, serif' }}>Predicción de Personal</h1>
          <p className="text-sm text-gray-500 mt-0.5">Basado en platos históricos · Lluvia · Partidos Real Madrid</p>
        </div>
        <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      {!hasSalesData && (
        <Alert type="warning">Sincroniza datos de ventas en <strong>Análisis de Ventas</strong> primero.</Alert>
      )}

      {/* Construir patrones */}
      <div className={`p-5 rounded-2xl border-2 space-y-3 ${patterns.length ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-gray-800">
              {patterns.length ? `✅ ${patterns.length} patrones construidos` : '⚠️ Sin patrones históricos'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {patternsDate ? `Actualizado: ${new Date(patternsDate).toLocaleString('es-ES')}` : 'Construye los patrones para habilitar las predicciones'}
            </p>
          </div>
          <Button onClick={buildPatterns} disabled={buildingPatterns || !hasSalesData} variant={patterns.length ? 'outline' : 'primary'}>
            {buildingPatterns ? '⚙️ Construyendo...' : patterns.length ? '🔄 Reconstruir' : '⚡ Construir patrones históricos'}
          </Button>
        </div>
        {rainCoef !== 1.25 && (
          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
            🌧 Coeficiente lluvia calculado: <strong>{rainCoef}x</strong> (+{Math.round((rainCoef-1)*100)}% de pedidos en días de lluvia)
          </p>
        )}
      </div>

      {log.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 max-h-36 overflow-y-auto">
          {log.map((l, i) => (
            <p key={i} className={`text-xs font-mono ${l.startsWith('✅')?'text-emerald-400':l.startsWith('❌')?'text-red-400':'text-gray-300'}`}>{l}</p>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white border rounded-xl p-1 w-fit">
        {([
          { v:'prediccion', l:'📅 Predicción semanal' },
          { v:'historico',  l:'📊 Histórico mensual' },
          { v:'ajustes',    l:'⚙️ Ajustes' },
        ] as const).map(({ v, l }) => (
          <button key={v} onClick={() => setTab(v)}
            className={`text-xs px-3 py-2 rounded-lg font-medium ${tab===v?'bg-teal-600 text-white':'text-gray-500 hover:bg-gray-50'}`}>{l}</button>
        ))}
      </div>

      {/* ── PREDICCIÓN SEMANAL ─────────────────────────────────────────────── */}
      {tab === 'prediccion' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-white border rounded-xl p-1">
              <button onClick={() => setWeekOffset(w => w - 1)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 rounded-lg">‹</button>
              <span className="px-3 text-sm font-medium min-w-[180px] text-center">
                {weekOffset === 0 ? 'Esta semana' : weekOffset === 1 ? 'Próxima semana' : `En ${weekOffset} semanas`}
                <span className="block text-[10px] text-gray-400">{weekStart} → {weekStartNext}</span>
              </span>
              <button onClick={() => setWeekOffset(w => w + 1)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 rounded-lg">›</button>
            </div>
            <Button onClick={predictWeek} disabled={loading || !patterns.length}>
              {loading ? '⚙️ Calculando...' : '⚡ Calcular predicción'}
            </Button>
          </div>

          {predictions.length > 0 && (
            <div className="space-y-4">
              {/* Alertas eventos */}
              {predictions.filter(p => p.sportEvent || p.isRainy).map((p, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'bg-red-50 border-red-200':p.sportEvent?'bg-amber-50 border-amber-200':'bg-blue-50 border-blue-200'}`}>
                  <span className="text-lg">{p.sportEvent?'⚽':'🌧'}</span>
                  <div>
                    <p className="font-semibold text-gray-800">
                      {p.dayName} {p.date}
                      {p.sportEvent && ` · ${p.sportEvent.competition}: ${p.sportEvent.home} vs ${p.sportEvent.away}`}
                      {p.isRainy && !p.sportEvent && ' · Lluvia prevista'}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">Coeficiente: +{Math.round((p.coeficient-1)*100)}% en pedidos estimados</p>
                  </div>
                </div>
              ))}

              {/* Tabla */}
              <Card>
                <div className="p-4 border-b">
                  <p className="font-semibold">Personal necesario · {weekStart}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{dishesPerWorkerHour} platos/hora · Mín. 1 mediodía · Mín. 2 noche</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50 text-xs">
                      <th className="p-3 text-left">Día</th>
                      <th className="p-3 text-center text-amber-600">☀️ Mediodía</th>
                      <th className="p-3 text-center text-violet-600">🌙 Noche</th>
                      <th className="p-3 text-center">🍽 Platos med.</th>
                      <th className="p-3 text-center">🍽 Platos noch.</th>
                      <th className="p-3 text-center">Coef.</th>
                      <th className="p-3 text-center">Fiabilidad</th>
                      <th className="p-3 text-left">Factores</th>
                    </tr></thead>
                    <tbody>
                      {predictions.map((p, i) => (
                        <tr key={i} className={`border-b last:border-0 ${p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'bg-red-50/40':p.sportEvent?'bg-amber-50/40':p.isRainy?'bg-blue-50/20':i>=4?'bg-teal-50/20':''}`}>
                          <td className="p-3"><p className="font-semibold">{p.dayName}</p><p className="text-[10px] text-gray-400">{p.date}</p></td>
                          <td className="p-3 text-center"><span className="text-2xl font-bold text-amber-700">{p.staffMediadia}</span></td>
                          <td className="p-3 text-center"><span className="text-2xl font-bold text-violet-700">{p.staffNoche}</span></td>
                          <td className="p-3 text-center text-xs text-gray-600">{p.predictedDishesMediadia||'—'}</td>
                          <td className="p-3 text-center text-xs text-gray-600">{p.predictedDishesNoche||'—'}</td>
                          <td className="p-3 text-center">{p.coeficient>1?<span className="text-xs font-bold text-amber-600">x{p.coeficient}</span>:<span className="text-xs text-gray-400">x1</span>}</td>
                          <td className="p-3 text-center"><ConfBadge c={p.confidence}/></td>
                          <td className="p-3 text-xs text-gray-500">{p.coefReason.join(' · ')||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Resumen visual */}
              <div className="grid grid-cols-7 gap-1.5">
                {predictions.map((p, i) => (
                  <div key={i} className={`p-2 rounded-xl border text-center space-y-1 ${p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'border-red-300 bg-red-50':p.sportEvent?'border-amber-300 bg-amber-50':p.isRainy?'border-blue-200 bg-blue-50':i>=4?'border-teal-200 bg-teal-50':'border-gray-200 bg-white'}`}>
                    <p className="text-xs font-bold text-gray-600">{DAY_SHORT[i]}</p>
                    {(p.sportEvent||p.isRainy)&&<p className="text-[9px]">{p.sportEvent?.isElClasico?'🏆':p.sportEvent?'⚽':'🌧'}</p>}
                    <div className="text-amber-600"><p className="text-lg font-bold leading-none">{p.staffMediadia}</p><p className="text-[8px]">mediodía</p></div>
                    <div className="text-violet-600"><p className="text-lg font-bold leading-none">{p.staffNoche}</p><p className="text-[8px]">noche</p></div>
                  </div>
                ))}
              </div>

              {/* Generar calendario */}
              <Card className="p-5 space-y-4">
                <div>
                  <p className="font-semibold text-gray-800">Generar calendario de horarios</p>
                  <p className="text-xs text-gray-500 mt-0.5">Usa esta predicción para asignar turnos reales a los trabajadores</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { mode:'alert' as PredictionMode, icon:'⚠️', label:'Solo avisar', desc:'Genera con mínimos base y señala los días con cobertura insuficiente' },
                    { mode:'reorganize' as PredictionMode, icon:'🔄', label:'Reorganizar', desc:'Redistribuye descansos automáticamente para cubrir los días con déficit' },
                    { mode:'generate' as PredictionMode, icon:'⚡', label:'Generar completo', desc:'Genera con los mínimos de la predicción y marca en rojo los problemas' },
                  ] as const).map(opt => (
                    <button key={opt.mode} onClick={() => setGenMode(opt.mode)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${genMode===opt.mode?'border-teal-500 bg-teal-50':'border-gray-200 hover:border-gray-300'}`}>
                      <p className="text-lg mb-1">{opt.icon}</p>
                      <p className="text-sm font-semibold text-gray-800">{opt.label}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
                <Button onClick={generateCalendar} disabled={generating} className="w-full">
                  {generating ? '⚙️ Generando...' : `${genMode==='alert'?'⚠️':genMode==='reorganize'?'🔄':'⚡'} Generar horario para ${weekStart}`}
                </Button>
                {genResult && (
                  <div className="space-y-2">
                    {genResult.coverageIssues.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-red-700">⚠️ {genResult.coverageIssues.length} problema(s) de cobertura:</p>
                        {genResult.coverageIssues.map((issue: any, i: number) => (
                          <div key={i} className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                            <strong>{issue.dayName}</strong> {issue.turno==='noche'?'🌙 noche':'☀️ mediodía'}: necesitas {issue.needed}, disponibles {issue.available} (faltan {issue.deficit})
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        ✅ Cobertura completa · Horario guardado en <strong>Calendario de Horarios</strong>
                      </p>
                    )}
                    {genResult.reorganizationsApplied.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-blue-700">🔄 Reorganizaciones:</p>
                        {genResult.reorganizationsApplied.map((r: string, i: number) => (
                          <p key={i} className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">{r}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          )}

          {predictions.length === 0 && patterns.length > 0 && (
            <Card className="p-8 text-center">
              <p className="text-3xl mb-2">📅</p>
              <p className="text-gray-500 text-sm">Selecciona la semana y pulsa Calcular predicción</p>
            </Card>
          )}
        </div>
      )}

      {/* ── HISTÓRICO MENSUAL ──────────────────────────────────────────────── */}
      {tab === 'historico' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={filterMonth} onChange={e => setFilterMonth(parseInt(e.target.value))} className="w-40">
              <option value={0}>Todos los meses</option>
              {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </Select>
            <p className="text-xs text-gray-500">{patternsFiltered.length} patrones</p>
          </div>
          {patterns.length === 0 ? (
            <Card className="p-8 text-center"><p className="text-3xl mb-2">📊</p><p className="text-gray-500 text-sm">Construye los patrones históricos primero</p></Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b bg-gray-50 text-gray-500">
                      <th className="p-3 text-left">Mes</th><th className="p-3 text-left">Día</th>
                      <th className="p-3 text-center">Platos med.</th><th className="p-3 text-center">Platos noch.</th>
                      <th className="p-3 text-center">Normalizado</th><th className="p-3 text-center">Muestras</th>
                      <th className="p-3 text-center">⚽</th><th className="p-3 text-center">🌧</th>
                    </tr></thead>
                    <tbody>
                      {patternsFiltered.map((p, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="p-3 font-medium">{p.monthName}</td>
                          <td className="p-3">{p.dayName}</td>
                          <td className="p-3 text-center font-semibold text-amber-600">{p.avgDishesMediadia}</td>
                          <td className="p-3 text-center font-semibold text-violet-600">{p.avgDishesNoche}</td>
                          <td className="p-3 text-center text-gray-500">{p.avgDishesNormalized}</td>
                          <td className="p-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${p.samples>=8?'bg-emerald-100 text-emerald-700':p.samples>=4?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-500'}`}>{p.samples}</span>
                          </td>
                          <td className="p-3 text-center">{p.sportEventDays>0?<span className="text-amber-600 font-medium">{p.sportEventDays}</span>:'—'}</td>
                          <td className="p-3 text-center">{p.rainyDays>0?<span className="text-blue-600 font-medium">{p.rainyDays}</span>:'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Heatmap */}
              <Card className="p-5">
                <p className="font-semibold text-sm mb-4">Platos noche por mes y día (intensidad)</p>
                <div className="overflow-x-auto">
                  <table className="text-xs">
                    <thead><tr>
                      <th className="p-1.5 text-left text-gray-500 w-16">Mes</th>
                      {['L','M','X','J','V','S','D'].map(d=><th key={d} className="p-1.5 text-center text-gray-500 w-14">{d}</th>)}
                    </tr></thead>
                    <tbody>
                      {Array.from({length:12},(_,mi)=>mi+1).map(month=>{
                        const row = Array.from({length:7},(_,dow)=>patterns.find(p=>p.month===month&&p.dayOfWeek===dow))
                        if(row.every(p=>!p)) return null
                        const maxD = Math.max(...patterns.map(p=>p.avgDishesNoche),1)
                        return (
                          <tr key={month} className="border-b last:border-0">
                            <td className="p-1.5 font-medium text-gray-600">{MONTH_NAMES[month-1]}</td>
                            {row.map((p,dow)=>{
                              const pct = p?p.avgDishesNoche/maxD:0
                              const bg = pct>0.8?'bg-violet-600 text-white':pct>0.6?'bg-violet-400 text-white':pct>0.4?'bg-violet-200 text-violet-800':pct>0?'bg-violet-100 text-violet-600':'bg-gray-50 text-gray-300'
                              return <td key={dow} className="p-0.5"><div className={`rounded text-center py-1 ${bg}`} title={p?`${p.monthName} ${p.dayName}: ${p.avgDishesNoche} platos (${p.samples}s)`:''}>{ p?p.avgDishesNoche:'·'}</div></td>
                            })}
                          </tr>
                        )
                      }).filter(Boolean)}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ── AJUSTES ────────────────────────────────────────────────────────── */}
      {tab === 'ajustes' && (
        <div className="space-y-4 max-w-lg">
          <Card className="p-5 space-y-4">
            <p className="font-semibold text-gray-800">Ratio de producción</p>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">Platos por trabajador por hora</label>
              <div className="flex items-center gap-3 mt-2">
                <input type="range" min={8} max={25} step={1} value={dishesPerWorkerHour}
                  onChange={e => setDishesPerWorkerHour(parseInt(e.target.value))} className="flex-1 accent-teal-600"/>
                <span className="font-bold text-lg text-teal-600 w-16 text-center">{dishesPerWorkerHour}/h</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                <div className="p-2 bg-gray-50 rounded-xl border"><p className="font-bold text-amber-600">{Math.ceil(dishesPerWorkerHour*3.5)}</p><p className="text-gray-400">platos/trabajador mediodía</p></div>
                <div className="p-2 bg-gray-50 rounded-xl border"><p className="font-bold text-violet-600">{Math.ceil(dishesPerWorkerHour*4.5)}</p><p className="text-gray-400">platos/trabajador noche</p></div>
                <div className="p-2 bg-gray-50 rounded-xl border"><p className="font-bold text-gray-600">mín. 2</p><p className="text-gray-400">siempre en noche</p></div>
              </div>
            </div>
          </Card>
          <Card className="p-5 space-y-3">
            <p className="font-semibold text-gray-800">Coeficientes de eventos deportivos</p>
            {[
              { label:'🏆 Clásico (vs Barcelona)', val:40 },
              { label:'⚽ Derbi (vs Atlético)', val:35 },
              { label:'🌍 Champions eliminatoria', val:30 },
              { label:'🏟 Real Madrid en casa', val:20 },
              { label:'✈️ Real Madrid visitante', val:15 },
            ].map(item=>(
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-gray-700">{item.label}</span>
                <span className="text-xs font-bold text-teal-600">+{item.val}%</span>
              </div>
            ))}
          </Card>
          <Card className="p-5 space-y-3">
            <p className="font-semibold text-gray-800">🌧 Coeficiente de lluvia</p>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-2xl font-bold text-blue-700">{rainCoef}x</p>
              <p className="text-xs text-blue-600 mt-0.5">
                {rainCoef>1?`+${Math.round((rainCoef-1)*100)}% de pedidos en días de lluvia (calculado del histórico)`:'Construye los patrones para calcular'}
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
