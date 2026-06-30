// src/modules/kitchen/pages/KitchenMenuPage.tsx
//
// La "Carta" / Menú de marca (Folvy Kitchen). Punto de entrada comercial:
// el cliente ve su menú importado (de Last.app), navegable por marca, y desde
// aquí arranca los escandallos. v1 READ-ONLY.
//
// Estructura: selector de marca + KPI de cobertura de escandallo + señal de
// fiabilidad del casado (con acceso a excepciones) + categorías con productos
// (estado de escandallo por fila) + sección de combos expandibles.
//
// La economía (coste/margen/FC%) se cruza desde getMenuItemEconomics: si un
// producto tiene escandallo, mostramos sus métricas; si no, el botón de crear.
//
// Patrón: useApp() + useActiveAccount() + useIsMobile(), igual que KitchenItemsPage.

import { useEffect, useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, AlertTriangle, UtensilsCrossed, Package, Link2Off, Plus, FolderPlus, ArrowRightLeft, X, Undo2, Info, ArrowUp, ArrowDown, Trash2, UploadCloud, Loader2 } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listBrandsWithCatalog,
  listCategoriesWithProducts,
  type CatalogBrand,
  type CatalogCategory,
} from '@/modules/kitchen/services/brandCatalogService'
import { getMenuItemEconomics, setMenuItemCategoryBulk, reorderMenuItems } from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, reorderMenuCategories, deactivateMenuCategory, updateMenuCategory, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'
import { getReliability, type SalesReliability } from '@/modules/kitchen/services/salesReliabilityService'
import CatalogProductDetailPage from '@/modules/kitchen/pages/CatalogProductDetailPage'
import SalesExceptionsPage from '@/modules/kitchen/pages/SalesExceptionsPage'
import NewMenuItemModal from '@/modules/kitchen/components/NewMenuItemModal'
import NewCategoryModal from '@/modules/kitchen/components/NewCategoryModal'
import type { MenuItemEconomics } from '@/types/kitchen'
import { publishBrandCatalog, type PublishResult } from '@/modules/kitchen/services/catalogPublishService'
import PublishStatusChip from '@/modules/kitchen/components/PublishStatusChip'

