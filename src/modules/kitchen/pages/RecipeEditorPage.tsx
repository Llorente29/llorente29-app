// src/modules/kitchen/pages/RecipeEditorPage.tsx
//
// Lienzo de edición de escandallo (rediseño V1). Reemplaza a KitchenRecipePage.
// Diseño según folvy_v1_editor_escandallos_diseno.md §5 + §13 (plan de tramos).
//
// El id del plato llega por prop `recipeId` desde el contenedor
// KitchenRecipesPage (patrón LISTA + DETALLE por estado). `onBack` vuelve a la lista.
//
// TRAMOS:
//  - E1: editar cantidad inline (bruto efectivo) con latido + borrar línea.
//  - E2a (este): añadir ingrediente EXISTENTE con buscador inline ordenado por
//    USO REAL en la cuenta (RPC kitchen_raw_usage_counts) + preview de impacto en
//    coste antes de añadir (exacto: usamos la unidad base del ingrediente, sin
//    conversiones) + alta con latido. La unidad de la línea = unidad base del
//    ingrediente (elegir otra unidad = E3). Crear ingrediente nuevo = E2b.
//
// Patrón: useActiveAccount() (cuenta), igual que KitchenItemsPage.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChefHat,
  Check,
  Sparkles,
  Camera,
  ChevronDown,
  AlertTriangle,
  Mic,
  MessageCircle,
  Plus,
  Search,
  X,
  Store,
  Bike,
  ShoppingBag,
  Trash2,
  Archive,
  ShieldCheck,
  Loader2,
  Copy,
  Pencil,
  Scale,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  getRecipeItemById,
  listRecipeItems,
  getRawUsageCounts,
  createRecipeItem,
  updateRecipeItem,
  dismissReview,
  checkItemDeletable,
  deleteOrArchiveItem,
  duplicateRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import {
  getRecipeBreakdown,
  updateLine,
  deleteLine,
  addLine,
  listLinesByParent,
} from '@/modules/kitchen/services/recipeLineService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import {
  listMenuItems,
  getMenuItemEconomics,
} from '@/modules/kitchen/services/menuItemService'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { streamMessage } from '@/modules/folvy-ai/services/folvyAIService'
import {
  uploadDishPhoto,
  getDishPhotoUrl,
  deleteDishPhoto,
} from '@/modules/kitchen/services/recipePhotoService'
import {
  extractRecipeSession,
  type ImportRecipeResult,
  type ExtractedRecipeSession,
} from '@/modules/kitchen/services/recipeImportService'
import RecipeImportReviewModal from '@/modules/kitchen/components/RecipeImportReviewModal'
import AddToMenuModal from '@/modules/kitchen/components/AddToMenuModal'
import RecipeStepsTab from '@/modules/kitchen/components/RecipeStepsTab'
import ModifierImpactsTab from '@/modules/kitchen/components/ModifierImpactsTab'
import type { RecipeItem, MenuItemEconomics, KitchenUnit } from '@/types/kitchen'
import type { RecipeLineBreakdown } from '@/modules/kitchen/services/recipeLineService'

type EditorTab = 'escandallo' | 'receta' | 'modificadores' | 'etiquetado' | 'historico' | 'mas'

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'escandallo', label: 'Escandallo' },
  { id: 'receta', label: 'Receta' },
  { id: 'modificadores', label: 'Modificadores' },
  { id: 'etiquetado', label: 'Etiquetado' },
  { id: 'historico', label: 'Histórico' },
  { id: 'mas', label: 'Más' },
]

// Etiquetas de dimensión para agrupar el selector de unidad (E2b).
const DIM_LABEL: Record<string, string> = {
  weight: 'Peso',
  volume: 'Volumen',
  unit: 'Unidades',
}

