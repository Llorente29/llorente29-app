// src/modules/kitchen/pages/KitchenMenuPage.tsx
//
// La "Carta" / Menú de marca (Folvy Kitchen). Punto de entrada comercial:
// el cliente ve su menú importado (de Last.app), navegable por marca, y desde
// aquí arranca los escandallos. v1 READ-ONLY.
//
// Estructura: selector de marca + KPI de cobertura de escandallo + categorías
// con productos (estado de escandallo por fila) + sección de combos expandibles.
//
// La economía (coste/margen/FC%) se cruza desde getMenuItemEconomics: si un
// producto tiene escandallo, mostramos sus métricas; si no, el botón de crear.
//
// Patrón: useApp() + useActiveAccount() + useIsMobile(), igual que KitchenItemsPage.

import { useEffect, useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, AlertTriangle, UtensilsCrossed, Package } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listBrandsWithCatalog,
  listCategoriesWithProducts,
  listCombos,
  type CatalogBrand,
  type CatalogCategory,
  type CatalogCombo,
} from '@/modules/kitchen/services/brandCatalogService'
import { getMenuItemEconomics } from '@/modules/kitchen/services/menuItemService'
import CatalogProductDetailPage from '@/modules/kitchen/pages/CatalogProductDetailPage'
import type { MenuItemEconomics } from '@/types/kitchen'

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
  const [combos, setCombos] = useState<CatalogCombo[]>([])
  const [economics, setEconomics] = useState<Map<string, MenuItemEconomics>>(new Map())
  const [loadingBrands, setLoadingBrands] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedCombos, setExpandedCombos] = useState<Set<string>>(new Set())
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

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

  // Cargar catálogo de la marca seleccionada
  useEffect(() => {
    if (!activeAccountId || !selectedBrandId) return
    let cancelled = false
    setLoadingCatalog(true)
    setError(null)
    Promise.all([
      listCategoriesWithProducts(activeAccountId, selectedBrandId),
      listCombos(activeAccountId, selectedBrandId),
      getMenuItemEconomics(selectedBrandId).catch(() => [] as MenuItemEconomics[]),
    ])
      .then(([cats, cbs, econ]) => {
        if (cancelled) return
        setCategories(cats)
        setCombos(cbs)
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

  // Filtro de búsqueda
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return categories
    return categories
      .map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(q)) }))
      .filter((c) => c.products.length > 0)
  }, [categories, search])

  const filteredCombos = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return combos
    return combos.filter((c) => c.name.toLowerCase().includes(q))
  }, [combos, search])

  function toggleCombo(id: string) {
    setExpandedCombos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // DETALLE de producto (patrón lista+detalle por estado). Al volver, recargamos
  // el catálogo de la marca para reflejar cambios (precio, nombre editados).
  function handleDetailBack() {
    setSelectedProductId(null)
    if (activeAccountId && selectedBrandId) {
      listCategoriesWithProducts(activeAccountId, selectedBrandId).then(setCategories).catch(() => {})
      listBrandsWithCatalog(activeAccountId).then(setBrands).catch(() => {})
    }
  }

  if (selectedProductId) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <CatalogProductDetailPage menuItemId={selectedProductId} onBack={handleDetailBack} />
      </div>
    )
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
      </div>

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

      {loadingCatalog ? (
        <div className="text-sm text-gray-500">Cargando catálogo…</div>
      ) : (
        <>
          {/* Categorías + productos */}
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="mb-6">
              <h2 className="text-base font-medium text-gray-900 mb-2">
                {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
              </h2>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {cat.products.map((p, idx) => {
                  const econ = economics.get(p.id)
                  const hasRecipe = p.recipeItemId !== null
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${idx < cat.products.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                        {p.photoUrl
                          ? <img src={p.photoUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          : <UtensilsCrossed className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 text-sm truncate">
                          {p.name}
                          {!p.isAvailable && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 align-middle">agotado</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {p.shortName ? `${p.shortName} · ` : ''}
                          {p.modifierGroupCount > 0
                            ? `${p.modifierGroupCount} grupo${p.modifierGroupCount > 1 ? 's' : ''} modif.`
                            : 'sin modificadores'}
                        </div>
                      </div>
                      <div className="text-sm font-medium text-gray-900 shrink-0 w-16 text-right">
                        {formatEur(p.price)}
                      </div>
                      <div className="shrink-0 w-40 text-right">
                        {!hasRecipe ? (
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
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Combos */}
          {filteredCombos.length > 0 && (
            <div className="mb-6">
              <h2 className="text-base font-medium text-gray-900 mb-2">🍱 Combos</h2>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {filteredCombos.map((c, idx) => {
                  const open = expandedCombos.has(c.id)
                  return (
                    <div key={c.id} className={idx < filteredCombos.length - 1 ? 'border-b border-gray-100' : ''}>
                      <button
                        onClick={() => toggleCombo(c.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <Package className="w-4 h-4 text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                          {!c.isAvailable && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">agotado</span>
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900 shrink-0">{formatEur(c.price)}</span>
                        <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                          {c.slots.length} slot{c.slots.length !== 1 ? 's' : ''}
                        </span>
                      </button>
                      {open && (
                        <div className="px-4 pb-3 pl-11">
                          <div className="flex flex-wrap gap-2">
                            {c.slots.map((s) => (
                              <span key={s.id} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">
                                {s.name} <span className="text-gray-400">({s.optionCount})</span>
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-gray-400 mt-2">
                            Coste estimado: pendiente de escandallos de los componentes
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {filteredCategories.length === 0 && filteredCombos.length === 0 && (
            <p className="text-sm text-gray-500">Sin resultados para “{search}”.</p>
          )}
        </>
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
