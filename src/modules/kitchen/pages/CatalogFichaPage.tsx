// src/modules/kitchen/pages/CatalogFichaPage.tsx
//
// Ficha unificada de plato — CAPA 1 (el esqueleto). Fusiona CatalogProductDetailPage.tsx
// (ficha del menu_item) y RecipeEditorPage.tsx (editor del recipe_item) en una sola ficha
// con 8 pestañas. Checklist de referencia: docs/auditoria_ficha_producto_escandallo_2026-08-03.md.
// Regla de oro: unificar no pierde nada — "mover, no inventar".
//
// ANCLAJE DUAL: se entra por menuItemId (Menú/Casado) o por recipeId (Recetas).
//  - Por menuItemId: recipeItemId activo = item.recipeItemId (null si "sin casar").
//  - Por recipeId: se resuelve listMenuItemsUsingRecipe(recipeId).
//      0 productos → pestañas menu_item-scoped en su estado vacío, sin anclaje.
//      1 producto  → se ancla directo, sin selector.
//      N productos → selector "Este escandallo se usa en N productos: [Producto · Marca ▾]".
// Las pestañas menu_item-scoped remontan por key={activeMenuItemId} al cambiar de ancla
// (dispara blur/guardado de inputs en curso y cancela efectos en vuelo). Cualquier mutación
// de menu_item.recipe_item_id dispara un refresco del ancla (anchorReloadTick).
//
// Fase 1: esqueleto + cabecera (foto/nombre/sello+acciones/tres cifras honestas/
// Duplicar-Eliminar/banner revisar) + barra de 8 pestañas. El contenido de cada pestaña
// se completa en las fases 2-6 (ver plan). Hasta entonces, cada pestaña muestra un
// placeholder explícito de "en construcción en esta rama" — esta rama no se despliega
// hasta que las 8 pestañas tengan contenido real (regla de oro, no es el mismo caso que
// el "Etiquetado"/"Más" muertos del editor viejo, que SÍ estaban en producción).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Camera, Check, Copy, Link2, Loader2,
  ShieldCheck, Sparkles, Trash2, X, Archive,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { getMenuItemById } from '@/modules/kitchen/services/menuItemService'
import {
  getRecipeItemById,
  checkItemDeletable,
  deleteOrArchiveItem,
  duplicateRecipeItem,
  dismissReview,
} from '@/modules/kitchen/services/recipeItemService'
import { getDishPhotoUrl } from '@/modules/kitchen/services/recipePhotoService'
import {
  setMenuItemRecipe,
  clearMenuItemRecipe,
  approveMenuItemLink,
  createDishAndLinkToMenuItem,
  getMenuItemLinkHealth,
  classifyMenuItemLink,
  listMenuItemsUsingRecipe,
  type MenuItemLinkHealthRow,
  type MenuItemUsingRecipe,
} from '@/modules/kitchen/services/menuLinkService'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import RecipeLinkPickerModal from '@/modules/kitchen/components/RecipeLinkPickerModal'
import RecipeEscandalloTab from '@/modules/kitchen/components/RecipeEscandalloTab'
import RecipeStepsTab from '@/modules/kitchen/components/RecipeStepsTab'
import RecipeHistoryTab from '@/modules/kitchen/components/RecipeHistoryTab'
import ModifierEditorSection from '@/modules/kitchen/components/ModifierEditorSection'
import ModifierImpactsTab from '@/modules/kitchen/components/ModifierImpactsTab'
import EconomiaTab from '@/modules/kitchen/components/EconomiaTab'
import EnCartaTab from '@/modules/kitchen/components/EnCartaTab'
import EtiquetadoTab from '@/modules/kitchen/components/EtiquetadoTab'
import FichaTab from '@/modules/kitchen/components/FichaTab'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { MenuItem, RecipeItem } from '@/types/kitchen'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

// Motivo de "marcado para revisar" — construido de campos estructurados, nunca
// de la fuente/summary interna (mismo texto que ya usaba RecipeEditorPage).
function reviewReasonText(note: { kind?: string | null; deltaPct?: number | null } | null): string | null {
  if (!note) return null
  if (note.kind === 'cost_suspect') {
    const pct = note.deltaPct
    if (pct === null || pct === undefined) {
      return 'El coste calculado parece no cuadrar. Conviene revisar la receta.'
    }
    const abs = Math.abs(pct)
    const dir = pct < 0 ? 'por debajo' : 'por encima'
    const magnitude = abs.toLocaleString('es-ES', { maximumFractionDigits: 1 })
    if (abs >= 15) {
      return `El coste calculado sale un ${magnitude}% ${dir} de lo esperado. Probablemente falte un ingrediente o una sub-receta sin modelar.`
    }
    if (abs >= 5) {
      return `El coste calculado sale un ${magnitude}% ${dir} de lo esperado. Puede faltar gramaje o no estar contabilizada la merma.`
    }
    return `El coste calculado sale un ${magnitude}% ${dir} de lo esperado. Diferencia pequeña; conviene revisar los gramajes finos.`
  }
  if (note.kind === 'missing_recipe') {
    return 'Este plato no tiene la receta completamente modelada. Conviene terminar el escandallo.'
  }
  return 'Este plato está marcado para revisar.'
}

