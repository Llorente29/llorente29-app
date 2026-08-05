// src/modules/supply/components/SaleTicketPanel.tsx
//
// PANTALLA 2 — El ticket que originó un movimiento de stock. Se abre desde el
// "ojo" de la Pantalla 1 (ItemMovementsPanel) y vuelve a ella sin perder ni el
// scroll ni los filtros (el estado vive en el padre; esto es solo una capa).
//
// El coste y el margen NO se calculan aquí: vienen de sale_line.computed_cost,
// que es lo que sella compute_sale_line_cost. Cuando hay líneas sin escandallo
// resuelto se dice EN PANTALLA ("coste incompleto") en vez de pintar un margen
// redondo que sería optimista y falso.
//
// Almacén y lotes por línea: el modelo de datos no los guarda todavía. Se
// dejan las columnas como hueco preparado con "—", sin inventar el dato.

import { useEffect, useState } from 'react'
import { X, Loader2, AlertTriangle, Receipt } from 'lucide-react'
import { getSaleTicket, type SaleTicket } from '../services/itemTraceService'

const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${nf2.format(v)} €`
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${nf2.format(v)} %`
}
function fmtQty(v: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v)
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_CHIP: Record<string, string> = {
  completed: 'bg-success-bg text-success',
  accepted: 'bg-accent-bg text-accent',
  cancelled: 'bg-danger-bg text-danger',
}

