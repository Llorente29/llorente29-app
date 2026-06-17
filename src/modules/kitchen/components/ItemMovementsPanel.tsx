// src/modules/kitchen/components/ItemMovementsPanel.tsx
//
// AL1 — Sección "Movimientos del artículo" de la ficha (antes "Histórico de
// compras", vacía). Lista el histórico del artículo en todos los locales, con
// el local y la referencia legible (Glovo·G829, ALB-00002, Ajuste·motivo…).

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getItemMovements, type ItemMovement } from '@/modules/kitchen/services/itemStockService'
import { movementLabel } from '@/modules/supply/services/movementsService'

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
  const [rows, setRows] = useState<ItemMovement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getItemMovements(accountId, recipeItemId, 50)
      .then(d => { if (!cancelled) setRows(d) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, recipeItemId])

  if (loading) return <div className="flex items-center gap-2 text-text-secondary text-sm py-2"><Loader2 size={14} className="animate-spin" /> Cargando movimientos…</div>
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">Aún no hay movimientos de este artículo.</p>

  return (
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
  )
}
