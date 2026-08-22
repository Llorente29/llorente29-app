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
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Truck, ChevronRight, Search } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  listPurchaseOrders,
  getOrdersProgress, type OrderProgress,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import SupplyOrderDetailPage from '@/modules/supply/pages/SupplyOrderDetailPage'
import SupplyOrderBuilder from '@/modules/supply/pages/SupplyOrderBuilder'
import PendingReceptionsPanel from '@/modules/supply/components/PendingReceptionsPanel'
import HungOrdersReviewPanel from '@/modules/supply/components/HungOrdersReviewPanel'

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
type Tab = 'todos' | 'pendientes' | 'saneado'

export default function SupplyOrdersPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { resolvedLocationId } = useLocationScope()
  const isMobile = useIsMobile()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  // ENCARGO CODE (21/08) — «Recibido parcial» a secas obliga a abrir para saber
  // si falta un salsero o falta media entrega. La etiqueta se queda, pero
  // ACOMPAÑADA DEL NÚMERO. Una consulta para toda la lista, no una por fila.
  const [progress, setProgress] = useState<Map<string, OrderProgress>>(new Map())
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [view, setView] = useState<View>('list')
  const [tab, setTab] = useState<Tab>('todos')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  // ENCARGO CODE (14/08) fix/recepcion-iva-y-enlace-pedido, §0.2 — filtro
  // real desde /pendientes. ?estado=vencido → pedido_vencido (enviado +
  // expected_date pasada); ?estado=borrador → pedido_borrador_atascado
  // (borrador + más de 7 días).
  const [searchParams] = useSearchParams()
  const estadoFiltro = searchParams.get('estado')
  const navigate = useNavigate()

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
        // El avance va DESPUÉS y aparte: la lista se pinta con lo que hay y el
        // «27 de 31» aparece en cuanto llega. Si esta consulta falla, la lista
        // sigue entera y sólo se queda sin el número — degradar, no romper.
        const conLineas = rows.filter(o => o.status !== 'borrador').map(o => o.id)
        if (conLineas.length > 0) {
          getOrdersProgress(conLineas)
            .then(m => { if (!cancelled) setProgress(m) })
            .catch(() => { /* la lista no depende de esto */ })
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error desconocido')
        setOrders([]); setSuppliers([]); setProgress(new Map())
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
    let base = q === ''
      ? orders
      : orders.filter(o => {
          const code = (o.code ?? '').toLowerCase()
          const sup = (o.supplierId ? supplierNameById.get(o.supplierId) ?? '' : '').toLowerCase()
          return code.includes(q) || sup.includes(q)
        })
    if (estadoFiltro === 'vencido') {
      const today = new Date().toISOString().slice(0, 10)
      base = base.filter(o => o.status === 'enviado' && !!o.expectedDate && o.expectedDate < today)
    } else if (estadoFiltro === 'borrador') {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      base = base.filter(o => o.status === 'borrador' && new Date(o.createdAt).getTime() < sevenDaysAgo)
    }
    return base
  }, [orders, search, supplierNameById, estadoFiltro])

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

      <div className="inline-flex rounded-md border border-border-default overflow-hidden">
        <button type="button" onClick={() => setTab('todos')}
          className={`px-3 py-1.5 text-sm transition-base ${tab === 'todos' ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:bg-page'}`}>
          Todos
        </button>
        <button type="button" onClick={() => setTab('pendientes')}
          className={`px-3 py-1.5 text-sm transition-base border-l border-border-default ${tab === 'pendientes' ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:bg-page'}`}>
          Pendiente de recepción
        </button>
        <button type="button" onClick={() => setTab('saneado')}
          className={`px-3 py-1.5 text-sm transition-base border-l border-border-default ${tab === 'saneado' ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:bg-page'}`}>
          Saneado (colgados)
        </button>
      </div>

      {estadoFiltro && tab === 'todos' && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span>Filtrado desde Pendientes.</span>
          <button type="button" onClick={() => navigate('/supply')} className="text-accent hover:underline">
            Quitar filtro
          </button>
        </div>
      )}

      {tab === 'pendientes' && (
        !activeAccountId ? null : !resolvedLocationId ? (
          <p className="text-sm text-text-secondary p-4 border border-dashed border-border-default rounded-lg">
            Elige un local concreto (arriba) para ver lo pendiente de recepción — no se puede consolidar entre locales.
          </p>
        ) : (
          <PendingReceptionsPanel accountId={activeAccountId} locationId={resolvedLocationId} onError={setError} />
        )
      )}

      {tab === 'saneado' && activeAccountId && (
        <HungOrdersReviewPanel accountId={activeAccountId} onError={setError} />
      )}

      {tab === 'todos' && (
      <>
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
                {(progresoTexto(progress.get(o.id)) || retrasoTexto(progress.get(o.id))) && (
                  <div className="flex items-center gap-2 flex-wrap mt-1 text-[12px]">
                    {progresoTexto(progress.get(o.id)) && (
                      <span className="font-semibold text-text-primary tabular-nums">{progresoTexto(progress.get(o.id))}</span>
                    )}
                    {retrasoTexto(progress.get(o.id)) && (
                      <span className="text-warning font-medium">{retrasoTexto(progress.get(o.id))}</span>
                    )}
                  </div>
                )}
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
                      <div className="flex flex-col gap-0.5">
                        <span className={`self-start text-xs px-2 py-0.5 rounded border ${STATUS_CLASS[o.status]}`}>
                          {STATUS_LABEL[o.status]}
                        </span>
                        {progresoTexto(progress.get(o.id)) && (
                          <span className="text-[12px] font-semibold text-text-primary tabular-nums whitespace-nowrap">
                            {progresoTexto(progress.get(o.id))}
                          </span>
                        )}
                        {retrasoTexto(progress.get(o.id)) && (
                          <span className="text-[12px] text-warning font-medium whitespace-nowrap">
                            {retrasoTexto(progress.get(o.id))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary"><ChevronRight size={16} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      </>
      )}
    </div>
  )
}

/**
 * «27 de 31 · faltan 4». Devuelve null cuando no hay nada que contar: en un
 * pedido completo o sin líneas el número sobra, y un contador que siempre está
 * deja de leerse.
 */
function progresoTexto(p: OrderProgress | undefined): string | null {
  if (!p || p.lineas === 0) return null
  if (p.faltan === 0) return null
  return `${p.completas} de ${p.lineas} · faltan ${p.faltan}`
}

/** «4 días de retraso». null si no hay fecha o no se ha pasado. */
function retrasoTexto(p: OrderProgress | undefined): string | null {
  if (!p || p.diasDeRetraso == null || p.diasDeRetraso <= 0) return null
  return `${p.diasDeRetraso} ${p.diasDeRetraso === 1 ? 'día' : 'días'} de retraso`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-sm text-text-primary truncate">{value}</p>
    </div>
  )
}
