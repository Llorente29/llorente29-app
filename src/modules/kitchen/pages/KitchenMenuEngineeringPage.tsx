// src/modules/kitchen/pages/KitchenMenuEngineeringPage.tsx
//
// Ingeniería de menús: la matriz de Folvy. Cruza margen real × ventas reales
// y dice, plato a plato, qué hacer y cuánto se gana.
//
// Diseño dual (una pantalla, dos lenguajes):
//   - Modo CLARO (default): tarjetas por cuadrante con acción en lenguaje
//     llano + precio objetivo exacto + upside €/mes. Para cualquiera.
//   - Modo MATRIZ: scatter con cuadrantes y medias dinámicas. Para el analítico.
//
// El selector de canal reaplica computeEngineering sobre el subconjunto, así
// que las medias de corte se reajustan al vuelo (un plato salta de cuadrante
// entre canales). Sin ir a BBDD en cada filtro.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { TrendingUp, Star, Activity, Puzzle, Trash2, ChevronDown } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import {
  computeEngineering,
  getMenuItemUnitsSold,
} from '@/modules/kitchen/services/menuEngineeringService'
import { getMenuItemEconomics } from '@/modules/kitchen/services/menuItemService'
import type {
  MenuEngineeringResult,
  MenuEngineeringItem,
  MenuQuadrant,
  MenuItemUnitsSold,
} from '@/modules/kitchen/services/menuEngineeringService'
import type { MenuItemEconomics } from '@/types/kitchen'
import type { Brand } from '@/types/multitenancy'

type PeriodDays = 30 | 90 | 365

