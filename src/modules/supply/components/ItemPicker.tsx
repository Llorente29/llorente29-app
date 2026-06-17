// src/modules/supply/components/ItemPicker.tsx
//
// Selector de artículo con búsqueda — patrón extraído de WasteSection para que
// merma, entrada directa y traspaso lo compartan. Carga los artículos de la
// cuenta (listInventoryItems) y deja elegir uno.

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { listInventoryItems, type InventoryItem } from '@/modules/supply/services/storageAreaService'

export type PickedItem = { recipeItemId: string; name: string }

export default function ItemPicker({
  accountId, value, onChange, placeholder,
}: {
  accountId: string
  value: PickedItem | null
  onChange: (item: PickedItem | null) => void
  placeholder?: string
}) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!accountId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    listInventoryItems(accountId)
      .then(d => { if (!cancelled) setItems(d) })
      .catch(() => { if (!cancelled) setItems([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 20)
  }, [items, search])

  if (value) {
    return (
      <div className="flex items-center gap-2 border border-border-default rounded-md px-3 py-2 bg-page">
        <span className="flex-1 text-sm text-text-primary font-medium">{value.name}</span>
        <button type="button" onClick={() => { onChange(null); setSearch('') }}
          className="text-text-tertiary hover:text-text-primary p-0.5"><X size={15} /></button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-border-default rounded-md px-2 bg-page">
        <Search size={15} className="text-text-tertiary" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={loading ? 'Cargando artículos…' : (placeholder ?? 'Busca el artículo…')}
          className="flex-1 px-1 py-2 text-sm bg-transparent text-text-primary focus:outline-none" />
      </div>
      {filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-card border border-border-default rounded-md shadow-lg max-h-56 overflow-y-auto">
          {filtered.map(i => (
            <button key={i.recipeItemId} type="button"
              onClick={() => { onChange({ recipeItemId: i.recipeItemId, name: i.name }); setSearch('') }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-page text-text-primary">
              <span className="flex-1">{i.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
