// src/modules/supply/components/HungOrdersReviewPanel.tsx
//
// P1 (10/08) — Saneado ONE-SHOT de pedidos "enviado" colgados. SOLO LISTA: no
// hay ningún botón que cancele, cierre ni enlace nada desde aquí. Decisión
// NO DESTRUCCIÓN (06/08) — Julio aprueba fila a fila; la aplicación es un
// paso aparte y deliberado (por la app o por MCP con verificación).

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, AlertTriangle, Ban, Search, HelpCircle } from 'lucide-react'
import {
  getHungOrdersReview, type HungOrderReview, type HungOrderAction,
} from '@/modules/supply/services/purchaseOrderCleanupService'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso + 'T00:00:00'))
}

const ACTION_META: Record<HungOrderAction, { label: string; cls: string; Icon: typeof Ban }> = {
  cancelar_local_cerrado: { label: 'Proponer: cancelar (local cerrado)', cls: 'bg-danger-bg text-danger border-danger/20', Icon: Ban },
  revisar_casado: { label: 'Proponer: revisar casado con recepción', cls: 'bg-warning-bg text-warning border-warning/20', Icon: Search },
  revisar_manual: { label: 'Proponer: revisar a mano', cls: 'bg-page text-text-secondary border-border-default', Icon: HelpCircle },
}

export default function HungOrdersReviewPanel({
  accountId, onError,
}: {
  accountId: string
  onError: (m: string) => void
}) {
  const [rows, setRows] = useState<HungOrderReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!accountId) { setRows([]); return }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getHungOrdersReview(accountId)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(e => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Error revisando los pedidos colgados.'
        console.warn('[HungOrdersReviewPanel] getHungOrdersReview falló:', e)
        setLoadError(msg)
        onError(msg)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Revisando pedidos colgados…</div>
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-danger/30 bg-danger-bg text-sm">
        <span className="text-danger">No se pudo revisar. {loadError}</span>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-base shrink-0">
          <RefreshCw size={13} /> Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-md bg-warning-bg text-warning border border-warning/20 text-xs">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <span>
          Solo lista propuestas — nada se ha cancelado, cerrado ni enlazado. {rows.length} pedido{rows.length === 1 ? '' : 's'} "enviado" sin cerrar,
          revisado{rows.length === 1 ? '' : 's'} de toda la cuenta (todos los locales).
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-secondary p-4 border border-dashed border-border-default rounded-lg">
          Sin pedidos "enviado" colgados en esta cuenta.
        </p>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="w-24">Código</span>
            <span className="flex-1">Proveedor / Local</span>
            <span className="w-20 text-right">Retraso</span>
            <span className="w-14 text-right">Líneas</span>
            <span className="w-64">Propuesta</span>
          </div>
          {rows.map(o => {
            const meta = ACTION_META[o.proposedAction]
            const Icon = meta.Icon
            return (
              <div key={o.orderId} className="flex items-start gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
                <span className="w-24 text-sm font-medium text-text-primary shrink-0">{o.code ?? 'Pedido'}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-text-primary truncate">{o.supplierName ?? 'Sin proveedor'}</span>
                  <span className="block text-xs text-text-tertiary truncate">
                    {o.locationName ?? 'Sin local'}{!o.locationActive && <span className="text-danger"> (cerrado)</span>}
                    {' · '}Pedido {formatDate(o.orderDate)}{o.expectedDate ? ` · esperado ${formatDate(o.expectedDate)}` : ''}
                  </span>
                </span>
                <span className={`w-20 text-right text-xs tabular-nums shrink-0 ${o.daysOverdue > 0 ? 'text-danger font-medium' : 'text-text-tertiary'}`}>
                  {o.daysOverdue > 0 ? `${o.daysOverdue} d` : '—'}
                </span>
                <span className="w-14 text-right text-xs text-text-tertiary tabular-nums shrink-0">{o.lineCount}</span>
                <span className="w-64 shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${meta.cls}`}>
                    <Icon size={11} className="shrink-0" /> {meta.label}
                  </span>
                  <span className="block text-[11px] text-text-tertiary mt-1 leading-snug">{o.proposedNote}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
