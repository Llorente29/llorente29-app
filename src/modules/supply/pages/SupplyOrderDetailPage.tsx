// src/modules/supply/pages/SupplyOrderDetailPage.tsx
//
// Vista DETALLE de un pedido (purchase_order) + sus líneas. Patrón LISTA+DETALLE
// por estado, calcado de KitchenItemDetailPage: recibe orderId + onBack, no usa
// react-router con params. La monta SupplyOrdersPage cuando hay un id seleccionado.
//
// Es el HOGAR del pedido: cabecera (proveedor · fechas · estado, editables) +
// la tabla de LÍNEAS (qué ingredientes y cuántos, con precio estimado) + el
// total. Acciones de ciclo: cambiar estado (borrador→enviado) y, cuando está
// enviado, REGISTRAR RECEPCIÓN (C2): abre el formulario de recepción con el
// pedido precargado (modo contra-pedido). El total se recalcula sumando las
// líneas y se persiste en est_total.
//
// C1.x a mano: el selector de ingrediente es un dropdown simple. Los avisos IA
// (sugerir cantidad por histórico, precio desde last_price, proveedor preferente)
// se enchufan como capa posterior (norma IA en compras = copiloto).

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus, Trash2, Check, Loader2, X, Send, Package, PackageCheck, FileText } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  getPurchaseOrderById,
  updatePurchaseOrder,
  listPurchaseOrderLines,
  createPurchaseOrderLine,
  deletePurchaseOrderLine,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
} from '@/modules/supply/services/purchaseOrderService'
import { listRecipeItems } from '@/modules/kitchen/services/recipeItemService'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import { buildPurchaseOrderPdfData, generatePurchaseOrderPdf } from '@/modules/supply/services/purchaseOrderPdf'
import GoodsReceiptForm from '@/modules/supply/pages/GoodsReceiptForm'
import type { Supplier } from '@/types/kitchen'
import type { RecipeItem } from '@/types/kitchen'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  recibido_parcial: 'Recibido parcial',
  recibido: 'Recibido',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
}

function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value))
}

interface SupplyOrderDetailPageProps {
  orderId: string
  onBack: () => void
}

