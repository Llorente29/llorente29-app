// src/modules/kitchen/pages/KitchenItemDetailPage.tsx
//
// Vista DETALLE de un ingrediente (recipe_item type='raw'), estándar visual v2:
// HERO PARTIDO (foto + barra de acciones · cuadro de mando) + secciones
// colapsables. Patrón LISTA + DETALLE por estado: recibe { itemId, onBack }
// (contrato INTACTO → KitchenItemsPage no se toca). Tokens de la app.
//
// T2.1: la ficha contiene TODO en colapsables (vale de fábrica para toda la
// hostelería). Campos: identidad+clasificación (nombre comercial, familia,
// código, origen), coste+uso (con merma), conservación+temporada (con vida
// útil). Edición unificada: un único formulario con todos los campos.
//
// Foto: recipe_item.kitchen_photo_url guarda el STORAGE PATH (bucket privado
// recipe-uploads); URL firmada al vuelo con getDishPhotoUrl.
//
// Secciones honesto-vacías (deuda con disparador): Alérgenos (servicio
// pendiente), Nutrición, Cortes y merma, Stock, Histórico.

import { useEffect, useMemo, useState, type ReactNode, type ChangeEvent } from 'react'
import {
  ArrowLeft, Archive, Check, Loader2, Pencil, X, ChevronDown, ImagePlus, Trash2,
  ChefHat, AlertTriangle, Activity, Scissors, Boxes, Clock, Snowflake, Settings2,
  TrendingUp, Tag,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import {
  getRecipeItemById,
  updateRecipeItem,
  getRawUsageCounts,
  recomputeUsersOf,
  countUsersOf,
  checkItemDeletable,
  deleteOrArchiveItem,
} from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import { listSuppliers, listSuppliersByItem } from '@/modules/kitchen/services/purchaseFormatService'
import { recomputeItemAndAncestors } from '@/modules/kitchen/services/costCascadeService'
import {
  listIngredientFamilies,
  type IngredientFamily,
} from '@/modules/kitchen/services/ingredientFamilyService'
import { uploadDishPhoto, getDishPhotoUrl, deleteDishPhoto } from '@/modules/kitchen/services/recipePhotoService'
import PurchaseSourcesSection from '@/modules/kitchen/components/PurchaseSourcesSection'
import { ReviewBanner } from '@/modules/kitchen/components/ReviewBanner'
import ItemStockPanel from '@/modules/kitchen/components/ItemStockPanel'
import ItemMovementsPanel from '@/modules/kitchen/components/ItemMovementsPanel'
import ItemVatSelector from '@/modules/kitchen/components/ItemVatSelector'
import IngredientAiAssistButton from '@/modules/kitchen/components/IngredientAiAssistButton'
import { getIngredientExtras } from '@/modules/kitchen/services/recipeAiService'
import { listItemAllergens, saveItemAllergens } from '@/modules/kitchen/services/recipeItemAllergenService'
import { EU_ALLERGENS, ALLERGEN_STATES, allergenLabel, allergenStateLabel, type AllergenCode, type AllergenState } from '@/modules/kitchen/lib/allergens'
import { supabase } from '@/lib/supabase'
import type { Database, Json } from '@/types/database'
import type { RecipeItem, KitchenUnit, Supplier, ArticleSupplier, RecipeItemUpdate, RecipeItemType, ConservationType, CostStrategy } from '@/types/kitchen'

// ─── Helpers ────────────────────────────────────────────────────────────────

// Etiquetas de menú: código -> texto visible.
const MENU_TAG_LABEL: Record<string, string> = {
  picante: 'Picante',
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sin_gluten: 'Sin gluten',
  sin_lactosa: 'Sin lactosa',
  halal: 'Halal',
  ecologico: 'Ecológico / Bio',
}

// Campos de nutrición (orden etiqueta UE) para mostrar recipe_item.nutrition.
const NUTRITION_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'energy_kcal', label: 'Energía', unit: 'kcal' },
  { key: 'fat_g', label: 'Grasas', unit: 'g' },
  { key: 'saturated_fat_g', label: '· saturadas', unit: 'g' },
  { key: 'carbs_g', label: 'Hidratos', unit: 'g' },
  { key: 'sugars_g', label: '· azúcares', unit: 'g' },
  { key: 'fiber_g', label: 'Fibra', unit: 'g' },
  { key: 'protein_g', label: 'Proteínas', unit: 'g' },
  { key: 'salt_g', label: 'Sal', unit: 'g' },
]

function formatEur(value: number | null | undefined, maxDecimals = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: maxDecimals,
  }).format(value)
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }
  catch { return '—' }
}

function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

// "1 jun – 30 sep" a partir de dos fechas; ambas opcionales.
function formatSeason(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  return `${formatDateShort(start)} – ${formatDateShort(end)}`
}

function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function dateInputValue(iso: string | null): string {
  if (!iso) return ''
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}

// Coste EFECTIVO: COALESCE(computed_cost, fixed_cost), igual que el motor en BBDD.
function effectiveCost(item: RecipeItem): number | null {
  if (item.computedCost !== null && item.computedCost !== undefined) return item.computedCost
  if (item.fixedCost !== null && item.fixedCost !== undefined) return item.fixedCost
  return null
}

const DIM_LABEL: Record<string, string> = { weight: 'Peso', volume: 'Volumen', unit: 'Unidades' }

