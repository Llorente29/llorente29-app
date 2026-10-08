// src/modules/pos/components/OpenTableModal.tsx
//
// TPV · Sala (S1). «¿Cuántos son?» — del 1 al 8 y «Son más de 8». Tocar el
// número abre la mesa y pasa a tomar nota, sin confirmar. Comensales
// obligatorios: no hay forma de abrir sin decirlo.

import { useState } from 'react'
import { Loader2, Minus, Plus, X } from 'lucide-react'

export default function OpenTableModal({ tableName, seats, busy, onPick, onClose }: {
  tableName: string
  seats: number
  busy: boolean
  onPick: (covers: number) => void
  onClose: () => void
}) {
  const [more, setMore] = useState(false)
  const [n, setN] = useState(9)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Abrir mesa ${tableName}`}>
      <div className="w-full sm:max-w-md bg-tpv-surface border border-tpv-line rounded-t-tpv sm:rounded-tpv p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-tpv-txt-2">Mesa {tableName} · {seats} sitios</p>
            <h2 className="text-2xl font-extrabold text-tpv-txt">¿Cuántos son?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-12 h-12 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2"><X size={22} /></button>
        </div>

        {!more ? (
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(c => (
              <button
                key={c}
                type="button"
                disabled={busy}
                onClick={() => onPick(c)}
                className="min-h-tap rounded-tpv border border-tpv-line bg-tpv-surface-2 text-tpv-amount font-extrabold text-tpv-txt active:bg-tpv-accent active:text-white disabled:opacity-50"
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setMore(true)}
              className="col-span-4 min-h-tap rounded-tpv border border-tpv-line bg-tpv-surface-2 text-base font-extrabold text-tpv-txt disabled:opacity-50"
            >
              Son más de 8
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-4">
              <button type="button" onClick={() => setN(v => Math.max(9, v - 1))} aria-label="Uno menos" className="min-w-tap min-h-tap rounded-tpv border border-tpv-line bg-tpv-surface-2 flex items-center justify-center text-tpv-txt"><Minus size={24} /></button>
              <span className="text-tpv-total font-extrabold text-tpv-txt min-w-[2.5ch] text-center">{n}</span>
              <button type="button" onClick={() => setN(v => Math.min(99, v + 1))} aria-label="Uno más" className="min-w-tap min-h-tap rounded-tpv border border-tpv-line bg-tpv-surface-2 flex items-center justify-center text-tpv-txt"><Plus size={24} /></button>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(n)}
              className="w-full min-h-tap rounded-tpv bg-tpv-accent text-white text-base font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy && <Loader2 size={18} className="animate-spin" />} Abrir mesa · {n} comensales
            </button>
            <button type="button" onClick={() => setMore(false)} className="w-full min-h-tap-small text-sm font-bold text-tpv-txt-2 underline">Volver a 1–8</button>
          </div>
        )}
        {busy && !more && <p className="text-center text-sm text-tpv-txt-2 inline-flex w-full items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Abriendo la mesa…</p>}
      </div>
    </div>
  )
}
