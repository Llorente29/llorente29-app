// src/modules/supply/components/InventoryCountSheet.tsx
//
// Hoja de conteo (capa 1.3). Dos modos según el estado del conteo:
//   - 'contando': hoja BLIND secuenciada por área. Solo se teclea lo contado;
//     NO se muestra el saldo del sistema (anti-sesgo). Guardado progresivo.
//   - 'en_revision': revisión. Ya se ve system_qty, variación, % y € con color;
//     las líneas fuera de tolerancia piden motivo (reason_code).
// La aprobación → ajuste en stock es 1.4 (aquí solo se cuenta y diagnostica).
//
// T1 (apertura): si el conteo es de APERTURA (count.isOpening), ancla el stock
// inicial del local. No es una corrección de merma: fija el punto de partida.
// La UI lo refleja (banner, textos y botón) para que el usuario lo entienda; el
// backend escribe esos movimientos como 'apertura' y el AvT los excluye de la
// variación.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Check, AlertTriangle, Save, ShieldCheck, Flag } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import {
  getInventoryCount,
  listCountLines,
  saveCountedQty,
  saveReasonCode,
  closeInventoryCount,
  approveInventoryCount,
  REASON_CODES,
  type InventoryCount,
  type InventoryCountLine,
  type InventoryCountSummary,
} from '@/modules/supply/services/inventoryCountService'

function eur(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}
function qty(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)
}

