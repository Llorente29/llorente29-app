// src/modules/kitchen/pages/KitchenDashboardPage.tsx
//
// Dashboard "Resumen" de Folvy Kitchen — pantalla de inicio del módulo.
// D2b: tira de KPIs (navy de marca) + "Necesita tu atención" (clicable) +
// salud del food cost + ingeniería de menús + margen por canal y por marca.
//
// Diseño fijado para todo Kitchen: tira "en vivo" en navy (bg-accent), tokens
// reales (sin hex), lenguaje de color único (verde sano / ámbar ajustado /
// rojo pierde / terracota oportunidad) y TODO clicable → salta a su sección.
//
// Honestidad: solo se pinta lo que tiene fuente real hoy. "Movimientos de
// precio" y "alérgenos automáticos" se declaran pendientes (no se inventan).
// Datos mock hasta cargar los definitivos de cada cliente.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  CircleDollarSign,
  Loader,
  Flame,
  ImageOff,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getKitchenDashboard } from '@/modules/kitchen/services/kitchenDashboardService'
import type { KitchenDashboardData } from '@/modules/kitchen/services/kitchenDashboardService'

// ── Formatters ──────────────────────────────────────────────────────
function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1)}%`
}
function formatEur0(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value)
}

export default function KitchenDashboardPage() {
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()

  const [data, setData] = useState<KitchenDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getKitchenDashboard({ accountId: activeAccountId })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando el resumen')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeAccountId])

  // Nº de platos con coste real (denominador honesto de la media de food cost).
  const costedDishes = data
    ? data.foodCostHealth.healthy + data.foodCostHealth.tight + data.foodCostHealth.over
    : 0

  // Filas de "Necesita tu atención" con dato real; solo se muestran las que > 0.
  const attentionRows = data
    ? [
        {
          key: 'raws_no_cost',
          count: data.attention.rawsWithoutCost,
          label: 'ingredientes sin coste',
          sub: 'les falta proveedor o precio',
          tone: 'warning' as const,
          icon: CircleDollarSign,
          onClick: () => navigate('../'),            // Ingredientes (índice del módulo)
        },
        {
          key: 'recipes_unfinished',
          count: data.attention.recipesUnfinished,
          label: 'recetas sin terminar',
          sub: 'su coste aún no es fiable',
          tone: 'warning' as const,
          icon: Loader,
          onClick: () => navigate('../recetas'),
        },
        {
          key: 'over_target',
          count: data.attention.dishesOverTarget,
          label: 'platos sobre el food cost objetivo',
          sub: 'se comen tu margen',
          tone: 'danger' as const,
          icon: Flame,
          onClick: () => navigate('../rentabilidad'),
        },
        {
          key: 'no_photo',
          count: data.attention.dishesWithoutPhoto,
          label: 'platos sin foto',
          sub: 'venden peor en delivery',
          tone: 'neutral' as const,
          icon: ImageOff,
          onClick: () => navigate('../recetas'),
        },
      ].filter(r => r.count > 0)
    : []

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div>
        <div className="flex items-center gap-2">
          <LayoutDashboard size={20} className="text-accent shrink-0" />
          <h1 className="text-xl font-semibold text-text-primary">Resumen de cocina</h1>
        </div>
        <p className="text-sm text-text-secondary mt-1">
          Cómo va tu carta y qué necesita tu atención.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {/* Tira de estado del módulo (navy de marca) */}
      {loading ? (
        <div className="bg-accent rounded-xl p-6 text-center text-sm text-accent-bg">
          Cargando resumen…
        </div>
      ) : data ? (
        <>
          <div className="bg-accent rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiNavy
              label="Food cost medio"
              value={formatPct(data.kpis.avgFoodCostPct)}
              hint={`sobre ${costedDishes} de ${data.foodCostHealth.total} platos con coste`}
            />
            <KpiNavy label="Margen medio" value={formatPct(data.kpis.avgNetMarginPct)} />
            <KpiNavy
              label="Margen (30 días)"
              value={formatEur0(data.kpis.monthlyMarginEur)}
              hint="sobre ventas reales"
            />
            <KpiNavy
              label="Platos · ingredientes"
              value={`${data.kpis.dishCount} · ${data.kpis.rawCount}`}
            />
          </div>

          {/* Necesita tu atención + (salud / ingeniería) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4">
            {/* Necesita tu atención */}
            <section>
              <h2 className="text-xs uppercase tracking-wide text-text-secondary mb-2">
                Necesita tu atención
              </h2>
              {attentionRows.length === 0 ? (
                <div className="flex items-center gap-2 p-4 rounded-xl bg-success-bg text-success border border-success/20 text-sm">
                  <CheckCircle2 size={18} className="shrink-0" />
                  Todo en orden por aquí. Nada pendiente de revisar.
                </div>
              ) : (
                <div className="space-y-2">
                  {attentionRows.map(({ key, ...rest }) => (
                    <AttentionRow key={key} {...rest} />
                  ))}
                </div>
              )}
            </section>

            {/* Salud food cost + Ingeniería */}
            <div className="space-y-4">
              <FoodCostHealthCard health={data.foodCostHealth} />
              <EngineeringCard q={data.quadrants} />
            </div>
          </div>

          {/* Margen por canal + por marca */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MarginListCard
              title="Margen por canal"
              rows={data.byChannel.map(c => ({ id: c.channelId, name: c.channelName, pct: c.avgNetMarginPct }))}
            />
            <MarginListCard
              title="Margen por marca"
              rows={data.byBrand.map(b => ({
                id: b.brandId,
                name: b.brandName,
                pct: b.avgNetMarginPct,
                tag: b.ownershipType === 'licensed' ? 'cedida' : undefined,
              }))}
            />
          </div>

          {/* Leyenda del lenguaje de color */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
            <LegendDot className="bg-success" label="sano" />
            <LegendDot className="bg-warning" label="ajustado" />
            <LegendDot className="bg-danger" label="pierde" />
            <LegendDot className="bg-terracota" label="oportunidad" />
          </div>

          {/* Honestidad: lo que aún no tiene fuente */}
          <p className="text-xs text-text-secondary border-t border-border-default pt-3">
            Pendiente de cablear: movimientos de precio (7 días) y alérgenos automáticos —
            el dato base existe pero aún no se calcula. Las cifras son de ejemplo hasta
            cargar los datos definitivos.
          </p>
        </>
      ) : null}
    </div>
  )
}

// ── KPI sobre navy de marca ──────────────────────────────────────────
function KpiNavy({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2 py-1">
      <p className="text-xs text-accent-bg/80">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-card">{value}</p>
      {hint && <p className="text-[11px] text-accent-bg/70 mt-0.5">{hint}</p>}
    </div>
  )
}

// ── Fila de "Necesita tu atención" (clicable → su sección) ───────────
interface AttentionRowProps {
  count: number
  label: string
  sub: string
  tone: 'warning' | 'danger' | 'neutral'
  icon: React.ComponentType<{ size?: number }>
  onClick: () => void
}
function AttentionRow({ count, label, sub, tone, icon: Icon, onClick }: AttentionRowProps) {
  const iconWrap =
    tone === 'danger'
      ? 'bg-danger-bg text-danger'
      : tone === 'warning'
        ? 'bg-warning-bg text-warning'
        : 'bg-page text-text-secondary'
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border-default text-left hover:bg-page transition-base"
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconWrap}`}>
        <Icon size={16} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-sm font-medium text-text-primary">{count} {label}</span>
        <span className="block text-xs text-text-secondary">{sub}</span>
      </span>
      <ChevronRight size={16} className="text-text-secondary shrink-0" />
    </button>
  )
}

