// src/modules/kitchen/pages/KitchenItemsPage.tsx
//
// Catálogo de ingredientes (recipe_item con type='raw') del módulo Kitchen.
// Patrón LISTA + DETALLE por estado, igual que KitchenRecipesPage:
//   selectedItemId === null → vista LISTA (tabla de ingredientes).
//   selectedItemId !== null → vista DETALLE: <KitchenItemDetailPage itemId onBack/>.
//
// El alta rápida (nombre + unidad base + coste) sigue en un modal; al crear,
// saltamos al DETALLE del ingrediente nuevo, donde se le añade el proveedor y el
// coste pasa a fluir desde la compra. La EDICIÓN y el archivado viven en el
// detalle (no en el modal): un solo editor, sin duplicar.
//
// Patrón: useApp() para actor (userProfile/authUserId) + useActiveAccount()
// para activeAccountId. Estilo coherente con KitchenRecipesPage.
//
// R1 (responsive móvil): en escritorio se mantiene la TABLA; en móvil (<768px),
// donde una tabla de 4 columnas + chevron obliga a arrastrar y oculta "Coste
// computado", cada fila se muestra como TARJETA apilada (nombre prominente +
// chip "sin terminar" + unidad/coste fijo/coste computado etiquetados), sin
// scroll horizontal. Mismo mecanismo y estilo que KitchenProfitabilityPage (R1.4).

import { useEffect, useMemo, useState } from 'react'
import { Plus, Soup, X, AlertTriangle, ChevronRight } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  listRecipeItems,
  createRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import KitchenItemDetailPage from '@/modules/kitchen/pages/KitchenItemDetailPage'
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

function unitLabel(unit: KitchenUnit | undefined): string {
  return unit ? `${unit.name} (${unit.abbreviation})` : '—'
}

export default function KitchenItemsPage() {
  const { userProfile, authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const isMobile = useIsMobile()

  const [items, setItems] = useState<RecipeItem[]>([])
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Modal: solo alta (crear). La edición va al detalle.
  const [createOpen, setCreateOpen] = useState(false)
  // null = vista lista; un id = vista detalle del ingrediente.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
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

  function handleCreated(created: RecipeItem) {
    setCreateOpen(false)
    setReloadTick(t => t + 1)
    // Salto al detalle del ingrediente recién creado: la siguiente acción natural
    // es decirle a Folvy de quién se compra (y ver el coste fluir).
    setSelectedItemId(created.id)
  }

  // ── Vista DETALLE: el ingrediente seleccionado ──
  if (selectedItemId) {
    return (
      <KitchenItemDetailPage
        itemId={selectedItemId}
        onBack={() => {
          setSelectedItemId(null)
          setReloadTick(t => t + 1)
        }}
      />
    )
  }

  // ── Vista LISTA ──
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
          onClick={() => setCreateOpen(true)}
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

      {/* ── Móvil: tarjetas apiladas (sin scroll horizontal) ── */}
      {!loading && !error && items.length > 0 && isMobile && (
        <div className="space-y-2">
          {items.map(item => (
            <IngredientCard
              key={item.id}
              item={item}
              unit={unitsById.get(item.baseUnitId)}
              onSelect={() => setSelectedItemId(item.id)}
            />
          ))}
          <p className="px-1 pt-1 text-xs text-text-secondary">
            {items.length} ingrediente{items.length === 1 ? '' : 's'}
          </p>
        </div>
      )}

      {/* ── Escritorio: tabla ── */}
      {!loading && !error && items.length > 0 && !isMobile && (
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
                  <th className="p-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const unit = unitsById.get(item.baseUnitId)
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
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
                        {item.needsReview && (
                          <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1 align-middle">
                            <AlertTriangle className="w-3 h-3" />
                            sin terminar
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-text-secondary">
                        {unitLabel(unit)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-primary">
                        {formatEur(item.fixedCost)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-text-secondary">
                        {formatEur(item.computedCost)}
                      </td>
                      <td className="p-3 text-right text-text-secondary">
                        <ChevronRight className="w-4 h-4 inline-block" />
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

      {/* Modal de SOLO alta */}
      {createOpen && (
        <IngredientCreateModal
          accountId={activeAccountId!}
          units={units}
          actorId={authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// IngredientCard — fila como tarjeta (móvil). Mismo lenguaje visual que
// EconomicsCard de KitchenProfitabilityPage (R1.4): cabecera con nombre
// prominente + chip de estado, y rejilla de campos etiquetados debajo.
// La tarjeta entera es tappable → abre el detalle del ingrediente.
// ─────────────────────────────────────────────────────────────────────
function IngredientCard({
  item,
  unit,
  onSelect,
}: {
  item: RecipeItem
  unit: KitchenUnit | undefined
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left bg-card border border-border-default rounded-xl p-3 hover:bg-accent-bg transition-base"
    >
      {/* Cabecera: nombre + chip "sin terminar" + chevron */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
            <span className="font-medium text-text-primary break-words">
              {item.name}
            </span>
            {item.altName && (
              <span className="text-xs text-text-secondary">
                ({item.altName})
              </span>
            )}
            {item.needsReview && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                sin terminar
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 shrink-0 text-text-secondary mt-0.5" />
      </div>

      {/* Campos etiquetados */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <ItemField label="Unidad base" value={unitLabel(unit)} />
        <ItemField label="Coste fijo" value={formatEur(item.fixedCost)} />
        <ItemField label="Coste computado" value={formatEur(item.computedCost)} />
      </div>
    </button>
  )
}

function ItemField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-sm tabular-nums text-text-primary truncate">{value}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal de SOLO creación. Campos mínimos: nombre + unidad base + coste fijo.
// Tras crear, devuelve el RecipeItem creado (onCreated) para que la página
// salte a su detalle. La edición/archivado ya NO viven aquí: están en el detalle.
// ─────────────────────────────────────────────────────────────────────

interface IngredientCreateModalProps {
  accountId: string
  units: KitchenUnit[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: (created: RecipeItem) => void
}

function IngredientCreateModal({
  accountId,
  units,
  actorId,
  actorName,
  onClose,
  onCreated,
}: IngredientCreateModalProps) {
  const [name, setName] = useState('')
  const [baseUnitId, setBaseUnitId] = useState<string>(units[0]?.id ?? '')
  const [fixedCost, setFixedCost] = useState<string>('')
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
    const costParsed = fixedCost.trim() === '' ? null : Number(fixedCost.replace(',', '.'))
    if (costParsed !== null && (Number.isNaN(costParsed) || costParsed < 0)) {
      setError('El coste fijo debe ser un número ≥ 0 (deja vacío si aún no lo sabes).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const created = await createRecipeItem({
        accountId,
        type: 'raw',
        name: trimmed,
        baseUnitId,
        costStrategy: 'fixed',
        fixedCost: costParsed,
        createdBy: actorId,
        createdByName: actorName,
      })
      onCreated(created)
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
      aria-labelledby="ingredient-create-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="ingredient-create-title" className="text-base font-medium text-text-primary">
            Nuevo ingrediente
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
              disabled={submitting}
              placeholder="Opcional. Ej: 0.012"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary mt-1">
              Déjalo vacío si aún no sabes el precio. Cuando añadas un proveedor, el coste se
              calculará solo desde la compra.
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
