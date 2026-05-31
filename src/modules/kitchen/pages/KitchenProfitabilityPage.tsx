// src/modules/kitchen/pages/KitchenProfitabilityPage.tsx
//
// Dashboard de rentabilidad de carta (food cost real por plato × canal).
// Capa 1: tabla económica por marca, alimentada por la RPC menu_item_economics
// (getMenuItemEconomics(brandId)). Sin tocar BBDD.
//
// Lee el food cost REAL (escandallo importado de Llorente29) y lo contrasta
// con el target de la cuenta, semaforeando cada fila. Ordena por peor food
// cost primero: lo accionable arriba.
//
// La matriz de ingeniería de menús (popularidad × rentabilidad) es la Capa 2
// y vive aparte (pestaña Ingeniería): requiere el eje de unidades vendidas.
//
// R1.4 (responsive móvil): en escritorio se mantiene la TABLA (Sesión 14); en
// móvil (< 768px), donde una tabla de 6 columnas obliga a arrastrar, cada fila
// se muestra como TARJETA apilada (nombre + chip de food cost + coste/PVP/margen
// etiquetados), sin scroll horizontal. Misma data y mismo orden.

import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, AlertTriangle, ChevronDown } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useIsMobile } from '@/shell/useIsMobile'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { getMenuItemEconomics } from '@/modules/kitchen/services/menuItemService'
import type { Brand } from '@/types/multitenancy'
import type { MenuItemEconomics, FoodCostStatus } from '@/types/kitchen'

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────
function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1)}%`
}

// ─────────────────────────────────────────────────────────────────────
// Semáforo de food cost: clases de token según el estado calculado por la RPC
// ─────────────────────────────────────────────────────────────────────
function foodCostChipClasses(status: FoodCostStatus): string {
  switch (status) {
    case 'under':
      return 'bg-success-bg text-success'
    case 'over':
      return 'bg-danger-bg text-danger'
    case 'no_target':
      return 'bg-accent-bg text-text-primary'
    case 'no_cost':
    case 'n_a':
    default:
      return 'bg-page text-text-secondary'
  }
}

function statusLabel(status: FoodCostStatus): string {
  switch (status) {
    case 'under':
      return 'Bajo objetivo'
    case 'over':
      return 'Sobre objetivo'
    case 'no_target':
      return 'Sin objetivo'
    case 'no_cost':
      return 'Sin coste'
    case 'n_a':
    default:
      return 'N/D'
  }
}

// Orden de severidad para "peor primero": sobre objetivo arriba, luego sin
// coste (incompletos), luego sin objetivo, luego bajo objetivo (lo sano abajo).
const STATUS_SEVERITY: Record<FoodCostStatus, number> = {
  over: 0,
  no_cost: 1,
  n_a: 2,
  no_target: 3,
  under: 4,
}

export default function KitchenProfitabilityPage() {
  const { activeAccountId } = useActiveAccount()
  const isMobile = useIsMobile()

  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [rows, setRows] = useState<MenuItemEconomics[]>([])
  const [loadingBrands, setLoadingBrands] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carga de marcas de la cuenta
  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setLoadingBrands(true)
    listBrands({ accountId: activeAccountId })
      .then(data => {
        if (cancelled) return
        const active = data.filter(b => b.isActive)
        setBrands(active)
        // Preselecciona la primera marca
        if (active.length > 0) setSelectedBrandId(prev => prev ?? active[0].id)
        setLoadingBrands(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando marcas')
        setLoadingBrands(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAccountId])

  // Carga de economics de la marca seleccionada
  useEffect(() => {
    if (!selectedBrandId) return
    let cancelled = false
    setLoadingRows(true)
    setError(null)
    getMenuItemEconomics(selectedBrandId)
      .then(data => {
        if (cancelled) return
        setRows(data)
        setLoadingRows(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando rentabilidad')
        setLoadingRows(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedBrandId])

  // Filas ordenadas: peor food cost primero
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const sevA = STATUS_SEVERITY[a.foodCostStatus]
      const sevB = STATUS_SEVERITY[b.foodCostStatus]
      if (sevA !== sevB) return sevA - sevB
      // Dentro del mismo estado, mayor food cost % primero
      const fcA = a.foodCostPct ?? -1
      const fcB = b.foodCostPct ?? -1
      return fcB - fcA
    })
  }, [rows])

  // KPIs de resumen de la marca
  const kpis = useMemo(() => {
    const withCost = rows.filter(r => r.foodCostPct !== null)
    const avgFoodCost =
      withCost.length > 0
        ? withCost.reduce((acc, r) => acc + (r.foodCostPct ?? 0), 0) / withCost.length
        : null
    const overTarget = rows.filter(r => r.foodCostStatus === 'over').length
    const noCost = rows.filter(r => r.foodCostStatus === 'no_cost').length
    return { total: rows.length, avgFoodCost, overTarget, noCost }
  }, [rows])

  const selectedBrand = brands.find(b => b.id === selectedBrandId) ?? null

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <TrendingUp size={20} className="text-accent shrink-0" />
        <h1 className="text-xl font-semibold text-text-primary">Rentabilidad de carta</h1>
      </div>

      {/* Selector de marca */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm text-text-secondary">Marca</label>
        <div className="relative">
          <select
            value={selectedBrandId ?? ''}
            onChange={e => setSelectedBrandId(e.target.value || null)}
            disabled={loadingBrands || brands.length === 0}
            className="appearance-none pl-3 pr-9 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 min-w-[200px]"
          >
            {brands.length === 0 && <option value="">Sin marcas</option>}
            {brands.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
          />
        </div>
        {selectedBrand && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary">
            {selectedBrand.ownershipType === 'licensed' ? 'Cedida' : 'Propia'}
          </span>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {/* KPIs de resumen */}
      {!loadingRows && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Platos en carta" value={String(kpis.total)} />
          <KpiCard
            label="Food cost medio"
            value={formatPct(kpis.avgFoodCost)}
            tone={kpis.avgFoodCost !== null && kpis.avgFoodCost > 30 ? 'danger' : 'neutral'}
          />
          <KpiCard
            label="Sobre objetivo"
            value={String(kpis.overTarget)}
            tone={kpis.overTarget > 0 ? 'danger' : 'success'}
          />
          <KpiCard
            label="Sin coste"
            value={String(kpis.noCost)}
            tone={kpis.noCost > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      {/* Contenido: tarjetas en móvil, tabla en escritorio */}
      {loadingRows ? (
        <div className="bg-card border border-border-default rounded-xl p-8 text-center text-sm text-text-secondary">
          Cargando rentabilidad…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border-default rounded-xl p-8 text-center text-sm text-text-secondary">
          {selectedBrand
            ? 'Esta marca no tiene platos en carta todavía.'
            : 'Selecciona una marca para ver su rentabilidad.'}
        </div>
      ) : isMobile ? (
        // ── Móvil: tarjetas apiladas (sin scroll horizontal) ──
        <div className="space-y-2">
          {sortedRows.map(r => (
            <EconomicsCard key={`${r.menuItemId}-${r.channelId}`} r={r} />
          ))}
        </div>
      ) : (
        // ── Escritorio: tabla (layout Sesión 14) ──
        <div className="bg-card border border-border-default rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border-default text-left text-xs text-text-secondary">
                  <th className="px-4 py-3 font-medium">Plato</th>
                  <th className="px-4 py-3 font-medium">Canal</th>
                  <th className="px-4 py-3 font-medium text-right">Coste</th>
                  <th className="px-4 py-3 font-medium text-right">PVP</th>
                  <th className="px-4 py-3 font-medium text-right">Food cost</th>
                  <th className="px-4 py-3 font-medium text-right">Margen neto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {sortedRows.map(r => (
                  <tr key={`${r.menuItemId}-${r.channelId}`} className="hover:bg-page transition-colors">
                    <td className="px-4 py-3 text-text-primary">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[200px]">{r.menuItemName}</span>
                        {r.flowType === 'licensed' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-text-secondary shrink-0">
                            cedida
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{r.channelName}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                      {r.costAvailable ? formatEur(r.cost) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                      {formatEur(r.priceWithVat)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs tabular-nums ${foodCostChipClasses(r.foodCostStatus)}`}
                        title={statusLabel(r.foodCostStatus)}
                      >
                        {formatPct(r.foodCostPct)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={r.netMargin !== null && r.netMargin < 0 ? 'text-danger' : 'text-text-primary'}>
                        {formatEur(r.netMargin)}
                      </span>
                      {r.netMarginPct !== null && r.netMarginPct !== undefined && (
                        <span className="ml-1 text-xs text-text-secondary">
                          ({formatPct(r.netMarginPct)})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pie con nota de incidencias */}
      {!loadingRows && kpis.noCost > 0 && (
        <div className="flex items-start gap-2 text-xs text-text-secondary">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <p>
            {kpis.noCost} plato{kpis.noCost === 1 ? '' : 's'} sin coste calculado: revisa su escandallo en
            la pestaña Recetas para que su rentabilidad sea precisa.
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// EconomicsCard — fila como tarjeta (móvil)
// ─────────────────────────────────────────────────────────────────────
function EconomicsCard({ r }: { r: MenuItemEconomics }) {
  return (
    <div className="bg-card border border-border-default rounded-xl p-3">
      {/* Cabecera: nombre + chip food cost */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">{r.menuItemName}</span>
            {r.flowType === 'licensed' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-text-secondary shrink-0">
                cedida
              </span>
            )}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">{r.channelName}</div>
        </div>
        <span
          className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs tabular-nums ${foodCostChipClasses(r.foodCostStatus)}`}
          title={statusLabel(r.foodCostStatus)}
        >
          {formatPct(r.foodCostPct)}
        </span>
      </div>

      {/* Métricas: coste / PVP / margen */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Field label="Coste" value={r.costAvailable ? formatEur(r.cost) : '—'} />
        <Field label="PVP" value={formatEur(r.priceWithVat)} />
        <Field
          label="Margen"
          value={formatEur(r.netMargin)}
          hint={r.netMarginPct !== null && r.netMarginPct !== undefined ? formatPct(r.netMarginPct) : undefined}
          negative={r.netMargin !== null && r.netMargin < 0}
        />
      </div>
    </div>
  )
}

function Field({ label, value, hint, negative }: { label: string; value: string; hint?: string; negative?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-sm tabular-nums ${negative ? 'text-danger' : 'text-text-primary'}`}>
        {value}
        {hint && <span className="ml-1 text-[11px] text-text-secondary">({hint})</span>}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// KpiCard
// ─────────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'danger' | 'warning'
}

function KpiCard({ label, value, tone = 'neutral' }: KpiCardProps) {
  const valueClass =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-text-primary'
  return (
    <div className="bg-card border border-border-default rounded-lg p-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}
