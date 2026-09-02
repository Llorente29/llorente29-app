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
import { Search, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, AlertTriangle, ChefHat, Clock, Package, Link2Off, Link2, Plus, FolderPlus, ArrowRightLeft, X, Undo2, Info, ArrowUp, ArrowDown, Trash2, UploadCloud, Loader2, Sparkles, PackagePlus, ScanSearch, CircleSlash, GripVertical, Smile, Archive, MoveVertical, ImagePlus, Star, TrendingUp, TrendingDown } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { fmtMoney } from '@/lib/format'
import {
  listBrandsWithCatalog,
  listCategoriesWithProducts,
  type CatalogBrand,
  type CatalogCategory,
} from '@/modules/kitchen/services/brandCatalogService'
import { setMenuItemCategoryBulk, reorderMenuItems, archiveMenuItem, restoreMenuItem, countRecentSales, duplicateMenuItem, updateMenuItem, setMenuItemCategory, addRecipeToBrand, listAccountBrands, listBrandsForRecipe, type AccountBrandLite } from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, reorderMenuCategories, deactivateMenuCategory, updateMenuCategory, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'
import { setProductAvailability } from '@/modules/kitchen/services/menuOverrideService'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import ProductContextMenu, { type ContextMenuTarget } from '@/modules/kitchen/components/ProductContextMenu'
import MenuFilterChips from '@/modules/kitchen/components/MenuFilterChips'
import {
  EMPTY_FILTERS, anyFilterActive, type MenuFilters,
} from '@/modules/kitchen/components/menuFilters'
import ChannelBadges from '@/modules/kitchen/components/ChannelBadges'
import InlineEdit from '@/modules/kitchen/components/InlineEdit'
import CategoryEmojiPicker from '@/modules/kitchen/components/CategoryEmojiPicker'
import Sortable from '@/modules/kitchen/components/Sortable'
import DropZone from '@/modules/kitchen/components/DropZone'
import {
  listBrandChannelPublication, type BrandChannelPublication,
} from '@/modules/kitchen/services/channelPublicationService'
import {
  getMenuInsights, listRecipeCosts, EMPTY_INSIGHTS, type MenuInsights,
} from '@/modules/kitchen/services/menuInsightsService'
import {
  listAllergensForRecipes, type AllergensByRecipe,
} from '@/modules/kitchen/services/menuAllergenBulkService'
import MarginBar from '@/modules/kitchen/components/MarginBar'
import ProductTagChips from '@/modules/kitchen/components/ProductTagChips'
import AllergenChips from '@/modules/kitchen/components/AllergenChips'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  DragOverlay, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
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
import {
  publishBrandCatalog, dryRunBrandCatalog, listPublishLocations,
  alcanceDePublicacion, enumeraNombres,
  type PublishResult, type DryRunResult, type LocalPublicable,
} from '@/modules/kitchen/services/catalogPublishService'
import PublishStatusChip from '@/modules/kitchen/components/PublishStatusChip'
import { connectBrandToDelivery, type ConnectResult } from '@/modules/kitchen/services/hubriseBrandConnectService'

