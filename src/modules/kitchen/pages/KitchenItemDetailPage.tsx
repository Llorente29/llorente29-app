// src/modules/kitchen/pages/KitchenItemDetailPage.tsx
//
// Vista DETALLE de un ingrediente (recipe_item type='raw'). Patrón LISTA +
// DETALLE por estado, igual que RecipeEditorPage: recibe itemId + onBack, no usa
// react-router con params. La monta KitchenItemsPage cuando hay un id seleccionado.
//
// Es el HOGAR del ingrediente: básicos (nombre · unidad base · coste, editables
// inline) + la sección Compra/Proveedores, donde el coste pasa a fluir desde la
// compra. onChanged refresca el item desde BBDD para que el "Coste actual" se
// actualice ante los ojos del cocinero al añadir un proveedor (la prueba veraz de
// que el coste fluye, sin número inventado).
//
// Patrón de carga: getRecipeItemById + listUnits con flag cancelled, igual que
// las demás páginas kitchen.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Archive, Check, Loader2, Pencil, X } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import {
  getRecipeItemById,
  updateRecipeItem,
  archiveRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import PurchaseSourcesSection from '@/modules/kitchen/components/PurchaseSourcesSection'
import type { RecipeItem, KitchenUnit } from '@/types/kitchen'

function formatEur(value: number | null | undefined, maxDecimals = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  }).format(value)
}

// Coste EFECTIVO del raw, igual que el motor en BBDD: COALESCE(computed_cost,
// fixed_cost). Un raw en estrategia 'fixed' que nunca se recalculó tiene
// computed_cost = null pero fixed_cost válido; mostrar solo computed_cost haría
// que la ficha enseñara "—" mintiendo. Front y backend leen el coste igual.
function effectiveCost(item: RecipeItem): number | null {
  if (item.computedCost !== null && item.computedCost !== undefined) return item.computedCost
  if (item.fixedCost !== null && item.fixedCost !== undefined) return item.fixedCost
  return null
}

const DIM_LABEL: Record<string, string> = {
  weight: 'Peso',
  volume: 'Volumen',
  unit: 'Unidades',
}

interface KitchenItemDetailPageProps {
  itemId: string
  onBack: () => void
}

