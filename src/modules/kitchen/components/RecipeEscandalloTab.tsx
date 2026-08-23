// src/modules/kitchen/components/RecipeEscandalloTab.tsx
//
// Pestaña "Escandallo" de la ficha unificada de plato (CatalogFichaPage).
// Extraído MECÁNICAMENTE de RecipeEditorPage.tsx — la columna izquierda
// (composición E2a/E2b/E3, "Sugerir mermas con IA", "Importar ficha") y la
// columna derecha ("Coste en vivo": cifra hero, food cost por marca/canal,
// "Platos de venta que usan esta receta"). Ver plan
// C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md, Fase 2.
// Regla de oro: unificar no pierde nada — "mover, no inventar".
//
// Autónomo (mismo patrón que RecipeStepsTab/RecipeHistoryTab/ModifierImpactsTab):
// recibe recipeId y carga su propio `recipe` + `lines`. Tras cualquier mutación
// que afecte al coste/foto del escandallo, llama a onRecipeChanged() para que
// el padre (CatalogFichaPage) refresque su copia de `recipe` — así la cabecera
// ("tres cifras honestas" + foto) se mantiene en sync sin que esta pestaña
// necesite conocer nada de la cabecera.
//
// Añadido respecto al editor viejo (decisión de Julio, no vivía aquí): la
// gestión COMPLETA de la foto de cocina (recipe_item.kitchen_photo_url —
// subir/cambiar/ELIMINAR/lightbox, recipePhotoService.ts) vivía en la
// CABECERA de RecipeEditorPage.tsx; se mueve aquí porque CatalogFichaPage.tsx
// ya tiene su propia copia de SOLO LECTURA de esta misma foto para el hero de
// cabecera (kitchenPhotoUrl / getDishPhotoUrl(recipe?.kitchenPhotoUrl)) — esta
// pestaña gestiona su propia URL firmada y su propio ciclo de vida completo.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChefHat,
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
  Loader2,
  Scale,
  Pencil,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useIsMobile } from '@/shell/useIsMobile'
import { useVoice } from '@/modules/folvy-ai/hooks/useVoice'
import {
  getRecipeItemById,
  listRecipeItems,
  getRawUsageCounts,
  createRecipeItem,
  updateRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import {
  getRecipeBreakdown,
  updateLine,
  deleteLine,
  addLine,
  listLinesByParent,
  listParentsUsingItem,
} from '@/modules/kitchen/services/recipeLineService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import {
  listMenuItems,
  getMenuItemEconomics,
} from '@/modules/kitchen/services/menuItemService'
import {
  listMenuItemsUsingRecipe,
  getMenuItemLinkHealth,
  classifyMenuItemLink,
  type MenuItemUsingRecipe,
  type MenuItemLinkHealthRow,
} from '@/modules/kitchen/services/menuLinkService'
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
import { cascadeAllergensFromItem } from '@/modules/kitchen/services/allergenCascadeService'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { RecipeItem, MenuItemEconomics, KitchenUnit } from '@/types/kitchen'
import type { RecipeLineBreakdown } from '@/modules/kitchen/services/recipeLineService'

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

interface RecipeEscandalloTabProps {
  accountId: string
  recipeId: string
  /** El padre re-consulta getRecipeItemById tras cualquier cambio que afecte
   * al coste/foto/nombre del escandallo (línea editada, merma, import, foto)
   * — así la cabecera (tres cifras, foto) se mantiene en sync. */
  onRecipeChanged: () => void
}