const CONSERVATION_LABEL: Record<string, string> = {
  fridge: 'Refrigeración', freezer: 'Congelación', dry: 'Seco / ambiente', hot: 'Caliente',
}
const CONSERVATION_OPTIONS: { value: ConservationType; label: string }[] = [
  { value: 'fridge', label: 'Refrigeración' },
  { value: 'freezer', label: 'Congelación' },
  { value: 'dry', label: 'Seco / ambiente' },
  { value: 'hot', label: 'Caliente' },
]

// Estrategias de coste REALES del enum en BBDD (CHECK recipe_item_cost_strategy_valid:
// 'fixed' | 'last_purchase' | 'average_weighted' | 'average_window'). Son 4, no 6:
// el CHECK no admite más (la BBDD es la verdad). Etiquetas estilo tspoon.
const COST_STRATEGY_OPTIONS: { value: CostStrategy; label: string; hint: string }[] = [
  { value: 'last_purchase', label: 'Último precio de compra', hint: 'El coste lo manda el último precio del proveedor principal.' },
  { value: 'average_weighted', label: 'Precio medio ponderado de las compras', hint: 'Media de las compras ponderada por cantidad recibida.' },
  { value: 'average_window', label: 'Precio medio de las últimas compras', hint: 'Media de las compras dentro de una ventana reciente.' },
  { value: 'fixed', label: 'Precio fijo (tecleado a mano)', hint: 'El coste lo fijas tú; la compra no lo pisa.' },
]

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function CollapsibleSection({
  icon, title, badge, badgeTone, defaultOpen, children,
}: {
  icon: ReactNode; title: string; badge?: string;
  badgeTone?: 'ok' | 'warn' | 'neutral'; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const badgeCls =
    badgeTone === 'ok' ? 'bg-success-bg text-success'
      : badgeTone === 'warn' ? 'bg-warning-bg text-warning'
        : 'bg-page text-text-secondary'
  return (
    <div className="border-t border-border-default first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center w-full gap-2 px-4 py-3 text-left hover:bg-page transition-base"
      >
        <span className="text-text-secondary flex-shrink-0">{icon}</span>
        <span className="text-sm font-medium text-text-primary flex-1">{title}</span>
        {badge && <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${badgeCls}`}>{badge}</span>}
        <ChevronDown size={14} className={`text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// Celda de dato (label arriba, valor abajo) reutilizable en las secciones.
function DataCell({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="bg-page rounded-md px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">{label}</div>
      <div className={`text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

// Campo de formulario (label + control).
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-secondary mt-1">{hint}</p>}
    </div>
  )
}

const INPUT_CLS =
  'w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50'

interface KitchenItemDetailPageProps {
  itemId: string
  onBack: () => void
}

export default function KitchenItemDetailPage({ itemId, onBack }: KitchenItemDetailPageProps) {
  const { userProfile, authUserId, activeLocationId } = useApp()

  const [item, setItem] = useState<RecipeItem | null>(null)
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [families, setFamilies] = useState<IngredientFamily[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cuadro de mando: uso + proveedores
  const [usageCount, setUsageCount] = useState<number | null>(null)
  const [links, setLinks] = useState<ArticleSupplier[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Foto
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoConfirmDelete, setPhotoConfirmDelete] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  // Edición unificada
  const [editing, setEditing] = useState(false)
  const [fName, setFName] = useState('')
  const [fAltName, setFAltName] = useState('')
  const [fCode, setFCode] = useState('')
  const [fFamilyId, setFFamilyId] = useState('')
  const [fBaseUnitId, setFBaseUnitId] = useState('')
  const [fCostStrategy, setFCostStrategy] = useState<CostStrategy>('last_purchase')
  const [fOrigin, setFOrigin] = useState('')
  const [fConservation, setFConservation] = useState('')
  const [fServiceTemp, setFServiceTemp] = useState('')
  const [fWastePct, setFWastePct] = useState('')
  const [fShelfLife, setFShelfLife] = useState('')
  const [fSeasonStart, setFSeasonStart] = useState('')
  const [fSeasonEnd, setFSeasonEnd] = useState('')
  // Naturaleza del artículo (raw / packaging / tool). Cambiarla lo recoloca en
  // las recetas. typeUsersCount = en cuántos platos está (para el aviso inline).
  const [fType, setFType] = useState<RecipeItemType>('raw')
  const [typeUsersCount, setTypeUsersCount] = useState<number | null>(null)
  // Campos editables nuevos (alérgenos, nutrición, etiquetas de menú)
  const [fAllergens, setFAllergens] = useState<Map<AllergenCode, AllergenState>>(new Map())
  const [fNutrition, setFNutrition] = useState<Record<string, string>>({})
  const [fMenuTags, setFMenuTags] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Eliminar/archivar autónomo: Folvy decide (borra si no se usa, archiva si sí).
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteCheck, setDeleteCheck] = useState<Awaited<ReturnType<typeof checkItemDeletable>> | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  // Disparador de recarga del item (tras aplicar el copiloto IA, etc.)
  const [reloadTick, setReloadTick] = useState(0)
  // Datos cargados aparte del mapper de RecipeItem (para mostrar en la ficha).
  const [nutritionData, setNutritionData] = useState<Record<string, number>>({})
  const [menuTags, setMenuTags] = useState<string[]>([])
  const [allergens, setAllergens] = useState<{ code: AllergenCode; state: AllergenState }[]>([])

  const actorId = authUserId ?? null
  const actorName = userProfile?.displayName ?? null

  // ── Carga principal: item + unidades ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getRecipeItemById(itemId), listUnits()])
      .then(([it, allUnits]) => {
        if (cancelled) return
        if (!it) { setError('Este ingrediente ya no existe.'); setItem(null) }
        else setItem(it)
        setUnits(allUnits)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el ingrediente.')
        setItem(null); setUnits([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [itemId, reloadTick])

  // ── Familias de la cuenta (para mostrar nombre + selector) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    listIngredientFamilies(item.accountId)
      .then((fs) => { if (!cancelled) setFamilies(fs) })
      .catch(() => { if (!cancelled) setFamilies([]) })
    return () => { cancelled = true }
  }, [item?.accountId])

  // ── Extras de la ficha: nutrición + etiquetas + alérgenos (recargable) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    Promise.all([getIngredientExtras(item.id), listItemAllergens(item.id)])
      .then(([x, allg]) => {
        if (cancelled) return
        setNutritionData(x.nutrition)
        setMenuTags(x.menuTags)
        setAllergens(allg.map((a) => ({ code: a.code, state: a.state })))
      })
      .catch(() => {
        if (!cancelled) { setNutritionData({}); setMenuTags([]); setAllergens([]) }
      })
    return () => { cancelled = true }
  }, [item?.id, reloadTick])

  // ── Uso en platos (RPC) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    getRawUsageCounts(item.accountId)
      .then((counts) => { if (!cancelled) setUsageCount(counts[item.id] ?? 0) })
      .catch(() => { if (!cancelled) setUsageCount(null) })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  // ── Proveedores del ingrediente (cuadro + semáforo) ──
  useEffect(() => {
    if (!item) return
    let cancelled = false
    Promise.all([listSuppliers(item.accountId), listSuppliersByItem(item.id)])
      .then(([sup, lnk]) => { if (!cancelled) { setSuppliers(sup); setLinks(lnk) } })
      .catch(() => { if (!cancelled) { setSuppliers([]); setLinks([]) } })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  // ── URL firmada de la foto ──
  useEffect(() => {
    if (!item) { setPhotoUrl(null); return }
    let cancelled = false
    getDishPhotoUrl(item.kitchenPhotoUrl)
      .then((url) => { if (!cancelled) setPhotoUrl(url) })
      .catch(() => { if (!cancelled) setPhotoUrl(null) })
    return () => { cancelled = true }
  }, [item?.id, item?.kitchenPhotoUrl])

  // ── Refrescos ──
  async function refreshItem() {
    try {
      const fresh = await getRecipeItemById(itemId)
      if (fresh) setItem(fresh)
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: refresco del item falló', err)
    }
  }
  async function refreshSuppliers() {
    if (!item) return
    try { setLinks(await listSuppliersByItem(item.id)) } catch { /* no crítico */ }
  }

  // ── Derivados ──
  const baseUnit = useMemo(
    () => (item ? units.find((u) => u.id === item.baseUnitId) ?? null : null),
    [units, item],
  )
  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    units.forEach((u) => {
      const list = groups.get(u.dimension) ?? []
      list.push(u); groups.set(u.dimension, list)
    })
    return groups
  }, [units])
  const familyName = useMemo(
    () => (item?.familyId ? families.find((f) => f.id === item.familyId)?.name ?? null : null),
    [families, item?.familyId],
  )
  const preferredSupplierName = useMemo(() => {
    const pref = links.find((l) => l.isPreferred) ?? links[0] ?? null
    if (!pref) return null
    return suppliers.find((s) => s.id === pref.supplierId)?.name ?? null
  }, [links, suppliers])

  // ── Edición ──
  function openEdit() {
    if (!item) return
    setFType(item.type)
    setTypeUsersCount(null)
    setFName(item.name)
    setFAltName(item.altName ?? '')
    setFCode(item.code ?? '')
    setFFamilyId(item.familyId ?? '')
    setFBaseUnitId(item.baseUnitId)
    setFCostStrategy(item.costStrategy)
    setFOrigin(item.origin ?? '')
    setFConservation(item.conservationType ?? '')
    setFServiceTemp(item.serviceTempC != null ? String(item.serviceTempC) : '')
    setFWastePct(item.defaultWastePct != null ? String(item.defaultWastePct) : '')
    setFShelfLife(item.shelfLifeDays != null ? String(item.shelfLifeDays) : '')
    setFSeasonStart(dateInputValue(item.seasonStart))
    setFSeasonEnd(dateInputValue(item.seasonEnd))
    // Alérgenos: del estado ya cargado.
    setFAllergens(new Map(allergens.map((a) => [a.code, a.state])))
    // Nutrición: a string para inputs (vacío si no hay valor).
    setFNutrition(
      Object.fromEntries(
        NUTRITION_FIELDS.map(({ key }) => [
          key,
          nutritionData[key] != null ? String(nutritionData[key]) : '',
        ]),
      ),
    )
    // Etiquetas de menú.
    setFMenuTags(new Set(menuTags))
    setFormError(null)
    setEditing(true)
  }

  // El usuario cambió el selector de naturaleza: consulta en cuántos platos está
  // (para el aviso). Si falla el conteo, no bloquea: la reclasificación va igual.
  async function onTypeChange(next: RecipeItemType) {
    setFType(next)
    if (!item || next === item.type) {
      setTypeUsersCount(null)
      return
    }
    try {
      setTypeUsersCount(await countUsersOf(item.id))
    } catch {
      setTypeUsersCount(null)
    }
  }

  async function saveEdit() {
    if (!item) return
    const name = fName.trim()
    if (name === '') { setFormError('El nombre es obligatorio.'); return }
    if (!fBaseUnitId) { setFormError('Elige una unidad base.'); return }

    const shelf = parseNum(fShelfLife)
    const strategyChanged = fCostStrategy !== item.costStrategy
    const typeChanged = fType !== item.type
    const patch: RecipeItemUpdate = {
      name,
      altName: fAltName.trim() || null,
      code: fCode.trim() || null,
      familyId: fFamilyId || null,
      baseUnitId: fBaseUnitId,
      costStrategy: fCostStrategy,
      origin: fOrigin.trim() || null,
      conservationType: (fConservation || null) as ConservationType | null,
      serviceTempC: parseNum(fServiceTemp),
      defaultWastePct: parseNum(fWastePct),
      shelfLifeDays: shelf === null ? null : Math.round(shelf),
      seasonStart: fSeasonStart || null,
      seasonEnd: fSeasonEnd || null,
      ...(typeChanged ? { type: fType } : {}),
    }
    setSaving(true)
    setFormError(null)
    try {
      await updateRecipeItem(item.id, patch)

      if (typeChanged) {
        // El artículo cambió de naturaleza: recostear los platos que lo usan para
        // que su desglose food/packaging quede al día. No bloquea el guardado si
        // falla (el coste del propio artículo ya se actualizó).
        try {
          await recomputeUsersOf(item.id)
        } catch (e) {
          console.error('recomputeUsersOf falló tras reclasificar', e)
        }
      }

      // Alérgenos (lista final, reemplazo) vía su servicio.
      const allergenList = Array.from(fAllergens.entries()).map(([code, state]) => ({ code, state }))
      await saveItemAllergens(item.id, allergenList)

      // Nutrición + etiquetas de menú: update directo tipado.
      const nutritionObj: Record<string, number> = {}
      for (const { key } of NUTRITION_FIELDS) {
        const raw = (fNutrition[key] ?? '').trim().replace(',', '.')
        if (raw !== '') {
          const n = Number(raw)
          if (Number.isFinite(n) && n >= 0) nutritionObj[key] = n
        }
      }
      const directPatch: Database['public']['Tables']['recipe_item']['Update'] = {
        nutrition: (Object.keys(nutritionObj).length > 0 ? nutritionObj : null) as Json,
        menu_tags: Array.from(fMenuTags),
      }
      const { error: directErr } = await supabase!
        .from('recipe_item')
        .update(directPatch)
        .eq('id', item.id)
      if (directErr) throw new Error(directErr.message)

      // Si cambió la estrategia de coste, recosteamos el ítem (y sus platos) con
      // el motor vigente para que el coste mostrado refleje ya la nueva regla.
      // Reutiliza recomputeItemAndAncestors (no toca el motor); fail-safe.
      if (strategyChanged) {
        try {
          await recomputeItemAndAncestors(item.id)
        } catch (e) {
          console.error('KitchenItemDetailPage: recosteo tras cambio de estrategia falló', e)
        }
      }

      setEditing(false)
      await refreshItem()
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function openDeleteDialog() {
    if (!item) return
    setDeleteCheck(null)
    setDeleteOpen(true)
    try {
      setDeleteCheck(await checkItemDeletable(item.id))
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo comprobar el borrado.')
      setDeleteOpen(false)
    }
  }

  async function confirmDelete() {
    if (!item) return
    setDeleteBusy(true)
    try {
      await deleteOrArchiveItem(item.id)   // borra o archiva; en ambos casos sale del catálogo
      setDeleteOpen(false)
      onBack()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo completar la acción.')
    } finally {
      setDeleteBusy(false)
    }
  }

  // ── Foto ──
  async function onPhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !item) return
    setPhotoUploading(true); setPhotoError(null)
    const prevPath = item.kitchenPhotoUrl
    try {
      const path = await uploadDishPhoto(item.accountId, item.id, file)
      await updateRecipeItem(item.id, { kitchenPhotoUrl: path })
      if (prevPath && prevPath !== path) { try { await deleteDishPhoto(prevPath) } catch { /* best-effort */ } }
      await refreshItem()
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: subida de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo subir la foto.')
    } finally {
      setPhotoUploading(false); e.target.value = ''
    }
  }
  async function onPhotoDelete() {
    if (!item || !item.kitchenPhotoUrl) return
    setPhotoDeleting(true); setPhotoError(null)
    const path = item.kitchenPhotoUrl
    try {
      await updateRecipeItem(item.id, { kitchenPhotoUrl: null })
      try { await deleteDishPhoto(path) } catch { /* best-effort */ }
      await refreshItem()
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: borrado de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo eliminar la foto.')
    } finally {
      setPhotoDeleting(false); setPhotoConfirmDelete(false)
    }
  }

  // ── Carga / error ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando ingrediente…
      </div>
    )
  }
  if (error || !item) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base">
          <ArrowLeft size={16} /> Ingredientes
        </button>
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error ?? 'Ingrediente no encontrado.'}
        </div>
      </div>
    )
  }

  // Naturaleza del artículo: las secciones de ALIMENTO (alérgenos, nutrición,
  // merma, temporada, vida útil, temp. de servicio, etiquetas de menú) solo
  // tienen sentido en un ingrediente. Un envase o herramienta las oculta.
  const isRaw = item.type === 'raw'

  // ── Semáforo "Utilizable" (honesto) ──
  const cost = effectiveCost(item)
  const okPrecio = cost !== null
  const okUnidad = !!item.baseUnitId
  const okProveedor = links.length > 0
  const usable = okPrecio && okUnidad && okProveedor

  const hasNutrition = NUTRITION_FIELDS.some((f) => nutritionData[f.key] != null)
  const checks: { label: string; ok: boolean }[] = [
    { label: 'Precio', ok: okPrecio },
    { label: 'Unidad', ok: okUnidad },
    { label: 'Proveedor', ok: okProveedor },
  ]
  const costOrigin = item.costStrategy === 'fixed' ? 'Tecleado a mano' : 'Desde la compra'

  return (
    <div className="max-w-6xl pb-8">
      <input id="ingredient-photo-input" type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />

      {/* TOP BAR */}
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base">
          <ArrowLeft size={16} /> Ingredientes
        </button>
      </div>

      {photoError && (
        <div className="mb-3 p-2.5 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs flex items-center justify-between gap-3">
          <span>{photoError}</span>
          <button type="button" onClick={() => setPhotoError(null)} className="text-danger hover:opacity-70 flex-shrink-0" aria-label="Cerrar aviso"><X size={14} /></button>
        </div>
      )}

      {/* Aviso de revisión: coste sospechoso, sin escandallo, o pendiente de
          validar (artículo completo que espera el visto bueno humano). */}
      {item && !editing && (
        <div className="mb-4">
          <ReviewBanner item={item} onDismissed={() => setReloadTick((t) => t + 1)} />
        </div>
      )}

      {editing ? (
        /* ───────── MODO EDICIÓN (formulario unificado) ───────── */
        <div className="rounded-lg border border-border-default bg-card">
          <div className="px-4 py-3 border-b border-border-default">
            <h2 className="text-base font-display font-medium text-text-primary">Editar ingrediente</h2>
          </div>
          <div className="p-4 space-y-5">
            {/* Identidad y clasificación */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Identidad y clasificación</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 space-y-2">
                  <Field label="Naturaleza" hint="Qué es este artículo. Cambiarlo lo recoloca en las recetas.">
                    <select
                      value={fType}
                      onChange={(e) => onTypeChange(e.target.value as RecipeItemType)}
                      disabled={saving}
                      className={`${INPUT_CLS} cursor-pointer`}
                    >
                      <option value="raw">Ingrediente</option>
                      <option value="packaging">Envase / packaging</option>
                      <option value="tool">Herramienta</option>
                    </select>
                  </Field>
                  {item && fType !== item.type && (
                    <div className="text-xs text-warning bg-warning-bg rounded-md px-2.5 py-1.5 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                      <span>
                        Cambiar la naturaleza recolocará este artículo
                        {typeUsersCount !== null ? ` en ${typeUsersCount} plato${typeUsersCount === 1 ? '' : 's'}` : ' en las recetas donde se usa'} y
                        recalculará su desglose de coste. No cambia su precio.
                      </span>
                    </div>
                  )}
                </div>
                <Field label="Nombre"><input type="text" value={fName} onChange={(e) => setFName(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Nombre comercial / alternativo" hint="Cómo lo llama el proveedor, la factura o el TPV."><input type="text" value={fAltName} onChange={(e) => setFAltName(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Familia">
                  <select value={fFamilyId} onChange={(e) => setFFamilyId(e.target.value)} disabled={saving} className={`${INPUT_CLS} cursor-pointer`}>
                    <option value="">— Sin clasificar —</option>
                    {families.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                </Field>
                <Field label="Código interno"><input type="text" value={fCode} onChange={(e) => setFCode(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Origen / procedencia" hint="Trazabilidad de origen (opcional)."><input type="text" value={fOrigin} onChange={(e) => setFOrigin(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                <Field label="Unidad base" hint="Afecta a cómo se interpretan compra y receta. Cámbiala solo si estaba mal.">
                  <select value={fBaseUnitId} onChange={(e) => setFBaseUnitId(e.target.value)} disabled={saving || units.length === 0} className={`${INPUT_CLS} cursor-pointer`}>
                    {Array.from(unitsGrouped.entries()).map(([dim, list]) => (
                      <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                        {list.map((u) => (<option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* Coste */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Coste</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Estrategia de coste" hint={COST_STRATEGY_OPTIONS.find((o) => o.value === fCostStrategy)?.hint}>
                  <select value={fCostStrategy} onChange={(e) => setFCostStrategy(e.target.value as CostStrategy)} disabled={saving} className={`${INPUT_CLS} cursor-pointer`}>
                    {COST_STRATEGY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </Field>
                {isRaw && (
                  <Field label="Merma por defecto (%)" hint="Parte que se pierde al preparar. El coste real usa cantidad bruta.">
                    <input type="text" inputMode="decimal" value={fWastePct} onChange={(e) => setFWastePct(e.target.value)} disabled={saving} placeholder="Ej: 8" className={INPUT_CLS} />
                  </Field>
                )}
              </div>
            </div>

            {/* Conservación y temporada */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Conservación y temporada</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Conservación">
                  <select value={fConservation} onChange={(e) => setFConservation(e.target.value)} disabled={saving} className={`${INPUT_CLS} cursor-pointer`}>
                    <option value="">—</option>
                    {CONSERVATION_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </Field>
                {isRaw && (
                  <>
                    <Field label="Temp. de servicio (°C)"><input type="text" inputMode="decimal" value={fServiceTemp} onChange={(e) => setFServiceTemp(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                    <Field label="Vida útil (días)" hint="Caducidad típica; habilitará alertas FIFO."><input type="text" inputMode="numeric" value={fShelfLife} onChange={(e) => setFShelfLife(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Temporada desde"><input type="date" value={fSeasonStart} onChange={(e) => setFSeasonStart(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                      <Field label="hasta"><input type="date" value={fSeasonEnd} onChange={(e) => setFSeasonEnd(e.target.value)} disabled={saving} className={INPUT_CLS} /></Field>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Alérgenos (editables) — solo ingrediente */}
            {isRaw && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Alérgenos</h3>
              <p className="text-[11px] text-text-secondary -mt-1.5">Declaración por los 14 del Reglamento UE 1169. Marca el estado de cada uno.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EU_ALLERGENS.map((a) => {
                  const current = fAllergens.get(a.code)
                  return (
                    <div key={a.code} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border-default bg-page">
                      <span className="text-sm text-text-primary">{a.labelEs}</span>
                      <select
                        value={current ?? ''}
                        disabled={saving}
                        onChange={(e) => {
                          const v = e.target.value
                          setFAllergens((prev) => {
                            const next = new Map(prev)
                            if (v === '') next.delete(a.code)
                            else next.set(a.code, v as AllergenState)
                            return next
                          })
                        }}
                        className="text-xs border border-border-default rounded-md bg-card text-text-primary px-1.5 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="">No aplica</option>
                        {ALLERGEN_STATES.map((s) => (
                          <option key={s} value={s}>{allergenStateLabel(s)}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
            )}

            {/* Nutrición (editable, por 100 g) — solo ingrediente */}
            {isRaw && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Nutrición (por 100 g)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {NUTRITION_FIELDS.map(({ key, label, unit }) => (
                  <Field key={key} label={`${label} (${unit})`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fNutrition[key] ?? ''}
                      disabled={saving}
                      onChange={(e) => setFNutrition((prev) => ({ ...prev, [key]: e.target.value }))}
                      className={INPUT_CLS}
                    />
                  </Field>
                ))}
              </div>
            </div>
            )}

            {/* Etiquetas de menú (editables) — solo ingrediente */}
            {isRaw && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Etiquetas de menú</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(MENU_TAG_LABEL).map(([code, label]) => {
                  const sel = fMenuTags.has(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={saving}
                      onClick={() => setFMenuTags((prev) => {
                        const next = new Set(prev)
                        if (next.has(code)) next.delete(code)
                        else next.add(code)
                        return next
                      })}
                      className={
                        'text-xs px-3 py-1.5 rounded-full border transition-base flex items-center gap-1 ' +
                        (sel
                          ? 'bg-accent-bg border-accent/40 text-text-primary'
                          : 'bg-page border-border-default text-text-secondary')
                      }
                    >
                      {sel && <Check className="w-3 h-3 text-accent" />}
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {formError && (<div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{formError}</div>)}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
                <X size={14} /> Cancelar
              </button>
              <button type="button" onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ───────── MODO VISTA ───────── */
        <>
          {/* HERO PARTIDO */}
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            {/* foto + acciones */}
            <div className="w-full md:w-[38%] md:min-w-[230px] flex flex-col rounded-lg overflow-hidden border border-border-default flex-shrink-0">
              <div className="relative flex-1 min-h-[150px] bg-accent-bg flex items-center justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt={item.name} className="w-full h-full object-cover absolute inset-0" />
                ) : (
                  <ChefHat size={46} className="text-accent/35" />
                )}
              </div>
              <div className="flex gap-2 p-2.5 bg-card border-t border-border-default">
                {!photoConfirmDelete ? (
                  <>
                    <button type="button" onClick={() => document.getElementById('ingredient-photo-input')?.click()} disabled={photoUploading || photoDeleting}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base disabled:opacity-50">
                      {photoUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                      {photoUploading ? 'Subiendo…' : item.kitchenPhotoUrl ? 'Cambiar foto' : 'Añadir foto'}
                    </button>
                    {item.kitchenPhotoUrl && (
                      <button type="button" onClick={() => setPhotoConfirmDelete(true)} disabled={photoUploading || photoDeleting} aria-label="Eliminar foto"
                        className="w-10 inline-flex items-center justify-center rounded-md border border-border-default bg-card text-text-secondary hover:text-danger transition-base disabled:opacity-50">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <span className="text-sm text-text-secondary">¿Eliminar foto?</span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={onPhotoDelete} disabled={photoDeleting} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-danger text-white hover:opacity-90 disabled:opacity-50 transition-base">
                        {photoDeleting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Sí
                      </button>
                      <button type="button" onClick={() => setPhotoConfirmDelete(false)} disabled={photoDeleting} className="px-2.5 py-1 rounded-md text-xs font-medium text-text-secondary hover:bg-page disabled:opacity-50 transition-base">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* cuadro de mando */}
            <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-border-default bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-display font-medium text-text-primary leading-tight truncate">{item.name}</h1>
                  <div className="text-sm text-text-secondary mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {familyName && <span className="inline-flex items-center gap-1"><Tag size={12} /> {familyName}</span>}
                    {familyName && <span className="text-border-default">·</span>}
                    <span>{item.conservationType ? CONSERVATION_LABEL[item.conservationType] ?? item.conservationType : 'Ingrediente'}</span>
                    {baseUnit && <><span className="text-border-default">·</span><span>base {baseUnit.abbreviation}</span></>}
                  </div>
                  {menuTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {menuTags.map((tag) => (
                        <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent font-medium">
                          {MENU_TAG_LABEL[tag] ?? tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-medium ${usable ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}>
                    {usable ? <Check size={12} /> : <AlertTriangle size={12} />}
                    {usable ? 'Utilizable' : 'Incompleto'}
                  </span>
                  <IngredientAiAssistButton
                    itemId={item.id}
                    accountId={item.accountId}
                    onApplied={() => setReloadTick(t => t + 1)}
                  />
                  <button type="button" onClick={openEdit} aria-label="Editar" className="p-1.5 rounded-md text-text-secondary hover:text-accent hover:bg-page transition-base"><Pencil size={15} /></button>
                </div>
              </div>

              <div className="flex items-baseline gap-3 mt-3">
                <span className="font-mono text-3xl font-medium text-text-primary">{formatEur(cost)}</span>
                <span className="text-sm text-text-secondary">
                  {baseUnit ? `/ ${baseUnit.abbreviation}` : ''} · {costOrigin}
                  {item.costUpdatedAt ? ` · act. ${formatDateShort(item.costUpdatedAt)}` : ''}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 mt-4">
                <div className="bg-page rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">Stock aquí</div>
                  <div className="font-mono text-sm text-text-tertiary">— <span className="font-sans text-xs">sin inventario</span></div>
                </div>
                <div className="bg-page rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">Usado en</div>
                  <div className="font-mono text-sm text-text-primary">{usageCount === null ? '—' : usageCount} <span className="font-sans text-xs text-text-secondary">platos</span></div>
                </div>
                <div className="bg-page rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">Proveedor</div>
                  <div className="text-sm text-text-primary truncate">{preferredSupplierName ?? '—'}</div>
                </div>
              </div>

              <div className="flex items-center gap-4 mt-auto pt-4">
                {checks.map((c) => (
                  <span key={c.label} className={`inline-flex items-center gap-1.5 text-xs ${c.ok ? 'text-success' : 'text-text-tertiary'}`}>
                    <span className={`w-2 h-2 rounded-full ${c.ok ? 'bg-success' : 'bg-border-default'}`} />{c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* SECCIONES */}
          <div className="mt-4 rounded-lg border border-border-default bg-card overflow-hidden">
            <CollapsibleSection icon={<Tag size={16} />} title="Identidad y clasificación" defaultOpen>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label="Nombre comercial" value={item.altName ?? '—'} />
                <DataCell label="Familia" value={familyName ?? 'Sin clasificar'} />
                <DataCell label="Código" value={item.code ?? '—'} mono />
                <DataCell label="Origen" value={item.origin ?? '—'} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={<TrendingUp size={16} />} title="Coste y uso" defaultOpen>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label={`Coste / ${baseUnit?.abbreviation ?? 'base'}`} value={formatEur(cost)} mono />
                <DataCell label="Origen del coste" value={costOrigin} />
                {isRaw && <DataCell label="Merma por defecto" value={item.defaultWastePct != null ? `${item.defaultWastePct} %` : '—'} mono />}
                <DataCell label="Usado en" value={usageCount === null ? '—' : `${usageCount} platos`} mono />
              </div>
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label="Actualizado" value={formatDateShort(item.costUpdatedAt)} />
              </div>
            </CollapsibleSection>

            {isRaw && (
            <CollapsibleSection icon={<AlertTriangle size={16} />} title="Alérgenos" badge={allergens.length > 0 ? undefined : 'Sin declarar'} badgeTone="neutral" defaultOpen={allergens.length > 0}>
              {allergens.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {allergens.map((a) => (
                    <span
                      key={a.code}
                      className={
                        'text-[11px] px-2.5 py-1 rounded-full font-medium ' +
                        (a.state === 'free'
                          ? 'bg-success-bg text-success'
                          : a.state === 'may_contain'
                            ? 'bg-warning-bg text-warning'
                            : 'bg-danger-bg text-danger')
                      }
                    >
                      {allergenLabel(a.code)} · {allergenStateLabel(a.state)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-secondary">Sin alérgenos declarados. Edita la ficha o usa "Completar con IA" para añadirlos.</p>
              )}
            </CollapsibleSection>
            )}

            {isRaw && (
            <CollapsibleSection icon={<Activity size={16} />} title="Nutrición" badge={hasNutrition ? undefined : 'Próximamente'} badgeTone="neutral">
              {hasNutrition ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm max-w-md">
                  {NUTRITION_FIELDS.map(({ key, label, unit }) =>
                    nutritionData[key] != null ? (
                      <div key={key} className="flex justify-between border-b border-border-subtle py-0.5">
                        <span className="text-text-secondary">{label}</span>
                        <span className="text-text-primary font-medium">{nutritionData[key]} {unit}</span>
                      </div>
                    ) : null,
                  )}
                  <p className="col-span-2 text-[11px] text-text-secondary mt-1.5">Valores por 100 g · orientativos</p>
                </div>
              ) : (
                <p className="text-sm text-text-secondary">Información nutricional por 100 g. Pendiente de editor.</p>
              )}
            </CollapsibleSection>
            )}

            {isRaw && (
            <CollapsibleSection icon={<Scissors size={16} />} title="Cortes y merma" badge="Próximamente" badgeTone="neutral">
              <p className="text-sm text-text-secondary">Cortes con su rendimiento y coste resultante.</p>
            </CollapsibleSection>
            )}

            <CollapsibleSection icon={<Boxes size={16} />} title="Stock por almacén">
              <ItemStockPanel
                accountId={item.accountId}
                recipeItemId={item.id}
                itemName={item.name}
                actorId={actorId}
                actorName={actorName}
              />
            </CollapsibleSection>

            <CollapsibleSection icon={<Clock size={16} />} title="Movimientos del artículo">
              <ItemMovementsPanel
                accountId={item.accountId}
                recipeItemId={item.id}
                unitAbbr={baseUnit?.abbreviation ?? null}
                activeLocationId={activeLocationId ?? null}
              />
            </CollapsibleSection>

            <CollapsibleSection icon={<Snowflake size={16} />} title="Conservación y temporada">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <DataCell label="Conservación" value={item.conservationType ? CONSERVATION_LABEL[item.conservationType] ?? item.conservationType : '—'} />
                {isRaw && <DataCell label="Temp. de servicio" value={item.serviceTempC != null ? `${item.serviceTempC} °C` : '—'} />}
                {isRaw && <DataCell label="Vida útil" value={item.shelfLifeDays != null ? `${item.shelfLifeDays} días` : '—'} mono />}
                {isRaw && <DataCell label="Temporada" value={formatSeason(item.seasonStart, item.seasonEnd)} />}
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={<Settings2 size={16} />} title="Avanzado">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <div><div className="text-[11px] text-text-secondary">Código</div><div className="font-mono text-text-primary">{item.code ?? item.id.slice(0, 8)}</div></div>
                <div><div className="text-[11px] text-text-secondary">Unidad base</div><div className="text-text-primary">{baseUnit ? `${baseUnit.name} (${baseUnit.abbreviation})` : '—'}</div></div>
                <div><div className="text-[11px] text-text-secondary">Origen del dato</div><div className="text-text-primary">{item.source === 'manual' ? 'Manual' : item.source === 'ocr_invoice' ? 'OCR factura' : item.source === 'ai_recipe' ? 'IA' : 'Importado'}</div></div>
                <div className="sm:col-span-3 pt-2 border-t border-border-default text-[11px] text-text-secondary flex flex-wrap gap-x-6 gap-y-1">
                  <span>Creado: {formatDateLong(item.createdAt)}</span>
                  <span>Actualizado: {formatDateLong(item.updatedAt)}</span>
                  {item.createdByName ? <span>Por: {item.createdByName}</span> : null}
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* PROVEEDORES Y COMPRA */}
          <div className="mt-4">
            <PurchaseSourcesSection item={item} units={units} actorId={actorId} actorName={actorName} onChanged={() => { void refreshItem(); void refreshSuppliers() }} />
          </div>

          {/* IVA */}
          <div className="mt-4">
            <ItemVatSelector item={item} onChanged={refreshItem} />
          </div>

          {/* Eliminar (Folvy decide: borra si no se usa, archiva si sí) */}
          <div className="pt-4">
            <button
              type="button"
              onClick={openDeleteDialog}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-danger hover:bg-danger-bg transition-base"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar
            </button>
          </div>
        </>
      )}

      {/* Diálogo de confirmación de eliminar/archivar */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !deleteBusy && setDeleteOpen(false)}>
          <div className="bg-card rounded-xl w-full max-w-md p-6 border border-border-default" onClick={(e) => e.stopPropagation()}>
            {deleteCheck === null ? (
              <div className="flex items-center gap-2 text-text-secondary py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Comprobando…
              </div>
            ) : deleteCheck.deletable ? (
              <>
                <div className="flex items-center gap-2 text-text-primary mb-2">
                  <Trash2 className="w-5 h-5 text-danger" />
                  <span className="text-base font-medium">¿Eliminar «{item.name}»?</span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  Se eliminará definitivamente. Esta acción no se puede deshacer.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-text-primary mb-2">
                  <Archive className="w-5 h-5 text-warning" />
                  <span className="text-base font-medium">«{item.name}» está en uso</span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  No se puede eliminar porque: {deleteCheck.reasons.join(' · ')}. Se archivará en su
                  lugar (podrás recuperarlo).
                </p>
              </>
            )}
            {deleteCheck !== null && (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteBusy}
                  className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleteBusy}
                  className={
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium text-white transition-base disabled:opacity-50 ' +
                    (deleteCheck.deletable ? 'bg-danger hover:opacity-90' : 'bg-accent hover:opacity-90')
                  }
                >
                  {deleteBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : deleteCheck.deletable ? (
                    <Trash2 className="w-3.5 h-3.5" />
                  ) : (
                    <Archive className="w-3.5 h-3.5" />
                  )}
                  {deleteBusy ? 'Procesando…' : deleteCheck.deletable ? 'Eliminar' : 'Archivar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
