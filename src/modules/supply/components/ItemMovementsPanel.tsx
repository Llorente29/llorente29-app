// src/modules/supply/components/ItemMovementsPanel.tsx
//
// PANTALLA 1 — Trazabilidad de UN artículo: gráfico de evolución + ledger fila
// a fila, con el saldo acumulado tras cada movimiento y un "ojo" que abre el
// ticket que lo originó (SaleTicketPanel).
//
// Es la evolución de MovementsSection (que lista TODO el almacén) aplicada a un
// solo artículo. Comparte con ella el criterio que ya costó un bug: lo que se
// cuenta y lo que se lista salen del MISMO filtro, y ese filtro vive en el
// servidor. El acumulado también: lo calcula la RPC sobre el ledger completo,
// nunca sobre la página cargada (si no, "cantidad total" mentiría al paginar).
//
// recharts no entiende clases de Tailwind, así que los colores de las series
// van en constantes semánticas arriba (mismo patrón que AppccDashboardPage).

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  X, Loader2, Eye, ShoppingCart, Package, SlidersHorizontal, Trash2, ArrowLeftRight,
  ChevronDown, AlertTriangle,
} from 'lucide-react'
import {
  listItemMovements, type ItemMovementsPage, type MovementFamily,
} from '../services/itemTraceService'
import { movementLabel } from '../services/movementsService'
import SaleTicketPanel from './SaleTicketPanel'

// Series del gráfico apilado (las 5 del encargo).
const FAMILIES: { key: MovementFamily; label: string; color: string }[] = [
  { key: 'inventarios',   label: 'Inventarios',   color: '#8B5CF6' },
  { key: 'compras',       label: 'Compras',       color: '#10B981' },
  { key: 'producciones',  label: 'Producciones',  color: '#F59E0B' },
  { key: 'ventas',        label: 'Ventas',        color: '#EF4444' },
  { key: 'otros',         label: 'Otros',         color: '#6B7280' },
]

const AXIS_COLOR = '#6B7280'
const GRID_COLOR = '#E5E7EB'

type RangeKey = '7d' | '30d' | 'mes' | 'todo'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'todo', label: 'Todo' },
]

