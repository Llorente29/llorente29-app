// src/modules/kitchen/components/RecipeLinkPickerModal.tsx
//
// Picker de escandallo compartido — extraído de CatalogProductDetailPage (F1)
// para que la ficha de producto Y el cockpit "Casado" (F2) usen la MISMA
// búsqueda/creación en vez de reimplementarla en cada sitio.
//
// El modal solo busca/elige/crea — la mutación real (set_menu_item_recipe /
// crear+enlazar) la hace el padre en onChoose/onCreateNew, que también es
// quien controla `busy`/`error` (así el padre decide qué hacer tras la
// llamada: refrescar el estado, cerrar el modal, etc.).

import { useEffect, useState } from 'react'
import { AlertTriangle, Link2, Loader2, Plus, X } from 'lucide-react'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import type { RecipeItem } from '@/types/kitchen'

function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

interface RecipeLinkPickerModalProps {
  accountId: string
  itemName: string
  /** true si el estado ANTES de abrir el picker era 'aprobado' — pinta el
   * aviso de que cambiar la receta lo devuelve a "Para revisar". */
  wasApproved: boolean
  busy: boolean
  error: string | null
  onChoose: (recipeItemId: string, name: string) => void
  onCreateNew: () => void
  onClose: () => void
}

export default function RecipeLinkPickerModal({
  accountId, itemName, wasApproved, busy, error, onChoose, onCreateNew, onClose,
}: RecipeLinkPickerModalProps) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<RecipeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // dish + raw: un recipe_item 'raw' también puede ser el artículo de venta
    // de un producto de reventa (Nestea, agua…) — no solo escandallos de plato.
    listRecipeItems({ accountId, types: ['dish', 'raw'], includeInactive: false })
      .then((rows) => { if (!cancelled) setOptions(rows) })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar los escandallos.')
        setOptions([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  const q = search.trim().toLowerCase()
  const filtered = q === '' ? options : options.filter((r) => r.name.toLowerCase().includes(q))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200">
          <div className="flex items-center gap-2 text-stone-800">
            <Link2 size={16} className="text-accent" />
            <span className="text-sm font-medium">Vincular escandallo a «{itemName}»</span>
          </div>
          <button onClick={() => !busy && onClose()} className="text-stone-400 hover:text-stone-700 disabled:opacity-50" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        {wasApproved && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Si cambias la receta, el plato vuelve a «Para revisar» hasta que oficina lo confirme de nuevo.</span>
          </div>
        )}

        <div className="px-5 py-3 border-b border-stone-100">
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar escandallo por nombre…"
            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
        </div>

        {(error || loadError) && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{error ?? loadError}</div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando escandallos…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-stone-400">No hay escandallos que coincidan.</div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onChoose(r.id, r.name)}
                    disabled={busy}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-accent/5 disabled:opacity-50 transition-colors group"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-stone-800 truncate">{r.name}</div>
                      {r.code && <div className="text-[11px] text-stone-400">{r.code}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs tabular-nums text-stone-500">{fmtEur(r.computedCost)}</span>
                      <Link2 size={14} className="text-stone-300 group-hover:text-accent" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-stone-100">
          <button onClick={onCreateNew} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline disabled:opacity-50">
            <Plus size={14} /> Crear escandallo nuevo «{itemName}»
          </button>
        </div>
        <div className="px-5 py-3 border-t border-stone-100 flex items-center justify-between">
          <span className="text-[11px] text-stone-400">
            {busy ? 'Guardando…' : 'Elige el escandallo que corresponde a este producto.'}
          </span>
          <button onClick={() => !busy && onClose()} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg text-stone-500 hover:bg-stone-50 disabled:opacity-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
