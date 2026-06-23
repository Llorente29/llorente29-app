// src/modules/supply/components/OrderReceiveFlow.tsx
//
// PANTALLA "RECEPCIONES" del trabajador / oficina. Un solo sitio para todo:
//   · PEDIDOS PENDIENTES (enviado / recibido_parcial): eliges uno → contar a mano
//     o escanear su albarán (OCR casado contra las líneas del pedido).
//   · SIN PEDIDO (siempre disponible): escanear un albarán suelto (OCR) o recibir
//     a ciegas (eliges proveedor y cuentas).
//
// Reusa GoodsReceiptForm (prop `order` enlaza el pedido; `ocrPrefill` trae lo
// leído; sin ninguna de las dos = recepción ciega) y ReceiptScanPanel (OCR).
//
// REUTILIZABLE en PC (GoodsReceiptsPage) y en el móvil del trabajador (TrabajadorApp).
// locationId (opcional): filtra los pedidos a ese local (el caso del trabajador).

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Loader2, PackageCheck, ChevronRight, Truck, Search, ScanLine, ListChecks,
} from 'lucide-react'
import {
  listPurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import GoodsReceiptForm, { type OcrPrefill } from '@/modules/supply/pages/GoodsReceiptForm'
import ReceiptScanPanel from '@/modules/supply/pages/ReceiptScanPanel'

interface Props {
  accountId: string
  /** Filtra los pedidos pendientes a este local. null/undefined = sin filtrar. */
  locationId?: string | null
  onBack: () => void
  /** Se llama tras confirmar/guardar la recepción (mensaje opcional para flash). */
  onSaved: (message?: string) => void
}

// Estados que cuentan como "pendiente de recibir".
const PENDING_STATUSES: PurchaseOrderStatus[] = ['enviado', 'recibido_parcial']

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
type Step = 'list' | 'choose' | 'manual' | 'scan' | 'form-scan'

export default function OrderReceiveFlow({ accountId, locationId, onBack, onSaved }: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const [step, setStep] = useState<Step>('list')
  const [picked, setPicked] = useState<PurchaseOrder | null>(null)  // null = sin pedido
  const [ocr, setOcr] = useState<OcrPrefill | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listPurchaseOrders({ accountId, locationId: locationId ?? undefined }),
      listSuppliers(accountId),
    ])
      .then(([rows, sups]) => {
        if (cancelled) return
        setOrders(rows.filter(o => PENDING_STATUSES.includes(o.status)))
        setSuppliers(sups)
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

  function backToList() {
    setStep('list'); setPicked(null); setOcr(null); setReloadTick(t => t + 1)
  }
  // Volver desde el form/escáner: si venía de un pedido → a "cómo recibir"; si era
  // sin pedido → a la lista.
  function backFromFlow() {
    setOcr(null)
    if (picked) setStep('choose')
    else backToList()
  }

  // ── Recepción a mano (contra pedido si picked; a ciegas si null) ──
  if (step === 'manual') {
    return (
      <GoodsReceiptForm
        accountId={accountId}
        order={picked ?? undefined}
        onBack={backFromFlow}
        onSaved={(msg) => { backToList(); onSaved(msg) }}
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

  // ── Recepción con el albarán leído (fusión pedido+OCR si picked; OCR suelto si null) ──
  if (step === 'form-scan' && ocr) {
    return (
      <GoodsReceiptForm
        accountId={accountId}
        order={picked ?? undefined}
        ocrPrefill={ocr}
        onBack={backFromFlow}
        onSaved={(msg) => { backToList(); onSaved(msg) }}
      />
    )
  }

  const pickedSupplier = picked?.supplierId ? (supplierNameById.get(picked.supplierId) ?? 'Proveedor') : 'Sin proveedor'

  // ── Elegir cómo recibir el pedido seleccionado ──
  if (step === 'choose' && picked) {
    return (
      <div className="min-h-screen bg-page">
        <div className="px-4 pt-5 pb-3 flex items-center gap-3">
          <button onClick={backToList} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base shrink-0" aria-label="Volver">
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

  // ── LISTA: pedidos pendientes + recepción sin pedido (siempre) ──
  return (
    <div className="min-h-screen bg-page">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base shrink-0" aria-label="Volver">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h2 className="text-xl font-display font-medium text-text-primary truncate">Recepciones</h2>
          <p className="text-sm text-text-secondary mt-0.5">Recibe un pedido pendiente o un albarán suelto.</p>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-4 max-w-2xl mx-auto">
        {error && (
          <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
        )}

        {/* Pedidos pendientes */}
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
            <div className="flex items-center justify-center gap-2 py-10 text-text-secondary">
              <Loader2 size={18} className="animate-spin" /> Cargando pedidos…
            </div>
          ) : visible.length === 0 ? (
            <div className="p-5 rounded-lg border border-dashed border-border-default text-center">
              <PackageCheck size={26} className="mx-auto text-text-secondary mb-1.5" />
              <p className="text-sm font-medium text-text-primary">No hay pedidos pendientes</p>
              <p className="text-xs text-text-secondary mt-0.5">Puedes recibir un albarán sin pedido abajo.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {visible.map(o => {
                const supName = o.supplierId ? (supplierNameById.get(o.supplierId) ?? 'Proveedor') : 'Sin proveedor'
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
                      </div>
                      <ChevronRight size={18} className="text-text-secondary shrink-0" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Recepción sin pedido (siempre disponible) */}
        <div className="space-y-2.5 pt-1">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Recibir sin pedido</p>

          <button onClick={() => { setPicked(null); setOcr(null); setStep('scan') }}
            className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-accent-bg flex items-center justify-center shrink-0">
              <ScanLine size={22} className="text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">Escanear albarán</p>
              <p className="text-xs text-text-secondary mt-0.5">La IA lee el papel del proveedor.</p>
            </div>
            <ChevronRight size={18} className="text-text-secondary shrink-0" />
          </button>

          <button onClick={() => { setPicked(null); setOcr(null); setStep('manual') }}
            className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-page flex items-center justify-center shrink-0 border border-border-default">
              <ListChecks size={22} className="text-text-secondary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">A ciegas</p>
              <p className="text-xs text-text-secondary mt-0.5">Eliges proveedor y cuentas lo que llega.</p>
            </div>
            <ChevronRight size={18} className="text-text-secondary shrink-0" />
          </button>
        </div>
      </div>
    </div>
  )
}
