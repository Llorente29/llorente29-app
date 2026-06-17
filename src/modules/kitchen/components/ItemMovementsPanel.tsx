// src/modules/kitchen/components/ItemMovementsPanel.tsx
//
// AL1 — Sección "Movimientos del artículo" de la ficha (antes "Histórico de
// compras", vacía). Lista el histórico del artículo en todos los locales, con
// el local y la referencia legible (Glovo·G829, ALB-00002, Ajuste·motivo…).
// Limitado por fecha (por defecto últimos 30 días, ampliable con el selector).

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getItemMovements, type ItemMovement } from '@/modules/kitchen/services/itemStockService'
import { movementLabel } from '@/modules/supply/services/movementsService'

type RangeKey = '7d' | '30d' | 'month' | 'all'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7 días' }, { key: '30d', label: '30 días' },
  { key: 'month', label: 'Este mes' }, { key: 'all', label: 'Todo' },
]
function rangeFor(key: RangeKey): { from: string | null; to: string | null } {
  const now = new Date()
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const iso = (d: Date) => d.toISOString()
  const tomorrow = sod(new Date(now.getTime() + 86400000))
  switch (key) {
    case '7d': return { from: iso(sod(new Date(now.getTime() - 6 * 86400000))), to: iso(tomorrow) }
    case '30d': return { from: iso(sod(new Date(now.getTime() - 29 * 86400000))), to: iso(tomorrow) }
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(tomorrow) }
    case 'all': return { from: null, to: null }
  }
}

const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function chipClass(type: string): string {
  if (type === 'recepcion' || type === 'traspaso_entrada') return 'bg-success-bg text-success'
  if (type === 'merma') return 'bg-danger-bg text-danger'
  if (type === 'ajuste' || type === 'apertura' || type === 'recuento') return 'bg-warning-bg text-warning'
  return 'bg-page text-text-secondary'
}

export default function ItemMovementsPanel({
  accountId, recipeItemId, unitAbbr,
}: {
  accountId: string
  recipeItemId: string
  unitAbbr: string | null
}) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [rows, setRows] = useState<ItemMovement[]>([])
  const [loading, setLoading] = useState(true)

  const range = useMemo(() => rangeFor(rangeKey), [rangeKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getItemMovements(accountId, recipeItemId, { from: range.from, to: range.to, limit: 300 })
      .then(d => { if (!cancelled) setRows(d) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, recipeItemId, range.from, range.to])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1.5">
        {RANGES.map(r => (
          <button key={r.key} type="button" onClick={() => setRangeKey(r.key)}
            className={`text-xs rounded-md px-2 py-1 border transition-base ${rangeKey === r.key ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-2"><Loader2 size={14} className="animate-spin" /> Cargando movimientos…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-tertiary py-1">Sin movimientos en este periodo.</p>
      ) : (
        <div className="divide-y divide-border-default">
          {rows.map(m => (
            <div key={m.id} className="flex items-center gap-3 py-2">
              <span className="w-24 text-xs text-text-tertiary shrink-0">{fmtDate(m.occurredAt)}</span>
              <span className="w-28 text-xs text-text-secondary truncate hidden sm:block">{m.locationName ?? ''}</span>
              <span className="flex-1">
                <span className={`text-[11px] px-2 py-0.5 rounded ${chipClass(m.movementType)}`}>{movementLabel(m.movementType)}</span>
              </span>
              <span className={`w-24 text-right text-sm tabular-nums ${m.qtyBase < 0 ? 'text-danger' : 'text-success'}`}>
                {m.qtyBase > 0 ? '+' : ''}{fmtQty(m.qtyBase)}{unitAbbr ? ` ${unitAbbr}` : ''}
              </span>
              <span className="w-28 text-xs text-text-secondary truncate hidden md:block">{m.reference ?? m.createdByName ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
