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
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-display font-medium text-text-primary truncate">{displayName}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:bg-page transition-base">
            <X size={18} />
          </button>
        </div>
        <div className="p-4">
          <KitchenNoteField value={note} onChange={setNote} autoFocus />
        </div>
        <div className="px-4 py-3 border-t border-border-default">
          <button
            type="button" onClick={() => onSave(note.trim() || null)}
            className="w-full py-3 rounded-xl text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 active:scale-[0.99] transition-base"
          >
            Guardar nota
          </button>
        </div>
      </div>
    </div>
  )
}
