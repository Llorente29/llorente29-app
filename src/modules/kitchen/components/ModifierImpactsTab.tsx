// src/modules/kitchen/components/ModifierImpactsTab.tsx
//
// Solapa "Modificadores" del editor de escandallos (G3): define QUÉ le hace cada
// opción de modificador a la receta — añade / quita / sustituye un ingrediente, o
// multiplica la base. Eso enciende el coste real de los modificadores.
//
// Filosofía (no perder):
//  - El modificador es CAMBIO DE PREPARACIÓN, no de ingrediente crudo. El usuario ve
//    "SALE esto → ENTRA esto", nunca jerga técnica (add_item/replace_item…).
//  - El sistema APRENDE: lo confirmado no se vuelve a pedir. La pestaña muestra el
//    estado (conocidos · por revisar) y solo pide atención sobre lo pendiente.
//  - SIEMPRE un humano entre la IA y el coste: una propuesta no toca el coste hasta
//    que se confirma (el motor solo usa status='confirmed').
//
// Patrón calcado de RecipeStepsTab: tokens del codebase, lucide-react, estado local,
// confirmación inline, persistencia por acción. Recibe el recipe_item del plato.
//
// V1 de la pestaña: definir/confirmar/ajustar/rechazar el impacto. El "latido" de
// coste en vivo (preview sin guardar) se refuerza después con una función de preview
// server-side; aquí el coste real se actualiza tras confirmar (recomputeAffectedSales).

import { useEffect, useMemo, useState } from 'react'
import {
  SlidersHorizontal, Loader2, CircleCheck, Sparkles, Plus, Minus,
  RefreshCw, X, Pencil,
} from 'lucide-react'
import {
  listOptionsByRecipe,
  upsertImpact,
  confirmImpact,
  rejectImpact,
  recomputeAffectedSales,
  type OptionWithImpact,
  type ImpactType,
} from '@/modules/kitchen/services/modifierImpactService'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'

interface ModifierImpactsTabProps {
  recipeItemId: string
  accountId: string
  actorName: string
  // Catálogo para los selectores del modo "Ajustar": ingredientes (recipe_item raw/recipe)
  // y unidades. Los aporta el editor (ya los tiene cargados). Si no se pasan, el modo
  // ajustar muestra solo cantidad sobre el ingrediente ya propuesto.
  ingredients?: { id: string; name: string }[]
  units?: { id: string; label: string }[]
}