function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Construye el mensaje de "por qué revisar" SOLO desde campos estructurados
// (kind + deltaPct), nunca desde summary ni referenceSource. Esto es deliberado:
// la fuente de referencia (tspoon en esta migración) es un detalle de
// implementación que NO debe aparecer en producto multi-cliente. El texto es
// propio, consistente, y matizado por la magnitud de la desviación.
function reviewReasonText(
  note: { kind?: string | null; deltaPct?: number | null } | null,
): string | null {
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

// Coste por unidad base (puede ser muy pequeño, p. ej. €/g): hasta 4 decimales.
function formatEurPrecise(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1).replace('.', ',')}%`
}

// Cantidad de línea para mostrar (sin moneda): "0,5", "85", "120".
function formatQty(value: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(value)
}

// ── E3: merma bruto/neto ──
// El cocinero edita el NETO (lo que va al plato). El bruto (lo que cuesta) se
// deriva: bruto = neto / (1 - merma/100). El coste server-side sale del bruto.
// merma 0 (o nula) → bruto = neto, comportamiento idéntico a E1.
function grossFromNet(net: number, wastePct: number): number {
  if (!Number.isFinite(wastePct) || wastePct <= 0 || wastePct >= 100) return net
  return net / (1 - wastePct / 100)
}

// % de merma efectivo de una línea, deducido de lo que hay en BBDD (bruto y neto).
// Si no hay datos suficientes, cae al default del ingrediente; si tampoco, 0.
function effectiveWastePct(line: RecipeLineBreakdown): number {
  const gross = line.quantity
  const net = line.quantityNet
  if (gross && net && gross > 0 && net > 0 && gross > net) {
    return Math.round(((gross - net) / gross) * 1000) / 10
  }
  return line.childDefaultWastePct ?? 0
}

// Normaliza para buscar: minúsculas + sin acentos. "Plátano" → "platano".
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// Búsqueda por PALABRAS (tokens), no por frase literal: todas las palabras del
// texto deben aparecer en los campos (en cualquier orden). Ignora acentos.
function matchesTokens(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = normalize(query).split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return true
  const haystack = fields
    .filter((f): f is string => !!f)
    .map((f) => normalize(f))
    .join(' ')
  return tokens.every((tok) => haystack.includes(tok))
}

// Icono según el nombre del canal (heurística por palabras clave). Local/tienda
// usa tienda; los de delivery, una bici.
function channelIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('local') || n.includes('shop') || n.includes('tienda') || n.includes('sala')) return Store
  if (n.includes('glovo') || n.includes('uber') || n.includes('just') || n.includes('deliver')) return Bike
  return ShoppingBag
}

// Color del semáforo según food_cost_status (valores reales de menu_item_economics).
function statusColor(status: string | null | undefined): string {
  switch (status) {
    case 'under':
      return 'text-success'
    case 'over':
      return 'text-danger'
    default:
      return 'text-text-secondary'
  }
}

type EconRow = MenuItemEconomics & { _brandId: string }

interface RecipeEditorPageProps {
  /** Id del plato a editar. Lo inyecta el contenedor KitchenRecipesPage. */
  recipeId?: string
  /** Vuelve a la lista de platos. Si no se pasa, no se muestra el botón Volver. */
  onBack?: () => void
  /** Abre OTRO plato en el editor (lo usa "Duplicar" para ir a la copia). */
  onOpenRecipe?: (id: string) => void
}

export default function RecipeEditorPage({
  recipeId: recipeIdProp,
  onBack,
  onOpenRecipe,
}: RecipeEditorPageProps = {}) {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { userProfile, authUserId } = useApp()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const recipeId = recipeIdProp

  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [lines, setLines] = useState<RecipeLineBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<EditorTab>('escandallo')
  // E5 — foto del plato: input oculto, estado de subida, URL firmada resuelta
  // (kitchen_photo_url guarda el PATH; la URL firmada se resuelve al renderizar).
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  // E5 visual — lightbox: al pulsar la miniatura, la foto se ve a tamaño completo.
  const [photoLightbox, setPhotoLightbox] = useState(false)
  // Recarga del plato tras "dar por revisado" (baja la bandera needs_review).
  const [reloadTick, setReloadTick] = useState(0)
  const [dismissing, setDismissing] = useState(false)
  // "Añadir a carta": modal que crea/enlaza el menu_item de este escandallo.
  const [showAddToMenu, setShowAddToMenu] = useState(false)
  // "Producción": escalado NO destructivo (vista de producción). factor=1 → apagado.
  const [prodFactor, setProdFactor] = useState(1)
  const [prodTargetText, setProdTargetText] = useState('')
  // ── Duplicar receta (copia plato + líneas + pasos y abre la copia) ──
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  // ── Editar el nombre del plato (click en el título) ──
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  // ── Importar ficha (rellenar ESTE escandallo, no crear otro) ──
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'reading' | 'done'>('idle')
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportRecipeResult | null>(null)
  // B2: sesión extraída pendiente de revisar (modal anti-duplicados).
  const [review, setReview] = useState<ExtractedRecipeSession | null>(null)

  // ── Edición inline (E1 + E3) ──
  // E1: editar cantidad. E3: el campo editable primario es el NETO (lo que va al
  // plato); el bruto (lo que cuesta) se deriva con la merma. draftWaste = merma %
  // que se está editando en el panel expandido de una línea.
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [draftQty, setDraftQty] = useState('')
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [flashLineId, setFlashLineId] = useState<string | null>(null)
  const [flashHero, setFlashHero] = useState(false)
  // E3 — merma por línea: qué línea tiene el panel de merma abierto + su draft.
  const [wasteOpenLineId, setWasteOpenLineId] = useState<string | null>(null)
  const [draftWaste, setDraftWaste] = useState('')
  // E3 — sugerencia IA de merma: línea en curso de consulta + resultado por línea.
  const [aiWasteLineId, setAiWasteLineId] = useState<string | null>(null)
  const [aiWasteSuggestions, setAiWasteSuggestions] = useState<Record<string, number>>({})
  const [aiWasteError, setAiWasteError] = useState<string | null>(null)
  // E3 — botón global "Sugerir mermas con IA" (batch, 1 sola llamada).
  const [aiBatchRunning, setAiBatchRunning] = useState(false)

  // ── Añadir ingrediente (E2a) ──
  const [addOpen, setAddOpen] = useState(false)
  // Qué tipo se está añadiendo (sección que abrió el modal): filtra candidatos y
  // textos, y decide el tipo del item al crear uno nuevo.
  const [addKind, setAddKind] = useState<'raw' | 'recipe' | 'packaging'>('raw')
  const [addSearch, setAddSearch] = useState('')
  const [addPicked, setAddPicked] = useState<RecipeItem | null>(null)
  const [addQty, setAddQty] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addableItems, setAddableItems] = useState<RecipeItem[]>([])
  const [unitsById, setUnitsById] = useState<Map<string, KitchenUnit>>(new Map())
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})
  const [addDataLoaded, setAddDataLoaded] = useState(false)
  const [addDataLoading, setAddDataLoading] = useState(false)
  // Aviso si el orden por uso (RPC) falla: el alta sigue, pero ordenado alfabético.
  const [usageNotice, setUsageNotice] = useState<string | null>(null)
  // ── Crear ingrediente nuevo al vuelo (E2b) ──
  const [addCreating, setAddCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createUnitId, setCreateUnitId] = useState('')
  const [createCost, setCreateCost] = useState('')
  const [createSaving, setCreateSaving] = useState(false)

  // ── Economía (panel azul) ──
  const [economics, setEconomics] = useState<EconRow[]>([])
  const [brandNames, setBrandNames] = useState<Record<string, string>>({})
  const [econLoading, setEconLoading] = useState(false)
  const [collapsedBrands, setCollapsedBrands] = useState<Record<string, boolean>>({})
  const [econReloadTick, setEconReloadTick] = useState(0)

  // Eliminar/archivar autónomo del plato (Folvy decide: borra si no se usa, archiva si sí).
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteCheck, setDeleteCheck] = useState<Awaited<ReturnType<typeof checkItemDeletable>> | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId || !recipeId) {
      setRecipe(null)
      setLines([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      getRecipeItemById(recipeId),
      getRecipeBreakdown(recipeId),
    ])
      .then(([item, breakdown]) => {
        if (cancelled) return
        setRecipe(item)
        setLines(breakdown)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setRecipe(null)
        setLines([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountsLoading, activeAccountId, recipeId, reloadTick])

  // Economía: marcas del plato + FC/margen por canal. Se re-dispara con
  // econReloadTick tras editar/añadir/borrar una línea (latido del FC).
  useEffect(() => {
    if (accountsLoading || !activeAccountId || !recipeId) return
    let cancelled = false
    setEconLoading(true)
    listMenuItems({ accountId: activeAccountId })
      .then(async (allItems) => {
        if (cancelled) return
        const mine = allItems.filter((mi) => mi.recipeItemId === recipeId)
        const brands = Array.from(new Set(mine.map((mi) => mi.brandId)))
        if (brands.length === 0) {
          setEconomics([])
          setBrandNames({})
          return
        }
        listBrands({ accountId: activeAccountId })
          .then((all) => {
            if (cancelled) return
            const map: Record<string, string> = {}
            for (const b of all) map[b.id] = b.name
            setBrandNames(map)
          })
          .catch(() => {
            /* nombres cosméticos */
          })
        const perBrand = await Promise.all(
          brands.map((b) =>
            getMenuItemEconomics(b)
              .then((rows) =>
                rows
                  .filter((r) => r.recipeItemId === recipeId)
                  .map((r) => ({ ...r, _brandId: b }))
              )
              .catch(() => [] as (MenuItemEconomics & { _brandId: string })[])
          )
        )
        if (cancelled) return
        setEconomics(perBrand.flat())
      })
      .catch(() => {
        if (!cancelled) setEconomics([])
      })
      .finally(() => {
        if (!cancelled) setEconLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountsLoading, activeAccountId, recipeId, econReloadTick])

  // E5 — resolver la URL firmada de la foto del plato a partir del path guardado.
  // kitchen_photo_url guarda el storage path (bucket privado); la URL firmada
  // caduca, así que se regenera al cargar/cambiar la foto.
  useEffect(() => {
    let cancelled = false
    const stored = recipe?.kitchenPhotoUrl ?? null
    if (!stored) {
      setPhotoUrl(null)
      return
    }
    getDishPhotoUrl(stored)
      .then((url) => {
        if (!cancelled) setPhotoUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [recipe?.kitchenPhotoUrl])

  const totalCost = useMemo(
    () => lines.reduce((acc, l) => acc + (l.lineCost ?? 0), 0),
    [lines]
  )

  // ── "Producción": escalar el escandallo a un volumen objetivo (NO destructivo) ──
  // El coste es lineal en la cantidad → escalar = multiplicar lo que se muestra
  // (cantidades y coste de línea + totales) por un factor. No escribe en BD.
  const baseYield = recipe?.yieldPortions && recipe.yieldPortions > 0 ? recipe.yieldPortions : null

  function applyProdTarget(text: string) {
    setProdTargetText(text)
    const n = parseFloat(text.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) { setProdFactor(1); return }
    // Con raciones declaradas, el input es el OBJETIVO (raciones) → factor = objetivo / base.
    // Sin raciones declaradas, el input es el MULTIPLICADOR directo.
    setProdFactor(baseYield ? n / baseYield : n)
  }

  function applyProdMultiplier(mult: number) {
    setProdFactor(mult)
    setProdTargetText(baseYield ? String(Math.round(baseYield * mult)) : String(mult))
  }

  function resetProd() {
    setProdFactor(1)
    setProdTargetText('')
  }

  // Al cambiar de plato, salir de la vista de producción (no arrastrar el factor).
  useEffect(() => {
    setProdFactor(1)
    setProdTargetText('')
  }, [recipeId])

  const maxLineCost = useMemo(
    () => lines.reduce((max, l) => Math.max(max, l.lineCost ?? 0), 0),
    [lines]
  )

  // Tres secciones del escandallo por tipo del hijo. Nada se oculta: lo que no
  // sea 'recipe' ni 'packaging' (raw, tool, desconocido) cae en Ingredientes.
  const ingredientLines = useMemo(
    () => lines.filter((l) => l.childType !== 'recipe' && l.childType !== 'packaging'),
    [lines]
  )
  const subRecipeLines = useMemo(
    () => lines.filter((l) => l.childType === 'recipe'),
    [lines]
  )
  const packagingLines = useMemo(
    () => lines.filter((l) => l.childType === 'packaging'),
    [lines]
  )
  // Desglose de coste del plato (mismas líneas que el total → siempre cuadra).
  const packagingCost = useMemo(
    () => packagingLines.reduce((acc, l) => acc + (l.lineCost ?? 0), 0),
    [packagingLines]
  )
  const foodCost = totalCost - packagingCost

  // Propagación de estado al plato (decisión Julio 30/05): un plato con CUALQUIER
  // ingrediente sin terminar (childNeedsReview) o línea no costeable (needsReview)
  // es un plato INCOMPLETO. Se combina con el needs_review propio del plato.
  const dishHasIncompleteLine = useMemo(
    () => lines.some((l) => l.childNeedsReview || l.needsReview),
    [lines]
  )
  const dishNeedsReview = (recipe?.needsReview ?? false) || dishHasIncompleteLine

  // Líneas NO CONVERTIBLES (unidad sin conversión a la base): aportan 0 al total
  // → el coste mostrado infra-cuenta. Señal VIVA (de `lines`, en sync con lo que
  // se pinta), no de recipe.completeness (que no se recarga al editar una línea).
  const unconvertibleLineCount = useMemo(
    () => lines.filter((l) => l.needsReview).length,
    [lines]
  )

  // ── Motivo de revisión (flag propio del plato) ──
  // El plato puede estar marcado para revisar por su PROPIO needs_review
  // (típicamente un diagnóstico de coste con review_notes). En ese caso
  // mostramos un aviso accionable con el motivo construido desde campos
  // estructurados (sin nombrar la fuente) y permitimos "dar por revisado".
  // OJO: si el plato sale "Revisar" solo por una línea incompleta, eso NO se
  // descarta aquí (se arregla terminando el ingrediente), así que el aviso y
  // el botón solo aplican al flag propio (recipe.needsReview).
  const ownNeedsReview = recipe?.needsReview ?? false
  const reviewReason = useMemo(
    () => reviewReasonText(recipe?.reviewNotes ?? null),
    [recipe?.reviewNotes],
  )

  // ── E5: foto del plato ──
  // Abre el selector de archivo (input oculto). El botón de la cabecera lo dispara.
  function openPhotoPicker() {
    setPhotoError(null)
    photoInputRef.current?.click()
  }

  // Sube la foto elegida: comprime → sube a recipe-uploads → guarda el PATH en
  // kitchen_photo_url → re-resuelve la URL firmada. Borra la foto anterior si la
  // había (no deja huérfanos en el bucket). Optimista en el spinner, no en la img
  // (esperamos al path real para no mostrar una preview que luego falle).
  async function handlePhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Permitir volver a elegir el mismo archivo: limpiamos el value del input.
    e.target.value = ''
    if (!file || !recipe || !activeAccountId) return

    setPhotoError(null)
    setPhotoUploading(true)
    const previousPath = recipe.kitchenPhotoUrl ?? null
    try {
      const path = await uploadDishPhoto(activeAccountId, recipe.id, file)
      const updated = await updateRecipeItem(recipe.id, { kitchenPhotoUrl: path })
      setRecipe(updated)
      // Borrar la foto anterior del bucket (no fatal si falla).
      if (previousPath && previousPath !== path) {
        deleteDishPhoto(previousPath).catch(() => {
          /* no fatal */
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo subir la foto.'
      setPhotoError(msg)
      window.setTimeout(() => setPhotoError(null), 5000)
    } finally {
      setPhotoUploading(false)
    }
  }

  async function handleDismissReview() {
    if (!recipe || dismissing) return
    const ok = window.confirm(
      `¿Marcar "${recipe.name}" como revisado? El aviso desaparecerá y el plato pasará a Validado. Quedará registrado quién y cuándo.`,
    )
    if (!ok) return
    setDismissing(true)
    setError(null)
    try {
      await dismissReview(recipe.id, 'Revisado manualmente desde el editor', authUserId ?? null)
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
    } finally {
      setDismissing(false)
    }
  }

  // Duplica el escandallo completo (plato + líneas + pasos) en una operación
  // atómica server-side y abre la copia en el editor para retocarla. Útil para
  // platos que se diferencian en 1-2 ingredientes.
  async function handleDuplicate() {
    if (!recipe || duplicating) return
    const ok = window.confirm(
      `¿Duplicar "${recipe.name}"? Se creará una copia con todos sus ingredientes y pasos, marcada para revisar, y la abriremos para que la ajustes.`,
    )
    if (!ok) return
    setDuplicating(true)
    setDuplicateError(null)
    try {
      const newId = await duplicateRecipeItem(recipe.id)
      if (onOpenRecipe) {
        onOpenRecipe(newId)
      } else {
        // Sin navegación disponible: al menos recargar para reflejar el estado.
        setReloadTick((t) => t + 1)
      }
    } catch (err: unknown) {
      setDuplicateError(err instanceof Error ? err.message : 'No se pudo duplicar la receta.')
    } finally {
      setDuplicating(false)
    }
  }

  // Edición del nombre del plato (click en el título → input → guardar).
  function startEditName() {
    if (!recipe) return
    setNameDraft(recipe.name)
    setEditingName(true)
  }
  async function saveName() {
    if (!recipe || savingName) return
    const next = nameDraft.trim()
    if (!next || next === recipe.name) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    try {
      await updateRecipeItem(recipe.id, { name: next })
      setEditingName(false)
      setReloadTick((t) => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el nombre.')
    } finally {
      setSavingName(false)
    }
  }

  // Importa una ficha (foto/PDF/Excel/Word) y RELLENA este escandallo (no crea
  // otro): pasa targetRecipeId = recipeId. La RPC borra las líneas viejas y las
  // reemplaza. Al terminar refrescamos plato+líneas (reloadTick) y FC
  // (econReloadTick), igual que tras editar una línea.
  async function handleImportRecipe(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeAccountId || !recipeId) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    setReview(null)
    setImportStage('uploading')
    try {
      // Cambio de etapa para feedback (la subida es rápida; la IA tarda).
      window.setTimeout(() => setImportStage((s) => (s === 'uploading' ? 'reading' : s)), 800)
      // B2: extrae y abre la revisión (rellena ESTE plato vía targetRecipeId).
      // La materialización (y el refresco) ocurren al "Terminar" en el modal.
      const session = await extractRecipeSession(activeAccountId, file, { targetRecipeId: recipeId })
      setReview(session)
      setImportStage('idle')
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'No se pudo importar la ficha.')
      setImportStage('idle')
    } finally {
      setImporting(false)
    }
  }

  function closeImportModal() {
    setImportStage('idle')
    setImportError(null)
    setImportResult(null)
  }

  const econByBrand = useMemo(() => {
    const groups = new Map<string, { brandId: string; flowType: string; rows: EconRow[] }>()
    for (const r of economics) {
      const g = groups.get(r._brandId)
      if (g) g.rows.push(r)
      else groups.set(r._brandId, { brandId: r._brandId, flowType: r.flowType, rows: [r] })
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.flowType !== b.flowType) return a.flowType === 'own' ? -1 : 1
      return (brandNames[a.brandId] ?? '').localeCompare(brandNames[b.brandId] ?? '')
    })
  }, [economics, brandNames])

  useEffect(() => {
    if (econByBrand.length === 0) return
    setCollapsedBrands((prev) => {
      const next = { ...prev }
      for (const g of econByBrand) {
        if (next[g.brandId] === undefined) next[g.brandId] = g.flowType === 'licensed'
      }
      return next
    })
  }, [econByBrand])

  // Ids de los ingredientes ya presentes en la receta (para marcar "ya en la receta").
  const existingChildIds = useMemo(
    () => new Set(lines.map((l) => l.childItemId)),
    [lines]
  )

  // Candidatos del buscador: raws + preparaciones, filtrados por TOKENS (todas
  // las palabras, en cualquier orden, sin acentos), ordenados por USO REAL, tope 8.
  const candidates = useMemo(() => {
    const q = addSearch.trim()
    let items = addableItems.filter((it) => it.type === addKind)
    if (q !== '') {
      items = items.filter((it) => matchesTokens(q, it.name, it.code))
    }
    const sorted = [...items].sort((a, b) => {
      const ua = usageCounts[a.id] ?? 0
      const ub = usageCounts[b.id] ?? 0
      if (ub !== ua) return ub - ua
      return a.name.localeCompare(b.name)
    })
    return sorted.slice(0, 8)
  }, [addableItems, addSearch, usageCounts, addKind])

  // Unidades agrupadas por dimensión para el selector de "crear ingrediente" (E2b).
  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    for (const u of units) {
      const list = groups.get(u.dimension) ?? []
      list.push(u)
      groups.set(u.dimension, list)
    }
    return Array.from(groups.entries())
  }, [units])

  // ── Handlers de latido / edición (E1) ──

  function triggerLatido(lineId?: string | null) {
    setFlashHero(true)
    if (lineId) setFlashLineId(lineId)
    window.setTimeout(() => {
      setFlashHero(false)
      setFlashLineId(null)
    }, 800)
  }

  function startEdit(line: RecipeLineBreakdown) {
    setEditError(null)
    setEditingLineId(line.lineId)
    // E3: se edita el NETO (lo que va al plato), no el bruto.
    const net = line.quantityNet ?? line.quantity
    setDraftQty(String(net).replace('.', ','))
  }

  function commitEdit(line: RecipeLineBreakdown) {
    if (editingLineId !== line.lineId || !recipeId) {
      setEditingLineId(null)
      return
    }
    const raw = draftQty.trim().replace(',', '.')
    setEditingLineId(null)

    const net = Number(raw)
    if (raw === '' || !Number.isFinite(net) || net < 0) {
      setEditError(`Cantidad no válida para "${line.childName}". No se guardó.`)
      window.setTimeout(() => setEditError(null), 3000)
      return
    }
    const prevNet = line.quantityNet ?? line.quantity
    if (net === prevNet) return

    // E3: el neto es lo que teclea Pamela; el bruto (lo que cuesta) se deriva
    // con la merma efectiva de la línea. Se guardan AMBOS en una sola llamada.
    const waste = effectiveWastePct(line)
    const gross = grossFromNet(net, waste)

    const prevLines = lines
    setLines((prev) =>
      prev.map((l) =>
        l.lineId === line.lineId ? { ...l, quantityNet: net, quantity: gross } : l
      )
    )
    setSavingLineId(line.lineId)
    setEditError(null)

    updateLine(line.lineId, { quantityNet: net, quantityGross: gross })
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(line.lineId)
        setEconReloadTick((t) => t + 1)
      })
      .catch((err: unknown) => {
        setLines(prevLines)
        const msg = err instanceof Error ? err.message : 'Error al guardar la cantidad'
        setEditError(msg)
        window.setTimeout(() => setEditError(null), 4000)
      })
      .finally(() => setSavingLineId(null))
  }

  // ── E3: editar la merma de una línea (override por receta) ──
  // Cambia el % de merma de ESTA línea: recalcula el bruto desde el neto actual.
  // No toca el default del ingrediente (recipe_item) — eso es dato compartido y
  // se decide aparte. Aquí es un override local y reversible.
  function openWaste(line: RecipeLineBreakdown) {
    setEditError(null)
    setWasteOpenLineId(line.lineId)
    setDraftWaste(String(effectiveWastePct(line)).replace('.', ','))
  }

  function commitWaste(line: RecipeLineBreakdown) {
    if (wasteOpenLineId !== line.lineId || !recipeId) {
      setWasteOpenLineId(null)
      return
    }
    const raw = draftWaste.trim().replace(',', '.')
    setWasteOpenLineId(null)

    const waste = Number(raw)
    if (raw === '' || !Number.isFinite(waste) || waste < 0 || waste >= 100) {
      setEditError(`Merma no válida para "${line.childName}" (0–99%). No se guardó.`)
      window.setTimeout(() => setEditError(null), 3000)
      return
    }
    const net = line.quantityNet ?? line.quantity
    const gross = grossFromNet(net, waste)
    if (gross === line.quantity) return

    const prevLines = lines
    setLines((prev) =>
      prev.map((l) => (l.lineId === line.lineId ? { ...l, quantity: gross } : l))
    )
    setSavingLineId(line.lineId)
    setEditError(null)

    updateLine(line.lineId, { quantityNet: net, quantityGross: gross })
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(line.lineId)
        setEconReloadTick((t) => t + 1)
      })
      .catch((err: unknown) => {
        setLines(prevLines)
        const msg = err instanceof Error ? err.message : 'Error al guardar la merma'
        setEditError(msg)
        window.setTimeout(() => setEditError(null), 4000)
      })
      .finally(() => setSavingLineId(null))
  }

  // ── E3: sugerencia de merma por IA (cimiento del proyecto) ──
  // Cuando un ingrediente no tiene merma conocida, preguntamos a Folvy AI un %
  // de merma de preparación típico. La IA SOLO sugiere: el número no se guarda
  // hasta que Pamela lo aplica (constitución Folvy AI: "no escribe sin confirmar").
  // El stream SSE se acumula y se extrae el primer número del texto final.
  function suggestWasteAI(line: RecipeLineBreakdown) {
    if (!activeAccountId || aiWasteLineId) return
    setAiWasteError(null)
    setAiWasteLineId(line.lineId)
    let acc = ''
    streamMessage(
      {
        accountId: activeAccountId,
        surface: 'background',
        message:
          `¿Qué porcentaje de merma de preparación (limpieza, recorte, pelado) ` +
          `tiene típicamente el ingrediente "${line.childName}" en una cocina ` +
          `profesional? Responde SOLO con el número del porcentaje, sin texto ` +
          `(ejemplo: 24). Si no procede merma, responde 0.`,
        history: [],
      },
      (evt) => {
        if (evt.type === 'text') {
          acc += evt.content
        } else if (evt.type === 'done' || evt.type === 'partial_end') {
          const m = acc.match(/\d{1,3}(?:[.,]\d+)?/)
          const val = m ? Number(m[0].replace(',', '.')) : NaN
          if (Number.isFinite(val) && val >= 0 && val < 100) {
            setAiWasteSuggestions((prev) => ({ ...prev, [line.lineId]: val }))
          } else {
            setAiWasteError('La IA no devolvió una merma clara. Introdúcela a mano.')
            window.setTimeout(() => setAiWasteError(null), 4000)
          }
          setAiWasteLineId(null)
        } else if (evt.type === 'error') {
          setAiWasteError('No se pudo consultar a la IA. Introduce la merma a mano.')
          window.setTimeout(() => setAiWasteError(null), 4000)
          setAiWasteLineId(null)
        }
      },
    ).catch(() => {
      setAiWasteError('No se pudo consultar a la IA. Introduce la merma a mano.')
      window.setTimeout(() => setAiWasteError(null), 4000)
      setAiWasteLineId(null)
    })
  }

  // Aplica la merma sugerida por la IA como override de la línea (no toca el
  // ingrediente). Marca de facto el origen 'ia' al persistir bruto/neto.
  function applyAiWaste(line: RecipeLineBreakdown, pct: number) {
    if (!recipeId) return
    const net = line.quantityNet ?? line.quantity
    const gross = grossFromNet(net, pct)
    const prevLines = lines
    setLines((prev) =>
      prev.map((l) => (l.lineId === line.lineId ? { ...l, quantity: gross } : l))
    )
    setSavingLineId(line.lineId)
    setAiWasteSuggestions((prev) => {
      const next = { ...prev }
      delete next[line.lineId]
      return next
    })
    // Guardar la merma aceptada como DEFAULT del ingrediente: se paga una vez a
    // la IA y se hereda en todos los platos → el gasto IA tiende a cero. Es
    // fail-safe: si falla el default, la línea igual queda bien (override local).
    updateRecipeItem(line.childItemId, { defaultWastePct: pct }).catch((err: unknown) => {
      console.error('No se pudo guardar la merma por defecto del ingrediente', err)
    })
    updateLine(line.lineId, { quantityNet: net, quantityGross: gross })
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(line.lineId)
        setEconReloadTick((t) => t + 1)
      })
      .catch((err: unknown) => {
        setLines(prevLines)
        const msg = err instanceof Error ? err.message : 'Error al aplicar la merma'
        setEditError(msg)
        window.setTimeout(() => setEditError(null), 4000)
      })
      .finally(() => setSavingLineId(null))
  }

  // E3 — líneas SIN merma conocida (ni efectiva ni default del ingrediente).
  // Son las únicas candidatas a sugerencia IA. Si está vacío, el botón global
  // no se muestra: no hay nada que sugerir → no se puede gastar IA de más.
  const linesWithoutWaste = useMemo(
    () => lines.filter((l) => effectiveWastePct(l) === 0),
    [lines]
  )

  // E3 — botón GLOBAL "Sugerir mermas con IA" (coste controlado por diseño):
  //  · UNA sola llamada a folvy-ai para TODAS las líneas sin merma (no N llamadas).
  //  · solo actúa sobre ingredientes sin merma conocida (no re-pregunta lo sabido).
  //  · las sugerencias aparecen como chips; Pamela aplica las que quiera.
  // El gasto IA es DECRECIENTE: cada ingrediente resuelto no se vuelve a consultar.
  function suggestWasteBatchAI() {
    if (!activeAccountId || aiBatchRunning) return
    const targets = linesWithoutWaste
    if (targets.length === 0) return
    setAiWasteError(null)
    setAiBatchRunning(true)

    const names = targets.map((l) => l.childName)
    let acc = ''
    streamMessage(
      {
        accountId: activeAccountId,
        surface: 'background',
        message:
          `Para cada uno de estos ingredientes, dame el porcentaje típico de merma ` +
          `de preparación (limpieza, recorte, pelado) en una cocina profesional. ` +
          `Responde SOLO un JSON array de objetos {"nombre","merma"} sin texto extra, ` +
          `con la merma como número (0 si no procede). Ingredientes: ` +
          JSON.stringify(names),
        history: [],
      },
      (evt) => {
        if (evt.type === 'text') {
          acc += evt.content
        } else if (evt.type === 'done' || evt.type === 'partial_end') {
          try {
            const m = acc.match(/\[[\s\S]*\]/)
            const arr: Array<{ nombre?: string; merma?: number }> = m ? JSON.parse(m[0]) : []
            const byName = new Map<string, number>()
            for (const it of arr) {
              if (typeof it.nombre === 'string' && typeof it.merma === 'number') {
                byName.set(it.nombre.trim().toLowerCase(), it.merma)
              }
            }
            const next: Record<string, number> = {}
            for (const l of targets) {
              const v = byName.get(l.childName.trim().toLowerCase())
              if (v !== undefined && Number.isFinite(v) && v >= 0 && v < 100 && v > 0) {
                next[l.lineId] = v
              }
            }
            if (Object.keys(next).length === 0) {
              setAiWasteError('La IA no devolvió mermas claras. Introdúcelas a mano.')
              window.setTimeout(() => setAiWasteError(null), 4000)
            } else {
              setAiWasteSuggestions((prev) => ({ ...prev, ...next }))
            }
          } catch {
            setAiWasteError('La IA no devolvió un formato válido. Introdúcelas a mano.')
            window.setTimeout(() => setAiWasteError(null), 4000)
          }
          setAiBatchRunning(false)
        } else if (evt.type === 'error') {
          setAiWasteError('No se pudo consultar a la IA. Introduce las mermas a mano.')
          window.setTimeout(() => setAiWasteError(null), 4000)
          setAiBatchRunning(false)
        }
      },
    ).catch(() => {
      setAiWasteError('No se pudo consultar a la IA. Introduce las mermas a mano.')
      window.setTimeout(() => setAiWasteError(null), 4000)
      setAiBatchRunning(false)
    })
  }

  function handleDelete(line: RecipeLineBreakdown) {
    if (!recipeId) return
    const ok = window.confirm(
      `¿Eliminar "${line.childName}" del escandallo? El coste se recalculará.`
    )
    if (!ok) return

    const prevLines = lines
    setSavingLineId(line.lineId)
    setLines((prev) => prev.filter((l) => l.lineId !== line.lineId))

    deleteLine(line.lineId)
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(null)
        setEconReloadTick((t) => t + 1)
      })
      .catch((err: unknown) => {
        setLines(prevLines)
        const msg = err instanceof Error ? err.message : 'Error al eliminar la línea'
        setEditError(msg)
        window.setTimeout(() => setEditError(null), 4000)
      })
      .finally(() => setSavingLineId(null))
  }

  // ── Handlers de alta (E2a) ──

  function costPerBase(item: RecipeItem): number {
    return item.computedCost ?? item.fixedCost ?? 0
  }

  function baseUnitAbbr(item: RecipeItem): string {
    return unitsById.get(item.baseUnitId)?.abbreviation ?? ''
  }

  // Etiqueta visible del tipo que se está añadiendo (títulos/botones/placeholder
  // del modal). Solo texto: no cambia ninguna lógica.
  const addKindLabel =
    addKind === 'packaging' ? 'packaging' : addKind === 'recipe' ? 'sub-receta' : 'ingrediente'

  function openAdd(kind: 'raw' | 'recipe' | 'packaging' = 'raw') {
    setAddKind(kind)
    setAddOpen(true)
    setAddSearch('')
    setAddPicked(null)
    setAddQty('')
    setAddError(null)
    setAddCreating(false)
    if (addDataLoaded || addDataLoading || !activeAccountId) return
    const accountId = activeAccountId
    setAddDataLoading(true)
    setUsageNotice(null)

    // Esencial para el alta: ingredientes + unidades.
    Promise.all([
      listRecipeItems({ accountId, includeInactive: false }),
      listUnits({}),
    ])
      .then(([items, unitList]) => {
        // raw + recipe + packaging; el filtro por sección lo hace `candidates`.
        const addable = items.filter(
          (it) => it.type === 'raw' || it.type === 'recipe' || it.type === 'packaging'
        )
        setAddableItems(addable)
        setUnits(unitList)
        const m = new Map<string, KitchenUnit>()
        unitList.forEach((u) => m.set(u.id, u))
        setUnitsById(m)
        setAddDataLoaded(true)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudieron cargar los ingredientes'
        setAddError(msg)
      })
      .finally(() => setAddDataLoading(false))

    // Orden por uso real: NO bloquea el alta. Si falla, avisa (no se silencia)
    // y el buscador queda ordenado alfabéticamente.
    getRawUsageCounts(accountId)
      .then((usage) => setUsageCounts(usage))
      .catch((err: unknown) => {
        console.error('getRawUsageCounts falló:', err)
        setUsageNotice('No se pudo ordenar por uso (orden alfabético).')
      })
  }

  function closeAdd() {
    setAddOpen(false)
    setAddSearch('')
    setAddPicked(null)
    setAddQty('')
    setAddError(null)
    setAddCreating(false)
    setCreateName('')
    setCreateCost('')
  }

  // Abre el mini-formulario de "crear ingrediente nuevo" con el texto buscado.
  function openCreate() {
    // Unidad por defecto: gramo si existe, si no la primera disponible.
    const gram = units.find((u) => u.abbreviation.toLowerCase() === 'g')
    setCreateUnitId(gram ? gram.id : (units[0]?.id ?? ''))
    setCreateName(addSearch.trim())
    setCreateCost('')
    setAddError(null)
    setAddCreating(true)
  }

  function cancelCreate() {
    setAddCreating(false)
    setCreateName('')
    setCreateCost('')
    setAddError(null)
  }

  // Crea el raw nuevo (source='manual', needs_review=true) y lo deja seleccionado
  // para que el usuario indique la cantidad (reutiliza el paso de cantidad de E2a).
  function confirmCreate() {
    if (!activeAccountId) return
    const name = createName.trim()
    if (name === '') {
      setAddError(`El nombre del ${addKindLabel} es obligatorio.`)
      return
    }
    if (!createUnitId) {
      setAddError('Elige una unidad base.')
      return
    }
    let cost: number | null = null
    const rawCost = createCost.trim().replace(',', '.')
    if (rawCost !== '') {
      const n = Number(rawCost)
      if (!Number.isFinite(n) || n < 0) {
        setAddError('El coste debe ser un número ≥ 0 (déjalo vacío si no lo sabes).')
        return
      }
      cost = n
    }

    setCreateSaving(true)
    setAddError(null)
    createRecipeItem({
      accountId: activeAccountId,
      type: addKind === 'packaging' ? 'packaging' : 'raw',
      name,
      baseUnitId: createUnitId,
      costStrategy: 'fixed',
      fixedCost: cost,
      source: 'manual',
      needsReview: true,
      createdBy: authUserId ?? null,
      createdByName: userProfile?.displayName ?? null,
    })
      .then((created) => {
        // Disponible para futuras búsquedas y seleccionado para indicar cantidad.
        setAddableItems((prev) => [...prev, created])
        setAddCreating(false)
        setAddPicked(created)
        setAddQty('')
        setAddSearch('')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : `No se pudo crear el ${addKindLabel}`
        setAddError(msg)
      })
      .finally(() => setCreateSaving(false))
  }

  function pickItem(item: RecipeItem) {
    setAddPicked(item)
    setAddQty('')
    setAddError(null)
  }

  function confirmAdd() {
    if (!addPicked || !recipeId || !activeAccountId) return
    const raw = addQty.trim().replace(',', '.')
    const num = Number(raw)
    if (raw === '' || !Number.isFinite(num) || num <= 0) {
      setAddError('Indica una cantidad válida (mayor que 0).')
      return
    }
    const picked = addPicked
    setAddSaving(true)
    setAddError(null)

    listLinesByParent(recipeId)
      .then((existing) => {
        const maxPos = existing.reduce((m, l) => Math.max(m, l.position ?? 0), 0)
        return addLine({
          accountId: activeAccountId,
          parentItemId: recipeId,
          childItemId: picked.id,
          quantityNet: num,
          quantityGross: num,
          unitId: picked.baseUnitId,
          position: maxPos + 1,
        })
      })
      .then((created) =>
        getRecipeBreakdown(recipeId).then((fresh) => ({ created, fresh }))
      )
      .then(({ created, fresh }) => {
        setLines(fresh)
        triggerLatido(created.id)
        setEconReloadTick((t) => t + 1)
        // Listo para añadir otro: volvemos al buscador.
        setAddPicked(null)
        setAddQty('')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudo añadir el ingrediente'
        setAddError(msg)
      })
      .finally(() => setAddSaving(false))
  }

  // Preview de impacto (exacto: unidad base → coste = coste/base × cantidad).
  const previewNum = useMemo(() => {
    const n = Number(addQty.trim().replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }, [addQty])
  const previewLineCost = addPicked ? costPerBase(addPicked) * previewNum : 0
  const previewValid = !!addPicked && previewNum > 0

  // ── Eliminar/archivar el plato (Folvy decide) ──
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
      await deleteOrArchiveItem(recipe.id)   // borra o archiva; en ambos casos sale del catálogo
      setDeleteOpen(false)
      onBack?.()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'No se pudo completar la acción.')
    } finally {
      setDeleteBusy(false)
    }
  }

  // Botón "Volver al listado" (solo si el contenedor pasó onBack).
  const backLink = onBack ? (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base mb-3"
    >
      <ArrowLeft className="w-4 h-4" />
      Volver al listado
    </button>
  ) : null

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {backLink}
        <div className="flex items-center justify-center h-64 text-text-secondary">
          Cargando escandallo…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {backLink}
        <div className="rounded-lg border border-danger/20 bg-danger-bg px-4 py-3 text-danger text-sm">
          {error}
        </div>
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {backLink}
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary gap-2">
          <ChefHat className="w-8 h-8 opacity-40" />
          <p>No se encontró el escandallo.</p>
        </div>
      </div>
    )
  }

  const isAi = recipe.source === 'ai_recipe' || recipe.source === 'ocr_invoice'

  // Render de UNA línea del escandallo. Mismo JSX para las tres secciones
  // (Ingredientes / Sub-recetas / Packaging): el tipo no cambia cómo se pinta.
  function renderLine(line: RecipeLineBreakdown) {
    const pct = maxLineCost > 0 ? Math.round(((line.lineCost ?? 0) / maxLineCost) * 100) : 0
    // "Producción": mientras se escala (factor != 1), la línea es de SOLO LECTURA
    // (vista de producción, no de edición) y cantidades/coste se multiplican.
    const scaled = prodFactor !== 1
    const editing = !scaled && editingLineId === line.lineId
    const saving = savingLineId === line.lineId
    const wasteOpen = !scaled && wasteOpenLineId === line.lineId
    const waste = effectiveWastePct(line)
    const netQty = (line.quantityNet ?? line.quantity) * prodFactor
    const dispCost = (line.lineCost ?? 0) * prodFactor
    const aiLoading = aiWasteLineId === line.lineId
    const aiSuggestion = aiWasteSuggestions[line.lineId]
    return (
      <div
        key={line.lineId}
        className="group border-b border-border-default last:border-b-0"
      >
        <div className="flex items-center gap-2.5 py-2 px-1.5">
          <span className="w-[30px] h-[30px] rounded-md bg-accent-bg inline-flex items-center justify-center flex-shrink-0">
            <span
              className={
                'w-2.5 h-2.5 rounded-full ' +
                // Línea NO MEDIBLE (falta conversión de unidad) = bloqueo (danger);
                // ingrediente SIN TERMINAR = aviso suave (warning); ok = terracota.
                (line.needsReview
                  ? 'bg-danger'
                  : line.childNeedsReview
                    ? 'bg-warning'
                    : 'bg-terracota')
              }
            />
          </span>

          {/* E3: NETO (lo que va al plato) editable inline + unidad */}
          <div className="min-w-[78px] flex-shrink-0">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={draftQty}
                  onChange={(e) => setDraftQty(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitEdit(line)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingLineId(null)
                    }
                  }}
                  onBlur={() => commitEdit(line)}
                  className="w-[50px] px-1 py-0.5 font-mono text-sm text-text-primary bg-card border border-accent rounded focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="font-mono text-sm text-text-secondary">
                  {line.unitAbbr}
                </span>
              </div>
            ) : scaled ? (
              <span
                title="Cantidad escalada (vista de producción)"
                className="font-mono text-sm text-text-primary px-1 -ml-1"
              >
                {formatQty(netQty)}{' '}
                <span className="text-text-secondary">{line.unitAbbr}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => startEdit(line)}
                title="Editar cantidad neta (lo que va al plato)"
                className="font-mono text-sm text-text-primary text-left hover:bg-accent-bg rounded px-1 -ml-1 transition-colors"
              >
                {formatQty(netQty)}{' '}
                <span className="text-text-secondary">{line.unitAbbr}</span>
              </button>
            )}
          </div>

          <span className={'flex-1 min-w-0 text-sm text-text-primary ' + (isMobile ? 'break-words' : 'truncate')}>
            {line.childName}
            {line.childNeedsReview && (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1 align-middle">
                <AlertTriangle className="w-3 h-3" />
                sin terminar
              </span>
            )}
            {line.needsReview && (
              recipeId ? (
                <button
                  type="button"
                  onClick={() => navigate('/kitchen?item=' + line.childItemId + '&return=' + recipeId)}
                  title="Definir la conversión de este ingrediente para poder medir coste y stock"
                  className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-danger-bg text-danger inline-flex items-center gap-1 align-middle hover:bg-danger hover:text-white transition-colors cursor-pointer"
                >
                  <AlertTriangle className="w-3 h-3" />
                  falta convertir la unidad
                </button>
              ) : (
                <span
                  title="Esta línea usa una unidad que no se puede convertir a la base del ingrediente: no mide coste ni descuenta stock. Falta definir la conversión."
                  className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-danger-bg text-danger inline-flex items-center gap-1 align-middle"
                >
                  <AlertTriangle className="w-3 h-3" />
                  falta convertir la unidad
                </span>
              )
            )}
            {/* E3: chip de merma. Si hay merma → mostrar y permitir override.
                Si no la hay → ofrecer sugerencia IA / añadir a mano. */}
            {!scaled && (waste > 0 ? (
              <button
                type="button"
                onClick={() => openWaste(line)}
                title="Merma de esta línea (clic para ajustar)"
                className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary inline-flex items-center gap-1 align-middle hover:text-text-primary transition-colors"
              >
                ↘ merma {formatQty(waste)}%
              </button>
            ) : aiSuggestion !== undefined ? (
              <button
                type="button"
                onClick={() => applyAiWaste(line, aiSuggestion)}
                title="Aplicar la merma sugerida por la IA"
                className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1 align-middle hover:opacity-80 transition-opacity"
              >
                <Sparkles className="w-3 h-3" />
                IA sugiere {formatQty(aiSuggestion)}% · aplicar
              </button>
            ) : aiLoading ? (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary inline-flex items-center gap-1 align-middle">
                <Loader2 className="w-3 h-3 animate-spin" />
                consultando IA…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => openWaste(line)}
                title="Añadir merma a esta línea"
                className={'ml-2 text-[11px] px-2 py-0.5 rounded-full border border-border-default text-text-secondary inline-flex items-center gap-1 align-middle ' + (isMobile ? 'opacity-100 ' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 ') + 'hover:text-text-primary transition-all'}
              >
                + merma
              </button>
            ))}
          </span>

          {!isMobile && (
            <span className="w-[38px] h-1 rounded-full bg-accent-bg overflow-hidden flex-shrink-0">
              <span
                className="block h-full bg-terracota transition-all duration-base"
                style={{ width: `${pct}%` }}
              />
            </span>
          )}

          <span
            className={
              'font-mono text-sm min-w-[52px] text-right transition-colors duration-base ' +
              // No medible: el coste de línea es 0 por falta de conversión, pero
              // mostrar "0,00 €" sería un cero disfrazado. Mostramos "—" en danger.
              (line.needsReview
                ? 'text-danger'
                : saving
                  ? 'opacity-50 animate-pulse text-text-secondary'
                  : flashLineId === line.lineId
                    ? 'text-terracota font-medium'
                    : 'text-text-secondary')
            }
            title={
              line.needsReview
                ? 'Falta convertir la unidad: no se puede medir el coste de esta línea'
                : waste > 0
                  ? `Coste sobre bruto ${formatQty(line.quantity * prodFactor)} ${line.unitAbbr}`
                  : undefined
            }
          >
            {line.needsReview ? '—' : formatEur(dispCost)}
          </span>

          {!scaled && (
            <button
              type="button"
              onClick={() => handleDelete(line)}
              disabled={saving}
              title="Eliminar línea"
              className={'ml-0.5 w-6 h-6 rounded inline-flex items-center justify-center text-text-secondary ' + (isMobile ? 'opacity-100 ' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 ') + 'hover:text-danger hover:bg-danger-bg transition-all disabled:opacity-30'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* E3: panel de merma expandido (override por receta) */}
        {wasteOpen && (
          <div className="flex items-center gap-2 pb-2.5 pl-[88px] pr-1.5 text-[13px] text-text-secondary">
            <span>Merma en esta receta:</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={draftWaste}
              onChange={(e) => setDraftWaste(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitWaste(line)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setWasteOpenLineId(null)
                }
              }}
              onBlur={() => commitWaste(line)}
              className="w-[52px] px-1 py-0.5 font-mono text-sm text-text-primary bg-card border border-accent rounded focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="font-mono">%</span>
            <span className="text-text-secondary opacity-70">
              → el bruto efectivo y el coste se recalculan
            </span>
            {waste === 0 && (
              <button
                type="button"
                onClick={() => suggestWasteAI(line)}
                disabled={aiLoading}
                className="ml-auto inline-flex items-center gap-1 text-[12px] text-terracota hover:opacity-80 disabled:opacity-50 transition-opacity"
              >
                {aiLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Sugerir con IA
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Una sección del escandallo (Ingredientes / Sub-recetas / Packaging): cabecera
  // con su acento + contador + "+" propio (abre el alta filtrada a su tipo).
  function Section({
    title, icon, kind, sectionLines, emptyHint,
  }: {
    title: string
    icon: ReactNode
    kind: 'raw' | 'recipe' | 'packaging'
    sectionLines: RecipeLineBreakdown[]
    emptyHint: string
  }) {
    const accent =
      kind === 'packaging' ? 'text-info' : kind === 'recipe' ? 'text-success' : 'text-terracota'
    return (
      <div className="mb-4 last:mb-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className={'flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase ' + accent}>
            {icon}
            <span>{title}</span>
            <span className="text-text-secondary normal-case font-normal">· {sectionLines.length}</span>
          </div>
          <button
            type="button"
            onClick={() => openAdd(kind)}
            title={`Añadir ${title.toLowerCase()}`}
            className="w-6 h-6 rounded-md bg-terracota text-white inline-flex items-center justify-center hover:bg-terracota-hover transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {sectionLines.length === 0 ? (
          <div className="py-3 text-center text-xs text-text-secondary opacity-60">{emptyHint}</div>
        ) : (
          <div>{sectionLines.map(renderLine)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      {backLink}

      {/* Diálogo de confirmación de eliminar/archivar el plato */}
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
                  <span className="text-base font-medium">¿Eliminar «{recipe.name}»?</span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  Se eliminará definitivamente. Esta acción no se puede deshacer.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-text-primary mb-2">
                  <Archive className="w-5 h-5 text-warning" />
                  <span className="text-base font-medium">«{recipe.name}» está en uso</span>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  No se puede eliminar porque: {deleteCheck.reasons.join(' · ')}. Se archivará en su
                  lugar (podrás recuperarlo).
                </p>
              </>
            )}
            {deleteError && (
              <div className="mb-3 px-2.5 py-1.5 rounded-md bg-danger-bg text-danger text-xs">{deleteError}</div>
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

      <div className="bg-card rounded-xl border border-border-default overflow-hidden">

        {/* ── Cabecera compacta con vida: foto 96px + título + chips (E5 visual) ── */}
        {/* Toque cálido (bg-terracota-bg) para no quedar plano; la foto grande va en su pestaña (G8). */}
        <div className="flex items-center gap-4 p-4 md:p-5 bg-terracota-bg border-b border-border-default">
          {/* Input de archivo oculto: cámara o galería en móvil. */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelected}
          />

          {/* Foto del plato (96px). Clic -> lightbox a tamaño completo (o añadir si no hay). */}
          <button
            type="button"
            onClick={() => (photoUrl ? setPhotoLightbox(true) : openPhotoPicker())}
            disabled={photoUploading}
            className="relative w-24 h-24 rounded-lg overflow-hidden border border-border-default bg-card flex items-center justify-center shrink-0 disabled:opacity-60"
            aria-label={photoUrl ? 'Ver foto del plato' : 'Añadir foto del plato'}
          >
            {photoUploading ? (
              <Loader2 className="w-7 h-7 text-terracota animate-spin" />
            ) : photoUrl ? (
              <img src={photoUrl} alt={recipe.name} className="w-full h-full object-cover" />
            ) : (
              <Camera className="w-8 h-8 text-terracota opacity-70" />
            )}
          </button>

          {/* Título, tipo/código, chips y botón de foto. */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              {editingName ? (
                <input
                  type="text"
                  value={nameDraft}
                  autoFocus
                  disabled={savingName}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  className="min-w-0 flex-1 text-[22px] font-display font-medium text-text-primary leading-tight bg-card border border-terracota/40 rounded-md px-2 py-0.5 focus:outline-none focus:border-terracota"
                />
              ) : (
                <h1
                  className="min-w-0 break-words text-[22px] font-display font-medium text-text-primary leading-tight inline-flex items-center gap-2 group cursor-text"
                  onClick={startEditName}
                  title="Haz clic para cambiar el nombre"
                >
                  {recipe.name}
                  <Pencil className="w-3.5 h-3.5 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </h1>
              )}
              <div className="flex gap-1.5 shrink-0">
                {isAi && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-accent text-text-on-accent inline-flex items-center gap-1 font-medium">
                    <Sparkles className="w-3.5 h-3.5" />
                    IA
                  </span>
                )}
                {dishNeedsReview ? (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-warning text-white inline-flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Revisar
                  </span>
                ) : (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-success text-white inline-flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5" />
                    Validado
                  </span>
                )}
              </div>
            </div>
            <div className="text-[13px] text-text-secondary mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5">
                <ChefHat className="w-[15px] h-[15px]" />
                {recipe.type === 'dish' ? 'Plato' : recipe.type}
              </span>
              {recipe.code && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="font-mono opacity-85">{recipe.code}</span>
                </>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={openPhotoPicker}
                disabled={photoUploading}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card text-terracota font-medium border border-terracota/30 hover:bg-terracota-bg disabled:opacity-60 transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                {photoUploading ? 'Subiendo…' : photoUrl ? 'Ver / cambiar foto' : 'Añadir foto'}
              </button>
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={duplicating}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card text-terracota font-medium border border-terracota/30 hover:bg-terracota-bg disabled:opacity-60 transition-colors"
                title="Duplicar este escandallo (copia ingredientes y pasos) y abrir la copia para ajustarla"
              >
                {duplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                {duplicating ? 'Duplicando…' : 'Duplicar'}
              </button>
              <button
                type="button"
                onClick={openDeleteDialog}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card text-danger font-medium border border-danger/30 hover:bg-danger-bg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar
              </button>
              {duplicateError && (
                <span className="px-2.5 py-1 rounded-md bg-danger text-white text-xs">
                  {duplicateError}
                </span>
              )}
              {photoError && (
                <span className="px-2.5 py-1 rounded-md bg-danger text-white text-xs">
                  {photoError}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Aviso de revisión (solo flag propio del plato) ── */}
        {ownNeedsReview && (
          <div className="mx-[18px] mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3.5 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">
                Marcado para revisar
              </p>
              <p className="text-[13px] text-text-secondary mt-0.5">
                {reviewReason ?? 'Este plato está marcado para revisar.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismissReview}
              disabled={dismissing}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-success text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
            >
              {dismissing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              {dismissing ? 'Guardando...' : 'Dar por revisado'}
            </button>
          </div>
        )}

        {/* ── Solapas ── */}
        <div className="flex gap-6 px-[18px] pt-3 border-b border-border-default text-sm overflow-x-auto">
          {TABS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={
                  'pb-3 shrink-0 whitespace-nowrap transition-colors ' +
                  (active
                    ? 'border-b-2 border-terracota text-text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary')
                }
              >
                {tab.label}
                {tab.id === 'mas' && <ChevronDown className="inline w-3.5 h-3.5 ml-0.5" />}
              </button>
            )
          })}
        </div>

        {/* ── Contenido de la solapa activa ── */}
        {activeTab === 'escandallo' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Columna izquierda: composición */}
            <div className="p-4 md:p-5 lg:border-r border-border-default">
              {/* Cabecera del escandallo + acciones rápidas (el alta vive en cada sección) */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium tracking-wide text-text-secondary uppercase">
                  Escandallo
                </span>
                <div className="flex items-center gap-1">
                  {linesWithoutWaste.length > 0 && (
                    <button
                      type="button"
                      onClick={suggestWasteBatchAI}
                      disabled={aiBatchRunning}
                      title="Sugerir la merma de los ingredientes que no la tienen, con IA"
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-terracota-bg text-terracota font-medium hover:bg-terracota/15 disabled:opacity-50 transition-colors mr-1"
                    >
                      {aiBatchRunning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      {aiBatchRunning
                        ? 'Consultando IA…'
                        : `Sugerir mermas con IA (${linesWithoutWaste.length})`}
                    </button>
                  )}
                  <button
                    title="Dictar por voz (próximamente)"
                    className="w-7 h-7 rounded-md bg-accent-bg text-text-secondary inline-flex items-center justify-center hover:text-text-primary transition-colors"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  <button
                    title="Pedir a Folvy (próximamente)"
                    className="w-7 h-7 rounded-md bg-accent-bg text-text-secondary inline-flex items-center justify-center hover:text-text-primary transition-colors"
                  >
                    <MessageCircle className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    disabled={importing}
                    title="Importar ficha (foto, PDF, Excel o Word) y rellenar este escandallo"
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-terracota-bg text-terracota font-medium hover:bg-terracota/15 disabled:opacity-50 transition-colors mr-1"
                  >
                    {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                    Importar ficha
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx"
                    className="hidden"
                    onChange={handleImportRecipe}
                  />
                </div>
              </div>

              {/* Producción: escalar el escandallo a un volumen objetivo (no destructivo). */}
              <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-accent-bg">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  <Scale className="w-3.5 h-3.5" /> Producción
                </span>
                {baseYield ? (
                  <span className="text-xs text-text-secondary">
                    Rinde {formatQty(baseYield)} raciones · para
                  </span>
                ) : (
                  <span className="text-xs text-text-secondary">Multiplicar por</span>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  value={prodTargetText}
                  onChange={(e) => applyProdTarget(e.target.value)}
                  placeholder={baseYield ? String(baseYield) : '1'}
                  className="w-[64px] px-2 py-1 font-mono text-sm text-text-primary bg-card border border-border-default rounded focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-xs text-text-secondary">{baseYield ? 'raciones' : '×'}</span>
                <div className="flex items-center gap-1">
                  {[2, 3, 0.5].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => applyProdMultiplier(m)}
                      className="text-[11px] px-2 py-1 rounded-md bg-card border border-border-default text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {m === 0.5 ? '½' : `×${m}`}
                    </button>
                  ))}
                </div>
                {prodFactor !== 1 && (
                  <span className="ml-auto inline-flex items-center gap-2">
                    <span className="text-[11px] px-2 py-1 rounded-md bg-terracota-bg text-terracota font-medium">
                      Producción {baseYield ? `· ${Math.round(baseYield * prodFactor)} raciones ` : ''}(×{formatQty(prodFactor)}) · solo lectura
                    </span>
                    <button
                      type="button"
                      onClick={resetProd}
                      className="text-[11px] px-2 py-1 rounded-md text-text-secondary hover:text-text-primary underline"
                    >
                      Restaurar
                    </button>
                  </span>
                )}
              </div>

              {/* Aviso de error de edición / IA */}
              {(editError || aiWasteError) && (
                <div className="mb-2 px-2.5 py-1.5 rounded-md bg-danger-bg text-danger text-xs">
                  {editError ?? aiWasteError}
                </div>
              )}

              {/* B2: modal de revisión anti-duplicados (rellena este plato) */}
              {review && activeAccountId && (
                <RecipeImportReviewModal
                  accountId={activeAccountId}
                  sessionId={review.sessionId}
                  dishName={review.dishName}
                  lines={review.lines}
                  onCancel={() => setReview(null)}
                  onCompleted={(result) => {
                    setReview(null)
                    setImportResult(result)
                    setImportStage('done')
                    setReloadTick((t) => t + 1)
                    setEconReloadTick((t) => t + 1)
                  }}
                />
              )}

              {/* Modal de importación de ficha (progreso + resultado) */}
              {importStage !== 'idle' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="bg-card rounded-xl w-full max-w-md p-6 border border-border-default">
                    {importStage === 'done' && importResult ? (
                      <>
                        <div className="flex items-center gap-2 text-text-primary mb-3">
                          <Sparkles className="w-5 h-5 text-terracota" />
                          <span className="text-base font-medium">Ficha importada</span>
                        </div>
                        <p className="text-sm text-text-secondary mb-1">
                          <span className="font-medium text-text-primary">{importResult.dishName}</span>{' '}
                          · {importResult.linesCreated} ingrediente{importResult.linesCreated === 1 ? '' : 's'} en el escandallo.
                        </p>
                        {importResult.newArticlesCreated > 0 && (
                          <p className="text-xs text-text-secondary mb-1">
                            {importResult.newArticlesCreated} ingrediente{importResult.newArticlesCreated === 1 ? '' : 's'} nuevo{importResult.newArticlesCreated === 1 ? '' : 's'} creado{importResult.newArticlesCreated === 1 ? '' : 's'} (marcados para completar coste y proveedor).
                          </p>
                        )}
                        {importResult.linesSkipped > 0 && (
                          <p className="text-xs text-amber-600 mb-1">
                            {importResult.linesSkipped} línea{importResult.linesSkipped === 1 ? '' : 's'} sin cantidad/unidad clara — revísalas abajo.
                          </p>
                        )}
                        <div className="flex gap-2 mt-4">
                          <button
                            type="button"
                            onClick={closeImportModal}
                            className="flex-1 px-3 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover transition-colors"
                          >
                            Ver escandallo
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-4">
                        <Loader2 className="w-8 h-8 animate-spin text-terracota mx-auto mb-3" />
                        <p className="text-sm text-text-primary font-medium">
                          {importStage === 'uploading' ? 'Subiendo la ficha…' : 'Leyendo tu ficha con IA…'}
                        </p>
                        <p className="text-xs text-text-secondary mt-1">
                          {importStage === 'uploading'
                            ? 'Un momento.'
                            : 'La IA está extrayendo ingredientes y cantidades. Puede tardar unos segundos.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Error de importación */}
              {importError && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setImportError(null)}>
                  <div className="bg-card rounded-xl w-full max-w-md p-6 border border-border-default" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 text-danger mb-2">
                      <AlertTriangle className="w-5 h-5" />
                      <span className="text-base font-medium">No se pudo importar</span>
                    </div>
                    <p className="text-sm text-text-secondary mb-4">{importError}</p>
                    <button
                      type="button"
                      onClick={() => setImportError(null)}
                      className="px-3 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              )}

              {/* Tres secciones del escandallo (Ingredientes / Sub-recetas / Packaging).
                  Vacío total → solo Ingredientes con su hint; en cuanto hay 1 línea, las tres.
                  Section se INVOCA como función (no <Section/>): así no hay frontera de
                  componente que remonte los inputs de edición inline en cada render. */}
              {lines.length === 0 && ingredientLines.length === 0 ? (
                Section({
                  title: 'Ingredientes',
                  icon: <ChefHat className="w-3.5 h-3.5" />,
                  kind: 'raw',
                  sectionLines: ingredientLines,
                  emptyHint: 'Este escandallo aún no tiene ingredientes.',
                })
              ) : (
                <>
                  {Section({
                    title: 'Ingredientes',
                    icon: <ChefHat className="w-3.5 h-3.5" />,
                    kind: 'raw',
                    sectionLines: ingredientLines,
                    emptyHint: 'Sin ingredientes todavía.',
                  })}
                  {Section({
                    title: 'Sub-recetas',
                    icon: <ChefHat className="w-3.5 h-3.5" />,
                    kind: 'recipe',
                    sectionLines: subRecipeLines,
                    emptyHint: 'Sin sub-recetas.',
                  })}
                  {Section({
                    title: 'Packaging',
                    icon: <ShoppingBag className="w-3.5 h-3.5" />,
                    kind: 'packaging',
                    sectionLines: packagingLines,
                    emptyHint: 'Sin envases. Añade la caja, bolsa, etc.',
                  })}
                </>
              )}

              {/* ── Alta de ingrediente (E2a) ── */}
              {addOpen && (
                <div className="mt-3 rounded-lg border border-terracota/40 bg-terracota-bg/50 p-2.5">
                  {addError && (
                    <div className="mb-2 px-2 py-1 rounded bg-danger-bg text-danger text-xs">
                      {addError}
                    </div>
                  )}

                  {addPicked ? (
                    // Paso 2: cantidad + preview de impacto
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="w-[30px] h-[30px] rounded-md bg-card border border-terracota/30 inline-flex items-center justify-center flex-shrink-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-terracota" />
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            value={addQty}
                            onChange={(e) => setAddQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                confirmAdd()
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                setAddPicked(null)
                                setAddQty('')
                              }
                            }}
                            placeholder="Cant."
                            className="w-[58px] px-1.5 py-1 font-mono text-sm text-text-primary bg-card border border-accent rounded focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          <span className="font-mono text-sm text-text-secondary min-w-[24px]">
                            {baseUnitAbbr(addPicked)}
                          </span>
                        </div>
                        <span className="flex-1 min-w-0 text-sm text-text-primary truncate">
                          {addPicked.name}
                        </span>
                        <button
                          type="button"
                          onClick={confirmAdd}
                          disabled={addSaving || !previewValid}
                          className="px-3 py-1 text-sm font-medium rounded-md bg-terracota text-white hover:bg-terracota-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                        >
                          {addSaving ? 'Añadiendo…' : 'Añadir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddPicked(null)
                            setAddQty('')
                          }}
                          title="Elegir otro ingrediente"
                          className="w-6 h-6 rounded inline-flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-card transition-colors flex-shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Preview de impacto (exacto en €) */}
                      <div className="mt-1.5 pl-[40px] text-xs text-text-secondary">
                        {previewValid ? (
                          <span>
                            <span className="font-mono text-terracota font-medium">
                              +{formatEur(previewLineCost)}
                            </span>{' '}
                            · el plato pasaría a{' '}
                            <span className="font-mono text-text-primary font-medium">
                              {formatEur(totalCost + previewLineCost)}
                            </span>
                          </span>
                        ) : (
                          <span className="opacity-70">Escribe la cantidad para ver el impacto.</span>
                        )}
                      </div>
                    </div>
                  ) : addCreating ? (
                    // Crear ingrediente/packaging nuevo al vuelo (E2b)
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-[30px] h-[30px] rounded-md bg-card border border-terracota/30 inline-flex items-center justify-center flex-shrink-0">
                          <Plus className="w-3.5 h-3.5 text-terracota" />
                        </span>
                        <span className="text-sm font-medium text-text-primary">
                          Nuevo {addKindLabel}
                        </span>
                        <button
                          type="button"
                          onClick={cancelCreate}
                          title="Volver al buscador"
                          className="ml-auto w-6 h-6 rounded inline-flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-card transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-col gap-2 pl-[40px]">
                        <input
                          type="text"
                          autoFocus
                          value={createName}
                          onChange={(e) => setCreateName(e.target.value)}
                          placeholder={`Nombre del ${addKindLabel}`}
                          className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <div className="flex gap-2">
                          <select
                            value={createUnitId}
                            onChange={(e) => setCreateUnitId(e.target.value)}
                            className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            {unitsGrouped.map(([dim, list]) => (
                              <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                                {list.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name} ({u.abbreviation})
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={createCost}
                            onChange={(e) => setCreateCost(e.target.value)}
                            placeholder={`Coste €/${unitsById.get(createUnitId)?.abbreviation ?? ''}`}
                            className="w-[130px] px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-text-secondary leading-snug">
                            Se marcará para revisar; completa coste y formato cuando puedas.
                          </span>
                          <button
                            type="button"
                            onClick={confirmCreate}
                            disabled={createSaving || createName.trim() === ''}
                            className="px-3 py-1.5 text-sm font-medium rounded-md bg-terracota text-white hover:bg-terracota-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                          >
                            {createSaving ? 'Creando…' : 'Crear y continuar'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Paso 1: buscador
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
                          <input
                            type="text"
                            autoFocus
                            value={addSearch}
                            onChange={(e) => setAddSearch(e.target.value)}
                            placeholder={`Buscar ${addKindLabel}…`}
                            className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={closeAdd}
                          title="Cerrar"
                          className="w-7 h-7 rounded-md inline-flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-card transition-colors flex-shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="mt-2">
                        {usageNotice && (
                          <div className="mb-1.5 px-1.5 text-[11px] text-warning">
                            {usageNotice}
                          </div>
                        )}
                        {addDataLoading ? (
                          <div className="text-xs text-text-secondary px-1 py-2">
                            Cargando ingredientes…
                          </div>
                        ) : candidates.length === 0 ? (
                          <div className="px-1 py-2">
                            <div className="text-xs text-text-secondary mb-2">
                              Sin coincidencias
                              {addSearch.trim() !== '' ? ` para «${addSearch.trim()}»` : ''}.
                            </div>
                            {addSearch.trim() !== '' && addKind !== 'recipe' && (
                              <button
                                type="button"
                                onClick={openCreate}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-terracota text-white hover:bg-terracota-hover transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Crear «{addSearch.trim()}» como {addKindLabel} nuevo
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col">
                            {addSearch.trim() === '' && (
                              <div className="text-[10px] font-semibold tracking-wide uppercase text-text-secondary px-1.5 pb-1">
                                Más usados en tus platos
                              </div>
                            )}
                            {candidates.map((item) => {
                              const used = usageCounts[item.id] ?? 0
                              const already = existingChildIds.has(item.id)
                              const cpb = costPerBase(item)
                              const abbr = baseUnitAbbr(item)
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => pickItem(item)}
                                  className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-card text-left transition-colors"
                                >
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm text-text-primary truncate">
                                      {item.name}
                                      {item.type === 'recipe' && (
                                        <span className="text-text-secondary"> (preparación)</span>
                                      )}
                                    </span>
                                    <span className="block text-[11px] text-text-secondary truncate font-mono">
                                      {item.code ? `${item.code} · ` : ''}
                                      {cpb > 0 ? `${formatEurPrecise(cpb)}/${abbr}` : 'sin coste'}
                                      {already ? ' · ya en la receta' : ''}
                                    </span>
                                  </span>
                                  {used > 0 && (
                                    <span className="text-[11px] text-text-secondary flex-shrink-0">
                                      en {used} plato{used !== 1 ? 's' : ''}
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                            {addSearch.trim() !== '' && addKind !== 'recipe' && (
                              <button
                                type="button"
                                onClick={openCreate}
                                className="mt-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md hover:bg-card text-left transition-colors text-xs font-medium text-terracota"
                              >
                                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                                ¿No está? Crear «{addSearch.trim()}» como nuevo
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Columna derecha: panel económico (azul Folvy) */}
            <div className="p-4 bg-accent text-white">
              <div className="text-[11px] font-medium tracking-wider text-white/60 uppercase mb-2.5">
                Coste en vivo
              </div>

              <div className="text-xs text-white/60">{packagingCost > 0 ? 'Plate cost' : 'Coste total'}</div>
              <div
                className={
                  'font-mono font-medium text-white leading-tight text-[34px] origin-left transition-all duration-slow ' +
                  (flashHero ? 'scale-110' : 'scale-100')
                }
              >
                {formatEur(totalCost * prodFactor)}
              </div>
              <div className="text-xs text-white/55 mt-0.5">
                por porción · {Math.round((recipe.yieldPortions ?? 1) * prodFactor)} ración
                {Math.round((recipe.yieldPortions ?? 1) * prodFactor) !== 1 ? 'es' : ''}
              </div>
              {unconvertibleLineCount > 0 && (
                <div
                  title="Una o más líneas usan una unidad sin conversión a la base del ingrediente: no entran en el coste ni descuentan stock. El total mostrado infra-cuenta hasta que las resuelvas."
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-white/15 text-white"
                >
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    Coste incompleto · falta convertir {unconvertibleLineCount}{' '}
                    {unconvertibleLineCount === 1 ? 'línea' : 'líneas'}
                  </span>
                </div>
              )}
              {packagingCost > 0 && (
                <div className="mt-2.5 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-white/55">Comida</span>
                    <span className="font-mono text-white/85">{formatEur(foodCost * prodFactor)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-white/55">Packaging</span>
                    <span className="font-mono text-white/85">{formatEur(packagingCost * prodFactor)}</span>
                  </div>
                </div>
              )}

              <div className="h-px bg-white/15 my-3.5" />

              {econLoading ? (
                <div className="text-[11px] text-white/55">Calculando food cost…</div>
              ) : economics.length === 0 ? (
                <div>
                  <div className="text-[11px] font-medium tracking-wide text-white/60 uppercase mb-2">
                    Food cost
                  </div>
                  <div className="flex items-start gap-1.5 text-[11px] text-white/70 leading-relaxed mb-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                    <span>Este plato aún no está en ninguna carta. Añádelo para ver su food cost y margen.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddToMenu(true)}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 text-white transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Añadir a carta
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {econByBrand.map((group) => {
                    const isLicensed = group.flowType === 'licensed'
                    const collapsed = collapsedBrands[group.brandId] ?? isLicensed
                    const name = brandNames[group.brandId] ?? `Marca ${group.brandId.slice(0, 6)}`
                    return (
                      <div key={group.brandId}>
                        <button
                          onClick={() =>
                            setCollapsedBrands((prev) => ({
                              ...prev,
                              [group.brandId]: !collapsed,
                            }))
                          }
                          className="w-full flex items-center gap-2 mb-2 text-left"
                        >
                          <ChevronDown
                            className={
                              'w-3.5 h-3.5 text-white/50 transition-transform ' +
                              (collapsed ? '-rotate-90' : '')
                            }
                          />
                          <span className="text-[11px] font-semibold tracking-wide uppercase text-white/90 truncate min-w-0">
                            {name}
                          </span>
                          <span
                            className={
                              'text-[9px] px-1.5 py-px rounded-full flex-shrink-0 ' +
                              (isLicensed
                                ? 'bg-warning/30 text-warning-bg'
                                : 'bg-success/30 text-success-bg')
                            }
                          >
                            {isLicensed ? 'cedida' : 'propia'}
                          </span>
                          {collapsed && (
                            <span className="text-[10px] text-white/40 ml-auto">
                              {group.rows.length} canal{group.rows.length !== 1 ? 'es' : ''}
                            </span>
                          )}
                        </button>

                        {!collapsed && (
                          <div className="flex flex-col gap-2.5 pl-1">
                            {group.rows.map((e) => {
                              const Icon = channelIcon(e.channelName)
                              const mainValue = isLicensed ? e.revenueSharePct : e.foodCostPct
                              const mainColor = isLicensed
                                ? 'text-white'
                                : statusColor(e.foodCostStatus).replace('text-text-secondary', 'text-white')
                              return (
                                <div key={`${e.menuItemId}-${e.channelId}`} className="flex items-center gap-2.5">
                                  <span className="w-6 h-6 rounded-md bg-white/10 inline-flex items-center justify-center flex-shrink-0">
                                    <Icon className="w-3.5 h-3.5 text-white/80" />
                                  </span>
                                  <span className="flex-1 min-w-0 text-[13px] text-white/85 truncate">
                                    {e.channelName}
                                  </span>
                                  <span className="text-right leading-tight flex-shrink-0">
                                    {mainValue !== null && mainValue !== undefined ? (
                                      <span className={'block font-mono text-[13px] font-medium ' + mainColor}>
                                        {isLicensed ? `${formatPct(mainValue)} cesión` : formatPct(mainValue)}
                                      </span>
                                    ) : (
                                      <span className="block font-mono text-[13px] text-white/40">
                                        {e.costAvailable ? 's/objetivo' : 'sin coste'}
                                      </span>
                                    )}
                                    {e.netMargin !== null && e.netMargin !== undefined && (
                                      <span className="block font-mono text-[10px] text-white/50">
                                        margen {formatEur(e.netMargin)}
                                      </span>
                                    )}
                                    {!isLicensed && e.plateCostPct !== null && e.plateCostPct !== undefined && packagingCost > 0 && (
                                      <span className={'block font-mono text-[10px] ' + statusColor(e.plateCostStatus).replace('text-text-secondary', 'text-white/50')}>
                                        plate {formatPct(e.plateCostPct)}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'receta' ? (
          <RecipeStepsTab recipeItemId={recipe.id} />
        ) : activeTab === 'modificadores' ? (
          <ModifierImpactsTab
            recipeItemId={recipe.id}
            accountId={activeAccountId ?? ''}
            actorName={userProfile?.displayName ?? 'Usuario'}
          />
        ) : (
          <div className="p-4 md:p-5">
            <div className="text-sm text-text-secondary opacity-70 py-8 text-center">
              Solapa «{TABS.find((t) => t.id === activeTab)?.label}» — pendiente.
            </div>
          </div>
        )}

      </div>

      {/* ── Lightbox de la foto del plato (E5 visual) ── */}
      {photoLightbox && photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPhotoLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setPhotoLightbox(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 text-text-primary flex items-center justify-center hover:bg-white transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={photoUrl}
            alt={recipe.name}
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Añadir a carta: crea/enlaza el menu_item de este escandallo ── */}
      {showAddToMenu && activeAccountId && (
        <AddToMenuModal
          accountId={activeAccountId}
          recipeId={recipe.id}
          recipeName={recipe.name}
          createdBy={authUserId ?? null}
          createdByName={userProfile?.displayName ?? null}
          onClose={() => setShowAddToMenu(false)}
          onDone={() => {
            setShowAddToMenu(false)
            setEconReloadTick((t) => t + 1)
          }}
        />
      )}
    </div>
  )
}
