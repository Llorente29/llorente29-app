// src/modules/kitchen/pages/KitchenRecipePage.tsx
//
// Catálogo + ficha de escandallo de Folvy Kitchen.
//
// SUB-TANDA A (anterior): estructura + visualización (lista + ficha read-only).
// SUB-TANDA B (esta):
//   - Añadir ingrediente a la receta (addLine).
//   - Editar cantidad / unidad / cantidad bruta de una línea (updateLine).
//   - Quitar línea con confirmación (deleteLine).
//   - Las 3 operaciones disparan el recálculo del plato server-side
//     (recipeLineService.tryRecomputeParent) y, en cliente, refrescan
//     tanto las líneas locales como el coste mostrado en las tarjetas
//     (via onChanged → reloadTick del orquestador → itemsById fresco).
//
// COSTE POR LÍNEA NO se muestra: requiere replicar la lógica de conversiones
// del SQL (factor_to_base + recipe_item_unit_conversion). Riesgo de mostrar
// algo distinto a lo que calcula server-side. La fuente de verdad del coste
// es computedCost del plato (que SÍ se recalcula tras cada edición de línea).
//
// Patrón: master-detail con state local (igual que BrandsPage). Reutiliza
// listRecipeItems + listUnits (todo en una sola carga) para tener un mapa
// id→item / id→unit que la ficha usa al renderizar las líneas.

import { useEffect, useMemo, useState } from 'react'
import { Plus, ChefHat, X, ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listRecipeItems,
  createRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import {
  listLinesByParent,
  addLine,
  updateLine,
  deleteLine,
  getRecipeBreakdown,
  type RecipeLineBreakdown,
} from '@/modules/kitchen/services/recipeLineService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import type {
  RecipeItem,
  RecipeItemType,
  RecipeLine,
  KitchenUnit,
} from '@/types/kitchen'

function formatEur(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

function formatQty(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)
}

const TYPE_LABEL: Record<RecipeItemType, string> = {
  raw:    'Ingrediente',
  recipe: 'Sub-receta',
  tool:   'Herramienta',
  dish:   'Plato',
}

// ─────────────────────────────────────────────────────────────────────
// Orquestador master-detail. Carga TODO una vez (items + unidades) y
// elige sub-vista por selectedRecipeId.
// ─────────────────────────────────────────────────────────────────────

