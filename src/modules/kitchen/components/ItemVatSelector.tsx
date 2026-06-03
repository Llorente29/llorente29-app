// src/modules/kitchen/components/ItemVatSelector.tsx
//
// Selector de IVA del artículo en la ficha del ingrediente. Muestra la
// categoría fiscal actual (con su tipo vigente hoy) y su origen: PROPUESTO (por
// la familia, vía trigger) o CONFIRMADO (por el cocinero). Permite:
//   · Confirmar la propuesta tal cual (proposed → confirmed)
//   · Cambiar a otra categoría (p. ej. aceite de oliva mixto → aceite_oliva 4%)
// Patrón "IA propone → humano confirma". El tipo % sale del motor versionado.

import { useEffect, useState } from 'react'
import { Check, Loader2, ReceiptText } from 'lucide-react'
import {
  listVatCategories,
  setItemVatCategory,
  confirmItemVatCategory,
  type VatCategory,
} from '@/modules/kitchen/services/vatService'
import type { RecipeItem } from '@/types/kitchen'

interface ItemVatSelectorProps {
  item: RecipeItem
  onChanged: () => void
}

export default function ItemVatSelector({ item, onChanged }: ItemVatSelectorProps) {
  const [cats, setCats] = useState<VatCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El item puede no tener estos campos tipados aún si database.ts no se usó;
  // los leemos de forma laxa para no romper.
  const currentCatId = (item as unknown as { vat_category_id?: string | null }).vat_category_id ?? null
  const source = (item as unknown as { vat_category_source?: string | null }).vat_category_source ?? null

  const [selected, setSelected] = useState<string>(currentCatId ?? '')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listVatCategories()
      .then((c) => { if (!cancelled) setCats(c) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando IVA.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { setSelected(currentCatId ?? '') }, [currentCatId])

  const current = cats.find(c => c.id === currentCatId) ?? null
  const changed = selected !== (currentCatId ?? '')

  async function handleConfirm() {
    setSaving(true); setError(null)
    try {
      await confirmItemVatCategory(item.id)
      onChanged()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveChange() {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      await setItemVatCategory(item.id, selected, true) // cambiar = confirmar
      onChanged()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border-default bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <ReceiptText size={16} className="text-text-secondary" />
        <h3 className="text-sm font-medium text-text-primary">IVA del artículo</h3>
        {source === 'proposed' && current && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-bg text-warning border border-warning/20">
            Propuesto — revisa
          </span>
        )}
        {source === 'confirmed' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-bg text-success border border-success/20">
            Confirmado
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-text-secondary">Cargando…</p>}

      {!loading && (
        <>
          {!currentCatId && (
            <p className="text-sm text-text-secondary mb-2">
              Este artículo aún no tiene IVA asignado. Elige su categoría fiscal.
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              disabled={saving}
              className="px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="">— Elige categoría —</option>
              {cats.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.currentRate !== null ? ` · ${c.currentRate}%` : ''}
                </option>
              ))}
            </select>

            {changed ? (
              <button
                type="button"
                onClick={handleSaveChange}
                disabled={saving || !selected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={14} />}
                Guardar IVA
              </button>
            ) : (
              source === 'proposed' && (
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={14} />}
                  Confirmar
                </button>
              )
            )}
          </div>

          {current?.currentSurcharge ? (
            <p className="text-[11px] text-text-tertiary mt-2">
              Recargo de equivalencia: {current.currentSurcharge}%
            </p>
          ) : null}

          {error && <p className="text-sm text-danger mt-2">{error}</p>}
        </>
      )}
    </div>
  )
}
