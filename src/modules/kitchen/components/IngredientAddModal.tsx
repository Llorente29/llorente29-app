// src/modules/kitchen/components/IngredientAddModal.tsx
// ─────────────────────────────────────────────────────────────────────
// "Añadir ingrediente a escandallos". Defines CUÁNTO (cantidad + unidad +
// corte opcional) y a QUÉ platos. La lista muestra todos los platos: marca
// los que ya lo usan (se añade igualmente como línea nueva) y excluye los que
// crearían una receta circular. Coste actual → coste con el ingrediente.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Plus, X, Loader2, Check, Search } from 'lucide-react'
import {
  listCutTypes,
  previewAddIngredient,
  addIngredientToRecipes,
  type CutTypeOption,
  type AddDishPreview,
  type AddResult,
} from '@/modules/kitchen/services/purchaseFormatService'

interface UnitLike { id: string; abbreviation?: string | null; code?: string | null; name?: string | null }

interface IngredientAddModalProps {
  source: { id: string; name: string; accountId: string; baseUnitId?: string | null }
  units: UnitLike[]
  onClose: () => void
  onDone: (result: AddResult) => void
}

function fmtEur(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(2).replace('.', ',')} €`
}
function pct(actual: number | null, nuevo: number | null): number | null {
  if (actual == null || nuevo == null || actual === 0) return null
  return ((nuevo - actual) / actual) * 100
}

export default function IngredientAddModal({ source, units, onClose, onDone }: IngredientAddModalProps) {
  const [qty, setQty] = useState('')
  const [unitId, setUnitId] = useState(source.baseUnitId ?? (units[0]?.id ?? ''))
  const [cutId, setCutId] = useState('')
  const [cuts, setCuts] = useState<CutTypeOption[]>([])

  const [dishes, setDishes] = useState<AddDishPreview[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<AddResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unitLabel = (id: string): string => {
    const u = units.find((x) => x.id === id)
    return u?.abbreviation || u?.code || u?.name || ''
  }

  useEffect(() => {
    let cancelled = false
    listCutTypes(source.accountId).then((c) => { if (!cancelled) setCuts(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [source.accountId])

  const qtyNum = useMemo(() => {
    const n = parseFloat(qty.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }, [qty])

  // Previsualiza cuando hay cantidad+unidad válidas (y al cambiar corte).
  useEffect(() => {
    setConfirming(false)
    if (qtyNum == null || !unitId) { setDishes([]); return }
    let cancelled = false
    setPreviewing(true); setError(null)
    previewAddIngredient(source.id, qtyNum, unitId, cutId || null)
      .then((d) => { if (!cancelled) setDishes(d) })
      .catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'No se pudo previsualizar.'); setDishes([]) } })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [source.id, qtyNum, unitId, cutId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return dishes
    return dishes.filter((d) => d.parentName.toLowerCase().includes(q))
  }, [dishes, search])

  const selectable = useMemo(() => filtered.filter((d) => !d.isCycle), [filtered])
  const allSelected = selectable.length > 0 && selectable.every((d) => selected.has(d.parentItemId))

  function toggleOne(id: string) {
    setConfirming(false)
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setConfirming(false)
    if (allSelected) {
      setSelected((prev) => { const n = new Set(prev); selectable.forEach((d) => n.delete(d.parentItemId)); return n })
    } else {
      setSelected((prev) => { const n = new Set(prev); selectable.forEach((d) => n.add(d.parentItemId)); return n })
    }
  }

  const summary = useMemo(() => {
    const chosen = dishes.filter((d) => selected.has(d.parentItemId))
    const withPct = chosen.map((d) => pct(d.costeActual, d.costeNuevo)).filter((p): p is number => p != null)
    const avg = withPct.length ? withPct.reduce((a, b) => a + b, 0) / withPct.length : null
    return { count: chosen.length, avg }
  }, [dishes, selected])

  async function doAdd() {
    const ids = Array.from(selected)
    if (ids.length === 0 || qtyNum == null || !unitId) return
    setWorking(true); setError(null)
    try {
      const res = await addIngredientToRecipes(source.id, qtyNum, unitId, cutId || null, ids)
      setResult(res); onDone(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo añadir.')
    } finally { setWorking(false) }
  }

  const canAdd = qtyNum != null && !!unitId && selected.size > 0 && !previewing

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 min-w-0">
            <Plus className="w-4 h-4 text-accent flex-shrink-0" />
            <h3 className="text-base font-medium text-text-primary truncate">Añadir ingrediente a escandallos</h3>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-base"><X size={18} /></button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {!result ? (
            <>
              <p className="text-sm text-text-secondary">Añadir <span className="font-medium text-text-primary">{source.name}</span> a los platos que elijas.</p>

              {/* Cuánto: cantidad + unidad + corte */}
              <div className="flex items-end gap-2">
                <div className="w-24">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Cantidad</label>
                  <input type="text" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={working} placeholder="0" className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Unidad</label>
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={working} className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
                    {units.map((u) => <option key={u.id} value={u.id}>{u.abbreviation || u.code || u.name || u.id}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Corte (opcional)</label>
                  <select value={cutId} onChange={(e) => setCutId(e.target.value)} disabled={working} className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50">
                    <option value="">— Sin corte —</option>
                    {cuts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {qtyNum == null && <p className="text-[11px] text-text-secondary">Indica una cantidad para ver los platos y el impacto de coste.</p>}

              {previewing && <div className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</div>}

              {!previewing && qtyNum != null && dishes.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="w-4 h-4 text-text-secondary absolute left-2 top-1/2 -translate-y-1/2" />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} disabled={working} placeholder="Buscar plato…" className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">¿A qué platos? · {filtered.length} disponibles</span>
                    {selectable.length > 0 && <button type="button" onClick={toggleAll} disabled={working} className="text-xs text-accent hover:underline disabled:opacity-50">{allSelected ? 'Quitar todos' : 'Seleccionar todos'}</button>}
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto">
                    {filtered.map((d) => {
                      const isOn = selected.has(d.parentItemId)
                      const p = pct(d.costeActual, d.costeNuevo)
                      return (
                        <div key={d.parentItemId} className={`flex items-center gap-2.5 p-2.5 rounded-md border border-border-default ${d.isCycle ? 'opacity-60' : 'cursor-pointer hover:bg-page'}`} onClick={() => { if (!d.isCycle && !working) toggleOne(d.parentItemId) }}>
                          <input type="checkbox" checked={isOn && !d.isCycle} disabled={d.isCycle || working} onChange={() => toggleOne(d.parentItemId)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-accent flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text-primary truncate">{d.parentName}</div>
                            <div className="mt-0.5">
                              {d.isCycle ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-danger-bg text-danger">crearía receta circular · excluido</span>
                                : d.alreadyHas ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-bg text-accent">ya lo usa · se añade otra línea</span>
                                : null}
                            </div>
                          </div>
                          <div className="text-right text-sm flex-shrink-0">
                            {!d.isCycle && d.costeActual != null && d.costeNuevo != null ? (
                              <>
                                <div><span className="text-text-tertiary line-through">{fmtEur(d.costeActual)}</span><span className="font-medium text-text-primary"> {fmtEur(d.costeNuevo)}</span></div>
                                {p != null && <div className={`text-[11px] ${p > 0 ? 'text-danger' : 'text-text-secondary'}`}>{p > 0 ? '+' : ''}{p.toFixed(0)} %</div>}
                              </>
                            ) : !d.isCycle ? <span className="text-[11px] text-text-secondary">coste se recalcula</span> : <span className="text-text-tertiary">—</span>}
                          </div>
                        </div>
                      )
                    })}
                    {filtered.length === 0 && <p className="text-[11px] text-text-secondary">Ningún plato coincide.</p>}
                  </div>
                </>
              )}

              {confirming && canAdd && (
                <div className="p-2.5 rounded-md bg-warning-bg border border-warning/30 text-xs text-text-primary">Vas a añadir {qty} {unitLabel(unitId)} de {source.name} a {selected.size} plato(s). ¿Confirmas?</div>
              )}
              {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </>
          ) : (
            <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Listo: añadido a {result.added} plato(s){result.skippedCycle > 0 ? `, ${result.skippedCycle} excluido(s) por ciclo` : ''}. Costes recalculados.</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-default">
          {!result ? (
            <>
              <span className="text-xs text-text-secondary">
                {selected.size > 0 ? <>{selected.size} plato(s){summary.avg != null ? <> · coste medio <span className="text-danger font-medium">{summary.avg > 0 ? '+' : ''}{summary.avg.toFixed(0)} %</span></> : null}</> : 'Ningún plato seleccionado'}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} disabled={working} className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">Cancelar</button>
                {!confirming ? (
                  <button type="button" onClick={() => setConfirming(true)} disabled={!canAdd} className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">{selected.size > 0 ? `Añadir a ${selected.size}` : 'Añadir'}</button>
                ) : (
                  <button type="button" onClick={doAdd} disabled={working} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">{working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{working ? 'Añadiendo…' : 'Sí, añadir'}</button>
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