export default function InventoryCountSheet({
  countId, onBack,
}: {
  countId: string
  onBack: () => void
}) {
  const [count, setCount] = useState<InventoryCount | null>(null)
  const [lines, setLines] = useState<InventoryCountLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [summary, setSummary] = useState<InventoryCountSummary | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState<{ adjustments: number; itemsRecomputed: number } | null>(null)

  const { userProfile, authUserId } = useApp()
  const role = userProfile?.role ?? 'worker'
  const canApprove = role === 'admin' || role === 'manager'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const [c, ls] = await Promise.all([getInventoryCount(countId), listCountLines(countId)])
        if (cancelled) return
        setCount(c); setLines(ls)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando el conteo.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [countId, reloadTick])

  const isReview = count?.status === 'en_revision' || count?.status === 'aprobado'
  const isOpening = count?.isOpening === true

  // Agrupar por área en orden de recorrido.
  const grouped = useMemo(() => {
    const groups: { areaId: string | null; areaName: string; lines: InventoryCountLine[] }[] = []
    const byArea = new Map<string, number>()
    for (const l of lines) {
      const key = l.storageAreaId ?? '__none__'
      if (!byArea.has(key)) {
        byArea.set(key, groups.length)
        groups.push({ areaId: l.storageAreaId, areaName: l.storageAreaName ?? 'Sin área', lines: [] })
      }
      groups[byArea.get(key)!].lines.push(l)
    }
    return groups
  }, [lines])

  async function onCountedChange(line: InventoryCountLine, value: string) {
    const parsed = value.trim() === '' ? null : Number(value.replace(',', '.'))
    if (parsed !== null && Number.isNaN(parsed)) return
    setLines(prev => prev.map(l => l.id === line.id ? { ...l, countedQty: parsed } : l))
  }

  async function onCountedBlur(line: InventoryCountLine) {
    setSavingId(line.id)
    try {
      await saveCountedQty(line.id, line.countedQty)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSavingId(null)
    }
  }

  async function onReasonChange(line: InventoryCountLine, value: string) {
    setLines(prev => prev.map(l => l.id === line.id ? { ...l, reasonCode: value || null } : l))
    try { await saveReasonCode(line.id, value || null) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el motivo.') }
  }

  async function handleClose() {
    if (!window.confirm('¿Cerrar el conteo y calcular las diferencias? Después podrás revisarlas.')) return
    setClosing(true); setError(null)
    try {
      const s = await closeInventoryCount(countId)
      setSummary(s)
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el conteo.')
    } finally {
      setClosing(false)
    }
  }

  const countedCount = useMemo(() => lines.filter(l => l.countedQty !== null).length, [lines])

  // Líneas fuera de tolerancia sin motivo (bloquean la aprobación).
  const missingReasons = useMemo(
    () => lines.filter(l => l.countedQty !== null && l.withinTolerance === false && !l.reasonCode).length,
    [lines],
  )
  const isApproved = count?.status === 'aprobado'

  async function handleApprove() {
    if (missingReasons > 0) {
      setError(`Hay ${missingReasons} línea(s) fuera de tolerancia sin motivo. Asígnalo antes de aprobar.`)
      return
    }
    const confirmMsg = isOpening
      ? '¿Aprobar el inventario de apertura? Esto fija el stock inicial del local como punto de partida.'
      : '¿Aprobar el conteo? Esto ajustará el stock real con las diferencias y no se puede deshacer.'
    if (!window.confirm(confirmMsg)) return
    setApproving(true); setError(null)
    try {
      const res = await approveInventoryCount(countId, authUserId ?? null, userProfile?.displayName ?? null)
      setApproved(res)
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar el conteo.')
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-6"><Loader2 size={16} className="animate-spin" /> Cargando conteo…</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base">
          <ArrowLeft size={16} /> Conteos
        </button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">
            {isOpening && <Flag size={16} className="inline-block mr-1.5 -mt-0.5 text-accent" />}
            {count?.code ?? 'Conteo'}
            {isOpening && <span className="text-sm text-accent font-normal"> · apertura</span>}
            {isReview && <span className="text-sm text-text-secondary font-normal"> · revisión</span>}
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            {isReview
              ? (isOpening
                  ? 'Revisa el stock inicial antes de fijarlo. Al aprobar, queda como punto de partida del local.'
                  : 'Revisa las diferencias. Las que se salen de tolerancia necesitan un motivo.')
              : `Cuenta lo que ves. No se muestra el dato del sistema. ${countedCount}/${lines.length} contados.`}
          </p>
        </div>
        {!isReview && (
          <button type="button" onClick={handleClose} disabled={closing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            {closing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Cerrar conteo
          </button>
        )}
        {isReview && !isApproved && canApprove && (
          <button type="button" onClick={handleApprove} disabled={approving || missingReasons > 0}
            title={missingReasons > 0 ? 'Asigna motivo a las líneas fuera de tolerancia' : undefined}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
            {approving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {isOpening ? 'Aprobar apertura' : 'Aprobar y ajustar stock'}
          </button>
        )}
      </div>

      {isOpening && !isApproved && (
        <div className="p-3 rounded-md bg-accent-bg border border-accent/20 text-sm flex items-start gap-2">
          <Flag size={15} className="text-accent shrink-0 mt-0.5" />
          <span className="text-text-secondary">
            <span className="font-medium text-text-primary">Inventario de apertura.</span> Es el primer
            inventario de este local: lo que cuentes fija el stock inicial. No es una corrección de merma —
            es el punto de partida desde el que se medirán las variaciones.
          </span>
        </div>
      )}

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {summary && (
        <div className="p-3 rounded-md bg-accent-bg border border-accent/20 text-sm grid grid-cols-2 sm:grid-cols-5 gap-2">
          <SummaryCell label="Líneas" value={String(summary.total)} />
          <SummaryCell label="OK" value={String(summary.ok)} tone="ok" />
          <SummaryCell label="Fuera tol." value={String(summary.out)} tone={summary.out > 0 ? 'warn' : undefined} />
          <SummaryCell label="Sin contar" value={String(summary.uncounted)} />
          <SummaryCell label={isOpening ? 'Valor inicial' : 'Efecto €'} value={eur(summary.totalVarianceValue)} tone={!isOpening && summary.totalVarianceValue < 0 ? 'warn' : undefined} />
        </div>
      )}

      {lines.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          Este conteo no tiene líneas. Genera la hoja desde la lista de conteos.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(g => (
            <div key={g.areaId ?? '__none__'} className="border border-border-default rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-page text-text-secondary text-xs font-medium uppercase tracking-wide">{g.areaName}</div>
              <table className="w-full text-sm">
                <thead className="text-text-tertiary text-xs">
                  <tr className="border-t border-border-default">
                    <th className="text-left font-medium px-3 py-1.5">Artículo</th>
                    {isReview && !isOpening && <th className="text-right font-medium px-3 py-1.5">Sistema</th>}
                    <th className="text-right font-medium px-3 py-1.5">{isReview ? 'Contado' : 'Cantidad'}</th>
                    {isReview && !isOpening && <th className="text-right font-medium px-3 py-1.5">Variación</th>}
                    {isReview && <th className="text-right font-medium px-3 py-1.5">€</th>}
                    {isReview && !isOpening && <th className="text-left font-medium px-3 py-1.5">Motivo</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map(l => {
                    const out = isReview && !isOpening && l.withinTolerance === false
                    return (
                      <tr key={l.id} className={`border-t border-border-default ${out ? 'bg-warning-bg/40' : ''}`}>
                        <td className="px-3 py-2 text-text-primary">
                          {l.itemName}
                          {l.abcClass && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-page text-text-tertiary">{l.abcClass}</span>}
                        </td>
                        {isReview && !isOpening && <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{qty(l.systemQty)} {l.unitAbbr}</td>}
                        <td className="px-3 py-2 text-right">
                          {isReview ? (
                            <span className="tabular-nums text-text-primary">{qty(l.countedQty)} {l.unitAbbr}</span>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="text" inputMode="decimal"
                                value={l.countedQty ?? ''}
                                onChange={e => onCountedChange(l, e.target.value)}
                                onBlur={() => onCountedBlur(l)}
                                placeholder="—"
                                className="w-24 px-2 py-1 text-sm text-right border border-border-default rounded bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                              <span className="text-xs text-text-tertiary w-6 text-left">{l.unitAbbr}</span>
                              {savingId === l.id && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
                            </div>
                          )}
                        </td>
                        {isReview && !isOpening && (
                          <td className={`px-3 py-2 text-right tabular-nums ${l.withinTolerance === false ? 'text-warning font-medium' : 'text-text-secondary'}`}>
                            {l.varianceQty !== null ? `${l.varianceQty > 0 ? '+' : ''}${qty(l.varianceQty)}` : '—'}
                            {l.variancePct !== null && <span className="text-xs text-text-tertiary ml-1">({l.variancePct > 0 ? '+' : ''}{l.variancePct.toFixed(1)}%)</span>}
                          </td>
                        )}
                        {isReview && (
                          <td className={`px-3 py-2 text-right tabular-nums ${(!isOpening && (l.varianceValue ?? 0) < 0) ? 'text-danger' : 'text-text-secondary'}`}>
                            {eur(l.varianceValue)}
                          </td>
                        )}
                        {isReview && !isOpening && (
                          <td className="px-3 py-2">
                            {out ? (
                              <select value={l.reasonCode ?? ''} onChange={e => onReasonChange(l, e.target.value)}
                                className="px-2 py-1 text-xs border border-border-default rounded bg-card text-text-primary">
                                <option value="">— Motivo —</option>
                                {REASON_CODES.map(rc => <option key={rc.value} value={rc.value}>{rc.label}</option>)}
                              </select>
                            ) : l.countedQty === null ? (
                              <span className="text-xs text-text-tertiary">sin contar</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-success"><Check size={12} /> ok</span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {!isReview && lines.length > 0 && (
        <p className="text-xs text-text-tertiary flex items-center gap-1.5">
          <Save size={12} /> Se guarda solo a medida que cuentas. Puedes salir y volver.
        </p>
      )}
      {approved && (
        <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-center gap-1.5">
          <ShieldCheck size={15} />
          {isOpening
            ? `Apertura aprobada. Stock inicial fijado en ${approved.adjustments} artículo(s).`
            : `Conteo aprobado. ${approved.adjustments} ajuste(s) aplicado(s) al stock.`}
        </div>
      )}
      {isReview && !isApproved && (
        <p className="text-xs text-text-tertiary flex items-center gap-1.5">
          <AlertTriangle size={12} />
          {isOpening
            ? (canApprove
                ? 'Al aprobar, este conteo fija el stock inicial del local. A partir de aquí se medirán las variaciones.'
                : 'Apertura en revisión. La aprobación que fija el stock inicial la hace un responsable.')
            : missingReasons > 0
              ? `Faltan ${missingReasons} motivo(s) en líneas fuera de tolerancia para poder aprobar.`
              : canApprove
                ? 'Al aprobar, las diferencias se escriben como ajuste y corrigen el stock real.'
                : 'Conteo en revisión. La aprobación que ajusta el stock la hace un responsable.'}
        </p>
      )}
    </div>
  )
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-text-primary'
  return (
    <div>
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-sm font-medium tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
