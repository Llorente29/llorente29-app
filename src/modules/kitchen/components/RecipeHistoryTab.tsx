// src/modules/kitchen/components/RecipeHistoryTab.tsx
//
// Pestaña "Histórico" del editor de escandallo: versiones de la receta.
// Modelo HITO MANUAL (como meez/Apicbase) + el diferenciador de Folvy: cada
// versión guarda su coste → el diff muestra el IMPACTO ECONÓMICO del cambio
// ("girasol en vez de oliva · −0,18 €"), no solo qué ingrediente cambió.
//
// Acciones: Guardar versión (con etiqueta de hito + nota), Comparar con la
// actual (diff legible), Restaurar (con red: snapshot del estado actual antes).

import { useEffect, useMemo, useState } from 'react'
import {
  History, Save, Star, RotateCcw, Loader2, ArrowRight, Plus, Minus, ChevronDown,
} from 'lucide-react'
import {
  listRecipeVersions,
  createRecipeVersion,
  restoreRecipeVersion,
  diffSnapshots,
  type RecipeVersion,
} from '@/modules/kitchen/services/recipeVersionService'
import { listUnits } from '@/modules/kitchen/services/kitchenUnitService'
import type { KitchenUnit } from '@/types/kitchen'

interface Props {
  recipeItemId: string
  createdByName?: string | null
  /** Se llama tras restaurar (el editor recarga plato + líneas + coste). */
  onRestored: () => void
}

function fmtEur(v: number | null): string {
  if (v === null) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}
