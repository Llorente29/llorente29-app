// src/modules/supply/components/AutoInventorySection.tsx
//
// Pestaña "Autoinventario" de Inventario (A2). Folvy dice QUE contar hoy y
// CUANTO — no por cadencia fija (eso es lo que hacen MarketMan/NetSuite/SAP),
// sino por COBERTURA del valor en riesgo. El gerente toca un solo mando: el
// objetivo de cobertura. Todo lo demás (valor·rotación·riesgo + criticidad
// operativa) lo calcula A1 al vuelo y se muestra desglosado = confianza visible.
//
// Solo lectura: visualiza la cola. Iniciar un conteo desde aquí es un frente
// posterior; hoy el conteo se crea en la pestaña "Conteos".

import { useEffect, useMemo, useState } from 'react'
import { Gauge, Loader2, RefreshCw, AlertTriangle, ScanLine } from 'lucide-react'
import {
  getAutoInventoryQueue,
  type AutoInventoryItem,
} from '@/modules/supply/services/autoinventoryService'

const COVERAGE_OPTIONS = [70, 80, 90, 95] as const

const fmtEur = (v: number | null) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
const fmtQty = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)
const fmtPct = (v: number | null) =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(v)} %`
const fmtScore = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)

export default function AutoInventorySection({
  accountId, locationId, onError,
}: {
  accountId: string
  locationId: string
  onError: (m: string) => void
  onFlash: (m: string) => void
}) {
  const [target, setTarget] = useState<number>(80)
  const [rows, setRows] = useState<AutoInventoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!accountId || !locationId) { setRows([]); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await getAutoInventoryQueue({ accountId, locationId, coverageTarget: target })
        if (!cancelled) setRows(data)
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error calculando el autoinventario.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, locationId, target, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = useMemo(() => rows.filter(r => r.inScope), [rows])
  const criticalCount = useMemo(() => rows.filter(r => r.mustCount).length, [rows])
  const maxScore = useMemo(() => rows.reduce((m, r) => Math.max(m, r.score), 0) || 1, [rows])
  // Cobertura real alcanzada por la tanda de hoy = la cobertura de la última
  // fila en alcance (la acumulada es monótona, el bloque in_scope es contiguo).
  const coveredPct = useMemo(() => {
    const last = inScope[inScope.length - 1]
    return last?.coveragePct ?? null
  }, [inScope])

  // chip de clase rica A/B/C
  const abcChip = (c: 'A' | 'B' | 'C' | null) => {
    if (!c) return null
    const cls =
      c === 'A' ? 'bg-accent-bg text-accent border-accent/20'
      : c === 'B' ? 'bg-page text-text-secondary border-border-default'
      : 'bg-page text-text-tertiary border-border-default'
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{c}</span>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Folvy te dice <span className="text-text-primary font-medium">qué contar hoy y cuánto</span>. No por
        un calendario fijo, sino cubriendo el valor que más se mueve y más riesgo tiene. Sube o baja el
        objetivo de cobertura y la lista se ajusta.
      </p>

      {/* Mando único: objetivo de cobertura */}
      <div className="border border-border-default rounded-lg p-3 bg-card flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-accent" />
          <span className="text-sm text-text-secondary">Objetivo de cobertura del valor</span>
          <div className="flex items-center gap-1.5">
            {COVERAGE_OPTIONS.map(opt => (
              <button key={opt} type="button" onClick={() => setTarget(opt)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-base ${target === opt ? 'bg-accent text-text-on-accent border-accent' : 'border-border-default text-text-secondary hover:bg-page'}`}>
                {opt} %
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border-default text-text-secondary hover:bg-page transition-base">
          <RefreshCw size={13} /> Actualizar
        </button>
      </div>

      {/* KPIs */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-border-default rounded-lg p-3 bg-card">
            <div className="text-2xl font-display font-medium text-text-primary tabular-nums">{inScope.length}</div>
            <div className="text-xs text-text-secondary mt-0.5">a contar hoy <span className="text-text-tertiary">de {rows.length}</span></div>
          </div>
          <div className="border border-border-default rounded-lg p-3 bg-card">
            <div className="text-2xl font-display font-medium text-text-primary tabular-nums">{fmtPct(coveredPct)}</div>
            <div className="text-xs text-text-secondary mt-0.5">del valor del almacén cubierto</div>
          </div>
          <div className="border border-border-default rounded-lg p-3 bg-card">
            <div className="text-2xl font-display font-medium text-text-primary tabular-nums flex items-center gap-1.5">
              {criticalCount > 0 && <AlertTriangle size={18} className="text-warning" />}{criticalCount}
            </div>
            <div className="text-xs text-text-secondary mt-0.5">críticos sí o sí</div>
          </div>
        </div>
      )}

      {/* Lista priorizada */}
      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Calculando prioridad…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
          <ScanLine size={28} className="mx-auto mb-2 text-text-tertiary" />
          Aún no hay datos para priorizar este local. En cuanto haya stock con valor y consumo, Folvy ordenará qué contar.
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="w-8 text-right">#</span>
            <span className="flex-1">Artículo</span>
            <span className="w-24 text-right">Valor stock</span>
            <span className="w-28">Prioridad</span>
            <span className="w-20 text-right">Cobertura</span>
          </div>

          {rows.map((r, i) => {
            const prev = rows[i - 1]
            const showCut = prev?.inScope && !r.inScope
            return (
              <div key={r.recipeItemId}>
                {showCut && (
                  <div className="px-3 py-1.5 bg-page border-t border-dashed border-accent/40 text-[11px] text-text-tertiary text-center">
                    — hasta aquí cubres el {target}% objetivo · lo de abajo puede esperar —
                  </div>
                )}
                <div className={`flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0 ${r.inScope ? '' : 'opacity-55'}`}>
                  <span className="w-8 text-right text-xs text-text-tertiary tabular-nums">{r.rank}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-text-primary truncate">{r.name}</span>
                      {abcChip(r.abcRich)}
                      {r.mustCount && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-warning-bg text-warning border-warning/20">
                          {r.criticalReason ?? 'crítico'}
                        </span>
                      )}
                    </span>
                    {/* Desglose = confianza visible: por qué está aquí */}
                    <span className="block text-[11px] text-text-tertiary mt-0.5">
                      valor {fmtScore(r.scoreValue)} · rotación {fmtScore(r.scoreRotation)} · riesgo {fmtScore(r.scoreRisk)}
                      {r.rotationEur > 0 && <span className="text-text-tertiary"> · mueve {fmtEur(r.rotationEur)}/mes</span>}
                    </span>
                  </span>
                  <span className="w-24 text-right text-text-primary font-medium tabular-nums">
                    {fmtEur(r.stockValue)}
                    {r.baseUnit && r.qtyOnHand > 0 && (
                      <span className="block text-[11px] text-text-tertiary font-normal">{fmtQty(r.qtyOnHand)} {r.baseUnit}</span>
                    )}
                  </span>
                  <span className="w-28">
                    <span className="flex items-center gap-2">
                      <span className="flex-1 h-1.5 rounded-full bg-page overflow-hidden">
                        <span className="block h-full bg-accent rounded-full" style={{ width: `${Math.round((r.score / maxScore) * 100)}%` }} />
                      </span>
                      <span className="text-[11px] text-text-secondary tabular-nums w-8 text-right">{fmtScore(r.score)}</span>
                    </span>
                  </span>
                  <span className="w-20 text-right text-text-secondary text-xs tabular-nums">{fmtPct(r.coveragePct)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-text-tertiary">
        El orden combina lo que tienes parado (valor), lo que se mueve (rotación) y lo que históricamente
        descuadra o se tira (riesgo). Un artículo barato pero que rota o falla mucho sube por encima de uno
        caro y quieto. Los marcados como críticos van arriba pase lo que pase, aunque valgan poco.
      </p>
    </div>
  )
}
