// src/modules/kitchen/components/AddExistingProductModal.tsx
//
// "Añadir producto existente" al menú de una marca (ENCARGO 22/07/2026).
//
// El operador multimarca reutiliza un producto que YA tiene en su cuenta (misma
// receta) en OTRA marca, sin recrearlo ni re-teclearlo. En una acción:
//   · busca entre sus productos existentes (deduplicados por receta),
//   · multiselecciona los que quiera (p.ej. 2 postres),
//   · les pone PVP (por defecto el de referencia) y una categoría común,
//   · y quedan en la carta de esta marca CON el escandallo vinculado y (si el
//     producto los tiene) con sus MODIFICADORES clonados a esta marca.
//
// No es un mirror ni duplica la receta: reutiliza el mismo recipe_item_id. El
// alta la hace el RPC atómico add_existing_product_to_brand (menuItemService).
//
// Paleta del proyecto: token `accent` para acción/foco (igual que AddToMenuModal).

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Search, Check, PackagePlus, CheckCircle2, SlidersHorizontal, Store } from 'lucide-react'
import {
  listReusableProducts,
  addExistingProductToBrand,
  type ReusableProduct,
  type AddExistingResult,
} from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'

interface AddExistingProductModalProps {
  accountId: string
  brandId: string
  brandName: string
  onClose: () => void
  /** Se llama tras añadir con éxito al menos un producto (la página refresca la carta). */
  onDone: () => void
}

// Estado editable por cada producto seleccionado (PVP propio de esta marca).
interface Selection {
  priceText: string
}

