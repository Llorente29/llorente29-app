// src/modules/kitchen/components/NewMenuItemModal.tsx
//
// Modal para crear un PRODUCTO BASE en la carta de una marca (CP1-a).
// Baja fricción (patrón Otter "create-then-cost"): solo nombre + precio por
// defecto (+ categoría opcional + descripción). El escandallo se vincula después
// en la ficha del producto; el precio por canal se ajusta con overrides (CP1-b).
//
// El precio se guarda SIN IVA (base imponible), como el resto de menu_item.
// El IVA por defecto es 10% (tipo reducido de hostelería); se afina en la ficha.

import { useEffect, useState } from 'react'
import { X, Loader2, Sparkles } from 'lucide-react'
import { createBaseMenuItem } from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'

interface NewMenuItemModalProps {
  accountId: string
  brandId: string
  brandName: string
  // Categoría preseleccionada (cuando se crea desde una categoría concreta).
  defaultCategoryId?: string | null
  // 'item' (producto normal) o 'combo' (combo vacío que luego se monta con slots).
  productType?: 'item' | 'combo'
  onClose: () => void
  onCreated: (newId?: string) => void
}

export default function NewMenuItemModal({
  accountId, brandId, brandName, defaultCategoryId, productType = 'item', onClose, onCreated,
}: NewMenuItemModalProps) {
  const isCombo = productType === 'combo'
  const [name, setName] = useState('')
  const [priceText, setPriceText] = useState('')
  const [vatRate, setVatRate] = useState(10)
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '')
  const [description, setDescription] = useState('')
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listMenuCategories(accountId, brandId)
      .then((cs) => { if (!cancelled) setCategories(cs) })
      .catch(() => { if (!cancelled) setCategories([]) })
    return () => { cancelled = true }
  }, [accountId, brandId])

  function parsePrice(s: string): number | null {
    const n = parseFloat(s.replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
  }

  async function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed === '') { setError('El nombre del producto es obligatorio.'); return }
    const price = parsePrice(priceText)
    if (price === null) { setError('Introduce un precio válido (ej: 9,90).'); return }
    setSubmitting(true)
    setError(null)
    try {
      const created = await createBaseMenuItem({
        accountId, brandId, name: trimmed, price, vatRate,
        menuCategoryId: categoryId === '' ? null : categoryId,
        description: description.trim() || null,
        productType,
      })
      onCreated(created.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg border border-gray-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="text-base font-medium text-gray-900">{isCombo ? 'Nuevo combo' : 'Nuevo producto'}</h3>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500">En la carta de <span className="font-medium text-gray-700">{brandName}</span>.</p>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre <span className="text-gray-400">(visible al cliente)</span></label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={isCombo ? 'Ej: Combo Doble + Bebida' : 'Ej: La Doble Clásica'} autoFocus disabled={submitting}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Precio por defecto (sin IVA)</label>
              <div className="relative">
                <input
                  type="text" inputMode="decimal" value={priceText}
                  onChange={(e) => setPriceText(e.target.value)} placeholder="9,90" disabled={submitting}
                  className="w-full pl-3 pr-7 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">IVA</label>
              <select
                value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} disabled={submitting}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              >
                <option value={10}>10% (general hostelería)</option>
                <option value={4}>4% (superreducido)</option>
                <option value={21}>21% (alcohol, etc.)</option>
                <option value={0}>0%</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Categoría <span className="text-gray-400">(opcional)</span></label>
            <select
              value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={submitting}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Descripción <span className="text-gray-400">(opcional)</span></label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Doble de ternera, queso americano, salsa de la casa" rows={2} disabled={submitting}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-purple-50 border border-purple-100 p-3">
            <Sparkles size={15} className="text-purple-500 shrink-0 mt-0.5" />
            <p className="text-xs text-purple-700/90">
              {isCombo ? (
                <>Crea el combo ahora. Luego, en su ficha, monta los <span className="font-medium">grupos</span> (por ejemplo «Elige tu bebida») y sus opciones. El coste saldrá de los componentes.</>
              ) : (
                <>Crea el producto ahora. Luego, en su ficha, vincula el <span className="font-medium">escandallo</span> (para ver el coste y el margen) y ajusta el <span className="font-medium">precio por canal</span> si difiere entre plataformas.</>
              )}
            </p>
          </div>

          {error && <div className="p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl sticky bottom-0">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting || name.trim() === '' || priceText.trim() === ''}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? 'Creando…' : (isCombo ? 'Crear combo' : 'Crear producto')}
          </button>
        </div>
      </div>
    </div>
  )
}
