// src/components/team/CoverageGapPanel.tsx
// F7 — Cobertura: huecos y excesos con coste real, sobre el cuadrante existente.
// Semáforo permitido aquí a propósito (decisión 10/07: reservado para cobertura,
// no para demanda). rojo = falta, ámbar = sobra, neutro = ajustado.

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown, ChevronUp, AlertTriangle, TrendingUp, TrendingDown, Euro, Info,
} from 'lucide-react'
import { fetchScheduleCoverageGap, type CoverageGapHour } from '../../services/coverageGapService'
import { DAY_LABELS_SHORT, type DayOfWeek } from '../../types/scheduler'

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const eur0 = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

interface Props {
  accountId: string | null
  locationId: string
  weekStart: string
  canSeeCosts: boolean
}

export default function CoverageGapPanel({ accountId, locationId, weekStart, canSeeCosts }: Props) {
  const [rows, setRows] = useState<CoverageGapHour[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [selectedHour, setSelectedHour] = useState<{ fecha: string; hora: number } | null>(null)

  useEffect(() => {
    if (!accountId || !locationId) { setRows([]); return }
    let cancel = false
    setLoading(true)
    fetchScheduleCoverageGap(accountId, locationId, weekStart).then(r => {
      if (!cancel) { setRows(r); setLoading(false) }
    })
    return () => { cancel = true }
  }, [accountId, locationId, weekStart])

  const byDayFecha = useMemo(() => DAYS.map(d => addDaysISO(weekStart, d)), [weekStart])

  // Rango de horas a pintar: solo las que tienen algo (falta o asignado) en
  // ALGÚN día — evita una rejilla de madrugada vacía sin sentido.
  const hourRange = useMemo(() => {
    const hs = rows.filter(r => r.required > 0 || r.assigned > 0).map(r => r.hora)
    if (hs.length === 0) return []
    const min = Math.min(...hs), max = Math.max(...hs)
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  }, [rows])

  const byFechaHora = useMemo(() => {
    const m = new Map<string, CoverageGapHour>()
    for (const r of rows) m.set(`${r.fecha}:${r.hora}`, r)
    return m
  }, [rows])

  const weekSummary = useMemo(() => {
    const cost = rows.reduce((a, r) => a + r.costHour, 0)
    const assignedHours = rows.reduce((a, r) => a + r.assigned, 0)
    const faltan = rows.reduce((a, r) => a + (r.gap < 0 ? -r.gap : 0), 0)
    const sobran = rows.reduce((a, r) => a + (r.gap > 0 ? r.gap : 0), 0)
    const costPartial = rows.some(r => r.costIsPartial)
    const avgCostPerHour = assignedHours > 0 ? cost / assignedHours : 0
    const excessCost = sobran * avgCostPerHour
    return { cost, faltan, sobran, costPartial, excessCost }
  }, [rows])

  const daySummaries = useMemo(() => {
    return byDayFecha.map(fecha => {
      const dayRows = rows.filter(r => r.fecha === fecha)
      const faltan = dayRows.reduce((a, r) => a + (r.gap < 0 ? -r.gap : 0), 0)
      const sobran = dayRows.reduce((a, r) => a + (r.gap > 0 ? r.gap : 0), 0)
      const cost = dayRows.reduce((a, r) => a + r.costHour, 0)
      const costPartial = dayRows.some(r => r.costIsPartial)
      return { fecha, faltan, sobran, cost, costPartial }
    })
  }, [byDayFecha, rows])

  // El día que más lo necesita: mayor déficit, no el que más coste tiene.
  const worstDay = useMemo(() => {
    return daySummaries.reduce((worst, d) => (d.faltan > (worst?.faltan ?? -1) ? d : worst), null as typeof daySummaries[number] | null)
  }, [daySummaries])

  if (!locationId) return null

  return (
    <div className="bg-card border border-border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-page transition-base text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">Cobertura y coste</span>
          {loading && <span className="text-xs text-text-secondary">cargando…</span>}
        </div>
        <div className="flex items-center gap-4 text-xs flex-wrap justify-end">
          {canSeeCosts && (
            <span className="inline-flex items-center gap-1 text-text-secondary">
              <Euro size={12} /> {eur0(weekSummary.cost)}{weekSummary.costPartial && <AlertTriangle size={11} className="text-warning" />}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-danger font-medium">
            <TrendingDown size={12} /> faltan {weekSummary.faltan}h
          </span>
          <span className="inline-flex items-center gap-1 text-warning font-medium">
            <TrendingUp size={12} /> sobran {weekSummary.sobran}h
            {canSeeCosts && weekSummary.sobran > 0 && ` (${eur0(weekSummary.excessCost)})`}
          </span>
          {expanded ? <ChevronUp size={16} className="text-text-secondary" /> : <ChevronDown size={16} className="text-text-secondary" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-default p-4 space-y-4">
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-text-secondary text-center py-4">Sin modelo de trabajo configurado para este local — no hay con qué comparar el cuadrante.</p>
          ) : (
            <>
              {worstDay && worstDay.faltan > 0 && (
                <div className="bg-danger-bg border border-danger/30 rounded-lg p-3 text-sm text-danger">
                  <strong className="capitalize">{DAY_LABELS_SHORT[(byDayFecha.indexOf(worstDay.fecha)) as DayOfWeek]}</strong> es el día más tenso: faltan <strong>{worstDay.faltan}h-persona</strong>
                  {worstDay.sobran > 0 && <> y a la vez sobran <strong>{worstDay.sobran}h</strong> en otras horas — no es falta de plantilla, está mal colocada.</>}
                </div>
              )}

              {/* Resumen por día */}
              <div className="grid grid-cols-7 gap-1.5">
                {daySummaries.map((d, i) => (
                  <div key={d.fecha} className="text-center">
                    <p className="text-[10px] font-semibold text-text-secondary uppercase">{DAY_LABELS_SHORT[i as DayOfWeek]}</p>
                    <div className="mt-1 rounded-lg border border-border-default p-1.5">
                      {d.faltan > 0 && <p className="text-[11px] font-bold text-danger">-{d.faltan}h</p>}
                      {d.sobran > 0 && <p className="text-[11px] font-bold text-warning">+{d.sobran}h</p>}
                      {d.faltan === 0 && d.sobran === 0 && <p className="text-[11px] text-text-tertiary">—</p>}
                      {canSeeCosts && <p className="text-[9px] text-text-secondary mt-0.5">{eur0(d.cost)}{d.costPartial && '*'}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Rejilla hora × día */}
              {hourRange.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr>
                        <th className="p-1 text-right text-text-secondary font-medium w-8"></th>
                        {byDayFecha.map((fecha, i) => (
                          <th key={fecha} className="p-1 text-center text-text-secondary font-semibold">{DAY_LABELS_SHORT[i as DayOfWeek]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hourRange.map(hora => (
                        <tr key={hora}>
                          <td className="p-0.5 text-right text-text-secondary tabular-nums">{hora}h</td>
                          {byDayFecha.map(fecha => {
                            const cell = byFechaHora.get(`${fecha}:${hora}`)
                            const gap = cell?.gap ?? 0
                            const tone = gap < 0 ? 'bg-danger text-white' : gap > 0 ? 'bg-warning-bg text-warning' : 'bg-page text-text-tertiary'
                            const clickable = gap < 0
                            return (
                              <td key={fecha} className="p-0.5">
                                <button
                                  disabled={!clickable}
                                  onClick={() => setSelectedHour({ fecha, hora })}
                                  className={`w-full h-6 rounded flex items-center justify-center font-bold tabular-nums transition-base ${tone} ${clickable ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
                                  title={cell ? `${cell.assigned} asignados / ${cell.required} necesarios` : ''}
                                >
                                  {gap !== 0 ? (gap > 0 ? `+${gap}` : gap) : ''}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedHour && (
                <div className="bg-page border border-border-default rounded-lg p-3 text-xs text-text-secondary flex items-start justify-between gap-2">
                  <span>
                    <strong className="text-text-primary">{selectedHour.fecha} · {selectedHour.hora}h</strong> — todavía no hay datos de disponibilidad de empleados para sugerir a quién puede cubrir esta hora.
                  </span>
                  <button onClick={() => setSelectedHour(null)} className="text-text-secondary hover:text-text-primary shrink-0">✕</button>
                </div>
              )}

              <div className="text-[10px] text-text-secondary border-t border-border-default pt-2 flex items-start gap-1.5">
                <Info size={11} className="shrink-0 mt-0.5" />
                <span>
                  El hueco es TOTAL de personas — todavía no hay desglose por rol (falta <code>staff_role_id</code> en los turnos).
                  Solo cuenta roles con demanda real configurada (cocina, reparto); servicio/otro no tienen driver todavía.
                  {weekSummary.costPartial && ' Algún asignado no tiene nómina cargada — el coste mostrado está infravalorado (*).'}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
