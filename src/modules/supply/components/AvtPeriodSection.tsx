// src/modules/supply/components/AvtPeriodSection.tsx
//
// AvT POR PERIODO (capa 3+4) — la merma ACUMULADA del periodo, pivotable.
// Llama a avt_period (motor consolidado) y agrupa por local/almacén/familia/
// artículo. Filtro de periodo (presets) + salud del dato. Solo lo medible suma.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShieldCheck, ShieldAlert, ShieldQuestion, TrendingDown } from 'lucide-react'
import {
  getAvtPeriod, groupAvt, avtHealth,
  type AvtItem, type AvtGroupBy,
} from '@/modules/supply/services/avtService'

type PeriodKey = 'month' | 'lastmonth' | '30d' | '90d' | 'quarter'
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'month', label: 'Este mes' }, { key: 'lastmonth', label: 'Mes pasado' },
  { key: '30d', label: '30 días' }, { key: '90d', label: '90 días' }, { key: 'quarter', label: 'Trimestre' },
]
function periodFor(key: PeriodKey): { from: string; to: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString()
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const tomorrow = sod(new Date(now.getTime() + 86400000))
  switch (key) {
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(tomorrow) }
    case 'lastmonth': return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 1)) }
    case '30d': return { from: iso(sod(new Date(now.getTime() - 29 * 86400000))), to: iso(tomorrow) }
    case '90d': return { from: iso(sod(new Date(now.getTime() - 89 * 86400000))), to: iso(tomorrow) }
    case 'quarter': { const q = Math.floor(now.getMonth() / 3) * 3; return { from: iso(new Date(now.getFullYear(), q, 1)), to: iso(tomorrow) } }
  }
}

const GROUPS: { key: AvtGroupBy; label: string }[] = [
  { key: 'local', label: 'Local' }, { key: 'almacen', label: 'Almacén' },
  { key: 'familia', label: 'Familia' }, { key: 'articulo', label: 'Artículo' },
]

const fmtEur = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtQty = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)

export default function AvtPeriodSection({
  accountId, locationId, onError,
}: {
  accountId: string
  locationId: string | null
  onError: (m: string) => void
}) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('month')
  const [groupBy, setGroupBy] = useState<AvtGroupBy>('articulo')
  const [items, setItems] = useState<AvtItem[]>([])
  const [loading, setLoading] = useState(true)

  const period = useMemo(() => periodFor(periodKey), [periodKey])

  useEffect(() => {
    if (!accountId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    getAvtPeriod({ accountId, from: period.from, to: period.to, locationId: locationId || null })
      .then(d => { if (!cancelled) setItems(d) })
      .catch(e => { if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el AvT del periodo.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, period.from, period.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const health = useMemo(() => avtHealth(items), [items])
  const groups = useMemo(() => groupAvt(items, groupBy), [items, groupBy])
  const HealthIcon = health.level === 'good' ? ShieldCheck : health.level === 'partial' ? ShieldAlert : ShieldQuestion
  const healthLabel = health.level === 'good' ? 'Buena' : health.level === 'partial' ? 'Parcial' : 'Sin datos'
  const healthTone = health.level === 'good' ? 'text-success' : health.level === 'partial' ? 'text-warning' : 'text-text-tertiary'

  return (
    <div className="space-y-3">
      {/* Filtros: periodo + agrupación */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PERIODS.map(p => (
            <button key={p.key} type="button" onClick={() => setPeriodKey(p.key)}
              className={`text-xs rounded-md px-2.5 py-1 border transition-base ${periodKey === p.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[11px] text-text-tertiary mr-1">Agrupar por</span>
          {GROUPS.map(g => (
            <button key={g.key} type="button" onClick={() => setGroupBy(g.key)}
              className={`text-xs rounded-md px-2.5 py-1 border transition-base ${groupBy === g.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Salud del dato del periodo */}
      <div className="border border-border-default rounded-lg p-3 bg-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <HealthIcon size={18} className={healthTone} />
            <span className="text-sm font-medium text-text-primary">Fiabilidad: <span className={healthTone}>{healthLabel}</span></span>
          </div>
          <span className={`text-sm font-medium tabular-nums ${health.totalMermaEur < 0 ? 'text-danger' : 'text-text-primary'}`}>
            Merma del periodo: {fmtEur(health.totalMermaEur)}
          </span>
        </div>
        <div className="text-xs text-text-secondary mt-2 leading-relaxed">
          <strong className="text-text-primary">{health.measurable}</strong> artículo{health.measurable === 1 ? '' : 's'} medible{health.measurable === 1 ? '' : 's'} (con conteo de inicio y fin).
          {health.initEstimated > 0 && <> {health.initEstimated} con inicio estimado por apertura.</>}
          {health.datoIncompleto > 0 && <> <span className="text-warning">{health.datoIncompleto} con dato incompleto.</span></>}
          {health.escandalloNoFiable > 0 && <> {health.escandalloNoFiable} sin escandallo fiable.</>}
          {health.sinApertura > 0 && <> {health.sinApertura} sin conteo de inicio (no medibles aún).</>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Calculando el periodo…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          <TrendingDown size={28} className="mx-auto mb-2 text-text-tertiary" />
          No hay conteos cerrados en este periodo para medir desviación. Cierra un conteo dentro del rango para empezar.
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="flex-1">{GROUPS.find(g => g.key === groupBy)?.label}</span>
            {groupBy === 'articulo' && <><span className="w-20 text-right">Inicial</span><span className="w-20 text-right">Compras</span><span className="w-20 text-right">Consumo</span><span className="w-20 text-right">Real</span></>}
            <span className="w-24 text-right">Merma</span>
            <span className="w-24 text-right">Cobertura</span>
          </div>
          {groups.map(g => {
            const detail = groupBy === 'articulo' ? items.find(i => `${i.recipeItemId}|${i.locationId}` === g.key) : null
            return (
              <div key={g.key} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-text-primary truncate">{g.label}{detail?.initEstimated ? <span className="text-[10px] text-warning ml-1.5">inicio estimado</span> : null}</span>
                  {g.sublabel && <span className="block text-[11px] text-text-tertiary truncate">{g.sublabel}</span>}
                </span>
                {groupBy === 'articulo' && detail && (
                  <>
                    <span className="w-20 text-right text-xs text-text-tertiary tabular-nums">{fmtQty(detail.initQty)}</span>
                    <span className="w-20 text-right text-xs text-success tabular-nums">{fmtQty(detail.buysQty)}</span>
                    <span className="w-20 text-right text-xs text-danger tabular-nums">{fmtQty(detail.consumoQty)}</span>
                    <span className="w-20 text-right text-xs text-text-secondary tabular-nums">{fmtQty(detail.realFinal)}{detail.unitAbbr ? ` ${detail.unitAbbr}` : ''}</span>
                  </>
                )}
                <span className={`w-24 text-right text-sm font-medium tabular-nums ${g.mermaEur < 0 ? 'text-danger' : g.mermaEur > 0 ? 'text-success' : 'text-text-tertiary'}`}>
                  {g.measurable > 0 ? fmtEur(g.mermaEur) : '—'}
                </span>
                <span className="w-24 text-right text-[11px] text-text-tertiary tabular-nums">{g.measurable}/{g.total} medible{g.total === 1 ? '' : 's'}</span>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-text-tertiary leading-relaxed">
        Merma del periodo = (inicial + compras − consumo teórico) − conteo real final. Solo los artículos con conteo de inicio y de fin dentro del rango son medibles; el resto se cuenta aparte para que sepas qué te falta contar.
      </p>
    </div>
  )
}
