// src/modules/kitchen/components/NewCategoryModal.tsx
//
// Modal compacto para crear una CATEGORÍA en la carta de una marca (CP1-a).
// Campos mínimos: nombre (obligatorio) + emoji opcional. Posición y slug los
// resuelve el servicio. Patrón create-then-edit (igual que BrandCreateModal).

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { createMenuCategory } from '@/modules/kitchen/services/menuCategoryService'

interface NewCategoryModalProps {
  accountId: string
  brandId: string
  brandName: string
  onClose: () => void
  onCreated: () => void
}

export default function NewCategoryModal({
  accountId, brandId, brandName, onClose, onCreated,
}: NewCategoryModalProps) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed === '') { setError('El nombre de la categoría es obligatorio.'); return }
    setSubmitting(true)
    setError(null)
    try {
      await createMenuCategory({ accountId, brandId, name: trimmed, emoji: emoji.trim() || null })
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) onClose()
    else if (e.key === 'Enter' && !submitting && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault(); handleSubmit()
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md border border-gray-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
          <h3 className="text-base font-medium text-gray-900">Nueva categoría</h3>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500">En la carta de <span className="font-medium text-gray-700">{brandName}</span>.</p>
          <div className="flex gap-3">
            <div className="w-16">
              <label className="block text-xs font-medium text-gray-500 mb-1">Emoji</label>
              <input
                type="text" value={emoji} maxLength={2}
                onChange={(e) => setEmoji(e.target.value)} placeholder="🍔" disabled={submitting}
                className="w-full px-3 py-2 text-center text-base border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nombre de la categoría</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Hamburguesas" autoFocus disabled={submitting}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
          </div>
          {error && <div className="p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting || name.trim() === ''}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? 'Creando…' : 'Crear categoría'}
          </button>
        </div>
      </div>
    </div>
  )
}