function formatEur(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value)}%`
}

export default function KitchenMenuPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [allCats, setAllCats] = useState<MenuCategory[]>([])
  const [economics, setEconomics] = useState<Map<string, MenuItemEconomics>>(new Map())
  const [reliability, setReliability] = useState<SalesReliability | null>(null)
  const [loadingBrands, setLoadingBrands] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [showExceptions, setShowExceptions] = useState(false)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [showNewCombo, setShowNewCombo] = useState(false)
  const [showNewCategory, setShowNewCategory] = useState(false)
  // Capa 1 — organizar: selección múltiple + mover en bloque + deshacer
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [moveTarget, setMoveTarget] = useState<string>('') // '' = sin elegir; '__none__' = Sin categoría; else categoryId
  const [moving, setMoving] = useState(false)
  const [undo, setUndo] = useState<{ label: string; revert: () => Promise<void> } | null>(null)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; count: number } | null>(null)
  // Publicador (T2a): publicar la carta de la marca a HubRise
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [publishStatusKey, setPublishStatusKey] = useState(0)

  // Cargar marcas con catálogo
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    setLoadingBrands(true)
    setError(null)
    listBrandsWithCatalog(activeAccountId)
      .then((bs) => {
        if (cancelled) return
        setBrands(bs)
        if (bs.length > 0 && !selectedBrandId) setSelectedBrandId(bs[0].id)
      })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoadingBrands(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, accountsLoading])

  // Señal de fiabilidad del casado (por cuenta). Independiente de la marca; no
  // bloquea la carga del catálogo (best-effort, degrada en silencio).
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    getReliability(activeAccountId)
      .then((r) => { if (!cancelled) setReliability(r) })
      .catch(() => { if (!cancelled) setReliability(null) })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading])

  // Cargar catálogo de la marca seleccionada
  useEffect(() => {
    if (!activeAccountId || !selectedBrandId) return
    let cancelled = false
    setLoadingCatalog(true)
    setError(null)
    Promise.all([
      listCategoriesWithProducts(activeAccountId, selectedBrandId),
      getMenuItemEconomics(selectedBrandId).catch(() => [] as MenuItemEconomics[]),
      listMenuCategories(activeAccountId, selectedBrandId).catch(() => [] as MenuCategory[]),
    ])
      .then(([cats, econ, all]) => {
        if (cancelled) return
        setCategories(cats)
        setAllCats(all)
        const m = new Map<string, MenuItemEconomics>()
        for (const e of econ) m.set(e.menuItemId, e)
        setEconomics(m)
      })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoadingCatalog(false) })
    return () => { cancelled = true }
  }, [activeAccountId, selectedBrandId])

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId],
  )

  // KPI cobertura
  const coverage = useMemo(() => {
    if (!selectedBrand) return { total: 0, withRecipe: 0, pct: 0 }
    const total = selectedBrand.productCount
    const withRecipe = selectedBrand.withRecipeCount
    return { total, withRecipe, pct: total > 0 ? Math.round((withRecipe / total) * 100) : 0 }
  }, [selectedBrand])

  // Todas las categorías de la marca como secciones (incluidas las VACÍAS, para
  // que el usuario vea su estructura y no piense que "desaparecieron") + el grupo
  // "Sin categoría" al final si hay productos sin clasificar.
  const displayCategories = useMemo<CatalogCategory[]>(() => {
    const withProducts = new Map(categories.map((c) => [c.id, c]))
    const out: CatalogCategory[] = allCats.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      position: c.position,
      products: withProducts.get(c.id)?.products ?? [],
    }))
    const sin = categories.find((c) => c.id === '__sin_categoria__')
    if (sin && sin.products.length > 0) out.push(sin)
    return out
  }, [allCats, categories])

  // Filtro de búsqueda
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return displayCategories
    return displayCategories
      .map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(q)) }))
      .filter((c) => c.products.length > 0)
  }, [displayCategories, search])

  // DETALLE de producto (patrón lista+detalle por estado). Al volver, recargamos
  // el catálogo de la marca para reflejar cambios (precio, nombre editados).
  function handleDetailBack() {
    setSelectedProductId(null)
    if (activeAccountId && selectedBrandId) {
      listCategoriesWithProducts(activeAccountId, selectedBrandId).then(setCategories).catch(() => {})
      listBrandsWithCatalog(activeAccountId).then(setBrands).catch(() => {})
    }
  }

  // EXCEPCIONES del casado (misma mecánica lista+detalle). Al volver, refrescamos
  // la señal por si algo cambió.
  function handleExceptionsBack() {
    setShowExceptions(false)
    if (activeAccountId) {
      getReliability(activeAccountId).then(setReliability).catch(() => {})
    }
  }

  // Tras crear producto o categoría: cerrar el modal y recargar la carta de la
  // marca (categorías + combos + conteos de marca + economía por canal).
  function refreshAfterCreate() {
    setShowNewProduct(false)
    setShowNewCombo(false)
    setShowNewCategory(false)
    if (!activeAccountId || !selectedBrandId) return
    listCategoriesWithProducts(activeAccountId, selectedBrandId).then(setCategories).catch(() => {})
    listMenuCategories(activeAccountId, selectedBrandId).then(setAllCats).catch(() => {})
    listBrandsWithCatalog(activeAccountId).then(setBrands).catch(() => {})
    getMenuItemEconomics(selectedBrandId)
      .then((econ) => {
        const m = new Map<string, MenuItemEconomics>()
        for (const e of econ) m.set(e.menuItemId, e)
        setEconomics(m)
      })
      .catch(() => {})
  }

  // Tras crear un COMBO: recargar y abrir su ficha para montarle los grupos ya.
  function afterCreateCombo(newId?: string) {
    refreshAfterCreate()
    if (newId) setSelectedProductId(newId)
  }

  // ── Publicar la carta de la marca a HubRise (T2a) ─────────────────────────
  async function handlePublish() {
    if (!selectedBrand || publishing) return
    setPublishing(true)
    setPublishResult(null)
    setError(null)
    try {
      const res = await publishBrandCatalog(selectedBrand.id)
      setPublishResult(res)
      setPublishStatusKey((k) => k + 1)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  // ── Capa 1: organizar la carta (mover/recategorizar) ──────────────────────

  // Categoría actual de cada producto (para poder deshacer un movimiento).
  const productCategoryById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const c of categories) for (const p of c.products) m.set(p.id, p.categoryId)
    return m
  }, [categories])

  // Al cambiar de marca: limpiar selección y deshacer (no arrastrar estado).
  useEffect(() => {
    setSelectedIds(new Set())
    setMoveTarget('')
    setUndo(null)
    setCollapsedCats(new Set())
    setConfirmDelete(null)
  }, [selectedBrandId])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function setCategorySelection(cat: CatalogCategory, on: boolean) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      for (const p of cat.products) { if (on) n.add(p.id); else n.delete(p.id) }
      return n
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setMoveTarget('')
  }

  function reloadCatalogProducts() {
    if (!activeAccountId || !selectedBrandId) return
    listCategoriesWithProducts(activeAccountId, selectedBrandId).then(setCategories).catch(() => {})
    listMenuCategories(activeAccountId, selectedBrandId).then(setAllCats).catch(() => {})
    listBrandsWithCatalog(activeAccountId).then(setBrands).catch(() => {})
  }

  // Mover en bloque los seleccionados al destino elegido. Guarda el origen de
  // cada uno para poder deshacer.
  async function applyBulkMove() {
    if (selectedIds.size === 0 || moveTarget === '' || moving) return
    const ids = Array.from(selectedIds)
    const target = moveTarget === '__none__' ? null : moveTarget
    const catName = moveTarget === '__none__'
      ? 'Sin categoría'
      : (categories.find((c) => c.id === moveTarget)?.name ?? 'otra categoría')
    const prev = ids.map((id) => ({ id, categoryId: productCategoryById.get(id) ?? null }))
    setMoving(true)
    setError(null)
    try {
      await setMenuItemCategoryBulk(ids, target)
      clearSelection()
      reloadCatalogProducts()
      setUndo({
        label: `${ids.length} producto${ids.length > 1 ? 's movidos' : ' movido'} a ${catName}`,
        revert: async () => {
          const groups = new Map<string | null, string[]>()
          for (const p of prev) {
            const arr = groups.get(p.categoryId) ?? []
            arr.push(p.id); groups.set(p.categoryId, arr)
          }
          for (const [cat, gids] of groups) await setMenuItemCategoryBulk(gids, cat)
        },
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  // Deshacer genérico: ejecuta la función de reversión guardada (mover, borrar…).
  async function runUndo() {
    if (!undo || moving) return
    setMoving(true)
    setError(null)
    try {
      await undo.revert()
      setUndo(null)
      reloadCatalogProducts()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  // ── Reordenar categorías (↑/↓) ────────────────────────────────────────────
  // Recalcula posiciones 0..n-1 de TODAS las categorías tras el intercambio, así
  // funciona aunque hoy estén sin orden real. Optimista: actualiza UI y persiste.
  async function moveCategory(catId: string, dir: -1 | 1) {
    if (moving) return
    const idx = allCats.findIndex((c) => c.id === catId)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= allCats.length) return
    const next = [...allCats]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    const renum = next.map((c, i) => ({ ...c, position: i }))
    setAllCats(renum)               // optimista
    setMoving(true); setError(null)
    try {
      await reorderMenuCategories(renum.map((c) => ({ id: c.id, position: c.position })))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      reloadCatalogProducts()       // revertir a la verdad
    } finally {
      setMoving(false)
    }
  }

  // ── Reordenar productos dentro de una categoría (↑/↓) ──────────────────────
  async function moveProduct(cat: CatalogCategory, productId: string, dir: -1 | 1) {
    if (moving) return
    const list = cat.products
    const idx = list.findIndex((p) => p.id === productId)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= list.length) return
    const nextProducts = [...list]
    ;[nextProducts[idx], nextProducts[j]] = [nextProducts[j], nextProducts[idx]]
    // Optimista: reescribir el array de productos de ESA categoría en el estado.
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, products: nextProducts } : c)))
    setMoving(true); setError(null)
    try {
      await reorderMenuItems(nextProducts.map((p, i) => ({ id: p.id, position: i })))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      reloadCatalogProducts()
    } finally {
      setMoving(false)
    }
  }

  // ── Borrar (desactivar) una categoría ──────────────────────────────────────
  // Soft-delete: sus productos NO se borran; caen a "Sin categoría". Confirmación
  // con el conteo + deshacer (reactiva la categoría).
  async function confirmDeleteCategory() {
    if (!confirmDelete || moving) return
    const { id, name } = confirmDelete
    setMoving(true); setError(null)
    try {
      await deactivateMenuCategory(id)
      setConfirmDelete(null)
      reloadCatalogProducts()
      setUndo({
        label: `Categoría «${name}» eliminada`,
        revert: async () => { await updateMenuCategory(id, { isActive: true }) },
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  function toggleCollapse(catId: string) {
    setCollapsedCats((prev) => {
      const n = new Set(prev)
      if (n.has(catId)) n.delete(catId); else n.add(catId)
      return n
    })
  }

  // Opciones del selector "Mover a…": todas las categorías reales de la marca
  // (incluidas las vacías, que son destino válido) — no solo las que tienen productos.
  const moveOptions = useMemo(() => allCats, [allCats])

  if (selectedProductId) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <CatalogProductDetailPage menuItemId={selectedProductId} onBack={handleDetailBack} />
      </div>
    )
  }

  if (showExceptions && activeAccountId) {
    return <SalesExceptionsPage accountId={activeAccountId} onBack={handleExceptionsBack} />
  }

  if (accountsLoading || loadingBrands) {
    return <div className="p-6 text-sm text-gray-500">Cargando carta…</div>
  }

  if (brands.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Menú</h1>
        <p className="text-sm text-gray-500">
          Aún no hay catálogo. Importa el catálogo desde tu TPV o crea productos para empezar.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Señal de fiabilidad del casado — DE TODA LA CUENTA (no de la marca seleccionada).
          Va arriba del todo, separada del bloque de marca, para que no se lea como
          una métrica de la marca elegida. */}
      {reliability && reliability.lineasTotal > 0 && (
        <ReliabilityBanner
          signal={reliability}
          onOpen={() => setShowExceptions(true)}
        />
      )}

      {/* Cabecera: selector de marca */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Menú</h1>
        <select
          value={selectedBrandId ?? ''}
          onChange={(e) => setSelectedBrandId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium bg-white"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {selectedBrand?.ownershipType && (
          <span className="text-xs text-gray-500">
            marca · {selectedBrand.ownershipType === 'own' ? 'propia' : 'cedida'}
          </span>
        )}
        {selectedBrand && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowNewCategory(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <FolderPlus className="w-4 h-4" /> Categoría
            </button>
            <button
              onClick={() => setShowNewProduct(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90"
            >
              <Plus className="w-4 h-4" /> Añadir producto
            </button>
            <button
              onClick={() => setShowNewCombo(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <Package className="w-4 h-4" /> Nuevo combo
            </button>
            {selectedBrand.catalogSource === 'folvy' && activeAccountId && (
              <PublishStatusChip accountId={activeAccountId} brandId={selectedBrand.id} refreshKey={publishStatusKey} />
            )}
            {selectedBrand.catalogSource === 'folvy' && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-green-600 text-white hover:opacity-90 disabled:opacity-50"
                title="Publicar esta carta a las plataformas de pedido"
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {publishing ? 'Publicando…' : 'Publicar'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Marca gobernada por el TPV (catalog_source='pos'): Folvy espeja, no publica. */}
      {selectedBrand?.catalogSource === 'pos' && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            La carta de esta marca la manda el <span className="font-medium">TPV</span> (catalog_source = «pos»): Folvy la espeja y no la publica. Cámbiala a «folvy» si quieres gobernarla y publicarla desde aquí.
          </p>
        </div>
      )}

      {/* KPIs */}
      {selectedBrand && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <KpiCard label="Productos" value={String(selectedBrand.productCount)} />
          <KpiCard label="Combos" value={String(selectedBrand.comboCount)} />
          <KpiCard
            label="Con escandallo"
            value={`${coverage.pct}%`}
            tone={coverage.pct === 0 ? 'warning' : coverage.pct < 100 ? 'warning' : 'success'}
          />
          <KpiCard label="Agotados" value={String(selectedBrand.unavailableCount)} />
        </div>
      )}

      {/* Barra de cobertura */}
      {selectedBrand && (
        <div className="mb-1.5">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={coverage.pct === 100 ? 'h-full bg-green-500' : 'h-full bg-amber-500'}
              style={{ width: `${coverage.pct}%` }}
            />
          </div>
        </div>
      )}
      {selectedBrand && (
        <p className="text-xs text-gray-500 mb-5">
          {coverage.withRecipe} de {coverage.total} productos costeados
          {coverage.pct < 100 && ' · completa los escandallos para ver márgenes'}
        </p>
      )}

      {/* Búsqueda */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* Barra de acción en bloque: aparece al seleccionar productos. Cubre mover
          uno o muchos a la vez (arranque en frío de los "Sin categoría"). */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 mb-4 p-3 rounded-xl bg-accent text-text-on-accent flex items-center gap-3 flex-wrap shadow-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}
          </span>
          <span className="text-sm text-white/70">Mover a</span>
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            disabled={moving}
            className="text-sm rounded-lg px-2.5 py-1.5 bg-white text-gray-900 border-0"
          >
            <option value="">elige categoría…</option>
            {moveOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
            ))}
            <option value="__none__">Sin categoría</option>
          </select>
          <button
            onClick={applyBulkMove}
            disabled={moving || moveTarget === ''}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-white text-accent hover:opacity-90 disabled:opacity-40"
          >
            <ArrowRightLeft className="w-4 h-4" /> {moving ? 'Moviendo…' : 'Mover'}
          </button>
          <button
            onClick={clearSelection}
            disabled={moving}
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-white/80 hover:bg-white/10"
          >
            <X className="w-4 h-4" /> Cancelar
          </button>
        </div>
      )}

      {loadingCatalog ? (
        <div className="text-sm text-gray-500">Cargando catálogo…</div>
      ) : (
        <>
          {/* Categorías + productos */}
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="mb-6">
              {(() => {
                const isReal = cat.id !== '__sin_categoria__'
                const catIdx = allCats.findIndex((c) => c.id === cat.id)
                const collapsed = collapsedCats.has(cat.id)
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => toggleCollapse(cat.id)}
                        className="text-gray-400 hover:text-gray-700"
                        title={collapsed ? 'Desplegar' : 'Plegar'}
                        aria-label={collapsed ? 'Desplegar categoría' : 'Plegar categoría'}
                      >
                        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <input
                        type="checkbox"
                        checked={cat.products.length > 0 && cat.products.every((p) => selectedIds.has(p.id))}
                        onChange={(e) => setCategorySelection(cat, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                        title="Seleccionar todos"
                      />
                      <h2 className="text-base font-medium text-gray-900">
                        {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
                        <span className="ml-2 text-xs font-normal text-gray-400">{cat.products.length}</span>
                      </h2>
                      {isReal && (
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={() => moveCategory(cat.id, -1)} disabled={moving || catIdx <= 0}
                            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Subir" aria-label="Subir categoría"><ArrowUp className="w-4 h-4" /></button>
                          <button onClick={() => moveCategory(cat.id, 1)} disabled={moving || catIdx >= allCats.length - 1}
                            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Bajar" aria-label="Bajar categoría"><ArrowDown className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmDelete({ id: cat.id, name: cat.name, count: cat.products.length })} disabled={moving}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                            title="Borrar categoría" aria-label="Borrar categoría"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>
                    {!collapsed && (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {cat.products.map((p, idx) => {
                  const econ = economics.get(p.id)
                  const hasRecipe = p.recipeItemId !== null
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${selectedIds.has(p.id) ? 'bg-accent/5' : 'hover:bg-gray-50'} ${idx < cat.products.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(p.id)}
                        className="w-4 h-4 rounded border-gray-300 cursor-pointer shrink-0"
                        title="Seleccionar"
                      />
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                        {p.photoUrl
                          ? <img src={p.photoUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          : p.productType === 'combo'
                            ? <Package className="w-4 h-4" />
                            : <UtensilsCrossed className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 text-sm truncate">
                          {p.name}
                          {p.productType === 'combo' && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 align-middle inline-flex items-center gap-1">
                              <Package className="w-3 h-3" /> combo
                            </span>
                          )}
                          {!p.isAvailable && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 align-middle">agotado</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {p.shortName ? `${p.shortName} · ` : ''}
                          {p.productType === 'combo'
                            ? `${p.comboSlotCount} slot${p.comboSlotCount !== 1 ? 's' : ''}`
                            : p.modifierGroupCount > 0
                              ? `${p.modifierGroupCount} grupo${p.modifierGroupCount > 1 ? 's' : ''} modif.`
                              : 'sin modificadores'}
                        </div>
                      </div>
                      <div className="text-sm font-medium text-gray-900 shrink-0 w-16 text-right">
                        {formatEur(p.price)}
                      </div>
                      <div className="shrink-0 w-40 text-right">
                        {p.productType === 'combo' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <Package className="w-3.5 h-3.5" /> coste por componentes
                          </span>
                        ) : !hasRecipe ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <CircleDashed className="w-3.5 h-3.5" /> Sin escandallo
                          </span>
                        ) : p.needsReview ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="w-3.5 h-3.5" /> Revisar coste
                            </span>
                            {econ && (
                              <div className="text-xs text-gray-500 mt-0.5">
                                coste {formatEur(econ.cost)} · FC {formatPct(econ.foodCostPct)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs text-green-600">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Escandallo OK
                            </span>
                            {econ && (
                              <div className="text-xs text-gray-500 mt-0.5">
                                coste {formatEur(econ.cost)} · margen {formatEur(econ.contributionMargin)} · FC {formatPct(econ.foodCostPct)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col -my-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => moveProduct(cat, p.id, -1)} disabled={moving || idx <= 0}
                          className="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20"
                          title="Subir" aria-label="Subir producto"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button onClick={() => moveProduct(cat, p.id, 1)} disabled={moving || idx >= cat.products.length - 1}
                          className="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20"
                          title="Bajar" aria-label="Bajar producto"><ArrowDown className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  )
                })}
                {cat.products.length === 0 && (
                  <div className="px-4 py-3 text-xs text-gray-400">
                    Aún sin productos · selecciónalos arriba y usa «Mover a {cat.name}»
                  </div>
                )}
              </div>
                    )}
                  </>
                )
              })()}
            </div>
          ))}

          {filteredCategories.length === 0 && (
            <p className="text-sm text-gray-500">Sin resultados para “{search}”.</p>
          )}
        </>
      )}

      {undo && (
        <div className="sticky bottom-3 z-20 mt-4 p-3 rounded-xl bg-gray-900 text-white flex items-center gap-3 shadow-lg max-w-md mx-auto">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          <span className="text-sm flex-1">{undo.label}</span>
          <button
            onClick={runUndo}
            disabled={moving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
            <Undo2 className="w-4 h-4" /> Deshacer
          </button>
          <button onClick={() => setUndo(null)} className="text-white/60 hover:text-white" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !moving && setConfirmDelete(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-600" />
              <h3 className="text-base font-medium text-gray-900">Borrar categoría</h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700">
              Vas a quitar la categoría <span className="font-medium">«{confirmDelete.name}»</span>.
              {confirmDelete.count > 0 ? (
                <> Sus <span className="font-medium">{confirmDelete.count} producto{confirmDelete.count > 1 ? 's' : ''}</span> no se borran: pasan a «Sin categoría».</>
              ) : ' Está vacía.'}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setConfirmDelete(null)} disabled={moving}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">Cancelar</button>
              <button onClick={confirmDeleteCategory} disabled={moving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-red-600 text-white hover:opacity-90 disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> {moving ? 'Borrando…' : 'Borrar categoría'}
              </button>
            </div>
          </div>
        </div>
      )}

      {publishResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPublishResult(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center gap-2">
              {publishResult.ok
                ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                : <AlertTriangle className={`w-5 h-5 ${publishResult.status === 'partial' ? 'text-amber-600' : 'text-red-600'}`} />}
              <h3 className="text-base font-medium text-gray-900">
                {publishResult.ok ? 'Carta publicada' : publishResult.status === 'partial' ? 'Publicada con avisos' : 'No se pudo publicar'}
              </h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-3 max-h-[60vh] overflow-auto">
              {publishResult.error && <p className="text-red-700">{publishResult.error}</p>}
              {publishResult.products !== undefined && (
                <p className="text-gray-600">
                  {publishResult.products} producto{publishResult.products === 1 ? '' : 's'} · {publishResult.deals ?? 0} combo{(publishResult.deals ?? 0) === 1 ? '' : 's'} · {publishResult.option_lists ?? 0} grupo{(publishResult.option_lists ?? 0) === 1 ? '' : 's'} de modificadores
                </p>
              )}
              {(publishResult.variants ?? 0) > 0 && (
                <p className="text-gray-600">
                  {publishResult.variants} canal{(publishResult.variants ?? 0) === 1 ? '' : 'es'} (Glovo/Uber/JustEat) · {publishResult.price_overrides ?? 0} precio{(publishResult.price_overrides ?? 0) === 1 ? '' : 's'} propio{(publishResult.price_overrides ?? 0) === 1 ? '' : 's'} por canal
                </p>
              )}
              {publishResult.targets.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Por conexión</div>
                  <ul className="space-y-1">
                    {publishResult.targets.map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        {t.status === 'ok'
                          ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                          : <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
                        <span>
                          <span className="font-medium">{t.connection_name ?? t.external_catalog_id}</span>
                          {t.status !== 'ok' && t.error_text && (
                            <span className="block text-xs text-red-600">{t.error_text}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {publishResult.warnings.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-700 mb-1">Avisos ({publishResult.warnings.length})</div>
                  <ul className="list-disc pl-5 text-xs text-amber-800 space-y-0.5">
                    {publishResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setPublishResult(null)}
                className="px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90">Entendido</button>
            </div>
          </div>
        </div>
      )}

      {showNewCategory && activeAccountId && selectedBrand && (
        <NewCategoryModal
          accountId={activeAccountId}
          brandId={selectedBrand.id}
          brandName={selectedBrand.name}
          onClose={() => setShowNewCategory(false)}
          onCreated={refreshAfterCreate}
        />
      )}
      {showNewProduct && activeAccountId && selectedBrand && (
        <NewMenuItemModal
          accountId={activeAccountId}
          brandId={selectedBrand.id}
          brandName={selectedBrand.name}
          onClose={() => setShowNewProduct(false)}
          onCreated={refreshAfterCreate}
        />
      )}
      {showNewCombo && activeAccountId && selectedBrand && (
        <NewMenuItemModal
          accountId={activeAccountId}
          brandId={selectedBrand.id}
          brandName={selectedBrand.name}
          productType="combo"
          onClose={() => setShowNewCombo(false)}
          onCreated={afterCreateCombo}
        />
      )}
    </div>
  )
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'success' }) {
  const valueColor = tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-green-600' : 'text-gray-900'
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${valueColor}`}>{value}</div>
    </div>
  )
}

