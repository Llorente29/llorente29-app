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
//
// B72 (05/09/2026) — UN MODIFICADOR PUEDE SER UN PLATO.
// Este selector filtraba el catálogo a `raw`/`recipe` y dejaba fuera `dish`. Con eso:
//  - «¿Quieres acompañar con unas patatas?» no encontraba `Patatas Clásicas Meraki`
//    (existe, activa, 0,876 € de escandallo) y la única salida en pantalla era
//    «¿No está? Crear … como nuevo»: un clic a crear un duplicado vacío y sin coste.
//  - Y los 15 impactos `bundle` ya confirmados, que apuntan a platos, se pintaban
//    como «+ ingrediente · 1» — el nombre no se resolvía porque el plato no estaba
//    en la lista. Un dato correcto en la base, invisible en la pantalla.
// El arreglo es de FRONT y no toca el esquema: `bundle` existe desde el 05/06 y ya
// apunta al `recipe_item` del propio plato. Lo que faltaba era dejar llegar.
//
// Dos cosas van juntas y ninguna es cosmética:
//  1. Los platos aparecen.
//  2. Se distinguen a simple vista. Buscando «patatas» salen `Patatas Bastón`
//     (`raw`, 0,0022 €/g, la patata cruda a granel) y `Patatas Clásicas Meraki`
//     (`dish`, la ración). Elegir la primera con cantidad 1 da un coste absurdo y
//     nadie lo notaría. Sin etiqueta, cambiamos una confusión por otra.

import { useEffect, useMemo, useState } from 'react'
import {
  SlidersHorizontal, Loader2, CircleCheck, Sparkles, Plus, Minus,
  RefreshCw, X, Pencil, AlertTriangle, Search, Wand2, Package,
} from 'lucide-react'
import {
  listOptionsByRecipe,
  listProductBundleSuggestions,
  type ProductBundleSuggestion,
  upsertImpact,
  confirmImpact,
  rejectImpact,
  recomputeAffectedSales,
  requestAIProposals,
  previewImpactCost,
  type OptionWithImpact,
  type ImpactType,
  type ImpactCostPreview,
} from '@/modules/kitchen/services/modifierImpactService'
import { listRecipeItems, createRecipeItem } from '@/modules/kitchen/services/recipeItemService'
import type { RecipeItemType } from '@/types/kitchen'
import {
  TIPOS_ELEGIBLES, kindOf, normName, grupoPidePlato, ordenaCandidatas, razonNoElegible,
  type CatalogPick,
} from '@/modules/kitchen/lib/catalogPick'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'

interface ModifierImpactsTabProps {
  recipeItemId: string
  accountId: string
  actorName: string
  // Catálogo para los selectores del modo "Ajustar": fichas de cocina y unidades.
  // Los aporta el editor si ya los tiene cargados. Si no se pasan —hoy nadie los
  // pasa: CatalogFichaPage monta la pestaña sin ellos— la pestaña carga el catálogo
  // ella sola. `type` es opcional por compatibilidad; sin él la ficha se etiqueta
  // como ingrediente, que es lo que era esta lista antes de B72.
  ingredients?: { id: string; name: string; needsReview?: boolean; type?: RecipeItemType }[]
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
  // Sugerencia IA (Nivel 2): en curso + mensaje de resultado de la última pasada.
  const [aiRunning, setAiRunning] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  // Opciones que en realidad son un PRODUCTO ENTERO (no un ajuste): el nombre
  // casa con un único producto vivo de su marca. Se calcula en vivo, así que una
  // opción nueva que se llame igual que un producto aparece sugerida sola.
  const [bundleHints, setBundleHints] = useState<Map<string, ProductBundleSuggestion>>(new Map())

  // Catálogo de cocina y unidades para el editor "Ajustar". Si el contenedor no lo
  // pasa, la pestaña lo carga sola (autónoma, no depende del estado del editor).
  //
  // Se carga ENTERO a propósito, incluidas las fichas archivadas, desactivadas, de
  // envase y de utensilio. No es para ofrecerlas —`selectable` las deja fuera del
  // desplegable— es para poder decir «eso ya existe» antes de crear un duplicado.
  // Una sola llamada sirve a los dos usos.
  const [catalog, setCatalog] = useState<CatalogPick[]>(
    (ingredientsProp ?? []).map((i) => ({
      id: i.id, name: i.name, needsReview: i.needsReview,
      type: i.type ?? 'raw', kind: kindOf(i.type ?? 'raw'), selectable: true,
    })),
  )
  const [units, setUnits] = useState<{ id: string; label: string }[]>(unitsProp ?? [])
  const [unitGramId, setUnitGramId] = useState<string | null>(null)

