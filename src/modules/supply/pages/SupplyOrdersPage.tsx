// src/modules/supply/pages/SupplyOrdersPage.tsx
//
// Lista de PEDIDOS (purchase_order) del módulo Folvy Supply. Tres vistas por
// estado (patrón Kitchen, sin react-router):
//   - lista (por defecto)
//   - builder: "Nuevo pedido" → SupplyOrderBuilder (pedido sobre catálogo del proveedor)
//   - detalle: pinchar una fila → SupplyOrderDetailPage
//
// Rediseño 03/06: el alta ya NO es un modal mínimo — es el builder sobre el
// catálogo del proveedor (flujo A). Tabla en escritorio, tarjetas en móvil.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Truck, ChevronRight, Search } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  listPurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import SupplyOrderDetailPage from '@/modules/supply/pages/SupplyOrderDetailPage'
import SupplyOrderBuilder from '@/modules/supply/pages/SupplyOrderBuilder'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  recibido_parcial: 'Recibido parcial',
  recibido: 'Recibido',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
}

const STATUS_CLASS: Record<PurchaseOrderStatus, string> = {
  borrador: 'bg-page text-text-secondary border-border-default',
  enviado: 'bg-accent-bg text-accent border-accent/20',
  recibido_parcial: 'bg-warning-bg text-warning border-warning/20',
  recibido: 'bg-success-bg text-success border-success/20',
  cerrado: 'bg-success-bg text-success border-success/20',
  cancelado: 'bg-danger-bg text-danger border-danger/20',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value))
}

function formatEur(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
}

type View = 'list' | 'builder'

export default function SupplyOrdersPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { resolvedLocationId } = useLocationScope()
  const isMobile = useIsMobile()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [view, setView] = useState<View>('list')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setOrders([]); setSuppliers([]); setLoading(false); return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listPurchaseOrders({ accountId: activeAccountId, locationId: resolvedLocationId }),
      listSuppliers(activeAccountId),
    ])
      .then(([rows, sups]) => {
        if (cancelled) return
        setOrders(rows); setSuppliers(sups)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error desconocido')
        setOrders([]); setSuppliers([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading, resolvedLocationId, reloadTick])

  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>()
    suppliers.forEach(s => m.set(s.id, s.name))
    return m
  }, [suppliers])

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return orders
    return orders.filter(o => {
      const code = (o.code ?? '').toLowerCase()
      const sup = (o.supplierId ? supplierNameById.get(o.supplierId) ?? '' : '').toLowerCase()
      return code.includes(q) || sup.includes(q)
    })
  }, [orders, search, supplierNameById])

  // ── Vista BUILDER: nuevo pedido sobre el catálogo del proveedor ──
  if (view === 'builder') {
    return (
      <SupplyOrderBuilder
        onBack={() => setView('list')}
        onSaved={(orderId) => {
          setView('list')
          setReloadTick(t => t + 1)
          setSelectedOrderId(orderId)
        }}
      />
    )
  }

  // ── Vista DETALLE: el pedido seleccionado ──
  if (selectedOrderId) {
    return (
      <SupplyOrderDetailPage
        orderId={selectedOrderId}
        onBack={() => {
          setSelectedOrderId(null)
          setReloadTick(t => t + 1)
        }}
      />
    )
  }

  // ── Vista LISTA ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">Pedidos</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Pedidos a proveedores. Pide, recibe y controla el gasto.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setView('builder')}
          disabled={!activeAccountId}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          <Plus size={16} />
          Nuevo pedido
        </button>
      </div>

      {!loading && !error && orders.length > 0 && (
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por código o proveedor"
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      {loading && <p className="text-sm text-text-secondary">Cargando pedidos…</p>}
      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <Truck size={28} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm font-medium text-text-primary">Aún no hay pedidos</p>
          <p className="text-sm text-text-secondary mt-1">
            Crea tu primer pedido a un proveedor para empezar a controlar tus compras.
          </p>
        </div>
      )}

      {!loading && !error && visibleOrders.length > 0 && (
        isMobile ? (
          <div className="space-y-2">
            {visibleOrders.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedOrderId(o.id)}
                className="w-full text-left p-3 rounded-lg border border-border-default bg-card hover:border-accent/40 transition-base"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text-primary truncate">{o.code ?? 'Pedido sin código'}</span>
                  <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[o.status]}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Field label="Proveedor" value={o.supplierId ? supplierNameById.get(o.supplierId) ?? '—' : '—'} />
                  <Field label="Fecha" value={formatDate(o.orderDate)} />
                  <Field label="Entrega" value={formatDate(o.expectedDate)} />
                  <Field label="Total est." value={formatEur(o.estTotal)} />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border-default overflow-hidden">
            <table className="w-full text-[15px]">
              <thead className="bg-page text-text-secondary">
                <tr>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-2.5">Código</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-2.5">Proveedor</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-2.5">Fecha</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-2.5">Entrega</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-wide px-4 py-2.5">Total est.</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-2.5">Estado</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map(o => (
                  <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} className="border-t border-border-default hover:bg-page/50 cursor-pointer transition-base">
                    <td className="px-4 py-3 text-text-primary">{o.code ?? '—'}</td>
                    <td className="px-4 py-3 text-text-primary">{o.supplierId ? supplierNameById.get(o.supplierId) ?? '—' : '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatDate(o.orderDate)}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatDate(o.expectedDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{formatEur(o.estTotal)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_CLASS[o.status]}`}>
                        {STATUS_LABEL[o.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary"><ChevronRight size={16} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-sm text-text-primary truncate">{value}</p>
    </div>
  )
}
