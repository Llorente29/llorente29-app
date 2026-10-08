// src/modules/pos/components/VoidLineModal.tsx
//
// TPV · Sala (S1). Quitar algo ya enviado a cocina es ANULARLO: motivo de la
// lista de la cuenta, queda escrito quién y cuándo, y sale «ANULADO» en cocina.
// La línea sigue en la cuenta, tachada y a 0 €.

import { useEffect, useState } from 'react'
import { Loader2, X, Ban } from 'lucide-react'
import { listVoidReasons, type VoidReason } from '@/modules/pos/services/posTableService'

export default function VoidLineModal({ accountId, lineName, tableName, busy, onConfirm, onClose }: {
  accountId: string
  lineName: string
  tableName: string
  busy: boolean
  onConfirm: (reasonId: string, note: string | null) => void
  onClose: () => void
}) {
  const [reasons, setReasons] = useState<VoidReason[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reasonId, setReasonId] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    listVoidReasons(accountId)
      .then(r => { if (!cancelled) setReasons(r) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los motivos.') })
    return () => { cancelled = true }
  }, [accountId])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Anular línea enviada">
      <div className="w-full sm:max-w-md bg-tpv-surface border border-tpv-line rounded-t-tpv sm:rounded-tpv p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-tpv-danger">Ya está en cocina · Mesa {tableName}</p>
            <h2 className="text-xl font-extrabold text-tpv-txt">Anular {lineName}</h2>
            <p className="text-sm text-tpv-txt-2 mt-1">Saldrá «ANULADO» en la impresora de cocina. La línea queda en la cuenta, a 0 €.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2"><X size={22} /></button>
        </div>

        {error && <p className="text-sm font-bold text-tpv-danger">{error}</p>}
        {!reasons && !error && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-tpv-txt-2" /></div>}
        {reasons && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {reasons.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReasonId(r.id)}
                className={`min-h-tap-small px-3 rounded-tpv border text-sm font-bold text-left transition-base ${reasonId === r.id ? 'bg-tpv-accent border-tpv-accent text-white' : 'bg-tpv-surface-2 border-tpv-line text-tpv-txt'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Nota (opcional)"
          className="w-full min-h-tap-small px-3 rounded-tpv border border-tpv-line bg-tpv-surface-2 text-tpv-txt placeholder:text-tpv-txt-2"
        />
        <button
          type="button"
          disabled={!reasonId || busy}
          onClick={() => reasonId && onConfirm(reasonId, note.trim() || null)}
          className="w-full min-h-tap rounded-tpv bg-tpv-danger text-white text-base font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Ban size={18} />} {reasonId ? 'Anular y avisar a cocina' : 'Elige un motivo'}
        </button>
      </div>
    </div>
  )
}
