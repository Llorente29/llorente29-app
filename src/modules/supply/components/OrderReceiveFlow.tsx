// src/modules/supply/components/OrderReceiveFlow.tsx
//
// PANTALLA "RECEPCIONES" del trabajador / oficina. Rediseño P1.b (10/08) —
// ESCANEAR-PRIMERO, mobile-first. Crítica literal de Julio al probar P1:
// "El trabajador que recepciona abre su móvil, entra en recepción, escanea,
// rellena y ya está. ¿Cómo va a enlazarlo desde el móvil?"
//
// PRINCIPIO RECTOR: el camino del trabajador es abrir → escanear → contar →
// listo. Cero conceptos nuevos. Por eso la pantalla de aterrizaje ya NO obliga
// a elegir un pedido antes de nada — el botón grande "Escanear albarán" es la
// acción primaria y lleva DIRECTO al escáner; el casado con el pedido pasa
// SOLO, dentro de GoodsReceiptForm (score de proveedor+local+fecha+solape de
// líneas — ver ese fichero). "Pedidos pendientes" y "Contar a mano" siguen
// existiendo pero como secundarios, no como paso obligatorio.
//
// "Pedidos pendientes" muestra SOLO lo vivo (ventana configurable,
// supply_settings.dock_pending_window_*_days) + los recibido_parcial, con su
// "falta: X, Y" (líneas aún no completas) — nunca cadáveres de meses; eso vive
// en gestión (Pedidos → Pendiente de recepción / Saneado).
//
// Reusa GoodsReceiptForm (prop `order` enlaza el pedido; `ocrPrefill` trae lo
// leído; sin ninguna de las dos = recepción ciega) y ReceiptScanPanel (OCR).
//
// REUTILIZABLE en PC (GoodsReceiptsPage) y en el móvil del trabajador (TrabajadorApp).
// locationId (opcional): filtra los pedidos a ese local (el caso del trabajador).

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Loader2, PackageCheck, ChevronRight, Truck, Search, ScanLine, ListChecks, Camera,
} from 'lucide-react'
import {
  listPurchaseOrders, listPurchaseOrderLines,
  type PurchaseOrder, type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import GoodsReceiptForm, { type OcrPrefill } from '@/modules/supply/pages/GoodsReceiptForm'
import ReceiptScanPanel from '@/modules/supply/pages/ReceiptScanPanel'
import ReceiptWizard from '@/modules/supply/pages/ReceiptWizard'
import { getSupplySettings, listOrderLineReceived, type SupplySettings } from '@/modules/supply/services/goodsReceiptService'

interface Props {
  accountId: string
  /** Filtra los pedidos pendientes a este local. null/undefined = sin filtrar. */
  locationId?: string | null
  /** Política de confirmación del form ('by-location' en el móvil del trabajador). */
  confirmPolicy?: 'always' | 'by-location'
  onBack: () => void
  /** Se llama tras confirmar/guardar la recepción (mensaje opcional para flash). */
  onSaved: (message?: string) => void
}

// Estados que cuentan como "pendiente de recibir".
const PENDING_STATUSES: PurchaseOrderStatus[] = ['enviado', 'recibido_parcial']

const SETTINGS_DEFAULTS: SupplySettings = {
  priceAlertPct: 15, expiryAlertDays: 3, negotiatedAlertPct: 0, driftAlertPct: 25, driftWindowMonths: 6,
  negStockRelPct: 5, negStockAbsQty: 5, negStockWindowDays: 60,
  dockPendingWindowBeforeDays: 7, dockPendingWindowAfterDays: 3, hungOrderDaysThreshold: 14,
}

const STATUS_LABEL: Partial<Record<PurchaseOrderStatus, string>> = {
  enviado: 'Pendiente',
  recibido_parcial: 'Parcial',
}
const STATUS_CLASS: Partial<Record<PurchaseOrderStatus, string>> = {
  enviado: 'bg-accent-bg text-accent border-accent/20',
  recibido_parcial: 'bg-warning-bg text-warning border-warning/30',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' })
    .format(new Date(value))
}

// Paso interno. picked = pedido elegido (null en las vías "sin pedido").
type Step = 'landing' | 'choose' | 'manual' | 'scan' | 'form-scan'

export default function OrderReceiveFlow({ accountId, locationId, confirmPolicy, onBack, onSaved }: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  // "falta: X, Y" por pedido recibido_parcial (nombres de línea aún incompleta).
  const [missingByOrder, setMissingByOrder] = useState<Map<string, string[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const [step, setStep] = useState<Step>('landing')
  const [picked, setPicked] = useState<PurchaseOrder | null>(null)
  const [ocr, setOcr] = useState<OcrPrefill | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listPurchaseOrders({ accountId, locationId: locationId ?? undefined }),
      listSuppliers(accountId),
      getSupplySettings(accountId).catch(() => SETTINGS_DEFAULTS),
    ])
      .then(async ([rows, sups, settings]) => {
        if (cancelled) return
        const before = settings.dockPendingWindowBeforeDays
        const after = settings.dockPendingWindowAfterDays
        const nowMs = Date.now()
        // Solo lo vivo: "enviado" dentro de ventana, o CUALQUIER "recibido_parcial"
        // (sigue abierto, no es un cadáver — se queda hasta que se cierre o complete).
        // Sin expected_date: se usa order_date como referencia — igual de vivo no es
        // "sin fecha = para siempre" (así se colaba PED-00006, de junio, sin cerrar).
        const pending = rows.filter(o => {
          if (!PENDING_STATUSES.includes(o.status)) return false
          if (o.status === 'recibido_parcial') return true
          const refDate = o.expectedDate ?? o.orderDate
          const diffDays = (nowMs - new Date(refDate + 'T00:00:00').getTime()) / 86400000
          return diffDays <= before && diffDays >= -after
        })
        setOrders(pending)
        setSuppliers(sups)

        // "falta: X, Y" — solo para los recibido_parcial visibles (normalmente 0-1).
        const parciales = pending.filter(o => o.status === 'recibido_parcial')
        const missing = await Promise.all(parciales.map(async (o): Promise<readonly [string, string[]]> => {
          try {
            const [lines, received] = await Promise.all([
              listPurchaseOrderLines(o.id),
              listOrderLineReceived(o.id),
            ])
            const receivedByLine = new Map(received.map(r => [r.purchaseOrderLineId, r.receivedConfirmed]))
            const stillMissing = lines
              .filter(l => (receivedByLine.get(l.id) ?? 0) < l.qtyOrdered)
              .map(l => l.productName)
            return [o.id, stillMissing] as const
          } catch {
            return [o.id, []] as const
          }
        }))
        if (!cancelled) setMissingByOrder(new Map(missing))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los pedidos.')
        setOrders([]); setSuppliers([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, locationId, reloadTick])

  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>()
    suppliers.forEach(s => m.set(s.id, s.name))
    return m
  }, [suppliers])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return orders
    return orders.filter(o => {
      const code = (o.code ?? '').toLowerCase()
      const sup = (o.supplierId ? supplierNameById.get(o.supplierId) ?? '' : '').toLowerCase()
      return code.includes(q) || sup.includes(q)
    })
  }, [orders, search, supplierNameById])

  function backToLanding() {
    setStep('landing'); setPicked(null); setOcr(null); setReloadTick(t => t + 1)
  }
  // Volver desde el form/escáner: si venía de un pedido → a "cómo recibir"; si era
  // sin pedido → al aterrizaje.
  function backFromFlow() {
    setOcr(null)
    if (picked) setStep('choose')
    else backToLanding()
  }

  // ── Recepción a mano (contra pedido si picked; a ciegas si null — el casado
  //    con pedido, si aplica, lo decide GoodsReceiptForm solo) ──
  if (step === 'manual') {
    return (
      <GoodsReceiptForm
        accountId={accountId}
        order={picked ?? undefined}
        confirmPolicy={confirmPolicy}
        onBack={backFromFlow}
        onSaved={(msg) => { backToLanding(); onSaved(msg) }}
      />
    )
  }

  // ── Escaneo de albarán (OCR). Con o sin pedido detrás ──
  if (step === 'scan') {
    return (
      <ReceiptScanPanel
        accountId={accountId}
        onBack={backFromFlow}
        onCreateReceipt={(o) => { setOcr(o); setStep('form-scan') }}
      />
    )
  }

  // ── Recepción con el albarán leído, SIN pedido detrás — el caso normal del
  //    muelle (botón primario del aterrizaje, escanear-primero). ENCARGO CODE
  //    (13/08) feat/recepcion-v2-asistente: este es el mismo camino "OCR
  //    ciego" que GoodsReceiptsPage ya enruta al asistente — antes de esto,
  //    OrderReceiveFlow (que es el camino REAL del móvil del trabajador,
  //    TrabajadorApp, no tocado en el encargo original por error de alcance)
  //    seguía abriendo el formulario grande aquí, dejando el asistente
  //    inalcanzable en producción. Bug reportado por Julio 13/08.
  if (step === 'form-scan' && ocr && !picked) {
    return (
      <ReceiptWizard
        accountId={accountId}
        locationId={locationId ?? null}
        ocrPrefill={ocr}
        onBack={backFromFlow}
        onDone={(msg) => { backToLanding(); onSaved(msg) }}
      />
    )
  }

  // ── Recepción con el albarán leído, CONTRA UN PEDIDO elegido a propósito
  //    (fusión pedido+OCR: el formato ya viene dado, GoodsReceiptForm casa
  //    las líneas contra las del pedido) ──
  if (step === 'form-scan' && ocr) {
    return (
      <GoodsReceiptForm
        accountId={accountId}
        order={picked ?? undefined}
        confirmPolicy={confirmPolicy}
        ocrPrefill={ocr}
        onBack={backFromFlow}
        onSaved={(msg) => { backToLanding(); onSaved(msg) }}
      />
    )
  }

  const pickedSupplier = picked?.supplierId ? (supplierNameById.get(picked.supplierId) ?? 'Proveedor') : 'Sin proveedor'

  // ── Elegir cómo recibir el pedido seleccionado (shortcut desde la lista) ──
  if (step === 'choose' && picked) {
    return (
      <div className="min-h-screen bg-page">
        <div className="px-4 pt-5 pb-3 flex items-center gap-3">
          <button onClick={backToLanding} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base shrink-0" aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h2 className="text-xl font-display font-medium text-text-primary truncate">{pickedSupplier}</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              {picked.code ?? 'Sin código'} · Pedido {formatDate(picked.orderDate)}
              {picked.expectedDate ? ` · Entrega ${formatDate(picked.expectedDate)}` : ''}
            </p>
          </div>
        </div>

        <div className="px-4 pb-8 space-y-3 max-w-2xl mx-auto">
          <p className="text-sm text-text-secondary">¿Cómo quieres recibirlo?</p>

          <button onClick={() => setStep('scan')}
            className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-accent-bg flex items-center justify-center shrink-0">
              <ScanLine size={22} className="text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">Escanear albarán</p>
              <p className="text-xs text-text-secondary mt-0.5">La IA lee el papel y lo casa con las líneas del pedido.</p>
            </div>
            <ChevronRight size={18} className="text-text-secondary shrink-0" />
          </button>

          <button onClick={() => setStep('manual')}
            className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-page flex items-center justify-center shrink-0 border border-border-default">
              <ListChecks size={22} className="text-text-secondary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">Contar a mano</p>
              <p className="text-xs text-text-secondary mt-0.5">Cuenta lo que llega contra las líneas pedidas.</p>
            </div>
            <ChevronRight size={18} className="text-text-secondary shrink-0" />
          </button>
        </div>
      </div>
    )
  }

  // ── ATERRIZAJE: escanear (primario) · pedidos pendientes (referencia, solo
  //    lo vivo) · contar a mano (secundario, siempre disponible) ──
  return (
    <div className="min-h-screen bg-page">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base shrink-0" aria-label="Volver">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h2 className="text-xl font-display font-medium text-text-primary truncate">Recepciones</h2>
          <p className="text-sm text-text-secondary mt-0.5">Haz una foto del albarán. El pedido se busca solo.</p>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-5 max-w-2xl mx-auto">
        {error && (
          <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
        )}

        {/* PRIMARIO: escanear albarán — el camino normal del muelle */}
        <button onClick={() => { setPicked(null); setOcr(null); setStep('scan') }}
          className="w-full text-left p-5 rounded-2xl bg-accent text-text-on-accent shadow-md hover:opacity-95 transition-base active:scale-[0.99] flex items-center gap-4">
          <span className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Camera size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">Escanear albarán</p>
            <p className="text-sm opacity-90 mt-0.5">Hazle una foto — el sistema busca el pedido por ti.</p>
          </div>
          <ChevronRight size={22} className="shrink-0" />
        </button>

        {/* Pedidos pendientes — secundario, solo referencia; solo lo vivo */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Pedidos pendientes</p>

          {!loading && orders.length > 3 && (
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por proveedor o código…"
                className="w-full pl-8 pr-2 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-text-secondary">
              <Loader2 size={18} className="animate-spin" /> Cargando pedidos…
            </div>
          ) : visible.length === 0 ? (
            <div className="p-4 rounded-lg border border-dashed border-border-default text-center">
              <PackageCheck size={22} className="mx-auto text-text-secondary mb-1" />
              <p className="text-xs text-text-secondary">Sin pedidos pendientes a la vista. Escanea el albarán y ya está.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {visible.map(o => {
                const supName = o.supplierId ? (supplierNameById.get(o.supplierId) ?? 'Proveedor') : 'Sin proveedor'
                const missing = missingByOrder.get(o.id) ?? []
                return (
                  <li key={o.id}>
                    <button onClick={() => { setPicked(o); setOcr(null); setStep('choose') }}
                      className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3">
                      <span className="w-11 h-11 rounded-full bg-accent-bg flex items-center justify-center shrink-0">
                        <Truck size={22} className="text-accent" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-text-primary truncate">{supName}</p>
                          <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[o.status] ?? ''}`}>
                            {STATUS_LABEL[o.status] ?? o.status}
                          </span>
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5 truncate">
                          {o.code ?? 'Sin código'} · Pedido {formatDate(o.orderDate)}
                          {o.expectedDate ? ` · Entrega ${formatDate(o.expectedDate)}` : ''}
                        </p>
                        {o.status === 'recibido_parcial' && (
                          <p className="text-xs text-warning mt-0.5 truncate">
                            {missing.length === 0
                              ? 'Parcial — revisando qué falta…'
                              : `Parcial — falta: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` y ${missing.length - 3} más` : ''}`}
                          </p>
                        )}
                      </div>
                      <ChevronRight size={18} className="text-text-secondary shrink-0" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Contar a mano — secundario, siempre disponible */}
        <div className="space-y-2.5 pt-1">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Otra forma de recibir</p>
          <button onClick={() => { setPicked(null); setOcr(null); setStep('manual') }}
            className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-page flex items-center justify-center shrink-0 border border-border-default">
              <ListChecks size={22} className="text-text-secondary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">Contar a mano</p>
              <p className="text-xs text-text-secondary mt-0.5">Sin foto: eliges proveedor y cuentas lo que llega.</p>
            </div>
            <ChevronRight size={18} className="text-text-secondary shrink-0" />
          </button>
        </div>
      </div>
    </div>
  )
}