export default function KitchenItemDetailPage({ itemId, onBack }: KitchenItemDetailPageProps) {
  const { userProfile, authUserId } = useApp()

  const [item, setItem] = useState<RecipeItem | null>(null)
  const [units, setUnits] = useState<KitchenUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edición de básicos.
  const [editingBasics, setEditingBasics] = useState(false)
  const [name, setName] = useState('')
  const [baseUnitId, setBaseUnitId] = useState('')
  const [savingBasics, setSavingBasics] = useState(false)
  const [basicsError, setBasicsError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  const actorId = authUserId ?? null
  const actorName = userProfile?.displayName ?? null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getRecipeItemById(itemId), listUnits()])
      .then(([it, allUnits]) => {
        if (cancelled) return
        if (!it) {
          setError('Este ingrediente ya no existe.')
          setItem(null)
        } else {
          setItem(it)
        }
        setUnits(allUnits)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el ingrediente.')
        setItem(null)
        setUnits([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [itemId])

  // Refresco SOLO del item desde BBDD (tras un cambio de coste en la sección de
  // compras). No recarga unidades: no cambian aquí. Así el "Coste actual" se
  // actualiza ante los ojos del usuario.
  async function refreshItem() {
    try {
      const fresh = await getRecipeItemById(itemId)
      if (fresh) setItem(fresh)
    } catch (err: unknown) {
      console.error('KitchenItemDetailPage: refresco del item falló', err)
    }
  }

  const baseUnit = useMemo(
    () => (item ? units.find((u) => u.id === item.baseUnitId) ?? null : null),
    [units, item],
  )

  const unitsGrouped = useMemo(() => {
    const groups = new Map<string, KitchenUnit[]>()
    units.forEach((u) => {
      const list = groups.get(u.dimension) ?? []
      list.push(u)
      groups.set(u.dimension, list)
    })
    return groups
  }, [units])

  function openEditBasics() {
    if (!item) return
    setName(item.name)
    setBaseUnitId(item.baseUnitId)
    setBasicsError(null)
    setEditingBasics(true)
  }

  async function saveBasics() {
    if (!item) return
    const trimmed = name.trim()
    if (trimmed === '') {
      setBasicsError('El nombre es obligatorio.')
      return
    }
    if (!baseUnitId) {
      setBasicsError('Elige una unidad base.')
      return
    }
    setSavingBasics(true)
    setBasicsError(null)
    try {
      await updateRecipeItem(item.id, { name: trimmed, baseUnitId })
      setEditingBasics(false)
      await refreshItem()
    } catch (err: unknown) {
      setBasicsError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSavingBasics(false)
    }
  }

  async function handleArchive() {
    if (!item) return
    const ok = window.confirm(
      `¿Archivar "${item.name}"? Dejará de aparecer en el catálogo.`,
    )
    if (!ok) return
    setArchiving(true)
    try {
      await archiveRecipeItem(item.id)
      onBack()
    } catch (err: unknown) {
      setBasicsError(err instanceof Error ? err.message : 'No se pudo archivar.')
      setArchiving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
        >
          <ArrowLeft size={16} />
          Ingredientes
        </button>
      </div>

      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">Cargando ingrediente…</div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && item && (
        <>
          {/* Básicos */}
          <div className="rounded-lg border border-border-default bg-card">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default">
              <h2 className="text-lg font-display font-medium text-text-primary">
                {item.name}
              </h2>
              {!editingBasics && (
                <button
                  type="button"
                  onClick={openEditBasics}
                  className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-base"
                >
                  <Pencil size={14} />
                  Editar
                </button>
              )}
            </div>

            {!editingBasics ? (
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[11px] text-text-secondary">Unidad base</div>
                  <div className="text-text-primary">
                    {baseUnit ? `${baseUnit.name} (${baseUnit.abbreviation})` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-text-secondary">Coste actual</div>
                  <div className="text-text-primary font-mono">
                    {formatEur(effectiveCost(item))}
                    {baseUnit ? ` / ${baseUnit.abbreviation}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-text-secondary">Origen del coste</div>
                  <div className="text-text-primary">
                    {item.costStrategy === 'fixed' ? 'Tecleado a mano' : 'Desde la compra'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Nombre</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={savingBasics}
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Unidad base
                  </label>
                  <select
                    value={baseUnitId}
                    onChange={(e) => setBaseUnitId(e.target.value)}
                    disabled={savingBasics || units.length === 0}
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  >
                    {Array.from(unitsGrouped.entries()).map(([dim, list]) => (
                      <optgroup key={dim} label={DIM_LABEL[dim] ?? dim}>
                        {list.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.abbreviation})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-[11px] text-text-secondary mt-1">
                    Cambiar la unidad base afecta a cómo se interpretan las cantidades de compra y
                    receta. Cámbiala solo si estaba mal.
                  </p>
                </div>

                {basicsError && (
                  <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
                    {basicsError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingBasics(false)}
                    disabled={savingBasics}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
                  >
                    <X size={14} />
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={saveBasics}
                    disabled={savingBasics}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                  >
                    {savingBasics ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                    {savingBasics ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Compra / Proveedores */}
          <PurchaseSourcesSection
            item={item}
            units={units}
            actorId={actorId}
            actorName={actorName}
            onChanged={refreshItem}
          />

          {/* Archivar */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleArchive}
              disabled={archiving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-danger hover:bg-danger-bg transition-base disabled:opacity-50"
            >
              <Archive size={14} />
              {archiving ? 'Archivando…' : 'Archivar ingrediente'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