// ── Salud del food cost ──────────────────────────────────────────────
function FoodCostHealthCard({ health }: { health: KitchenDashboardData['foodCostHealth'] }) {
  const total = Math.max(health.total, 1)
  const seg = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="bg-card border border-border-default rounded-xl p-3">
      <h3 className="text-sm font-medium text-text-primary mb-2.5">Salud del food cost</h3>
      <div className="flex h-3 rounded-full overflow-hidden bg-page">
        {health.healthy > 0 && <div className="bg-success" style={{ width: seg(health.healthy) }} />}
        {health.tight > 0 && <div className="bg-warning" style={{ width: seg(health.tight) }} />}
        {health.over > 0 && <div className="bg-danger" style={{ width: seg(health.over) }} />}
      </div>
      <div className="flex justify-between text-xs text-text-secondary mt-2">
        <span><b className="text-text-primary font-medium">{health.healthy}</b> sanos</span>
        <span><b className="text-text-primary font-medium">{health.tight}</b> ajustados</span>
        <span><b className="text-text-primary font-medium">{health.over}</b> pierden</span>
      </div>
      {health.noData > 0 && (
        <p className="text-[11px] text-text-secondary mt-1.5">
          {health.noData} sin coste/objetivo todavía
        </p>
      )}
    </div>
  )
}

// ── Ingeniería de menús ──────────────────────────────────────────────
function EngineeringCard({ q }: { q: KitchenDashboardData['quadrants'] }) {
  return (
    <div className="bg-card border border-border-default rounded-xl p-3">
      <h3 className="text-sm font-medium text-text-primary mb-2.5">Ingeniería de menús</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <QuadrantRow className="bg-success" label="Estrellas" value={q.star} />
        <QuadrantRow className="bg-terracota" label="Puzzles" value={q.puzzle} />
        <QuadrantRow className="bg-warning" label="Vacas" value={q.plowhorse} />
        <QuadrantRow className="bg-danger" label="Perros" value={q.dog} />
      </div>
      {q.totalRecoverableMonthly > 0 && (
        <p className="text-[11px] text-text-secondary mt-2.5">
          Subiendo los flojos al margen medio: ~{formatEur0(q.totalRecoverableMonthly)}/mes recuperables.
        </p>
      )}
    </div>
  )
}
function QuadrantRow({ className, label, value }: { className: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${className}`} />
      <span className="text-text-secondary">{label}</span>
      <b className="ml-auto font-medium tabular-nums text-text-primary">{value}</b>
    </div>
  )
}

// ── Lista de márgenes (canal / marca) ────────────────────────────────
interface MarginRow { id: string; name: string; pct: number | null; tag?: string }
function MarginListCard({ title, rows }: { title: string; rows: MarginRow[] }) {
  return (
    <div className="bg-card border border-border-default rounded-xl p-3">
      <h3 className="text-sm font-medium text-text-primary mb-2.5">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-text-secondary">Sin datos todavía.</p>
      ) : (
        <div className="text-sm">
          {rows.map(r => (
            <div key={r.id} className="flex justify-between items-center py-1.5 border-b border-border-default last:border-0">
              <span className="text-text-primary truncate">
                {r.name}
                {r.tag && <span className="ml-1.5 text-[10px] text-text-secondary">{r.tag}</span>}
              </span>
              <span className={`tabular-nums ${marginToneClass(r.pct)}`}>{formatPct(r.pct)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function marginToneClass(pct: number | null): string {
  if (pct === null) return 'text-text-secondary'
  if (pct >= 50) return 'text-success'
  if (pct >= 30) return 'text-warning'
  return 'text-danger'
}

// ── Leyenda ───────────────────────────────────────────────────────────
function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${className}`} />
      {label}
    </span>
  )
}
