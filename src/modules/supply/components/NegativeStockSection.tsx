// src/modules/supply/components/NegativeStockSection.tsx
//
// Vigía de stock negativo (Fase B, 10/08). Lee negative_stock_report y enseña
// los artículos×local con qty_on_hand < 0 que CRUZAN el umbral anti-ruido
// (is_alert), con su causa probable y la acción que toca.
//
// Decisión de Julio: permitir + avisar, NUNCA bloquear ni poner a cero. No hay
// botón que "arregle" nada — la corrección es operativa (cargar compra / dar
// de alta producción / conteo físico). Los artículos por debajo del umbral
// (ruido, tipo Tomate Pera) NO se listan aquí para no distraer, pero no están
// escondidos: se ven en Existencias con su cifra real.

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ShieldCheck, Settings2 } from 'lucide-react'
import {
  getNegativeStockReport, negativeStockCauseLabel, negativeStockCauseAction,
  type NegativeStockItem,
} from '@/modules/supply/services/negativeStockService'
import { formatBaseQty } from '@/modules/supply/lib/stockDisplay'

const CAUSE_CLASS: Record<NegativeStockItem['cause'], string> = {
  sin_entradas: 'bg-warning-bg text-warning border-warning/20',
  compras_por_detras: 'bg-danger-bg text-danger border-danger/20',
  otras_salidas: 'bg-page text-text-secondary border-border-default',
}

export default function NegativeStockSection({
  accountId, locationId, onError,
}: {
  accountId: string
  locationId: string
  onError: (m: string) => void
}) {
  const [items, setItems] = useState<NegativeStockItem[]>([])
  const [windowDays, setWindowDays] = useState(60)
  const [relPct, setRelPct] = useState(5)
  const [absQty, setAbsQty] = useState(5)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!accountId || !locationId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    getNegativeStockReport(accountId, locationId)
      .then(r => {
        if (cancelled) return
        setItems(r.items)
        setWindowDays(r.windowDays)
        setRelPct(r.thresholdRelPct)
        setAbsQty(r.thresholdAbsQty)
      })
      .catch(e => { if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando el stock negativo.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId]) // eslint-disable-line react-hooks/exhaustive-deps

  const alerts = items.filter(i => i.isAlert)
  const noise = items.filter(i => !i.isAlert)

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Calculando stock negativo…</div>
  }

  return (
    <div className="space-y-3">
      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-border-default bg-card text-sm text-text-secondary">
          <ShieldCheck size={18} className="text-success shrink-0" />
          Sin alertas de stock negativo en este local (umbral: {relPct} % del consumo reciente, o {absQty} unidad(es) base como mínimo).
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="flex-1">Artículo</span>
            <span className="w-28 text-right">Stock</span>
            <span className="w-24 text-right">% consumo</span>
            <span className="w-40">Causa</span>
            <span className="flex-1">Acción</span>
          </div>
          {alerts.map(i => (
            <div key={i.recipeItemId} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
              <span className="flex-1 min-w-0 text-sm text-text-primary truncate">{i.name}</span>
              <span className="w-28 text-right text-sm font-medium text-danger tabular-nums">
                {formatBaseQty(i.qtyOnHand, i.unitAbbr)}
              </span>
              <span className="w-24 text-right text-xs text-text-tertiary tabular-nums">
                {i.ratioPct == null ? 'sin consumo' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(i.ratioPct)} %`}
              </span>
              <span className="w-40">
                <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded border ${CAUSE_CLASS[i.cause]}`}>
                  {negativeStockCauseLabel(i.cause)}
                </span>
              </span>
              <span className="flex-1 text-xs text-text-secondary">{negativeStockCauseAction(i.cause)}</span>
            </div>
          ))}
        </div>
      )}

      {noise.length > 0 && (
        <p className="text-xs text-text-tertiary flex items-center gap-1.5">
          <AlertTriangle size={13} className="shrink-0" />
          +{noise.length} artículo{noise.length === 1 ? '' : 's'} en negativo por debajo del umbral (ruido, no listados aquí) —
          se ven con su cifra real en Existencias.
        </p>
      )}

      <p className="text-xs text-text-tertiary leading-relaxed flex items-start gap-1.5">
        <Settings2 size={13} className="shrink-0 mt-0.5" />
        No se bloquea ninguna venta ni consumo, ni se pone nada a cero: el stock que ves es el real. "% consumo" compara
        contra el consumo de los últimos {windowDays} días (o el histórico si no hay consumo reciente). Umbrales
        ajustables en Recepciones → Ajustes de avisos.
      </p>
    </div>
  )
}