function formatEur(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function formatEur0(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

const QUADRANT_META: Record<MenuQuadrant, { label: string; color: string; bg: string; border: string }> = {
  star:      { label: 'Estrellas',          color: 'text-success', bg: 'bg-success-bg', border: 'border-success/40' },
  plowhorse: { label: 'Caballos de batalla', color: 'text-warning', bg: 'bg-warning-bg', border: 'border-warning/40' },
  puzzle:    { label: 'Tesoros escondidos',  color: 'text-accent',  bg: 'bg-accent-bg',  border: 'border-accent/30' },
  dog:       { label: 'Lastres',             color: 'text-danger',  bg: 'bg-danger-bg',  border: 'border-danger/30' },
}

export default function KitchenMenuEngineeringPage() {
  const { activeAccountId } = useActiveAccount()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodDays>(90)
  const [channelId, setChannelId] = useState<string>('all')
  const [view, setView] = useState<'clear' | 'matrix'>('clear')

  const [economics, setEconomics] = useState<MenuItemEconomics[]>([])
  const [salesById, setSalesById] = useState<Map<string, MenuItemUnitsSold>>(new Map())
  const [loadingBrands, setLoadingBrands] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Marcas
  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setLoadingBrands(true)
    listBrands({ accountId: activeAccountId })
      .then(data => {
        if (cancelled) return
        const active = data.filter(b => b.isActive)
        setBrands(active)
        if (active.length > 0) setBrandId(prev => prev ?? active[0].id)
        setLoadingBrands(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando marcas')
        setLoadingBrands(false)
      })
    return () => { cancelled = true }
  }, [activeAccountId])

  // Datos crudos (economics + ventas) de la marca/periodo. El filtro de canal
  // NO recarga: se aplica en cliente sobre estos crudos.
  useEffect(() => {
    if (!brandId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setChannelId('all')
    Promise.all([
      getMenuItemEconomics(brandId),
      getMenuItemUnitsSold(brandId, isoDaysAgo(period), new Date().toISOString()),
    ])
      .then(([eco, sales]) => {
        if (cancelled) return
        setEconomics(eco)
        setSalesById(new Map(sales.map(s => [s.menuItemId, s])))
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error calculando ingeniería de menús')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [brandId, period])

  // Canales presentes en los datos (para el selector)
  const channels = useMemo(() => {
    const map = new Map<string, string>()
    economics.forEach(e => { if (!map.has(e.channelId)) map.set(e.channelId, e.channelName) })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [economics])

  // Cálculo de la matriz sobre el subconjunto filtrado por canal. Las medias
  // se recalculan aquí → al cambiar de canal, los platos se reclasifican.
  const result: MenuEngineeringResult = useMemo(() => {
    const eco = channelId === 'all' ? economics : economics.filter(e => e.channelId === channelId)
    return computeEngineering(eco, salesById)
  }, [economics, salesById, channelId])

  const byQuadrant = useMemo(() => {
    const groups: Record<MenuQuadrant, MenuEngineeringItem[]> = { star: [], plowhorse: [], puzzle: [], dog: [] }
    result.items.forEach(it => groups[it.quadrant].push(it))
    // Caballos y lastres: por upside recuperable desc (dónde está el dinero).
    // Estrellas: por contribución total desc (los motores arriba).
    // Puzzles: por margen/ud desc (el oro más puro arriba).
    groups.plowhorse.sort((a, b) => b.recoverableMonthly - a.recoverableMonthly)
    groups.dog.sort((a, b) => b.recoverableMonthly - a.recoverableMonthly)
    groups.star.sort((a, b) => b.totalContribution - a.totalContribution)
    groups.puzzle.sort((a, b) => b.contributionMargin - a.contributionMargin)
    return groups
  }, [result])

  const selectedBrand = brands.find(b => b.id === brandId) ?? null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <TrendingUp size={20} className="text-accent shrink-0" />
        <h1 className="text-xl font-semibold text-text-primary">Ingeniería de menús</h1>
      </div>

      {/* Controles */}
      <div className="flex items-center gap-3 flex-wrap">
        <Selector label="Marca" value={brandId ?? ''} disabled={loadingBrands || brands.length === 0}
          onChange={v => setBrandId(v || null)}
          options={brands.map(b => ({ value: b.id, label: b.name }))} />
        <Selector label="Periodo" value={String(period)}
          onChange={v => setPeriod(Number(v) as PeriodDays)}
          options={[{ value: '30', label: '30 días' }, { value: '90', label: '90 días' }, { value: '365', label: '1 año' }]} />
        <Selector label="Canal" value={channelId}
          onChange={v => setChannelId(v)}
          options={[{ value: 'all', label: 'Todos' }, ...channels.map(c => ({ value: c.id, label: c.name }))]} />

        {/* Toggle claro / matriz */}
        <div className="ml-auto inline-flex rounded-md border border-border-default overflow-hidden">
          <button type="button" onClick={() => setView('clear')}
            className={`px-3 py-1.5 text-sm ${view === 'clear' ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:bg-page'}`}>
            Claro
          </button>
          <button type="button" onClick={() => setView('matrix')}
            className={`px-3 py-1.5 text-sm ${view === 'matrix' ? 'bg-accent text-text-on-accent' : 'bg-card text-text-secondary hover:bg-page'}`}>
            Matriz
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {/* Franja de resumen */}
      {!loading && result.items.length > 0 && (
        <div className="bg-card border border-border-default rounded-xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <SummaryStat icon={<Star size={15} />} label="Estrellas" value={byQuadrant.star.length} tone="success" />
            <SummaryStat icon={<Activity size={15} />} label="Caballos de batalla" value={byQuadrant.plowhorse.length} tone="warning" />
            <SummaryStat icon={<Puzzle size={15} />} label="Tesoros escondidos" value={byQuadrant.puzzle.length} tone="accent" />
            <SummaryStat icon={<Trash2 size={15} />} label="Lastres" value={byQuadrant.dog.length} tone="danger" />
          </div>
          {result.totalRecoverableMonthly > 0 && (
            <p className="text-sm text-text-primary">
              Subiendo los platos por debajo del margen medio hasta la media, ganarías unos{' '}
              <span className="font-semibold text-warning">{formatEur0(result.totalRecoverableMonthly)}/mes</span>
              <span className="text-text-secondary"> — estimación que asume que mantienes el volumen de ventas.</span>
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="bg-card border border-border-default rounded-xl p-8 text-center text-sm text-text-secondary">
          Cruzando coste real con ventas reales…
        </div>
      ) : result.items.length === 0 ? (
        <div className="bg-card border border-border-default rounded-xl p-8 text-center text-sm text-text-secondary">
          {selectedBrand ? 'No hay platos con coste y ventas en este periodo y canal.' : 'Selecciona una marca.'}
        </div>
      ) : view === 'matrix' ? (
        <MatrixView result={result} />
      ) : (
        <div className="space-y-4">
          {(['plowhorse', 'puzzle', 'star', 'dog'] as MenuQuadrant[]).map(q => (
            byQuadrant[q].length > 0 && (
              <QuadrantBlock key={q} quadrant={q} items={byQuadrant[q]} />
            )
          ))}
        </div>
      )}

      {/* Excluidos: honestidad sobre qué no entra */}
      {!loading && (result.excludedNoCost.length + result.excludedNoSales.length + result.excludedLicensed.length) > 0 && (
        <p className="text-xs text-text-secondary">
          Fuera de la matriz:{' '}
          {result.excludedNoCost.length > 0 && <>{result.excludedNoCost.length} sin coste (completa su escandallo) · </>}
          {result.excludedNoSales.length > 0 && <>{result.excludedNoSales.length} sin ventas en el periodo · </>}
          {result.excludedLicensed.length > 0 && <>{result.excludedLicensed.length} cedidos (sin food cost propio)</>}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Bloque de cuadrante (modo claro)
// ─────────────────────────────────────────────────────────────────────
function QuadrantBlock({ quadrant, items }: { quadrant: MenuQuadrant; items: MenuEngineeringItem[] }) {
  const meta = QUADRANT_META[quadrant]
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
        <span className="text-xs text-text-secondary">({items.length})</span>
      </div>
      <div className="space-y-2">
        {items.map(it => (
          <ActionCard key={`${it.menuItemId}-${it.channelId}`} item={it} quadrant={quadrant} />
        ))}
      </div>
    </div>
  )
}

function actionFor(it: MenuEngineeringItem, quadrant: MenuQuadrant): { headline: string; action: string } {
  const cm = formatEur(it.contributionMargin)
  switch (quadrant) {
    case 'star':
      return {
        headline: `Se vende mucho (${it.unitsSold} uds) y deja buen margen (${cm}/ud). Es tu motor.`,
        action: 'No lo toques. Protégelo y tenlo siempre disponible.',
      }
    case 'plowhorse':
      return {
        headline: `Se vende mucho (${it.unitsSold} uds) pero deja poco margen (${cm}/ud).`,
        action: it.targetPrice !== null
          ? `Sube el precio a ${formatEur(it.targetPrice)} (desde ${formatEur(it.price)}) y pasa a estrella. Ganarías ~${formatEur0(it.recoverableMonthly)}/mes.`
          : 'Renegocia comisión de plataforma o baja el coste del escandallo.',
      }
    case 'puzzle':
      return {
        headline: `Deja muy buen margen (${cm}/ud) pero se pide poco (${it.unitsSold} uds). Oro que no estás enseñando.`,
        action: 'Súbelo arriba en la carta y ponle foto. Cada venta extra es margen casi limpio.',
      }
    case 'dog':
    default:
      return {
        headline: `Se vende poco (${it.unitsSold} uds) y deja poco (${cm}/ud). Ocupa carta sin aportar.`,
        action: it.targetPrice !== null
          ? `Plantéate quitarlo, o súbelo a ${formatEur(it.targetPrice)} si decides mantenerlo.`
          : 'Plantéate retirarlo o rediseñarlo.',
      }
  }
}

function ActionCard({ item, quadrant }: { item: MenuEngineeringItem; quadrant: MenuQuadrant }) {
  const meta = QUADRANT_META[quadrant]
  const { headline, action } = actionFor(item, quadrant)
  const Icon = quadrant === 'star' ? Star : quadrant === 'plowhorse' ? Activity : quadrant === 'puzzle' ? Puzzle : Trash2
  return (
    <div className={`rounded-lg border ${meta.border} bg-card p-3`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`mt-0.5 shrink-0 ${meta.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary truncate">{item.menuItemName}</span>
            <span className="text-xs text-text-secondary shrink-0">{item.channelName}</span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">{headline}</p>
          <p className={`mt-1.5 text-sm ${meta.color}`}>{action}</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Vista matriz (scatter en SVG nativo — sin dependencias de gráficos)
// ─────────────────────────────────────────────────────────────────────
function quadrantColor(q: MenuQuadrant): string {
  return q === 'star' ? '#639922' : q === 'plowhorse' ? '#BA7517' : q === 'puzzle' ? '#1e3a5f' : '#A32D2D'
}

function MatrixView({ result }: { result: MenuEngineeringResult }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)

  // Lienzo y márgenes
  const W = 680, H = 380
  const padL = 56, padR = 16, padT = 16, padB = 44
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const maxUnits = Math.max(...result.items.map(i => i.unitsSold), 1)
  const maxMargin = Math.max(...result.items.map(i => i.contributionMargin), 1)
  // Holgura del 8% arriba para que los puntos no toquen el borde
  const xMax = maxUnits * 1.08
  const yMax = maxMargin * 1.08

  const sx = (u: number) => padL + (u / xMax) * plotW
  const sy = (m: number) => padT + plotH - (m / yMax) * plotH

  const mx = sx(result.avgUnitsSold)
  const my = sy(result.avgContributionMargin)

  return (
    <div className="bg-card border border-border-default rounded-xl p-3">
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
          aria-label="Matriz de platos por popularidad (eje X) y margen por unidad (eje Y), dividida en cuatro cuadrantes por las medias.">
          {/* Fondos de cuadrante (medias como divisorias) */}
          <rect x={mx} y={padT} width={padL + plotW - mx} height={my - padT} fill="#639922" opacity="0.06" />
          <rect x={padL} y={padT} width={mx - padL} height={my - padT} fill="#1e3a5f" opacity="0.06" />
          <rect x={mx} y={my} width={padL + plotW - mx} height={padT + plotH - my} fill="#BA7517" opacity="0.06" />
          <rect x={padL} y={my} width={mx - padL} height={padT + plotH - my} fill="#A32D2D" opacity="0.06" />

          {/* Ejes */}
          <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#e0ddd6" strokeWidth="1" />
          <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#e0ddd6" strokeWidth="1" />

          {/* Líneas de media (dinámicas) */}
          <line x1={mx} y1={padT} x2={mx} y2={padT + plotH} stroke="#888780" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
          <line x1={padL} y1={my} x2={padL + plotW} y2={my} stroke="#888780" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />

          {/* Títulos de ejes */}
          <text x={padL + plotW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b6760">
            Unidades vendidas  →  popularidad
          </text>
          <text x={16} y={padT + plotH / 2} textAnchor="middle" fontSize="11" fill="#6b6760"
            transform={`rotate(-90 16 ${padT + plotH / 2})`}>
            Margen por unidad (€)  →  rentabilidad
          </text>

          {/* Puntos */}
          {result.items.map(it => {
            const cx = sx(it.unitsSold)
            const cy = sy(it.contributionMargin)
            return (
              <circle key={`${it.menuItemId}-${it.channelId}`}
                cx={cx} cy={cy} r="6"
                fill={quadrantColor(it.quadrant)}
                opacity="0.85"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover({ x: cx, y: cy, text: `${it.menuItemName}: ${it.unitsSold} uds · ${it.contributionMargin.toFixed(2)} €/ud` })}
                onMouseLeave={() => setHover(null)}
              />
            )
          })}
        </svg>

        {hover && (
          <div
            className="absolute px-2 py-1 rounded-md bg-text-primary text-text-on-accent text-xs pointer-events-none whitespace-nowrap"
            style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, transform: 'translate(-50%, -130%)' }}
          >
            {hover.text}
          </div>
        )}
      </div>
      <div className="flex gap-4 flex-wrap mt-2 px-1 text-xs text-text-secondary">
        <Legend color="#639922" label="Estrella" />
        <Legend color="#BA7517" label="Caballo de batalla" />
        <Legend color="#1e3a5f" label="Tesoro escondido" />
        <Legend color="#A32D2D" label="Lastre" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponentes UI
// ─────────────────────────────────────────────────────────────────────
function Selector({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-text-secondary">{label}</label>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          className="appearance-none pl-3 pr-9 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 min-w-[140px]">
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
      </div>
    </div>
  )
}

function SummaryStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'success' | 'warning' | 'accent' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'accent' ? 'text-accent' : 'text-danger'
  return (
    <div className="flex items-center gap-2">
      <span className={toneClass}>{icon}</span>
      <div>
        <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
        <p className="text-xs text-text-secondary leading-tight">{label}</p>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
