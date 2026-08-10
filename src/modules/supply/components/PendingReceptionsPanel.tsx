// src/modules/supply/components/PendingReceptionsPanel.tsx
//
// P1 (10/08) — Panel "Pendiente de recepción": pedidos enviados/parciales de
// este local, con días de retraso (rojo si vencido) y pedido-vs-recibido por
// línea en unidad base. Lee pending_receptions_report (solo lectura).
//
// La prueba de que esto funciona es que salgan números malos (pedidos
// colgados de semanas) — no un panel verde. folvy_reglas.md §2: si la carga
// falla, se enseña ESTADO DE ERROR, nunca "sin pendientes".

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Truck, CheckCircle2 } from 'lucide-react'
import {
  getPendingReceptionsReport, type PendingReceptionOrder,
} from '@/modules/supply/services/purchaseOrderService'
import { formatBaseQty } from '@/modules/supply/lib/stockDisplay'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso + 'T00:00:00'))
}

export default function PendingReceptionsPanel({
  accountId, locationId, onError,
}: {
  accountId: string
  locationId: string
  onError: (m: string) => void
}) {
  const [orders, setOrders] = useState<PendingReceptionOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!accountId || !locationId) { setOrders([]); return }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getPendingReceptionsReport(accountId, locationId)
      .then(rows => { if (!cancelled) setOrders(rows) })
      .catch(e => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Error cargando lo pendiente de recepción.'
        console.warn('[PendingReceptionsPanel] pending_receptions_report falló:', e)
        setLoadError(msg)
        onError(msg)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando lo pendiente de recepción…</div>
  }

  // NUNCA "sin pendientes" aquí: si falló la carga, no sabemos si hay pedidos colgados o no.
  if (loadError) {
    return (
      <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-danger/30 bg-danger-bg text-sm">
        <span className="text-danger">No se pudo cargar lo pendiente de recepción. {loadError}</span>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-base shrink-0">
          <RefreshCw size={13} /> Reintentar
        </button>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg border border-border-default bg-card text-sm text-text-secondary">
        <CheckCircle2 size={18} className="text-success shrink-0" />
        Sin pedidos pendientes de recepción en este local.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {orders.map(o => {
        const isOpen = expanded.has(o.orderId)
        const overdue = o.daysOverdue > 0
        return (
          <div key={o.orderId} className="border border-border-default rounded-lg overflow-hidden bg-card">
            <button type="button" onClick={() => toggle(o.orderId)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-page/50 transition-base">
              {isOpen ? <ChevronDown size={15} className="text-text-tertiary shrink-0" /> : <ChevronRight size={15} className="text-text-tertiary shrink-0" />}
              <Truck size={15} className="text-text-secondary shrink-0" />
              <span className="font-medium text-text-primary shrink-0">{o.code ?? 'Pedido'}</span>
              <span className="text-sm text-text-secondary truncate flex-1 min-w-0">{o.supplierName ?? 'Sin proveedor'}</span>
              <span className="text-xs text-text-tertiary shrink-0 hidden sm:inline">
                Pedido {formatDate(o.orderDate)}{o.expectedDate ? ` · esperado ${formatDate(o.expectedDate)}` : ''}
              </span>
              <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${overdue ? 'bg-danger-bg text-danger border-danger/30' : 'bg-page text-text-tertiary border-border-default'}`}>
                {overdue ? `${o.daysOverdue} día${o.daysOverdue === 1 ? '' : 's'} de retraso` : o.status === 'recibido_parcial' ? 'Parcial' : 'En plazo'}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-border-default">
                <div className="flex items-center gap-3 px-3.5 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary">
                  <span className="flex-1">Artículo</span>
                  <span className="w-28 text-right">Pedido</span>
                  <span className="w-28 text-right">Recibido</span>
                  <span className="w-20 text-right">Estado</span>
                </div>
                {o.lines.map((l, i) => (
                  <div key={`${l.recipeItemId ?? 'x'}-${i}`} className="flex items-center gap-3 px-3.5 py-2 border-t border-border-default first:border-t-0">
                    <span className="flex-1 min-w-0 text-sm text-text-primary truncate">{l.productName}</span>
                    <span className="w-28 text-right text-xs text-text-secondary tabular-nums">{formatBaseQty(l.qtyOrderedBase, l.unitAbbr)}</span>
                    <span className={`w-28 text-right text-xs tabular-nums ${l.qtyReceivedBase > 0 ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}>
                      {formatBaseQty(l.qtyReceivedBase, l.unitAbbr)}
                    </span>
                    <span className="w-20 text-right">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
                        l.complete ? 'bg-success-bg text-success border-success/20'
                          : l.qtyReceivedBase > 0 ? 'bg-warning-bg text-warning border-warning/20'
                          : 'bg-page text-text-tertiary border-border-default'}`}>
                        {l.complete ? 'Completo' : l.qtyReceivedBase > 0 ? 'Parcial' : 'Nada'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
