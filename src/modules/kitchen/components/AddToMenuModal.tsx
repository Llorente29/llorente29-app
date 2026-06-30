// src/modules/kitchen/components/AddToMenuModal.tsx
//
// "Añadir a carta" desde el editor de escandallo. Conecta una receta (recipe_item)
// con un producto de venta (menu_item). Dos caminos en la misma ventana:
//
//   1) CREAR NUEVO  → addRecipeToBrand: crea el menu_item base (channel_id NULL)
//      en una marca, enlazando recipe_item_id. El precio por canal se ajusta
//      después con los overrides (EditPricesModal). Categoría opcional.
//
//   2) ENLAZAR EXISTENTE → updateMenuItem({ recipeItemId }): toma un producto de
//      la carta que aún NO tiene escandallo (un cascarón importado de Last, etc.)
//      y lo enlaza a ESTA receta. Eso desbloquea su coste/consumo/AvT
//      (frente transversal catálogo↔escandallo).
//
// Anti-invención: si no hay marca, se avisa, no se inventa. Nada toca histórico.
// Paleta del proyecto: terracota #D67442 (foco), navy #1E3A5F (acción).

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Plus, Link2, Store, Search, Check } from 'lucide-react'
import {
  listAccountBrands,
  addRecipeToBrand,
  setMenuItemCategory,
  updateMenuItem,
  listLinkableMenuItems,
  type AccountBrandLite,
  type LinkableMenuItem,
} from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'

interface AddToMenuModalProps {
  accountId: string
  recipeId: string
  recipeName: string
  createdBy?: string | null
  createdByName?: string | null
  onClose: () => void
  /** Se llama tras crear o enlazar con éxito (el editor refresca el food cost). */
  onDone: () => void
}

type Mode = 'create' | 'link'

