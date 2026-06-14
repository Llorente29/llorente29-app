// src/modules/supply/pages/SupplyOrderBuilder.tsx
//
// CONSTRUCTOR DE PEDIDO (rediseño 03/06, flujo A): el pedido se construye SOBRE
// EL CATÁLOGO DEL PROVEEDOR, no con líneas a mano. Eliges proveedor → aparece su
// catálogo (article_supplier: artículo + código + formato + precio) → pones
// cantidades → guardas. Solo las filas con cantidad > 0 entran en el pedido.
//
// Calcado del patrón de página Kitchen (useApp + useActiveAccount, estados
// load/error, tokens de estilo). Reemplaza el modal de "alta mínima" anterior.
//
// Capas que se enchufan después (huecos marcados):
//   - Sugerencia por línea (consumo ventas×escandallo) → botón "sugerido: N"
//   - Stock de referencia (cuando haya inventario)
//   - Modos plantilla / a par
//   - Envío email/WhatsApp + PDF (logo + datos fiscales + cuña Folvy)

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search, Loader2, Check, Truck } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useOperativeLocation } from '@/modules/supply/hooks/useOperativeLocation'
import OperativeLocationBanner from '@/modules/supply/components/OperativeLocationBanner'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import {
  getSupplierCatalog,
  formatStockForOrder,
  listSupplyLocations,
  type SupplierCatalogEntry,
  type SupplyLocation,
} from '@/modules/supply/services/supplierCatalogService'
import {
  createPurchaseOrder,
  createPurchaseOrderLine,
} from '@/modules/supply/services/purchaseOrderService'

interface SupplyOrderBuilderProps {
  onBack: () => void
  onSaved: (orderId: string) => void
}

// Línea editable en memoria: la cantidad y el comentario que pone el comprador
// sobre cada entrada del catálogo. qty vacío = no entra en el pedido.
interface DraftLine {
  qty: string
  note: string
}

