// src/modules/pos/components/PendingLineModal.tsx
//
// TPV · Sala (S1). Tocar una línea que AÚN no se ha enviado a cocina: cambiar
// la cantidad, poner la nota de cocina o quitarla. Lo enviado no pasa por
// aquí: se anula (VoidLineModal).

import { useState } from 'react'
import { Minus, Plus, Trash2, X } from 'lucide-react'
import KitchenNoteField from './KitchenNoteField'

export default function PendingLineModal({ name, quantity, note, canEditNote, busy, onSave, onRemove, onClose, onMoveToTable }: {
  name: string
  quantity: number
  note: string | null
  // La nota de una línea ya guardada en la cuenta se escribe al tomarla: la
  // cuenta no tiene cómo cambiarla sin reescribir la línea (S1).
  canEditNote: boolean
  busy: boolean
  onSave: (quantity: number, note: string | null) => void
  onRemove: () => void
  onClose: () => void
  // S2: solo para líneas ya guardadas en la cuenta (las de esta pantalla aún
  // no existen en el servidor: se quitan y se vuelven a tocar en la otra mesa).
  onMoveToTable?: () => void
}) {
  const [q, setQ] = useState(quantity)
  const [n, setN] = useState(note ?? '')

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Cambiar ${name}`}>
      <div className="w-full sm:max-w-md bg-tpv-surface border border-tpv-line rounded-t-tpv sm:rounded-tpv p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-tpv-accent-text">Sin enviar a cocina</p>
            <h2 className="text-tpv-zone font-extrabold text-tpv-txt">{name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-tap-small h-tap-small shrink-0 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2"><X size={22} /></button>
        </div>

        <div className="flex items-center justify-center gap-5">
          <button type="button" onClick={() => setQ(v => Math.max(1, v - 1))} aria-label="Uno menos"
            className="w-tap h-tap rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 flex items-center justify-center text-tpv-txt"><Minus size={26} /></button>
          <span className="text-tpv-table-num font-extrabold text-tpv-txt min-w-[2ch] text-center">{q}</span>
          <button type="button" onClick={() => setQ(v => v + 1)} aria-label="Uno más"
            className="w-tap h-tap rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 flex items-center justify-center text-tpv-txt"><Plus size={26} /></button>
        </div>

        {canEditNote && <KitchenNoteField value={n} onChange={setN} />}

        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onRemove} disabled={busy}
            className="h-tap rounded-tpv border border-tpv-danger bg-tpv-surface-2 text-tpv-txt text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            <Trash2 size={18} /> Quitar
          </button>
          <button type="button" onClick={() => onSave(q, n.trim() || null)} disabled={busy}
            className="h-tap rounded-tpv bg-tpv-accent text-white text-base font-extrabold disabled:opacity-50">
            Hecho
          </button>
        </div>
        {onMoveToTable && (
          <button type="button" onClick={onMoveToTable} disabled={busy}
            className="w-full h-tap-small rounded-tpv border border-tpv-line-strong bg-tpv-surface-2 text-tpv-txt text-base font-bold disabled:opacity-50">
            Llevar a otra mesa
          </button>
        )}
      </div>
    </div>
  )
}
