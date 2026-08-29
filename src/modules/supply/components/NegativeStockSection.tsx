// src/modules/supply/components/NegativeStockSection.tsx
//
// Vigía de stock negativo (Fase B, 10/08). Lee negative_stock_report y enseña
// TODOS los artículos×local con qty_on_hand < 0, con su causa probable y los
// remedios disponibles.
//
// UN UMBRAL ORDENA, NO ESCONDE (29/08/2026 — regla de CLAUDE.md).
// Hasta hoy esta sección listaba SOLO los que cruzan el umbral (is_alert) y
// resumía el resto en una nota: «+9 artículos en negativo por debajo del umbral
// (ruido, no listados aquí)». A la vez, la pantalla de Pedidos enseñaba
// Coca-Cola Original Lata con −10 ud. Julio: «no tiene sentido ver en el stock
// negativos que cuando vas a la pantalla de negativos específica no aparecen».
//
// El umbral no era el problema: Coca-Cola se quedaba fuera por 2,7 latas, y el
// umbral hace bien su trabajo priorizando. El problema era usarlo para decidir
// la EXISTENCIA de la fila en vez de su ORDEN.
//
// Ahora: todos los negativos en una sola lista, los que cruzan el umbral
// arriba y marcados «revisar», el resto debajo en gris y marcados «menor»,
// cada uno con su cifra y su % sobre consumo. El umbral sigue igual y se sigue
// ajustando en Recepciones → Ajustes de avisos: ahora ordena.
//
// La nota de «+N no listados» se ha ido, y no debe volver: si una pantalla
// necesita esa nota para ser honesta, el filtro está en el sitio equivocado.
// Esa nota no es transparencia, es la confesión de que el diseño sabe que está
// escondiendo algo.
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
import { Loader2, ShieldCheck, Settings2, RefreshCw, SlidersHorizontal, PackagePlus } from 'lucide-react'
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

  // ORDEN, NO FILTRO: los que cruzan el umbral primero; dentro de cada grupo,
  // el más negativo respecto a su consumo arriba. Nadie desaparece.
  const alerts = items.filter(i => i.isAlert)
  const menores = items.filter(i => !i.isAlert)
  const ordenados = [...alerts, ...menores]

  // Resuelve el proveedor (preferente/activo) de cada artículo en alerta, en
  // bloque, para decidir qué filas ofrecen "Cargar recepción". Independiente
  // de la causa: el atajo se ofrece por disponibilidad real de proveedor, no
  // por lo que el sistema sospeche.
  useEffect(() => {
    // Para TODOS, no solo los de alerta: ahora todas las filas se pintan y
    // todas ofrecen sus remedios. La lista de negativos es corta por naturaleza.
    const ids = items.map(i => i.recipeItemId)
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
      {/* El encabezado dice la VERDAD: "sin alertas" solo cuando no hay NINGÚN
          negativo. Si los hay pero ninguno cruza el umbral, se dice tal cual —
          que además informa más que un verde vacío. */}
      {items.length === 0 ? (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-border-default bg-card text-sm text-text-secondary">
          <ShieldCheck size={18} className="text-success shrink-0" />
          Sin stock negativo en este local.
        </div>
      ) : (
        <>
        {alerts.length === 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-border-default bg-card text-sm text-text-secondary">
            <ShieldCheck size={16} className="text-success shrink-0" />
            {items.length} artículo{items.length === 1 ? '' : 's'} en negativo · ninguno supera el umbral de revisión
            ({relPct} % del consumo reciente, o {absQty} unidad(es) base como mínimo).
          </div>
        )}
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default">
            <span className="w-20">Prioridad</span>
            <span className="flex-1">Artículo</span>
            <span className="w-28 text-right">Stock</span>
            <span className="w-24 text-right">% consumo</span>
            <span className="w-52">Causa probable</span>
            <span className="w-64">Acciones</span>
          </div>
          {ordenados.map(i => {
            const supplierId = supplierByItem.get(i.recipeItemId) ?? null
            return (
              <div key={i.recipeItemId} className={`flex items-center gap-3 px-3 py-2.5 border-t border-border-default first:border-t-0 ${i.isAlert ? '' : 'bg-page/40'}`}>
                <span className="w-20">
                  <span className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                    i.isAlert
                      ? 'border-danger/30 bg-danger-bg text-danger font-medium'
                      : 'border-border-default text-text-tertiary'}`}>
                    {i.isAlert ? 'revisar' : 'menor'}
                  </span>
                </span>
                <span className={`flex-1 min-w-0 text-sm truncate ${i.isAlert ? 'text-text-primary' : 'text-text-secondary'}`}>{i.name}</span>
                <span className={`w-28 text-right text-sm tabular-nums ${i.isAlert ? 'font-medium text-danger' : 'text-text-secondary'}`}>
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
        </>
      )}

      <p className="text-xs text-text-tertiary leading-relaxed flex items-start gap-1.5">
        <Settings2 size={13} className="shrink-0 mt-0.5" />
        Se listan TODOS los negativos: los marcados «revisar» cruzan el umbral y van primero; los «menor» están por
        debajo y se enseñan igual, con su cifra. No se bloquea ninguna venta ni consumo, ni se pone nada a cero: el
        stock que ves es el real. "% consumo" compara
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