export default function SupplyOrderBuilder({ onBack, onSaved }: SupplyOrderBuilderProps) {
  const { userProfile, authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState<string>('')
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const op = useOperativeLocation()
  const locationId = op.operativeLocationId ?? ''
  const [expectedDate, setExpectedDate] = useState<string>('')
  const [sentBy, setSentBy] = useState<string>(userProfile?.displayName ?? '')

  const [catalog, setCatalog] = useState<SupplierCatalogEntry[]>([])
  const [draft, setDraft] = useState<Record<string, DraftLine>>({})
  const [search, setSearch] = useState('')

  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cargar proveedores al entrar.
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    setLoadingSuppliers(true)
    Promise.all([listSuppliers(activeAccountId), listSupplyLocations(activeAccountId)])
      .then(([sups, locs]) => {
        if (cancelled) return
        setSuppliers(sups)
        setLocations(locs)
        // Si solo hay un local, lo preseleccionamos (caso single-local).
        // el local operativo viene del hook, no se auto-selecciona aquí
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando datos.') })
      .finally(() => { if (!cancelled) setLoadingSuppliers(false) })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading])

  // Cargar el catálogo del proveedor elegido.
  useEffect(() => {
    if (!activeAccountId || !supplierId) {
      setCatalog([])
      setDraft({})
      return
    }
    let cancelled = false
    setLoadingCatalog(true)
    setError(null)
    getSupplierCatalog(activeAccountId, supplierId, locationId || null)
      .then((entries) => {
        if (cancelled) return
        setCatalog(entries)
        setDraft({})
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el catálogo.')
        setCatalog([])
      })
      .finally(() => { if (!cancelled) setLoadingCatalog(false) })
    return () => { cancelled = true }
  }, [activeAccountId, supplierId, locationId])

  const visibleCatalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return catalog
    return catalog.filter(e =>
      e.itemName.toLowerCase().includes(q) ||
      (e.supplierCode ?? '').toLowerCase().includes(q)
    )
  }, [catalog, search])

  function setQty(id: string, qty: string) {
    setDraft(d => ({ ...d, [id]: { qty, note: d[id]?.note ?? '' } }))
  }
  function setNote(id: string, note: string) {
    setDraft(d => ({ ...d, [id]: { qty: d[id]?.qty ?? '', note } }))
  }

  // Cuántas líneas con cantidad > 0 hay (las que entrarán en el pedido).
  const filledCount = useMemo(() => {
    return catalog.reduce((acc, e) => {
      const v = draft[e.articleSupplierId]?.qty
      const n = v ? Number(v.replace(',', '.')) : 0
      return acc + (Number.isFinite(n) && n > 0 ? 1 : 0)
    }, 0)
  }, [catalog, draft])

  // Total estimado = Σ (cantidad × last_price) de las filas con cantidad.
  const estTotal = useMemo(() => {
    return catalog.reduce((acc, e) => {
      const v = draft[e.articleSupplierId]?.qty
      const n = v ? Number(v.replace(',', '.')) : 0
      if (!Number.isFinite(n) || n <= 0) return acc
      return acc + n * (e.lastPrice ?? 0)
    }, 0)
  }, [catalog, draft])

  async function handleSave() {
    if (!activeAccountId || !supplierId) {
      setError('Elige un proveedor.')
      return
    }
    // El local operativo debe estar resuelto (viene del contexto, no se elige a mano).
    if (!op.isResolved || !locationId) {
      setError('No hay un local operativo definido. Revisa el aviso de local arriba.')
      return
    }
    if (filledCount === 0) {
      setError('Pon cantidad en al menos un artículo.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // 1) Crear la cabecera del pedido (en borrador, origin manual).
      const order = await createPurchaseOrder({
        accountId: activeAccountId,
        supplierId,
        locationId: locationId || null,
        expectedDate: expectedDate || null,
        status: 'borrador',
        origin: 'manual',
        estTotal: Math.round(estTotal * 100) / 100,
        estSubtotal: Math.round(estTotal * 100) / 100,
        notes: sentBy.trim() ? `Enviado por: ${sentBy.trim()}` : null,
        createdBy: authUserId ?? null,
        createdByName: userProfile?.displayName ?? null,
      })

      // 2) Crear una línea por cada artículo con cantidad > 0.
      let position = 0
      for (const e of catalog) {
        const v = draft[e.articleSupplierId]?.qty
        const n = v ? Number(v.replace(',', '.')) : 0
        if (!Number.isFinite(n) || n <= 0) continue
        const note = draft[e.articleSupplierId]?.note?.trim() || null
        const unitPrice = e.lastPrice
        const lineTotal = unitPrice !== null ? Math.round(n * unitPrice * 100) / 100 : null
        await createPurchaseOrderLine({
          accountId: activeAccountId,
          purchaseOrderId: order.id,
          recipeItemId: e.recipeItemId,
          productName: e.itemName,
          qtyOrdered: n,
          purchaseFormatId: e.purchaseFormatId,
          estUnitPrice: unitPrice,
          estLineTotal: lineTotal,
          position: position++,
          notes: note,
        })
      }

      onSaved(order.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el pedido.')
      setSaving(false)
    }
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

      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Nuevo pedido</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Elige el proveedor y pon cantidades sobre su catálogo.
        </p>
      </div>

      <OperativeLocationBanner op={op} locations={locations} />

      {/* Datos del pedido */}
      <div className="rounded-lg border border-border-default bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Local (entrega)</label>
          <p className="px-2 py-1.5 text-sm text-text-primary">
            {locations.find(l => l.id === locationId)?.name ?? '—'}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Proveedor</label>
          <select
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            disabled={loadingSuppliers || saving}
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          >
            <option value="">— Elige proveedor —</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Entrega esperada</label>
          <input
            type="date"
            value={expectedDate}
            onChange={e => setExpectedDate(e.target.value)}
            disabled={saving}
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Enviado por</label>
          <input
            type="text"
            value={sentBy}
            onChange={e => setSentBy(e.target.value)}
            disabled={saving}
            placeholder="Tu nombre"
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {/* Sin proveedor elegido */}
      {!supplierId && !loadingSuppliers && (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <Truck size={28} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            Elige un proveedor para ver su catálogo y empezar a pedir.
          </p>
        </div>
      )}

      {/* Catálogo del proveedor */}
      {supplierId && (
        <>
          {loadingCatalog && <p className="text-sm text-text-secondary">Cargando catálogo…</p>}

          {!loadingCatalog && catalog.length === 0 && (
            <div className="p-6 rounded-lg border border-dashed border-border-default text-center">
              <p className="text-sm text-text-secondary">
                Este proveedor aún no tiene artículos en su catálogo. Añádeselos desde
                la ficha de cada ingrediente (sección Compra/Proveedores).
              </p>
            </div>
          )}

          {!loadingCatalog && catalog.length > 0 && (
            <>
              <div className="relative max-w-sm">
                <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar artículo o código"
                  className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="rounded-lg border border-border-default overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 640 }}>
                  <thead className="bg-page text-text-secondary">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Artículo</th>
                      <th className="text-right font-medium px-3 py-2">Stock</th>
                      <th className="text-center font-medium px-3 py-2" style={{ width: 90 }}>Cantidad</th>
                      <th className="text-left font-medium px-3 py-2">Formato</th>
                      <th className="text-left font-medium px-3 py-2">Comentario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCatalog.map(e => {
                      const d = draft[e.articleSupplierId]
                      const hasQty = d?.qty && Number(d.qty.replace(',', '.')) > 0
                      return (
                        <tr
                          key={e.articleSupplierId}
                          className={`border-t border-border-default ${hasQty ? '' : 'opacity-90'}`}
                        >
                          <td className="px-3 py-2 text-text-primary">
                            {e.itemName}
                            {e.supplierCode && (
                              <span className="text-text-tertiary text-[11px]"> · {e.supplierCode}</span>
                            )}
                            {e.isPreferred && (
                              <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-accent-bg text-accent border border-accent/20">preferente</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-text-tertiary tabular-nums">
                            {formatStockForOrder(e.stockOnHand, e.formatQtyInBase, e.formatName, e.baseUnitAbbr)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={d?.qty ?? ''}
                              onChange={ev => setQty(e.articleSupplierId, ev.target.value)}
                              disabled={saving}
                              placeholder="0"
                              className="w-16 px-2 py-1 text-sm text-center border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-2 text-text-primary">
                            {e.formatLabel ?? e.formatName ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={d?.note ?? ''}
                              onChange={ev => setNote(e.articleSupplierId, ev.target.value)}
                              disabled={saving}
                              placeholder="Comentario…"
                              className="w-full px-2 py-1 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pie: resumen + guardar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-text-secondary">
                  {filledCount} {filledCount === 1 ? 'artículo' : 'artículos'} en el pedido
                </span>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || filledCount === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={15} />}
                  {saving ? 'Guardando…' : 'Guardar pedido'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