export default function KitchenRecipePage() {
  const { userProfile, authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [allItems, setAllItems] = useState<RecipeItem[]>([])
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Sub-vista: null = listado; uuid = detalle de ese plato.
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)

  // Modal de creación
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setAllItems([])
      setUnits([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      listRecipeItems({ accountId: activeAccountId }),
      listUnits(),
    ])
      .then(([rows, allUnits]) => {
        if (cancelled) return
        setAllItems(rows)
        setUnits(allUnits)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setAllItems([])
        setUnits([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading, reloadTick])

  const itemsById = useMemo(() => {
    const m = new Map<string, RecipeItem>()
    allItems.forEach(i => m.set(i.id, i))
    return m
  }, [allItems])

  const unitsById = useMemo(() => {
    const m = new Map<string, KitchenUnit>()
    units.forEach(u => m.set(u.id, u))
    return m
  }, [units])

  const recipes = useMemo(
    () => allItems.filter(i => i.type === 'dish' || i.type === 'recipe'),
    [allItems],
  )

  function handleCreated() {
    setFormOpen(false)
    setReloadTick(t => t + 1)
  }

  function handleDetailChanged() {
    // Cualquier mutación en la ficha (alta/edición/borrado de líneas) dispara
    // la recarga global → itemsById trae el plato con el computedCost fresco
    // → la ficha re-renderiza las tarjetas de coste sin recargar lines (que
    // van con su propio linesReloadTick).
    setReloadTick(t => t + 1)
  }

  // Estados globales de carga / error: solo bloqueamos la pantalla cuando
  // estamos en el listado. La ficha gestiona su propia carga de líneas.
  if (loading && selectedRecipeId === null) {
    return (
      <div className="p-8 text-center text-sm text-text-secondary">
        Cargando recetas...
      </div>
    )
  }
  if (error && selectedRecipeId === null) {
    return (
      <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
        {error}
      </div>
    )
  }

  // ─── Sub-vista: detalle ────────────────────────────────────────────
  if (selectedRecipeId !== null) {
    const recipe = itemsById.get(selectedRecipeId)
    if (!recipe) {
      // Recipe ID inválido (típico tras reload tras borrado externo).
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setSelectedRecipeId(null)}
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft size={14} /> Volver al listado
          </button>
          <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
            Plato no encontrado. Pudo haber sido borrado o aún no se ha cargado.
          </div>
        </div>
      )
    }
    return (
      <RecipeDetailView
        recipe={recipe}
        accountId={activeAccountId!}
        allItems={allItems}
        itemsById={itemsById}
        units={units}
        unitsById={unitsById}
        onBack={() => setSelectedRecipeId(null)}
        onChanged={handleDetailChanged}
      />
    )
  }

  // ─── Sub-vista: listado ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">
            Recetas
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Platos y sub-recetas: composición y coste por ración
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={!activeAccountId}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          <Plus size={16} />
          Nuevo plato
        </button>
      </div>

      {/* Listado o vacío */}
      {recipes.length === 0 ? (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <ChefHat size={32} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            Aún no hay recetas. Pulsa "Nuevo plato" para empezar.
          </p>
        </div>
      ) : (
        <div className="rounded-md bg-card border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-page text-left">
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Receta
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Tipo
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                    Raciones
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                    Coste total
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                    Coste / ración
                  </th>
                </tr>
              </thead>
              <tbody>
                {recipes.map(r => {
                  const perPortion =
                    r.computedCost !== null && r.yieldPortions && r.yieldPortions > 0
                      ? r.computedCost / r.yieldPortions
                      : null
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRecipeId(r.id)}
                      className="border-b border-border-default last:border-0 hover:bg-accent-bg cursor-pointer transition-base"
                    >
                      <td className="p-3">
                        <span className="font-medium text-text-primary">{r.name}</span>
                        {r.altName && (
                          <span className="ml-2 text-xs text-text-secondary">
                            ({r.altName})
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent-bg text-text-primary">
                          {TYPE_LABEL[r.type]}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-secondary">
                        {r.yieldPortions ?? '—'}
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-primary">
                        {formatEur(r.computedCost)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-primary">
                        {formatEur(perPortion)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-text-secondary border-t border-border-default bg-page">
            {recipes.length} receta{recipes.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {/* Modal creación */}
      {formOpen && (
        <RecipeFormModal
          accountId={activeAccountId!}
          units={units}
          actorId={authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          onClose={() => setFormOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Detalle: cabecera con coste total + coste/ración + líneas editables.
// Añadir/editar/quitar líneas dispara onChanged → reload global → tarjetas
// actualizadas con el nuevo computedCost.
// ─────────────────────────────────────────────────────────────────────

interface RecipeDetailViewProps {
  recipe: RecipeItem
  accountId: string
  allItems: RecipeItem[]
  itemsById: Map<string, RecipeItem>
  units: KitchenUnit[]
  unitsById: Map<string, KitchenUnit>
  onBack: () => void
  /** Disparado tras cualquier mutación de líneas (alta/edit/delete). */
  onChanged: () => void
}

function RecipeDetailView({
  recipe,
  accountId,
  allItems,
  itemsById,
  units,
  unitsById,
  onBack,
  onChanged,
}: RecipeDetailViewProps) {
  const [lines, setLines] = useState<RecipeLine[]>([])
  const [breakdown, setBreakdown] = useState<RecipeLineBreakdown[]>([])
  const [linesLoading, setLinesLoading] = useState(true)
  const [linesError, setLinesError] = useState<string | null>(null)
  // Tick local para recargar líneas tras una mutación sin recargar el resto.
  const [linesReloadTick, setLinesReloadTick] = useState(0)

  // Edición de líneas
  const [lineFormOpen, setLineFormOpen] = useState(false)
  const [editingLine, setEditingLine] = useState<RecipeLine | null>(null)
  // Estado de borrado por línea: id de la línea en proceso (para deshabilitar
  // sus botones) o null. Borrado es operación instantánea sin modal.
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLinesLoading(true)
    setLinesError(null)

    // Cargamos líneas y desglose en paralelo. El desglose puede fallar
    // sin romper la tabla: si lo hace, registramos el error y seguimos
    // sin coste por línea (las líneas se siguen mostrando).
    Promise.all([
      listLinesByParent(recipe.id),
      getRecipeBreakdown(recipe.id).catch(err => {
        console.error('getRecipeBreakdown error:', err)
        return [] as RecipeLineBreakdown[]
      }),
    ])
      .then(([linesData, breakdownData]) => {
        if (cancelled) return
        setLines(linesData)
        setBreakdown(breakdownData)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setLinesError(msg)
        setLines([])
        setBreakdown([])
      })
      .finally(() => { if (!cancelled) setLinesLoading(false) })

    return () => { cancelled = true }
  }, [recipe.id, linesReloadTick])

  const breakdownByLineId = useMemo(() => {
    const m = new Map<string, RecipeLineBreakdown>()
    breakdown.forEach(b => m.set(b.lineId, b))
    return m
  }, [breakdown])

  const totalBreakdown = useMemo(
    () => breakdown.reduce((acc, b) => acc + b.lineCost, 0),
    [breakdown],
  )

  const baseUnit = unitsById.get(recipe.baseUnitId)

  const perPortion =
    recipe.computedCost !== null && recipe.yieldPortions && recipe.yieldPortions > 0
      ? recipe.computedCost / recipe.yieldPortions
      : null

  function openAddLine() {
    setEditingLine(null)
    setLineFormOpen(true)
  }

  function openEditLine(line: RecipeLine) {
    setEditingLine(line)
    setLineFormOpen(true)
  }

  function closeLineForm() {
    setLineFormOpen(false)
    setEditingLine(null)
  }

  function handleLineSaved() {
    closeLineForm()
    // Refrescar líneas locales y disparar reload global para que recipe.computedCost
    // se refresque en las tarjetas de arriba.
    setLinesReloadTick(t => t + 1)
    onChanged()
  }

  async function handleDeleteLine(line: RecipeLine) {
    const child = itemsById.get(line.childItemId)
    const childName = child?.name ?? 'esta línea'
    const ok = window.confirm(`¿Quitar "${childName}" de la receta?`)
    if (!ok) return

    setDeletingLineId(line.id)
    setRowError(null)
    try {
      await deleteLine(line.id)
      setLinesReloadTick(t => t + 1)
      onChanged()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setRowError(msg)
    } finally {
      setDeletingLineId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Volver */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
      >
        <ArrowLeft size={14} /> Volver al listado
      </button>

      {/* Cabecera del plato */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-display font-medium text-text-primary">
            {recipe.name}
          </h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-accent-bg text-text-primary">
            {TYPE_LABEL[recipe.type]}
          </span>
        </div>
        <p className="text-sm text-text-secondary">
          Unidad base: {baseUnit ? `${baseUnit.name} (${baseUnit.abbreviation})` : '—'}
          {recipe.yieldPortions && recipe.yieldPortions > 0 && (
            <> · Raciones: <span className="text-text-primary tabular-nums">{recipe.yieldPortions}</span></>
          )}
        </p>
      </div>

      {/* Tarjetas de coste */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-4 rounded-md bg-card border border-border-default">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Coste total
          </p>
          <p className="mt-1 text-2xl font-display text-text-primary tabular-nums">
            {formatEur(recipe.computedCost)}
          </p>
        </div>
        <div className="p-4 rounded-md bg-card border border-border-default">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Coste por ración
          </p>
          <p className="mt-1 text-2xl font-display text-text-primary tabular-nums">
            {perPortion !== null
              ? formatEur(perPortion)
              : <span className="text-sm text-text-secondary">Define "Raciones" para verlo</span>}
          </p>
        </div>
      </div>

      {/* Sección de ingredientes (líneas) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-text-primary">Ingredientes</h3>
          <button
            type="button"
            onClick={openAddLine}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
          >
            <Plus size={14} />
            Añadir ingrediente
          </button>
        </div>

        {rowError && (
          <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
            {rowError}
          </div>
        )}

        {linesLoading && (
          <div className="p-6 text-center text-sm text-text-secondary">
            Cargando líneas...
          </div>
        )}

        {!linesLoading && linesError && (
          <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
            {linesError}
          </div>
        )}

        {!linesLoading && !linesError && lines.length === 0 && (
          <div className="p-6 rounded-md bg-card border border-border-default text-center">
            <p className="text-sm text-text-secondary">
              Esta receta aún no tiene ingredientes. Pulsa "Añadir ingrediente" para empezar.
            </p>
          </div>
        )}

        {!linesLoading && !linesError && lines.length > 0 && (
          <div className="rounded-md bg-card border border-border-default overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-page text-left">
                    <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      Ingrediente
                    </th>
                    <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                      Cantidad neta
                    </th>
                    <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                      Cantidad bruta
                    </th>
                    <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                      Coste
                    </th>
                    <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                      %
                    </th>
                    <th className="p-3 w-24 text-right" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => {
                    const child = itemsById.get(line.childItemId)
                    const unit = unitsById.get(line.unitId)
                    const unitAbbr = unit?.abbreviation ?? '—'
                    const isDeleting = deletingLineId === line.id
                    const bdEntry = breakdownByLineId.get(line.id)
                    const isReview = bdEntry?.needsReview ?? false
                    const pct = bdEntry && totalBreakdown > 0
                      ? (bdEntry.lineCost / totalBreakdown) * 100
                      : null
                    return (
                      <tr key={line.id} className="border-b border-border-default last:border-0">
                        <td className="p-3 text-text-primary">
                          {child?.name ?? <span className="text-text-secondary">[Ingrediente desconocido]</span>}
                          {line.comment && (
                            <span className="block text-xs text-text-secondary mt-0.5">
                              {line.comment}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums text-text-primary">
                          {formatQty(line.quantityNet)} {unitAbbr}
                        </td>
                        <td className="p-3 text-right tabular-nums text-text-secondary">
                          {line.quantityGross !== null
                            ? `${formatQty(line.quantityGross)} ${unitAbbr}`
                            : '—'}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {bdEntry ? (
                            <span className={isReview ? 'text-danger' : 'text-text-primary'}>
                              {formatEur(bdEntry.lineCost)}
                              {isReview && (
                                <span className="block text-[10px] uppercase tracking-wide text-danger">
                                  sin coste
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums text-text-secondary">
                          {pct !== null ? `${pct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="Editar línea"
                              onClick={() => openEditLine(line)}
                              disabled={isDeleting}
                              className="p-1.5 rounded-md text-text-secondary hover:bg-accent-bg hover:text-text-primary transition-base disabled:opacity-50"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label="Quitar línea"
                              onClick={() => handleDeleteLine(line)}
                              disabled={isDeleting}
                              className="p-1.5 rounded-md text-danger hover:bg-danger-bg transition-base disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-xs text-text-secondary border-t border-border-default bg-page">
              {lines.length} línea{lines.length === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>

      {/* Modal de añadir/editar línea */}
      {lineFormOpen && (
        <LineFormModal
          accountId={accountId}
          parentItemId={recipe.id}
          allItems={allItems}
          units={units}
          line={editingLine}
          existingLineCount={lines.length}
          onClose={closeLineForm}
          onSaved={handleLineSaved}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal de creación de plato/receta. Campos: nombre + unidad base + tipo
// (dish/recipe) + raciones (opcional). El coste se calcula con las líneas
// (sub-tanda B); para un plato recién creado sin líneas será 0,00 €.
// ─────────────────────────────────────────────────────────────────────

interface RecipeFormModalProps {
  accountId: string
  units: KitchenUnit[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: () => void
}

function RecipeFormModal({
  accountId,
  units,
  actorId,
  actorName,
  onClose,
  onCreated,
}: RecipeFormModalProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<RecipeItemType>('dish')
  const [baseUnitId, setBaseUnitId] = useState<string>(units[0]?.id ?? '')
  const [yieldPortions, setYieldPortions] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('El nombre es obligatorio.')
      return
    }
    if (!baseUnitId) {
      setError('Elige una unidad base.')
      return
    }
    const yieldParsed = yieldPortions.trim() === ''
      ? null
      : Number(yieldPortions.replace(',', '.'))
    if (yieldParsed !== null && (Number.isNaN(yieldParsed) || yieldParsed <= 0)) {
      setError('Las raciones deben ser un número > 0 (deja vacío si no aplica).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await createRecipeItem({
        accountId,
        type,
        name: trimmed,
        baseUnitId,
        yieldPortions: yieldParsed,
        createdBy: actorId,
        createdByName: actorName,
      })
      onCreated()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) {
      onClose()
    }
  }

  // Unidades agrupadas por dimensión (igual que KitchenItemsPage).
  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    units.forEach(u => {
      const list = groups.get(u.dimension) ?? []
      list.push(u)
      groups.set(u.dimension, list)
    })
    return groups
  }, [units])

  const DIM_LABEL: Record<string, string> = {
    weight: 'Peso',
    volume: 'Volumen',
    unit:   'Unidades',
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-form-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="recipe-form-title" className="text-base font-medium text-text-primary">
            Nuevo plato
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={submitting}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Nombre
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={submitting}
              placeholder='Ej: Pizza Margherita'
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Tipo
            </label>
            <select
              value={type}
              onChange={e => setType(e.target.value as RecipeItemType)}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="dish">Plato (se sirve al cliente)</option>
              <option value="recipe">Sub-receta (componente reutilizable)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Unidad base
            </label>
            <select
              value={baseUnitId}
              onChange={e => setBaseUnitId(e.target.value)}
              disabled={submitting || units.length === 0}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              {Array.from(unitsGrouped.entries()).map(([dim, list]) => (
                <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                  {list.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[11px] text-text-secondary mt-1">
              Para un plato individual normalmente "Unidad". Para una sub-receta a granel, peso o volumen.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Raciones
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={yieldPortions}
              onChange={e => setYieldPortions(e.target.value)}
              disabled={submitting}
              placeholder="Opcional. Ej: 8"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Cuántas raciones salen de esta receta. Permite calcular el coste por ración.
            </p>
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            {submitting ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal dual añadir/editar línea de receta.
//   - line === null → modo añadir (addLine). Permite elegir el child.
//   - line: RecipeLine → modo editar (updateLine). El child queda fijo
//     (no se puede cambiar en updateLine; semánticamente es otra línea).
// Tras éxito, llama a onSaved (que cierra modal + recarga líneas/coste).
// ─────────────────────────────────────────────────────────────────────

interface LineFormModalProps {
  accountId: string
  parentItemId: string
  allItems: RecipeItem[]
  units: KitchenUnit[]
  /** null = modo añadir; RecipeLine = modo editar. */
  line: RecipeLine | null
  /** Número de líneas actuales en la receta — sirve para la position al añadir. */
  existingLineCount: number
  onClose: () => void
  onSaved: () => void
}

function LineFormModal({
  accountId,
  parentItemId,
  allItems,
  units,
  line,
  existingLineCount,
  onClose,
  onSaved,
}: LineFormModalProps) {
  const isEditing = line !== null

  // Items disponibles para elegir como child: todos menos el plato actual.
  const selectableItems = useMemo(
    () => allItems.filter(i => i.id !== parentItemId),
    [allItems, parentItemId],
  )

  // En modo edición el child queda fijo. En modo añadir, el primer item.
  const initialChildId = line?.childItemId ?? selectableItems[0]?.id ?? ''
  const [childItemId, setChildItemId] = useState<string>(initialChildId)

  // Para la unidad: por defecto, la baseUnit del child seleccionado. En edit,
  // la unidad guardada de la línea.
  const initialUnitId = line?.unitId ?? (() => {
    const child = allItems.find(i => i.id === initialChildId)
    return child?.baseUnitId ?? units[0]?.id ?? ''
  })()
  const [unitId, setUnitId] = useState<string>(initialUnitId)

  const [quantityNet, setQuantityNet] = useState<string>(
    line?.quantityNet !== undefined ? String(line.quantityNet) : '',
  )
  const [quantityGross, setQuantityGross] = useState<string>(
    line?.quantityGross !== null && line?.quantityGross !== undefined
      ? String(line.quantityGross)
      : '',
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Si el usuario cambia el child en modo añadir, sugerimos su baseUnit por defecto
  // (solo si la unidad actual no es válida o si nunca la ha tocado el usuario).
  // Estrategia simple: al cambiar child en modo añadir, actualizar unitId al
  // baseUnit del nuevo child. Si el usuario quería otra unidad la cambia después.
  function handleChildChange(newChildId: string) {
    setChildItemId(newChildId)
    if (!isEditing) {
      const child = allItems.find(i => i.id === newChildId)
      if (child) setUnitId(child.baseUnitId)
    }
  }

  // Agrupar items por tipo para el selector.
  const itemsGrouped = useMemo(() => {
    const groups = new Map<RecipeItemType, RecipeItem[]>()
    selectableItems.forEach(i => {
      const list = groups.get(i.type) ?? []
      list.push(i)
      groups.set(i.type, list)
    })
    // Ordenar cada grupo por nombre
    groups.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, 'es')))
    return groups
  }, [selectableItems])

  const TYPE_ORDER: RecipeItemType[] = ['raw', 'recipe', 'dish', 'tool']

  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    units.forEach(u => {
      const list = groups.get(u.dimension) ?? []
      list.push(u)
      groups.set(u.dimension, list)
    })
    return groups
  }, [units])

  const DIM_LABEL: Record<string, string> = {
    weight: 'Peso',
    volume: 'Volumen',
    unit:   'Unidades',
  }

  async function handleSubmit() {
    if (!childItemId) {
      setError('Elige un ingrediente.')
      return
    }
    if (!unitId) {
      setError('Elige una unidad.')
      return
    }
    const netParsed = quantityNet.trim() === '' ? NaN : Number(quantityNet.replace(',', '.'))
    if (Number.isNaN(netParsed) || netParsed <= 0) {
      setError('La cantidad neta debe ser un número > 0.')
      return
    }
    const grossParsed = quantityGross.trim() === ''
      ? null
      : Number(quantityGross.replace(',', '.'))
    if (grossParsed !== null && (Number.isNaN(grossParsed) || grossParsed < netParsed)) {
      setError('La cantidad bruta debe ser ≥ neta (o déjala vacía si no hay merma).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isEditing && line) {
        await updateLine(line.id, {
          quantityNet: netParsed,
          quantityGross: grossParsed,
          unitId,
        })
      } else {
        await addLine({
          accountId,
          parentItemId,
          childItemId,
          quantityNet: netParsed,
          quantityGross: grossParsed,
          unitId,
          position: existingLineCount,
        })
      }
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) {
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="line-form-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="line-form-title" className="text-base font-medium text-text-primary">
            {isEditing ? 'Editar línea' : 'Añadir ingrediente'}
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={submitting}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Ingrediente / sub-receta
            </label>
            <select
              value={childItemId}
              onChange={e => handleChildChange(e.target.value)}
              disabled={submitting || isEditing || selectableItems.length === 0}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              {TYPE_ORDER.map(t => {
                const list = itemsGrouped.get(t)
                if (!list || list.length === 0) return null
                return (
                  <optgroup key={t} label={TYPE_LABEL[t]}>
                    {list.map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            {isEditing && (
              <p className="text-[11px] text-text-secondary mt-1">
                No se puede cambiar el ingrediente de una línea. Si quieres otro, elimina y vuelve a añadir.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Cantidad neta
            </label>
            <input
              type="text"
              inputMode="decimal"
              autoFocus={!isEditing}
              value={quantityNet}
              onChange={e => setQuantityNet(e.target.value)}
              disabled={submitting}
              placeholder="Ej: 200"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Cantidad realmente usada en la receta (sin merma).
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Unidad
            </label>
            <select
              value={unitId}
              onChange={e => setUnitId(e.target.value)}
              disabled={submitting || units.length === 0}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              {Array.from(unitsGrouped.entries()).map(([dim, list]) => (
                <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                  {list.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Cantidad bruta (con merma, opcional)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={quantityGross}
              onChange={e => setQuantityGross(e.target.value)}
              disabled={submitting}
              placeholder="Ej: 250 (si compras 250g pero usas 200g netos)"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Si la compras pesa más que lo que acaba en la receta (mermas, pieles, huesos), pon aquí la cantidad bruta. Debe ser ≥ neta. Si no hay merma, déjala vacía.
            </p>
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            {submitting
              ? (isEditing ? 'Guardando...' : 'Añadiendo...')
              : (isEditing ? 'Guardar cambios' : 'Añadir')}
          </button>
        </div>
      </div>
    </div>
  )
}