const TONE_CLASSES: Record<'red' | 'amber' | 'orange' | 'green', string> = {
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  orange: 'bg-orange-50 text-orange-700',
  green: 'bg-green-50 text-green-800',
}

type FichaTab =
  | 'escandallo' | 'receta' | 'modificadores' | 'economia'
  | 'en_carta' | 'etiquetado' | 'historico' | 'ficha'

const TABS: { id: FichaTab; label: string }[] = [
  { id: 'escandallo', label: 'Escandallo' },
  { id: 'receta', label: 'Receta' },
  { id: 'modificadores', label: 'Modificadores' },
  { id: 'economia', label: 'Economía' },
  { id: 'en_carta', label: 'En carta' },
  { id: 'etiquetado', label: 'Etiquetado' },
  { id: 'historico', label: 'Histórico' },
  { id: 'ficha', label: 'Ficha' },
]

function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={src} alt="" className="max-w-full max-h-full rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-colors">
        <X size={20} />
      </button>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

interface CatalogFichaPageProps {
  /** Entrada por producto (Menú/Casado). Sin ambigüedad: recipeItemId = item.recipeItemId. */
  menuItemId?: string
  /** Entrada por receta (Recetas). El ancla de producto se resuelve (0/1/N). */
  recipeId?: string
  onBack: () => void
  /** Solo lo pasa KitchenRecipesPage — "Duplicar" navega a la copia si existe. */
  onOpenRecipe?: (recipeId: string) => void
}

