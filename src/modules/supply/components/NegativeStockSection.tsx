// src/modules/supply/components/NegativeStockSection.tsx
//
// Vigía de stock negativo (Fase B, 10/08). Lee negative_stock_report y enseña
// los artículos×local con qty_on_hand < 0 que CRUZAN el umbral anti-ruido
// (is_alert), con su causa probable y la acción que toca.
//
// Decisión de Julio: permitir + avisar, NUNCA bloquear ni poner a cero.
// **El botón de acción NO pone el stock a cero ni "resuelve" nada por sí solo**
// — enruta al remedio correcto (recepción o ajuste/conteo) donde LA PERSONA
// mete la cifra real. Los artículos por debajo del umbral (ruido, tipo Tomate
// Pera) NO se listan aquí para no distraer, pero no están escondidos: se ven
// en Existencias con su cifra real.
//
// Enrutado por causa (10/08, "vigía con acción pulsable"):
//   - otras_salidas      → SIEMPRE ajuste/conteo (AdjustStockModal): la causa ya
//                          dice que no es solo compras vs consumo.
//   - compras_por_detras → nueva recepción (tiene article_supplier por
//                          definición: ya hay recepciones registradas).
//   - sin_entradas       → si tiene proveedor vinculado, compra nunca cargada →
//                          nueva recepción. Si NO tiene proveedor, es probable
//                          elaboración de casa (Guacamole, salsas): no existe
//                          todavía un movimiento de "alta de producción" en
//                          stock_movement (solo apertura/recepción/consumo/
//                          ajuste) — de momento cae a ajuste/conteo, con la
//                          persona metiendo el número real. El alta de
//                          producción es DEUDA aparte (§Fase B del hallazgo),
//                          no se inventa aquí.
//
// folvy_reglas.md §2 — un error NO es "cero resultados": si la carga falla,
// esta sección muestra ESTADO DE ERROR, nunca "Sin alertas" (un vigía que dice
// "todo bien" al fallar es peor que no tener vigía). `loadError` distingue
// "cargó y vino vacío" (verde, legítimo) de "no cargó" (rojo, reintentar).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertTriangle, ShieldCheck, Settings2, RefreshCw, ArrowRight } from 'lucide-react'
import {
  getNegativeStockReport, negativeStockCauseLabel, negativeStockCauseAction,
  type NegativeStockItem,
} from '@/modules/supply/services/negativeStockService'
import { listSuppliersByItem } from '@/modules/kitchen/services/purchaseFormatService'
import { formatBaseQty } from '@/modules/supply/lib/stockDisplay'
import { useApp } from '@/context/AppContext'
import AdjustStockModal, { type AdjustStockTarget } from '@/modules/supply/components/AdjustStockModal'

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
  const navigate = useNavigate()
  const { userProfile, authUserId } = useApp()
  const actorId = authUserId ?? null
  const actorName = userProfile?.displayName ?? null

  const [items, setItems] = useState<NegativeStockItem[]>([])
  const [windowDays, setWindowDays] = useState(60)
  const [relPct, setRelPct] = useState(5)
  const [absQty, setAbsQty] = useState(5)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<AdjustStockTarget | null>(null)

  useEffect(() => {
    if (!accountId || !locationId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getNegativeStockReport(accountId, locationId)
      .then(r => {
        if (cancelled) return
        setItems(r.items)
        setWindowDays(r.windowDays)
        setRelPct(r.thresholdRelPct)
        setAbsQty(r.thresholdAbsQty)
      })
      .catch(e => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Error cargando el stock negativo.'
        console.warn('[NegativeStockSection] negative_stock_report falló:', e)
        setLoadError(msg)
        onError(msg)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const alerts = items.filter(i => i.isAlert)
  const noise = items.filter(i => !i.isAlert)

  function openAdjust(item: NegativeStockItem) {
    setAdjustTarget({
      recipeItemId: item.recipeItemId,
      name: item.name,
      currentQtyBase: item.qtyOnHand,
      unitAbbr: item.unitAbbr,
    })
  }

  // Enruta al remedio de ESE artículo. Nunca escribe stock aquí: solo abre el
  // sitio correcto (recepción o ajuste) para que la persona meta la cifra real.
  async function handleAction(item: NegativeStockItem) {
    if (resolvingId) return
    if (item.cause === 'otras_salidas') { openAdjust(item); return }
    setResolvingId(item.recipeItemId)
    try {
      const suppliers = await listSuppliersByItem(item.recipeItemId)
      const best = suppliers.find(s => s.isPreferred) ?? suppliers[0] ?? null
      if (best) {
        // Nueva recepción con el proveedor y el artículo ya listos — la persona
        // teclea la cantidad REAL recibida, nada se rellena solo.
        navigate('/supply/recepciones', {
          state: { quickReceipt: { supplierId: best.supplierId, search: item.name } },
        })
      } else {
        // Sin proveedor vinculado: no hay "nueva recepción" que abrir con
        // sentido. Elaboración de casa probable — al ajuste/conteo mientras no
        // exista un alta de producción (deuda declarada, no se inventa aquí).
        openAdjust(item)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo abrir el remedio.')
    } finally {
      setResolvingId(null)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-text-secondary text-sm p-4"><Loader2 size={15} className="animate-spin" /> Calculando stock negativo…</div>
  }

  // NUNCA "Sin alertas" aquí: si falló la carga, no sabemos si hay alertas o no.
  if (loadError) {
    return (
      <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-danger/30 bg-danger-bg text-sm">
        <span className="text-danger">No se pudo cargar el stock negativo. {loadError}</span>
        <button type="button" onClick={() => setReloadTick(t => t + 1)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-danger/30 text-danger hover:bg-danger/10 transition-base shrink-0">
          <RefreshCw size={13} /> Reintentar
        </button>
      </div>
    )
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
              <span className="flex-1">
                <button type="button" onClick={() => handleAction(i)} disabled={resolvingId === i.recipeItemId}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:opacity-80 disabled:opacity-50 transition-base text-left">
                  {resolvingId === i.recipeItemId
                    ? <Loader2 size={13} className="animate-spin shrink-0" />
                    : <ArrowRight size={13} className="shrink-0" />}
                  {negativeStockCauseAction(i.cause)}
                </button>
              </span>
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

      {adjustTarget && (
        <AdjustStockModal
          accountId={accountId}
          locationId={locationId}
          actorId={actorId}
          actorName={actorName}
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={() => { setAdjustTarget(null); setReloadTick(t => t + 1) }}
        />
      )}
    </div>
  )
}
