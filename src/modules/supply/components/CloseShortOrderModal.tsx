// src/modules/supply/components/CloseShortOrderModal.tsx
//
// "Cerrar pendiente" — cierre corto (P1.b, 10/08). Válvula manual, con motivo
// SIEMPRE obligatorio, para que un pedido pendiente no se pudra otra vez 56
// días. NO toca stock. Compartido entre el detalle del pedido
// (SupplyOrderDetailPage) y el vigía de gestión (HungOrdersReviewPanel) —
// mismo mecanismo, misma confirmación.

import { useState } from 'react'
import { X, Lock, Loader2, AlertTriangle } from 'lucide-react'
import {
  closeShortPurchaseOrder, shortCloseTargetStatus, SHORT_CLOSE_REASONS,
  type PurchaseOrder, type ShortCloseReasonCode,
} from '@/modules/supply/services/purchaseOrderService'

export default function CloseShortOrderModal({
  order, actorName, onClose, onDone,
}: {
  order: PurchaseOrder
  actorName: string | null
  onClose: () => void
  onDone: (updated: PurchaseOrder) => void
}) {
  const [reason, setReason] = useState<ShortCloseReasonCode | ''>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = shortCloseTargetStatus(order.status)
  const canSave = reason !== '' && !saving && target !== null

  async function submit() {
    if (!canSave || reason === '') return
    setSaving(true)
    setError(null)
    try {
      const updated = await closeShortPurchaseOrder({
        order, reasonCode: reason, notes: notes.trim() || null, actorName,
      })
      onDone(updated)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar el pedido.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium text-text-primary">Cerrar pendiente</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={saving}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm text-text-secondary">
            <strong className="text-text-primary">{order.code ?? 'Este pedido'}</strong> deja de esperarse.
            {target === 'cancelado' && ' No se podrá recibir nada contra él.'}
            {target === 'cerrado' && ' Se cierra con lo ya recibido — el resto no llegará.'}
          </p>

          {target === null ? (
            <div className="p-2.5 rounded-md bg-warning-bg text-warning border border-warning/20 text-xs">
              Este pedido está en estado "{order.status}" — el cierre corto no aplica aquí.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Motivo (obligatorio)</label>
                <div className="flex flex-wrap gap-1.5">
                  {SHORT_CLOSE_REASONS.map(r => (
                    <button key={r.code} type="button" onClick={() => setReason(r.code)} disabled={saving}
                      className={`text-[13px] rounded-md px-2.5 py-1.5 border transition-base disabled:opacity-50 ${
                        reason === r.code ? 'border-accent bg-accent/10 text-accent' : 'border-border-default text-text-secondary hover:text-text-primary'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Nota (opcional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} disabled={saving}
                  placeholder="Detalle…"
                  className="w-full px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-1.5 p-2.5 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={!canSave}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock size={14} />}
            {saving ? 'Cerrando…' : 'Cerrar pendiente'}
          </button>
        </div>
      </div>
    </div>
  )
}