export default function SupplyOrderDetailPage({ orderId, onBack }: SupplyOrderDetailPageProps) {
  const { activeAccountId } = useActiveAccount()

  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [lines, setLines] = useState<PurchaseOrderLine[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [ingredients, setIngredients] = useState<RecipeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [receiving, setReceiving] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      getPurchaseOrderById(orderId),
      listPurchaseOrderLines(orderId),
      listSuppliers(activeAccountId),
      listRecipeItems({ accountId: activeAccountId, type: 'raw' }),
      listSupplyLocations(activeAccountId),
    ])
      .then(([ord, lns, sups, ings, locs]) => {
        if (cancelled) return
        if (!ord) {
          setError('Este pedido ya no existe.')
          setOrder(null)
        } else {
          setOrder(ord)
        }
        setLines(lns)
        setSuppliers(sups)
        setIngredients(ings)
        setLocations(locs)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el pedido.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [orderId, activeAccountId, reloadTick])

  const supplierName = useMemo(() => {
    if (!order?.supplierId) return '—'
    return suppliers.find(s => s.id === order.supplierId)?.name ?? '—'
  }, [order, suppliers])

  const deliveryLocation = useMemo(() => {
    if (!order?.locationId) return null
    return locations.find(l => l.id === order.locationId) ?? null
  }, [order, locations])

  const ingredientNameById = useMemo(() => {
    const m = new Map<string, string>()
    ingredients.forEach(i => m.set(i.id, i.name))
    return m
  }, [ingredients])

  // Total del pedido = suma de los totales de línea (estimados).
  const computedTotal = useMemo(
    () => lines.reduce((acc, l) => acc + (l.estLineTotal ?? 0), 0),
    [lines],
  )

  // Persistir el total estimado cuando cambian las líneas (si difiere del guardado).
  useEffect(() => {
    if (!order) return
    if (loading) return
    const current = order.estTotal ?? 0
    if (Math.abs(current - computedTotal) < 0.005) return
    updatePurchaseOrder(order.id, { estTotal: computedTotal, estSubtotal: computedTotal })
      .then(o => setOrder(o))
      .catch(err => console.error('SupplyOrderDetail: no se pudo persistir el total', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedTotal])

  async function handleDeleteLine(lineId: string) {
    try {
      await deletePurchaseOrderLine(lineId)
      setReloadTick(t => t + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la línea.')
    }
  }

  async function handleChangeStatus(next: PurchaseOrderStatus) {
    if (!order) return
    setSavingStatus(true)
    try {
      const updated = await updatePurchaseOrder(order.id, { status: next })
      setOrder(updated)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.')
    } finally {
      setSavingStatus(false)
    }
  }

  async function handleDownloadPdf() {
    if (!order || !activeAccountId) return
    setGeneratingPdf(true)
    setError(null)
    try {
      const data = await buildPurchaseOrderPdfData(activeAccountId, order.id)
      const { blob, filename } = generatePurchaseOrderPdf(data)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el PDF.')
    } finally {
      setGeneratingPdf(false)
    }
  }

  // ── Vista RECEPCIÓN: formulario contra este pedido ──
  if (receiving && order && activeAccountId) {
    return (
      <GoodsReceiptForm
        accountId={activeAccountId}
        order={order}
        onBack={() => setReceiving(false)}
        onSaved={() => { setReceiving(false); setReloadTick(t => t + 1) }}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
        >
          <ArrowLeft size={16} />
          Pedidos
        </button>
      </div>

      {loading && <div className="p-8 text-center text-sm text-text-secondary">Cargando pedido…</div>}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {!loading && order && (
        <>
          {/* Datos del pedido */}
          <div className="rounded-lg border border-border-default bg-card">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default">
              <h2 className="text-lg font-display font-medium text-text-primary">
                {order.code ?? 'Pedido'}
              </h2>
              <span className="text-xs px-2 py-0.5 rounded border border-border-default bg-page text-text-secondary">
                {STATUS_LABEL[order.status]}
              </span>
            </div>
            <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Field label="Proveedor" value={supplierName} />
              <Field label="Entrega en" value={deliveryLocation?.name ?? '—'} />
              <Field label="Fecha del pedido" value={formatDate(order.orderDate)} />
              <Field label="Entrega esperada" value={formatDate(order.expectedDate)} />
            </div>
            {(deliveryLocation?.address || order.notes) && (
              <div className="px-4 pb-3 text-sm text-text-secondary space-y-0.5">
                {deliveryLocation?.address && (
                  <p>Dirección de entrega: {deliveryLocation.address}</p>
                )}
                {order.notes && <p>{order.notes}</p>}
              </div>
            )}
            <div className="px-4 pb-3 flex justify-end">
              <Field label="Total estimado" value={formatEur(order.estTotal)} mono />
            </div>
          </div>

          {/* Líneas */}
          <div className="rounded-lg border border-border-default bg-card">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default">
              <h3 className="text-base font-medium text-text-primary">Líneas del pedido</h3>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
              >
                <Plus size={15} />
                Añadir línea
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Package size={24} className="mx-auto text-text-secondary mb-2" />
                <p className="text-sm text-text-secondary">
                  Aún no hay líneas. Añade los ingredientes que quieres pedir.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-page text-text-secondary">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Ingrediente</th>
                      <th className="text-right font-medium px-3 py-2">Cantidad</th>
                      <th className="text-right font-medium px-3 py-2">Precio est.</th>
                      <th className="text-right font-medium px-3 py-2">Total est.</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.id} className="border-t border-border-default">
                        <td className="px-3 py-2 text-text-primary">
                          {l.recipeItemId ? (ingredientNameById.get(l.recipeItemId) ?? l.productName) : l.productName}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-primary">{l.qtyOrdered}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatEur(l.estUnitPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-primary">{formatEur(l.estLineTotal)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            aria-label="Borrar línea"
                            onClick={() => handleDeleteLine(l.id)}
                            className="text-text-secondary hover:text-danger transition-base"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border-default bg-page/50">
                      <td className="px-3 py-2 font-medium text-text-primary" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-text-primary">
                        {formatEur(computedTotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Acciones de ciclo */}
          <div className="flex items-center gap-2 flex-wrap">
            {lines.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={generatingPdf}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
              >
                {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText size={15} />}
                Descargar PDF
              </button>
            )}
            {order.status === 'borrador' && (
              <button
                type="button"
                onClick={() => handleChangeStatus('enviado')}
                disabled={savingStatus || lines.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                title={lines.length === 0 ? 'Añade al menos una línea antes de enviar' : undefined}
              >
                {savingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send size={15} />}
                Marcar como enviado
              </button>
            )}
            {(order.status === 'enviado' || order.status === 'recibido_parcial') && (
              <button
                type="button"
                onClick={() => setReceiving(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
              >
                <PackageCheck size={15} />
                Registrar recepción
              </button>
            )}
          </div>
        </>
      )}

      {addOpen && order && activeAccountId && (
        <AddLineModal
          accountId={activeAccountId}
          orderId={order.id}
          ingredients={ingredients}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); setReloadTick(t => t + 1) }}
        />
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className={`text-text-primary truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal de añadir línea: elegir ingrediente + cantidad + precio estimado.
// El total de línea = cantidad × precio. recipe_item_id se rellena con el
// ingrediente elegido (product_name se copia de su nombre para traza).
// ─────────────────────────────────────────────────────────────────────

interface AddLineModalProps {
  accountId: string
  orderId: string
  ingredients: RecipeItem[]
  onClose: () => void
  onAdded: () => void
}

function AddLineModal({ accountId, orderId, ingredients, onClose, onAdded }: AddLineModalProps) {
  const [recipeItemId, setRecipeItemId] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qtyNum = qty.trim() === '' ? null : Number(qty.replace(',', '.'))
  const priceNum = price.trim() === '' ? null : Number(price.replace(',', '.'))
  const lineTotal = qtyNum !== null && priceNum !== null && !Number.isNaN(qtyNum) && !Number.isNaN(priceNum)
    ? qtyNum * priceNum
    : null

  async function handleSubmit() {
    if (!recipeItemId) { setError('Elige un ingrediente.'); return }
    if (qtyNum === null || Number.isNaN(qtyNum) || qtyNum <= 0) { setError('Indica una cantidad válida.'); return }
    if (priceNum !== null && (Number.isNaN(priceNum) || priceNum < 0)) { setError('El precio debe ser ≥ 0 (o vacío).'); return }

    const ing = ingredients.find(i => i.id === recipeItemId)
    setSubmitting(true)
    setError(null)
    try {
      await createPurchaseOrderLine({
        accountId,
        purchaseOrderId: orderId,
        recipeItemId,
        productName: ing?.name ?? 'Ingrediente',
        qtyOrdered: qtyNum,
        estUnitPrice: priceNum,
        estLineTotal: lineTotal,
      })
      onAdded()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir la línea.')
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
      aria-labelledby="add-line-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="add-line-title" className="text-base font-medium text-text-primary">Añadir línea</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={submitting}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Ingrediente</label>
            <select
              value={recipeItemId}
              onChange={e => setRecipeItemId(e.target.value)}
              disabled={submitting}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="">— Elige un ingrediente —</option>
              {ingredients.map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Cantidad</label>
              <input
                type="text" inputMode="decimal" value={qty}
                onChange={e => setQty(e.target.value)} disabled={submitting}
                placeholder="Ej: 10"
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Precio est. (€)</label>
              <input
                type="text" inputMode="decimal" value={price}
                onChange={e => setPrice(e.target.value)} disabled={submitting}
                placeholder="Opcional"
                className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
            </div>
          </div>

          {lineTotal !== null && (
            <p className="text-sm text-text-secondary">
              Total de línea: <span className="font-mono text-text-primary">{formatEur(lineTotal)}</span>
            </p>
          )}

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
            {submitting ? 'Añadiendo…' : 'Añadir'}
          </button>
        </div>
      </div>
    </div>
  )
}