export default function CatalogFichaPage({
  menuItemId: menuItemIdProp,
  recipeId: recipeIdProp,
  onBack,
  onOpenRecipe,
}: CatalogFichaPageProps) {
  const navigate = useNavigate()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { authUserId, userProfile } = useApp()

  const [activeTab, setActiveTab] = useState<FichaTab>('escandallo')

  // ── Ancla de producto (ver cabecera del fichero) ──────────────────────────
  const [activeMenuItemId, setActiveMenuItemId] = useState<string | null>(menuItemIdProp ?? null)
  const [usingRecipeItems, setUsingRecipeItems] = useState<MenuItemUsingRecipe[] | null>(null)
  const [usingBrandNames, setUsingBrandNames] = useState<Record<string, string>>({})
  const [anchorLoading, setAnchorLoading] = useState(!menuItemIdProp && !!recipeIdProp)
  const [anchorReloadTick, setAnchorReloadTick] = useState(0)

  useEffect(() => {
    if (accountsLoading) return
    let cancelled = false

    if (menuItemIdProp) {
      // Entrada por producto: el ancla es el propio prop, sin selector.
      setActiveMenuItemId(menuItemIdProp)
      setUsingRecipeItems(null)
      setAnchorLoading(false)
      return
    }
    if (!recipeIdProp) { setAnchorLoading(false); return }

    setAnchorLoading(true)
    listMenuItemsUsingRecipe(recipeIdProp)
      .then(async (rows) => {
        if (cancelled) return
        setUsingRecipeItems(rows)
        setActiveMenuItemId((prev) => {
          // Si el ancla actual sigue en la lista (p. ej. tras un refresco por
          // mutación), se conserva la elección del usuario. Si no, se recalcula:
          // 0 → sin ancla; 1 → ese; N≥2 → el primero por defecto (con selector
          // visible para cambiarlo — nunca "sin producto" habiendo productos).
          if (prev && rows.some((r) => r.id === prev)) return prev
          return rows.length > 0 ? rows[0].id : null
        })
        if (rows.length >= 2 && activeAccountId) {
          try {
            const brands = await listBrands({ accountId: activeAccountId })
            if (cancelled) return
            const map: Record<string, string> = {}
            for (const b of brands) map[b.id] = b.name
            setUsingBrandNames(map)
          } catch { /* nombres cosméticos, no bloquea */ }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('CatalogFichaPage: fallo listando productos que usan esta receta', err)
        setUsingRecipeItems([])
        setActiveMenuItemId(null)
      })
      .finally(() => { if (!cancelled) setAnchorLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItemIdProp, recipeIdProp, accountsLoading, activeAccountId, anchorReloadTick])

  function refreshAnchor() {
    // Cualquier mutación de recipe_item_id (vincular/cambiar/quitar/crear
    // escandallo) puede cambiar qué productos usan esta receta — se
    // re-resuelve el selector. Sin efecto cuando la entrada es por producto
    // (el ancla no depende de esta lista en ese caso).
    if (recipeIdProp) setAnchorReloadTick((t) => t + 1)
  }

  const activeRecipeItemId = menuItemIdProp ? null : recipeIdProp ?? null

  // ── Carga del producto anclado (si hay) ───────────────────────────────────
  const [item, setItem] = useState<MenuItem | null>(null)
  const [itemLoading, setItemLoading] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeMenuItemId) { setItem(null); return }
    let cancelled = false
    setItemLoading(true)
    setItemError(null)
    getMenuItemById(activeMenuItemId)
      .then((mi) => {
        if (cancelled) return
        if (!mi) { setItemError('Este producto ya no existe.'); setItem(null) }
        else setItem(mi)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setItemError(err instanceof Error ? err.message : 'Error cargando el producto.')
        setItem(null)
      })
      .finally(() => { if (!cancelled) setItemLoading(false) })
    return () => { cancelled = true }
  }, [activeMenuItemId])

  async function refreshItem() {
    if (!activeMenuItemId) return
    try {
      const fresh = await getMenuItemById(activeMenuItemId)
      if (fresh) setItem(fresh)
    } catch (err: unknown) {
      console.error('CatalogFichaPage: refresco del producto falló', err)
    }
  }

  // Nombre de marca del producto anclado (subtítulo "marca · categoría").
  const [brandName, setBrandName] = useState<string>('')
  useEffect(() => {
    if (!item?.brandId) { setBrandName(''); return }
    let cancelled = false
    if (usingBrandNames[item.brandId]) { setBrandName(usingBrandNames[item.brandId]); return }
    listBrands({ accountId: item.accountId })
      .then((brands) => {
        if (cancelled) return
        setBrandName(brands.find((b) => b.id === item.brandId)?.name ?? '')
      })
      .catch(() => { if (!cancelled) setBrandName('') })
    return () => { cancelled = true }
  }, [item?.brandId, item?.accountId, usingBrandNames])

  // El recipeItemId real: si entramos por producto, del propio item (puede
  // ser null = "sin casar"); si entramos por receta, siempre recipeIdProp.
  const effectiveRecipeItemId = menuItemIdProp ? (item?.recipeItemId ?? null) : activeRecipeItemId

  // ── Carga del escandallo anclado (si hay) ─────────────────────────────────
  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [recipeError, setRecipeError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Puente de refresco (tick) Modificadores: ModifierEditorSection (asignación
  // de grupos, menu_item-scoped) avisa por onGroupsChanged cuando crea/asigna/
  // quita un grupo; ModifierImpactsTab (impacto en coste, recipe_item-scoped)
  // no tiene prop de tick nativo, así que se le fuerza un remount limpio
  // cambiando su key — sin tocar el componente en sí. Cargas independientes:
  // esto solo sincroniza el REFRESCO, no fusiona sus modelos de datos.
  const [modifiersTick, setModifiersTick] = useState(0)

  useEffect(() => {
    if (!effectiveRecipeItemId) { setRecipe(null); return }
    let cancelled = false
    setRecipeLoading(true)
    setRecipeError(null)
    getRecipeItemById(effectiveRecipeItemId)
      .then((ri) => { if (!cancelled) setRecipe(ri) })
      .catch((err: unknown) => {
        if (cancelled) return
        setRecipeError(err instanceof Error ? err.message : 'Error cargando el escandallo.')
        setRecipe(null)
      })
      .finally(() => { if (!cancelled) setRecipeLoading(false) })
    return () => { cancelled = true }
  }, [effectiveRecipeItemId, reloadTick])

  // ── Foto de cocina (recipe_item.kitchen_photo_url) — resuelve URL firmada ──
  const [kitchenPhotoUrl, setKitchenPhotoUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const stored = recipe?.kitchenPhotoUrl ?? null
    if (!stored) { setKitchenPhotoUrl(null); return }
    getDishPhotoUrl(stored)
      .then((url) => { if (!cancelled) setKitchenPhotoUrl(url) })
      .catch(() => { if (!cancelled) setKitchenPhotoUrl(null) })
    return () => { cancelled = true }
  }, [recipe?.kitchenPhotoUrl])

  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Foto de cabecera (solo vista): la pública del producto si existe (es la
  // representativa cuando hay un producto de venta anclado), si no la de
  // cocina. Gestión completa de cada una vive en su pestaña (Ficha / Escandallo).
  const headerPhotoUrl = item?.photoUrl ?? kitchenPhotoUrl ?? null

  // ── Sello de casado (solo si hay producto anclado) ────────────────────────
  const [linkHealth, setLinkHealth] = useState<MenuItemLinkHealthRow | null>(null)
  function reloadLinkHealth() {
    if (!item) { setLinkHealth(null); return }
    getMenuItemLinkHealth(item.accountId, item.brandId)
      .then((rows) => setLinkHealth(rows.find((r) => r.menuItemId === item.id) ?? null))
      .catch((err: unknown) => {
        console.warn('CatalogFichaPage: no se pudo cargar la salud del enlace', err)
        setLinkHealth(null)
      })
  }
  useEffect(() => {
    if (!item) { setLinkHealth(null); return }
    let cancelled = false
    getMenuItemLinkHealth(item.accountId, item.brandId)
      .then((rows) => { if (!cancelled) setLinkHealth(rows.find((r) => r.menuItemId === item.id) ?? null) })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('CatalogFichaPage: no se pudo cargar la salud del enlace', err)
        setLinkHealth(null)
      })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId, item?.brandId, item?.recipeItemId])

  const linkClassification = linkHealth ? classifyMenuItemLink(linkHealth) : null

  // ── Vincular / cambiar / quitar / aprobar escandallo (solo con producto anclado) ──
  const [recipePickerOpen, setRecipePickerOpen] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  function openRecipePicker() {
    if (!item) return
    setLinkError(null)
    setRecipePickerOpen(true)
  }
  async function linkRecipe(recipeItemId: string) {
    if (!item) return
    setLinking(true)
    setLinkError(null)
    try {
      await setMenuItemRecipe(item.id, recipeItemId)
      setRecipePickerOpen(false)
      await refreshItem()
      reloadLinkHealth()
      refreshAnchor()
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'No se pudo vincular el escandallo.')
    } finally {
      setLinking(false)
    }
  }
  async function createDishFromProduct() {
    if (!item) return
    setLinking(true)
    setLinkError(null)
    try {
      await createDishAndLinkToMenuItem(item.accountId, item.id, item.name)
      setRecipePickerOpen(false)
      await refreshItem()
      reloadLinkHealth()
      refreshAnchor()
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'No se pudo crear el escandallo.')
    } finally {
      setLinking(false)
    }
  }
  async function unlinkRecipe() {
    if (!item) return
    setLinking(true)
    setLinkError(null)
    try {
      await clearMenuItemRecipe(item.id)
      setConfirmClear(false)
      await refreshItem()
      reloadLinkHealth()
      refreshAnchor()
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'No se pudo quitar el escandallo.')
      setConfirmClear(false)
    } finally {
      setLinking(false)
    }
  }
  async function approveLink() {
    if (!item) return
    setLinking(true)
    setLinkError(null)
    try {
      await approveMenuItemLink(item.id)
      await refreshItem()
      reloadLinkHealth()
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'No se pudo aprobar el enlace.')
    } finally {
      setLinking(false)
    }
  }

  // ── Duplicar / Eliminar escandallo (acciones sobre recipe_item, cabecera) ──
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  // Fase 6, B1: antes window.confirm.
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false)

  function handleDuplicate() {
    if (!recipe || duplicating) return
    setConfirmDuplicateOpen(true)
  }

  async function doDuplicate() {
    if (!recipe) return
    setConfirmDuplicateOpen(false)
    setDuplicating(true)
    setDuplicateError(null)
    try {
      const newId = await duplicateRecipeItem(recipe.id)
      if (onOpenRecipe) {
        onOpenRecipe(newId)
      } else {
        // Sin navegación disponible (entramos por producto): la copia queda
        // creada y sin vincular a ningún producto; no navegamos fuera del
        // producto actual. Mismo comportamiento que tenía el editor viejo
        // cuando no recibía onOpenRecipe.
        setReloadTick((t) => t + 1)
      }
    } catch (err: unknown) {
      setDuplicateError(err instanceof Error ? err.message : 'No se pudo duplicar la receta.')
    } finally {
      setDuplicating(false)
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteCheck, setDeleteCheck] = useState<Awaited<ReturnType<typeof checkItemDeletable>> | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function openDeleteDialog() {
    if (!recipe) return
    setDeleteCheck(null)
    setDeleteError(null)
    setDeleteOpen(true)
    try {
      setDeleteCheck(await checkItemDeletable(recipe.id))
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'No se pudo comprobar el borrado.')
      setDeleteOpen(false)
    }
  }
  async function confirmDelete() {
    if (!recipe) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deleteOrArchiveItem(recipe.id)
      setDeleteOpen(false)
      onBack()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'No se pudo completar la acción.')
    } finally {
      setDeleteBusy(false)
    }
  }

  // ── Dar por revisado (banner, flag propio del escandallo) ─────────────────
  const [dismissing, setDismissing] = useState(false)
  // Fase 6, B2: el editor viejo SÍ confirmaba esta acción; se perdió en la
  // Fase 1 al no rozarla ninguna fase intermedia. Se recupera aquí.
  const [confirmDismissOpen, setConfirmDismissOpen] = useState(false)

  function handleDismissReview() {
    if (!recipe || dismissing) return
    setConfirmDismissOpen(true)
  }

  async function doDismissReview() {
    if (!recipe) return
    setConfirmDismissOpen(false)
    setDismissing(true)
    try {
      await dismissReview(recipe.id, 'Revisado manualmente desde la ficha', authUserId ?? null)
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      console.error('CatalogFichaPage: dar por revisado falló', err)
    } finally {
      setDismissing(false)
    }
  }

  // ── "Tres cifras honestas" (Plate cost · Food cost % · PVP) ───────────────
  const plateCost = recipe ? (recipe.computedCost ?? recipe.fixedCost ?? null) : null
  const pvp = item?.price ?? null
  const foodCostPct = plateCost != null && pvp != null && pvp > 0
    ? Math.round((plateCost / pvp) * 10000) / 100
    : null
  // Resolución del ancla ya terminada Y realmente no hay ningún producto
  // (solo posible entrando por receta con 0 productos vinculados) — distinto
  // de "todavía cargando", que no debe leerse como "sin producto".
  const noProductAnchor = !anchorLoading && !activeMenuItemId

  // ─── Loading / error ────────────────────────────────────────────────────

  // Bloquea la página ENTERA solo en la carga inicial (sin nada que enseñar
  // todavía). Un cambio de ancla posterior (selector, mutación) NO debe
  // volver a tapar toda la ficha con el spinner — el propio bloque de "tres
  // cifras" y el subtítulo indican su carga en línea (ver más abajo).
  const loading = accountsLoading || anchorLoading || (!item && !recipe && (itemLoading || recipeLoading))
  const backLabel = menuItemIdProp ? 'Cartas' : 'Platos'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-stone-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
      </div>
    )
  }
  if (itemError || recipeError) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800">
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
          {itemError ?? recipeError}
        </div>
      </div>
    )
  }
  // Sin producto Y sin receta: entrada inválida (ni menuItemId ni recipeId).
  if (!item && !recipe) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800">
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
          No se encontró el producto ni el escandallo.
        </div>
      </div>
    )
  }

  const displayName = item?.name ?? recipe?.name ?? ''
  const ownNeedsReview = recipe?.needsReview ?? false
  const reviewReason = reviewReasonText(recipe?.reviewNotes ?? null)

  return (
    <div className="w-full pb-8">
      {lightboxOpen && headerPhotoUrl && (
        <PhotoLightbox src={headerPhotoUrl} onClose={() => setLightboxOpen(false)} />
      )}

      {recipePickerOpen && item && (
        <RecipeLinkPickerModal
          accountId={item.accountId}
          itemName={item.name}
          wasApproved={linkClassification?.human === 'bien'}
          busy={linking}
          error={linkError}
          onChoose={(id) => linkRecipe(id)}
          onCreateNew={() => createDishFromProduct()}
          onClose={() => setRecipePickerOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Quitar escandallo"
        message={item ? `«${item.name}» quedará sin coste y sin descontar del almacén hasta que le asignes otra receta.` : ''}
        tone="danger"
        confirmLabel="Quitar"
        busy={linking}
        onConfirm={unlinkRecipe}
        onCancel={() => setConfirmClear(false)}
      />

      {/* Fase 6, B1 */}
      <ConfirmDialog
        open={confirmDuplicateOpen}
        title="Duplicar escandallo"
        message={recipe ? `¿Duplicar "${recipe.name}"? Se creará una copia con todos sus ingredientes y pasos, marcada para revisar, y la abriremos para que la ajustes.` : ''}
        tone="accent"
        confirmLabel="Duplicar"
        busy={duplicating}
        onConfirm={doDuplicate}
        onCancel={() => setConfirmDuplicateOpen(false)}
      />

      {/* Fase 6, B2 */}
      <ConfirmDialog
        open={confirmDismissOpen}
        title="Dar por revisado"
        message="Este plato dejará de mostrarse como «marcado para revisar». Si el coste vuelve a fallar, se volverá a marcar solo."
        tone="accent"
        confirmLabel="Dar por revisado"
        busy={dismissing}
        onConfirm={doDismissReview}
        onCancel={() => setConfirmDismissOpen(false)}
      />

      {/* ── Diálogo eliminar/archivar el escandallo ── */}
      {deleteOpen && recipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !deleteBusy && setDeleteOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-6 border border-stone-200" onClick={(e) => e.stopPropagation()}>
            {deleteCheck === null ? (
              <div className="flex items-center gap-2 text-stone-500 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Comprobando…
              </div>
            ) : deleteCheck.deletable ? (
              <>
                <div className="flex items-center gap-2 text-stone-800 mb-2">
                  <Trash2 className="w-5 h-5 text-red-600" />
                  <span className="text-base font-medium">¿Eliminar «{recipe.name}»?</span>
                </div>
                <p className="text-sm text-stone-500 mb-4">Se eliminará definitivamente. Esta acción no se puede deshacer.</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-stone-800 mb-2">
                  <Archive className="w-5 h-5 text-amber-600" />
                  <span className="text-base font-medium">«{recipe.name}» está en uso</span>
                </div>
                <p className="text-sm text-stone-500 mb-4">
                  No se puede eliminar porque: {deleteCheck.reasons.join(' · ')}. Se archivará en su lugar (podrás recuperarlo).
                </p>
              </>
            )}
            {deleteError && <div className="mb-3 px-2.5 py-1.5 rounded-md bg-red-50 text-red-700 text-xs">{deleteError}</div>}
            {deleteCheck !== null && (
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeleteOpen(false)} disabled={deleteBusy} className="px-3 py-1.5 text-sm rounded-md text-stone-500 hover:bg-stone-50 disabled:opacity-50">
                  Cancelar
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteBusy}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium text-white disabled:opacity-50 ${deleteCheck.deletable ? 'bg-red-600 hover:opacity-90' : 'bg-accent hover:opacity-90'}`}
                >
                  {deleteBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : deleteCheck.deletable ? <Trash2 className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  {deleteBusy ? 'Procesando…' : deleteCheck.deletable ? 'Eliminar' : 'Archivar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
          <ArrowLeft size={15} /> {backLabel}
        </button>
      </div>

      {/* ── HERO (solo vista) + CABECERA ── */}
      <div className="mb-2.5">
        <div className="-mb-16 relative z-0">
          <div className="relative h-56 rounded-[14px] overflow-hidden">
            {headerPhotoUrl ? (
              <img src={headerPhotoUrl} alt={displayName} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightboxOpen(true)} />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#D4B896] via-[#B89B78] to-[#8B7355] flex items-center justify-center">
                <Camera size={40} className="text-white/30" />
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />
          </div>
        </div>

        <div className="relative z-[1] mx-6 bg-white rounded-[14px] shadow-lg p-7 sm:p-8 border border-stone-100">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <h1 className="font-display text-[26px] font-medium leading-tight">{displayName}</h1>
            <div className="flex items-center gap-1.5 shrink-0">
              {recipe && (recipe.source === 'ai_recipe' || recipe.source === 'ocr_invoice') && (
                <span className="text-[11px] px-2.5 py-1 rounded-full font-medium bg-accent text-text-on-accent inline-flex items-center gap-1">
                  <Sparkles size={12} /> IA
                </span>
              )}
              {/* Bug cazado en vivo por Julio (Fase 5): esta cabecera llegó a
                  mostrar a la vez "Validado"/"Revisar" (recipe.needsReview,
                  chip que yo mismo recuperé en la revisión de la Fase 2) y el
                  sello de casado (para_revisar/bien/etc, classifyMenuItemLink)
                  — dos verdades DISTINTAS (¿necesita revisión el escandallo en
                  sí? vs. ¿está aprobado el enlace producto↔receta?) que
                  comparten vocabulario ("Para revisar") y leían como
                  contradictorias sin contexto. Se quita el chip
                  Validado/Revisar (redundante: el mismo dato ya lo cubre, con
                  motivo y acción, el banner "Marcado para revisar" de abajo;
                  el detalle por línea sigue visible como puntos rojo/ámbar
                  dentro de la pestaña Escandallo) — se queda solo el sello de
                  casado arriba, sin ambigüedad de a qué pregunta responde. */}
              {linkClassification && (
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${TONE_CLASSES[linkClassification.tone]}`} title={linkClassification.text}>
                  {linkClassification.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-500 mb-4">
            {item ? (
              <>
                {brandName && <span>{brandName}</span>}
                {brandName && item.category && <span className="w-1 h-1 rounded-full bg-stone-300" />}
                {item.category && <span>{item.category}</span>}
                {(brandName || item.category) && <span className="w-1 h-1 rounded-full bg-stone-300" />}
                <span>{item.isAvailable ? 'En carta' : 'Agotado'}</span>
              </>
            ) : noProductAnchor ? (
              <span>Sin producto de venta vinculado todavía</span>
            ) : (
              <span className="text-stone-400">Cargando producto…</span>
            )}
          </div>

          {/* Sello + acciones de casado (solo si hay producto anclado) */}
          {item && linkClassification && (
            <div className="flex gap-2.5 flex-wrap mb-5">
              {linkClassification.human === 'sin_casar' && (
                <>
                  <button onClick={openRecipePicker} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-colors">
                    <Link2 size={15} /> Vincular escandallo
                  </button>
                  {/* A4: deshabilitado honesto (decisión de Julio, confirmada en
                      Fase 6) — el extractor extract-recipe es anti-invención:
                      rechaza texto/imagen que no parezca una receta real y
                      devuelve líneas vacías. Pedirle "redacta un escandallo
                      desde solo el nombre del producto" no serviría tal cual
                      hoy — haría falta trabajo de servidor nuevo (un prompt/
                      modo distinto) o una UI de revisión sustancialmente
                      nueva. En vez de fingir que funciona, se deja
                      deshabilitado con el motivo real en el tooltip. */}
                  <button
                    type="button"
                    disabled
                    title="Disponible en breve — hoy el extractor de IA rechaza texto que no sea una receta real; crear un escandallo desde solo el nombre necesita trabajo de servidor nuevo"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-stone-200 text-stone-400 cursor-not-allowed"
                  >
                    <Sparkles size={15} /> Crear escandallo con IA
                  </button>
                </>
              )}
              {linkClassification.human === 'para_revisar' && (
                <>
                  <button onClick={approveLink} disabled={linking} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50">
                    {linking ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Es correcto
                  </button>
                  <button onClick={openRecipePicker} disabled={linking} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-stone-200 text-stone-800 hover:border-stone-400 transition-colors disabled:opacity-50">
                    <Link2 size={15} /> Cambiar
                  </button>
                </>
              )}
              {linkClassification.human === 'bien' && (
                <>
                  <button onClick={openRecipePicker} disabled={linking} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-stone-200 text-stone-800 hover:border-stone-400 transition-colors disabled:opacity-50">
                    <Link2 size={15} /> Cambiar
                  </button>
                  <button onClick={() => setConfirmClear(true)} disabled={linking} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-stone-200 text-red-700 hover:border-red-300 hover:bg-red-50 transition-colors disabled:opacity-50">
                    <X size={15} /> Quitar
                  </button>
                </>
              )}
              {linkClassification.human === 'falta_escandallo' && (
                <button onClick={() => setActiveTab('escandallo')} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-colors">
                  Montar escandallo
                </button>
              )}
              {linkClassification.human === 'falta_precio' && effectiveRecipeItemId && (
                <button
                  onClick={() => navigate('/kitchen?item=' + effectiveRecipeItemId + (recipeIdProp ? '&return=' + recipeIdProp : ''))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-colors"
                >
                  Poner precio
                </button>
              )}
              {linkError && <div className="w-full p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{linkError}</div>}
            </div>
          )}

          {/* Selector de producto cuando la receta está compartida por ≥2 */}
          {recipeIdProp && usingRecipeItems && usingRecipeItems.length >= 2 && (
            <div className="mb-5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              Este escandallo se usa en {usingRecipeItems.length} productos de venta.{' '}
              <label className="inline-flex items-center gap-1.5 ml-1">
                Ver como:
                <select
                  value={activeMenuItemId ?? ''}
                  onChange={(e) => setActiveMenuItemId(e.target.value || null)}
                  className="px-2 py-1 rounded border border-amber-300 bg-white text-amber-900 text-sm"
                >
                  {usingRecipeItems.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{usingBrandNames[r.brandId] ? ` · ${usingBrandNames[r.brandId]}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {recipeIdProp && usingRecipeItems && usingRecipeItems.length === 0 && (
            <div className="mb-5 p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm text-stone-600">
              Este escandallo aún no está en ninguna carta. Añádelo desde la pestaña "En carta" para ver economía, precios y disponibilidad.
            </div>
          )}

          {/* Tres cifras honestas — cada una distingue "cargando" de "sin dato"
              de "valor real"; nunca un guion mudo que confunda los tres casos. */}
          <div className="flex items-baseline gap-6 mb-1 flex-wrap">
            <div>
              <div className="font-mono text-[26px] font-medium tracking-tight">
                {recipeLoading && !recipe ? '…' : plateCost != null ? fmtEur(plateCost) : 'Sin coste'}
              </div>
              <div className="text-xs text-stone-500">coste del plato</div>
            </div>
            <div>
              <div className="font-mono text-[26px] font-medium tracking-tight">
                {noProductAnchor
                  ? 'Sin producto'
                  : itemLoading || (recipeLoading && !recipe)
                    ? '…'
                    : plateCost == null
                      ? 'Sin coste'
                      : !pvp
                        ? 'Sin precio'
                        : `${foodCostPct}%`}
              </div>
              <div className="text-xs text-stone-500">food cost</div>
            </div>
            <div>
              <div className="font-mono text-[26px] font-medium tracking-tight">
                {noProductAnchor ? 'Sin producto' : itemLoading && !item ? '…' : !pvp ? 'Sin precio' : fmtEur(pvp)}
              </div>
              <div className="text-xs text-stone-500">PVP sin IVA</div>
            </div>
          </div>

          {/* Duplicar / Eliminar (acciones sobre el escandallo) */}
          {recipe && (
            <div className="flex items-center gap-2 flex-wrap mt-5">
              <button
                onClick={handleDuplicate}
                disabled={duplicating}
                title="Duplicar este escandallo (copia ingredientes y pasos) y abrir la copia para ajustarla"
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-white text-accent font-medium border border-accent/30 hover:bg-accent/5 disabled:opacity-60 transition-colors"
              >
                {duplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                {duplicating ? 'Duplicando…' : 'Duplicar'}
              </button>
              <button
                onClick={openDeleteDialog}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-white text-red-700 font-medium border border-red-300 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Eliminar
              </button>
              {duplicateError && <span className="px-2.5 py-1 rounded-md bg-red-600 text-white text-xs">{duplicateError}</span>}
            </div>
          )}
        </div>
      </div>

      {/* ── Banner "Marcado para revisar" (flag propio del escandallo) ── */}
      {ownNeedsReview && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-800">Marcado para revisar</p>
            <p className="text-[13px] text-stone-500 mt-0.5">{reviewReason ?? 'Este plato está marcado para revisar.'}</p>
          </div>
          <button
            onClick={handleDismissReview}
            disabled={dismissing}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 text-white hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {dismissing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {dismissing ? 'Guardando…' : 'Dar por revisado'}
          </button>
        </div>
      )}

      {/* ── Barra de pestañas ── */}
      <div className="bg-white border border-stone-200 rounded-xl mt-4 overflow-hidden">
        <div className="flex gap-6 px-5 pt-3 border-b border-stone-200 text-sm overflow-x-auto">
          {TABS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                onClick={() => {
                  // Fuerza el guardado on-blur de cualquier input en curso
                  // antes de desmontar la pestaña activa (sin estado nuevo).
                  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                  setActiveTab(tab.id)
                }}
                className={
                  'pb-3 shrink-0 whitespace-nowrap transition-colors ' +
                  (active ? 'border-b-2 border-accent text-stone-800 font-medium' : 'text-stone-500 hover:text-stone-800')
                }
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="p-5">
          {/* Fase 2: Escandallo/Receta/Histórico ya son componentes reales
              (recipe_item-scoped, sin depender del selector de producto).
              Modificadores/Economía/En carta/Ficha siguen en placeholder,
              pendientes de las Fases 3-5 (ver plan). key={} fuerza el remount
              al cambiar de ancla, evitando estado cruzado entre productos/recetas. */}
          {activeTab === 'escandallo' && (
            <div key={effectiveRecipeItemId ?? 'none'}>
              {effectiveRecipeItemId ? (
                <RecipeEscandalloTab
                  accountId={item?.accountId ?? recipe?.accountId ?? ''}
                  recipeId={effectiveRecipeItemId}
                  onRecipeChanged={() => {
                    setReloadTick((t) => t + 1)
                    // "Añadir a carta" (entre otras) puede crear un menu_item
                    // nuevo enlazado a esta receta — el selector de N
                    // productos debe reflejarlo. Barato incluso cuando no
                    // aplica (refreshAnchor es no-op si entramos por producto).
                    refreshAnchor()
                  }}
                />
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Este producto todavía no tiene escandallo asignado.
                </div>
              )}
            </div>
          )}
          {activeTab === 'receta' && (
            <div key={effectiveRecipeItemId ?? 'none'}>
              {effectiveRecipeItemId ? (
                <RecipeStepsTab recipeItemId={effectiveRecipeItemId} />
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Necesita escandallo para tener pasos de elaboración.
                </div>
              )}
            </div>
          )}
          {activeTab === 'modificadores' && (
            <div key={(effectiveRecipeItemId ?? 'none') + '-' + (activeMenuItemId ?? 'none')} className="space-y-8">
              {/* Mitad ASIGNACIÓN (menu_item-scoped): qué grupos tiene el
                  producto. "¿Hay producto?" lo decide el padre con `item`/
                  `activeMenuItemId` (la misma verdad que usa el resto de la
                  ficha) — este bloque nunca pregunta por su cuenta. */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">
                  Modificadores del producto
                </h3>
                {activeMenuItemId && item ? (
                  <ModifierEditorSection
                    accountId={item.accountId}
                    brandId={item.brandId ?? null}
                    menuItemId={item.id}
                    recipeItemId={item.recipeItemId ?? null}
                    onGroupsChanged={() => setModifiersTick((t) => t + 1)}
                  />
                ) : activeMenuItemId && itemLoading ? (
                  <div className="text-sm text-stone-400 py-6 text-center">Cargando producto…</div>
                ) : (
                  <div className="text-sm text-stone-400 py-6 text-center">
                    Este plato aún no está en ninguna carta. Añádelo desde la pestaña "En carta" para asignar modificadores.
                  </div>
                )}
              </div>

              {/* Mitad IMPACTO (recipe_item-scoped): qué le hace cada opción al
                  coste. Funciona sin producto anclado — solo necesita
                  effectiveRecipeItemId. key={modifiersTick} fuerza un remount
                  limpio cuando la mitad de arriba crea/asigna/quita un grupo. */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">
                  Impacto en coste
                </h3>
                {effectiveRecipeItemId ? (
                  <ModifierImpactsTab
                    key={modifiersTick}
                    recipeItemId={effectiveRecipeItemId}
                    accountId={item?.accountId ?? recipe?.accountId ?? ''}
                    actorName={userProfile?.displayName ?? 'Usuario'}
                  />
                ) : (
                  <div className="text-sm text-stone-400 py-6 text-center">
                    Necesita escandallo para calcular el impacto en coste de los modificadores.
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'economia' && (
            <div key={activeMenuItemId ?? 'none'}>
              {activeMenuItemId && item ? (
                <EconomiaTab
                  item={item}
                  accountId={item.accountId}
                  onItemChanged={refreshItem}
                />
              ) : activeMenuItemId && itemLoading ? (
                <div className="text-sm text-stone-400 py-10 text-center">Cargando producto…</div>
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Este plato aún no está en ninguna carta. Añádelo desde la pestaña "Escandallo" para ver economía por canal.
                </div>
              )}
            </div>
          )}
          {activeTab === 'en_carta' && (
            <div key={activeMenuItemId ?? 'none'}>
              {activeMenuItemId && item ? (
                <EnCartaTab
                  item={item}
                  accountId={item.accountId}
                  onItemChanged={refreshItem}
                />
              ) : activeMenuItemId && itemLoading ? (
                <div className="text-sm text-stone-400 py-10 text-center">Cargando producto…</div>
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Este plato aún no está en ninguna carta. Añádelo desde la pestaña "Escandallo" para gestionar precio y disponibilidad.
                </div>
              )}
            </div>
          )}
          {activeTab === 'etiquetado' && (
            <div key={effectiveRecipeItemId ?? 'none'}>
              {effectiveRecipeItemId ? (
                <EtiquetadoTab
                  recipeItemId={effectiveRecipeItemId}
                  accountId={item?.accountId ?? recipe?.accountId ?? ''}
                />
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Necesita escandallo para declarar alérgenos.
                </div>
              )}
            </div>
          )}
          {activeTab === 'historico' && (
            <div key={effectiveRecipeItemId ?? 'none'}>
              {effectiveRecipeItemId ? (
                <RecipeHistoryTab
                  recipeItemId={effectiveRecipeItemId}
                  createdByName={userProfile?.displayName ?? null}
                  onRestored={() => setReloadTick((t) => t + 1)}
                />
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Necesita escandallo para tener histórico de versiones.
                </div>
              )}
            </div>
          )}
          {activeTab === 'ficha' && (
            <div key={activeMenuItemId ?? 'none'}>
              {activeMenuItemId && item ? (
                <FichaTab
                  item={item}
                  accountId={item.accountId}
                  onItemChanged={refreshItem}
                />
              ) : activeMenuItemId && itemLoading ? (
                <div className="text-sm text-stone-400 py-10 text-center">Cargando producto…</div>
              ) : (
                <div className="text-sm text-stone-400 py-10 text-center">
                  Este plato aún no está en ninguna carta. Añádelo desde la pestaña "Escandallo" para completar su ficha.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