function parsePrice(s: string): number | null {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function fmtEur(v: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

// Precio de referencia -> texto de input (coma decimal, como el resto de la app).
function priceToText(v: number): string {
  return v.toString().replace('.', ',')
}

export default function AddExistingProductModal({
  accountId, brandId, brandName, onClose, onDone,
}: AddExistingProductModalProps) {
  const [products, setProducts] = useState<ReusableProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Selección: recipeItemId -> PVP editable.
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map())
  // Categoría común aplicada a todos los seleccionados ('' = sin categoría).
  const [categoryId, setCategoryId] = useState<string>('')
  const [categories, setCategories] = useState<MenuCategory[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<AddExistingResult[] | null>(null)

  // Cargar productos reutilizables (deduplicados por receta, excluye los que ya
  // están en esta marca) + categorías de la marca destino.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listReusableProducts(accountId, brandId),
      listMenuCategories(accountId, brandId).catch(() => [] as MenuCategory[]),
    ])
      .then(([prods, cats]) => {
        if (cancelled) return
        setProducts(prods)
        setCategories(cats)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando productos.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, brandId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => p.name.toLowerCase().includes(q))
  }, [products, search])

  const productByRecipe = useMemo(() => {
    const m = new Map<string, ReusableProduct>()
    for (const p of products) m.set(p.recipeItemId, p)
    return m
  }, [products])

  function toggle(p: ReusableProduct) {
    setSelected((prev) => {
      const n = new Map(prev)
      if (n.has(p.recipeItemId)) n.delete(p.recipeItemId)
      else n.set(p.recipeItemId, { priceText: priceToText(p.referencePrice) })
      return n
    })
  }

  function setPrice(recipeItemId: string, priceText: string) {
    setSelected((prev) => {
      const n = new Map(prev)
      const cur = n.get(recipeItemId)
      if (cur) n.set(recipeItemId, { ...cur, priceText })
      return n
    })
  }

  const selectedCount = selected.size
  const canSubmit = selectedCount > 0 && !submitting &&
    Array.from(selected.values()).every((s) => parsePrice(s.priceText) !== null)

  async function handleSubmit() {
    if (selectedCount === 0) { setError('Elige al menos un producto.'); return }
    // Validar precios antes de tocar la BBDD.
    const jobs: { recipeItemId: string; name: string; price: number; vatRate: number }[] = []
    for (const [rid, sel] of selected) {
      const price = parsePrice(sel.priceText)
      const prod = productByRecipe.get(rid)
      if (price === null || !prod) { setError('Revisa los precios: hay alguno no válido.'); return }
      jobs.push({ recipeItemId: rid, name: prod.name, price, vatRate: prod.vatRate })
    }

    setSubmitting(true)
    setError(null)
    const out: AddExistingResult[] = []
    try {
      // Uno por producto: cada alta es atómica; un fallo no revierte los demás.
      for (const j of jobs) {
        const r = await addExistingProductToBrand({
          accountId, brandId,
          recipeItemId: j.recipeItemId,
          name: j.name,
          price: j.price,
          vatRate: j.vatRate,
          menuCategoryId: categoryId === '' ? null : categoryId,
          withModifiers: true,
        })
        out.push(r)
      }
      setResults(out)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudieron añadir los productos.')
      setSubmitting(false)
      // Si alguno se creó antes del fallo, refresca igualmente al cerrar.
      if (out.length > 0) setResults(out)
    }
  }

  // Resumen tras añadir.
  const createdCount = results?.filter((r) => r.status === 'created' || r.status === 'reactivated').length ?? 0
  const skippedCount = results?.filter((r) => r.status === 'skipped').length ?? 0
  const clonedGroups = results?.reduce((n, r) => n + r.groupsCloned, 0) ?? 0

  return (
    <div
      role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-lg border border-gray-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h3 className="text-base font-medium text-gray-900 inline-flex items-center gap-2">
            <PackagePlus className="w-4 h-4 text-accent" /> Añadir producto existente
          </h3>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        {results ? (
          // ── Resumen del alta ──
          <div className="px-5 py-5 space-y-3">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-sm font-medium">
                {createdCount > 0
                  ? `${createdCount} producto${createdCount > 1 ? 's' : ''} en la carta de ${brandName}`
                  : 'Nada que añadir'}
              </span>
            </div>
            <ul className="text-sm text-gray-700 space-y-1">
              {results.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  {r.status === 'skipped'
                    ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">ya estaba</span>
                    : <Check className="w-4 h-4 text-green-600 shrink-0" />}
                  <span className="truncate">{r.name}</span>
                  {r.groupsCloned > 0 && (
                    <span className="text-xs text-gray-400">· {r.groupsCloned} grupo{r.groupsCloned > 1 ? 's' : ''} de modif.</span>
                  )}
                </li>
              ))}
            </ul>
            {clonedGroups > 0 && (
              <p className="text-xs text-gray-500">
                Se clonaron sus modificadores a esta marca. Aparecen con escandallo vinculado (sube la cobertura).
              </p>
            )}
            {skippedCount > 0 && createdCount === 0 && (
              <p className="text-xs text-gray-500">Todos los elegidos ya estaban en esta marca.</p>
            )}
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onDone}
                className="px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90">
                Hecho
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-gray-500">
                Reutiliza un producto que ya tienes en otra marca. Se añade a la carta de{' '}
                <span className="font-medium text-gray-700">{brandName}</span> con su escandallo (y sus modificadores si los tiene). No se duplica la receta.
              </p>

              {/* Buscador */}
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto por nombre…" disabled={submitting} autoFocus
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              {/* Categoría común para los seleccionados */}
              {selectedCount > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Categoría para los {selectedCount} seleccionado{selectedCount > 1 ? 's' : ''} <span className="text-gray-400">(opcional)</span>
                  </label>
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
              )}

              {/* Lista de productos reutilizables */}
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" /> Cargando tus productos…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex items-start gap-2 px-3 py-4 text-sm text-gray-400">
                    <Store size={15} className="text-gray-400 shrink-0 mt-0.5" />
                    <span>
                      {products.length === 0
                        ? 'No hay productos reutilizables: todos tus productos con receta ya están en esta marca (o aún no tienes ninguno con escandallo).'
                        : `Ningún producto coincide con «${search}».`}
                    </span>
                  </div>
                ) : (
                  filtered.map((p) => {
                    const sel = selected.get(p.recipeItemId)
                    const isSel = sel !== undefined
                    return (
                      <div key={p.recipeItemId} className={isSel ? 'bg-accent/5' : ''}>
                        <button
                          type="button" disabled={submitting}
                          onClick={() => toggle(p)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                        >
                          <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${isSel ? 'bg-accent border-accent' : 'border-gray-300'}`}>
                            {isSel && <Check size={12} className="text-text-on-accent" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-gray-900 truncate">{p.name}</span>
                            <span className="block text-[11px] text-gray-400 truncate inline-flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-green-600">
                                <CheckCircle2 size={11} /> escandallo
                              </span>
                              <span>· en {p.brandCount} marca{p.brandCount > 1 ? 's' : ''}</span>
                              {p.hasModifiers && (
                                <span className="inline-flex items-center gap-1 text-indigo-500">
                                  <SlidersHorizontal size={11} /> modificadores
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="text-xs text-gray-400 shrink-0">ref. {fmtEur(p.referencePrice)}</span>
                        </button>

                        {/* PVP editable cuando está seleccionado */}
                        {isSel && (
                          <div className="px-3 pb-2.5 pl-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <label className="text-[11px] text-gray-500">PVP (sin IVA)</label>
                            <div className="relative">
                              <input
                                type="text" inputMode="decimal" value={sel!.priceText}
                                onChange={(e) => setPrice(p.recipeItemId, e.target.value)} disabled={submitting}
                                className="w-24 pl-2.5 pr-6 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">€</span>
                            </div>
                            <span className="text-[11px] text-gray-400">IVA {p.vatRate}%</span>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              <p className="text-[11px] text-gray-400">
                El precio por canal (Glovo · Uber · JustEat · Shop) se ajusta luego en «Editar precios».
              </p>

              {error && (
                <div className="p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{error}</div>
              )}
            </div>

            {/* Pie */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl sticky bottom-0">
              <button type="button" onClick={onClose} disabled={submitting}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button" onClick={handleSubmit} disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
                {submitting
                  ? 'Añadiendo…'
                  : `Añadir${selectedCount > 0 ? ` ${selectedCount}` : ''} a la carta`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
