// src/modules/kitchen/components/IngredientSubstituteModal.tsx
// ─────────────────────────────────────────────────────────────────────
// "Sustituir ingrediente en escandallos". Granular y para cocina:
//   1) eliges el ingrediente destino (buscador),
//   2) ves la LISTA de platos que usan el origen, cada uno con su estado
//      (se reemplaza / se fusiona / revisar / excluido por ciclo) y el
//      impacto de coste (actual → nuevo, %),
//   3) marcas en qué platos aplicar (los de ciclo no son seleccionables),
//   4) confirmas → sustituye solo en los elegidos y recostea.
// Golea a tspoon: tspoon te deja elegir platos, pero no te enseña el coste.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, ArrowRight, X, Loader2, Check, Search } from 'lucide-react'
import {
  listSubstituteCandidates,
  previewSubstituteIngredient,
  substituteIngredientInRecipes,
  type SubstituteCandidate,
  type SubstituteDishPreview,
  type IngredientSubstituteResult,
} from '@/modules/kitchen/services/purchaseFormatService'

interface UnitLike {
  id: string
  abbreviation?: string | null
  code?: string | null
  name?: string | null
}

interface IngredientSubstituteModalProps {
  source: { id: string; name: string; accountId: string }
  units?: UnitLike[]
  onClose: () => void
  /** Se llama tras sustituir con éxito (para refrescar el detalle / coste). */
  onDone: (result: IngredientSubstituteResult) => void
}