function ReliabilityBanner({ signal, onOpen }: { signal: SalesReliability; onOpen: () => void }) {
  const dot =
    signal.status === 'verde' ? 'bg-green-500'
    : signal.status === 'ambar' ? 'bg-amber-500'
    : 'bg-red-500'
  const valueColor =
    signal.status === 'verde' ? 'text-green-700'
    : signal.status === 'ambar' ? 'text-amber-700'
    : 'text-red-700'
  const cardBg =
    signal.status === 'verde' ? 'bg-green-50 border-green-200'
    : signal.status === 'ambar' ? 'bg-amber-50 border-amber-200'
    : 'bg-red-50 border-red-200'

  const ciegoLineas = signal.lineasTotal - signal.lineasCasadas
  // Aviso de coste: parte del dinero casado puede no tener coste (food cost desconocido).
  const hayCosteCiego = signal.casadoSinCosteEur > 0

  return (
    <div className={`rounded-xl border p-3 mb-5 flex items-center gap-3 flex-wrap ${cardBg}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${dot} shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link2Off className="w-4 h-4 text-gray-500" />
          <span className={`text-sm font-medium ${valueColor}`}>
            Casado de ventas · todas las marcas {signal.reliabilityPct === null ? '' : `${signal.reliabilityPct.toFixed(1)} %`} fiable
          </span>
          {ciegoLineas > 0 && (
            <span className="text-xs text-gray-500">
              · {formatEur(signal.revenueSinCasar)} en {ciegoLineas} líneas sin casar
            </span>
          )}
        </div>
        {hayCosteCiego && (
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-xs font-medium text-orange-700">
              ⚠ Coste conocido {signal.costCoveragePct === null ? '—' : `${signal.costCoveragePct.toFixed(0)} %`}
            </span>
            <span className="text-xs text-gray-500">
              · {formatEur(signal.casadoSinCosteEur)} vendido sin coste ({signal.casadoSinCosteLineas} líneas)
            </span>
          </div>
        )}
      </div>
      <button
        onClick={onOpen}
        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 shrink-0"
      >
        Ver excepciones
      </button>
    </div>
  )
}
