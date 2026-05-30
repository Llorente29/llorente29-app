// src/modules/kitchen/pages/RecipeEditorPage.tsx
//
// Lienzo de edición de escandallo (rediseño V1). Reemplaza a KitchenRecipePage.
// Diseño según folvy_v1_editor_escandallos_diseno.md §5 + §13 (plan de tramos).
//
// El id del plato llega por prop `recipeId` desde el contenedor
// KitchenRecipesPage (patrón LISTA + DETALLE por estado; las páginas kitchen
// NO usan react-router con params). `onBack` vuelve a la lista.
//
// TRAMO E1 (este): edición inline de la cantidad (BRUTO EFECTIVO) con LATIDO del
// coste + borrar línea con confirmación. La edición escribe en quantity_gross
// (lo que cuesta y lo que se ve, ver §13.3). Al confirmar: update optimista →
// updateLine → el servicio recalcula el coste del plato → recargamos el
// breakdown → laten el coste héroe y el panel de FC por canal (econReloadTick).
// Merma neto/bruto detallada = E3. Añadir ingrediente = E2 (➕ deshabilitado).
//
// Patrón: useActiveAccount() (cuenta), igual que KitchenItemsPage.
import { useEffect, useMemo, useState } from 'react'
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
  Store,
  Bike,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { getRecipeItemById } from '@/modules/kitchen/services/recipeItemService'
import {
  getRecipeBreakdown,
  updateLine,
  deleteLine,
} from '@/modules/kitchen/services/recipeLineService'
import {
  listMenuItems,
  getMenuItemEconomics,
} from '@/modules/kitchen/services/menuItemService'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import type { RecipeItem, MenuItemEconomics } from '@/types/kitchen'
import type { RecipeLineBreakdown } from '@/modules/kitchen/services/recipeLineService'

type EditorTab = 'escandallo' | 'receta' | 'etiquetado' | 'historico' | 'mas'

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'escandallo', label: 'Escandallo' },
  { id: 'receta', label: 'Receta' },
  { id: 'etiquetado', label: 'Etiquetado' },
  { id: 'historico', label: 'Histórico' },
  { id: 'mas', label: 'Más' },
]

function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

// Icono según el nombre del canal (heurística por palabras clave). Local/tienda
// usa tienda; los de delivery, una bici.
function channelIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('local') || n.includes('shop') || n.includes('tienda') || n.includes('sala')) return Store
  if (n.includes('glovo') || n.includes('uber') || n.includes('just') || n.includes('deliver')) return Bike
  return ShoppingBag
}

// Color del semáforo según food_cost_status (valores reales de menu_item_economics):
// 'under' = FC por debajo del objetivo (bien) → success
// 'over'  = FC por encima del objetivo (mal)  → danger
// 'n_a' (licensed) / 'no_cost' / 'no_target'  → neutro
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

// Fila de economía etiquetada con la marca a la que pertenece (la función
// menu_item_economics no devuelve brandId, lo añadimos al cargarla por marca).
type EconRow = MenuItemEconomics & { _brandId: string }

interface RecipeEditorPageProps {
  /** Id del plato a editar. Lo inyecta el contenedor KitchenRecipesPage. */
  recipeId?: string
  /** Vuelve a la lista de platos. Si no se pasa, no se muestra el botón Volver. */
  onBack?: () => void
}

