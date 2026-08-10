// src/modules/supply/components/NegativeStockSection.tsx
//
// Vigía de stock negativo (Fase B, 10/08). Lee negative_stock_report y enseña
// los artículos×local con qty_on_hand < 0 que CRUZAN el umbral anti-ruido
// (is_alert), con su causa probable y los remedios disponibles.
//
// Decisión de Julio: permitir + avisar, NUNCA bloquear ni poner a cero.
// **Ningún botón pone el stock a cero ni "resuelve" nada por sí solo** —
// enruta al remedio correcto donde LA PERSONA mete la cifra real.
//
// Refinamiento 10/08 — la causa es una HIPÓTESIS, no una orden:
//   consumo > recepción no PRUEBA que falte una compra; puede ser un error de
//   escandallo, una merma, personal, un traspaso… Forzar "nueva recepción" por
//   una corazonada del sistema estaría mal. Por eso:
//   - "Ajustar / Contar" (AdjustStockModal) es el remedio UNIVERSAL: está
//     SIEMPRE disponible, sea cual sea la causa. Es donde vive la verdad (la
//     persona mete cifra real + motivo real: escandallo, merma, personal,
//     traspaso, recuento, o "faltaba cargar la compra").
//   - "Cargar recepción" es un ATAJO OPCIONAL, disponible SOLO si el artículo
//     tiene proveedor vinculado (article_supplier) — nunca sustituye ni
//     bloquea el ajuste, se ofrece ADEMÁS.
//   - La causa (badge + texto) es una PISTA ("Probablemente…"), no manda.
//   Consecuencia para elaboraciones de casa (Guacamole, sin proveedor): solo
//   queda "Ajustar/Contar" — correcto, porque el alta de producción como
//   movimiento propio no existe todavía (deuda aparte, §Fase B del hallazgo;
//   no se inventa aquí).
//
// folvy_reglas.md §2 — un error NO es "cero resultados": si la carga falla,
// esta sección muestra ESTADO DE ERROR, nunca "Sin alertas" (un vigía que dice
// "todo bien" al fallar es peor que no tener vigía). `loadError` distingue
// "cargó y vino vacío" (verde, legítimo) de "no cargó" (rojo, reintentar).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertTriangle, ShieldCheck, Settings2, RefreshCw, SlidersHorizontal, PackagePlus } from 'lucide-react'
import {
  getNegativeStockReport, negativeStockCauseLabel, negativeStockCauseHint,
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
  const [adjustTarget, setAdjustTarget] = useState<AdjustStockTarget | null>(null)

  // Proveedor por artículo — SOLO determina si se ofrece el atajo "Cargar
  // recepción" (ADEMÁS de "Ajustar/Contar", nunca en su lugar). No bloquea el
  // resto de la pantalla: si falla, esas filas simplemente se quedan sin el
  // atajo opcional (siguen teniendo "Ajustar/Contar").
  const [supplierByItem, setSupplierByItem] = useState<Map<string, string>>(new Map())

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

  // Resuelve el proveedor (preferente/activo) de cada artículo en alerta, en
  // bloque, para decidir qué filas ofrecen "Cargar recepción". Independiente
  // de la causa: el atajo se ofrece por disponibilidad real de proveedor, no
  // por lo que el sistema sospeche.
  useEffect(() => {
    const ids = items.filter(i => i.isAlert).map(i => i.recipeItemId)
    if (ids.length === 0) { setSupplierByItem(new Map()); return }
    let cancelled = false
    Promise.all(ids.map(id =>
      listSuppliersByItem(id)
        .then(suppliers => {
          const best = suppliers.find(s => s.isPreferred) ?? suppliers[0] ?? null
          return [id, best?.supplierId ?? null] as const
        })
        .catch(e => {
          console.warn('[NegativeStockSection] listSuppliersByItem falló para', id, e)
          return [id, null] as const
        }),
    )).then(pairs => {
      if (cancelled) return
      const m = new Map<string, string>()
      for (const [id, supplierId] of pairs) if (supplierId) m.set(id, supplierId)
      setSupplierByItem(m)
    })
    return () => { cancelled = true }
  }, [items])

  function openAdjust(item: NegativeStockItem) {
    setAdjustTarget({
      recipeItemId: item.recipeItemId,
      name: item.name,
      currentQtyBase: item.qtyOnHand,
      unitAbbr: item.unitAbbr,
    })
  }

  function openReceipt(item: NegativeStockItem, supplierId: string) {
    // Nueva recepción con el proveedor y el artículo ya listos — la persona
    // teclea la cantidad REAL recibida, nada se rellena solo.
    navigate('/supply/recepciones', {
      state: { quickReceipt: { supplierId, search: item.name } },
    })
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
            <span className="w-52">Causa probable</span>
            <span className="w-64">Acciones</span>
          </div>
          {alerts.map(i => {
            const supplierId = supplierByItem.get(i.recipeItemId) ?? null
            return (
              <div key={i.recipeItemId} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0">
                <span className="flex-1 min-w-0 text-sm text-text-primary truncate">{i.name}</span>
                <span className="w-28 text-right text-sm font-medium text-danger tabular-nums">
                  {formatBaseQty(i.qtyOnHand, i.unitAbbr)}
                </span>
                <span className="w-24 text-right text-xs text-text-tertiary tabular-nums">
                  {i.ratioPct == null ? 'sin consumo' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(i.ratioPct)} %`}
                </span>
                <span className="w-52">
                  <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded border ${CAUSE_CLASS[i.cause]}`}>
                    {negativeStockCauseLabel(i.cause)}
                  </span>
                  <span className="block text-[10px] text-text-tertiary mt-1 leading-snug">{negativeStockCauseHint(i.cause)}</span>
                </span>
                <span className="w-64 flex flex-col items-start gap-1">
                  <button type="button" onClick={() => openAdjust(i)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:opacity-80 transition-base">
                    <SlidersHorizontal size={13} className="shrink-0" /> Ajustar / Contar
                  </button>
                  {supplierId && (
                    <button type="button" onClick={() => openReceipt(i, supplierId)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-base">
                      <PackagePlus size={13} className="shrink-0" /> Cargar recepción
                    </button>
                  )}
                </span>
              </div>
            )
          })}
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