export default function RecipeEscandalloTab({
  accountId,
  recipeId,
  onRecipeChanged,
}: RecipeEscandalloTabProps) {
  const { userProfile, authUserId } = useApp()
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [lines, setLines] = useState<RecipeLineBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Refetch interno completo (recipe + lines) — solo hace falta tras un
  // reemplazo total de líneas (importar ficha). Las mutaciones de línea a
  // línea refrescan `lines` directamente (ver cada handler).
  const [tick, setTick] = useState(0)

  // Nombre PROPIO del escandallo (recipe_item.name — distinto del nombre de
  // venta, que se edita en la pestaña Ficha). EDICIÓN QUE FALTABA (hallazgo en
  // revisión, decisión 5 del plan: editable aquí, mismo patrón inline que
  // tenía la cabecera del editor viejo — clic → input → blur/Enter guarda,
  // Escape cancela).
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)

  // E5 — foto de cocina: input oculto, estado de subida/borrado, URL firmada
  // resuelta (kitchen_photo_url guarda el PATH; la URL firmada se resuelve al
  // renderizar). Gestión COMPLETA (subir/cambiar/eliminar/lightbox), propia de
  // esta pestaña — CatalogFichaPage solo tiene una copia de lectura para el hero.
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoLightbox, setPhotoLightbox] = useState(false)
  // Confirmación de borrado de la foto de cocina (Fase 6, B3: antes window.confirm).
  const [confirmDeletePhotoOpen, setConfirmDeletePhotoOpen] = useState(false)

  // "Producción": escalado NO destructivo (vista de producción). factor=1 → apagado.
  const [prodFactor, setProdFactor] = useState(1)
  const [prodTargetText, setProdTargetText] = useState('')

  // Doble dirección (trazabilidad ítem↔escandallo): qué ítems de carta usan
  // este escandallo hoy, con su sello de casado — clicables al cockpit
  // "Casado". null = cargando; [] = ninguno.
  const [usedByItems, setUsedByItems] = useState<MenuItemUsingRecipe[] | null>(null)
  const [usedByHealth, setUsedByHealth] = useState<Map<string, MenuItemLinkHealthRow>>(new Map())

  // ── Importar ficha (rellenar ESTE escandallo, no crear otro) ──
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'reading' | 'done'>('idle')
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportRecipeResult | null>(null)
  // B2: sesión extraída pendiente de revisar (modal anti-duplicados).
  const [review, setReview] = useState<ExtractedRecipeSession | null>(null)

  // ── Edición inline (E1 + E3) ──
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [draftQty, setDraftQty] = useState('')
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Confirmación de borrado de línea (Fase 6, B4: antes window.confirm).
  const [confirmDeleteLine, setConfirmDeleteLine] = useState<RecipeLineBreakdown | null>(null)
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
  const [usageNotice, setUsageNotice] = useState<string | null>(null)
  // ── Crear ingrediente nuevo al vuelo (E2b) ──
  const [addCreating, setAddCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createUnitId, setCreateUnitId] = useState('')
  const [createCost, setCreateCost] = useState('')
  const [createSaving, setCreateSaving] = useState(false)

  // ── Economía (panel "Coste en vivo") ──
  const [economics, setEconomics] = useState<EconRow[]>([])
  const [brandNames, setBrandNames] = useState<Record<string, string>>({})
  const [econLoading, setEconLoading] = useState(false)
  const [collapsedBrands, setCollapsedBrands] = useState<Record<string, boolean>>({})
  const [econReloadTick, setEconReloadTick] = useState(0)
  // "Añadir a carta": modal que crea/enlaza el menu_item de este escandallo.
  const [showAddToMenu, setShowAddToMenu] = useState(false)
  // ── Preparaciones (type='recipe'): en qué escandallos se usa ──
  // Es la cifra que da sentido a extraer una sub-receta: cambiar un ingrediente
  // aquí lo cambia en los N platos de golpe. Se guarda ANCLADO al id que se
  // consultó: así, al saltar de una preparación a otra, el contador no enseña
  // por un instante los platos de la anterior (y el efecto no necesita
  // resetearlo a mano). null = aún sin cargar / no aplica.
  const [usedIn, setUsedIn] = useState<
    { itemId: string; parents: { id: string; name: string; type: string }[] } | null
  >(null)
  const [usedInOpen, setUsedInOpen] = useState(false)

  // ── Carga del escandallo (recipe + lines) ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getRecipeItemById(recipeId), getRecipeBreakdown(recipeId)])
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
  }, [recipeId, tick])

  // Solo para PREPARACIONES: los escandallos que la usan como línea. No bloquea
  // la pestaña (si falla, el contador simplemente no aparece).
  useEffect(() => {
    if (!recipe || recipe.type !== 'recipe') return
    const itemId = recipe.id
    let cancelled = false
    listParentsUsingItem(itemId)
      .then((rows) => {
        if (!cancelled) setUsedIn({ itemId, parents: rows })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('listParentsUsingItem falló:', err)
      })
    return () => {
      cancelled = true
    }
  }, [recipe, tick])

  // Los padres cargados solo valen si son los de ESTA preparación.
  const usedInParents =
    recipe && recipe.type === 'recipe' && usedIn && usedIn.itemId === recipe.id
      ? usedIn.parents
      : null

  // Doble dirección: "usado por N ítems" — hoy invisible, y esa invisibilidad
  // es parte de la causa raíz del enlace equivocado que nadie ve.
  useEffect(() => {
    if (!accountId) { setUsedByItems(null); setUsedByHealth(new Map()); return }
    let cancelled = false
    setUsedByItems(null)
    listMenuItemsUsingRecipe(recipeId)
      .then((rows) => {
        if (cancelled) return
        setUsedByItems(rows)
        if (rows.length === 0) { setUsedByHealth(new Map()); return }
        getMenuItemLinkHealth(accountId)
          .then((health) => {
            if (cancelled) return
            const m = new Map<string, MenuItemLinkHealthRow>()
            for (const h of health) m.set(h.menuItemId, h)
            setUsedByHealth(m)
          })
          .catch((e: unknown) => {
            if (!cancelled) console.warn('RecipeEscandalloTab: fallo cargando el estado de casado de los ítems', e)
          })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('RecipeEscandalloTab: fallo cargando ítems que usan este escandallo', err)
        setUsedByItems([])
      })
    return () => { cancelled = true }
  }, [recipeId, tick, accountId])

  // Economía: marcas del plato + FC/margen por canal. Se re-dispara con
  // econReloadTick tras editar/añadir/borrar una línea (latido del FC).
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setEconLoading(true)
    listMenuItems({ accountId })
      .then(async (allItems) => {
        if (cancelled) return
        const mine = allItems.filter((mi) => mi.recipeItemId === recipeId)
        const brands = Array.from(new Set(mine.map((mi) => mi.brandId)))
        if (brands.length === 0) {
          setEconomics([])
          setBrandNames({})
          return
        }
        listBrands({ accountId })
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
  }, [accountId, recipeId, econReloadTick])

  // E5 — resolver la URL firmada de la foto de cocina a partir del path guardado.
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
  const baseYield = recipe?.yieldPortions && recipe.yieldPortions > 0 ? recipe.yieldPortions : null

  function applyProdTarget(text: string) {
    setProdTargetText(text)
    const n = parseFloat(text.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) { setProdFactor(1); return }
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

  // Líneas NO CONVERTIBLES (unidad sin conversión a la base): aportan 0 al total
  // → el coste mostrado infra-cuenta.
  const unconvertibleLineCount = useMemo(
    () => lines.filter((l) => l.needsReview).length,
    [lines]
  )

  // ── Nombre propio del escandallo ──
  function startEditName() {
    if (!recipe) return
    setNameDraft(recipe.name)
    setEditingName(true)
  }
  async function saveName() {
    if (!recipe || savingName) return
    const next = nameDraft.trim()
    if (!next || next === recipe.name) { setEditingName(false); return }
    setSavingName(true)
    try {
      await updateRecipeItem(recipe.id, { name: next })
      setEditingName(false)
      onRecipeChanged()
      setTick((t) => t + 1)
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'No se pudo cambiar el nombre.')
    } finally {
      setSavingName(false)
    }
  }

  // ── E5: foto de cocina ──
  function openPhotoPicker() {
    setPhotoError(null)
    photoInputRef.current?.click()
  }

  // Sube la foto elegida: comprime → sube a recipe-uploads → guarda el PATH en
  // kitchen_photo_url → re-resuelve la URL firmada. Borra la foto anterior si la
  // había (no deja huérfanos en el bucket).
  async function handlePhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !recipe || !accountId) return

    setPhotoError(null)
    setPhotoUploading(true)
    const previousPath = recipe.kitchenPhotoUrl ?? null
    try {
      const path = await uploadDishPhoto(accountId, recipe.id, file)
      const updated = await updateRecipeItem(recipe.id, { kitchenPhotoUrl: path })
      setRecipe(updated)
      if (previousPath && previousPath !== path) {
        deleteDishPhoto(previousPath).catch(() => {
          /* no fatal */
        })
      }
      onRecipeChanged()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo subir la foto.'
      setPhotoError(msg)
      window.setTimeout(() => setPhotoError(null), 5000)
    } finally {
      setPhotoUploading(false)
    }
  }

  // Elimina la foto de cocina (sin subir una nueva): limpia kitchen_photo_url
  // y borra el objeto del bucket. Gestión "completa" pedida por Julio — el
  // editor viejo solo permitía sustituirla, nunca quitarla sin reemplazo.
  async function handleDeletePhoto() {
    if (!recipe || !recipe.kitchenPhotoUrl || photoDeleting) return
    setPhotoDeleting(true)
    setPhotoError(null)
    const previousPath = recipe.kitchenPhotoUrl
    try {
      const updated = await updateRecipeItem(recipe.id, { kitchenPhotoUrl: null })
      setRecipe(updated)
      await deleteDishPhoto(previousPath).catch(() => {
        /* no fatal */
      })
      onRecipeChanged()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo eliminar la foto.'
      setPhotoError(msg)
      window.setTimeout(() => setPhotoError(null), 5000)
    } finally {
      setPhotoDeleting(false)
    }
  }

  // Importa una ficha (foto/PDF/Excel/Word/dictado por voz) y RELLENA este
  // escandallo (no crea otro): pasa targetRecipeId = recipeId. La RPC borra las
  // líneas viejas y las reemplaza. Al terminar refrescamos plato+líneas (tick)
  // y FC (econReloadTick). Extraído como helper compartido (Fase 6): tanto el
  // input de archivo como el dictado por voz (A2) alimentan el mismo camino.
  async function importFromFile(file: File) {
    if (!accountId) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    setReview(null)
    setImportStage('uploading')
    try {
      // Cambio de etapa para feedback (la subida es rápida; la IA tarda).
      window.setTimeout(() => setImportStage((s) => (s === 'uploading' ? 'reading' : s)), 800)
      // B2: extrae y abre la revisión (rellena ESTE plato vía targetRecipeId).
      const session = await extractRecipeSession(accountId, file, { targetRecipeId: recipeId })
      setReview(session)
      setImportStage('idle')
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'No se pudo importar la ficha.')
      setImportStage('idle')
    } finally {
      setImporting(false)
    }
  }

  async function handleImportRecipe(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await importFromFile(file)
  }

  // A2 — Dictar por voz: al terminar de hablar, se envuelve el transcrito en un
  // File de texto plano y se reutiliza EXACTAMENTE el mismo flujo de importación
  // (extractRecipeSession detecta kind:'text' → input_text → mismo
  // RecipeImportReviewModal anti-duplicados de "Importar ficha", sin modal nuevo).
  function handleVoiceTranscript(text: string) {
    if (!text.trim() || !accountId) return
    const file = new File([text], 'dictado.txt', { type: 'text/plain' })
    importFromFile(file)
  }

  const voice = useVoice({ onTranscript: handleVoiceTranscript })

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
    if (editingLineId !== line.lineId) {
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
        onRecipeChanged()
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
  function openWaste(line: RecipeLineBreakdown) {
    setEditError(null)
    setWasteOpenLineId(line.lineId)
    setDraftWaste(String(effectiveWastePct(line)).replace('.', ','))
  }

  function commitWaste(line: RecipeLineBreakdown) {
    if (wasteOpenLineId !== line.lineId) {
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
        onRecipeChanged()
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
  function suggestWasteAI(line: RecipeLineBreakdown) {
    if (!accountId || aiWasteLineId) return
    setAiWasteError(null)
    setAiWasteLineId(line.lineId)
    let acc = ''
    streamMessage(
      {
        accountId,
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
  // ingrediente en su base, salvo el default que se guarda para las próximas).
  function applyAiWaste(line: RecipeLineBreakdown, pct: number) {
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
    // la IA y se hereda en todos los platos → el gasto IA tiende a cero.
    updateRecipeItem(line.childItemId, { defaultWastePct: pct }).catch((err: unknown) => {
      console.error('No se pudo guardar la merma por defecto del ingrediente', err)
    })
    updateLine(line.lineId, { quantityNet: net, quantityGross: gross })
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(line.lineId)
        setEconReloadTick((t) => t + 1)
        onRecipeChanged()
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
  const linesWithoutWaste = useMemo(
    () => lines.filter((l) => effectiveWastePct(l) === 0),
    [lines]
  )

  // E3 — botón GLOBAL "Sugerir mermas con IA" (coste controlado por diseño).
  function suggestWasteBatchAI() {
    if (!accountId || aiBatchRunning) return
    const targets = linesWithoutWaste
    if (targets.length === 0) return
    setAiWasteError(null)
    setAiBatchRunning(true)

    const names = targets.map((l) => l.childName)
    let acc = ''
    streamMessage(
      {
        accountId,
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

  // Confirmación vía ConfirmDialog (Fase 6, antes window.confirm) — el botón
  // de la línea abre el diálogo (setConfirmDeleteLine), esta función ejecuta
  // el borrado real tras confirmar.
  function doDeleteLine(line: RecipeLineBreakdown) {
    const prevLines = lines
    setSavingLineId(line.lineId)
    setLines((prev) => prev.filter((l) => l.lineId !== line.lineId))

    deleteLine(line.lineId)
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(null)
        setEconReloadTick((t) => t + 1)
        onRecipeChanged()
        // Alérgenos (Capa 2): quitar una línea puede quitar el único
        // ingrediente que aportaba un alérgeno — hay que recalcular.
        cascadeAllergensFromItem(recipeId).catch((e) =>
          console.error('RecipeEscandalloTab: cascada de alérgenos tras borrado falló', e)
        )
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
  // Concordancia de género en los textos de alta: 'sub-receta' es femenino y el
  // resto masculinos ("nueva sub-receta" / "nuevo ingrediente", "de la" / "del").
  // Solo texto: no cambia ninguna lógica.
  const addKindIsFem = addKind === 'recipe'
  const addKindNewWord = addKindIsFem ? 'nueva' : 'nuevo'
  const addKindNewWordCap = addKindIsFem ? 'Nueva' : 'Nuevo'
  const addKindOf = addKindIsFem ? 'de la' : 'del'

  function openAdd(kind: 'raw' | 'recipe' | 'packaging' = 'raw') {
    setAddKind(kind)
    setAddOpen(true)
    setAddSearch('')
    setAddPicked(null)
    setAddQty('')
    setAddError(null)
    setAddCreating(false)
    if (addDataLoaded || addDataLoading || !accountId) return
    setAddDataLoading(true)
    setUsageNotice(null)

    // Esencial para el alta: ingredientes + unidades.
    Promise.all([
      listRecipeItems({ accountId, includeInactive: false }),
      listUnits({}),
    ])
      .then(([items, unitList]) => {
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

    // Orden por uso real: NO bloquea el alta. Si falla, avisa y el buscador
    // queda ordenado alfabéticamente.
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
  // Unidad por defecto según lo que se está creando: una PREPARACIÓN se cuenta
  // por unidades ('ud' — su escandallo describe 1 ud y el plato la usa 1 ud);
  // un ingrediente/envase sigue naciendo en gramos como hasta ahora.
  function openCreate() {
    const wanted = addKind === 'recipe' ? 'ud' : 'g'
    const unit = units.find((u) => u.abbreviation.trim().toLowerCase() === wanted)
    setCreateUnitId(unit ? unit.id : (units[0]?.id ?? ''))
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

  // Crea el artículo nuevo (source='manual', needs_review=true) y lo deja
  // seleccionado para que el usuario indique la cantidad (reutiliza el paso de
  // cantidad de E2a).
  //
  // PREPARACIÓN (type='recipe'): no se pide unidad ni coste. Su coste NO se
  // teclea — lo calcula kitchen_recompute_item sumando sus propias líneas, igual
  // que hace con un plato. Nace no-stockable (default de la columna), así que al
  // vender el plato que la contiene, explode_recipe_to_raws la atraviesa y
  // descuenta los CRUDOS de dentro, no la preparación.
  function confirmCreate() {
    if (!accountId) return
    const isPrep = addKind === 'recipe'
    const name = createName.trim()
    if (name === '') {
      setAddError(`El nombre ${addKindOf} ${addKindLabel} es obligatorio.`)
      return
    }
    if (!createUnitId) {
      setAddError('Elige una unidad base.')
      return
    }
    let cost: number | null = null
    if (!isPrep) {
      const rawCost = createCost.trim().replace(',', '.')
      if (rawCost !== '') {
        const n = Number(rawCost)
        if (!Number.isFinite(n) || n < 0) {
          setAddError('El coste debe ser un número ≥ 0 (déjalo vacío si no lo sabes).')
          return
        }
        cost = n
      }
    }

    setCreateSaving(true)
    setAddError(null)
    createRecipeItem({
      accountId,
      type: isPrep ? 'recipe' : addKind === 'packaging' ? 'packaging' : 'raw',
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
        setAddableItems((prev) => [...prev, created])
        setAddCreating(false)
        setAddPicked(created)
        setAddQty('')
        setAddSearch('')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : `No se pudo crear ${addKindIsFem ? 'la' : 'el'} ${addKindLabel}`
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
    if (!addPicked || !accountId) return
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
          accountId,
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
        // Mismo criterio que editar/borrar línea: cambia el coste del
        // escandallo → la cabecera del padre debe refrescarse.
        onRecipeChanged()
        // Listo para añadir otro: volvemos al buscador.
        setAddPicked(null)
        setAddQty('')
        // Alérgenos (Capa 2): cambió la composición → este escandallo y todo
        // lo que lo use puede haber cambiado de estado. Best-effort, no
        // bloquea el alta ni el "finally" de abajo.
        cascadeAllergensFromItem(recipeId).catch((e) =>
          console.error('RecipeEscandalloTab: cascada de alérgenos tras alta falló', e)
        )
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

  if (loading) {
    return (
      <div className="p-4 md:p-5">
        <div className="flex items-center justify-center h-64 text-text-secondary">
          Cargando escandallo…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 md:p-5">
        <div className="rounded-lg border border-danger/20 bg-danger-bg px-4 py-3 text-danger text-sm">
          {error}
        </div>
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="p-4 md:p-5">
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary gap-2">
          <ChefHat className="w-8 h-8 opacity-40" />
          <p>No se encontró el escandallo.</p>
        </div>
      </div>
    )
  }

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
            {/* La línea es una SUB-RECETA (preparación): ↗ para abrir su propio
                escandallo. Lo que se descuenta al vender no es esta línea, sino
                los crudos de dentro (explode_recipe_to_raws la atraviesa). */}
            {line.childType === 'recipe' && (
              <button
                type="button"
                onClick={() => navigate('/kitchen/recetas?recipe=' + line.childItemId)}
                title="Es una preparación: abrir su escandallo"
                className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full bg-success-bg text-success inline-flex items-center gap-0.5 align-middle hover:opacity-80 transition-opacity cursor-pointer"
              >
                preparación ↗
              </button>
            )}
            {line.childNeedsReview && (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1 align-middle">
                <AlertTriangle className="w-3 h-3" />
                sin terminar
              </span>
            )}
            {line.needsReview && (
              <button
                type="button"
                onClick={() => navigate('/kitchen?item=' + line.childItemId + '&return=' + recipeId)}
                title="Definir la conversión de este ingrediente para poder medir coste y stock"
                className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-danger-bg text-danger inline-flex items-center gap-1 align-middle hover:bg-danger hover:text-white transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3" />
                falta convertir la unidad
              </button>
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
              onClick={() => setConfirmDeleteLine(line)}
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
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] -m-5">
      {/* Columna izquierda: nombre + foto de cocina + composición */}
      <div className="p-4 md:p-5 lg:border-r border-border-default">
        {/* Nombre propio del escandallo (recipe_item.name) — clic para editar,
            mismo patrón que tenía la cabecera del editor viejo. Distinto del
            nombre de venta (pestaña Ficha). */}
        <div className="mb-3">
          <div className="text-xs font-medium tracking-wide text-text-secondary uppercase mb-1">
            Nombre del escandallo
          </div>
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
              className="text-lg font-display font-medium text-text-primary bg-card border border-terracota/40 rounded-md px-2 py-1 focus:outline-none focus:border-terracota"
            />
          ) : (
            <h2
              className="text-lg font-display font-medium text-text-primary inline-flex items-center gap-2 group cursor-text"
              onClick={startEditName}
              title="Haz clic para cambiar el nombre del escandallo"
            >
              {recipe.name}
              <Pencil className="w-3.5 h-3.5 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </h2>
          )}
          {/* Línea tipo/código — recuperada en el checklist de la Fase 7 (gap
              fila 138): vivía en la cabecera del editor viejo, se perdió al no
              pertenecer a ninguna sección con id propio. */}
          <div className="text-[13px] text-text-secondary mt-1 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <ChefHat className="w-[15px] h-[15px]" />
              {recipe.type === 'dish'
                ? 'Plato'
                : recipe.type === 'recipe'
                  ? 'Preparación'
                  : recipe.type}
            </span>
            {recipe.code && (
              <>
                <span className="opacity-50">·</span>
                <span className="font-mono opacity-85">{recipe.code}</span>
              </>
            )}
            {/* Preparación: "usado en N platos" — la cifra que justifica tenerla
                extraída (un cambio aquí baja a los N a la vez). Clic → la lista. */}
            {recipe.type === 'recipe' && usedInParents !== null && (
              <>
                <span className="opacity-50">·</span>
                <button
                  type="button"
                  onClick={() => setUsedInOpen((v) => !v)}
                  disabled={usedInParents.length === 0}
                  title={
                    usedInParents.length === 0
                      ? 'Todavía no la usa ningún plato'
                      : 'Ver los escandallos que la usan'
                  }
                  className="inline-flex items-center gap-1 text-[13px] text-success hover:opacity-80 transition-opacity disabled:text-text-secondary disabled:hover:opacity-100 disabled:cursor-default"
                >
                  Usado en {usedInParents.length} plato{usedInParents.length === 1 ? '' : 's'}
                  {usedInParents.length > 0 && (
                    <ChevronDown
                      className={
                        'w-3.5 h-3.5 transition-transform ' + (usedInOpen ? 'rotate-180' : '')
                      }
                    />
                  )}
                </button>
              </>
            )}
          </div>
          {/* Lista desplegable de los escandallos que usan esta preparación. */}
          {recipe.type === 'recipe' && usedInOpen && usedInParents && usedInParents.length > 0 && (
            <div className="mt-1.5 rounded-md border border-border-default bg-card overflow-hidden">
              {usedInParents.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate('/kitchen/recetas?recipe=' + p.id)}
                  className="w-full text-left px-2.5 py-1.5 text-sm text-text-primary hover:bg-accent-bg transition-colors border-b border-border-default last:border-0 flex items-center justify-between gap-2"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[11px] text-text-secondary shrink-0">
                    {p.type === 'recipe' ? 'preparación' : 'plato'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Foto de cocina (gestión completa: subir/cambiar/eliminar/lightbox).
            Distinta de la foto pública del producto (esa vive en la pestaña
            Ficha) — CatalogFichaPage solo lee kitchenPhotoUrl para el hero. */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border-default">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelected}
          />
          <button
            type="button"
            onClick={() => (photoUrl ? setPhotoLightbox(true) : openPhotoPicker())}
            disabled={photoUploading}
            className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-default bg-card flex items-center justify-center shrink-0 disabled:opacity-60"
            aria-label={photoUrl ? 'Ver foto de cocina' : 'Añadir foto de cocina'}
          >
            {photoUploading ? (
              <Loader2 className="w-6 h-6 text-terracota animate-spin" />
            ) : photoUrl ? (
              <img src={photoUrl} alt={recipe.name} className="w-full h-full object-cover" />
            ) : (
              <Camera className="w-7 h-7 text-terracota opacity-70" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium tracking-wide text-text-secondary uppercase mb-1.5">
              Foto de cocina
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={openPhotoPicker}
                disabled={photoUploading}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card text-terracota font-medium border border-terracota/30 hover:bg-terracota-bg disabled:opacity-60 transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                {photoUploading ? 'Subiendo…' : photoUrl ? 'Cambiar foto' : 'Añadir foto'}
              </button>
              {photoUrl && (
                <button
                  type="button"
                  onClick={() => setConfirmDeletePhotoOpen(true)}
                  disabled={photoUploading || photoDeleting}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-card text-danger font-medium border border-danger/30 hover:bg-danger-bg disabled:opacity-60 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {photoDeleting ? 'Eliminando…' : 'Eliminar'}
                </button>
              )}
              {photoError && (
                <span className="px-2.5 py-1 rounded-md bg-danger text-white text-xs">
                  {photoError}
                </span>
              )}
            </div>
          </div>
        </div>

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
            {voice.sttSupported ? (
              <button
                type="button"
                onClick={() => (voice.isListening ? voice.stopListening() : voice.startListening())}
                title={voice.isListening ? 'Escuchando… toca para parar' : 'Dictar el escandallo por voz'}
                className={
                  'w-7 h-7 rounded-md inline-flex items-center justify-center transition-colors ' +
                  (voice.isListening
                    ? 'bg-danger text-white animate-pulse'
                    : 'bg-accent-bg text-text-secondary hover:text-text-primary')
                }
              >
                <Mic className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled
                title="Dictar por voz — no disponible en este navegador"
                className="w-7 h-7 rounded-md bg-accent-bg text-text-secondary/40 inline-flex items-center justify-center cursor-not-allowed"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
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
        {review && accountId && (
          <RecipeImportReviewModal
            accountId={accountId}
            sessionId={review.sessionId}
            dishName={review.dishName}
            lines={review.lines}
            onCancel={() => setReview(null)}
            onCompleted={(result) => {
              setReview(null)
              setImportResult(result)
              setImportStage('done')
              // Las líneas viejas se reemplazaron por completo: refetch total.
              setTick((t) => t + 1)
              setEconReloadTick((t) => t + 1)
              onRecipeChanged()
              // Alérgenos (Capa 2): reemplazo completo de líneas, la
              // composición cambió de raíz.
              cascadeAllergensFromItem(recipeId).catch((e) =>
                console.error('RecipeEscandalloTab: cascada de alérgenos tras importar ficha falló', e)
              )
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
              title: 'Envases',
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
              // Crear ingrediente / packaging / PREPARACIÓN al vuelo (E2b)
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-[30px] h-[30px] rounded-md bg-card border border-terracota/30 inline-flex items-center justify-center flex-shrink-0">
                    <Plus className="w-3.5 h-3.5 text-terracota" />
                  </span>
                  <span className="text-sm font-medium text-text-primary">
                    {addKindNewWordCap} {addKindLabel}
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
                    placeholder={`Nombre ${addKindOf} ${addKindLabel}`}
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {/* Una PREPARACIÓN no pide unidad ni coste: se cuenta por
                      unidades y su coste sale de sus propias líneas. Solo nombre. */}
                  {addKind !== 'recipe' && (
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
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-text-secondary leading-snug">
                      {addKind === 'recipe'
                        ? `Se crea vacía y en ${unitsById.get(createUnitId)?.abbreviation ?? 'ud'}: ábrela después para ponerle sus ingredientes (su escandallo describe 1 ${unitsById.get(createUnitId)?.abbreviation ?? 'ud'}). Hasta entonces suma 0 €.`
                        : 'Se marcará para revisar; completa coste y formato cuando puedas.'}
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
                      {addSearch.trim() !== '' && (
                        <button
                          type="button"
                          onClick={openCreate}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-terracota text-white hover:bg-terracota-hover transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Crear «{addSearch.trim()}» como {addKindLabel} {addKindNewWord}
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
                                  <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full bg-success-bg text-success align-middle">
                                    preparación ↗
                                  </span>
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
                      {addSearch.trim() !== '' && (
                        <button
                          type="button"
                          onClick={openCreate}
                          className="mt-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md hover:bg-card text-left transition-colors text-xs font-medium text-terracota"
                        >
                          <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                          ¿No está? Crear «{addSearch.trim()}» como {addKindNewWord}
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

      {/* Columna derecha: raíl de economía ("Coste en vivo") */}
      <div className="p-4 bg-page border-l border-default">
        <div className="text-[11px] font-medium tracking-wider text-text-secondary uppercase mb-2.5">
          Coste en vivo
        </div>

        <div className="text-xs text-text-secondary">{packagingCost > 0 ? 'Coste del plato' : 'Coste total'}</div>
        <div
          className={
            'font-mono font-medium text-text-primary leading-tight text-[34px] origin-left transition-all duration-slow ' +
            (flashHero ? 'scale-110' : 'scale-100')
          }
        >
          {formatEur(totalCost * prodFactor)}
        </div>
        <div className="text-xs text-text-secondary mt-0.5">
          por porción · {Math.round((recipe.yieldPortions ?? 1) * prodFactor)} ración
          {Math.round((recipe.yieldPortions ?? 1) * prodFactor) !== 1 ? 'es' : ''}
        </div>
        {unconvertibleLineCount > 0 && (
          <div
            title="Una o más líneas usan una unidad sin conversión a la base del ingrediente: no entran en el coste ni descuentan stock. El total mostrado infra-cuenta hasta que las resuelvas."
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-warning-bg text-warning"
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
              <span className="text-text-secondary">Comida</span>
              <span className="font-mono text-text-primary">{formatEur(foodCost * prodFactor)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-text-secondary">Envases</span>
              <span className="font-mono text-text-primary">{formatEur(packagingCost * prodFactor)}</span>
            </div>
          </div>
        )}

        {/* Recuperado en el checklist de la Fase 7 (gap fila 51). */}
        <p className="text-[11px] text-text-secondary mt-2">Merma estimada incluida en el coste del escandallo.</p>

        <div className="border-t border-default my-3.5" />

        {/* Bug cazado en vivo por Julio (04/08): este bloque decidía "¿está en
            carta?" preguntando a SU PROPIA fuente vieja (economics, derivada
            de listMenuItems+getMenuItemEconomics por marca) en vez de la
            verdad ya cargada en esta misma pestaña (usedByItems, la misma
            consulta que usa la cabecera del padre para el ancla). Podían
            contradecirse: cabecera con PVP/food cost reales + "Platos que
            usan esta receta" listando 2 productos, y este bloque diciendo
            "aún no está en ninguna carta". La existencia de producto la
            decide SIEMPRE usedByItems; economics (datos por canal) puede
            estar vacío por otras razones (aún sin canales configurados) sin
            que eso signifique "no está en carta" — en ese caso, aviso
            distinto, sin el CTA de "Añadir a carta" (ya está añadido). */}
        {econLoading || usedByItems === null ? (
          <div className="text-[11px] text-text-secondary">Calculando food cost…</div>
        ) : usedByItems.length === 0 ? (
          <div>
            <div className="text-[11px] font-medium tracking-wide text-text-secondary uppercase mb-2">
              Food cost
            </div>
            <div className="flex items-start gap-1.5 text-[11px] text-text-secondary leading-relaxed mb-2.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0 text-warning" />
              <span>Este plato aún no está en ninguna carta. Añádelo para ver su food cost y margen.</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAddToMenu(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-md bg-accent text-text-on-accent hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Añadir a carta
            </button>
          </div>
        ) : economics.length === 0 ? (
          <div>
            <div className="text-[11px] font-medium tracking-wide text-text-secondary uppercase mb-2">
              Food cost
            </div>
            <p className="text-[11px] text-text-secondary">Sin datos de food cost por canal todavía.</p>
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
                        'w-3.5 h-3.5 text-text-secondary transition-transform ' +
                        (collapsed ? '-rotate-90' : '')
                      }
                    />
                    <span className="text-[11px] font-semibold tracking-wide uppercase text-text-primary truncate min-w-0">
                      {name}
                    </span>
                    <span
                      className={
                        'text-[9px] px-1.5 py-px rounded-full flex-shrink-0 ' +
                        (isLicensed
                          ? 'bg-warning-bg text-warning'
                          : 'bg-success-bg text-success')
                      }
                    >
                      {isLicensed ? 'cedida' : 'propia'}
                    </span>
                    {collapsed && (
                      <span className="text-[10px] text-text-secondary ml-auto">
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
                          ? 'text-text-primary'
                          : statusColor(e.foodCostStatus)
                        return (
                          <div key={`${e.menuItemId}-${e.channelId}`} className="flex items-center gap-2.5">
                            <span className="w-6 h-6 rounded-md bg-accent-bg inline-flex items-center justify-center flex-shrink-0">
                              <Icon className="w-3.5 h-3.5 text-text-secondary" />
                            </span>
                            <span className="flex-1 min-w-0 text-[13px] text-text-primary truncate">
                              {e.channelName}
                            </span>
                            <span className="text-right leading-tight flex-shrink-0">
                              {mainValue !== null && mainValue !== undefined ? (
                                <span className={'block font-mono text-[13px] font-medium ' + mainColor}>
                                  {isLicensed ? `${formatPct(mainValue)} cesión` : formatPct(mainValue)}
                                </span>
                              ) : (
                                <span className="block font-mono text-[13px] text-text-secondary">
                                  {e.costAvailable ? 's/objetivo' : 'sin coste'}
                                </span>
                              )}
                              {e.netMargin !== null && e.netMargin !== undefined && (
                                <span className="block font-mono text-[10px] text-text-secondary">
                                  margen {formatEur(e.netMargin)}
                                </span>
                              )}
                              {!isLicensed && e.plateCostPct !== null && e.plateCostPct !== undefined && packagingCost > 0 && (
                                <span className={'block font-mono text-[10px] ' + statusColor(e.plateCostStatus)}>
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

        {/* Doble dirección (trazabilidad ítem↔escandallo): hoy invisible era
            parte de la causa raíz del enlace equivocado que nadie veía. */}
        {usedByItems !== null && (
          <>
            <div className="border-t border-default my-3.5" />
            <div className="text-[11px] font-medium tracking-wider text-text-secondary uppercase mb-2.5">
              Platos de venta que usan esta receta
            </div>
            {usedByItems.length === 0 ? (
              <p className="text-[11px] text-text-secondary">Ningún plato de la carta usa este escandallo todavía.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {usedByItems.map((it) => {
                  const h = usedByHealth.get(it.id)
                  const meta = h ? classifyMenuItemLink(h) : null
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => navigate('/kitchen/casado?item=' + it.id)}
                      className="w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-md hover:bg-accent-bg transition-colors"
                    >
                      <span className="text-[12px] text-text-primary truncate">{it.name}</span>
                      {meta && (
                        <span className={
                          'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ' +
                          (meta.tone === 'green' ? 'bg-success-bg text-success'
                            : meta.tone === 'amber' ? 'bg-warning-bg text-warning'
                            : meta.tone === 'orange' ? 'bg-orange-100 text-orange-800'
                            : 'bg-danger-bg text-danger')
                        }>
                          {meta.label}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Lightbox de la foto de cocina (gestión completa) ── */}
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
      {showAddToMenu && accountId && (
        <AddToMenuModal
          accountId={accountId}
          recipeId={recipe.id}
          recipeName={recipe.name}
          createdBy={authUserId ?? null}
          createdByName={userProfile?.displayName ?? null}
          onClose={() => setShowAddToMenu(false)}
          onDone={() => {
            setShowAddToMenu(false)
            setEconReloadTick((t) => t + 1)
            // No cambia coste/foto/nombre del escandallo en sí, pero puede
            // afectar a qué producto ancla la cabecera (nuevo menu_item
            // enlazado) — se avisa igualmente al padre por consistencia.
            onRecipeChanged()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeletePhotoOpen}
        title="Eliminar foto de cocina"
        message="¿Eliminar la foto de cocina de este escandallo?"
        tone="danger"
        confirmLabel="Eliminar"
        busy={photoDeleting}
        onConfirm={() => { setConfirmDeletePhotoOpen(false); handleDeletePhoto() }}
        onCancel={() => setConfirmDeletePhotoOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteLine !== null}
        title="Eliminar línea"
        message={confirmDeleteLine ? `¿Eliminar "${confirmDeleteLine.childName}" del escandallo? El coste se recalculará.` : ''}
        tone="danger"
        confirmLabel="Eliminar"
        busy={confirmDeleteLine != null && savingLineId === confirmDeleteLine.lineId}
        onConfirm={() => {
          if (!confirmDeleteLine) return
          const line = confirmDeleteLine
          setConfirmDeleteLine(null)
          doDeleteLine(line)
        }}
        onCancel={() => setConfirmDeleteLine(null)}
      />
    </div>
  )
}