export default function ModifierImpactsTab({
  recipeItemId, accountId, actorName,
  ingredients: ingredientsProp, units: unitsProp,
}: ModifierImpactsTabProps) {
  const [options, setOptions] = useState<OptionWithImpact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Ingredientes y unidades para el editor "Ajustar". Si el contenedor no los
  // pasa, la pestaña los carga sola (autónoma, no depende del estado del editor).
  const [ingredients, setIngredients] = useState<{ id: string; name: string }[]>(ingredientsProp ?? [])
  const [units, setUnits] = useState<{ id: string; label: string }[]>(unitsProp ?? [])

  useEffect(() => {
    if (ingredientsProp && ingredientsProp.length > 0) { setIngredients(ingredientsProp); return }
    let cancelled = false
    listRecipeItems({ accountId, includeInactive: false })
      .then((rows) => {
        if (cancelled) return
        setIngredients(
          rows
            .filter((r) => r.type === 'raw' || r.type === 'recipe')
            .map((r) => ({ id: r.id, name: r.name })),
        )
      })
      .catch(() => { /* el selector quedará vacío; no bloquea la pestaña */ })
    return () => { cancelled = true }
  }, [accountId, ingredientsProp])

  useEffect(() => {
    if (unitsProp && unitsProp.length > 0) { setUnits(unitsProp); return }
    let cancelled = false
    listUnits({})
      .then((rows) => {
        if (cancelled) return
        setUnits(rows.map((u) => ({ id: u.id, label: u.abbreviation })))
      })
      .catch(() => { /* el selector de unidad quedará vacío; no bloquea */ })
    return () => { cancelled = true }
  }, [accountId, unitsProp])

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listOptionsByRecipe(recipeItemId, accountId)
      setOptions(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando los modificadores')
      setOptions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listOptionsByRecipe(recipeItemId, accountId)
      .then((rows) => { if (!cancelled) setOptions(rows) })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error cargando los modificadores')
          setOptions([])
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recipeItemId, accountId])

  // Cobertura: conocidos (confirmed) vs por revisar (resto).
  const coverage = useMemo(() => {
    const total = options.length
    const confirmed = options.filter((o) => o.impact?.status === 'confirmed').length
    return { total, confirmed, pending: total - confirmed,
      pct: total > 0 ? Math.round((confirmed / total) * 100) : 0 }
  }, [options])

  // Agrupar por grupo de modificador.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; min: number; max: number; opts: OptionWithImpact[] }>()
    for (const o of options) {
      const g = m.get(o.groupId) ?? { name: o.groupName, min: o.minSelections, max: o.maxSelections, opts: [] }
      g.opts.push(o)
      m.set(o.groupId, g)
    }
    return Array.from(m.values())
  }, [options])

  async function handleConfirm(o: OptionWithImpact) {
    if (!o.impact) return
    setBusyId(o.optionId)
    try {
      await confirmImpact(o.impact.id, actorName)
      await recomputeAffectedSales(accountId, o.optionId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(o: OptionWithImpact) {
    if (!o.impact) return
    setBusyId(o.optionId)
    try {
      await rejectImpact(o.impact.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar')
    } finally {
      setBusyId(null)
    }
  }

  // Guardar un impacto definido a mano (modo Ajustar) y confirmarlo.
  async function handleSaveManual(
    o: OptionWithImpact,
    draft: { impactType: ImpactType; targetRecipeItemId: string | null; quantity: number | null; unitId: string | null },
  ) {
    setBusyId(o.optionId)
    try {
      await upsertImpact({
        accountId,
        modifierOptionId: o.optionId,
        impactType: draft.impactType,
        targetRecipeItemId: draft.targetRecipeItemId,
        quantity: draft.quantity,
        unitId: draft.unitId,
        status: 'confirmed',
        source: 'human',
        actorName,
      })
      await recomputeAffectedSales(accountId, o.optionId)
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-5">
        <div className="text-sm text-text-secondary py-8 text-center">Cargando modificadores…</div>
      </div>
    )
  }

  if (options.length === 0) {
    return (
      <div className="p-4 md:p-5">
        <div className="rounded-lg border border-dashed border-border-default bg-card p-8 text-center">
          <p className="text-sm text-text-secondary">
            Este plato no tiene grupos de modificadores en su carta.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-5">
      {/* Cabecera + cobertura */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-4 h-4 text-terracota shrink-0" />
          <span className="text-sm font-medium text-text-primary">Modificadores</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-success">
            <CircleCheck className="w-3.5 h-3.5" />{coverage.confirmed} conocidos
          </span>
          {coverage.pending > 0 && (
            <span className="text-warning">{coverage.pending} por revisar</span>
          )}
          <span className="text-text-secondary">· {coverage.pct}% cobertura</span>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.name}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-text-secondary">{g.name}</span>
              <span className="text-[11px] text-text-secondary">
                {g.min === g.max ? `elige ${g.min}` : `elige ${g.min}–${g.max}`}
              </span>
            </div>
            <div className="space-y-2">
              {g.opts.map((o) => (
                <OptionCard
                  key={o.optionId}
                  option={o}
                  busy={busyId === o.optionId}
                  editing={editingId === o.optionId}
                  ingredients={ingredients}
                  units={units}
                  onConfirm={() => handleConfirm(o)}
                  onReject={() => handleReject(o)}
                  onEdit={() => setEditingId(o.optionId)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveManual={(draft) => handleSaveManual(o, draft)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tarjeta de una opción ────────────────────────────────────────────────

interface OptionCardProps {
  option: OptionWithImpact
  busy: boolean
  editing: boolean
  ingredients: { id: string; name: string }[]
  units: { id: string; label: string }[]
  onConfirm: () => void
  onReject: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveManual: (draft: { impactType: ImpactType; targetRecipeItemId: string | null; quantity: number | null; unitId: string | null }) => void
}

function OptionCard({
  option: o, busy, editing, ingredients, units,
  onConfirm, onReject, onEdit, onCancelEdit, onSaveManual,
}: OptionCardProps) {
  const status = o.impact?.status ?? 'none'
  const isProposed = status === 'proposed'
  const isConfirmed = status === 'confirmed'

  // Borde según estado: confirmado=verde sutil, propuesto=normal, sin impacto=punteado.
  const borderClass = isConfirmed
    ? 'border-success/40'
    : o.impact ? 'border-border-default' : 'border-dashed border-border-default'

  // Estado local del formulario de ajuste.
  const [draft, setDraft] = useState({
    impactType: (o.impact?.impactType ?? 'add_item') as ImpactType,
    targetRecipeItemId: o.impact?.targetRecipeItemId ?? null,
    quantity: o.impact?.quantity ?? null,
    unitId: o.impact?.unitId ?? null,
  })

  return (
    <div className={`rounded-lg border bg-card p-3 ${borderClass}`}>
      {/* Cabecera: nombre + suplemento + estado */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">{o.optionName}</span>
          {o.priceImpact > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-bg text-text-secondary shrink-0">
              +{o.priceImpact.toFixed(2)} €
            </span>
          )}
        </div>
        {isConfirmed && (
          <span className="inline-flex items-center gap-1 text-xs text-success shrink-0">
            <CircleCheck className="w-3.5 h-3.5" />Confirmado
          </span>
        )}
        {isProposed && (
          <span className="inline-flex items-center gap-1 text-xs text-warning shrink-0">
            <Sparkles className="w-3.5 h-3.5" />Propuesta IA
          </span>
        )}
      </div>

      {/* Propuesta IA: el porqué */}
      {isProposed && o.impact?.rationale && (
        <div className="flex gap-2 items-start mb-2 px-2.5 py-1.5 rounded-md bg-accent-bg">
          <Sparkles className="w-3.5 h-3.5 text-terracota mt-0.5 shrink-0" />
          <p className="text-xs text-text-secondary leading-relaxed">{o.impact.rationale}</p>
        </div>
      )}

      {!editing ? (
        <>
          {/* Diff: qué le hace al plato (sin jerga) */}
          <ImpactSummary impact={o.impact} ingredients={ingredients} />

          {/* Acciones */}
          <div className="flex items-center justify-end gap-2 mt-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin text-text-secondary" />}
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border-default text-text-primary hover:bg-accent-bg disabled:opacity-60 transition-base"
            >
              <Pencil className="w-3.5 h-3.5" />{o.impact ? 'Ajustar' : 'Definir'}
            </button>
            {isProposed && (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border-default text-text-secondary hover:text-danger disabled:opacity-60 transition-base"
                >
                  <X className="w-3.5 h-3.5" />Descartar
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-terracota text-white hover:bg-terracota-hover disabled:opacity-60 transition-base"
                >
                  <CircleCheck className="w-3.5 h-3.5" />Confirmar
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        /* Modo Ajustar: definir el impacto a mano */
        <ImpactEditor
          draft={draft}
          setDraft={setDraft}
          ingredients={ingredients}
          units={units}
          busy={busy}
          onCancel={onCancelEdit}
          onSave={() => onSaveManual(draft)}
        />
      )}
    </div>
  )
}

// Resumen legible del impacto (sin jerga técnica).
function ImpactSummary({
  impact, ingredients,
}: { impact: OptionWithImpact['impact']; ingredients: { id: string; name: string }[] }) {
  if (!impact) {
    return <p className="text-xs text-text-secondary italic">Sin definir — el coste de esta opción aún no se calcula.</p>
  }
  const ingName = (id: string | null) =>
    id ? (ingredients.find((i) => i.id === id)?.name ?? 'ingrediente') : 'ingrediente'

  if (impact.impactType === 'add_item' || impact.impactType === 'bundle') {
    return (
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/15 text-success text-xs">
          <Plus className="w-3 h-3" />{ingName(impact.targetRecipeItemId)}
          {impact.quantity != null && ` · ${impact.quantity}`}
        </span>
      </div>
    )
  }
  if (impact.impactType === 'remove_item') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-danger/15 text-danger text-xs">
        <Minus className="w-3 h-3" />{ingName(impact.targetRecipeItemId)}
        {impact.quantity != null && ` · ${impact.quantity}`}
      </span>
    )
  }
  if (impact.impactType === 'replace_item') {
    return (
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/15 text-success text-xs">
          <Plus className="w-3 h-3" />{ingName(impact.targetRecipeItemId)}
          {impact.quantity != null && ` · ${impact.quantity}`}
        </span>
        <span className="text-xs text-text-secondary">(sustituye al ingrediente base)</span>
      </div>
    )
  }
  if (impact.impactType === 'multiply') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-bg text-text-secondary text-xs">
        <RefreshCw className="w-3 h-3" />Multiplica la receta ×{impact.quantity ?? 1}
      </span>
    )
  }
  return <p className="text-xs text-text-secondary italic">Sin efecto en el coste.</p>
}

// Editor del impacto (modo Ajustar).
function ImpactEditor({
  draft, setDraft, ingredients, units, busy, onCancel, onSave,
}: {
  draft: { impactType: ImpactType; targetRecipeItemId: string | null; quantity: number | null; unitId: string | null }
  setDraft: (d: typeof draft) => void
  ingredients: { id: string; name: string }[]
  units: { id: string; label: string }[]
  busy: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const needsIngredient = draft.impactType !== 'multiply' && draft.impactType !== 'none'
  const needsQty = draft.impactType !== 'none'

  return (
    <div className="space-y-2.5 pt-1">
      {/* Qué hace (en lenguaje natural) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-secondary">Esta opción</span>
        <select
          value={draft.impactType}
          onChange={(e) => setDraft({ ...draft, impactType: e.target.value as ImpactType })}
          className="px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="add_item">añade</option>
          <option value="remove_item">quita</option>
          <option value="replace_item">cambia (sustituye)</option>
          <option value="multiply">multiplica el plato</option>
          <option value="none">no cambia nada</option>
        </select>
      </div>

      {needsIngredient && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={draft.targetRecipeItemId ?? ''}
            onChange={(e) => setDraft({ ...draft, targetRecipeItemId: e.target.value || null })}
            className="flex-1 min-w-[160px] px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— elige ingrediente —</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
      )}

      {needsQty && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min={0}
            step="any"
            value={draft.quantity ?? ''}
            onChange={(e) => setDraft({ ...draft, quantity: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder={draft.impactType === 'multiply' ? 'factor (ej. 2)' : 'cantidad'}
            className="w-28 px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {draft.impactType !== 'multiply' && (
            <select
              value={draft.unitId ?? ''}
              onChange={(e) => setDraft({ ...draft, unitId: e.target.value || null })}
              className="px-2 py-1 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">— unidad —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs text-text-secondary hover:text-text-primary transition-colors px-2 py-1"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || (needsIngredient && !draft.targetRecipeItemId)}
          className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-terracota text-white hover:bg-terracota-hover disabled:opacity-60 transition-base"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleCheck className="w-3.5 h-3.5" />}
          Guardar y confirmar
        </button>
      </div>
    </div>
  )
}
