// src/modules/kitchen/components/IngredientRemoveModal.tsx
// ─────────────────────────────────────────────────────────────────────
// "Quitar ingrediente de escandallos". Mismo molde que Sustituir:
// lista de platos que lo usan → marcas en cuáles quitarlo → coste actual →
// coste sin el ingrediente → confirmas → se borran esas líneas y se recostea.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Trash2, X, Loader2, Check } from 'lucide-react'
import {
  previewRemoveIngredient,
  removeIngredientFromRecipes,
  type RemoveDishPreview,
  type RemoveResult,
} from '@/modules/kitchen/services/purchaseFormatService'

interface UnitLike { id: string; abbreviation?: string | null; code?: string | null; name?: string | null }

interface IngredientRemoveModalProps {
  source: { id: string; name: string; accountId: string }
  units?: UnitLike[]
  onClose: () => void
  onDone: (result: RemoveResult) => void
}

function fmtEur(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(2).replace('.', ',')} €`
}
function pct(actual: number | null, nuevo: number | null): number | null {
  if (actual == null || nuevo == null || actual === 0) return null
  return ((nuevo - actual) / actual) * 100
}

export default function IngredientRemoveModal({ source, units, onClose, onDone }: IngredientRemoveModalProps) {
  const [dishes, setDishes] = useState<RemoveDishPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<RemoveResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unitLabel = (id: string | null): string => {
    if (!id) return ''
    const u = units?.find((x) => x.id === id)
    return u?.abbreviation || u?.code || u?.name || ''
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    previewRemoveIngredient(source.id)
      .then((d) => {
        if (cancelled) return
        setDishes(d)
        setSelected(new Set(d.map((x) => x.parentItemId)))
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo previsualizar.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [source.id])

  const allSelected = dishes.length > 0 && dishes.every((d) => selected.has(d.parentItemId))

  function toggleOne(id: string) {
    setConfirming(false)
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setConfirming(false)
    setSelected(allSelected ? new Set() : new Set(dishes.map((d) => d.parentItemId)))
  }

  const summary = useMemo(() => {
    const chosen = dishes.filter((d) => selected.has(d.parentItemId))
    const withPct = chosen.map((d) => pct(d.costeActual, d.costeNuevo)).filter((p): p is number => p != null)
    const avg = withPct.length ? withPct.reduce((a, b) => a + b, 0) / withPct.length : null
    return { count: chosen.length, avg }
  }, [dishes, selected])

  async function doRemove() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setWorking(true); setError(null)
    try {
      const res = await removeIngredientFromRecipes(source.id, ids)
      setResult(res); onDone(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo quitar.')
    } finally { setWorking(false) }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 min-w-0">
            <Trash2 className="w-4 h-4 text-accent flex-shrink-0" />
            <h3 className="text-base font-medium text-text-primary truncate">Quitar ingrediente de escandallos</h3>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-base"><X size={18} /></button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {!result ? (
            <>
              <p className="text-sm text-text-secondary">
                Quitar <span className="font-medium text-text-primary">{source.name}</span> de los platos que elijas.
              </p>

              {loading && <div className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando platos…</div>}

              {!loading && dishes.length === 0 && (
                <div className="p-3 rounded-md bg-page border border-border-default text-sm text-text-secondary">{source.name} no se usa en ningún escandallo.</div>
              )}

              {!loading && dishes.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">¿De qué platos? · usa <span className="font-medium text-text-primary">{source.name}</span> en {dishes.length}</span>
                    <button type="button" onClick={toggleAll} disabled={working} className="text-xs text-accent hover:underline disabled:opacity-50">{allSelected ? 'Quitar todos' : 'Seleccionar todos'}</button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {dishes.map((d) => {
                      const isOn = selected.has(d.parentItemId)
                      const p = pct(d.costeActual, d.costeNuevo)
                      return (
                        <div key={d.parentItemId} className="flex items-center gap-2.5 p-2.5 rounded-md border border-border-default cursor-pointer hover:bg-page" onClick={() => { if (!working) toggleOne(d.parentItemId) }}>
                          <input type="checkbox" checked={isOn} disabled={working} onChange={() => toggleOne(d.parentItemId)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-accent flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text-primary truncate">{d.parentName}</div>
                            {d.firstQty != null && <div className="text-[11px] text-text-secondary mt-0.5">usa {d.firstQty}{unitLabel(d.firstUnitId) ? ' ' + unitLabel(d.firstUnitId) : ''}{d.nLines > 1 ? ` · ${d.nLines} líneas` : ''}</div>}
                          </div>
                          <div className="text-right text-sm flex-shrink-0">
                            {d.costeActual != null && d.costeNuevo != null ? (
                              <>
                                <div><span className="text-text-tertiary line-through">{fmtEur(d.costeActual)}</span><span className="font-medium text-text-primary"> {fmtEur(d.costeNuevo)}</span></div>
                                {p != null && <div className={`text-[11px] ${p < 0 ? 'text-success' : p > 0 ? 'text-danger' : 'text-text-secondary'}`}>{p > 0 ? '+' : ''}{p.toFixed(0)} %</div>}
                              </>
                            ) : <span className="text-[11px] text-text-secondary">coste se recalcula</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {confirming && selected.size > 0 && (
                <div className="p-2.5 rounded-md bg-warning-bg border border-warning/30 text-xs text-text-primary">Vas a quitar {source.name} de {selected.size} plato(s). ¿Confirmas?</div>
              )}
              {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </>
          ) : (
            <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Listo: quitado de {result.affectedItemIds.length} plato(s) ({result.removed} línea(s)). Costes recalculados.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-default">
          {!result ? (
            <>
              <span className="text-xs text-text-secondary">
                {selected.size > 0 ? <>{selected.size} plato(s){summary.avg != null ? <> · coste medio <span className={summary.avg < 0 ? 'text-success font-medium' : 'text-danger font-medium'}>{summary.avg > 0 ? '+' : ''}{summary.avg.toFixed(0)} %</span></> : null}</> : 'Ningún plato seleccionado'}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} disabled={working} className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">Cancelar</button>
                {!confirming ? (
                  <button type="button" onClick={() => setConfirming(true)} disabled={selected.size === 0 || loading} className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">{selected.size > 0 ? `Quitar de ${selected.size}` : 'Quitar'}</button>
                ) : (
                  <button type="button" onClick={doRemove} disabled={working} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">{working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{working ? 'Quitando…' : 'Sí, quitar'}</button>
                )}
              </div>
            </>
          ) : (
            <button type="button" onClick={onClose} className="ml-auto px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">Cerrar</button>
          )}
        </div>
      </div>
    </div>
  )
}
