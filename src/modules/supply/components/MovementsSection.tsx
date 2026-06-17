// src/modules/supply/components/MovementsSection.tsx
//
// AL1 — Frente ① Movimientos: el libro mayor del almacén.
// Histórico del ledger (con referencia legible por movimiento) + las tres
// acciones que lo alimentan: entrada directa, traspaso entre locales y merma.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, ArrowLeftRight, Trash2, RefreshCw } from 'lucide-react'
import type { SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import {
  listMovements, MOVEMENT_FILTERS, movementLabel, type MovementRow,
} from '@/modules/supply/services/movementsService'
import MovementActionModal, { type MovementKind } from '@/modules/supply/components/MovementActionModal'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hoy' }, { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' }, { key: 'month', label: 'Este mes' }, { key: 'all', label: 'Todo' },
]
function rangeFor(key: RangeKey): { from: string | null; to: string | null } {
  const now = new Date()
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const iso = (d: Date) => d.toISOString()
  const tomorrow = sod(new Date(now.getTime() + 86400000))
  switch (key) {
    case 'today': return { from: iso(sod(now)), to: iso(tomorrow) }
    case '7d': return { from: iso(sod(new Date(now.getTime() - 6 * 86400000))), to: iso(tomorrow) }
    case '30d': return { from: iso(sod(new Date(now.getTime() - 29 * 86400000))), to: iso(tomorrow) }
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(tomorrow) }
    case 'all': return { from: null, to: null }
  }
}

const fmtEur = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function typeChipClass(type: string): string {
  if (type === 'recepcion' || type === 'traspaso_entrada') return 'bg-success-bg text-success'
  if (type === 'merma') return 'bg-danger-bg text-danger'
  if (type === 'ajuste' || type === 'apertura' || type === 'recuento') return 'bg-warning-bg text-warning'
  return 'bg-page text-text-secondary'
}

export default function MovementsSection({
  accountId, locationId, locations, actorId, actorName, onError, onFlash,
}: {
  accountId: string
  locationId: string | null
  locations: SupplyLocation[]
  actorId: string | null
  actorName: string | null
  onError: (m: string) => void
  onFlash: (m: string) => void
}) {
  const [filterKey, setFilterKey] = useState('all')
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [data, setData] = useState<{ total: number; items: MovementRow[] }>({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [modalKind, setModalKind] = useState<MovementKind | null>(null)

  const types = useMemo(() => MOVEMENT_FILTERS.find(f => f.key === filterKey)?.types ?? null, [filterKey])
  const range = useMemo(() => rangeFor(rangeKey), [rangeKey])

  useEffect(() => {
    if (!accountId || !locationId) { setData({ total: 0, items: [] }); return }
    let cancelled = false
    setLoading(true)
    listMovements({ accountId, locationId, types, from: range.from, to: range.to, limit: 300 })
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el histórico.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, types, range.from, range.to, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!locationId) {
    return <div className="text-sm text-text-secondary p-4 border border-dashed border-border-default rounded-lg">Elige un local para ver sus movimientos.</div>
  }

  return (
    <div className="space-y-3">
      {/* Barra de acciones */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-text-secondary">{data.total} movimientos · todo lo que entra, sale o se ajusta</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setModalKind('entry')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
            <Plus size={15} /> Entrada directa
          </button>
          <button type="button" onClick={() => setModalKind('transfer')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base">
            <ArrowLeftRight size={15} /> Traspaso
          </button>
          <button type="button" onClick={() => setModalKind('waste')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-default text-text-secondary hover:text-text-primary transition-base">
            <Trash2 size={15} /> Merma
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {MOVEMENT_FILTERS.map(f => (
          <button key={f.key} type="button" onClick={() => setFilterKey(f.key)}
            className={`text-xs rounded-md px-2.5 py-1 border transition-base ${filterKey === f.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {f.label}
          </button>
        ))}
        <span className="mx-1 w-px h-4 bg-border-default" />
        <select value={rangeKey} onChange={e => setRangeKey(e.target.value as RangeKey)}
          className="text-xs px-2 py-1 border border-border-default rounded-md bg-page text-text-secondary">
          {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-border-default rounded-md text-text-secondary hover:bg-page transition-base">
          <RefreshCw size={13} /> Actualizar
        </button>
      </div>

      {/* Histórico */}
      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando histórico…</div>
      ) : data.items.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          No hay movimientos en este filtro.
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="w-24">Fecha</span>
            <span className="flex-1">Artículo</span>
            <span className="w-28">Tipo</span>
            <span className="w-24 text-right">Cantidad</span>
            <span className="w-20 text-right">Coste</span>
            <span className="w-32">Quién / origen</span>
          </div>
          {data.items.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
              <span className="w-24 text-xs text-text-tertiary">{fmtDate(m.occurredAt)}</span>
              <span className="flex-1 text-sm text-text-primary truncate">{m.itemName}</span>
              <span className="w-28">
                <span className={`text-[11px] px-2 py-0.5 rounded ${typeChipClass(m.movementType)}`}>{movementLabel(m.movementType)}</span>
              </span>
              <span className={`w-24 text-right text-sm tabular-nums ${m.qtyBase < 0 ? 'text-danger' : 'text-success'}`}>
                {m.qtyBase > 0 ? '+' : ''}{fmtQty(m.qtyBase)}{m.unitAbbr ? ` ${m.unitAbbr}` : ''}
              </span>
              <span className="w-20 text-right text-xs text-text-tertiary tabular-nums">{fmtEur(m.costEur)}</span>
              <span className="w-32 text-xs text-text-secondary truncate">{m.reference ?? m.createdByName ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {modalKind && (
        <MovementActionModal
          kind={modalKind}
          accountId={accountId}
          locationId={locationId}
          locations={locations}
          actorId={actorId}
          actorName={actorName}
          onClose={() => setModalKind(null)}
          onDone={(msg) => { setModalKind(null); onFlash(msg); setReloadTick(t => t + 1) }}
        />
      )}
    </div>
  )
}