function rangeFrom(key: RangeKey): string | null {
  const now = new Date()
  if (key === 'todo') return null
  if (key === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const days = key === '7d' ? 7 : 30
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

const nf3 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })
const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtQty(v: number): string { return nf3.format(v) }
function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${nf2.format(v)} €`
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDay(d: string): string {
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function TypeIcon({ type }: { type: string }) {
  const cls = 'shrink-0'
  switch (type) {
    case 'recepcion': return <ShoppingCart size={14} className={`${cls} text-success`} />
    case 'consumo': return <Package size={14} className={`${cls} text-danger`} />
    case 'merma': return <Trash2 size={14} className={`${cls} text-warning`} />
    case 'traspaso_entrada':
    case 'traspaso_salida': return <ArrowLeftRight size={14} className={`${cls} text-text-secondary`} />
    default: return <SlidersHorizontal size={14} className={`${cls} text-accent`} />
  }
}

const PAGE_SIZE = 100

export default function ItemMovementsPanel({
  accountId, recipeItemId, locationId, locationName, onClose,
}: {
  accountId: string
  recipeItemId: string
  locationId: string
  locationName?: string | null
  onClose: () => void
}) {
  const [page, setPage] = useState<ItemMovementsPage>({ item: null, total: 0, series: [], items: [] })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [hidden, setHidden] = useState<Set<MovementFamily>>(new Set())
  const [ticketSaleId, setTicketSaleId] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setError(null)
    listItemMovements({
      accountId, recipeItemId, locationId,
      from: rangeFrom(rangeKey), limit: PAGE_SIZE, offset: 0,
    })
      .then(p => { if (!cancel) setPage(p) })
      .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'No se pudo cargar la trazabilidad') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [accountId, recipeItemId, locationId, rangeKey])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await listItemMovements({
        accountId, recipeItemId, locationId,
        from: rangeFrom(rangeKey), limit: PAGE_SIZE, offset: page.items.length,
      })
      setPage(p => ({ ...next, items: [...p.items, ...next.items] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar más')
    } finally {
      setLoadingMore(false)
    }
  }

  // Serie diaria → una fila por día con una columna por familia (apilado).
  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>()
    for (const p of page.series) {
      const row = byDay.get(p.dia) ?? { dia: p.dia }
      row[p.familia] = Number(row[p.familia] ?? 0) + p.qty
      byDay.set(p.dia, row)
    }
    return [...byDay.values()].sort((a, b) => String(a.dia).localeCompare(String(b.dia)))
  }, [page.series])

  function toggleFamily(f: MovementFamily) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f); else next.add(f)
      return next
    })
  }

  const item = page.item
  const hayMas = page.items.length < page.total

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card w-full max-w-5xl h-full overflow-y-auto shadow-lg">
        {/* Cabecera */}
        <div className="sticky top-0 bg-card border-b border-border-default px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Movimientos del artículo</p>
            <p className="font-display text-xl text-text-primary truncate">{item?.name ?? '…'}</p>
            {locationName && <p className="text-xs text-text-secondary mt-0.5">{locationName}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-page text-text-secondary shrink-0" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* KPIs */}
          {item && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="border border-border-default rounded-lg px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Stock actual</p>
                <p className={`text-base font-semibold tabular-nums ${item.qtyOnHand < 0 ? 'text-danger' : 'text-text-primary'}`}>
                  {fmtQty(item.qtyOnHand)}{item.unitAbbr ? ` ${item.unitAbbr}` : ''}
                </p>
              </div>
              <div className="border border-border-default rounded-lg px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Coste medio</p>
                <p className="text-base font-semibold tabular-nums text-text-primary">{fmtEur(item.avgUnitCost)}</p>
              </div>
              <div className="border border-border-default rounded-lg px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Valor en stock</p>
                <p className="text-base font-semibold tabular-nums text-text-primary">{fmtEur(item.stockValue)}</p>
              </div>
            </div>
          )}

          {/* Stock negativo = el ledger dice que se ha consumido más de lo que entró. */}
          {item && item.qtyOnHand < 0 && (
            <div className="flex items-start gap-2 text-xs text-warning bg-warning-bg border border-warning/30 rounded-lg p-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                Stock en negativo: el ledger ha descontado más de lo que registró entrando. Suele significar
                entradas sin registrar (o consumo duplicado). Un inventario físico vuelve a sentar la verdad.
              </span>
            </div>
          )}

          {/* Rango */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {RANGES.map(r => (
              <button key={r.key} type="button" onClick={() => setRangeKey(r.key)}
                className={`text-xs rounded-md px-2.5 py-1 border transition-base ${
                  rangeKey === r.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'
                }`}>
                {r.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg p-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm py-10 justify-center">
              <Loader2 size={16} className="animate-spin" /> Cargando movimientos…
            </div>
          ) : (
            <>
              {/* Gráfico apilado por día */}
              {chartData.length > 0 && (
                <div className="border border-border-default rounded-lg p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {FAMILIES.map(f => (
                      <button key={f.key} type="button" onClick={() => toggleFamily(f.key)}
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border-default hover:bg-page transition-base">
                        <span className="w-2.5 h-2.5 rounded-sm"
                              style={{ backgroundColor: hidden.has(f.key) ? 'transparent' : f.color,
                                       border: `1px solid ${f.color}` }} />
                        <span className={hidden.has(f.key) ? 'text-text-tertiary line-through' : 'text-text-secondary'}>
                          {f.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                      <XAxis dataKey="dia" tickFormatter={fmtDay} tick={{ fontSize: 11 }} stroke={AXIS_COLOR} />
                      <YAxis tick={{ fontSize: 11 }} stroke={AXIS_COLOR} />
                      <Tooltip
                        labelFormatter={(v) => fmtDay(String(v))}
                        formatter={(value, name) => [
                          `${fmtQty(Number(value ?? 0))}${item?.unitAbbr ? ` ${item.unitAbbr}` : ''}`,
                          FAMILIES.find(f => f.key === String(name))?.label ?? String(name),
                        ]}
                      />
                      <Legend wrapperStyle={{ display: 'none' }} />
                      {FAMILIES.filter(f => !hidden.has(f.key)).map(f => (
                        <Bar key={f.key} dataKey={f.key} stackId="a" fill={f.color} maxBarSize={40} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Ledger */}
              {page.items.length === 0 ? (
                <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
                  No hay movimientos de este artículo en el rango elegido.
                </div>
              ) : (
                <div className="border border-border-default rounded-lg overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
                    <span className="w-6" />
                    <span className="w-28">Fecha</span>
                    <span className="flex-1">Origen</span>
                    <span className="w-24 text-right">Cantidad</span>
                    <span className="w-20 text-right">Coste ud.</span>
                    <span className="w-24 text-right">Acumulado</span>
                    <span className="w-24 text-right">Valor acum.</span>
                    <span className="w-8" />
                  </div>

                  {page.items.map(m => (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
                      <span className="w-6 flex justify-center"><TypeIcon type={m.movementType} /></span>
                      <span className="w-28 text-xs text-text-tertiary">{fmtDate(m.occurredAt)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="text-sm text-text-primary truncate block">
                          {m.reference ?? m.createdByName ?? movementLabel(m.movementType)}
                        </span>
                        <span className="text-[11px] text-text-tertiary">{movementLabel(m.movementType)}</span>
                      </span>
                      <span className={`w-24 text-right text-sm tabular-nums ${m.qtyBase < 0 ? 'text-danger' : 'text-success'}`}>
                        {m.qtyBase > 0 ? '+' : ''}{fmtQty(m.qtyBase)}
                      </span>
                      <span className="w-20 text-right text-xs tabular-nums text-text-tertiary">{fmtEur(m.unitCost)}</span>
                      <span className={`w-24 text-right text-sm tabular-nums ${m.runningQty < 0 ? 'text-danger' : 'text-text-primary'}`}>
                        {fmtQty(m.runningQty)}
                      </span>
                      <span className="w-24 text-right text-xs tabular-nums text-text-secondary">{fmtEur(m.runningCost)}</span>
                      <span className="w-8 flex justify-center">
                        {m.saleId ? (
                          <button type="button" onClick={() => setTicketSaleId(m.saleId)}
                            className="p-1 rounded hover:bg-accent-bg text-text-secondary transition-base"
                            aria-label="Ver el ticket de esta venta" title="Ver el ticket de esta venta">
                            <Eye size={14} />
                          </button>
                        ) : null}
                      </span>
                    </div>
                  ))}

                  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-page border-t border-border-default">
                    <span className="text-[11px] text-text-tertiary">
                      Mostrando {page.items.length} de {page.total} movimientos
                    </span>
                    {hayMas && (
                      <button type="button" onClick={loadMore} disabled={loadingMore}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 border border-border-default rounded-md text-text-secondary hover:bg-card transition-base disabled:opacity-60">
                        {loadingMore ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
                        {loadingMore ? 'Cargando…' : `Cargar más (${page.total - page.items.length})`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Pantalla 2 encima; al cerrarla se vuelve aquí con el scroll y los
          filtros intactos (este componente no se desmonta). */}
      {ticketSaleId && (
        <SaleTicketPanel saleId={ticketSaleId} onClose={() => setTicketSaleId(null)} />
      )}
    </div>
  )
}
