// src/modules/supply/pages/SupplyOrdersPage.tsx
//
// Lista de PEDIDOS (purchase_order) del módulo Folvy Supply — C1 del ciclo de
// compra. Patrón calcado de KitchenItemsPage: useApp() (actor) + useActiveAccount()
// (cuenta activa) + useIsMobile(); estados load/error; tabla en escritorio,
// tarjetas apiladas en móvil. Estilo con tokens del proyecto.
//
// C1 usable por sí solo: crear pedido a mano (alta mínima) + listar. El detalle
// del pedido (líneas, enviar, recibir) llega en C1.x / C2. Los avisos IA
// (sugerir cantidades, sobrepedido, proveedor preferente) se enchufan después.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Truck, X, ChevronRight, Search } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  listPurchaseOrders,
  createPurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import SupplyOrderDetailPage from '@/modules/supply/pages/SupplyOrderDetailPage'
import type { Supplier } from '@/types/kitchen'

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

export default function SupplyOrdersPage() {
  const { userProfile, authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const isMobile = useIsMobile()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setOrders([])
      setSuppliers([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      listPurchaseOrders({ accountId: activeAccountId }),
      listSuppliers(activeAccountId),
    ])
      .then(([rows, sups]) => {
        if (cancelled) return
        setOrders(rows)
        setSuppliers(sups)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error desconocido')
        setOrders([])
        setSuppliers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading, reloadTick])

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

  function handleCreated() {
    setCreateOpen(false)
    setReloadTick(t => t + 1)
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

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">Pedidos</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Pedidos a proveedores. Pide, recibe y controla el gasto.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!activeAccountId}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          <Plus size={16} />
          Nuevo pedido
        </button>
      </div>

      {/* Buscador */}
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

      {/* Estados */}
      {loading && <p className="text-sm text-text-secondary">Cargando pedidos…</p>}
      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {/* Vacío */}
      {!loading && !error && orders.length === 0 && (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <Truck size={28} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm font-medium text-text-primary">Aún no hay pedidos</p>
          <p className="text-sm text-text-secondary mt-1">
            Crea tu primer pedido a un proveedor para empezar a controlar tus compras.
          </p>
        </div>
      )}

      {/* Lista — escritorio: tabla; móvil: tarjetas */}
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
                  <span className="font-medium text-text-primary truncate">
                    {o.code ?? 'Pedido sin código'}
                  </span>
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
            <table className="w-full text-sm">
              <thead className="bg-page text-text-secondary">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Código</th>
                  <th className="text-left font-medium px-3 py-2">Proveedor</th>
                  <th className="text-left font-medium px-3 py-2">Fecha</th>
                  <th className="text-left font-medium px-3 py-2">Entrega</th>
                  <th className="text-right font-medium px-3 py-2">Total est.</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map(o => (
                  <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} className="border-t border-border-default hover:bg-page/50 cursor-pointer transition-base">
                    <td className="px-3 py-2 text-text-primary">{o.code ?? '—'}</td>
                    <td className="px-3 py-2 text-text-primary">{o.supplierId ? supplierNameById.get(o.supplierId) ?? '—' : '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{formatDate(o.orderDate)}</td>
                    <td className="px-3 py-2 text-text-secondary">{formatDate(o.expectedDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{formatEur(o.estTotal)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[o.status]}`}>
                        {STATUS_LABEL[o.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary"><ChevronRight size={16} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {createOpen && activeAccountId && (
        <OrderCreateModal
          accountId={activeAccountId}
          suppliers={suppliers}
          actorId={userProfile?.id ?? authUserId ?? null}
          actorName={userProfile?.displayName ?? null}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
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

// ─────────────────────────────────────────────────────────────────────
// Modal de alta mínima de pedido: proveedor + fecha esperada + nota.
// Crea la cabecera en estado 'borrador', origin 'manual'. Las líneas se
// añaden en el detalle (C1.x). Tras crear, recarga la lista.
// ─────────────────────────────────────────────────────────────────────

interface OrderCreateModalProps {
  accountId: string
  suppliers: Supplier[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: () => void
}

function OrderCreateModal({
  accountId, suppliers, actorId, actorName, onClose, onCreated,
}: OrderCreateModalProps) {
  const [supplierId, setSupplierId] = useState<string>('')
  const [expectedDate, setExpectedDate] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await createPurchaseOrder({
        accountId,
        supplierId: supplierId || null,
        expectedDate: expectedDate || null,
        notes: notes.trim() || null,
        status: 'borrador',
        origin: 'manual',
        createdBy: actorId,
        createdByName: actorName,
      })
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-create-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="order-create-title" className="text-base font-medium text-text-primary">
            Nuevo pedido
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={submitting}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Proveedor</label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="">— Sin proveedor (lo eliges luego) —</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Fecha de entrega esperada
            </label>
            <input
              type="date"
              value={expectedDate}
              onChange={e => setExpectedDate(e.target.value)}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nota (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="Ej: entrega por la mañana"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 resize-none"
            />
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            {submitting ? 'Creando…' : 'Crear pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}
