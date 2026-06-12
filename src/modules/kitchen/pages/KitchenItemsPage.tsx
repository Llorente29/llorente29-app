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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Soup, X, AlertTriangle, ChevronRight, Search, Sparkles, Tag, FolderTree, BookMarked, Check, Loader2, Wand2 } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  listRecipeItems,
  createRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import { searchTemplates, type IngredientTemplate } from '@/modules/kitchen/services/ingredientTemplateService'
import { adoptFromTemplate } from '@/modules/kitchen/services/ingredientAdoptionService'
import { enrichIngredientsBulk, type BulkEnrichProgress, type BulkEnrichResult } from '@/modules/kitchen/services/recipeBulkEnrichService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import KitchenItemDetailPage from '@/modules/kitchen/pages/KitchenItemDetailPage'
import FamilyReviewPanel from '@/modules/kitchen/components/FamilyReviewPanel'
import FamilyManagerPanel from '@/modules/kitchen/components/FamilyManagerPanel'
import {
  listIngredientFamilies,
  getFamilyProposalSummary,
  type IngredientFamily,
  type ProposalSummary,
} from '@/modules/kitchen/services/ingredientFamilyService'
import type {
  RecipeItem,
  KitchenUnit,
} from '@/types/kitchen'

const NO_FAMILY_FILTER = '__all__'
const UNCLASSIFIED = '__unclassified__'

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

  // ── Completado masivo con IA (ingredientes pendientes) ──
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<BulkEnrichProgress | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkEnrichResult | null>(null)
  // Familias de ingrediente (para chip + filtro) y resumen de propuestas IA (banner).
  const [families, setFamilies] = useState<IngredientFamily[]>([])
  const [proposalSummary, setProposalSummary] = useState<ProposalSummary | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  // Buscador y filtro por familia (3d).
  const [search, setSearch] = useState('')
  const [familyFilter, setFamilyFilter] = useState<string>(NO_FAMILY_FILTER)

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
      listIngredientFamilies(activeAccountId),
      getFamilyProposalSummary(activeAccountId),
    ])
      .then(([rows, allUnits, fams, summary]) => {
        if (cancelled) return
        setItems(rows)
        setUnits(allUnits)
        setFamilies(fams)
        setProposalSummary(summary)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
        setItems([])
        setUnits([])
        setFamilies([])
        setProposalSummary(null)
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

  // Mapa familyId → nombre, para el chip de familia en cada fila.
  const familyNameById = useMemo(() => {
    const m = new Map<string, string>()
    families.forEach(f => m.set(f.id, f.name))
    return m
  }, [families])

  // Lista filtrada por buscador (nombre) y por familia (3d). En cliente: rápido.
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(item => {
      if (q !== '' && !item.name.toLowerCase().includes(q)) return false
      if (familyFilter === NO_FAMILY_FILTER) return true
      if (familyFilter === UNCLASSIFIED) return item.familyId === null
      return item.familyId === familyFilter
    })
  }, [items, search, familyFilter])

  function handleCreated(created: RecipeItem) {
    setCreateOpen(false)
    setReloadTick(t => t + 1)
    // Salto al detalle del ingrediente recién creado: la siguiente acción natural
    // es decirle a Folvy de quién se compra (y ver el coste fluir).
    setSelectedItemId(created.id)
  }

  // El buscador del modal puede resolver a un ingrediente que YA EXISTE en la
  // cuenta (adoptado antes o creado a mano): en ese caso no se crea nada, se
  // abre el existente. Anti-duplicado a nivel de UX.
  function handleOpenExisting(itemId: string) {
    setCreateOpen(false)
    setSelectedItemId(itemId)
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
  // Ingredientes pendientes (needs_review) — los que la IA puede completar.
  const pendingItems = useMemo(
    () => items.filter((it) => it.needsReview).map((it) => ({ id: it.id, name: it.name })),
    [items],
  )

  async function handleBulkEnrich() {
    if (!activeAccountId || pendingItems.length === 0 || bulkRunning) return
    setBulkRunning(true)
    setBulkResult(null)
    setBulkProgress({ done: 0, total: pendingItems.length, currentName: '', finishedCount: 0, retrying: false })
    try {
      const result = await enrichIngredientsBulk(activeAccountId, pendingItems, (p) =>
        setBulkProgress(p),
      )
      setBulkResult(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error en el completado masivo.')
    } finally {
      setBulkRunning(false)
      setReloadTick((t) => t + 1)
    }
  }

  function closeBulkModal() {
    setBulkProgress(null)
    setBulkResult(null)
  }

  return (
    <div className="space-y-4">
      {/* Modal de completado masivo con IA */}
      {(bulkProgress || bulkResult) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md p-6 border border-border-default">
            {bulkResult ? (
              <>
                <div className="flex items-center gap-2 text-text-primary mb-3">
                  <Sparkles className="w-5 h-5 text-terracota" />
                  <span className="text-base font-medium">Completado terminado</span>
                </div>
                <ul className="text-sm text-text-secondary space-y-1 mb-4">
                  <li>
                    <span className="font-medium text-text-primary">{bulkResult.finished}</span>{' '}
                    ingrediente{bulkResult.finished === 1 ? '' : 's'} terminado{bulkResult.finished === 1 ? '' : 's'} (familia + IVA).
                  </li>
                  {bulkResult.partial > 0 && (
                    <li>
                      {bulkResult.partial} siguen pendientes — la IA no encontró una familia fiable, o falta precio/proveedor real (eso lo completas tú).
                    </li>
                  )}
                  {bulkResult.failed > 0 && (
                    <li className="text-amber-600">
                      {bulkResult.failed} fallaron (reintenta el botón para esos).
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  onClick={closeBulkModal}
                  className="w-full px-3 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover transition-colors"
                >
                  Entendido
                </button>
              </>
            ) : bulkProgress ? (
              <div className="text-center py-4">
                <Loader2 className="w-8 h-8 animate-spin text-terracota mx-auto mb-3" />
                <p className="text-sm text-text-primary font-medium">
                  Completando con IA… {bulkProgress.done}/{bulkProgress.total}
                </p>
                {bulkProgress.currentName && (
                  <p className="text-xs text-text-secondary mt-1 truncate">
                    {bulkProgress.currentName}
                  </p>
                )}
                {bulkProgress.retrying && (
                  <p className="text-xs text-amber-600 mt-1">
                    Esperando un momento para no saturar el servicio…
                  </p>
                )}
                <div className="w-full bg-page rounded-full h-2 mt-3 overflow-hidden">
                  <div
                    className="bg-terracota h-2 transition-all"
                    style={{ width: `${bulkProgress.total > 0 ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-2">
                  No cierres esta ventana hasta que termine.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}

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
        <div className="flex items-center gap-2">
          {pendingItems.length > 0 && (
            <button
              type="button"
              onClick={handleBulkEnrich}
              disabled={!activeAccountId || bulkRunning}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover disabled:opacity-50 transition-colors"
              title="La IA completa familia, IVA, alérgenos y conservación de los ingredientes pendientes"
            >
              {bulkRunning ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              Completar {pendingItems.length} con IA
            </button>
          )}
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
      </div>

      {/* Banner: propuestas de familia generadas por IA, pendientes de aplicar */}
      {!loading && !error && proposalSummary && proposalSummary.total > 0 && (
        <div className="p-3 rounded-md bg-accent-bg border border-accent/20 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            <Sparkles size={18} className="text-accent shrink-0 mt-0.5" />
            <p className="text-sm text-text-primary">
              Folvy ha propuesto una familia para{' '}
              <span className="font-medium">{proposalSummary.total} ingredientes</span>
              {proposalSummary.auto > 0 && (
                <span className="text-text-secondary"> · {proposalSummary.auto} con alta confianza</span>
              )}
              {proposalSummary.review > 0 && (
                <span className="text-warning"> · {proposalSummary.review} para revisar</span>
              )}
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base shrink-0"
          >
            Revisar y aplicar
          </button>
        </div>
      )}

      {/* Buscador + filtro por familia (3d) */}
      {!loading && !error && items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[12rem]">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar ingrediente…"
              className="w-full pl-8 pr-2 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <select
            value={familyFilter}
            onChange={e => setFamilyFilter(e.target.value)}
            className="px-2 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value={NO_FAMILY_FILTER}>Todas las familias</option>
            <option value={UNCLASSIFIED}>Sin clasificar</option>
            {families.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border-default text-text-secondary hover:text-text-primary hover:bg-page transition-base shrink-0"
            title="Crear, renombrar o reordenar familias"
          >
            <FolderTree size={15} /> Familias
          </button>
        </div>
      )}

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
          {visibleItems.map(item => (
            <IngredientCard
              key={item.id}
              item={item}
              unit={unitsById.get(item.baseUnitId)}
              familyName={item.familyId ? familyNameById.get(item.familyId) ?? null : null}
              onSelect={() => setSelectedItemId(item.id)}
            />
          ))}
          <p className="px-1 pt-1 text-xs text-text-secondary">
            {visibleItems.length} de {items.length} ingrediente{items.length === 1 ? '' : 's'}
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
                    Familia
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
                {visibleItems.map(item => {
                  const unit = unitsById.get(item.baseUnitId)
                  const famName = item.familyId ? familyNameById.get(item.familyId) ?? null : null
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
                      <td className="p-3">
                        {famName ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-page border border-border-default text-text-secondary inline-flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            {famName}
                          </span>
                        ) : (
                          <span className="text-xs text-text-secondary/60">—</span>
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
            {visibleItems.length} de {items.length} ingrediente{items.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {/* Panel de revisión de familias propuestas por IA */}
      {reviewOpen && activeAccountId && (
        <FamilyReviewPanel
          accountId={activeAccountId}
          onClose={() => setReviewOpen(false)}
          onApplied={() => {
            setReviewOpen(false)
            setReloadTick(t => t + 1)
          }}
        />
      )}

      {/* Gestor de familias (crear/editar/archivar/reordenar) */}
      {managerOpen && activeAccountId && (
        <FamilyManagerPanel
          accountId={activeAccountId}
          onClose={() => setManagerOpen(false)}
          onChanged={() => {
            setManagerOpen(false)
            setReloadTick(t => t + 1)
          }}
        />
      )}

      {/* Modal de SOLO alta */}
      {createOpen && (
        <IngredientCreateModal
          accountId={activeAccountId!}
          units={units}
          existingItems={items}
          actorId={authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          onOpenExisting={handleOpenExisting}
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
  familyName,
  onSelect,
}: {
  item: RecipeItem
  unit: KitchenUnit | undefined
  familyName: string | null
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
            {familyName && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-page border border-border-default text-text-secondary inline-flex items-center gap-1">
                <Tag className="w-3 h-3" />
                {familyName}
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
  existingItems: RecipeItem[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: (created: RecipeItem) => void
  onOpenExisting: (itemId: string) => void
}

function IngredientCreateModal({
  accountId,
  units,
  existingItems,
  actorId,
  actorName,
  onClose,
  onCreated,
  onOpenExisting,
}: IngredientCreateModalProps) {
  const [name, setName] = useState('')
  const [baseUnitId, setBaseUnitId] = useState<string>(units[0]?.id ?? '')
  const [fixedCost, setFixedCost] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Buscador del MASTER (adopción al vuelo) ──
  // Al teclear el nombre, se busca en el catálogo global de Folvy. Cada
  // resultado se etiqueta y el cocinero puede ADOPTARLO (se materializa en su
  // cuenta) en vez de teclearlo desde cero. Si no elige nada, crea manual.
  const [templates, setTemplates] = useState<IngredientTemplate[]>([])
  const [searching, setSearching] = useState(false)
  const [adoptingCode, setAdoptingCode] = useState<string | null>(null)
  // Mapa nombre-normalizado → item existente de la cuenta (anti-duplicado UX).
  const existingByName = useMemo(() => {
    const m = new Map<string, RecipeItem>()
    existingItems.forEach(it => m.set(it.name.trim().toLowerCase(), it))
    return m
  }, [existingItems])

  // Debounce de la búsqueda en el master (no en cada tecla).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const q = name.trim()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setTemplates([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchTemplates(q, 8)
        setTemplates(results)
      } catch {
        setTemplates([])
      } finally {
        setSearching(false)
      }
    }, 280)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [name])

  // ¿El nombre tecleado coincide EXACTO con un ingrediente que ya tienes?
  const exactExisting = existingByName.get(name.trim().toLowerCase()) ?? null

  async function handleAdopt(tpl: IngredientTemplate) {
    setAdoptingCode(tpl.code)
    setError(null)
    try {
      const { item } = await adoptFromTemplate({
        templateId: tpl.id,
        accountId,
        actorId,
        actorName,
      })
      // Tanto si se materializó como si ya existía, abrimos su detalle.
      onCreated(item)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      setAdoptingCode(null)
    }
  }

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

            {/* Aviso anti-duplicado: el nombre coincide EXACTO con uno que ya tienes */}
            {exactExisting && (
              <button
                type="button"
                onClick={() => onOpenExisting(exactExisting.id)}
                className="mt-2 w-full text-left p-2 rounded-md bg-warning-bg border border-warning/30 text-xs text-text-primary hover:bg-warning-bg/70 transition-base flex items-center gap-2"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                <span>
                  Ya tienes <span className="font-medium">{exactExisting.name}</span>. Pulsa para abrirlo en vez de crear otro.
                </span>
              </button>
            )}

            {/* Sugerencias del catálogo Folvy (master) */}
            {!exactExisting && (searching || templates.length > 0) && (
              <div className="mt-2 rounded-md border border-border-default bg-card overflow-hidden">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-text-secondary bg-page border-b border-border-default flex items-center gap-1.5">
                  <BookMarked className="w-3 h-3" />
                  Catálogo Folvy
                  {searching && <span className="text-text-secondary/60">· buscando…</span>}
                </div>
                {templates.map(tpl => {
                  const existing = existingByName.get(tpl.nameEs.trim().toLowerCase())
                  const isAdopting = adoptingCode === tpl.code
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      disabled={isAdopting || submitting}
                      onClick={() => existing ? onOpenExisting(existing.id) : handleAdopt(tpl)}
                      className="w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-accent-bg transition-base border-b border-border-default last:border-0 disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="text-sm text-text-primary">{tpl.nameEs}</span>
                        {existing && (
                          <span className="ml-2 text-[11px] text-success inline-flex items-center gap-0.5">
                            <Check className="w-3 h-3" /> ya lo tienes
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-accent shrink-0">
                        {isAdopting ? 'Añadiendo…' : existing ? 'Abrir' : 'Usar'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-[11px] text-text-secondary mt-1">
              Si está en el catálogo Folvy, elígelo y se rellena solo. Si no, escríbelo y créalo abajo.
            </p>
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
