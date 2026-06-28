// src/modules/kitchen/components/RecipeImportReviewModal.tsx
//
// B2 — Pantalla de revisión anti-duplicados al importar un escandallo por ficha.
// Sale como ventana SOBRE la pantalla principal (overlay). Por cada ingrediente
// leído de la ficha muestra:
//   · TODOS los similares de la despensa (run_mapping) con su coste → elegir uno.
//   · Buscador libre (si el bueno no salió en los similares) → garantiza 0% dup.
//   · "Crear nuevo" apartado (última opción, a propósito con un paso extra).
// No se puede "Terminar" hasta resolver TODAS las líneas (existente o nuevo
// deliberado). Al terminar, escribe la decisión en cada mapping_proposal y
// materializa: la RPC respeta chosen_target_id y NO duplica.
//
// Preselección (a) UMBRAL ALTO: si el mejor candidato supera PRESELECT_CONFIDENCE
// la línea nace resuelta a ese existente (verde); por debajo, sin preselección
// (el humano elige a mano). El umbral es una constante visible y ajustable.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Check, Plus, Search, X, Loader2, AlertTriangle, Info } from 'lucide-react'
import {
  findIngredientMatches,
  resolveImportProposal,
  materializeRecipeSession,
  type ParsedRecipeLine,
  type ImportMatchCandidate,
  type ImportRecipeResult,
} from '@/modules/kitchen/services/recipeImportService'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'

// ── Umbral de preselección (a — umbral alto). Por encima de este parecido, el
// mejor candidato se preselecciona; por debajo, la línea obliga a elegir. Subir
// = más exigente (menos preselección automática). Bajar = más cómodo, más riesgo.
const PRESELECT_CONFIDENCE = 0.85

// Cuántos similares pedimos a run_mapping por línea (umbral bajo, límite alto:
// queremos VER el gemelo aunque el parecido de letras sea flojo).
const MATCH_LIMIT = 6
const MATCH_FUZZY_MIN = 0.2

interface CostInfo {
  cost: number | null
  unitAbbr: string | null
}

// Estado de la decisión de una línea.
type LineDecision =
  | { kind: 'unresolved' }
  | { kind: 'existing'; targetId: string }
  | { kind: 'new' }

interface LineState {
  line: ParsedRecipeLine
  candidates: ImportMatchCandidate[]
  loading: boolean
  decision: LineDecision
  pickerOpen: boolean
  search: string
  searchResults: ImportMatchCandidate[]
  searching: boolean
}

export interface RecipeImportReviewModalProps {
  accountId: string
  sessionId: string
  dishName: string
  lines: ParsedRecipeLine[]
  onCancel: () => void
  onCompleted: (result: ImportRecipeResult) => void
}