function fmtQty(v: number | null): string {
  if (v === null) return '—'
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export default function RecipeHistoryTab({ recipeItemId, createdByName, onRestored }: Props) {
  const [versions, setVersions] = useState<RecipeVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unitAbbr, setUnitAbbr] = useState<Map<string, string>>(new Map())

  // Guardar versión
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [milestone, setMilestone] = useState(false)
  const [saving, setSaving] = useState(false)

  // Comparar / restaurar
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try {
      const vs = await listRecipeVersions(recipeItemId)
      setVersions(vs)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando versiones.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    reload()
    listUnits({})
      .then((us: KitchenUnit[]) => {
        const m = new Map<string, string>()
        for (const u of us) m.set(u.id, u.abbreviation ?? '')
        setUnitAbbr(m)
      })
      .catch(() => { /* abreviaturas cosméticas */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeItemId])

  // La versión ACTIVA (valid_to null) = estado guardado actual; referencia del diff.
  const active = useMemo(
    () => versions.find((v) => v.validTo === null) ?? versions[0] ?? null,
    [versions]
  )

  async function handleSave() {
    if (saving) return
    setSaving(true); setError(null)
    try {
      await createRecipeVersion(recipeItemId, {
        label: label.trim() || null,
        note: note.trim() || null,
        isMilestone: milestone,
        createdByName: createdByName ?? null,
      })
      setLabel(''); setNote(''); setMilestone(false)
      await reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la versión.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore(v: RecipeVersion) {
    if (restoringId) return
    setRestoringId(v.id); setError(null); setConfirmRestoreId(null)
    try {
      await restoreRecipeVersion(v.id, createdByName ?? null)
      await reload()
      onRestored()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo restaurar la versión.')
    } finally {
      setRestoringId(null)
    }
  }

  function qtyLabel(qty: number | null, unitId: string | null): string {
    const u = unitId ? (unitAbbr.get(unitId) ?? '') : ''
    return `${fmtQty(qty)}${u ? ' ' + u : ''}`
  }

  if (loading) {
    return (
      <div className="p-4 md:p-5 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando histórico…
      </div>
    )
  }

  return (
    <div className="p-4 md:p-5 space-y-5">
      {/* Guardar versión */}
      <div className="rounded-lg border border-border-default bg-card p-4">
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-text-secondary uppercase mb-3">
          <Save className="w-3.5 h-3.5" /> Guardar versión
        </div>
        <div className="space-y-2.5">
          <input
            type="text" value={label} onChange={(e) => setLabel(e.target.value)} disabled={saving}
            placeholder="Etiqueta (opcional) — ej: Receta de verano"
            className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-card focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving}
            placeholder="Qué cambió (opcional) — ej: subimos la ración de patata"
            className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-card focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
              <input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} disabled={saving} />
              <Star className={'w-3.5 h-3.5 ' + (milestone ? 'text-terracota' : 'text-text-secondary')} />
              Marcar como hito
            </label>
            <button
              type="button" onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium bg-terracota text-white hover:bg-terracota-hover disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Guardando…' : 'Guardar versión'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{error}</div>}

      {/* Lista de versiones */}
      <div>
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-text-secondary uppercase mb-2">
          <History className="w-3.5 h-3.5" /> Historial
        </div>

        {versions.length === 0 ? (
          <div className="text-sm text-text-secondary opacity-70 py-6 text-center border border-dashed border-border-default rounded-lg">
            Aún no hay versiones. Guarda la primera cuando esta receta esté como quieres.
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => {
              const isActive = v.validTo === null
              const expanded = expandedId === v.id
              const diff = active && v.id !== active.id ? diffSnapshots(v.snapshot, active.snapshot) : null
              const restoring = restoringId === v.id
              return (
                <div key={v.id} className="rounded-lg border border-border-default overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span className="font-mono text-sm text-text-primary">v{v.versionNumber}</span>
                    {v.isMilestone && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-terracota-bg text-terracota font-medium">
                        <Star className="w-3 h-3" /> {v.milestoneLabel || 'Hito'}
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-text-secondary">actual</span>
                    )}
                    <span className="text-xs text-text-secondary truncate">
                      {fmtDate(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ''}
                    </span>
                    <span className="ml-auto font-mono text-sm text-text-secondary">{fmtEur(v.computedCost)}</span>
                  </div>

                  {v.changeNote && (
                    <div className="px-3 pb-1.5 -mt-1 text-xs text-text-secondary">{v.changeNote}</div>
                  )}

                  <div className="flex items-center gap-2 px-3 pb-2.5">
                    {diff && (
                      <button
                        type="button" onClick={() => setExpandedId(expanded ? null : v.id)}
                        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <ChevronDown className={'w-3.5 h-3.5 transition-transform ' + (expanded ? '' : '-rotate-90')} />
                        Comparar con la actual
                      </button>
                    )}
                    {!isActive && (
                      confirmRestoreId === v.id ? (
                        <span className="ml-auto inline-flex items-center gap-2 text-xs">
                          <span className="text-text-secondary">¿Restaurar v{v.versionNumber}?</span>
                          <button type="button" onClick={() => handleRestore(v)} disabled={restoring}
                            className="px-2 py-1 rounded-md bg-terracota text-white font-medium hover:bg-terracota-hover disabled:opacity-50">
                            {restoring ? 'Restaurando…' : 'Sí'}
                          </button>
                          <button type="button" onClick={() => setConfirmRestoreId(null)} disabled={restoring}
                            className="px-2 py-1 rounded-md text-text-secondary hover:bg-accent-bg">No</button>
                        </span>
                      ) : (
                        <button
                          type="button" onClick={() => setConfirmRestoreId(v.id)} disabled={!!restoringId}
                          className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                        </button>
                      )
                    )}
                  </div>

                  {/* Diff legible (impacto en coste + cambios de ingrediente) */}
                  {expanded && diff && (
                    <div className="px-3 pb-3 pt-1 border-t border-border-default bg-accent-bg">
                      <div className="text-[11px] text-text-secondary mb-2">
                        De v{v.versionNumber} a la actual:
                      </div>
                      {diff.costDelta !== null && (
                        <div className="mb-2 text-sm">
                          Coste:{' '}
                          <span className="font-mono">{fmtEur(diff.costFrom)}</span>
                          <ArrowRight className="inline w-3.5 h-3.5 mx-1 text-text-secondary" />
                          <span className="font-mono">{fmtEur(diff.costTo)}</span>
                          {diff.costDelta !== 0 && (
                            <span className={'ml-2 font-medium ' + (diff.costDelta < 0 ? 'text-emerald-600' : 'text-danger')}>
                              {diff.costDelta < 0 ? '' : '+'}{fmtEur(diff.costDelta)}
                            </span>
                          )}
                        </div>
                      )}
                      {diff.lines.length === 0 ? (
                        <div className="text-xs text-text-secondary">Sin cambios de ingredientes.</div>
                      ) : (
                        <div className="space-y-1">
                          {diff.lines.map((d) => (
                            <div key={d.kind + d.childItemId} className="flex items-center gap-1.5 text-xs">
                              {d.kind === 'added' && <Plus className="w-3 h-3 text-emerald-600 flex-shrink-0" />}
                              {d.kind === 'removed' && <Minus className="w-3 h-3 text-danger flex-shrink-0" />}
                              {d.kind === 'changed' && <ArrowRight className="w-3 h-3 text-warning flex-shrink-0" />}
                              <span className="text-text-primary">{d.name}</span>
                              <span className="text-text-secondary">
                                {d.kind === 'added' && `nuevo · ${qtyLabel(d.toQty, d.unitId)}`}
                                {d.kind === 'removed' && `quitado · ${qtyLabel(d.fromQty, d.unitId)}`}
                                {d.kind === 'changed' && `${qtyLabel(d.fromQty, d.unitId)} → ${qtyLabel(d.toQty, d.unitId)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