function parsePrice(s: string): number | null {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function fmtEur(v: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

// Puntúa un candidato por parecido al nombre de la receta (para subir los más
// probables). 0 = igual, 1 = uno contiene al otro, 2 = sin coincidencia.
function similarity(candidate: string, recipe: string): number {
  const a = candidate.trim().toLowerCase()
  const b = recipe.trim().toLowerCase()
  if (a === b) return 0
  if (a.includes(b) || b.includes(a)) return 1
  return 2
}

export default function AddToMenuModal({
  accountId, recipeId, recipeName, createdBy, createdByName, onClose, onDone,
}: AddToMenuModalProps) {
  const [mode, setMode] = useState<Mode>('create')
  const [brands, setBrands] = useState<AccountBrandLite[]>([])
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Crear nuevo ──
  const [createBrandId, setCreateBrandId] = useState<string>('')
  const [nameText, setNameText] = useState(recipeName)
  const [priceText, setPriceText] = useState('')
  const [vatRate, setVatRate] = useState(10)
  const [categoryId, setCategoryId] = useState<string>('')
  const [categories, setCategories] = useState<MenuCategory[]>([])

  // ── Enlazar existente ──
  const [linkSearch, setLinkSearch] = useState('')
  const [candidates, setCandidates] = useState<LinkableMenuItem[]>([])
  const [candLoading, setCandLoading] = useState(false)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)

  const brandNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of brands) m[b.id] = b.name
    return m
  }, [brands])

  // Marcas de la cuenta (al montar). Si solo hay una, queda preseleccionada.
  useEffect(() => {
    let cancelled = false
    setBrandsLoading(true)
    listAccountBrands(accountId)
      .then((bs) => {
        if (cancelled) return
        setBrands(bs)
        if (bs.length === 1) setCreateBrandId(bs[0].id)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando marcas.') })
      .finally(() => { if (!cancelled) setBrandsLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  // Categorías de la marca elegida (camino crear). Se recargan al cambiar marca.
  useEffect(() => {
    if (createBrandId === '') { setCategories([]); setCategoryId(''); return }
    let cancelled = false
    listMenuCategories(accountId, createBrandId)
      .then((cs) => { if (!cancelled) setCategories(cs) })
      .catch(() => { if (!cancelled) setCategories([]) })
    return () => { cancelled = true }
  }, [accountId, createBrandId])

  // Candidatos a enlazar (camino enlazar). Búsqueda con debounce; se ordenan por
  // parecido al nombre de la receta para subir el más probable arriba.
  useEffect(() => {
    if (mode !== 'link') return
    let cancelled = false
    setCandLoading(true)
    const t = setTimeout(() => {
      listLinkableMenuItems(accountId, linkSearch || undefined)
        .then((rows) => {
          if (cancelled) return
          const sorted = [...rows].sort(
            (a, b) => similarity(a.name, recipeName) - similarity(b.name, recipeName)
          )
          setCandidates(sorted)
        })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando productos.') })
        .finally(() => { if (!cancelled) setCandLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [mode, accountId, linkSearch, recipeName])

  async function handleCreate() {
    if (createBrandId === '') { setError('Elige una marca.'); return }
    const price = parsePrice(priceText)
    if (price === null) { setError('Introduce un precio válido (ej: 9,90).'); return }
    const name = nameText.trim() || recipeName
    setSubmitting(true); setError(null)
    try {
      const created = await addRecipeToBrand({
        accountId, recipeItemId: recipeId, brandId: createBrandId,
        price, name, vatRate, createdBy: createdBy ?? null, createdByName: createdByName ?? null,
      })
      if (categoryId !== '') {
        // La categoría no debe bloquear el alta: si falla, el producto ya está creado.
        try { await setMenuItemCategory(created.id, categoryId) } catch { /* no bloqueante */ }
      }
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir a la carta.')
      setSubmitting(false)
    }
  }

  async function handleLink() {
    if (!selectedLinkId) { setError('Elige un producto de la lista.'); return }
    setSubmitting(true); setError(null)
    try {
      await updateMenuItem(selectedLinkId, { recipeItemId: recipeId })
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo enlazar el producto.')
      setSubmitting(false)
    }
  }

  const tabBase =
    'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors'

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
          <h3 className="text-base font-medium text-gray-900">Añadir a carta</h3>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500">
            Conecta el escandallo <span className="font-medium text-gray-700">{recipeName}</span> con un producto de venta para ver su food cost y margen.
          </p>

          {/* Conmutador de modo */}
          <div className="flex gap-1.5 p-1 bg-gray-100 rounded-lg">
            <button
              type="button" disabled={submitting}
              onClick={() => { setMode('create'); setError(null) }}
              className={tabBase + (mode === 'create' ? ' bg-white text-gray-900 shadow-sm' : ' text-gray-500 hover:text-gray-700')}
            >
              <Plus size={14} /> Crear nuevo
            </button>
            <button
              type="button" disabled={submitting}
              onClick={() => { setMode('link'); setError(null) }}
              className={tabBase + (mode === 'link' ? ' bg-white text-gray-900 shadow-sm' : ' text-gray-500 hover:text-gray-700')}
            >
              <Link2 size={14} /> Enlazar existente
            </button>
          </div>

          {brandsLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Cargando marcas…
            </div>
          ) : brands.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 p-3">
              <Store size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Esta cuenta aún no tiene marcas. Crea una marca antes de añadir productos a la carta.
              </p>
            </div>
          ) : mode === 'create' ? (
            // ── CREAR NUEVO ──
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
                <select
                  value={createBrandId} onChange={(e) => setCreateBrandId(e.target.value)} disabled={submitting}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]"
                >
                  <option value="">Elige una marca…</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.ownershipType === 'licensed' ? ' (cedida)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Nombre <span className="text-gray-400">(visible al cliente)</span>
                </label>
                <input
                  type="text" value={nameText} onChange={(e) => setNameText(e.target.value)} disabled={submitting}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Precio por defecto (sin IVA)</label>
                  <div className="relative">
                    <input
                      type="text" inputMode="decimal" value={priceText}
                      onChange={(e) => setPriceText(e.target.value)} placeholder="9,90" disabled={submitting}
                      className="w-full pl-3 pr-7 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">IVA</label>
                  <select
                    value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} disabled={submitting}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]"
                  >
                    <option value={10}>10% (general hostelería)</option>
                    <option value={4}>4% (superreducido)</option>
                    <option value={21}>21% (alcohol, etc.)</option>
                    <option value={0}>0%</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Categoría <span className="text-gray-400">(opcional)</span>
                </label>
                <select
                  value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                  disabled={submitting || createBrandId === ''}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442] disabled:bg-gray-50"
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
                  ))}
                </select>
              </div>

              <p className="text-[11px] text-gray-400">
                El precio por canal (Glovo · Uber · JustEat · Shop) se ajusta luego en «Editar precios».
              </p>
            </div>
          ) : (
            // ── ENLAZAR EXISTENTE ──
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Productos de tu carta que aún no tienen escandallo. Enlazar uno hace que descuente stock y entre en el AvT.
              </p>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)}
                  placeholder="Buscar producto por nombre…" disabled={submitting}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#D67442]/20 focus:border-[#D67442]"
                />
              </div>

              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {candLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" /> Buscando…
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-gray-400">
                    No hay productos sin escandallo {linkSearch.trim() !== '' ? 'que coincidan' : 'pendientes'}.
                  </div>
                ) : (
                  candidates.map((c) => {
                    const selected = c.id === selectedLinkId
                    return (
                      <button
                        key={c.id} type="button" disabled={submitting}
                        onClick={() => setSelectedLinkId(c.id)}
                        className={
                          'w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors ' +
                          (selected ? 'bg-[#D67442]/10' : 'hover:bg-gray-50')
                        }
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 truncate">{c.name}</div>
                          <div className="text-[11px] text-gray-400 truncate">
                            {brandNameById[c.brandId] ?? 'Marca'} · {fmtEur(c.price)}
                          </div>
                        </div>
                        {selected && <Check size={16} className="text-[#D67442] shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

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
          {mode === 'create' ? (
            <button
              type="button" onClick={handleCreate}
              disabled={submitting || brands.length === 0 || createBrandId === '' || priceText.trim() === ''}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {submitting ? 'Añadiendo…' : 'Añadir a la carta'}
            </button>
          ) : (
            <button
              type="button" onClick={handleLink}
              disabled={submitting || !selectedLinkId}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-[#1E3A5F] text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {submitting ? 'Enlazando…' : 'Enlazar producto'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
