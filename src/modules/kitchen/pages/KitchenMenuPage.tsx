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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, AlertTriangle, ChefHat, Clock, UtensilsCrossed, Package, Link2Off, Link2, Plus, FolderPlus, ArrowRightLeft, X, Undo2, Info, ArrowUp, ArrowDown, Trash2, UploadCloud, Loader2, Sparkles, PackagePlus, ScanSearch, Pause, Play } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { fmtMoney } from '@/lib/format'
import {
  listBrandsWithCatalog,
  listCategoriesWithProducts,
  type CatalogBrand,
  type CatalogCategory,
} from '@/modules/kitchen/services/brandCatalogService'
import { getMenuItemEconomics, setMenuItemCategoryBulk, reorderMenuItems, archiveMenuItem, restoreMenuItem, countRecentSales, duplicateMenuItem, updateMenuItem, setMenuItemCategory, addRecipeToBrand, listAccountBrands, listBrandsForRecipe, type AccountBrandLite } from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, reorderMenuCategories, deactivateMenuCategory, updateMenuCategory, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'
import { setProductAvailability } from '@/modules/kitchen/services/menuOverrideService'
import ProductContextMenu, { type ContextMenuTarget } from '@/modules/kitchen/components/ProductContextMenu'
import { getReliability, type SalesReliability } from '@/modules/kitchen/services/salesReliabilityService'
import {
  getMenuItemLinkHealth,
  classifyMenuItemLink,
  type MenuItemLinkHealthRow,
} from '@/modules/kitchen/services/menuLinkService'
import CatalogFichaPage from '@/modules/kitchen/pages/CatalogFichaPage'
import SalesExceptionsPage from '@/modules/kitchen/pages/SalesExceptionsPage'
import BrandReconciliationPage from '@/modules/kitchen/pages/BrandReconciliationPage'
import WarehouseReliabilityPage from '@/modules/kitchen/pages/WarehouseReliabilityPage'
import NewMenuItemModal from '@/modules/kitchen/components/NewMenuItemModal'
import AddExistingProductModal from '@/modules/kitchen/components/AddExistingProductModal'
import NewCategoryModal from '@/modules/kitchen/components/NewCategoryModal'
import type { MenuItemEconomics } from '@/types/kitchen'
import {
  publishBrandCatalog, dryRunBrandCatalog, listPublishLocations,
  type PublishResult, type DryRunResult,
} from '@/modules/kitchen/services/catalogPublishService'
import PublishStatusChip from '@/modules/kitchen/components/PublishStatusChip'
import { connectBrandToDelivery, type ConnectResult } from '@/modules/kitchen/services/hubriseBrandConnectService'

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

// Cuántos precios se enseñan en el ensayo. El TOTAL siempre se dice aparte;
// esto solo acota la tabla para que el modal siga siendo legible.
const PRECIOS_VISIBLES = 8

// Slug de canal -> nombre de cara a quien mira.
const CANAL_NOMBRE: Record<string, string> = {
  glovo: 'Glovo', justeat: 'Just Eat', uber: 'Uber Eats', deliveroo: 'Deliveroo',
}
function canalBonito(slug: string): string {
  return CANAL_NOMBRE[slug] ?? slug
}

// HubRise manda "13.50 EUR"; aquí se lee "13,50 €".
function precioBonito(v: string | undefined): string {
  const n = parseFloat(String(v ?? '').split(' ')[0])
  return Number.isFinite(n) ? fmtMoney(n) : (v ?? '—')
}

