import { useState, useEffect } from 'react'
import { Calendar, BarChart3, Settings, ChevronLeft, ChevronRight, RefreshCw, Trophy, Cloud, CheckCircle2, AlertTriangle, Sun, Moon, Activity } from 'lucide-react'
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
import { fetchVacations } from '../services/vacationsService'
import type { VacationRequest } from '../types/personal'

const DAY_SHORT = ['L','M','X','J','V','S','D']
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function getWeekStart(offset = 0): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - dow + offset * 7)
  return d.toISOString().slice(0, 10)
}

function ConfBadge({ c }: { c: 'alta'|'media'|'baja' }) {
  const cfg = { alta:'bg-success-bg text-success', media:'bg-amber-100 text-amber-700', baja:'bg-accent-bg text-text-secondary' }
  const dot = { alta:'●●●', media:'●●○', baja:'●○○' }
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cfg[c]}`}>{dot[c]} {c}</span>
}

export default function PrediccionPersonalPage() {
  const { locations, staff, setSchedules, activeAccountId } = useApp()
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
  // Vacaciones de la cuenta: emp.vacations no se puebla al cargar el staff, así que
  // se cargan aparte y se pasan explícitas al scheduler (excluye ausencias aprobadas).
  const [vacations, setVacations] = useState<VacationRequest[]>([])

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

  // Vacaciones de la cuenta (RLS acota). Se recargan al cambiar de cuenta.
  useEffect(() => {
    let cancelled = false
    fetchVacations()
      .then((vs) => { if (!cancelled && vs) setVacations(vs) })
      .catch(() => { if (!cancelled) setVacations([]) })
    return () => { cancelled = true }
  }, [activeAccountId])

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
    const result = generateFromPrediction(locStaff, weekStart, baseParams, staffNeeds as any, genMode, vacations)
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
          <h1 className="font-display text-2xl text-accent">Predicción de Personal</h1>
          <p className="text-sm text-text-secondary mt-0.5">Basado en platos históricos · Lluvia · Partidos Real Madrid</p>
        </div>
        <Select value={locId} onChange={e => setLocId(e.target.value)} className="w-48">
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      {!hasSalesData && (
        <Alert type="warning">Sincroniza datos de ventas en <strong>Análisis de Ventas</strong> primero.</Alert>
      )}

      {/* Construir patrones */}
      <div className={`p-5 rounded-xl border-2 space-y-3 ${patterns.length ? 'border-success/30 bg-success-bg' : 'border-warning/30 bg-warning-bg'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-text-primary inline-flex items-center gap-1.5">
              {patterns.length
                ? <><CheckCircle2 size={16} className="text-success" /> {patterns.length} patrones construidos</>
                : <><AlertTriangle size={16} className="text-warning" /> Sin patrones históricos</>}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {patternsDate ? `Actualizado: ${new Date(patternsDate).toLocaleString('es-ES')}` : 'Construye los patrones para habilitar las predicciones'}
            </p>
          </div>
          <Button onClick={buildPatterns} disabled={buildingPatterns || !hasSalesData} variant={patterns.length ? 'outline' : 'primary'}>
            <span className="inline-flex items-center gap-1.5">
              {buildingPatterns
                ? <><RefreshCw size={14} className="animate-spin" /> Construyendo...</>
                : patterns.length
                  ? <><RefreshCw size={14} /> Reconstruir</>
                  : <><Activity size={14} /> Construir patrones históricos</>}
            </span>
          </Button>
        </div>
        {rainCoef !== 1.25 && (
          <p className="text-xs text-accent bg-accent-bg border border-accent/30 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
            <Cloud size={14} /> Coeficiente lluvia calculado: <strong>{rainCoef}x</strong> (+{Math.round((rainCoef-1)*100)}% de pedidos en días de lluvia)
          </p>
        )}
      </div>

      {log.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 max-h-36 overflow-y-auto">
          {log.map((l, i) => (
            <p key={i} className={`text-xs font-mono ${l.startsWith('✅')?'text-success':l.startsWith('❌')?'text-danger':'text-text-secondary'}`}>{l}</p>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border-default rounded-xl p-1 w-fit">
        {([
          { v:'prediccion', l:'Predicción semanal', Icon: Calendar },
          { v:'historico',  l:'Histórico mensual', Icon: BarChart3 },
          { v:'ajustes',    l:'Ajustes', Icon: Settings },
        ] as const).map(({ v, l, Icon }) => (
          <button key={v} onClick={() => setTab(v)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-base ${tab===v?'bg-accent text-text-on-accent':'text-text-secondary hover:bg-accent-bg'}`}>
            <Icon size={14} /> {l}
          </button>
        ))}
      </div>

      {/* ── PREDICCIÓN SEMANAL ─────────────────────────────────────────────── */}
      {tab === 'prediccion' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-card border border-border-default rounded-xl p-1">
              <button onClick={() => setWeekOffset(w => w - 1)} className="px-3 py-1.5 text-sm text-text-secondary hover:bg-accent-bg rounded-lg">
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 text-sm font-medium min-w-[180px] text-center text-text-primary">
                {weekOffset === 0 ? 'Esta semana' : weekOffset === 1 ? 'Próxima semana' : `En ${weekOffset} semanas`}
                <span className="block text-[10px] text-text-secondary">{weekStart} → {weekStartNext}</span>
              </span>
              <button onClick={() => setWeekOffset(w => w + 1)} className="px-3 py-1.5 text-sm text-text-secondary hover:bg-accent-bg rounded-lg">
                <ChevronRight size={16} />
              </button>
            </div>
            <Button onClick={predictWeek} disabled={loading || !patterns.length}>
              <span className="inline-flex items-center gap-1.5">
                {loading ? <><RefreshCw size={14} className="animate-spin" /> Calculando...</> : <><Activity size={14} /> Calcular predicción</>}
              </span>
            </Button>
          </div>

          {predictions.length > 0 && (
            <div className="space-y-4">
              {/* Alertas eventos */}
              {predictions.filter(p => p.sportEvent || p.isRainy).map((p, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'bg-danger-bg border-danger/30':p.sportEvent?'bg-warning-bg border-warning/30':'bg-accent-bg border-accent/30'}`}>
                  {p.sportEvent
                    ? <Trophy size={18} className={p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'text-danger':'text-warning'} />
                    : <Cloud size={18} className="text-accent" />}
                  <div>
                    <p className="font-semibold text-text-primary">
                      {p.dayName} {p.date}
                      {p.sportEvent && ` · ${p.sportEvent.competition}: ${p.sportEvent.home} vs ${p.sportEvent.away}`}
                      {p.isRainy && !p.sportEvent && ' · Lluvia prevista'}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">Coeficiente: +{Math.round((p.coeficient-1)*100)}% en pedidos estimados</p>
                  </div>
                </div>
              ))}

              {/* Tabla */}
              <Card>
                <div className="p-4 border-b">
                  <p className="font-semibold">Personal necesario · {weekStart}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{dishesPerWorkerHour} platos/hora · Mín. 1 mediodía · Mín. 2 noche</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border-default bg-page text-xs">
                      <th className="p-3 text-left">Día</th>
                      <th className="p-3 text-center text-amber-600">
                        <span className="inline-flex items-center gap-1 justify-center"><Sun size={14} /> Mediodía</span>
                      </th>
                      <th className="p-3 text-center text-violet-600">
                        <span className="inline-flex items-center gap-1 justify-center"><Moon size={14} /> Noche</span>
                      </th>
                      <th className="p-3 text-center">Platos med.</th>
                      <th className="p-3 text-center">Platos noch.</th>
                      <th className="p-3 text-center">Coef.</th>
                      <th className="p-3 text-center">Fiabilidad</th>
                      <th className="p-3 text-left">Factores</th>
                    </tr></thead>
                    <tbody>
                      {predictions.map((p, i) => (
                        <tr key={i} className={`border-b border-border-default last:border-0 ${p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'bg-danger-bg/40':p.sportEvent?'bg-warning-bg':p.isRainy?'bg-accent-bg':i>=4?'bg-accent-bg/40':''}`}>
                          <td className="p-3"><p className="font-semibold">{p.dayName}</p><p className="text-[10px] text-text-secondary">{p.date}</p></td>
                          <td className="p-3 text-center"><span className="text-2xl font-bold text-amber-700">{p.staffMediadia}</span></td>
                          <td className="p-3 text-center"><span className="text-2xl font-bold text-violet-700">{p.staffNoche}</span></td>
                          <td className="p-3 text-center text-xs text-text-secondary">{p.predictedDishesMediadia||'—'}</td>
                          <td className="p-3 text-center text-xs text-text-secondary">{p.predictedDishesNoche||'—'}</td>
                          <td className="p-3 text-center">{p.coeficient>1?<span className="text-xs font-bold text-amber-600">x{p.coeficient}</span>:<span className="text-xs text-text-secondary">x1</span>}</td>
                          <td className="p-3 text-center"><ConfBadge c={p.confidence}/></td>
                          <td className="p-3 text-xs text-text-secondary">{p.coefReason.join(' · ')||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Resumen visual */}
              <div className="grid grid-cols-7 gap-1.5">
                {predictions.map((p, i) => (
                  <div key={i} className={`p-2 rounded-xl border text-center space-y-1 ${p.sportEvent?.isElClasico||p.sportEvent?.isDerbi?'border-danger/30 bg-danger-bg':p.sportEvent?'border-warning/30 bg-warning-bg':p.isRainy?'border-accent/30 bg-accent-bg':i>=4?'border-accent bg-accent-bg':'border-border-default bg-card'}`}>
                    <p className="text-xs font-bold text-text-secondary">{DAY_SHORT[i]}</p>
                    {(p.sportEvent||p.isRainy) && (
                      <div className="flex justify-center">
                        {p.sportEvent
                          ? <Trophy size={12} className={p.sportEvent?.isElClasico?'text-danger':'text-warning'} />
                          : <Cloud size={12} className="text-accent" />}
                      </div>
                    )}
                    <div className="text-amber-600"><p className="text-lg font-bold leading-none">{p.staffMediadia}</p><p className="text-[8px]">mediodía</p></div>
                    <div className="text-violet-600"><p className="text-lg font-bold leading-none">{p.staffNoche}</p><p className="text-[8px]">noche</p></div>
                  </div>
                ))}
              </div>

              {/* Generar calendario */}
              <Card className="p-5 space-y-4">
                <div>
                  <p className="font-semibold text-text-primary">Generar calendario de horarios</p>
                  <p className="text-xs text-text-secondary mt-0.5">Usa esta predicción para asignar turnos reales a los trabajadores</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { mode:'alert' as PredictionMode, Icon: AlertTriangle, label:'Solo avisar', desc:'Genera con mínimos base y señala los días con cobertura insuficiente' },
                    { mode:'reorganize' as PredictionMode, Icon: RefreshCw, label:'Reorganizar', desc:'Redistribuye descansos automáticamente para cubrir los días con déficit' },
                    { mode:'generate' as PredictionMode, Icon: Activity, label:'Generar completo', desc:'Genera con los mínimos de la predicción y marca en rojo los problemas' },
                  ] as const).map(opt => {
                    const OptIcon = opt.Icon
                    return (
                      <button key={opt.mode} onClick={() => setGenMode(opt.mode)}
                        className={`p-3 rounded-xl border-2 text-left transition-base ${genMode===opt.mode?'border-accent bg-accent-bg':'border-border-default hover:border-accent'}`}>
                        <OptIcon size={18} className="text-accent mb-1" />
                        <p className="text-sm font-semibold text-text-primary">{opt.label}</p>
                        <p className="text-[10px] text-text-secondary mt-0.5">{opt.desc}</p>
                      </button>
                    )
                  })}
                </div>
                <Button onClick={generateCalendar} disabled={generating} className="w-full">
                  <span className="inline-flex items-center justify-center gap-1.5">
                    {generating
                      ? <><RefreshCw size={14} className="animate-spin" /> Generando...</>
                      : <>
                          {genMode==='alert' ? <AlertTriangle size={14} /> : genMode==='reorganize' ? <RefreshCw size={14} /> : <Activity size={14} />}
                          Generar horario para {weekStart}
                        </>}
                  </span>
                </Button>
                {genResult && (
                  <div className="space-y-2">
                    {genResult.coverageIssues.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-danger inline-flex items-center gap-1">
                          <AlertTriangle size={12} /> {genResult.coverageIssues.length} problema(s) de cobertura:
                        </p>
                        {genResult.coverageIssues.map((issue: any, i: number) => (
                          <div key={i} className="p-2 bg-danger-bg border border-danger/30 rounded-lg text-xs text-danger inline-flex items-center gap-1.5 flex-wrap">
                            <strong>{issue.dayName}</strong>
                            {issue.turno==='noche' ? <Moon size={12} /> : <Sun size={12} />}
                            <span>{issue.turno==='noche' ? 'noche' : 'mediodía'}: necesitas {issue.needed}, disponibles {issue.available} (faltan {issue.deficit})</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-success bg-success-bg border border-success/30 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> Cobertura completa · Horario guardado en <strong>Calendario de Horarios</strong>
                      </p>
                    )}
                    {genResult.reorganizationsApplied.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-accent inline-flex items-center gap-1"><RefreshCw size={12} /> Reorganizaciones:</p>
                        {genResult.reorganizationsApplied.map((r: string, i: number) => (
                          <p key={i} className="text-xs text-accent bg-accent-bg px-2 py-1 rounded">{r}</p>
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
              <div className="flex justify-center mb-2"><Calendar size={32} className="text-accent" /></div>
              <p className="text-text-secondary text-sm">Selecciona la semana y pulsa Calcular predicción</p>
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
            <p className="text-xs text-text-secondary">{patternsFiltered.length} patrones</p>
          </div>
          {patterns.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="flex justify-center mb-2"><BarChart3 size={32} className="text-accent" /></div>
              <p className="text-text-secondary text-sm">Construye los patrones históricos primero</p>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border-default bg-page text-text-secondary">
                      <th className="p-3 text-left">Mes</th><th className="p-3 text-left">Día</th>
                      <th className="p-3 text-center">Platos med.</th><th className="p-3 text-center">Platos noch.</th>
                      <th className="p-3 text-center">Normalizado</th><th className="p-3 text-center">Muestras</th>
                      <th className="p-3 text-center"><Trophy size={12} className="inline" /></th>
                      <th className="p-3 text-center"><Cloud size={12} className="inline" /></th>
                    </tr></thead>
                    <tbody>
                      {patternsFiltered.map((p, i) => (
                        <tr key={i} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                          <td className="p-3 font-medium text-text-primary">{p.monthName}</td>
                          <td className="p-3 text-text-primary">{p.dayName}</td>
                          <td className="p-3 text-center font-semibold text-amber-600">{p.avgDishesMediadia}</td>
                          <td className="p-3 text-center font-semibold text-violet-600">{p.avgDishesNoche}</td>
                          <td className="p-3 text-center text-text-secondary">{p.avgDishesNormalized}</td>
                          <td className="p-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${p.samples>=8?'bg-success-bg text-success':p.samples>=4?'bg-warning-bg text-warning':'bg-page text-text-secondary'}`}>{p.samples}</span>
                          </td>
                          <td className="p-3 text-center">{p.sportEventDays>0?<span className="text-amber-600 font-medium">{p.sportEventDays}</span>:'—'}</td>
                          <td className="p-3 text-center">{p.rainyDays>0?<span className="text-accent font-medium">{p.rainyDays}</span>:'—'}</td>
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
                      <th className="p-1.5 text-left text-text-secondary w-16">Mes</th>
                      {['L','M','X','J','V','S','D'].map(d=><th key={d} className="p-1.5 text-center text-text-secondary w-14">{d}</th>)}
                    </tr></thead>
                    <tbody>
                      {Array.from({length:12},(_,mi)=>mi+1).map(month=>{
                        const row = Array.from({length:7},(_,dow)=>patterns.find(p=>p.month===month&&p.dayOfWeek===dow))
                        if(row.every(p=>!p)) return null
                        const maxD = Math.max(...patterns.map(p=>p.avgDishesNoche),1)
                        return (
                          <tr key={month} className="border-b last:border-0">
                            <td className="p-1.5 font-medium text-text-secondary">{MONTH_NAMES[month-1]}</td>
                            {row.map((p,dow)=>{
                              const pct = p?p.avgDishesNoche/maxD:0
                              const bg = pct>0.8?'bg-violet-600 text-white':pct>0.6?'bg-violet-400 text-white':pct>0.4?'bg-violet-200 text-violet-800':pct>0?'bg-violet-100 text-violet-600':'bg-page text-text-secondary'
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
            <p className="font-semibold text-text-primary">Ratio de producción</p>
            <div>
              <label className="text-xs font-medium text-text-secondary uppercase">Platos por trabajador por hora</label>
              <div className="flex items-center gap-3 mt-2">
                <input type="range" min={8} max={25} step={1} value={dishesPerWorkerHour}
                  onChange={e => setDishesPerWorkerHour(parseInt(e.target.value))} className="flex-1 accent-accent"/>
                <span className="font-bold text-lg text-accent w-16 text-center">{dishesPerWorkerHour}/h</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                <div className="p-2 bg-page rounded-lg border border-border-default"><p className="font-bold text-amber-600">{Math.ceil(dishesPerWorkerHour*3.5)}</p><p className="text-text-secondary">platos/trabajador mediodía</p></div>
                <div className="p-2 bg-page rounded-lg border border-border-default"><p className="font-bold text-violet-600">{Math.ceil(dishesPerWorkerHour*4.5)}</p><p className="text-text-secondary">platos/trabajador noche</p></div>
                <div className="p-2 bg-page rounded-lg border border-border-default"><p className="font-bold text-text-secondary">mín. 2</p><p className="text-text-secondary">siempre en noche</p></div>
              </div>
            </div>
          </Card>
          <Card className="p-5 space-y-3">
            <p className="font-semibold text-text-primary">Coeficientes de eventos deportivos</p>
            {[
              { label:'Clásico (vs Barcelona)', val:40, Icon: Trophy },
              { label:'Derbi (vs Atlético)', val:35, Icon: Trophy },
              { label:'Champions eliminatoria', val:30, Icon: Trophy },
              { label:'Real Madrid en casa', val:20, Icon: Trophy },
              { label:'Real Madrid visitante', val:15, Icon: Trophy },
            ].map(item=>{
              const ItemIcon = item.Icon
              return (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-xs text-text-primary inline-flex items-center gap-1.5">
                    <ItemIcon size={12} className="text-warning" /> {item.label}
                  </span>
                  <span className="text-xs font-bold text-accent">+{item.val}%</span>
                </div>
              )
            })}
          </Card>
          <Card className="p-5 space-y-3">
            <p className="font-semibold text-text-primary inline-flex items-center gap-1.5">
              <Cloud size={16} className="text-accent" /> Coeficiente de lluvia
            </p>
            <div className="p-3 bg-accent-bg border border-accent/30 rounded-xl">
              <p className="text-2xl font-bold text-accent">{rainCoef}x</p>
              <p className="text-xs text-accent mt-0.5">
                {rainCoef>1?`+${Math.round((rainCoef-1)*100)}% de pedidos en días de lluvia (calculado del histórico)`:'Construye los patrones para calcular'}
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
