// src/modules/supply/components/AvtSection.tsx
//
// AvT (Teórico vs Real) — capa 1: AvT puntual a nivel artículo, leído del último
// conteo APROBADO del local. system_qty (teórico) vs counted_qty (real) vs
// variance_value (€), ya calculados al cerrar. Cabecera de SALUD DEL DATO
// (diferenciador: números honestos o ninguno) + tabla ordenada por € perdido.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingDown, AlertTriangle, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import {
  getLatestApprovedCount, listCountLines, classifyAvtCause,
  type InventoryCountLine, type ApprovedCountRef, type AvtCause,
} from '@/modules/supply/services/inventoryCountService'

const fmtEur = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtQty = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function causeChipClass(key: AvtCause['key']): string {
  switch (key) {
    case 'negative_theoretical': return 'bg-warning-bg text-warning'
    case 'no_recipe': return 'bg-page text-text-tertiary'
    case 'waste': return 'bg-background-info text-text-info'
    case 'unexplained': return 'bg-danger-bg text-danger'
    case 'opening': return 'bg-page text-text-secondary'
  }
}

interface AvtRow {
  line: InventoryCountLine
  cause: AvtCause
}

export default function AvtSection({
  accountId, locationId, onError,
}: {
  accountId: string
  locationId: string | null
  onError: (m: string) => void
}) {
  const [count, setCount] = useState<ApprovedCountRef | null>(null)
  const [lines, setLines] = useState<InventoryCountLine[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!accountId || !locationId) { setLines([]); setCount(null); setLoaded(true); setLoading(false); return }
    let cancelled = false
    setLoading(true); setLoaded(false)
    ;(async () => {
      try {
        const c = await getLatestApprovedCount(accountId, locationId)
        if (cancelled) return
        setCount(c)
        if (c) {
          const l = await listCountLines(c.id)
          if (!cancelled) setLines(l)
        } else {
          setLines([])
        }
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el AvT.')
      } finally {
        if (!cancelled) { setLoading(false); setLoaded(true) }
      }
    })()
    return () => { cancelled = true }
  }, [accountId, locationId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOpening = count?.isOpening ?? false

  // Filas con causa, contadas, ordenadas por € de desviación (las que más pierden arriba).
  const rows = useMemo<AvtRow[]>(() => {
    return lines
      .filter(l => l.countedQty !== null)
      .map(l => ({ line: l, cause: classifyAvtCause(l, isOpening) }))
      .sort((a, b) => Math.abs(b.line.varianceValue ?? 0) - Math.abs(a.line.varianceValue ?? 0))
  }, [lines, isOpening])

  // Salud del dato.
  const health = useMemo(() => {
    const covered = rows.length
    const negative = rows.filter(r => r.cause.key === 'negative_theoretical').length
    const noRecipe = rows.filter(r => r.cause.key === 'no_recipe').length
    const totalVar = rows.reduce((s, r) => s + (r.line.varianceValue ?? 0), 0)
    let level: 'none' | 'partial' | 'good' = 'none'
    if (count) level = (count.kind === 'full' && negative === 0 && noRecipe === 0) ? 'good' : 'partial'
    return { covered, negative, noRecipe, totalVar, level }
  }, [rows, count])

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Cargando AvT…</div>
  }
  if (!locationId) {
    return <div className="text-sm text-text-secondary p-4 border border-dashed border-border-default rounded-lg">Elige un local para ver su AvT.</div>
  }
  if (loaded && !count) {
    return (
      <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
        <TrendingDown size={28} className="mx-auto mb-2 text-text-tertiary" />
        Todavía no hay ningún conteo aprobado en este local.<br />
        El AvT compara el teórico contra un conteo real: cierra y aprueba un conteo para empezar a medir la desviación.
      </div>
    )
  }

  const HealthIcon = health.level === 'good' ? ShieldCheck : health.level === 'partial' ? ShieldAlert : ShieldQuestion
  const healthLabel = health.level === 'good' ? 'Buena' : health.level === 'partial' ? 'Parcial' : 'Sin datos'
  const healthTone = health.level === 'good' ? 'text-success' : health.level === 'partial' ? 'text-warning' : 'text-text-tertiary'

  return (
    <div className="space-y-3">
      {/* Salud del dato — números honestos o ninguno */}
      <div className="border border-border-default rounded-lg p-3 bg-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <HealthIcon size={18} className={healthTone} />
            <span className="text-sm font-medium text-text-primary">Fiabilidad del AvT: <span className={healthTone}>{healthLabel}</span></span>
          </div>
          <span className="text-xs text-text-tertiary">
            Conteo {count?.code ?? ''} · {fmtDate(count?.approvedAt ?? count?.closedAt ?? null)}{isOpening ? ' · apertura' : ''}
          </span>
        </div>
        <div className="text-xs text-text-secondary mt-2 leading-relaxed">
          Cubre <strong className="text-text-primary">{health.covered}</strong> artículo{health.covered === 1 ? '' : 's'} contado{health.covered === 1 ? '' : 's'}.
          {health.negative > 0 && <> <span className="text-warning">{health.negative} con stock teórico negativo</span> (falta registrar compras o el escandallo descuenta de más).</>}
          {health.noRecipe > 0 && <> {health.negative > 0 ? '' : ' '}{health.noRecipe} sin escandallo fiable.</>}
          {health.negative === 0 && health.noRecipe === 0 && <> Sin avisos de dato.</>}
        </div>
      </div>

      {isOpening ? (
        <div className="text-center py-8 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          Este conteo es de <strong>apertura</strong> (fija el stock inicial). No hay desviación que medir: el AvT empieza a tener sentido a partir del siguiente conteo.
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">El conteo aprobado no tiene líneas contadas.</div>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Desviación teórico vs real, por artículo (lo que más se pierde, arriba)</span>
            <span className={`font-medium tabular-nums ${health.totalVar < 0 ? 'text-danger' : 'text-text-primary'}`}>
              Total: {fmtEur(health.totalVar)}
            </span>
          </div>
          <div className="border border-border-default rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
              <span className="flex-1">Artículo</span>
              <span className="w-24 text-right">Teórico</span>
              <span className="w-24 text-right">Real</span>
              <span className="w-24 text-right">Desviación</span>
              <span className="w-14 text-right">%</span>
              <span className="w-32">Causa probable</span>
            </div>
            {rows.map(({ line, cause }) => (
              <div key={line.id} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
                <span className="flex-1 text-sm text-text-primary truncate">{line.itemName}</span>
                <span className="w-24 text-right text-xs text-text-secondary tabular-nums">{fmtQty(line.systemQty)}{line.unitAbbr ? ` ${line.unitAbbr}` : ''}</span>
                <span className="w-24 text-right text-xs text-text-secondary tabular-nums">{fmtQty(line.countedQty)}{line.unitAbbr ? ` ${line.unitAbbr}` : ''}</span>
                <span className={`w-24 text-right text-sm font-medium tabular-nums ${(line.varianceValue ?? 0) < 0 ? 'text-danger' : (line.varianceValue ?? 0) > 0 ? 'text-success' : 'text-text-tertiary'}`}>
                  {fmtEur(line.varianceValue)}
                </span>
                <span className="w-14 text-right text-xs text-text-tertiary tabular-nums">{line.variancePct == null ? '—' : `${Math.round(line.variancePct)}%`}</span>
                <span className="w-32">
                  <span className={`text-[11px] px-2 py-0.5 rounded ${causeChipClass(cause.key)}`}>{cause.label}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-tertiary flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            La desviación negativa es producto que se fue sin venta (merma, sobre-porción, robo) o dato incompleto. Las marcadas "dato incompleto" o "escandallo no fiable" se arreglan antes de confiar en su cifra.
          </p>
        </>
      )}
    </div>
  )
}
