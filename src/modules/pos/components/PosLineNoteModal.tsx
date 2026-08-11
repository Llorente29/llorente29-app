// src/modules/pos/components/PosLineNoteModal.tsx
//
// Ficha de línea del carrito del TPV (TPV T1.d, Tarea B.1): tocar una línea
// del carrito abre esto para poner/editar su nota de cocina. Segundo punto
// de acceso además del diálogo de modificadores — y el ÚNICO para productos
// simples (sin combo ni modificadores), que hoy saltan directos al carrito
// sin pasar por PosItemConfigModal y por tanto nunca tenían dónde escribir
// una nota.

import { useState } from 'react'
import { X } from 'lucide-react'
import KitchenNoteField from './KitchenNoteField'

interface Props {
  displayName: string
  initialNote: string | null
  onClose: () => void
  onSave: (note: string | null) => void
}

export default function PosLineNoteModal({ displayName, initialNote, onClose, onSave }: Props) {
  const [note, setNote] = useState(initialNote ?? '')
  return (
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-tpv-surface w-full sm:max-w-sm rounded-t-tpv sm:rounded-tpv shadow-2xl border border-tpv-line" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-tpv-line">
          <h3 className="text-base font-extrabold text-tpv-txt truncate">{displayName}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-10 h-10 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2 transition-base">
            <X size={18} />
          </button>
        </div>
        <div className="p-4">
          <KitchenNoteField value={note} onChange={setNote} autoFocus />
        </div>
        <div className="px-4 py-3 border-t border-tpv-line">
          <button
            type="button" onClick={() => onSave(note.trim() || null)}
            className="w-full min-h-tap-critical rounded-tpv text-base font-extrabold bg-tpv-ok text-white hover:opacity-90 active:scale-[0.99] transition-base"
          >
            Guardar nota
          </button>
        </div>
      </div>
    </div>
  )
}