export default function KitchenMenuPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const navigate = useNavigate()

  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [allCats, setAllCats] = useState<MenuCategory[]>([])
  const [economics, setEconomics] = useState<Map<string, MenuItemEconomics>>(new Map())
  const [reliability, setReliability] = useState<SalesReliability | null>(null)
  // Sello de 3 estados del enlace ítem↔escandallo — de la marca visible (fila del
  // Menú) y de toda la cuenta (contadores del banner-resumen). Única fuente de
  // verdad: menu_item_link_health.status, nunca menu_item.needs_review.
  const [linkHealth, setLinkHealth] = useState<Map<string, MenuItemLinkHealthRow>>(new Map())
  const [linkHealthSummary, setLinkHealthSummary] = useState<MenuItemLinkHealthRow[]>([])
  const [loadingBrands, setLoadingBrands] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [showExceptions, setShowExceptions] = useState(false)
  // Reconciliación de marcas externas (§6 encargo Carabanchel 17/08).
  const [showBrandRecon, setShowBrandRecon] = useState(false)
  // Cola guiada de fiabilidad del almacen (arreglar paso a paso).
  const [showReliabilityQueue, setShowReliabilityQueue] = useState(false)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [showAddExisting, setShowAddExisting] = useState(false)
  const [showNewCombo, setShowNewCombo] = useState(false)
  const [showNewCategory, setShowNewCategory] = useState(false)
  // Capa 1 — organizar: selección múltiple + mover en bloque + deshacer
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [moveTarget, setMoveTarget] = useState<string>('') // '' = sin elegir; '__none__' = Sin categoría; else categoryId
  const [moving, setMoving] = useState(false)
  // Quitar de la carta. `targets` son uno o varios productos (la barra de lote
  // usa el mismo diálogo). `recentSales` se consulta al abrirlo: quitar algo que
  // se vendió ayer suele ser un error de dedo, y el número lo frena mejor que un
  // "¿estás seguro?". null = aún contando; -1 = no se pudo contar (no bloquea).
  const [confirmRemoveProduct, setConfirmRemoveProduct] = useState<{ id: string; name: string }[] | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [recentSales, setRecentSales] = useState<number | null>(null)
  // ── F4: menú contextual (clic derecho / long-press) ──
  const [ctxMenu, setCtxMenu] = useState<{ target: ContextMenuTarget; x: number; y: number } | null>(null)
  const [ctxBrands, setCtxBrands] = useState<AccountBrandLite[]>([])
  const longPressRef = useRef<number | null>(null)
  // Editor de un campo (nombre o precio) lanzado desde el menú contextual.
  const [fieldEdit, setFieldEdit] = useState<
    { id: string; name: string; field: 'name' | 'price'; value: string } | null
  >(null)
  const [undo, setUndo] = useState<{ label: string; revert: () => Promise<void> } | null>(null)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; count: number } | null>(null)
  // Publicador (T2a): publicar la carta de la marca a HubRise.
  // ÁMBITO (19/08): publicar iba SIEMPRE a todos los catálogos de la marca
  // porque el panel no pasaba location_id, aunque el Edge lo acepta desde el
  // 17/08. Meraki Pita se publicó a Alcalá y Carabanchel a la vez. Ahora el
  // ámbito se elige, viaja explícito, y antes de escribir hay un ENSAYO.
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [publishLocations, setPublishLocations] = useState<Array<{ id: string; name: string }>>([])
  const [publishLocationId, setPublishLocationId] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [publishStatusKey, setPublishStatusKey] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null)

  // Locales de la cuenta, para elegir el ámbito de publicación.
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    listPublishLocations(activeAccountId)
      .then(setPublishLocations)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [accountsLoading, activeAccountId])

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

  // Contadores del banner de salud del enlace — TODA la cuenta, no solo la
  // marca visible (igual criterio que `reliability`). Un fallo aquí no debe
  // leerse como "0 problemas": si falla, degradamos a lista vacía pero lo
  // avisamos por consola.
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    getMenuItemLinkHealth(activeAccountId)
      .then((rows) => { if (!cancelled) setLinkHealthSummary(rows) })
      .catch((e: unknown) => {
        if (cancelled) return
        console.warn('KitchenMenuPage: fallo cargando el resumen de salud de escandallos', e)
        setLinkHealthSummary([])
      })
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
      getMenuItemLinkHealth(activeAccountId, selectedBrandId).catch((e: unknown) => {
        console.warn('KitchenMenuPage: fallo cargando salud de escandallos de la marca', e)
        return [] as MenuItemLinkHealthRow[]
      }),
    ])
      .then(([cats, econ, all, health]) => {
        if (cancelled) return
        setCategories(cats)
        setAllCats(all)
        const m = new Map<string, MenuItemEconomics>()
        for (const e of econ) m.set(e.menuItemId, e)
        setEconomics(m)
        const lh = new Map<string, MenuItemLinkHealthRow>()
        for (const r of health) lh.set(r.menuItemId, r)
        setLinkHealth(lh)
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
  function handleReliabilityBack() {
    setShowReliabilityQueue(false)
    if (activeAccountId) {
      getReliability(activeAccountId).then(setReliability).catch(() => {})
    }
  }

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
    setShowAddExisting(false)
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
  // DOS PUERTAS. El botón hace el ENSAYO, que no manda un byte a HubRise; la
  // publicación de verdad es un segundo clic, ya sabiendo a qué catálogo va.
  const ambitoNombre = publishLocationId
    ? (publishLocations.find((l) => l.id === publishLocationId)?.name ?? publishLocationId)
    : 'toda la cuenta'

  async function handlePublish() {
    if (!selectedBrand || publishing || dryRunning) return
    setDryRunning(true)
    setPublishResult(null)
    setDryRun(null)
    setError(null)
    try {
      setDryRun(await dryRunBrandCatalog(selectedBrand.id, publishLocationId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDryRunning(false)
    }
  }

  /** Segundo clic: ahora sí se escribe, con el MISMO ámbito que se ensayó. */
  async function confirmarPublicacion() {
    if (!selectedBrand || publishing) return
    setPublishing(true)
    setError(null)
    try {
      const res = await publishBrandCatalog(selectedBrand.id, publishLocationId)
      setDryRun(null)
      setPublishResult(res)
      setPublishStatusKey((k) => k + 1)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  // ── Conectar la marca a delivery (Fase 2, self-service) ───────────────────
  // Crea/reusa el catálogo HubRise por local (sin bridge) y publica la carta.
  async function handleConnect() {
    if (!selectedBrand || connecting) return
    setConnecting(true)
    setConnectResult(null)
    setError(null)
    try {
      // ENCARGO CODE (21/08) — el ámbito elegido arriba viaja también aquí.
      // Antes no: este botón conectaba y publicaba SIEMPRE todos los locales
      // de la marca, aunque el desplegable dijera «Foodint Alcalá». Es lo que
      // republicó Carabanchel el 21/08 a las 07:45.
      const res = await connectBrandToDelivery(selectedBrand.id, publishLocationId ?? undefined)
      setConnectResult(res)
      setPublishStatusKey((k) => k + 1)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
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

  // ── Quitar un producto de la carta ───────────────────────────────────────
  // Archiva su menu_item: deja de estar en la carta y de publicarse, pero su
  // escandallo y sus ventas siguen intactos. Es la única vía para limpiar los
  // duplicados que deja la ingesta (dos filas del mismo plato, una sin receta),
  // porque esos ni siquiera aparecen en la ficha del plato.
  // ── F4: abrir / operar el menú contextual ────────────────────────────────
  // Abrirlo carga, sin bloquear, las marcas a las que el producto AÚN no
  // pertenece: es lo único que el menú no puede saber por sí mismo.
  function openContextMenu(target: ContextMenuTarget, x: number, y: number) {
    setRemoveError(null)
    setCtxMenu({ target, x, y })
    setCtxBrands([])
    if (!activeAccountId) return
    const recipeId = target.recipeItemId
    if (!recipeId) return
    Promise.all([listAccountBrands(activeAccountId), listBrandsForRecipe(activeAccountId, recipeId)])
      .then(([all, present]) => {
        const taken = new Set(present.map((p) => p.brandId))
        setCtxBrands(all.filter((b) => !taken.has(b.id)))
      })
      .catch((e: unknown) => console.error('No se pudieron cargar las marcas destino:', e))
  }

  // Long-press en móvil: 500 ms sin mover el dedo. Si el dedo se va (scroll) o
  // se levanta antes, no hay menú — el scroll de la lista manda.
  function startLongPress(target: ContextMenuTarget, x: number, y: number) {
    cancelLongPress()
    longPressRef.current = window.setTimeout(() => openContextMenu(target, x, y), 500)
  }
  function cancelLongPress() {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  // Ejecuta una acción del menú y deja el estado coherente: cierra, recarga y
  // enseña el fallo si lo hay (nunca un catch mudo).
  async function runCtxAction(fn: () => Promise<void>, undoEntry?: { label: string; revert: () => Promise<void> }) {
    if (moving) return
    setMoving(true)
    setCtxMenu(null)
    try {
      await fn()
      reloadCatalogProducts()
      if (undoEntry) setUndo(undoEntry)
    } catch (e: unknown) {
      setRemoveError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  // Guarda el nombre o el precio editado desde el menú contextual.
  async function saveFieldEdit() {
    if (!fieldEdit || moving) return
    const { id, field, value } = fieldEdit
    const trimmed = value.trim()
    if (field === 'name' && trimmed === '') {
      setRemoveError('El nombre no puede quedar vacío.')
      return
    }
    let patch: { name?: string; price?: number }
    if (field === 'name') {
      patch = { name: trimmed }
    } else {
      const n = Number(trimmed.replace(',', '.'))
      if (!Number.isFinite(n) || n < 0) {
        setRemoveError('El precio tiene que ser un número mayor o igual que 0.')
        return
      }
      patch = { price: n }
    }
    setMoving(true)
    setRemoveError(null)
    try {
      await updateMenuItem(id, patch)
      setFieldEdit(null)
      reloadCatalogProducts()
    } catch (e: unknown) {
      setRemoveError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  // ── Pausar / reanudar (86) desde la lista ────────────────────────────────
  // Misma vía que la ficha: setProductAvailability -> RPC set_product_availability,
  // que cascadea CROSS-BRAND (el producto físico es el mismo en todas las marcas
  // que comparten escandallo o matrícula) y empuja a availability-dispatch, que
  // hace PATCH de inventario en HubRise. Por eso no se pide confirmación previa
  // pero SÍ se dice el alcance real después, con Deshacer: pausar tiene que ser
  // de un toque, y el alcance no se puede saber hasta que responde el servidor.
  async function togglePause(p: { id: string; name: string; isAvailable: boolean }) {
    if (moving) return
    const next = !p.isAvailable
    setMoving(true)
    setRemoveError(null)
    try {
      const res = await setProductAvailability(p.id, next, 'manual')
      reloadCatalogProducts()
      const alcance = res.brands > 1 ? ` · ${res.brands} marcas` : ''
      const canales = res.channels > 0 ? ` · ${res.channels} canal${res.channels === 1 ? '' : 'es'}` : ''
      setUndo({
        label: next
          ? `«${p.name}» de nuevo a la venta${alcance}`
          : `«${p.name}» pausado${alcance}${canales}`,
        revert: async () => {
          await setProductAvailability(p.id, p.isAvailable, 'manual')
          reloadCatalogProducts()
        },
      })
    } catch (e: unknown) {
      setRemoveError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  // Abre la confirmación para uno o varios productos y, en paralelo, pregunta
  // cuántas veces se han vendido esta semana (aviso, no bloqueo).
  function askRemoveProducts(targets: { id: string; name: string }[]) {
    if (targets.length === 0) return
    setRemoveError(null)
    setRecentSales(null)
    setConfirmRemoveProduct(targets)
    Promise.all(targets.map((t) => countRecentSales(t.id, 7)))
      .then((counts) => setRecentSales(counts.reduce((a, b) => a + b, 0)))
      .catch((e: unknown) => {
        console.error('countRecentSales falló:', e)
        setRecentSales(-1)   // no se pudo contar: se sigue pudiendo quitar
      })
  }

  async function removeProductsFromMenu(targets: { id: string; name: string }[]) {
    if (moving || targets.length === 0) return
    setMoving(true)
    const done: string[] = []
    try {
      for (const t of targets) {
        await archiveMenuItem(t.id)
        done.push(t.id)
      }
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of done) next.delete(id)
        return next
      })
      setConfirmRemoveProduct(null)
      reloadCatalogProducts()
      // Deshacer: reactiva exactamente los que se quitaron, mismo mecanismo que
      // mover en bloque o borrar categoría.
      setUndo({
        label: targets.length === 1
          ? `«${targets[0].name}» fuera de la carta`
          : `${done.length} productos fuera de la carta`,
        revert: async () => {
          for (const id of done) await restoreMenuItem(id)
          reloadCatalogProducts()
        },
      })
    } catch (e: unknown) {
      setRemoveError(e instanceof Error ? e.message : String(e))
      if (done.length > 0) reloadCatalogProducts()   // parcial: refleja lo ya hecho
    } finally {
      setMoving(false)
    }
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
        <CatalogFichaPage menuItemId={selectedProductId} onBack={handleDetailBack} />
      </div>
    )
  }

  if (showReliabilityQueue && activeAccountId) {
    return <WarehouseReliabilityPage accountId={activeAccountId} onBack={handleReliabilityBack} />
  }

  if (showExceptions && activeAccountId) {
    return <SalesExceptionsPage accountId={activeAccountId} onBack={handleExceptionsBack} />
  }

  if (showBrandRecon && activeAccountId) {
    return <BrandReconciliationPage accountId={activeAccountId} onBack={() => setShowBrandRecon(false)} />
  }


  if (accountsLoading || loadingBrands) {
    return <div className="p-6 text-sm text-gray-500">Cargando carta…</div>
  }

  if (brands.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Cartas</h1>
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
          onFix={() => setShowReliabilityQueue(true)}
        />
      )}

      {linkHealthSummary.length > 0 && (
        <LinkHealthBanner rows={linkHealthSummary} onOpen={() => navigate('/kitchen/casado')} />
      )}

      {/* Cabecera: selector de marca */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Cartas</h1>
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
              onClick={() => setShowAddExisting(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              title="Reutilizar un producto que ya tienes en otra marca"
            >
              <PackagePlus className="w-4 h-4" /> Añadir existente
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
            {/* Reconciliación de marcas externas. Es de CUENTA, no de la marca
                elegida — por eso no lleva el nombre de la marca en el rótulo. */}
            <button
              onClick={() => setShowBrandRecon(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              title="Marcas que llegan de los integradores y no están atribuidas a ninguna marca de Folvy"
            >
              <ScanSearch className="w-4 h-4" /> Marcas de fuera
            </button>
            {selectedBrand.catalogSource === 'folvy' && (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                title="Crear/reusar el catálogo de esta marca en HubRise y publicar la carta (sin bridge)"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {connecting ? 'Conectando…' : 'Conectar a delivery'}
              </button>
            )}
            {selectedBrand.catalogSource === 'folvy' && (
              <>
                {/* ÁMBITO: se elige ANTES y se enseña otra vez en el ensayo. */}
                <select
                  value={publishLocationId ?? ''}
                  onChange={(e) => setPublishLocationId(e.target.value || null)}
                  title="A qué local se publica"
                  className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700"
                >
                  <option value="">Toda la cuenta (todos los catálogos)</option>
                  {publishLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button
                  onClick={handlePublish}
                  disabled={publishing || dryRunning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-green-600 text-white hover:opacity-90 disabled:opacity-50"
                  title="Ver a qué catálogo se publicaría y con qué precios, sin publicar todavía"
                >
                  {dryRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {dryRunning ? 'Comprobando…' : 'Publicar…'}
                </button>
              </>
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
            onClick={() => {
              const targets = filteredCategories
                .flatMap((c) => c.products)
                .filter((p) => selectedIds.has(p.id))
                .map((p) => ({ id: p.id, name: p.name }))
              askRemoveProducts(targets)
            }}
            disabled={moving || selectedIds.size === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
          >
            <X className="w-4 h-4" /> Quitar de la carta
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
                  const health = linkHealth.get(p.id)
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        openContextMenu(
                          { id: p.id, name: p.name, isAvailable: p.isAvailable, recipeItemId: p.recipeItemId },
                          e.clientX, e.clientY,
                        )
                      }}
                      onTouchStart={(e) => {
                        const t = e.touches[0]
                        if (!t) return
                        startLongPress(
                          { id: p.id, name: p.name, isAvailable: p.isAvailable, recipeItemId: p.recipeItemId },
                          t.clientX, t.clientY,
                        )
                      }}
                      onTouchMove={cancelLongPress}
                      onTouchEnd={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${selectedIds.has(p.id) ? 'bg-accent/5' : 'hover:bg-gray-50'} ${idx < cat.products.length - 1 ? 'border-b border-gray-100' : ''} ${!p.isAvailable ? 'opacity-60' : ''}`}
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
                          {p.mirrorOfItemId ? (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 align-middle inline-flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> versión promo{p.isAvailable ? ' · activa' : ' · en espera'}
                            </span>
                          ) : p.hasMirror && p.promoActive ? (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 align-middle inline-flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> en promo
                            </span>
                          ) : !p.isAvailable ? (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 align-middle inline-flex items-center gap-1">
                              <Pause className="w-3 h-3" /> Pausado
                            </span>
                          ) : null}
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
                        ) : !health ? (
                          // Marca recién cambiada / linkHealth aún no cargó — no mentir a verde ni a roto.
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <CircleDashed className="w-3.5 h-3.5" /> …
                          </span>
                        ) : (() => {
                          const meta = classifyMenuItemLink(health)
                          const toneColor = meta.tone === 'green' ? 'text-green-600' : meta.tone === 'red' ? 'text-red-600' : meta.tone === 'orange' ? 'text-orange-600' : 'text-amber-600'
                          const Icon = meta.tone === 'green' ? CheckCircle2 : meta.tone === 'red' ? AlertTriangle : meta.tone === 'orange' ? ChefHat : Clock
                          return (
                            <div>
                              <span className={`inline-flex items-center gap-1 text-xs ${toneColor}`} title={meta.text}>
                                <Icon className="w-3.5 h-3.5" /> {meta.label}
                              </span>
                              {econ && (
                                <div className="text-xs text-gray-500 mt-0.5">
                                  coste {formatEur(econ.cost)}{meta.tone === 'green' ? ` · margen ${formatEur(econ.contributionMargin)}` : ''} · FC {formatPct(econ.foodCostPct)}
                                </div>
                              )}
                              {health.sharedWith > 1 && (
                                <div className="text-[11px] text-gray-400 mt-0.5">compartido con {health.sharedWith - 1}</div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="shrink-0 flex flex-col -my-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => moveProduct(cat, p.id, -1)} disabled={moving || idx <= 0}
                          className="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20"
                          title="Subir" aria-label="Subir producto"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button onClick={() => moveProduct(cat, p.id, 1)} disabled={moving || idx >= cat.products.length - 1}
                          className="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20"
                          title="Bajar" aria-label="Bajar producto"><ArrowDown className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => void togglePause({ id: p.id, name: p.name, isAvailable: p.isAvailable })}
                          disabled={moving}
                          className={`p-1.5 rounded-md disabled:opacity-20 transition-colors ${
                            p.isAvailable
                              ? 'text-gray-300 hover:text-amber-600 hover:bg-amber-50'
                              : 'text-amber-600 hover:bg-amber-50'
                          }`}
                          title={p.isAvailable ? 'Pausar (se me ha acabado)' : 'Reanudar: volver a la venta'}
                          aria-label={p.isAvailable ? `Pausar ${p.name}` : `Reanudar ${p.name}`}
                        >
                          {p.isAvailable ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => askRemoveProducts([{ id: p.id, name: p.name }])}
                          disabled={moving}
                          className="p-1.5 rounded-md text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-20 transition-colors"
                          title="Quitar de la carta"
                          aria-label={`Quitar ${p.name} de la carta`}
                        >
                          <X className="w-4 h-4" />
                        </button>
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

      {/* F4 — menú contextual del producto (clic derecho / long-press) */}
      {ctxMenu && (
        <ProductContextMenu
          target={ctxMenu.target}
          x={ctxMenu.x}
          y={ctxMenu.y}
          categories={allCats.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
          brands={ctxBrands.map((b) => ({ id: b.id, name: b.name }))}
          busy={moving}
          onClose={() => setCtxMenu(null)}
          onEditName={() => {
            setFieldEdit({ id: ctxMenu.target.id, name: ctxMenu.target.name, field: 'name', value: ctxMenu.target.name })
            setCtxMenu(null)
          }}
          onEditPrice={() => {
            const prod = filteredCategories.flatMap((c) => c.products).find((x) => x.id === ctxMenu.target.id)
            setFieldEdit({
              id: ctxMenu.target.id,
              name: ctxMenu.target.name,
              field: 'price',
              value: prod ? String(prod.price ?? '') : '',
            })
            setCtxMenu(null)
          }}
          onMoveToCategory={(categoryId) => {
            const id = ctxMenu.target.id
            void runCtxAction(async () => { await setMenuItemCategory(id, categoryId) })
          }}
          onDuplicate={() => {
            const id = ctxMenu.target.id
            void runCtxAction(async () => { await duplicateMenuItem(id) })
          }}
          onAddToBrand={(brandId) => {
            const t = ctxMenu.target
            const prod = filteredCategories.flatMap((c) => c.products).find((x) => x.id === t.id)
            void runCtxAction(async () => {
              if (!activeAccountId || !t.recipeItemId) return
              await addRecipeToBrand({
                accountId: activeAccountId,
                recipeItemId: t.recipeItemId,
                brandId,
                price: prod?.price ?? 0,
                name: t.name,
              })
            })
          }}
          onTogglePause={() => {
            const t = ctxMenu.target
            setCtxMenu(null)
            void togglePause({ id: t.id, name: t.name, isAvailable: t.isAvailable })
          }}
          onRemove={() => {
            const t = ctxMenu.target
            setCtxMenu(null)
            askRemoveProducts([{ id: t.id, name: t.name }])
          }}
          onOpenFicha={() => {
            const id = ctxMenu.target.id
            setCtxMenu(null)
            setSelectedProductId(id)
          }}
        />
      )}

      {/* Editar nombre / precio desde el menú contextual */}
      {fieldEdit && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => !moving && setFieldEdit(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200">
              <h3 className="text-base font-medium text-gray-900">
                {fieldEdit.field === 'name' ? 'Editar nombre' : 'Editar precio'}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{fieldEdit.name}</p>
            </div>
            <div className="px-5 py-4">
              <input
                autoFocus
                type="text"
                inputMode={fieldEdit.field === 'price' ? 'decimal' : 'text'}
                value={fieldEdit.value}
                disabled={moving}
                onChange={(e) => setFieldEdit({ ...fieldEdit, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void saveFieldEdit() }
                  if (e.key === 'Escape') { e.preventDefault(); setFieldEdit(null) }
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
              {fieldEdit.field === 'price' && (
                <p className="text-[11px] text-gray-400 mt-1.5">Precio base de esta carta, con IVA incluido.</p>
              )}
              {removeError && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{removeError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setFieldEdit(null)} disabled={moving}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">Cancelar</button>
              <button onClick={() => void saveFieldEdit()} disabled={moving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {moving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quitar producto(s) de la carta — mismo patrón que borrar categoría. */}
      {confirmRemoveProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !moving && setConfirmRemoveProduct(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center gap-2">
              <X className="w-4 h-4 text-red-600" />
              <h3 className="text-base font-medium text-gray-900">
                {confirmRemoveProduct.length === 1 ? 'Quitar de la carta' : `Quitar ${confirmRemoveProduct.length} productos`}
              </h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700">
              {confirmRemoveProduct.length === 1 ? (
                <>Vas a quitar <span className="font-medium">«{confirmRemoveProduct[0].name}»</span> de esta carta:
                dejará de venderse y de publicarse en los canales.</>
              ) : (
                <>Vas a quitar <span className="font-medium">{confirmRemoveProduct.length} productos</span> de esta
                carta: dejarán de venderse y de publicarse en los canales.</>
              )}

              {/* Aviso: se ha vendido hace nada. No bloquea, avisa. */}
              {recentSales !== null && recentSales > 0 && (
                <div className="mt-3 p-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {confirmRemoveProduct.length === 1 ? 'Se ha vendido' : 'Se han vendido'}{' '}
                    <span className="font-medium">{recentSales} {recentSales === 1 ? 'vez' : 'veces'}</span> esta semana.
                    Si solo se ha agotado hoy, quizá busques pausarlo en vez de quitarlo de la carta.
                  </span>
                </div>
              )}

              <div className="mt-2 text-gray-500">
                {confirmRemoveProduct.length === 1 ? 'Su escandallo y las ventas' : 'Sus escandallos y las ventas'}{' '}
                ya registradas no se tocan, y puedes volver a {confirmRemoveProduct.length === 1 ? 'añadirlo' : 'añadirlos'} cuando quieras.
              </div>
              {removeError && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{removeError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setConfirmRemoveProduct(null)} disabled={moving}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">Cancelar</button>
              <button onClick={() => void removeProductsFromMenu(confirmRemoveProduct)} disabled={moving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-red-600 text-white hover:opacity-90 disabled:opacity-50">
                {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                {moving ? 'Quitando…' : confirmRemoveProduct.length === 1 ? 'Quitar de la carta' : `Quitar ${confirmRemoveProduct.length}`}
              </button>
            </div>
          </div>
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

      {/* ── ENSAYO antes de publicar (19/08) ────────────────────────────────
          Ni un byte ha salido hacia HubRise todavía. Esta pantalla dice DÓNDE
          se va a escribir, con el nombre del local y el id del catálogo, y
          enseña los precios por canal con su variante — que es lo que nunca
          habíamos llegado a ver, porque la validación de HubRise fallaba antes. */}
      {dryRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDryRun(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200">
              <h3 className="text-base font-medium text-gray-900">
                {dryRun.ok
                  ? <>Vas a publicar <span className="font-semibold">{selectedBrand?.name}</span> en <span className="underline decoration-2">{ambitoNombre}</span></>
                  : 'No se puede publicar'}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Todavía no se ha enviado nada a HubRise. Publicar de verdad es el botón de abajo.
              </p>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-3 max-h-[60vh] overflow-auto">
              {dryRun.error && <p className="text-red-700">{dryRun.error}</p>}

              {dryRun.ok && dryRun.scope === 'all' && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    Ámbito <span className="font-semibold">toda la cuenta</span>: se van a reemplazar los{' '}
                    <span className="font-semibold">{dryRun.targets.length} catálogos</span> de la marca, en{' '}
                    <span className="font-semibold">todos</span> sus locales. Si sólo quieres uno, ciérralo y elige el local arriba.
                  </p>
                </div>
              )}

              {dryRun.catalogos_descartados_por_ambito > 0 && (
                <p className="text-xs text-gray-500">
                  {dryRun.catalogos_descartados_por_ambito} catálogo(s) de otros locales quedan fuera por el ámbito elegido.
                </p>
              )}

              {dryRun.targets.map((t) => (
                <div key={t.external_catalog_id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{t.connection_name || '(sin nombre de conexión)'}</span>
                    <span className="text-xs font-mono text-gray-500">catálogo {t.external_catalog_id}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.productos} producto(s){t.location_id ? '' : ' · sin local asociado en la conexión'}
                  </div>
                  {/* LOS PRECIOS QUE CAMBIAN. El total va primero y sale del
                      total, no de lo que se enseñe: una pantalla de
                      confirmación nunca describe una muestra. */}
                  {(t.precios_propios_total ?? 0) === 0 ? (
                    <div className="text-xs text-gray-600 mt-2">
                      Este catálogo se publica con los <span className="font-medium">precios base</span>:
                      ningún precio propio por canal.
                    </div>
                  ) : (
                    <div className="mt-2">
                      <div className="text-xs font-medium text-gray-900 mb-1">
                        {t.precios_propios_total} precio{t.precios_propios_total === 1 ? '' : 's'} propio{t.precios_propios_total === 1 ? '' : 's'} por canal
                        <span className="font-normal text-gray-500"> · se publican distintos del base</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left font-medium py-0.5">Producto</th>
                            <th className="text-left font-medium">Canal</th>
                            <th className="text-right font-medium">Base</th>
                            <th className="text-right font-medium">Se publica</th>
                            <th className="text-right font-medium">Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(t.precios_propios ?? []).slice(0, PRECIOS_VISIBLES).map((c, i) => (
                            <tr key={`${c.ref}-${i}`} className="border-t border-gray-100">
                              <td className="py-0.5 pr-2 text-gray-800">{c.nombre}</td>
                              <td className="pr-2 text-gray-600">{c.canales.map(canalBonito).join(', ')}</td>
                              <td className="text-right tabular-nums text-gray-500">{precioBonito(c.base)}</td>
                              <td className="text-right tabular-nums font-medium text-gray-900">{precioBonito(c.se_publica)}</td>
                              <td className={`text-right tabular-nums font-medium ${
                                c.delta_pct === null ? 'text-gray-400'
                                  : c.delta_pct < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                {c.delta_pct === null ? '—' : `${c.delta_pct > 0 ? '+' : ''}${c.delta_pct} %`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(t.precios_propios_total ?? 0) > PRECIOS_VISIBLES && (
                        <div className="text-xs text-gray-500 mt-1">
                          y {(t.precios_propios_total ?? 0) - PRECIOS_VISIBLES} más.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setDryRun(null)}
                className="px-3.5 py-1.5 text-sm rounded-lg font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              {dryRun.ok && (
                <button onClick={confirmarPublicacion} disabled={publishing}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-green-600 text-white hover:opacity-90 disabled:opacity-50">
                  {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {publishing ? 'Publicando…' : `Publicar en ${ambitoNombre}`}
                </button>
              )}
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

      {connectResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConnectResult(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center gap-2">
              {connectResult.ok
                ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                : <AlertTriangle className="w-5 h-5 text-red-600" />}
              <h3 className="text-base font-medium text-gray-900">
                {connectResult.ok ? 'Marca conectada a delivery' : 'No se pudo conectar'}
              </h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-3 max-h-[60vh] overflow-auto">
              {connectResult.error && <p className="text-red-700">{connectResult.error}</p>}
              {connectResult.locations.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Por local</div>
                  <ul className="space-y-1">
                    {connectResult.locations.map((l, i) => (
                      <li key={i} className="flex items-start gap-2">
                        {l.status === 'error'
                          ? <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          : <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />}
                        <span>
                          <span className="font-medium">{l.location_name}</span>
                          {' · '}
                          {l.status === 'ya_conectada' && 'ya conectada'}
                          {l.status === 'creada' && 'catálogo creado'}
                          {l.status === 'reusada_por_nombre' && 'catálogo reusado'}
                          {l.status === 'error' && 'error'}
                          {l.external_catalog_id && (
                            <span className="text-gray-400"> ({l.external_catalog_id})</span>
                          )}
                          {l.status === 'error' && l.error && (
                            <span className="block text-xs text-red-600">{l.error}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {connectResult.publish && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Publicación de la carta</div>
                  {connectResult.publish.ok ? (
                    <p className="text-gray-600">
                      {connectResult.publish.products ?? 0} producto{(connectResult.publish.products ?? 0) === 1 ? '' : 's'} · {connectResult.publish.deals ?? 0} combo{(connectResult.publish.deals ?? 0) === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="text-red-700">{connectResult.publish.error ?? 'No se pudo publicar la carta.'}</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setConnectResult(null)}
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
      {showAddExisting && activeAccountId && selectedBrand && (
        <AddExistingProductModal
          accountId={activeAccountId}
          brandId={selectedBrand.id}
          brandName={selectedBrand.name}
          onClose={() => setShowAddExisting(false)}
          onDone={refreshAfterCreate}
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

function ReliabilityBanner({ signal, onOpen, onFix }: { signal: SalesReliability; onOpen: () => void; onFix: () => void }) {
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
      <div className="flex items-center gap-2 shrink-0">
        {/* Accion principal: la cola guiada que persigue cada fallo hasta corregirlo. */}
        <button
          onClick={onFix}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Arreglar paso a paso
        </button>
        <button
          onClick={onOpen}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
        >
          Ver excepciones
        </button>
      </div>
    </div>
  )
}

// Banner-resumen del sello de enlace ítem↔escandallo — TODA la cuenta (no solo
// la marca visible). rows viene de menu_item_link_health sin filtrar por
// marca; los contadores son la única fuente de verdad, igual que el sello.
function LinkHealthBanner({ rows, onOpen }: { rows: MenuItemLinkHealthRow[]; onOpen: () => void }) {
  const sinCasar = rows.filter((r) => classifyMenuItemLink(r).human === 'sin_casar').length
  const faltaAlgo = rows.filter((r) => {
    const h = classifyMenuItemLink(r).human
    return h === 'falta_escandallo' || h === 'falta_precio'
  }).length
  const paraRevisar = rows.filter((r) => classifyMenuItemLink(r).human === 'para_revisar').length
  const bien = rows.filter((r) => classifyMenuItemLink(r).human === 'bien').length
  if (sinCasar === 0 && faltaAlgo === 0 && paraRevisar === 0) return null // nada que auditar — no molestar

  const cardBg = sinCasar > 0 ? 'bg-red-50 border-red-200' : faltaAlgo > 0 ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'
  const dot = sinCasar > 0 ? 'bg-red-500' : faltaAlgo > 0 ? 'bg-orange-500' : 'bg-amber-500'
  const valueColor = sinCasar > 0 ? 'text-red-700' : faltaAlgo > 0 ? 'text-orange-700' : 'text-amber-700'

  return (
    <div className={`rounded-xl border p-3 mb-5 flex items-center gap-3 flex-wrap ${cardBg}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${dot} shrink-0`} />
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${valueColor}`}>
          Casado: {sinCasar} sin casar · {faltaAlgo} sin precio/escandallo · {paraRevisar} para revisar
        </span>
        <span className="text-xs text-gray-500"> · {bien} bien</span>
      </div>
      <button
        onClick={onOpen}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shrink-0"
      >
        Abrir Casado
      </button>
    </div>
  )
}
