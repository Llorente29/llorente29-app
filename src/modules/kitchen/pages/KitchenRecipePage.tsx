// src/modules/kitchen/pages/KitchenRecipePage.tsx
//
// Catálogo + ficha de escandallo de Folvy Kitchen.
//
// SUB-TANDA A (ESTA): estructura + visualización.
//   - Lista de platos/recetas (type ∈ {dish, recipe}) con crear/seleccionar.
//   - Ficha de detalle SOLO LECTURA: coste total, coste por ración (si hay
//     yieldPortions), y líneas con nombre del ingrediente hijo + cantidad+unidad.
//
// SUB-TANDA B (siguiente): edición de líneas (añadir/editar/quitar),
// reordenar, archivar/desarchivar plato.
//
// Patrón: master-detail con state local (igual que BrandsPage). Reutiliza
// listRecipeItems + listUnits (todo en una sola carga) para tener un mapa
// id→item / id→unit que la ficha usa al renderizar las líneas.

import { useEffect, useMemo, useState } from 'react'
import { Plus, ChefHat, X, ArrowLeft } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listRecipeItems,
  createRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import { listLinesByParent } from '@/modules/kitchen/services/recipeLineService'
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
        itemsById={itemsById}
        unitsById={unitsById}
        onBack={() => setSelectedRecipeId(null)}
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
// Detalle: muestra cabecera con coste total + coste/ración, y las líneas
// de la receta en SOLO LECTURA. La edición de líneas llega en sub-tanda B.
// ─────────────────────────────────────────────────────────────────────

interface RecipeDetailViewProps {
  recipe: RecipeItem
  itemsById: Map<string, RecipeItem>
  unitsById: Map<string, KitchenUnit>
  onBack: () => void
}

function RecipeDetailView({ recipe, itemsById, unitsById, onBack }: RecipeDetailViewProps) {
  const [lines, setLines] = useState<RecipeLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    listLinesByParent(recipe.id)
      .then(data => { if (!cancelled) setLines(data) })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setLines([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [recipe.id])

  const baseUnit = unitsById.get(recipe.baseUnitId)

  const perPortion =
    recipe.computedCost !== null && recipe.yieldPortions && recipe.yieldPortions > 0
      ? recipe.computedCost / recipe.yieldPortions
      : null

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
        <h3 className="text-sm font-semibold text-text-primary">Ingredientes</h3>

        {loading && (
          <div className="p-6 text-center text-sm text-text-secondary">
            Cargando líneas...
          </div>
        )}

        {!loading && error && (
          <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && lines.length === 0 && (
          <div className="p-6 rounded-md bg-card border border-border-default text-center">
            <p className="text-sm text-text-secondary">
              Esta receta aún no tiene ingredientes.
            </p>
          </div>
        )}

        {!loading && !error && lines.length > 0 && (
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
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => {
                    const child = itemsById.get(line.childItemId)
                    const unit = unitsById.get(line.unitId)
                    const unitAbbr = unit?.abbreviation ?? '—'
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