export default function RecipeImportReviewModal({
  accountId,
  sessionId,
  dishName,
  lines,
  onCancel,
  onCompleted,
}: RecipeImportReviewModalProps) {
  // Mapa de coste por recipe_item_id (raws + recetas) para pintar "€/g".
  const [costById, setCostById] = useState<Map<string, CostInfo>>(new Map())
  const [rows, setRows] = useState<LineState[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resuelve coste + unidad de un candidato (para mostrar "0,0035 €/g").
  const costOf = useCallback(
    (id: string): CostInfo => costById.get(id) ?? { cost: null, unitAbbr: null },
    [costById],
  )

  // ── Carga inicial: mapa de costes + unidades + candidatos por línea ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingData(true)
      setError(null)
      try {
        const [raws, recipes, unitList] = await Promise.all([
          listRecipeItems({ accountId, type: 'raw' }),
          listRecipeItems({ accountId, type: 'recipe' }),
          listUnits({}),
        ])
        if (cancelled) return
        const map = new Map<string, CostInfo>()
        const unitMap = new Map<string, string>()
        for (const u of unitList) unitMap.set(u.id, u.abbreviation)
        for (const it of [...raws, ...recipes]) {
          map.set(it.id, {
            cost: it.fixedCost ?? it.computedCost ?? null,
            unitAbbr: unitMap.get(it.baseUnitId) ?? null,
          })
        }
        setCostById(map)

        // Candidatos por línea (en paralelo).
        const built = await Promise.all(
          lines.map(async (line): Promise<LineState> => {
            let candidates: ImportMatchCandidate[] = []
            try {
              candidates = await findIngredientMatches(
                accountId,
                line.rawText,
                MATCH_LIMIT,
                MATCH_FUZZY_MIN,
              )
            } catch {
              candidates = []
            }
            // (a) umbral alto: preseleccionar el mejor si supera el umbral.
            const best = candidates[0]
            const preselect = best && best.confidence >= PRESELECT_CONFIDENCE
            return {
              line,
              candidates,
              loading: false,
              decision: preselect
                ? { kind: 'existing', targetId: best.recipeItemId }
                : { kind: 'unresolved' },
              pickerOpen: !preselect,
              search: '',
              searchResults: [],
              searching: false,
            }
          }),
        )
        if (!cancelled) setRows(built)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudieron cargar los ingredientes.')
        }
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [accountId, lines])

  const resolvedCount = useMemo(
    () => rows.filter((r) => r.decision.kind !== 'unresolved').length,
    [rows],
  )
  const allResolved = rows.length > 0 && resolvedCount === rows.length

  function patchRow(idx: number, patch: Partial<LineState>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  // Formatea "0,0035 €/g" (coma decimal). Sin coste → "sin coste".
  function fmtCost(info: CostInfo): string {
    if (info.cost == null) return 'sin coste'
    const n = info.cost.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
    return info.unitAbbr ? `${n} €/${info.unitAbbr}` : `${n} €`
  }

  function chooseExisting(idx: number, candidate: ImportMatchCandidate) {
    patchRow(idx, {
      decision: { kind: 'existing', targetId: candidate.recipeItemId },
      pickerOpen: false,
    })
  }

  function chooseNew(idx: number) {
    patchRow(idx, { decision: { kind: 'new' }, pickerOpen: false })
  }

  function openPicker(idx: number) {
    patchRow(idx, { pickerOpen: true })
  }

  // Búsqueda libre dentro del picker (run_mapping con el texto tecleado).
  async function runSearch(idx: number, text: string) {
    patchRow(idx, { search: text })
    if (text.trim().length < 2) {
      patchRow(idx, { searchResults: [], searching: false })
      return
    }
    patchRow(idx, { searching: true })
    try {
      const res = await findIngredientMatches(accountId, text.trim(), MATCH_LIMIT, MATCH_FUZZY_MIN)
      patchRow(idx, { searchResults: res, searching: false })
    } catch {
      patchRow(idx, { searchResults: [], searching: false })
    }
  }

  // Nombre del candidato elegido (para el resumen verde).
  function nameOf(id: string): string {
    for (const r of rows) {
      const c = r.candidates.find((x) => x.recipeItemId === id) ?? r.searchResults.find((x) => x.recipeItemId === id)
      if (c) return c.name
    }
    return 'ingrediente'
  }

  async function handleFinish() {
    if (!allResolved || finishing) return
    setFinishing(true)
    setError(null)
    try {
      for (const r of rows) {
        const targetId = r.decision.kind === 'existing' ? r.decision.targetId : null
        await resolveImportProposal(accountId, sessionId, r.line.normalized, targetId)
      }
      const result = await materializeRecipeSession(sessionId, rows.length)
      onCompleted(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el escandallo.')
      setFinishing(false)
    }
  }

  function fmtQty(line: ParsedRecipeLine): string {
    if (line.quantity == null) return line.unit ?? ''
    const q = line.quantity.toLocaleString('es-ES', { maximumFractionDigits: 3 })
    return line.unit ? `${q} ${line.unit}` : q
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-xl w-full max-w-2xl max-h-[88vh] flex flex-col border border-border-default overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-border-default flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-text-primary">Revisar receta importada</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              {dishName} · {lines.length} ingrediente{lines.length === 1 ? '' : 's'} leído{lines.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Banner informativo */}
        <div className="px-5 py-2.5 bg-blue-50 border-b border-border-default flex items-center gap-2 text-sm text-blue-700">
          <Info className="w-4 h-4 flex-shrink-0" />
          Antes de guardar: dime cuál es cada ingrediente. Reutilizar tu artículo evita duplicados y trae su coste.
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto">
          {loadingData ? (
            <div className="py-12 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-terracota mx-auto mb-3" />
              <p className="text-sm text-text-secondary">Buscando similares en tu despensa…</p>
            </div>
          ) : (
            rows.map((r, idx) => {
              const resolvedExisting = r.decision.kind === 'existing'
              const isNew = r.decision.kind === 'new'
              const collapsed = !r.pickerOpen && (resolvedExisting || isNew)

              return (
                <div key={r.line.normalized} className="px-5 py-3.5 border-b border-border-default">
                  {collapsed ? (
                    /* ── Resuelto (colapsado): existente=verde, nuevo=ámbar ── */
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[15px] font-medium text-text-primary">
                          {r.line.rawText}{' '}
                          <span className="text-sm text-text-secondary font-normal">· {fmtQty(r.line)}</span>
                        </div>
                        {resolvedExisting && (
                          <div className="text-sm text-success mt-1 flex items-center gap-1.5">
                            <Check className="w-4 h-4" />
                            Usando <span className="font-medium">{nameOf((r.decision as { targetId: string }).targetId)}</span>
                            {' · '}
                            {fmtCost(costOf((r.decision as { targetId: string }).targetId))}
                          </div>
                        )}
                        {isNew && (
                          <div className="text-sm text-amber-600 mt-1 flex items-center gap-1.5">
                            <Plus className="w-4 h-4" />
                            Se creará nuevo · sin coste, lo completa Pamela
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openPicker(idx)}
                        className="text-sm text-text-secondary hover:bg-page px-2.5 py-1.5 rounded-md flex-shrink-0 transition-colors"
                      >
                        {resolvedExisting ? 'Cambiar' : 'Buscar existente'}
                      </button>
                    </div>
                  ) : (
                    /* ── Picker abierto: elige cuál es ── */
                    <>
                      <div className="flex items-baseline justify-between">
                        <div className="text-[15px] font-medium text-text-primary">{r.line.rawText}</div>
                        <div className="text-sm text-text-secondary">{fmtQty(r.line)}</div>
                      </div>
                      <div className="text-xs text-amber-600 mt-1.5 mb-2.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Elige cuál es de tu despensa
                      </div>

                      {/* Similares (run_mapping) */}
                      <div className="flex flex-col gap-1.5">
                        {(r.search.trim().length >= 2 ? r.searchResults : r.candidates).map((c) => {
                          const selected =
                            r.decision.kind === 'existing' && r.decision.targetId === c.recipeItemId
                          return (
                            <button
                              key={c.recipeItemId}
                              type="button"
                              onClick={() => chooseExisting(idx, c)}
                              className={
                                'flex items-center justify-between px-3 py-2.5 rounded-md text-left transition-colors ' +
                                (selected
                                  ? 'border-2 border-blue-500 bg-blue-50'
                                  : 'border border-border-default hover:bg-page')
                              }
                            >
                              <span className="text-sm text-text-primary flex items-center gap-1.5">
                                {selected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                                {c.name}
                              </span>
                              <span className="text-xs text-text-secondary tabular-nums">
                                {fmtCost(costOf(c.recipeItemId))}
                              </span>
                            </button>
                          )
                        })}
                        {r.search.trim().length >= 2 && !r.searching && r.searchResults.length === 0 && (
                          <div className="text-xs text-text-secondary px-1 py-1.5">
                            Nada parecido. Puedes crear uno nuevo.
                          </div>
                        )}
                      </div>

                      {/* Buscador libre + crear nuevo */}
                      <div className="flex items-center gap-2.5 mt-2.5">
                        <div className="flex-1 flex items-center gap-2 border border-border-default rounded-md px-2.5 py-1.5">
                          <Search className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
                          <input
                            type="text"
                            value={r.search}
                            onChange={(e) => runSearch(idx, e.target.value)}
                            placeholder="Buscar otro en mi despensa…"
                            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary outline-none"
                          />
                          {r.searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-text-secondary" />}
                        </div>
                        <button
                          type="button"
                          onClick={() => chooseNew(idx)}
                          className="text-sm text-text-secondary hover:bg-page px-2.5 py-1.5 rounded-md flex items-center gap-1 flex-shrink-0 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Crear nuevo
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>

        {error && (
          <div className="px-5 py-2.5 bg-danger-bg text-danger border-t border-danger/20 text-sm">
            {error}
          </div>
        )}

        {/* Pie */}
        <div className="px-5 py-3.5 border-t border-border-default flex items-center justify-between gap-3">
          <div className="text-sm text-text-secondary">
            <span className="text-text-primary font-medium">
              {resolvedCount} de {rows.length}
            </span>{' '}
            resueltos
            {!allResolved && rows.length > 0 && ` · faltan ${rows.length - resolvedCount}`}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={finishing}
              className="px-3.5 py-2 rounded-md text-sm text-text-secondary hover:bg-page disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleFinish}
              disabled={!allResolved || finishing || loadingData}
              className="px-4 py-2 rounded-md text-sm font-medium bg-terracota text-white hover:bg-terracota-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {finishing && <Loader2 className="w-4 h-4 animate-spin" />}
              Terminar y crear
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