export default function SaleTicketPanel({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const [ticket, setTicket] = useState<SaleTicket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setError(null)
    getSaleTicket(saleId)
      .then(t => { if (!cancel) setTicket(t) })
      .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'No se pudo cargar el ticket') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [saleId])

  const h = ticket?.sale ?? null
  // Las líneas hijas (modificador / componente de combo) se muestran indentadas
  // bajo su padre, no como filas sueltas: un combo es UNA cosa que se vendió.
  const parents = (ticket?.lines ?? []).filter(l => !l.parentId)
  const childrenOf = (id: string) => (ticket?.lines ?? []).filter(l => l.parentId === id)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card w-full max-w-4xl h-full overflow-y-auto shadow-lg">
        {/* Cabecera */}
        <div className="sticky top-0 bg-card border-b border-border-default px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-text-secondary uppercase tracking-wide flex items-center gap-1.5">
              <Receipt size={13} /> Ticket
            </p>
            <p className="font-display text-xl text-text-primary truncate">
              {h?.brand ?? 'Venta'}
              {h?.ticketCode && <span className="text-text-secondary font-normal"> · {h.ticketCode}</span>}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {fmtDateTime(h?.soldAt ?? null)}
              {h?.channel && ` · ${h.channel}`}
              {h?.location && ` · ${h.location}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {h?.orderStatus && (
              <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_CHIP[h.orderStatus] ?? 'bg-page text-text-secondary'}`}>
                {h.orderStatus}
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-page text-text-secondary" aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-text-secondary text-sm py-10 justify-center">
              <Loader2 size={16} className="animate-spin" /> Cargando ticket…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg p-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {!loading && !error && h && (
            <>
              {/* KPIs del ticket */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi label="Base" value={fmtEur(h.taxableBase ?? h.total)} />
                <Kpi label="IVA" value={fmtEur(h.tax)} />
                <Kpi label="Total" value={fmtEur(h.total)} strong />
                <Kpi label="Descuento" value={fmtEur(h.discountAmount)} />
                <Kpi label="Coste" value={fmtEur(h.cost)} />
                <Kpi label="Aportación" value={fmtEur(h.marginEur)} />
                <Kpi label="Margen" value={fmtPct(h.marginPct)} strong />
                <Kpi label="Servicio" value={h.serviceType ?? '—'} />
              </div>

              {/* Aviso honesto: sin escandallo completo, el margen es optimista. */}
              {!h.costComplete && (
                <div className="flex items-start gap-2 text-xs text-warning bg-warning-bg border border-warning/30 rounded-lg p-3">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    {h.linesWithoutCost} línea{h.linesWithoutCost === 1 ? '' : 's'} sin escandallo resuelto: el coste
                    de este ticket está incompleto y el margen que ves es <strong>mejor que el real</strong>.
                  </span>
                </div>
              )}

              {/* Líneas */}
              <div className="border border-border-default rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
                  <span className="w-14 text-right">Cant.</span>
                  <span className="flex-1">Producto</span>
                  <span className="w-20 text-right">P. unit.</span>
                  <span className="w-20 text-right">C. unit.</span>
                  <span className="w-24 text-right">Aportación</span>
                  <span className="w-16 text-right">Margen</span>
                  <span className="w-28">Almacén</span>
                  <span className="w-20 text-right">Importe</span>
                </div>

                {parents.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-text-secondary">Este ticket no tiene líneas.</div>
                )}

                {parents.map(l => (
                  <div key={l.id}>
                    <div className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
                      <span className="w-14 text-right text-sm tabular-nums text-text-primary">{fmtQty(l.quantity)}</span>
                      <span className="flex-1 min-w-0">
                        <span className={`text-sm truncate block ${l.ignored ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>
                          {l.productName}
                        </span>
                        <span className="flex items-center gap-1 flex-wrap mt-0.5">
                          {l.discountLabel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-bg text-warning">{l.discountLabel}</span>
                          )}
                          {l.needsReview && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-bg text-danger">sin casar</span>
                          )}
                          {l.computedCost == null && !l.needsReview && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-page text-text-tertiary">sin escandallo</span>
                          )}
                        </span>
                      </span>
                      <span className="w-20 text-right text-xs tabular-nums text-text-secondary">{fmtEur(l.unitPrice)}</span>
                      <span className="w-20 text-right text-xs tabular-nums text-text-secondary">{fmtEur(l.unitCost)}</span>
                      <span className="w-24 text-right text-xs tabular-nums text-text-secondary">{fmtEur(l.contribution)}</span>
                      <span className="w-16 text-right text-xs tabular-nums text-text-secondary">{fmtPct(l.marginPct)}</span>
                      <span className="w-28 text-xs text-text-tertiary">{l.warehouse ?? '—'}</span>
                      <span className="w-20 text-right text-sm tabular-nums text-text-primary">{fmtEur(l.lineTotal)}</span>
                    </div>

                    {childrenOf(l.id).map(c => (
                      <div key={c.id} className="flex items-center gap-3 px-3 py-1.5 border-t border-border-default bg-page/40">
                        <span className="w-14 text-right text-xs tabular-nums text-text-tertiary">{fmtQty(c.quantity)}</span>
                        <span className="flex-1 min-w-0 text-xs text-text-secondary truncate pl-4">
                          ↳ {c.productName}
                          <span className="text-text-tertiary"> · {c.lineType}</span>
                        </span>
                        <span className="w-20 text-right text-xs tabular-nums text-text-tertiary">{fmtEur(c.unitPrice)}</span>
                        <span className="w-20" />
                        <span className="w-24" />
                        <span className="w-16" />
                        <span className="w-28" />
                        <span className="w-20 text-right text-xs tabular-nums text-text-tertiary">{fmtEur(c.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Pie: desglose fiscal */}
                <div className="flex items-center justify-end gap-6 px-3 py-2.5 bg-page border-t border-border-default text-xs">
                  <span className="text-text-secondary">Base <span className="tabular-nums text-text-primary">{fmtEur(h.taxableBase ?? h.total)}</span></span>
                  <span className="text-text-secondary">IVA <span className="tabular-nums text-text-primary">{fmtEur(h.tax)}</span></span>
                  <span className="text-text-primary font-medium">Total <span className="tabular-nums">{fmtEur(h.total)}</span></span>
                </div>
              </div>
            </>
          )}

          {!loading && !error && !h && (
            <div className="text-center py-10 text-sm text-text-secondary">No se encontró esta venta.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border border-border-default rounded-lg px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-base font-semibold text-text-primary' : 'text-sm text-text-secondary'}`}>
        {value}
      </p>
    </div>
  )
}