  // Lo que el desplegable puede ofrecer: platos e ingredientes vivos.
  const pickable = useMemo(() => catalog.filter((c) => c.selectable), [catalog])

  async function loadCatalog() {
    try {
      const rows = await listRecipeItems({ accountId, includeArchived: true })
      setCatalog(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          needsReview: r.needsReview,
          type: r.type,
          kind: kindOf(r.type),
          selectable:
            TIPOS_ELEGIBLES.includes(r.type) && r.isActive === true && r.archivedAt == null,
        })),
      )
    } catch { /* el selector quedará vacío; no bloquea la pestaña */ }
  }

  useEffect(() => {
    if (ingredientsProp && ingredientsProp.length > 0) {
      setCatalog(ingredientsProp.map((i) => ({
        id: i.id, name: i.name, needsReview: i.needsReview,
        type: i.type ?? 'raw', kind: kindOf(i.type ?? 'raw'), selectable: true,
      })))
      return
    }
    let cancelled = false
    loadCatalog().finally(() => { if (cancelled) return })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, ingredientsProp])

  useEffect(() => {
    let cancelled = false
    listUnits({})
      .then((rows) => {
        if (cancelled) return
        if (!unitsProp || unitsProp.length === 0) {
          setUnits(rows.map((u) => ({ id: u.id, label: u.abbreviation })))
        }
        // Unidad gramo, para crear ingredientes al vuelo (base por defecto).
        const g = rows.find((u) => u.abbreviation?.toLowerCase() === 'g')
        if (g) setUnitGramId(g.id)
      })
      .catch(() => { /* el selector de unidad quedará vacío; no bloquea */ })
    return () => { cancelled = true }
  }, [accountId, unitsProp])

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [rows, hints] = await Promise.all([
        listOptionsByRecipe(recipeItemId, accountId),
        listProductBundleSuggestions(accountId).catch(() => new Map<string, ProductBundleSuggestion>()),
      ])
      setOptions(rows)
      setBundleHints(hints)
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
    listProductBundleSuggestions(accountId)
      .then((hints) => { if (!cancelled) setBundleHints(hints) })
      .catch(() => { /* la sugerencia es una ayuda, no bloquea la pestaña */ })
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

  // "Es un producto entero": un clic. Impacto `bundle` apuntando al escandallo
  // del producto, cantidad 1 en su unidad base — el motor lo explota como si el
  // producto se hubiera vendido suelto. No hay cantidad que teclear ni promedio
  // que inventar: es una unidad de ese plato.
  async function handleAcceptBundle(o: OptionWithImpact, hint: ProductBundleSuggestion) {
    setBusyId(o.optionId)
    try {
      await upsertImpact({
        accountId,
        modifierOptionId: o.optionId,
        impactType: 'bundle',
        targetRecipeItemId: hint.targetRecipeItemId,
        quantity: 1,
        unitId: null,
        status: 'confirmed',
        source: 'human',
        actorName,
      })
      await recomputeAffectedSales(accountId, o.optionId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
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

  // Crea un ingrediente al vuelo (modo Ajustar, cuando el que falta no existe).
  // Nace SIN coste y marcado needs_review: queda DECLARADAMENTE incompleto y el
  // aviso se propaga a su ficha, a las listas y al plato por el sistema que ya
  // existe (getDishesIncomplete). Devuelve el id creado, o null si falla.
  async function handleCreateIngredient(name: string): Promise<{ id: string; name: string } | null> {
    if (!unitGramId) {
      setError('No se pudo crear: falta la unidad base (gramo). Revisa las unidades de cocina.')
      return null
    }
    try {
      const created = await createRecipeItem({
        accountId,
        type: 'raw',
        name: name.trim(),
        baseUnitId: unitGramId,
        source: 'manual',
        needsReview: true,
        createdByName: actorName,
      })
      await loadCatalog()
      return { id: created.id, name: created.name }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el ingrediente')
      return null
    }
  }

  // Pide a la IA que proponga impactos para las opciones sin definir de este plato.
  async function handleSuggestAI() {
    setAiRunning(true)
    setAiResult(null)
    setError(null)
    try {
      const r = await requestAIProposals(accountId, recipeItemId)
      const nuevas = r.propuestos + r.aprendidos
      if (nuevas === 0) {
        setAiResult('La IA no encontró nada claro que proponer. Define los que falten a mano.')
      } else {
        setAiResult(`La IA propuso ${nuevas} ${nuevas === 1 ? 'modificador' : 'modificadores'}. Revísalos y confirma.`)
      }
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo pedir propuestas a la IA')
    } finally {
      setAiRunning(false)
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

      {/* Sugerir con IA: solo si hay algo por revisar (si todo confirmado, no aporta). */}
      {coverage.pending > 0 && (
        <button
          type="button"
          onClick={handleSuggestAI}
          disabled={aiRunning}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 mb-3 rounded-md border border-border-default text-terracota hover:bg-terracota-bg disabled:opacity-60 transition-base"
        >
          {aiRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          {aiRunning ? 'Folvy está pensando…' : 'Sugerir con IA'}
        </button>
      )}

      {aiResult && (
        <div className="mb-3 flex items-start gap-2 text-xs text-text-secondary bg-accent-bg rounded-md px-3 py-2">
          <Sparkles className="w-3.5 h-3.5 text-terracota mt-0.5 shrink-0" />
          <span>{aiResult}</span>
        </div>
      )}

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
                  recipeItemId={recipeItemId}
                  busy={busyId === o.optionId}
                  editing={editingId === o.optionId}
                  catalog={catalog}
                  pickable={pickable}
                  units={units}
                  onConfirm={() => handleConfirm(o)}
                  onReject={() => handleReject(o)}
                  onEdit={() => setEditingId(o.optionId)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveManual={(draft) => handleSaveManual(o, draft)}
                  onCreateIngredient={handleCreateIngredient}
                  bundleHint={bundleHints.get(o.optionId) ?? null}
                  onAcceptBundle={(hint) => handleAcceptBundle(o, hint)}
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
  recipeItemId: string
  busy: boolean
  editing: boolean
  /** Catálogo COMPLETO: sirve para resolver nombres y para no crear duplicados. */
  catalog: CatalogPick[]
  /** Lo que el desplegable puede ofrecer: platos e ingredientes vivos. */
  pickable: CatalogPick[]
  units: { id: string; label: string }[]
  onConfirm: () => void
  onReject: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveManual: (draft: { impactType: ImpactType; targetRecipeItemId: string | null; quantity: number | null; unitId: string | null }) => void
  /** Esta opción parece un producto entero de la carta. null = no lo parece. */
  bundleHint: ProductBundleSuggestion | null
  onAcceptBundle: (hint: ProductBundleSuggestion) => void
  onCreateIngredient: (name: string) => Promise<{ id: string; name: string } | null>
}

function OptionCard({
  option: o, recipeItemId, busy, editing, catalog, pickable, units,
  onConfirm, onReject, onEdit, onCancelEdit, onSaveManual, onCreateIngredient,
  bundleHint, onAcceptBundle,
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

      {/* Esta opción es un PRODUCTO ENTERO, no un ajuste. Un modificador normal
          cambia la preparación; éste mete un plato completo. Sin esto no
          descuenta nada: los componentes de los combos llegan de Last como
          `modifier`, no como `combo_item`. Un clic, sin cantidad que teclear:
          es una unidad de ese plato. */}
      {bundleHint && !o.impact && !editing && (
        <div className="flex gap-2 items-start mb-2 px-2.5 py-2 rounded-md border border-accent/30 bg-accent-bg">
          <Package className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-primary leading-relaxed">
              Esto no parece un ajuste, parece un plato entero:{' '}
              <span className="font-medium">{bundleHint.targetName}</span>
              {bundleHint.brandName && <span className="text-text-secondary"> · {bundleHint.brandName}</span>}.
              {' '}Si lo es, descuenta una unidad de su escandallo.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAcceptBundle(bundleHint)}
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              Sí, es un plato entero
            </button>
          </div>
        </div>
      )}

      {!editing ? (
        <>
          {/* Diff: qué le hace al plato (sin jerga) */}
          <ImpactSummary impact={o.impact} catalog={catalog} />

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
          recipeItemId={recipeItemId}
          catalog={catalog}
          pickable={pickable}
          groupName={o.groupName}
          units={units}
          busy={busy}
          onCancel={onCancelEdit}
          onSave={() => onSaveManual(draft)}
          onCreateIngredient={onCreateIngredient}
        />
      )}
    </div>
  )
}

/**
 * Etiqueta de tipo de ficha. La mitad del arreglo de B72 vive aquí.
 *
 * Buscando «patatas» salen `Patatas Bastón` (la patata cruda a granel, 0,0022 €
 * el gramo) y `Patatas Clásicas Meraki` (la ración terminada). Sin etiqueta las
 * dos son «patatas»: elegir la primera con cantidad 1 da un coste de 0,002 € y
 * nadie lo notaría. Con etiqueta, la pregunta se responde sola.
 *
 * En lenguaje de cocina y sin jerga: «plato» y «ingrediente», nunca `dish`/`raw`.
 */
function KindChip({ kind }: { kind: 'plato' | 'ingrediente' }) {
  const esPlato = kind === 'plato'
  return (
    <span
      className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
        esPlato ? 'bg-terracota-bg text-terracota' : 'bg-stone-100 text-stone-500'
      }`}
    >
      {esPlato ? 'plato' : 'ingrediente'}
    </span>
  )
}

// Resumen legible del impacto (sin jerga técnica).
function ImpactSummary({
  impact, catalog,
}: { impact: OptionWithImpact['impact']; catalog: CatalogPick[] }) {
  if (!impact) {
    return <p className="text-xs text-text-secondary italic">Sin definir — el coste de esta opción aún no se calcula.</p>
  }
  // Se busca en el catálogo COMPLETO: los 15 impactos `bundle` confirmados apuntan
  // a un plato, y hasta B72 esta lista no los tenía — se pintaban «+ ingrediente».
  const ing = (id: string | null) => (id ? catalog.find((i) => i.id === id) : undefined)
  const ingName = (id: string | null) => ing(id)?.name ?? 'ficha no encontrada'
  const incomplete = (id: string | null) => !!ing(id)?.needsReview

  // Etiqueta plato/ingrediente junto al nombre: lo mismo que se ve al elegirlo.
  const kindChip = (id: string | null) => {
    const k = ing(id)?.kind
    if (!k) return null
    return <KindChip kind={k} />
  }

  // Aviso si el ingrediente del impacto está sin terminar (creado al vuelo sin coste).
  const warn = (id: string | null) =>
    incomplete(id) ? (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <AlertTriangle className="w-3 h-3" />sin terminar — su coste aún no cuenta
      </span>
    ) : null

  if (impact.impactType === 'add_item' || impact.impactType === 'bundle') {
    return (
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/15 text-success text-xs">
          <Plus className="w-3 h-3" />{ingName(impact.targetRecipeItemId)}
          {impact.quantity != null && ` · ${impact.quantity}`}
        </span>
        {kindChip(impact.targetRecipeItemId)}
        {warn(impact.targetRecipeItemId)}
      </div>
    )
  }
  if (impact.impactType === 'remove_item') {
    return (
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-danger/15 text-danger text-xs">
          <Minus className="w-3 h-3" />{ingName(impact.targetRecipeItemId)}
          {impact.quantity != null && ` · ${impact.quantity}`}
        </span>
        {kindChip(impact.targetRecipeItemId)}
        {warn(impact.targetRecipeItemId)}
      </div>
    )
  }
  if (impact.impactType === 'replace_item') {
    return (
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/15 text-success text-xs">
          <Plus className="w-3 h-3" />{ingName(impact.targetRecipeItemId)}
          {impact.quantity != null && ` · ${impact.quantity}`}
        </span>
        {kindChip(impact.targetRecipeItemId)}
        <span className="text-xs text-text-secondary">(sustituye al ingrediente base)</span>
        {warn(impact.targetRecipeItemId)}
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
  draft, setDraft, recipeItemId, catalog, pickable, groupName, units, busy, onCancel, onSave, onCreateIngredient,
}: {
  draft: { impactType: ImpactType; targetRecipeItemId: string | null; quantity: number | null; unitId: string | null }
  setDraft: (d: typeof draft) => void
  recipeItemId: string
  /** Catálogo COMPLETO, para la guarda anti-duplicado del «Crear como nuevo». */
  catalog: CatalogPick[]
  /** Lo que se puede elegir: platos e ingredientes vivos. */
  pickable: CatalogPick[]
  /** Nombre del grupo de modificadores: decide si los platos van primero. */
  groupName: string
  units: { id: string; label: string }[]
  busy: boolean
  onCancel: () => void
  onSave: () => void
  onCreateIngredient: (name: string) => Promise<{ id: string; name: string } | null>
}) {
  const needsIngredient = draft.impactType !== 'multiply' && draft.impactType !== 'none'
  const needsQty = draft.impactType !== 'none'

  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const picked = catalog.find((i) => i.id === draft.targetRecipeItemId)

  // ── Latido de coste en vivo ──
  // Al cambiar el draft, pide el preview server-side (misma lógica que el guardado).
  // Debounce 350ms para no llamar en cada tecla. Server-side = coincide con lo que
  // se guardará al confirmar (no calculamos coste en el cliente).
  const [preview, setPreview] = useState<ImpactCostPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    // Solo tiene sentido si el impacto está "completo" para calcular.
    const ready =
      (draft.impactType === 'multiply' && draft.quantity != null) ||
      (draft.impactType === 'none') ||
      (needsIngredient && draft.targetRecipeItemId != null && draft.quantity != null)
    if (!ready) { setPreview(null); return }

    let cancelled = false
    setPreviewing(true)
    const t = setTimeout(() => {
      previewImpactCost({
        recipeItemId,
        impactType: draft.impactType,
        targetRecipeItemId: draft.targetRecipeItemId,
        quantity: draft.quantity,
        unitId: draft.unitId,
      })
        .then((p) => { if (!cancelled) setPreview(p) })
        .catch(() => { if (!cancelled) setPreview(null) })
        .finally(() => { if (!cancelled) setPreviewing(false) })
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [recipeItemId, draft.impactType, draft.targetRecipeItemId, draft.quantity, draft.unitId, needsIngredient])

  async function handleCreate() {
    if (search.trim() === '') return
    // Doble llave: la pantalla ya no ofrece el botón cuando el nombre existe, pero
    // la comprobación va también aquí. Lo que no puede pasar es crear el duplicado.
    if (yaExiste) return
    setCreating(true)
    const created = await onCreateIngredient(search.trim())
    setCreating(false)
    if (created) {
      setDraft({ ...draft, targetRecipeItemId: created.id })
      setSearch('')
    }
  }

  // ── Qué se ofrece, y en qué orden ──
  //
  // El orden depende de qué está preguntando el grupo: si pregunta por un plato
  // («¿Quieres acompañar con unas patatas?»), los platos van primero; si pregunta
  // por un ajuste («Extra Salsa»), los ingredientes. Es SOLO orden: las dos clases
  // salen siempre (regla 7 — un umbral ordena y etiqueta, nunca decide qué existe).
  const platosPrimero = grupoPidePlato(groupName)

  const todosLosQueCasan = useMemo(
    () => ordenaCandidatas(pickable, search, platosPrimero),
    [pickable, search, platosPrimero],
  )

  const TOPE = 8
  const matches = todosLosQueCasan.slice(0, TOPE)
  // Cuántos quedan fuera del tope. Se DICE (regla 7): una lista que recorta en
  // silencio enseña que «no está» significa «no lo he mirado bien».
  const ocultos = todosLosQueCasan.length - matches.length

  // ── La guarda del «Crear como nuevo» ──
  //
  // Se compara contra el catálogo ENTERO, no contra lo que el desplegable enseña.
  // Ésa es justo la trampa que se está cerrando: cuando el filtro escondía la
  // ficha, esta comprobación decía «no existe» y ofrecía crear un duplicado vacío
  // y sin coste de algo que ya estaba. Con la lista completa no puede mentir, ni
  // siquiera con un envase, un utensilio o una ficha archivada.
  const yaExiste = search.trim() === ''
    ? undefined
    : catalog.find((i) => normName(i.name) === normName(search))

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
        <div>
          {picked ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent-bg text-sm text-text-primary">
                {picked.name}
                <KindChip kind={picked.kind} />
                {picked.needsReview && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-warning">
                    <AlertTriangle className="w-3 h-3" />sin terminar
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, targetRecipeItemId: null })}
                  className="text-text-secondary hover:text-danger"
                  aria-label="Quitar ingrediente"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 px-2 py-1 border border-border-default rounded-md bg-card">
                <Search className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={platosPrimero ? 'busca el plato o el ingrediente…' : 'busca el ingrediente o el plato…'}
                  className="flex-1 min-w-0 text-sm bg-transparent text-text-primary focus:outline-none"
                />
              </div>
              {(matches.length > 0 || search.trim() !== '') && (
                <div className="mt-1 border border-border-default rounded-md bg-card divide-y divide-border-default max-h-48 overflow-auto">
                  {matches.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => { setDraft({ ...draft, targetRecipeItemId: i.id }); setSearch('') }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent-bg transition-colors"
                    >
                      <span className="truncate">{i.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {i.needsReview && <AlertTriangle className="w-3 h-3 text-warning" />}
                        <KindChip kind={i.kind} />
                      </span>
                    </button>
                  ))}
                  {ocultos > 0 && (
                    <p className="px-2.5 py-1.5 text-[11px] text-text-secondary">
                      Y {ocultos} {ocultos === 1 ? 'ficha más' : 'fichas más'} que también
                      {' '}casan. Escribe un poco más para verlas.
                    </p>
                  )}
                  {/* Ya existe y se puede elegir: se ofrece la que hay, no se crea otra. */}
                  {yaExiste && yaExiste.selectable && (
                    <button
                      type="button"
                      onClick={() => { setDraft({ ...draft, targetRecipeItemId: yaExiste.id }); setSearch('') }}
                      className="w-full flex items-start gap-1.5 px-2.5 py-1.5 text-left text-xs font-medium text-success hover:bg-success/10 transition-colors"
                    >
                      <CircleCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>
                        «{yaExiste.name}» ya existe como {yaExiste.kind}. Usa ésta.
                      </span>
                    </button>
                  )}

                  {/* Ya existe pero no es elegible (envase, utensilio, ficha retirada):
                      tampoco se crea a ciegas — se dice por qué y quién es. */}
                  {yaExiste && !yaExiste.selectable && (
                    <p className="flex items-start gap-1.5 px-2.5 py-1.5 text-xs text-warning">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>
                        «{yaExiste.name}» ya existe en cocina{razonNoElegible(yaExiste)}, así que
                        {' '}no se crea otra igual. Si de verdad hace falta aquí, arregla esa ficha.
                      </span>
                    </p>
                  )}

                  {/* No existe con ese nombre en ningún sitio: crear es legítimo. */}
                  {search.trim() !== '' && !yaExiste && (
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={creating}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-xs font-medium text-terracota hover:bg-terracota-bg disabled:opacity-60 transition-colors"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      ¿No está? Crear «{search.trim()}» como ingrediente nuevo
                    </button>
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-text-secondary">
                Si lo creas aquí, nace sin coste y marcado «sin terminar» hasta que completes su ficha.
              </p>
            </div>
          )}
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

      {/* Latido: coste en vivo (server-side, coincide con lo que se guardará) */}
      {preview && preview.totalCost != null && (
        <div className="flex items-center gap-2 flex-wrap text-sm px-2.5 py-2 rounded-md bg-accent text-white">
          <span className="text-[11px] uppercase tracking-wide text-white/60">Coste del plato</span>
          {preview.baseCost != null && (
            <span className="font-mono text-white/70">
              {preview.baseCost.toFixed(2)} €
            </span>
          )}
          {preview.delta != null && preview.delta !== 0 && (
            <>
              <span className="text-white/50">{preview.delta > 0 ? '+' : '−'}</span>
              <span className="font-mono text-white/70">{Math.abs(preview.delta).toFixed(2)} €</span>
              <span className="text-white/40">=</span>
            </>
          )}
          <span className="font-mono font-medium text-[16px] text-white">
            {preview.totalCost.toFixed(2)} €
          </span>
          {previewing && <Loader2 className="w-3 h-3 animate-spin text-white/50" />}
        </div>
      )}
      {preview && preview.totalCost == null && (
        <div className="flex items-center gap-1.5 text-xs text-warning px-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          El plato o el ingrediente no tienen coste todavía — no puedo calcular el latido.
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