// "Agotado · 2 días" / "· 5h". Por debajo de una hora no se dice nada: un
// "· 0h" sería ruido, y el 86 acaba de ponerse.
function formatSince(hours: number): string | null {
  if (hours < 1) return null
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 día' : `${days} días`
}

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
  // ── F2: chips de filtro. Todo se filtra en memoria salvo "Archivados", que
  // pide datos que la carta no trae por definición (están fuera de ella). ──
  const [filters, setFilters] = useState<MenuFilters>({ ...EMPTY_FILTERS })
  const [loadingArchived, setLoadingArchived] = useState(false)
  // ── F6: publicación por canal, una consulta para toda la lista ──
  const [channelPub, setChannelPub] = useState<BrandChannelPublication | null>(null)
  // ── Datos de negocio: ventas por producto, tendencia de marca, top y 86
  // olvidados. Sin esto la carta es un listado; con esto es un panel. ──
  const [insights, setInsights] = useState<MenuInsights>(EMPTY_INSIGHTS)
  const [allergens, setAllergens] = useState<AllergensByRecipe>(new Map())
  // Coste de plato por receta. NO sale de menu_item_economics: esa RPC hace
  // INNER JOIN con sales_channel y menu_item.channel_id es NULL en las 513
  // filas de la cuenta, así que devuelve cero filas SIEMPRE. Ver el servicio.
  const [recipeCosts, setRecipeCosts] = useState<Map<string, number>>(new Map())
  const [showAlerts, setShowAlerts] = useState(false)
  // ── F3: emoji de categoría y aviso de guardado ──
  const [emojiPickerCat, setEmojiPickerCat] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // ── F5: en móvil el long-press ya es el menú contextual, así que arrastrar
  // exige entrar en un modo explícito (lo mismo que hace Square). ──
  const [reorderMode, setReorderMode] = useState(false)
  const [dragging, setDragging] = useState<{ kind: 'product' | 'category'; id: string; label: string } | null>(null)
  // ¿Se puede arrastrar ahora? En escritorio (>= sm) siempre; en móvil solo
  // dentro del "modo reordenar", porque el long-press ya es el menú contextual.
  // Se mira el ancho una vez y se escucha el resize: sin esto, un teléfono en
  // horizontal se quedaría con las reglas del vertical.
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 640px)').matches : true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 640px)')
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const dndDisabled = !isDesktop && !reorderMode
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; count: number } | null>(null)
  // Publicador (T2a): publicar la carta de la marca a HubRise.
  // ÁMBITO (19/08): publicar iba SIEMPRE a todos los catálogos de la marca
  // porque el panel no pasaba location_id, aunque el Edge lo acepta desde el
  // 17/08. Meraki Pita se publicó a Alcalá y Carabanchel a la vez. Ahora el
  // ámbito se elige, viaja explícito, y antes de escribir hay un ENSAYO.
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  // OJO: `publishLocationId` (abajo) es el AMBITO DE PUBLICACION, no el local
  // en el que se agota. Son dos cosas distintas y mezclarlas fue el fallo: el
  // 86 usa el local del selector de cabecera.
  const { resolvedLocationId } = useLocationScope()
  const [publishLocations, setPublishLocations] = useState<LocalPublicable[]>([])
  const [publishLocationId, setPublishLocationId] = useState<string | null>(null)
  // Consentimiento aparte cuando la publicación toca MÁS DE UN local. Se
  // reinicia en cada ensayo: nunca se hereda de la vez anterior.
  const [asumoVariosLocales, setAsumoVariosLocales] = useState(false)
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
    // "Archivados" es el ÚNICO filtro que cambia la consulta: los archivados no
    // están en la carta por definición, así que no se pueden filtrar en memoria
    // sobre algo que nunca llegó. El resto de chips no recargan nada.
    const includeArchived = filters.archivados
    if (includeArchived) setLoadingArchived(true)
    Promise.all([
      listCategoriesWithProducts(activeAccountId, selectedBrandId, null, { includeArchived }),
      listMenuCategories(activeAccountId, selectedBrandId).catch(() => [] as MenuCategory[]),
      getMenuItemLinkHealth(activeAccountId, selectedBrandId).catch((e: unknown) => {
        console.warn('KitchenMenuPage: fallo cargando salud de escandallos de la marca', e)
        return [] as MenuItemLinkHealthRow[]
      }),
    ])
      .then(([cats, all, health]) => {
        if (cancelled) return
        setCategories(cats)
        setAllCats(all)
        const lh = new Map<string, MenuItemLinkHealthRow>()
        for (const r of health) lh.set(r.menuItemId, r)
        setLinkHealth(lh)
      })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => {
        if (cancelled) return
        setLoadingCatalog(false)
        setLoadingArchived(false)
      })
    return () => { cancelled = true }
  }, [activeAccountId, selectedBrandId, filters.archivados])

  // F6 · Publicación por canal. Va DESPUÉS del catálogo y en su propio efecto:
  // es información de apoyo, así que si falla la carta se sigue viendo entera y
  // solo desaparecen los chips. Una consulta para toda la lista, no una por fila.
  useEffect(() => {
    if (!activeAccountId) return
    const ids = categories.flatMap((c) => c.products.map((p) => p.id))
    let cancelled = false
    // Sin productos no se consulta, pero tampoco se hace setState en seco
    // dentro del efecto: eso encadena renders y el linter lo canta con razón.
    const load = ids.length === 0
      ? Promise.resolve(null)
      : listBrandChannelPublication(activeAccountId, ids)
    load
      .then((r) => { if (!cancelled) setChannelPub(r) })
      .catch((e: unknown) => {
        if (cancelled) return
        console.warn('KitchenMenuPage: fallo cargando la publicación por canal', e)
        setChannelPub(null)
      })
    return () => { cancelled = true }
  }, [activeAccountId, categories])

  // Ventas y tendencia de la marca. Igual que los canales: efecto propio y
  // degradación en silencio — un panel que se cae porque falta un número es
  // peor que un panel sin ese número.
  useEffect(() => {
    if (!activeAccountId || !selectedBrandId) return
    let cancelled = false
    getMenuInsights(activeAccountId, selectedBrandId)
      .then((r) => { if (!cancelled) setInsights(r) })
      .catch((e: unknown) => {
        if (cancelled) return
        console.warn('KitchenMenuPage: fallo cargando ventas de la marca', e)
        setInsights(EMPTY_INSIGHTS)
      })
    return () => { cancelled = true }
  }, [activeAccountId, selectedBrandId])

  // Alérgenos de toda la carta en dos consultas (no una por plato).
  useEffect(() => {
    const ids = Array.from(new Set(
      categories.flatMap((c) => c.products.map((p) => p.recipeItemId).filter((x): x is string => !!x))))
    let cancelled = false
    const load = ids.length === 0
      ? Promise.resolve([new Map() as AllergensByRecipe, new Map<string, number>()] as const)
      : Promise.all([listAllergensForRecipes(ids), listRecipeCosts(ids)] as const)
    load
      .then(([a, c]) => {
        if (cancelled) return
        setAllergens(a)
        setRecipeCosts(c)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        console.warn('KitchenMenuPage: fallo cargando alérgenos o costes', e)
        setAllergens(new Map())
        setRecipeCosts(new Map())
      })
    return () => { cancelled = true }
  }, [categories])

  // El aviso "Guardado" del inline edit se va solo: es una confirmación, no un
  // error, y no debe pedir un clic para desaparecer.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId],
  )


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

  // Búsqueda + chips (F2). Los chips SUMAN entre sí: marcar "Sin foto" y
  // "Agotados" pide los que cumplen las dos cosas, no los que cumplen alguna.
  // Es lo que espera quien busca "los que hay que arreglar".
  //
  // "Archivados" es distinto de los otros tres: no acota, SUSTITUYE. Marcado
  // solo, enseña los que se quitaron de la carta; sin marcar, no aparece
  // ninguno. Mezclarlos con los vivos sin decirlo sería pintar como carta algo
  // que no lo es.
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase()
    const active = anyFilterActive(filters)
    if (!q && !active) {
      return displayCategories.map((c) => ({
        ...c, products: c.products.filter((p) => !p.archivedAt),
      }))
    }
    return displayCategories
      .map((c) => ({
        ...c,
        products: c.products.filter((p) => {
          if (q && !p.name.toLowerCase().includes(q)) return false
          if (filters.archivados) { if (!p.archivedAt) return false }
          else if (p.archivedAt) return false
          if (filters.sinEscandallo && p.recipeItemId !== null) return false
          if (filters.sinFoto && p.photoUrl) return false
          if (filters.agotados && p.isAvailable) return false
          return true
        }),
      }))
      .filter((c) => c.products.length > 0)
  }, [displayCategories, search, filters])

  // Margen medio PONDERADO POR VENTAS de la marca. Solo entran los platos con
  // escandallo Y con ventas: un plato sin coste no tiene margen que promediar, y
  // uno sin ventas no ha aportado nada a la caja de esta semana.
  const avgMargin = useMemo(() => {
    let revenue = 0
    let margin = 0
    for (const c of displayCategories) {
      for (const p of c.products) {
        if (p.archivedAt) continue
        const cost = p.recipeItemId ? recipeCosts.get(p.recipeItemId) : undefined
        const units = insights.byItem.get(p.id)?.units7d ?? 0
        if (cost === undefined || units <= 0 || p.price <= 0) continue
        revenue += p.price * units
        margin += (p.price - cost) * units
      }
    }
    return revenue > 0 ? (margin / revenue) * 100 : null
  }, [displayCategories, recipeCosts, insights])

  // Las alertas del header. Cada una sabe qué filtro la enseña, para que
  // pulsarla lleve a los productos concretos y no a una lista genérica.
  const alerts = useMemo(() => {
    const live = displayCategories.flatMap((c) => c.products).filter((p) => !p.archivedAt)
    const sinFoto = live.filter((p) => !p.photoUrl).length
    const sinEscandallo = live.filter((p) => !p.recipeItemId && p.productType !== 'combo').length
    // Los 86 olvidados se casan por receta o por matrícula, que es como los
    // guarda product_availability.
    const staleIds = new Set<string>()
    for (const s of insights.stale86) {
      for (const p of live) {
        if (!p.isAvailable && s.recipeItemId && p.recipeItemId === s.recipeItemId) staleIds.add(p.id)
      }
    }
    const agotadoViejo = staleIds.size
    return {
      sinFoto, sinEscandallo, agotadoViejo,
      total: sinFoto + sinEscandallo + agotadoViejo,
    }
  }, [displayCategories, insights])

  // Cuántos pasan el filtro, para el contador de los chips. Se cuenta sobre los
  // VIVOS: comparar contra un total que incluya archivados daría un "12 de 520"
  // que no significa nada.
  const filterCounts = useMemo(() => {
    if (!anyFilterActive(filters)) return null
    const total = displayCategories.reduce(
      (n, c) => n + c.products.filter((p) => (filters.archivados ? p.archivedAt : !p.archivedAt)).length, 0)
    const shown = filteredCategories.reduce((n, c) => n + c.products.length, 0)
    return { shown, total }
  }, [displayCategories, filteredCategories, filters])

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
  }

  // Tras crear un COMBO: recargar y abrir su ficha para montarle los grupos ya.
  function afterCreateCombo(newId?: string) {
    refreshAfterCreate()
    if (newId) setSelectedProductId(newId)
  }

  // ── Publicar la carta de la marca a HubRise (T2a) ─────────────────────────
  // DOS PUERTAS. El botón hace el ENSAYO, que no manda un byte a HubRise; la
  // publicación de verdad es un segundo clic, ya sabiendo a qué catálogo va.
  // A QUIÉN LE CAMBIA EL ESCAPARATE. Sale del servicio, que es donde vive la
  // regla; esta pantalla ya no tiene su propia idea de lo que es «el ámbito».
  const alcance = alcanceDePublicacion(publishLocationId, publishLocations)
  const ambitoNombre = alcance.frase

  // Los locales que el ENSAYO dice que van a quedar afectados, por nombre. El
  // desplegable dice lo que se PIDIÓ; los destinos dicen lo que hay conectado,
  // y es lo segundo lo que se reemplaza. Se ordenan para que la frase no baile.
  const localesDelEnsayo: string[] = useMemo(() => {
    const ids = new Set((dryRun?.targets ?? []).map((t) => t.location_id).filter((x): x is string => !!x))
    const nombres = [...ids].map((id) => publishLocations.find((l) => l.id === id)?.name ?? `local ${id.slice(0, 8)}`)
    return nombres.sort((x, y) => x.localeCompare(y, 'es'))
  }, [dryRun, publishLocations])

  const catalogosSinLocal = (dryRun?.targets ?? []).filter((t) => !t.location_id).length

  // CONSENTIMIENTO APARTE. No es un permiso que se niegue: es una consecuencia
  // que no se puede descubrir después. Se pide cuando la publicación toca más
  // de un local, y también cuando no se sabe a cuáles toca — que es peor.
  const necesitaConsentimiento = !!dryRun?.ok
    && (localesDelEnsayo.length > 1 || (localesDelEnsayo.length === 0 && (dryRun?.targets.length ?? 0) > 0))

  async function handlePublish() {
    if (!selectedBrand || publishing || dryRunning) return
    setDryRunning(true)
    setPublishResult(null)
    setDryRun(null)
    setAsumoVariosLocales(false)
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
    // «Conectar a delivery» TAMBIÉN publica, y sin pasar por el ensayo. Si el
    // ámbito es más de un local hay que decir cuáles antes de tocar el
    // escaparate vivo — la misma regla que el botón de publicar.
    if (alcance.esMultiple && !window.confirm(
      `Conectar publica la carta de ${selectedBrand.name} y reemplaza el escaparate vivo en ${alcance.frase}.\n\n` +
      'Si sólo quieres uno, cancela y elígelo en el desplegable de al lado. ¿Seguir?')) return
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

  // ── Agotar / reactivar (86) desde la lista ───────────────────────────────
  // Misma vía que la ficha: setProductAvailability -> RPC set_product_availability,
  // que cascadea CROSS-BRAND (el producto físico es el mismo en todas las marcas
  // que comparten escandallo o matrícula) y empuja a availability-dispatch, que
  // hace PATCH de inventario en HubRise. Por eso no se pide confirmación previa
  // pero SÍ se dice el alcance real después, con Deshacer: agotar tiene que ser
  // de un toque, y el alcance no se puede saber hasta que responde el servidor.
  //
  // Mismo vocabulario que la ficha y que Disponibilidad ("Agotado · reactivar"):
  // es un único campo (is_available) y llamarlo de dos maneras confunde.
  async function toggleAvailability(p: { id: string; name: string; isAvailable: boolean }) {
    if (moving) return
    // Sin local elegido no se agota. Hasta el 28/08 esto agotaba en TODOS los
    // locales sin decirlo, porque la funcion ni aceptaba local.
    if (resolvedLocationId === null) {
      setRemoveError('Elige un local en la cabecera para agotar o reactivar. Desde «todos los locales» no se puede: el 86 es de un local concreto.')
      return
    }
    const next = !p.isAvailable
    setMoving(true)
    setRemoveError(null)
    try {
      const res = await setProductAvailability(p.id, next, resolvedLocationId, 'manual')
      reloadCatalogProducts()
      const alcance = res.brands > 1 ? ` · ${res.brands} marcas` : ''
      const canales = res.channels > 0 ? ` · ${res.channels} canal${res.channels === 1 ? '' : 'es'}` : ''
      setUndo({
        label: next
          ? `«${p.name}» reactivado${alcance}`
          : `«${p.name}» agotado${alcance}${canales}`,
        revert: async () => {
          await setProductAvailability(p.id, p.isAvailable, resolvedLocationId, 'manual')
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

  // ── F3 · Edición en la fila (sin modal) ───────────────────────────────────
  // Optimista: se pinta ya y, si el servidor dice que no, InlineEdit revierte y
  // enseña el fallo. `patchProduct` toca SOLO el estado local; la recarga
  // completa costaría una consulta por cada nombre corregido.
  function patchProduct(id: string, patch: Partial<CatalogCategory['products'][number]>) {
    setCategories((prev) => prev.map((c) => ({
      ...c, products: c.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })))
  }

  async function saveProductName(id: string, next: string) {
    await updateMenuItem(id, { name: next })
    patchProduct(id, { name: next })
    setToast('Guardado')
  }

  async function saveProductPrice(id: string, raw: string) {
    // "12,50" y "12.50" son la misma cifra para quien la teclea. Que el punto
    // decimal sea coma en español no puede ser motivo de un error.
    const n = Number(raw.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) throw new Error('Precio no válido')
    await updateMenuItem(id, { price: n })
    patchProduct(id, { price: n })
    setToast('Guardado')
  }

  async function saveCategoryName(catId: string, next: string) {
    await updateMenuCategory(catId, { name: next })
    setAllCats((prev) => prev.map((c) => (c.id === catId ? { ...c, name: next } : c)))
    setToast('Guardado')
  }

  async function saveCategoryEmoji(catId: string, emoji: string | null) {
    try {
      await updateMenuCategory(catId, { emoji })
      setAllCats((prev) => prev.map((c) => (c.id === catId ? { ...c, emoji } : c)))
      setToast('Guardado')
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  // ── F5 · Arrastrar y soltar ───────────────────────────────────────────────
  // El sensor de puntero exige 6 px de recorrido antes de considerar que esto
  // es un arrastre: sin esa distancia, un clic normal en la fila se comería el
  // "abrir ficha". En táctil hace falta ADEMÁS una pausa de 250 ms, porque el
  // dedo se mueve al hacer scroll — y aun así el arrastre en móvil solo existe
  // dentro del "modo reordenar", que el usuario enciende a propósito: el
  // long-press ya está ocupado por el menú contextual (F4) y dos gestos no
  // pueden pelearse por el mismo dedo.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6, delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    if (id.startsWith('cat:')) {
      const c = allCats.find((x) => `cat:${x.id}` === id)
      setDragging(c ? { kind: 'category', id: c.id, label: c.name } : null)
      return
    }
    const prod = filteredCategories.flatMap((c) => c.products).find((x) => x.id === id)
    setDragging(prod ? { kind: 'product', id: prod.id, label: prod.name } : null)
  }

  // Reordenar categorías. Se persiste el orden COMPLETO (reorderMenuCategories
  // ya espera la lista entera), no solo las dos que se cruzan.
  async function handleCategoryDragEnd(activeId: string, overId: string) {
    const from = allCats.findIndex((c) => `cat:${c.id}` === activeId)
    const to = allCats.findIndex((c) => `cat:${c.id}` === overId)
    if (from < 0 || to < 0 || from === to) return
    const next = arrayMove(allCats, from, to)
    const before = allCats
    setAllCats(next)                               // optimista
    setMoving(true)
    try {
      await reorderMenuCategories(next.map((c, i) => ({ id: c.id, position: i })))
    } catch (err) {
      setAllCats(before)                           // vuelta atrás
      setError(String((err as Error).message ?? err))
    } finally {
      setMoving(false)
    }
  }

  // Reordenar productos DENTRO de una categoría, o moverlos ENTRE categorías.
  // El destino se resuelve por el contenedor del elemento sobre el que se
  // suelta; soltar sobre la cabecera de una categoría vacía también vale, y por
  // eso existen los ids "drop:<catId>".
  async function handleProductDragEnd(activeId: string, overId: string) {
    const findCat = (productId: string) =>
      filteredCategories.find((c) => c.products.some((p) => p.id === productId)) ?? null
    const srcCat = findCat(activeId)
    if (!srcCat) return

    const dstCat = overId.startsWith('drop:')
      ? filteredCategories.find((c) => `drop:${c.id}` === overId) ?? null
      : findCat(overId)
    if (!dstCat) return

    const realCatId = (id: string) => (id === '__sin_categoria__' ? null : id)

    if (dstCat.id === srcCat.id) {
      const from = srcCat.products.findIndex((p) => p.id === activeId)
      const to = overId.startsWith('drop:') ? srcCat.products.length - 1 : srcCat.products.findIndex((p) => p.id === overId)
      if (from < 0 || to < 0 || from === to) return
      const nextProducts = arrayMove(srcCat.products, from, to)
      const before = categories
      setCategories((prev) => prev.map((c) => (c.id === srcCat.id ? { ...c, products: nextProducts } : c)))
      setMoving(true)
      try {
        await reorderMenuItems(nextProducts.map((p, i) => ({ id: p.id, position: i })))
      } catch (err) {
        setCategories(before)
        setError(String((err as Error).message ?? err))
      } finally { setMoving(false) }
      return
    }

    // Entre categorías: cambia la categoría y, ya puesto, se renumera el destino
    // para que el producto caiga donde se ha soltado y no al final.
    const moved = srcCat.products.find((p) => p.id === activeId)
    if (!moved) return
    const insertAt = overId.startsWith('drop:')
      ? dstCat.products.length
      : Math.max(0, dstCat.products.findIndex((p) => p.id === overId))
    const nextDst = [...dstCat.products]
    nextDst.splice(insertAt, 0, moved)
    const before = categories
    setCategories((prev) => prev.map((c) => {
      if (c.id === srcCat.id) return { ...c, products: c.products.filter((p) => p.id !== activeId) }
      if (c.id === dstCat.id) return { ...c, products: nextDst }
      return c
    }))
    setMoving(true)
    try {
      await setMenuItemCategory(activeId, realCatId(dstCat.id))
      await reorderMenuItems(nextDst.map((p, i) => ({ id: p.id, position: i })))
      setToast(`Movido a ${dstCat.name}`)
    } catch (err) {
      setCategories(before)
      setError(String((err as Error).message ?? err))
    } finally { setMoving(false) }
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    if (activeId.startsWith('cat:')) { void handleCategoryDragEnd(activeId, overId); return }
    void handleProductDragEnd(activeId, overId)
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
    return <div className="p-6 text-sm text-text-secondary">Cargando carta…</div>
  }

  if (brands.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-text-primary mb-2">Cartas</h1>
        <p className="text-sm text-text-secondary">
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
        <h1 className="text-2xl font-semibold text-text-primary">Cartas</h1>
        <select
          value={selectedBrandId ?? ''}
          onChange={(e) => setSelectedBrandId(e.target.value)}
          className="border border-border-default rounded-lg px-3 py-1.5 text-sm font-medium bg-white"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {selectedBrand?.ownershipType && (
          <span className="text-xs text-text-secondary">
            marca · {selectedBrand.ownershipType === 'own' ? 'propia' : 'cedida'}
          </span>
        )}
        {selectedBrand && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowNewCategory(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-white text-text-primary hover:bg-page"
            >
              <FolderPlus className="w-4 h-4" /> Categoría
            </button>
            <button
              onClick={() => setShowAddExisting(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-white text-text-primary hover:bg-page"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-white text-text-primary hover:bg-page"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-white text-text-primary hover:bg-page"
              title="Marcas que llegan de los integradores y no están atribuidas a ninguna marca de Folvy"
            >
              <ScanSearch className="w-4 h-4" /> Marcas de fuera
            </button>
            {selectedBrand.catalogSource === 'folvy' && (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium border border-border-default bg-white text-text-primary hover:bg-page disabled:opacity-50"
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
                  className="px-2 py-1.5 text-sm rounded-lg border border-border-default bg-white text-text-primary"
                >
                  <option value="">
                    {publishLocations.length > 1
                      ? `Todos los locales: ${enumeraNombres(publishLocations.map((l) => l.name))}`
                      : 'Toda la cuenta (todos los catálogos)'}
                  </option>
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

      {/* HEADER EJECUTIVO. Los KPIs de antes —productos, combos, agotados— son
          datos de inventario: contestan "qué tengo", no "¿va bien esta marca?".
          Estos tres contestan lo segundo, que es la pregunta que se hace quien
          abre la pantalla. La cobertura de escandallo no desaparece: baja a ser
          una alerta, que es lo que de verdad es cuando no está al 100%. */}
      {selectedBrand && (
        <div className="mb-5 rounded-xl border border-border-default bg-card px-4 py-4 sm:px-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {/* Ventas 7 días + tendencia */}
            <div>
              <div className="text-2xl sm:text-3xl font-display font-medium text-text-primary tabular-nums leading-none">
                {formatEur(insights.brand.revenue7d)}
              </div>
              <div className="text-[12px] text-text-secondary mt-1.5">ventas 7 días</div>
              {insights.brand.trendPct !== null && (
                <div className={`text-[12px] mt-0.5 inline-flex items-center gap-1 tabular-nums font-medium
                  ${insights.brand.trendPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {insights.brand.trendPct >= 0
                    ? <TrendingUp className="w-3.5 h-3.5" />
                    : <TrendingDown className="w-3.5 h-3.5" />}
                  {insights.brand.trendPct >= 0 ? '+' : ''}{Math.round(insights.brand.trendPct)}% vs sem. ant.
                </div>
              )}
            </div>

            {/* Margen medio PONDERADO POR VENTAS. Un margen simple daría el mismo
                peso al plato estrella y al que se vende una vez al mes, y eso no
                es el margen del negocio: es una media de números sueltos. */}
            <div>
              <div className="text-2xl sm:text-3xl font-display font-medium text-text-primary tabular-nums leading-none">
                {avgMargin === null ? '—' : `${Math.round(avgMargin)}%`}
              </div>
              <div className="text-[12px] text-text-secondary mt-1.5">
                margen medio
                {avgMargin !== null && <span className="hidden sm:inline"> · ponderado por ventas</span>}
              </div>
              {avgMargin === null && (
                <div className="text-[12px] text-text-secondary mt-0.5">
                  sin ventas con escandallo aún
                </div>
              )}
            </div>

            {/* Alertas: agrupadas y ACCIONABLES. Un contador que no lleva a
                ningún sitio es decoración. */}
            <div>
              <div className={`text-2xl sm:text-3xl font-display font-medium tabular-nums leading-none
                ${alerts.total > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                {alerts.total}
              </div>
              <div className="text-[12px] text-text-secondary mt-1.5">
                {alerts.total === 1 ? 'alerta' : 'alertas'}
              </div>
              {alerts.total > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAlerts(true)}
                  className="text-[12px] mt-0.5 font-medium text-text-info hover:underline underline-offset-2"
                >
                  → ver y arreglar
                </button>
              ) : (
                <div className="text-[12px] text-emerald-700 mt-0.5">todo en orden</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Búsqueda + filtros (F2) */}
      <div className="mb-5 space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto…"
            className="w-full border border-border-default rounded-lg pl-9 pr-3 py-2 text-sm bg-card
              text-text-primary placeholder:text-text-secondary
              focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent transition-colors duration-150"
          />
        </div>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <MenuFilterChips
            value={filters}
            onChange={setFilters}
            counts={filterCounts}
            loadingArchived={loadingArchived}
            disabled={loadingCatalog}
          />

          {/* F5 · En móvil no hay arrastre suelto: el long-press ya es el menú
              contextual. Se entra a un modo explícito, como el "Rearrange" de
              Square. En escritorio el asa está siempre y este botón no sale. */}
          <button
            type="button"
            onClick={() => setReorderMode((v) => !v)}
            aria-pressed={reorderMode}
            className={`sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium
              transition-colors duration-150
              ${reorderMode
                ? 'bg-accent text-text-on-accent border-accent'
                : 'bg-card text-text-secondary border-border-default'}`}
          >
            <MoveVertical className="w-3.5 h-3.5" />
            {reorderMode ? 'Salir de reordenar' : 'Modo reordenar'}
          </button>
        </div>

        {reorderMode && (
          <p className="sm:hidden text-[12px] text-text-secondary">
            Arrastra por el asa <GripVertical className="w-3 h-3 inline align-[-2px]" /> para
            reordenar o cambiar de categoría. Tocar un producto no abre su ficha mientras estés aquí.
          </p>
        )}

        {filters.archivados && (
          <p className="text-[12px] text-text-secondary inline-flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5 shrink-0" />
            Estás viendo lo que se <strong>quitó</strong> de la carta. Verlo no lo devuelve:
            para eso, vuelve a añadirlo desde la ficha del producto.
          </p>
        )}
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
            className="text-sm rounded-lg px-2.5 py-1.5 bg-white text-text-primary border-0"
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
        <div className="text-sm text-text-secondary">Cargando catálogo…</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          {/* Categorías + productos */}
          <SortableContext
            items={filteredCategories.map((c) => `cat:${c.id}`)}
            strategy={verticalListSortingStrategy}
          >
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="mb-8">
              {(() => {
                const isReal = cat.id !== '__sin_categoria__'
                const catIdx = allCats.findIndex((c) => c.id === cat.id)
                const collapsed = collapsedCats.has(cat.id)
                // Ventas de la categoría y si lleva 30 días sin vender NADA.
                // "Dormida" se anota, NO se colapsa sola: el encargo lo pedía,
                // pero plegar por sorpresa lo que alguien acaba de crear —una
                // categoría nueva vende 0 por definición— es esconderle su
                // trabajo. Se avisa y decide él.
                const catStats = (() => {
                  let revenue7d = 0
                  let units30d = 0
                  for (const p of cat.products) {
                    const i = insights.byItem.get(p.id)
                    revenue7d += i?.revenue7d ?? 0
                    units30d += i?.units30d ?? 0
                  }
                  return {
                    revenue7d,
                    dormida: cat.products.length > 0 && units30d === 0 && insights.byItem.size > 0,
                  }
                })()
                return (
                  <Sortable id={`cat:${cat.id}`} disabled={!isReal || moving || dndDisabled}>
                    {(d) => (
                  <div ref={d.setNodeRef} style={d.style}>
                    <div className="flex items-center gap-2 mb-2">
                      {isReal && (
                        <button
                          {...d.handleProps}
                          className={`${dndDisabled ? 'hidden' : 'inline-flex'} items-center text-text-secondary/60
                            hover:text-text-primary cursor-grab active:cursor-grabbing touch-none
                            transition-colors duration-150`}
                          title="Arrastrar para reordenar la categoría"
                          aria-label={`Reordenar categoría ${cat.name}`}
                        >
                          <GripVertical className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => toggleCollapse(cat.id)}
                        className="text-text-secondary hover:text-text-primary transition-colors duration-150"
                        title={collapsed ? 'Desplegar' : 'Plegar'}
                        aria-label={collapsed ? 'Desplegar categoría' : 'Plegar categoría'}
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
                      </button>
                      <input
                        type="checkbox"
                        checked={cat.products.length > 0 && cat.products.every((p) => selectedIds.has(p.id))}
                        onChange={(e) => setCategorySelection(cat, e.target.checked)}
                        className="w-4 h-4 rounded border-border-default cursor-pointer"
                        title="Seleccionar todos"
                      />
                      {/* F3 · emoji de la categoría. El campo existía en BBDD
                          desde el principio y no había forma de tocarlo. */}
                      {isReal ? (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setEmojiPickerCat(emojiPickerCat === cat.id ? null : cat.id)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-[15px] leading-none
                              hover:bg-accent-bg transition-colors duration-150"
                            title="Cambiar el emoji de la categoría"
                            aria-label={`Emoji de ${cat.name}`}
                          >
                            {cat.emoji ?? <Smile className="w-4 h-4 text-text-secondary/50" />}
                          </button>
                          {emojiPickerCat === cat.id && (
                            <CategoryEmojiPicker
                              current={cat.emoji}
                              onPick={(e) => void saveCategoryEmoji(cat.id, e)}
                              onClose={() => setEmojiPickerCat(null)}
                            />
                          )}
                        </div>
                      ) : (
                        cat.emoji ? <span className="text-[15px]">{cat.emoji}</span> : null
                      )}
                      <h2 className="text-base font-medium text-text-primary min-w-0">
                        {isReal ? (
                          <InlineEdit
                            value={cat.name}
                            ariaLabel={`Nombre de la categoría ${cat.name}`}
                            onSave={(next) => saveCategoryName(cat.id, next)}
                            disabled={moving}
                            inputClassName="text-base font-medium w-48"
                            render={(v) => <>{v}</>}
                          />
                        ) : cat.name}
                        <span className="ml-2 text-xs font-normal text-text-secondary tabular-nums">
                          {cat.products.length}
                        </span>
                        {catStats.revenue7d > 0 && (
                          <span className="ml-2 text-xs font-normal text-text-secondary tabular-nums">
                            · {formatEur(catStats.revenue7d)} /7d
                          </span>
                        )}
                        {catStats.dormida && (
                          <span
                            className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded-full
                              bg-page text-text-secondary border border-border-default align-middle"
                            title="Ningún producto de esta categoría se ha vendido en 30 días"
                          >
                            categoría dormida
                          </span>
                        )}
                      </h2>
                      {isReal && (
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={() => moveCategory(cat.id, -1)} disabled={moving || catIdx <= 0}
                            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-accent-bg disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Subir" aria-label="Subir categoría"><ArrowUp className="w-4 h-4" /></button>
                          <button onClick={() => moveCategory(cat.id, 1)} disabled={moving || catIdx >= allCats.length - 1}
                            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-accent-bg disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Bajar" aria-label="Bajar categoría"><ArrowDown className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmDelete({ id: cat.id, name: cat.name, count: cat.products.length })} disabled={moving}
                            className="p-1 rounded text-text-secondary hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                            title="Borrar categoría" aria-label="Borrar categoría"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>
                    <div
                      className="grid transition-[grid-template-rows] duration-200 ease-out"
                      style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
                    >
                    <div className="overflow-hidden">
                    <div className="bg-card border border-border-default rounded-xl overflow-hidden"
                      style={{ boxShadow: 'var(--shadow-sm)' }}>
                <SortableContext
                  items={cat.products.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                {cat.products.map((p, idx) => {
                  const health = linkHealth.get(p.id)
                  const badges = channelPub?.byItem.get(p.id)
                  const itemAllergens = p.recipeItemId ? allergens.get(p.recipeItemId) : undefined
                  const ins = insights.byItem.get(p.id)
                  const units7d = ins?.units7d ?? 0
                  const topRank = insights.topRank.get(p.id)
                  // El 86 se identifica por receta o por matrícula, según cómo
                  // lo guardara product_availability. Se prueban las dos.
                  const unavail = !p.isAvailable
                    ? (p.recipeItemId ? insights.unavailableSince.get(`r:${p.recipeItemId}`) : undefined)
                      ?? (p.externalId ? insights.unavailableSince.get(`e:${p.externalId}`) : undefined)
                    : undefined
                  const agotadoDesde = unavail && !(unavail.until && new Date(unavail.until).getTime() > Date.now())
                    ? formatSince(unavail.hours)
                    : null
                  // Margen de PLATO sobre PVP, desde el coste del escandallo.
                  // Tres estados distintos, que antes se confundían en uno:
                  //   sin receta   -> "sin escandallo" (falta enlazarlo)
                  //   receta sin coste -> "sin costear"  (falta recostear)
                  //   receta con coste -> la barra de margen
                  // El badge decía "sin escandallo" en los tres, y como la
                  // fuente de coste estaba vacía, salía en TODOS.
                  const plateCost = p.recipeItemId ? recipeCosts.get(p.recipeItemId) : undefined
                  const marginPct = plateCost !== undefined && p.price > 0
                    ? ((p.price - plateCost) / p.price) * 100
                    : null
                  return (
                    <Sortable key={p.id} id={p.id} disabled={moving || dndDisabled || !!p.archivedAt}>
                    {(d) => (
                    <div
                      ref={d.setNodeRef}
                      style={d.style}
                      onClick={() => { if (!reorderMode) setSelectedProductId(p.id) }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        openContextMenu(
                          { id: p.id, name: p.name, isAvailable: p.isAvailable, recipeItemId: p.recipeItemId, tags: p.tags },
                          e.clientX, e.clientY,
                        )
                      }}
                      onTouchStart={(e) => {
                        const t = e.touches[0]
                        if (!t) return
                        startLongPress(
                          { id: p.id, name: p.name, isAvailable: p.isAvailable, recipeItemId: p.recipeItemId, tags: p.tags },
                          t.clientX, t.clientY,
                        )
                      }}
                      onTouchMove={cancelLongPress}
                      onTouchEnd={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-md)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '' }}
                      className={`relative flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3.5 sm:py-4
                        transition-[background-color,box-shadow] duration-150 hover:z-10
                        ${reorderMode ? 'cursor-default' : 'cursor-pointer'}
                        ${selectedIds.has(p.id) ? 'bg-accent-bg' : 'bg-card hover:bg-card'}
                        ${idx < cat.products.length - 1 ? 'border-b border-border-default' : ''}
                        ${!p.isAvailable ? 'opacity-60' : ''}
                        ${p.archivedAt ? 'opacity-70 bg-page/60' : ''}`}
                    >
                      <button
                        {...d.handleProps}
                        onClick={(e) => e.stopPropagation()}
                        className={`${dndDisabled || p.archivedAt ? 'hidden' : 'inline-flex'} shrink-0 items-center
                          text-text-secondary/40 hover:text-text-primary cursor-grab active:cursor-grabbing
                          touch-none transition-colors duration-150`}
                        title="Arrastrar para reordenar o cambiar de categoría"
                        aria-label={`Reordenar ${p.name}`}
                      >
                        <GripVertical className="w-4 h-4" />
                      </button>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(p.id)}
                        className="w-4 h-4 rounded border-border-default cursor-pointer shrink-0"
                        title="Seleccionar"
                      />
                      {/* La foto es protagonista, no decoración: 64×64. Y cuando
                          FALTA tiene que doler y ser accionable — un icono de
                          cubiertos muerto es la razón por la que nadie las sube. */}
                      <div className="shrink-0">
                        {p.photoUrl ? (
                          <img
                            src={p.photoUrl}
                            alt=""
                            loading="lazy"
                            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover bg-page"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedProductId(p.id) }}
                            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-dashed border-border-default
                              bg-page flex flex-col items-center justify-center gap-0.5
                              text-text-secondary hover:border-accent hover:text-text-primary
                              transition-colors duration-150"
                            title="Este producto no tiene foto. En las plataformas se vende bastante peor."
                            aria-label={`Añadir foto a ${p.name}`}
                          >
                            {p.productType === 'combo'
                              ? <Package className="w-4 h-4" />
                              : <ImagePlus className="w-4 h-4" />}
                            <span className="text-[9px] font-medium leading-none">+ foto</span>
                          </button>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-text-primary text-[15px] leading-snug truncate">
                          {p.archivedAt ? p.name : (
                            <InlineEdit
                              value={p.name}
                              ariaLabel={`Nombre de ${p.name}`}
                              onSave={(next) => saveProductName(p.id, next)}
                              disabled={moving || reorderMode}
                              inputClassName="text-sm font-medium w-52"
                              render={(v) => <>{v}</>}
                            />
                          )}
                          {topRank !== undefined && (
                            <span
                              className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-text-primary text-text-on-accent
                                align-middle inline-flex items-center gap-1 font-semibold tracking-wide"
                              title={`El ${topRank}.º más vendido de esta marca en los últimos 7 días`}
                            >
                              <Star className="w-3 h-3" /> TOP {topRank}
                            </span>
                          )}
                          {p.archivedAt && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-page text-text-secondary border border-border-default align-middle inline-flex items-center gap-1">
                              <Archive className="w-3 h-3" /> archivado
                            </span>
                          )}
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
                            <span
                              className="ml-2 text-xs px-1.5 py-0.5 rounded bg-page text-text-secondary
                                border border-border-default align-middle inline-flex items-center gap-1"
                              title={unavail?.until
                                ? `Agotado con vuelta programada para el ${new Date(unavail.until).toLocaleString('es-ES')}`
                                : unavail
                                  ? `Agotado desde el ${new Date(unavail.since).toLocaleString('es-ES')}`
                                  : undefined}
                            >
                              <CircleSlash className="w-3 h-3" /> Agotado
                              {/* Con vuelta programada NO se pinta duración: está
                                  previsto, no olvidado, y decir "· 3 días" sonaría
                                  a descuido cuando es justo lo contrario. */}
                              {agotadoDesde && (
                                <span className="tabular-nums">· {agotadoDesde}</span>
                              )}
                            </span>
                          ) : null}
                        </div>
                        {/* Segunda línea: LO QUE DEJA DE DINERO. Margen y ventas
                            primero, metadatos después. Es la diferencia entre un
                            listado y un panel de rentabilidad. */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {marginPct !== null ? (
                            <MarginBar marginPct={marginPct} />
                          ) : p.productType !== 'combo' ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSelectedProductId(p.id) }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                                bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium
                                hover:bg-amber-100 transition-colors duration-150"
                              title={p.recipeItemId
                                ? 'Tiene escandallo pero aún no está costeado: dale a «Recostear todo» en Ajustes'
                                : 'Sin escandallo no hay coste ni margen: se vende a ciegas'}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              {p.recipeItemId ? 'sin costear' : 'sin escandallo'}
                            </button>
                          ) : null}

                          {units7d > 0 && (
                            <span className="text-[11px] text-text-secondary tabular-nums">
                              {units7d} vta{units7d === 1 ? '' : 's'}/7d
                            </span>
                          )}

                          <ChannelBadges badges={badges} className="shrink-0" />
                          <AllergenChips allergens={itemAllergens} />
                          <ProductTagChips tags={p.tags} />
                        </div>

                        <div className="text-[11px] text-text-secondary truncate mt-0.5">
                          {p.shortName ? `${p.shortName} · ` : ''}
                          {p.productType === 'combo'
                            ? `${p.comboSlotCount} slot${p.comboSlotCount !== 1 ? 's' : ''}`
                            : p.modifierGroupCount > 0
                              ? `${p.modifierGroupCount} grupo${p.modifierGroupCount > 1 ? 's' : ''} modif.`
                              : 'sin modificadores'}
                        </div>
                      </div>
                      <div className="text-[15px] font-semibold text-text-primary shrink-0 w-20 sm:w-24 text-right tabular-nums"
                        onClick={(e) => e.stopPropagation()}>
                        {p.archivedAt ? formatEur(p.price) : (
                          <InlineEdit
                            value={String(p.price ?? 0)}
                            mode="decimal"
                            ariaLabel={`Precio de ${p.name}`}
                            onSave={(next) => saveProductPrice(p.id, next)}
                            disabled={moving || reorderMode}
                            inputClassName="text-sm font-medium w-20 text-right"
                            render={() => <>{formatEur(p.price)}</>}
                          />
                        )}
                      </div>
                      <div className="hidden sm:block shrink-0 w-40 text-right">
                        {p.productType === 'combo' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                            <Package className="w-3.5 h-3.5" /> coste por componentes
                          </span>
                        ) : !health ? (
                          // Marca recién cambiada / linkHealth aún no cargó — no mentir a verde ni a roto.
                          <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
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
                              {plateCost !== undefined && (
                                <div className="text-xs text-text-secondary mt-0.5 tabular-nums">
                                  coste {formatEur(plateCost)}
                                  {p.price > 0 && ` · FC ${formatPct((plateCost / p.price) * 100)}`}
                                </div>
                              )}
                              {health.sharedWith > 1 && (
                                <div className="text-[11px] text-text-secondary mt-0.5">compartido con {health.sharedWith - 1}</div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="hidden sm:flex shrink-0 flex-col -my-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => moveProduct(cat, p.id, -1)} disabled={moving || idx <= 0}
                          className="p-0.5 text-text-secondary/40 hover:text-text-primary disabled:opacity-20"
                          title="Subir" aria-label="Subir producto"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button onClick={() => moveProduct(cat, p.id, 1)} disabled={moving || idx >= cat.products.length - 1}
                          className="p-0.5 text-text-secondary/40 hover:text-text-primary disabled:opacity-20"
                          title="Bajar" aria-label="Bajar producto"><ArrowDown className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => void toggleAvailability({ id: p.id, name: p.name, isAvailable: p.isAvailable })}
                          disabled={moving}
                          className={`p-1.5 rounded-md disabled:opacity-20 transition-colors ${
                            p.isAvailable
                              ? 'text-text-secondary/40 hover:text-amber-600 hover:bg-amber-50'
                              : 'text-amber-600 hover:bg-amber-50'
                          }`}
                          title={p.isAvailable ? 'Marcar agotado (se me ha acabado)' : 'Reactivar: volver a la venta'}
                          aria-label={p.isAvailable ? `Marcar agotado ${p.name}` : `Reactivar ${p.name}`}
                        >
                          {p.isAvailable ? <CircleSlash className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => askRemoveProducts([{ id: p.id, name: p.name }])}
                          disabled={moving}
                          className="p-1.5 rounded-md text-text-secondary/40 hover:text-red-600 hover:bg-red-50 disabled:opacity-20 transition-colors"
                          title="Quitar de la carta"
                          aria-label={`Quitar ${p.name} de la carta`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                  </Sortable>
                  )
                })}
                </SortableContext>
                {cat.products.length === 0 && (
                  <DropZone id={`drop:${cat.id}`} className="px-4 py-5 text-xs text-text-secondary rounded-lg">
                    Aún sin productos · arrástralos aquí, o selecciónalos arriba y usa «Mover a {cat.name}»
                  </DropZone>
                )}
              </div>
                    </div>
                    </div>
                  </div>
                    )}
                  </Sortable>
                )
              })()}
            </div>
          ))}

          </SortableContext>

          {filteredCategories.length === 0 && (
            <p className="text-sm text-text-secondary">
              {anyFilterActive(filters)
                ? 'Ningún producto pasa los filtros activos.'
                : `Sin resultados para “${search}”.`}
            </p>
          )}

          {/* Lo que sigue al dedo mientras se arrastra. Sin esto el usuario
              arrastra "nada": la fila original se queda en su hueco. */}
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {dragging && (
              <div className="px-3 py-2 rounded-lg bg-card border border-accent text-sm font-medium
                text-text-primary max-w-xs truncate" style={{ boxShadow: 'var(--shadow-lg)' }}>
                {dragging.kind === 'category' ? '📁 ' : ''}{dragging.label}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* P3 · PANEL DE ALERTAS. Cada línea LLEVA a los productos concretos
          (enciende su filtro y cierra el panel): un contador que no lleva a
          ningún sitio es decoración.

          El "agotado hace >48 h" es el que nadie más tiene, y por eso merece
          una nota: NO se mide con menu_item.updated_at —que un simple cambio de
          nombre reinicia—, sino con product_availability.set_at, que solo
          escribe el 86. Ver menuInsightsService. */}
      {showAlerts && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Alertas de la carta">
          <div
            className="absolute inset-0 bg-text-primary/20"
            onClick={() => setShowAlerts(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-sm h-full bg-card border-l border-border-default
            overflow-y-auto animate-[slideIn_180ms_ease-out]" style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="sticky top-0 bg-card border-b border-border-default px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <h3 className="text-sm font-medium text-text-primary flex-1">
                Para que esta carta venda más
              </h3>
              <button
                onClick={() => setShowAlerts(false)}
                className="p-1 rounded-md text-text-secondary hover:bg-page transition-colors duration-150"
                aria-label="Cerrar alertas"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              {alerts.total === 0 && (
                <p className="text-sm text-text-secondary">
                  Nada que arreglar: todos los productos tienen foto y escandallo, y no hay
                  agotados olvidados.
                </p>
              )}

              {alerts.sinFoto > 0 && (
                <button
                  type="button"
                  onClick={() => { setFilters({ ...EMPTY_FILTERS, sinFoto: true }); setShowAlerts(false) }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-border-default
                    hover:bg-page transition-colors duration-150 flex items-start gap-2.5"
                >
                  <ImagePlus className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="flex-1">
                    <span className="block text-sm text-text-primary font-medium">
                      {alerts.sinFoto} sin foto
                    </span>
                    <span className="block text-[12px] text-text-secondary">
                      En las plataformas, un producto sin foto se vende bastante peor.
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                </button>
              )}

              {alerts.sinEscandallo > 0 && (
                <button
                  type="button"
                  onClick={() => { setFilters({ ...EMPTY_FILTERS, sinEscandallo: true }); setShowAlerts(false) }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-border-default
                    hover:bg-page transition-colors duration-150 flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="flex-1">
                    <span className="block text-sm text-text-primary font-medium">
                      {alerts.sinEscandallo} sin escandallo
                    </span>
                    <span className="block text-[12px] text-text-secondary">
                      Sin coste no hay margen: estos se venden a ciegas.
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                </button>
              )}

              {alerts.agotadoViejo > 0 && (
                <button
                  type="button"
                  onClick={() => { setFilters({ ...EMPTY_FILTERS, agotados: true }); setShowAlerts(false) }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50/50
                    hover:bg-amber-50 transition-colors duration-150 flex items-start gap-2.5"
                >
                  <CircleSlash className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="flex-1">
                    <span className="block text-sm text-text-primary font-medium">
                      {alerts.agotadoViejo} agotado{alerts.agotadoViejo === 1 ? '' : 's'} hace más de 48 h
                    </span>
                    <span className="block text-[12px] text-text-secondary">
                      ¿Se te olvidó reactivarlo? Cada hora agotado es venta que no entra.
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* F3 · confirmación de guardado. Se va sola: es un "hecho", no un aviso
          que haya que atender, y pedir un clic para cerrarlo sería castigar al
          que edita rápido. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-3.5 py-2 rounded-full
            bg-text-primary text-text-on-accent text-[13px] font-medium
            inline-flex items-center gap-1.5 animate-[fadeIn_150ms_ease-out]"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> {toast}
        </div>
      )}

      {undo && (
        <div className="sticky bottom-3 z-20 mt-4 p-3 rounded-xl bg-text-primary text-text-on-accent flex items-center gap-3 max-w-md mx-auto"
          style={{ boxShadow: 'var(--shadow-lg)' }}>
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
          onToggleTag={(tagKey) => {
            const prod = filteredCategories.flatMap((c) => c.products).find((x) => x.id === ctxMenu.target.id)
            const current = prod?.tags ?? []
            const next = current.includes(tagKey)
              ? current.filter((t) => t !== tagKey)
              : [...current, tagKey]
            void runCtxAction(async () => {
              await updateMenuItem(ctxMenu.target.id, { tags: next })
              patchProduct(ctxMenu.target.id, { tags: next })
              setToast('Guardado')
            })
          }}
          onToggleAvailability={() => {
            const t = ctxMenu.target
            setCtxMenu(null)
            void toggleAvailability({ id: t.id, name: t.name, isAvailable: t.isAvailable })
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
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm border border-border-default" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border-default">
              <h3 className="text-base font-medium text-text-primary">
                {fieldEdit.field === 'name' ? 'Editar nombre' : 'Editar precio'}
              </h3>
              <p className="text-xs text-text-secondary mt-0.5 truncate">{fieldEdit.name}</p>
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
                className="w-full px-3 py-2 text-sm border border-border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
              {fieldEdit.field === 'price' && (
                <p className="text-[11px] text-text-secondary mt-1.5">Precio base de esta carta, con IVA incluido.</p>
              )}
              {removeError && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{removeError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border-default bg-gray-50 rounded-b-xl">
              <button onClick={() => setFieldEdit(null)} disabled={moving}
                className="px-3 py-1.5 text-sm rounded-lg text-text-secondary hover:bg-accent-bg disabled:opacity-50">Cancelar</button>
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
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md border border-border-default" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border-default flex items-center gap-2">
              <X className="w-4 h-4 text-red-600" />
              <h3 className="text-base font-medium text-text-primary">
                {confirmRemoveProduct.length === 1 ? 'Quitar de la carta' : `Quitar ${confirmRemoveProduct.length} productos`}
              </h3>
            </div>
            <div className="px-5 py-4 text-sm text-text-primary">
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

              <div className="mt-2 text-text-secondary">
                {confirmRemoveProduct.length === 1 ? 'Su escandallo y las ventas' : 'Sus escandallos y las ventas'}{' '}
                ya registradas no se tocan, y puedes volver a {confirmRemoveProduct.length === 1 ? 'añadirlo' : 'añadirlos'} cuando quieras.
              </div>
              {removeError && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{removeError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border-default bg-gray-50 rounded-b-xl">
              <button onClick={() => setConfirmRemoveProduct(null)} disabled={moving}
                className="px-3 py-1.5 text-sm rounded-lg text-text-secondary hover:bg-accent-bg disabled:opacity-50">Cancelar</button>
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
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md border border-border-default" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border-default flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-600" />
              <h3 className="text-base font-medium text-text-primary">Borrar categoría</h3>
            </div>
            <div className="px-5 py-4 text-sm text-text-primary">
              Vas a quitar la categoría <span className="font-medium">«{confirmDelete.name}»</span>.
              {confirmDelete.count > 0 ? (
                <> Sus <span className="font-medium">{confirmDelete.count} producto{confirmDelete.count > 1 ? 's' : ''}</span> no se borran: pasan a «Sin categoría».</>
              ) : ' Está vacía.'}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border-default bg-gray-50 rounded-b-xl">
              <button onClick={() => setConfirmDelete(null)} disabled={moving}
                className="px-3 py-1.5 text-sm rounded-lg text-text-secondary hover:bg-accent-bg disabled:opacity-50">Cancelar</button>
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
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl border border-border-default" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border-default">
              <h3 className="text-base font-medium text-text-primary">
                {dryRun.ok
                  ? <>Vas a publicar <span className="font-semibold">{selectedBrand?.name}</span> en <span className="underline decoration-2">{ambitoNombre}</span></>
                  : 'No se puede publicar'}
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                Todavía no se ha enviado nada a HubRise. Publicar de verdad es el botón de abajo.
              </p>
            </div>
            <div className="px-5 py-4 text-sm text-text-primary space-y-3 max-h-[60vh] overflow-auto">
              {dryRun.error && <p className="text-red-700">{dryRun.error}</p>}

              {/* QUÉ LOCALES QUEDAN AFECTADOS, CON SUS NOMBRES. Los nombres
                  salen de los DESTINOS del ensayo, que es la verdad de a dónde
                  va: el desplegable dice lo que se pidió, los targets dicen lo
                  que hay conectado. Si un catálogo no trae local, se dice —no
                  se cuenta como si supiéramos de quién es. */}
              {dryRun.ok && localesDelEnsayo.length > 0 && (
                <div className={`p-3 rounded-lg border flex items-start gap-2 ${
                  localesDelEnsayo.length > 1 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-border-default'}`}>
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${
                    localesDelEnsayo.length > 1 ? 'text-amber-600' : 'text-text-secondary'}`} />
                  <p className={`text-xs ${localesDelEnsayo.length > 1 ? 'text-amber-800' : 'text-text-secondary'}`}>
                    Se reemplaza la carta viva en{' '}
                    <span className="font-semibold">{enumeraNombres(localesDelEnsayo)}</span>
                    {catalogosSinLocal > 0 && (
                      <> y en {catalogosSinLocal} catálogo{catalogosSinLocal === 1 ? '' : 's'} cuya conexión no dice a qué local pertenece</>
                    )}
                    .{' '}
                    {localesDelEnsayo.length > 1 && <>Si sólo quieres uno, ciérralo y elígelo arriba.</>}
                  </p>
                </div>
              )}

              {/* Ningún destino trae local: no se calla, se dice. */}
              {dryRun.ok && localesDelEnsayo.length === 0 && dryRun.targets.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    No se puede decir a qué locales afecta: ninguno de los{' '}
                    {dryRun.targets.length} catálogo(s) de destino tiene local asociado en su conexión.
                    Publicar reemplaza igualmente el escaparate de esos catálogos.
                  </p>
                </div>
              )}

              {dryRun.catalogos_descartados_por_ambito > 0 && (
                <p className="text-xs text-text-secondary">
                  {dryRun.catalogos_descartados_por_ambito} catálogo(s) de otros locales quedan fuera por el ámbito elegido.
                </p>
              )}

              {dryRun.targets.map((t) => (
                <div key={t.external_catalog_id} className="border border-border-default rounded-lg p-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="font-medium text-text-primary">{t.connection_name || '(sin nombre de conexión)'}</span>
                    <span className="text-xs font-mono text-text-secondary">catálogo {t.external_catalog_id}</span>
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">
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
                      <div className="text-xs font-medium text-text-primary mb-1">
                        {t.precios_propios_total} precio{t.precios_propios_total === 1 ? '' : 's'} propio{t.precios_propios_total === 1 ? '' : 's'} por canal
                        <span className="font-normal text-text-secondary"> · se publican distintos del base</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-secondary">
                            <th className="text-left font-medium py-0.5">Producto</th>
                            <th className="text-left font-medium">Canal</th>
                            <th className="text-right font-medium">Base</th>
                            <th className="text-right font-medium">Se publica</th>
                            <th className="text-right font-medium">Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(t.precios_propios ?? []).slice(0, PRECIOS_VISIBLES).map((c, i) => (
                            <tr key={`${c.ref}-${i}`} className="border-t border-border-default">
                              <td className="py-0.5 pr-2 text-gray-800">{c.nombre}</td>
                              <td className="pr-2 text-gray-600">{c.canales.map(canalBonito).join(', ')}</td>
                              <td className="text-right tabular-nums text-text-secondary">{precioBonito(c.base)}</td>
                              <td className="text-right tabular-nums font-medium text-text-primary">{precioBonito(c.se_publica)}</td>
                              <td className={`text-right tabular-nums font-medium ${
                                c.delta_pct === null ? 'text-text-secondary'
                                  : c.delta_pct < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                {c.delta_pct === null ? '—' : `${c.delta_pct > 0 ? '+' : ''}${c.delta_pct} %`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(t.precios_propios_total ?? 0) > PRECIOS_VISIBLES && (
                        <div className="text-xs text-text-secondary mt-1">
                          y {(t.precios_propios_total ?? 0) - PRECIOS_VISIBLES} más.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-5 py-3.5 border-t border-border-default bg-gray-50 rounded-b-xl space-y-3">
              {necesitaConsentimiento && (
                <label className="flex items-start gap-2 text-xs text-amber-900 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 shrink-0"
                    checked={asumoVariosLocales}
                    onChange={(e) => setAsumoVariosLocales(e.target.checked)} />
                  <span>
                    Entiendo que esto reemplaza la carta viva en{' '}
                    <span className="font-semibold">
                      {localesDelEnsayo.length > 0 ? enumeraNombres(localesDelEnsayo) : 'los catálogos de destino'}
                    </span>, ahora mismo y en horario de servicio.
                  </span>
                </label>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDryRun(null)}
                  className="px-3.5 py-1.5 text-sm rounded-lg font-medium border border-border-default bg-white text-text-primary hover:bg-page">
                  Cancelar
                </button>
                {dryRun.ok && (
                  <button onClick={confirmarPublicacion}
                    disabled={publishing || (necesitaConsentimiento && !asumoVariosLocales)}
                    title={necesitaConsentimiento && !asumoVariosLocales
                      ? 'Marca la casilla: esta publicación afecta a más de un local'
                      : undefined}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-green-600 text-white hover:opacity-90 disabled:opacity-50">
                    {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {publishing ? 'Publicando…'
                      : `Publicar en ${localesDelEnsayo.length > 0 ? enumeraNombres(localesDelEnsayo) : ambitoNombre}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {publishResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPublishResult(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg border border-border-default" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border-default flex items-center gap-2">
              {publishResult.ok
                ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                : <AlertTriangle className={`w-5 h-5 ${publishResult.status === 'partial' ? 'text-amber-600' : 'text-red-600'}`} />}
              <h3 className="text-base font-medium text-text-primary">
                {publishResult.ok ? 'Carta publicada' : publishResult.status === 'partial' ? 'Publicada con avisos' : 'No se pudo publicar'}
              </h3>
            </div>
            <div className="px-5 py-4 text-sm text-text-primary space-y-3 max-h-[60vh] overflow-auto">
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
                  <div className="text-xs font-medium text-text-secondary mb-1">Por conexión</div>
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
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border-default bg-gray-50 rounded-b-xl">
              <button onClick={() => setPublishResult(null)}
                className="px-3.5 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90">Entendido</button>
            </div>
          </div>
        </div>
      )}

      {connectResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConnectResult(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg border border-border-default" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border-default flex items-center gap-2">
              {connectResult.ok
                ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                : <AlertTriangle className="w-5 h-5 text-red-600" />}
              <h3 className="text-base font-medium text-text-primary">
                {connectResult.ok ? 'Marca conectada a delivery' : 'No se pudo conectar'}
              </h3>
            </div>
            <div className="px-5 py-4 text-sm text-text-primary space-y-3 max-h-[60vh] overflow-auto">
              {connectResult.error && <p className="text-red-700">{connectResult.error}</p>}
              {connectResult.locations.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-text-secondary mb-1">Por local</div>
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
                            <span className="text-text-secondary"> ({l.external_catalog_id})</span>
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
                  <div className="text-xs font-medium text-text-secondary mb-1">Publicación de la carta</div>
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
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border-default bg-gray-50 rounded-b-xl">
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
          <Link2Off className="w-4 h-4 text-text-secondary" />
          <span className={`text-sm font-medium ${valueColor}`}>
            Casado de ventas · todas las marcas {signal.reliabilityPct === null ? '' : `${signal.reliabilityPct.toFixed(1)} %`} fiable
          </span>
          {ciegoLineas > 0 && (
            <span className="text-xs text-text-secondary">
              · {formatEur(signal.revenueSinCasar)} en {ciegoLineas} líneas sin casar
            </span>
          )}
        </div>
        {hayCosteCiego && (
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-xs font-medium text-orange-700">
              ⚠ Coste conocido {signal.costCoveragePct === null ? '—' : `${signal.costCoveragePct.toFixed(0)} %`}
            </span>
            <span className="text-xs text-text-secondary">
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
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border-default bg-white hover:bg-page"
        >
          Ver excepciones
        </button>
      </div>
    </div>
  )
}

// Banner-resumen del enlace ítem de carta ↔ ESCANDALLO — TODA la cuenta (no
// solo la marca visible). rows viene de menu_item_link_health sin filtrar por
// marca; los contadores son la única fuente de verdad, igual que el sello.
//
// Este eje NO es el casado de ventas. Son eslabones consecutivos de la misma
// cadena y se confundían porque los dos se llamaban "Casado":
//
//   venta → producto de carta      (casado de ventas: 100 % en Foodint)
//   producto de carta → escandallo (esto)
//   línea de albarán → artículo    (casado de recepciones)
//
// Una venta puede casar perfectamente con un producto que no sabe lo que
// cuesta ni descuenta de almacén. Por eso el de ventas puede estar a 0 y este
// no, sin que ninguno mienta.
//
// El rojo se reserva para lo que duele: productos VIVOS (pedibles en el
// catálogo externo) o que han vendido en 90 días. Un ítem que ni está vivo ni
// vende es un resto fuera de carta: se cuenta aparte y en gris. Antes los 85
// iban todos al mismo rojo y 28 de ellos eran basura — un aviso rojo
// permanente que nadie sabía qué medía.
//
// Y DOS COSAS QUE ESTÁN BIEN POR DISEÑO NO SON FALLO:
//
//   · Los COMBOS (`sellsAsCombo`). Sus componentes ya descuentan por separado;
//     ponerles escandallo propio duplicaría el consumo. 4 productos y
//     4.255,10 € del rojo eran esto.
//
//   · Los RAW (Coca-Cola, Tarta 3 Leches, Cheesecake, salsas sueltas). Un raw
//     no tiene ni debe tener `recipe_line`: se descuenta a sí mismo por la
//     condición de parada de explode_recipe_to_raws. classifyMenuItemLink ya
//     lo sabía y nunca los mandó al rojo — solo caen ahí si les falta el
//     PRECIO DE COMPRA, que es otro problema y ahora se nombra aparte en vez
//     de meterse bajo el rótulo "sin escandallo".
function LinkHealthBanner({ rows, onOpen }: { rows: MenuItemLinkHealthRow[]; onOpen: () => void }) {
  const vivo = (r: MenuItemLinkHealthRow) => r.liveInCatalog || r.soldLines90d > 0
  // Un producto sin escandallo propio que SÍ descuenta no es un fallo. Dos
  // formas de descontar sin receta propia, las dos legítimas: sus componentes
  // llegan como `combo_item` (sellsAsCombo), o llegan como `modifier` con
  // impacto `bundle` confirmado (consumesViaModifiers — los combos Smash).
  const cuenta = (r: MenuItemLinkHealthRow) =>
    vivo(r) && !r.sellsAsCombo && !r.consumesViaModifiers

  const sinEscandallo = rows.filter((r) => {
    const h = classifyMenuItemLink(r).human
    return (h === 'sin_casar' || h === 'falta_escandallo') && cuenta(r)
  })
  const sinPrecio = rows.filter((r) => classifyMenuItemLink(r).human === 'falta_precio' && cuenta(r))
  const urgentes = [...sinEscandallo, ...sinPrecio]

  const restos = rows.filter((r) => {
    const h = classifyMenuItemLink(r).human
    return (h === 'sin_casar' || h === 'falta_escandallo' || h === 'falta_precio')
      && !r.sellsAsCombo && !r.consumesViaModifiers && !vivo(r)
  }).length

  const conVenta = urgentes.filter((r) => r.soldEur90d > 0).length
  const eurEnJuego = urgentes.reduce((acc, r) => acc + r.soldEur90d, 0)
  const paraRevisar = rows.filter((r) => classifyMenuItemLink(r).human === 'para_revisar').length
  const bien = rows.filter((r) => classifyMenuItemLink(r).human === 'bien').length

  // Nada vivo roto y nada pendiente de confirmar: no molestar.
  if (urgentes.length === 0 && paraRevisar === 0) return null

  const hayUrgente = urgentes.length > 0
  const cardBg = hayUrgente ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
  const dot = hayUrgente ? 'bg-red-500' : 'bg-amber-500'
  const valueColor = hayUrgente ? 'text-red-700' : 'text-amber-700'

  return (
    <div className={`rounded-xl border p-3 mb-5 flex items-center gap-3 flex-wrap ${cardBg}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${dot} shrink-0`} />
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${valueColor}`}>
          Escandallos de la carta:{' '}
          {hayUrgente
            ? <>
                {sinEscandallo.length > 0 && <>{sinEscandallo.length} sin escandallo</>}
                {sinEscandallo.length > 0 && sinPrecio.length > 0 && <> · </>}
                {sinPrecio.length > 0 && <>{sinPrecio.length} sin precio de compra</>}
                {' '}— no descuentan de almacén
              </>
            : <>{paraRevisar} casado{paraRevisar === 1 ? '' : 's'} sin confirmar</>}
        </span>
        {hayUrgente && eurEnJuego > 0 && (
          <span className={`text-sm font-medium ${valueColor}`}>
            {' '}· {conVenta} han vendido {fmtMoney(eurEnJuego)} en 90 días
          </span>
        )}
        <span className="text-xs text-text-secondary">
          {hayUrgente && paraRevisar > 0 && <> · {paraRevisar} casados sin confirmar</>}
          {bien > 0 && <> · {bien} confirmados</>}
          {restos > 0 && <> · {restos} fuera de carta y sin ventas</>}
        </span>
        <span className="block text-xs text-text-secondary mt-0.5">
          Enlace producto↔escandallo, no casado de ventas. Fuera los que ya
          descuentan sin receta propia: combos, artículos de reventa y productos
          cuyos modificadores son productos enteros.
        </span>
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
