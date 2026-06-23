// src/modules/supply/components/OrderReceiveFlow.tsx
//
// FLUJO "RECIBIR PEDIDO": selector de pedidos PENDIENTES de recibir → recepción
// arrancada DESDE ese pedido (reusa GoodsReceiptForm con la prop `order`, que ya
// enlaza purchaseOrderId/purchaseOrderLineId, muestra pedido/ya-recibido/pendiente
// por línea y soporta OCR o manual; aquí NO se duplica nada de esa lógica).
//
// REUTILIZABLE en dos sitios (misma pieza, sin copiar):
//   · PC / encargado: montado desde GoodsReceiptsPage (botón "Recibir pedido").
//   · Móvil del trabajador: montado desde TrabajadorApp (módulo "Recepciones").
//
// "Pendiente de recibir" = pedidos en estado `enviado` o `recibido_parcial`
// (el motor recompute_purchase_order_status ya los marca solo al confirmar una
// recepción). Los `borrador`/`recibido`/`cerrado`/`cancelado` NO aparecen.
//
// locationId (opcional): si se pasa, filtra los pedidos a ese local (el caso del
// trabajador, que recibe en SU local). Sin él, todos los del scope de la cuenta.

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Loader2, PackageCheck, ChevronRight, Truck, Search,
} from 'lucide-react'
import {
  listPurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import GoodsReceiptForm from '@/modules/supply/pages/GoodsReceiptForm'

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

export default function OrderReceiveFlow({ accountId, locationId, onBack, onSaved }: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  // Pedido elegido → montamos la recepción contra él.
  const [picked, setPicked] = useState<PurchaseOrder | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      // listPurchaseOrders filtra por UN estado; pedimos sin estado y filtramos
      // a los dos pendientes en cliente (más simple que dos llamadas).
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

  // ── Recepción contra el pedido elegido (reusa el form tal cual) ──
  if (picked) {
    return (
      <GoodsReceiptForm
        accountId={accountId}
        order={picked}
        onBack={() => { setPicked(null); setReloadTick(t => t + 1) }}
        onSaved={(msg) => { setPicked(null); onSaved(msg) }}
      />
    )
  }

  // ── Selector de pedidos pendientes ──
  return (
    <div className="min-h-screen bg-page">
      {/* Cabecera */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base shrink-0"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h2 className="text-xl font-display font-medium text-text-primary truncate">Recibir pedido</h2>
          <p className="text-sm text-text-secondary mt-0.5">Elige un pedido pendiente de recibir.</p>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-3 max-w-2xl mx-auto">
        {error && (
          <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
        )}

        {/* Buscador (solo si hay varios) */}
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
          <div className="flex items-center justify-center gap-2 py-16 text-text-secondary">
            <Loader2 size={18} className="animate-spin" /> Cargando pedidos…
          </div>
        ) : visible.length === 0 ? (
          <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
            <PackageCheck size={32} className="mx-auto text-text-secondary mb-2" />
            <p className="text-sm font-medium text-text-primary">No hay pedidos pendientes de recibir</p>
            <p className="text-xs text-text-secondary mt-1">
              Cuando se envíe un pedido a un proveedor, aparecerá aquí para recibirlo.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visible.map(o => {
              const supName = o.supplierId ? (supplierNameById.get(o.supplierId) ?? 'Proveedor') : 'Sin proveedor'
              return (
                <li key={o.id}>
                  <button
                    onClick={() => setPicked(o)}
                    className="w-full text-left p-4 rounded-2xl bg-card border border-border-default shadow-sm hover:border-accent hover:shadow-md transition-base active:scale-[0.99] flex items-center gap-3"
                  >
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
    </div>
  )
}
