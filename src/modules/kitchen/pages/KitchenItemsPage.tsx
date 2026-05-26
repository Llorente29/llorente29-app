// src/modules/kitchen/pages/KitchenItemsPage.tsx
//
// Catálogo de ingredientes (recipe_item con type='raw') del módulo Kitchen.
// V1: lista + alta + edición + archivado. (Sin restore en V1.)
//
// Carga en paralelo recipe_item(raw) + kitchen_unit (la unidad base de cada
// ingrediente). El alta y la edición llaman a createRecipeItem/updateRecipeItem
// (que internamente disparan kitchen_recompute_item; aquí siempre saldrá
// === fixedCost porque un raw sin recipe_line es coste plano).
//
// Patrón: useApp() para actor (userProfile/authUserId) + useActiveAccount()
// para activeAccountId. Estilo coherente con BrandsListView.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Soup, X, Archive } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listRecipeItems,
  createRecipeItem,
  updateRecipeItem,
  archiveRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import type {
  RecipeItem,
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

export default function KitchenItemsPage() {
  const { userProfile, authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [items, setItems] = useState<RecipeItem[]>([])
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // formOpen + editingItem: si editingItem es null y formOpen=true → crear;
  // si editingItem es un RecipeItem → editar ese item.
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<RecipeItem | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setItems([])
      setUnits([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      listRecipeItems({ accountId: activeAccountId, type: 'raw' }),
      listUnits(),
    ])
      .then(([rows, allUnits]) => {
        if (cancelled) return
        setItems(rows)
        setUnits(allUnits)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setItems([])
        setUnits([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading, reloadTick])

  // Mapa unitId → unidad, para mostrar la abreviatura junto al nombre.
  const unitsById = useMemo(() => {
    const m = new Map<string, KitchenUnit>()
    units.forEach(u => m.set(u.id, u))
    return m
  }, [units])

  function openCreate() {
    setEditingItem(null)
    setFormOpen(true)
  }

  function openEdit(item: RecipeItem) {
    setEditingItem(item)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingItem(null)
  }

  function handleSaved() {
    closeForm()
    setReloadTick(t => t + 1)
  }

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">
            Ingredientes
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Catálogo de materias primas para el escandallo de cocina
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={!activeAccountId}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          <Plus size={16} />
          Nuevo ingrediente
        </button>
      </div>

      {/* Estados */}
      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">
          Cargando ingredientes...
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <Soup size={32} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            Aún no hay ingredientes. Pulsa "Nuevo ingrediente" para empezar.
          </p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="rounded-md bg-card border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-page text-left">
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Ingrediente
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Unidad base
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                    Coste fijo
                  </th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">
                    Coste computado
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const unit = unitsById.get(item.baseUnitId)
                  return (
                    <tr
                      key={item.id}
                      onClick={() => openEdit(item)}
                      className="border-b border-border-default last:border-0 hover:bg-accent-bg cursor-pointer transition-base"
                    >
                      <td className="p-3">
                        <span className="font-medium text-text-primary">
                          {item.name}
                        </span>
                        {item.altName && (
                          <span className="ml-2 text-xs text-text-secondary">
                            ({item.altName})
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-text-secondary">
                        {unit ? `${unit.name} (${unit.abbreviation})` : '—'}
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-primary">
                        {formatEur(item.fixedCost)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-secondary">
                        {formatEur(item.computedCost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-text-secondary border-t border-border-default bg-page">
            {items.length} ingrediente{items.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {/* Modal de creación/edición (mismo componente, modo dual) */}
      {formOpen && (
        <IngredientFormModal
          accountId={activeAccountId!}
          units={units}
          actorId={authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          item={editingItem}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal dual de creación / edición.
//   - item === null → modo creación (createRecipeItem).
//   - item: RecipeItem → modo edición (updateRecipeItem) + botón Archivar.
// Campos: nombre + unidad base + coste fijo. El resto se rellenará en
// una página de detalle dedicada (sesión futura).
// ─────────────────────────────────────────────────────────────────────

interface IngredientFormModalProps {
  accountId: string
  units: KitchenUnit[]
  actorId: string | null
  actorName: string | null
  /** null = modo creación; RecipeItem = modo edición. */
  item: RecipeItem | null
  onClose: () => void
  /** Disparado tras crear, editar o archivar con éxito. */
  onSaved: () => void
}

function IngredientFormModal({
  accountId,
  units,
  actorId,
  actorName,
  item,
  onClose,
  onSaved,
}: IngredientFormModalProps) {
  const isEditing = item !== null

  const [name, setName] = useState(item?.name ?? '')
  const [baseUnitId, setBaseUnitId] = useState<string>(item?.baseUnitId ?? units[0]?.id ?? '')
  const [fixedCost, setFixedCost] = useState<string>(
    item?.fixedCost !== null && item?.fixedCost !== undefined ? String(item.fixedCost) : '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const busy = submitting || archiving

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
    const costParsed = fixedCost.trim() === '' ? null : Number(fixedCost.replace(',', '.'))
    if (costParsed !== null && (Number.isNaN(costParsed) || costParsed < 0)) {
      setError('El coste fijo debe ser un número ≥ 0 (deja vacío si aún no lo sabes).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isEditing && item) {
        await updateRecipeItem(item.id, {
          name: trimmed,
          baseUnitId,
          fixedCost: costParsed,
        })
      } else {
        await createRecipeItem({
          accountId,
          type: 'raw',
          name: trimmed,
          baseUnitId,
          costStrategy: 'fixed',
          fixedCost: costParsed,
          createdBy: actorId,
          createdByName: actorName,
        })
      }
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    if (!item) return
    const ok = window.confirm(
      `¿Archivar "${item.name}"? Dejará de aparecer en el catálogo. Podrás restaurarlo más adelante.`,
    )
    if (!ok) return

    setArchiving(true)
    setError(null)
    try {
      await archiveRecipeItem(item.id)
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setArchiving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !busy) {
      onClose()
    }
  }

  // Agrupar unidades por dimensión para el selector.
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
      aria-labelledby="ingredient-form-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="ingredient-form-title" className="text-base font-medium text-text-primary">
            {isEditing ? 'Editar ingrediente' : 'Nuevo ingrediente'}
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={busy}
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
              disabled={busy}
              placeholder="Ej: Aceite de oliva virgen extra"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Unidad base
            </label>
            <select
              value={baseUnitId}
              onChange={e => setBaseUnitId(e.target.value)}
              disabled={busy || units.length === 0}
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
              La unidad en la que se expresa el coste y las cantidades de las recetas.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Coste fijo (€ / unidad base)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={fixedCost}
              onChange={e => setFixedCost(e.target.value)}
              disabled={busy}
              placeholder="Opcional. Ej: 0.012"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Déjalo vacío si aún no sabes el precio; se podrá editar después.
            </p>
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-default">
          {/* Acción destructiva a la izquierda, solo en modo edición */}
          <div>
            {isEditing && (
              <button
                type="button"
                onClick={handleArchive}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-danger hover:bg-danger-bg transition-base disabled:opacity-50"
              >
                <Archive size={14} />
                {archiving ? 'Archivando...' : 'Archivar'}
              </button>
            )}
          </div>

          {/* Acciones primarias a la derecha */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
            >
              {submitting
                ? (isEditing ? 'Guardando...' : 'Creando...')
                : (isEditing ? 'Guardar cambios' : 'Crear')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