export default function RecipeEditorPage({
  recipeId: recipeIdProp,
  onBack,
}: RecipeEditorPageProps = {}) {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const recipeId = recipeIdProp

  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [lines, setLines] = useState<RecipeLineBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<EditorTab>('escandallo')

  // ── Edición inline (E1) ──
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [draftQty, setDraftQty] = useState('')
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Latido: resaltado breve del coste tras un cambio confirmado.
  const [flashLineId, setFlashLineId] = useState<string | null>(null)
  const [flashHero, setFlashHero] = useState(false)

  // Economía: filas (canal × marca) de este plato, cada una etiquetada con _brandId.
  const [economics, setEconomics] = useState<EconRow[]>([])
  const [brandNames, setBrandNames] = useState<Record<string, string>>({})
  const [econLoading, setEconLoading] = useState(false)
  // Marcas cuyo bloque está plegado (las cedidas arrancan plegadas).
  const [collapsedBrands, setCollapsedBrands] = useState<Record<string, boolean>>({})
  // Tick para re-disparar la carga de economía tras editar una línea (el latido
  // del FC por canal). No recarga el plato entero, solo la economía.
  const [econReloadTick, setEconReloadTick] = useState(0)

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
  }, [accountsLoading, activeAccountId, recipeId])

  // Carga de economía: busca los menu_item de este plato (sus marcas) y carga
  // la economía avanzada (FC, comisión, margen) de TODAS sus marcas. El panel
  // las agrupa en bloques colapsables (propias abiertas, cedidas plegadas).
  // menu_item_economics corre server-side (con sesión de usuario en la app).
  // Se re-dispara con econReloadTick tras editar una línea (latido del FC).
  useEffect(() => {
    if (accountsLoading || !activeAccountId || !recipeId) return
    let cancelled = false
    setEconLoading(true)
    listMenuItems({ accountId: activeAccountId })
      .then(async (allItems) => {
        if (cancelled) return
        // Marcas donde está ESTE plato.
        const mine = allItems.filter((mi) => mi.recipeItemId === recipeId)
        const brands = Array.from(new Set(mine.map((mi) => mi.brandId)))
        if (brands.length === 0) {
          setEconomics([])
          setBrandNames({})
          return
        }
        // Nombres de marca (para los títulos de bloque).
        listBrands({ accountId: activeAccountId })
          .then((all) => {
            if (cancelled) return
            const map: Record<string, string> = {}
            for (const b of all) map[b.id] = b.name
            setBrandNames(map)
          })
          .catch(() => {
            /* nombres cosméticos; si falla, se usa el id corto */
          })
        // Economía de cada marca en paralelo; etiquetamos cada fila con su
        // brandId (lo sabemos aquí, aunque la función no lo devuelva).
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

  // Coste total = suma de líneas del breakdown (las partes suman el total).
  const totalCost = useMemo(
    () => lines.reduce((acc, l) => acc + (l.lineCost ?? 0), 0),
    [lines]
  )

  // Coste mayor de línea: referencia para el ancho de las barras de peso.
  const maxLineCost = useMemo(
    () => lines.reduce((max, l) => Math.max(max, l.lineCost ?? 0), 0),
    [lines]
  )

  // Economía agrupada por marca, propias primero (es donde está el FC accionable).
  const econByBrand = useMemo(() => {
    const groups = new Map<string, { brandId: string; flowType: string; rows: EconRow[] }>()
    for (const r of economics) {
      const g = groups.get(r._brandId)
      if (g) g.rows.push(r)
      else groups.set(r._brandId, { brandId: r._brandId, flowType: r.flowType, rows: [r] })
    }
    return Array.from(groups.values()).sort((a, b) => {
      // own antes que licensed; dentro, por nombre de marca
      if (a.flowType !== b.flowType) return a.flowType === 'own' ? -1 : 1
      return (brandNames[a.brandId] ?? '').localeCompare(brandNames[b.brandId] ?? '')
    })
  }, [economics, brandNames])

  // Al cargar la economía, las marcas cedidas arrancan plegadas; las propias abiertas.
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

  // ── Handlers de edición inline (E1) ──

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
    setDraftQty(String(line.quantity).replace('.', ','))
  }

  function commitEdit(line: RecipeLineBreakdown) {
    // Si ya no estamos editando esta línea (p. ej. tras Esc), no hacemos nada.
    if (editingLineId !== line.lineId || !recipeId) {
      setEditingLineId(null)
      return
    }
    const raw = draftQty.trim().replace(',', '.')
    setEditingLineId(null)

    const num = Number(raw)
    if (raw === '' || !Number.isFinite(num) || num < 0) {
      setEditError(`Cantidad no válida para "${line.childName}". No se guardó.`)
      window.setTimeout(() => setEditError(null), 3000)
      return
    }
    if (num === line.quantity) return // sin cambios

    const prevLines = lines
    // Optimista: mostramos el valor nuevo ya.
    setLines((prev) =>
      prev.map((l) => (l.lineId === line.lineId ? { ...l, quantity: num } : l))
    )
    setSavingLineId(line.lineId)
    setEditError(null)

    updateLine(line.lineId, { quantityGross: num })
      .then(() => getRecipeBreakdown(recipeId))
      .then((fresh) => {
        setLines(fresh)
        triggerLatido(line.lineId)
        setEconReloadTick((t) => t + 1) // latido del FC por canal
      })
      .catch((err: unknown) => {
        setLines(prevLines) // revertir
        const msg = err instanceof Error ? err.message : 'Error al guardar la cantidad'
        setEditError(msg)
        window.setTimeout(() => setEditError(null), 4000)
      })
      .finally(() => setSavingLineId(null))
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
        setLines(prevLines) // revertir
        const msg = err instanceof Error ? err.message : 'Error al eliminar la línea'
        setEditError(msg)
        window.setTimeout(() => setEditError(null), 4000)
      })
      .finally(() => setSavingLineId(null))
  }

  // Botón "Volver al listado" (solo si el contenedor pasó onBack). Se reutiliza
  // en los estados de carga/error/no-encontrado y en el render principal.
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

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      {backLink}
      <div className="bg-card rounded-xl border border-border-default overflow-hidden">

        {/* ── Cabecera con foto del plato ── */}
        <div className="relative h-[150px] bg-accent overflow-hidden">
          {recipe.kitchenPhotoUrl ? (
            <img
              src={recipe.kitchenPhotoUrl}
              alt={recipe.name}
              className="w-full h-full object-cover"
            />
          ) : (
            // Placeholder cálido cuando el plato no tiene foto todavía
            <div className="w-full h-full flex items-center justify-center bg-terracota-bg">
              <ChefHat className="w-10 h-10 text-terracota opacity-60" />
            </div>
          )}
          {/* Degradado para legibilidad del texto */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/5" />

          {/* Botón cambiar foto */}
          <button className="absolute top-3 left-3 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/90 text-terracota font-medium hover:bg-white transition-colors">
            <Camera className="w-3.5 h-3.5" />
            {recipe.kitchenPhotoUrl ? 'Cambiar foto' : 'Añadir foto'}
          </button>

          {/* Badges de estado */}
          <div className="absolute top-3 right-3 flex gap-1.5">
            {isAi && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-accent text-text-on-accent inline-flex items-center gap-1 font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                IA
              </span>
            )}
            {recipe.needsReview ? (
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

          {/* Nombre + meta del plato */}
          <div className="absolute left-4 bottom-3 right-4">
            <h1 className="text-[22px] font-display font-medium text-white leading-tight">
              {recipe.name}
            </h1>
            <div className="text-[13px] text-white/85 mt-0.5 flex items-center gap-2">
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
          </div>
        </div>

        {/* ── Solapas ── */}
        <div className="flex gap-6 px-[18px] pt-3 border-b border-border-default text-sm">
          {TABS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={
                  'pb-3 transition-colors ' +
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
              {/* Cabecera de la composición + acciones rápidas */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium tracking-wide text-text-secondary uppercase">
                  Composición · {lines.length} ingredientes
                </span>
                <div className="flex gap-1">
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
                    disabled
                    title="Añadir ingrediente — próximamente (E2)"
                    className="w-7 h-7 rounded-md bg-terracota/40 text-white inline-flex items-center justify-center cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Aviso de error de edición (cantidad no válida / fallo al guardar) */}
              {editError && (
                <div className="mb-2 px-2.5 py-1.5 rounded-md bg-danger-bg text-danger text-xs">
                  {editError}
                </div>
              )}

              {/* Lista de ingredientes */}
              {lines.length === 0 ? (
                <div className="py-10 text-center text-sm text-text-secondary opacity-70">
                  Este escandallo aún no tiene ingredientes.
                </div>
              ) : (
                <div>
                  {lines.map((line) => {
                    // Barra de peso de la línea sobre el coste mayor (referencia visual)
                    const pct =
                      maxLineCost > 0
                        ? Math.round(((line.lineCost ?? 0) / maxLineCost) * 100)
                        : 0
                    const editing = editingLineId === line.lineId
                    const saving = savingLineId === line.lineId
                    return (
                      <div
                        key={line.lineId}
                        className="group flex items-center gap-2.5 py-2 px-1.5 border-b border-border-default last:border-b-0"
                      >
                        {/* Avatar: punto de color (categoría) — placeholder hasta tener fotos/categoría */}
                        <span className="w-[30px] h-[30px] rounded-md bg-accent-bg inline-flex items-center justify-center flex-shrink-0">
                          <span
                            className={
                              'w-2.5 h-2.5 rounded-full ' +
                              (line.needsReview ? 'bg-warning' : 'bg-terracota')
                            }
                          />
                        </span>

                        {/* Cantidad (BRUTO EFECTIVO) editable inline + unidad */}
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
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(line)}
                              title="Editar cantidad"
                              className="font-mono text-sm text-text-primary text-left hover:bg-accent-bg rounded px-1 -ml-1 transition-colors"
                            >
                              {formatQty(line.quantity)}{' '}
                              <span className="text-text-secondary">{line.unitAbbr}</span>
                            </button>
                          )}
                        </div>

                        {/* Nombre (+ aviso si needs_review) */}
                        <span className="flex-1 min-w-0 text-sm text-text-primary truncate">
                          {line.childName}
                          {line.needsReview && (
                            <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1 align-middle">
                              <AlertTriangle className="w-3 h-3" />
                              revisar
                            </span>
                          )}
                        </span>

                        {/* Barra de peso del coste */}
                        <span className="w-[38px] h-1 rounded-full bg-accent-bg overflow-hidden flex-shrink-0">
                          <span
                            className="block h-full bg-terracota transition-all duration-base"
                            style={{ width: `${pct}%` }}
                          />
                        </span>

                        {/* Coste de la línea (late al confirmar; pulsa al guardar) */}
                        <span
                          className={
                            'font-mono text-sm min-w-[52px] text-right transition-colors duration-base ' +
                            (saving
                              ? 'opacity-50 animate-pulse text-text-secondary'
                              : flashLineId === line.lineId
                                ? 'text-terracota font-medium'
                                : 'text-text-secondary')
                          }
                        >
                          {formatEur(line.lineCost)}
                        </span>

                        {/* Eliminar línea (aparece al pasar el ratón / foco) */}
                        <button
                          type="button"
                          onClick={() => handleDelete(line)}
                          disabled={saving}
                          title="Eliminar línea"
                          className="ml-0.5 w-6 h-6 rounded inline-flex items-center justify-center text-text-secondary opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger hover:bg-danger-bg transition-all disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Columna derecha: panel económico (azul Folvy) */}
            <div className="p-4 bg-accent text-white">
              <div className="text-[11px] font-medium tracking-wider text-white/60 uppercase mb-2.5">
                Coste en vivo
              </div>

              {/* Coste héroe (late al cambiar) */}
              <div className="text-xs text-white/60">Coste total</div>
              <div
                className={
                  'font-mono font-medium text-white leading-tight text-[34px] origin-left transition-all duration-slow ' +
                  (flashHero ? 'scale-110' : 'scale-100')
                }
              >
                {formatEur(totalCost)}
              </div>
              <div className="text-xs text-white/55 mt-0.5">
                por porción · {recipe.yieldPortions ?? 1} ración
                {(recipe.yieldPortions ?? 1) !== 1 ? 'es' : ''}
              </div>

              <div className="h-px bg-white/15 my-3.5" />

              {/* Economía: FC + margen por canal (avanzado, vía menu_item_economics) */}
              {econLoading ? (
                <div className="text-[11px] text-white/55">Calculando food cost…</div>
              ) : economics.length === 0 ? (
                // Sin menu_item: este plato no está en ninguna carta todavía.
                <div>
                  <div className="text-[11px] font-medium tracking-wide text-white/60 uppercase mb-2">
                    Food cost
                  </div>
                  <div className="flex items-start gap-1.5 text-[11px] text-white/70 leading-relaxed mb-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                    <span>Este plato aún no está en ninguna carta. Añádelo para ver su food cost y margen.</span>
                  </div>
                  <button className="w-full inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 text-white transition-colors">
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
                        {/* Cabecera de marca (clic para plegar/desplegar) */}
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

                        {/* Canales de la marca */}
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
        ) : (
          <div className="p-4 md:p-5">
            <div className="text-sm text-text-secondary opacity-70 py-8 text-center">
              Solapa «{TABS.find((t) => t.id === activeTab)?.label}» — pendiente.
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