function fmtEur(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(2).replace('.', ',')} €`
}

function pct(actual: number | null, nuevo: number | null): number | null {
  if (actual == null || nuevo == null || actual === 0) return null
  return ((nuevo - actual) / actual) * 100
}

export default function IngredientSubstituteModal({ source, units, onClose, onDone }: IngredientSubstituteModalProps) {
  const [candidates, setCandidates] = useState<SubstituteCandidate[]>([])
  const [loadingCand, setLoadingCand] = useState(true)
  const [targetId, setTargetId] = useState('')
  const [candSearch, setCandSearch] = useState('')

  const [dishes, setDishes] = useState<SubstituteDishPreview[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<IngredientSubstituteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unitLabel = (id: string | null): string => {
    if (!id) return ''
    const u = units?.find((x) => x.id === id)
    return u?.abbreviation || u?.code || u?.name || ''
  }

  // Ingredientes candidatos (de la cuenta, sin platos, excluido el origen).
  useEffect(() => {
    let cancelled = false
    setLoadingCand(true)
    listSubstituteCandidates(source.accountId, source.id)
      .then((c) => { if (!cancelled) setCandidates(c) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los ingredientes.') })
      .finally(() => { if (!cancelled) setLoadingCand(false) })
    return () => { cancelled = true }
  }, [source.accountId, source.id])

  const filteredCand = useMemo(() => {
    const q = candSearch.trim().toLowerCase()
    if (q === '') return candidates
    return candidates.filter((c) => c.name.toLowerCase().includes(q))
  }, [candidates, candSearch])

  const targetName = candidates.find((c) => c.id === targetId)?.name ?? ''

  // Al elegir destino: previsualiza la lista de platos y preselecciona los aplicables.
  useEffect(() => {
    setConfirming(false)
    setResult(null)
    if (!targetId) { setDishes([]); setSelected(new Set()); return }
    let cancelled = false
    setPreviewing(true)
    setError(null)
    previewSubstituteIngredient(source.id, targetId)
      .then((d) => {
        if (cancelled) return
        setDishes(d)
        // Preselecciona todo lo aplicable (los de ciclo no se pueden tocar).
        setSelected(new Set(d.filter((x) => x.estado !== 'ciclo').map((x) => x.parentItemId)))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudo previsualizar.')
        setDishes([])
      })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [targetId, source.id])

  const selectable = useMemo(() => dishes.filter((d) => d.estado !== 'ciclo'), [dishes])
  const allSelected = selectable.length > 0 && selectable.every((d) => selected.has(d.parentItemId))

  function toggleOne(id: string) {
    setConfirming(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setConfirming(false)
    setSelected(allSelected ? new Set() : new Set(selectable.map((d) => d.parentItemId)))
  }

  // Resumen: coste medio del cambio sobre los platos elegidos con coste conocido.
  const summary = useMemo(() => {
    const chosen = dishes.filter((d) => selected.has(d.parentItemId))
    const withPct = chosen.map((d) => pct(d.costeActual, d.costeNuevo)).filter((p): p is number => p != null)
    const avg = withPct.length ? withPct.reduce((a, b) => a + b, 0) / withPct.length : null
    return { count: chosen.length, avg }
  }, [dishes, selected])

  async function doSubstitute() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setWorking(true)
    setError(null)
    try {
      const res = await substituteIngredientInRecipes(source.id, targetId, ids)
      setResult(res)
      onDone(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo sustituir.')
    } finally {
      setWorking(false)
    }
  }

  const canSubstitute = !!targetId && !previewing && selected.size > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="bg-card w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-accent flex-shrink-0" />
            <h3 className="text-base font-medium text-text-primary truncate">Sustituir ingrediente en escandallos</h3>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-base">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {!result ? (
            <>
              {/* Origen → destino */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-page border border-border-default text-sm font-medium text-text-primary">
                  {source.name}
                </span>
                <ArrowRight className="w-4 h-4 text-text-secondary flex-shrink-0" />
                {targetId ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent-bg border border-accent/30 text-sm font-medium text-accent">
                    {targetName}
                  </span>
                ) : (
                  <span className="text-sm text-text-secondary">elige el ingrediente nuevo →</span>
                )}
              </div>

              {/* Selector de destino */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Sustituir por</label>
                {loadingCand ? (
                  <div className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando ingredientes…</div>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search className="w-4 h-4 text-text-secondary absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={candSearch}
                        onChange={(e) => setCandSearch(e.target.value)}
                        disabled={working}
                        placeholder="Buscar ingrediente…"
                        className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                      />
                    </div>
                    <select
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      disabled={working}
                      size={Math.min(5, Math.max(2, filteredCand.length))}
                      className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    >
                      {filteredCand.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {filteredCand.length === 0 && <p className="text-[11px] text-text-secondary mt-1">Ningún ingrediente coincide.</p>}
                  </>
                )}
              </div>

              {previewing && (
                <div className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando impacto por plato…</div>
              )}

              {/* Lista de platos */}
              {!previewing && targetId && dishes.length === 0 && (
                <div className="p-3 rounded-md bg-page border border-border-default text-sm text-text-secondary">
                  {source.name} no se usa en ningún escandallo.
                </div>
              )}

              {!previewing && dishes.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">¿En qué platos? · usa <span className="font-medium text-text-primary">{source.name}</span> en {dishes.length}</span>
                    {selectable.length > 0 && (
                      <button type="button" onClick={toggleAll} disabled={working} className="text-xs text-accent hover:underline disabled:opacity-50">
                        {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {dishes.map((d) => {
                      const isCycle = d.estado === 'ciclo'
                      const isOn = selected.has(d.parentItemId)
                      const p = pct(d.costeActual, d.costeNuevo)
                      const borderCls = d.estado === 'revisar' ? 'border-warning' : 'border-border-default'
                      return (
                        <div
                          key={d.parentItemId}
                          className={`flex items-center gap-2.5 p-2.5 rounded-md border ${borderCls} ${isCycle ? 'opacity-60' : 'cursor-pointer hover:bg-page'}`}
                          onClick={() => { if (!isCycle && !working) toggleOne(d.parentItemId) }}
                        >
                          <input
                            type="checkbox"
                            checked={isOn && !isCycle}
                            disabled={isCycle || working}
                            onChange={() => toggleOne(d.parentItemId)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 accent-accent flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text-primary truncate">{d.parentName}</div>
                            <div className="mt-0.5">
                              {d.estado === 'fusion' && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-success-bg text-success">ya lo usa · se fusiona</span>
                              )}
                              {d.estado === 'revisar' && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-warning-bg text-warning">unidad/corte distinto · revisar</span>
                              )}
                              {d.estado === 'ciclo' && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-danger-bg text-danger">crearía receta circular · excluido</span>
                              )}
                              {d.estado === 'limpio' && d.firstQty != null && (
                                <span className="text-[11px] text-text-secondary">usa {d.firstQty}{unitLabel(d.firstUnitId) ? ' ' + unitLabel(d.firstUnitId) : ''}{d.nLines > 1 ? ` · ${d.nLines} líneas` : ''}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right text-sm flex-shrink-0">
                            {isCycle ? (
                              <span className="text-text-tertiary">—</span>
                            ) : d.costeActual != null && d.costeNuevo != null ? (
                              <>
                                <div>
                                  <span className="text-text-tertiary line-through">{fmtEur(d.costeActual)}</span>
                                  <span className="font-medium text-text-primary"> {fmtEur(d.costeNuevo)}</span>
                                </div>
                                {p != null && (
                                  <div className={`text-[11px] ${p > 0 ? 'text-danger' : p < 0 ? 'text-success' : 'text-text-secondary'}`}>
                                    {p > 0 ? '+' : ''}{p.toFixed(0)} %
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-text-secondary">coste se recalcula</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {confirming && canSubstitute && (
                <div className="p-2.5 rounded-md bg-warning-bg border border-warning/30 text-xs text-text-primary">
                  Vas a sustituir {source.name} por {targetName} en {selected.size} plato(s). ¿Confirmas?
                </div>
              )}

              {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Listo: {result.replaced} reemplazada(s)
                  {result.merged > 0 ? `, ${result.merged} fusionada(s)` : ''}
                  {result.flagged > 0 ? `, ${result.flagged} para revisar` : ''}
                  {result.skippedCycle > 0 ? `, ${result.skippedCycle} excluida(s) por ciclo` : ''}. Costes recalculados.
                </span>
              </div>
              {result.flagged > 0 && (
                <p className="text-xs text-text-secondary">
                  Hay {result.flagged} plato(s) con dos líneas de {targetName} (unidad o corte distinto). Ábrelos y únelos a mano si procede.
                </p>
              )}
              {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-default">
          {!result ? (
            <>
              <span className="text-xs text-text-secondary">
                {selected.size > 0
                  ? <>{selected.size} plato(s){summary.avg != null ? <> · coste medio <span className={summary.avg > 0 ? 'text-danger font-medium' : summary.avg < 0 ? 'text-success font-medium' : ''}>{summary.avg > 0 ? '+' : ''}{summary.avg.toFixed(0)} %</span></> : null}</>
                  : 'Ningún plato seleccionado'}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} disabled={working} className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
                  Cancelar
                </button>
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={!canSubstitute}
                    className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                  >
                    {selected.size > 0 ? `Sustituir en ${selected.size}` : 'Sustituir'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={doSubstitute}
                    disabled={working}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
                  >
                    {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {working ? 'Sustituyendo…' : 'Sí, sustituir'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <button type="button" onClick={onClose} className="ml-auto px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
