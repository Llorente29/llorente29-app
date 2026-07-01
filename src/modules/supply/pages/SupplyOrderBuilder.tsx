// src/modules/supply/pages/SupplyOrderBuilder.tsx
//
// CONSTRUCTOR DE PEDIDO (rediseño 01/07): panel enfocado sobre el catálogo del
// proveedor. Cada artículo es una FILA ENMARCADA con identidad: nombre grande,
// stock real, sugerencia de repedido ("Pide N" con su fuente), y una casilla de
// cantidad grande y protagonista. El pedido se construye poniendo cantidades;
// solo las filas con cantidad > 0 entran.
//
// Motor de sugerencia (suggest_purchase_qty, To-Par MRP II): la sugerencia llega
// ya calculada en cada entrada del catálogo (suggestedQty en formato de compra +
// fuente + confianza). Un clic en "Pide N" copia la cantidad sugerida.
//
// Avisos de incongruencia (deterministas, no bloqueantes, ámbar): detectan al
// vuelo si pides bastante más de lo sugerido o si el sugerido es 0 (ya cubierto).
// El aviso de precio vs referencia CTB queda declarado: necesita traer el precio
// de referencia del cedente al catálogo (dato aún no disponible aquí).
//
// Teclado: Enter en una casilla de cantidad salta a la siguiente fila (rellenar
// pedidos largos sin ratón).

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Search, Loader2, Check, Truck, MessageSquarePlus } from 'lucide-react'
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
  showNote?: boolean
}

// Etiqueta legible de la fuente de la sugerencia.
const SOURCE_LABEL: Record<string, string> = {
  consumo: 'por consumo',
  historico: 'por histórico',
  par: 'par fijo',
}

function parseQty(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// Unidad legible de la fila (formato "caja" o unidad base "kg").
function unitLabel(e: SupplierCatalogEntry): string {
  if (e.formatName) return e.formatName.toLowerCase()
  return e.baseUnitAbbr ?? ''
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

  // Cargar proveedores + locales al entrar.
  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    setLoadingSuppliers(true)
    Promise.all([listSuppliers(activeAccountId), listSupplyLocations(activeAccountId)])
      .then(([sups, locs]) => {
        if (cancelled) return
        setSuppliers(sups)
        setLocations(locs)
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando datos.') })
      .finally(() => { if (!cancelled) setLoadingSuppliers(false) })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading])

  // Cargar el catálogo del proveedor elegido (trae ya la sugerencia por artículo).
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
    setDraft(d => ({ ...d, [id]: { ...(d[id] ?? { qty: '', note: '' }), qty } }))
  }
  function setNote(id: string, note: string) {
    setDraft(d => ({ ...d, [id]: { ...(d[id] ?? { qty: '', note: '' }), note } }))
  }
  function toggleNote(id: string) {
    setDraft(d => ({ ...d, [id]: { ...(d[id] ?? { qty: '', note: '' }), showNote: !d[id]?.showNote } }))
  }
  // Copiar la cantidad sugerida a la casilla.
  function useSuggested(e: SupplierCatalogEntry) {
    if (e.suggestedQty == null) return
    setQty(e.articleSupplierId, String(e.suggestedQty).replace('.', ','))
  }

  // Enter en una casilla de cantidad → salta a la siguiente fila.
  function onQtyKeyDown(ev: KeyboardEvent<HTMLInputElement>, index: number) {
    if (ev.key !== 'Enter') return
    ev.preventDefault()
    const next = document.getElementById(`qty-${index + 1}`) as HTMLInputElement | null
    next?.focus()
    next?.select()
  }

  // Avisos de incongruencia deterministas por línea (ámbar, no bloqueante).
  function warningFor(e: SupplierCatalogEntry, qty: number): string | null {
    if (qty <= 0) return null
    // El sugerido es 0 → ya hay stock para cubrir la semana.
    if (e.suggestedQty === 0) return 'El sugerido es 0: ya tienes stock para la semana.'
    // Pides bastante más de lo sugerido (más del doble y al menos 2 de diferencia).
    if (e.suggestedQty != null && e.suggestedQty > 0 && qty >= e.suggestedQty * 2 && qty - e.suggestedQty >= 2) {
      return `Pides bastante más de lo sugerido (${e.suggestedQty}).`
    }
    return null
  }

  const filledCount = useMemo(() => {
    return catalog.reduce((acc, e) => acc + (parseQty(draft[e.articleSupplierId]?.qty) > 0 ? 1 : 0), 0)
  }, [catalog, draft])

  // Total estimado = Σ (cantidad × €/caja). last_price es €/base → €/caja con × formatQtyInBase.
  const estTotal = useMemo(() => {
    return catalog.reduce((acc, e) => {
      const n = parseQty(draft[e.articleSupplierId]?.qty)
      if (n <= 0) return acc
      return acc + n * (e.lastPrice ?? 0) * (e.formatQtyInBase ?? 1)
    }, 0)
  }, [catalog, draft])

  const eur = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)

  async function handleSave() {
    if (!activeAccountId || !supplierId) { setError('Elige un proveedor.'); return }
    if (!op.isResolved || !locationId) {
      setError('No hay un local operativo definido. Revisa el aviso de local arriba.')
      return
    }
    if (filledCount === 0) { setError('Pon cantidad en al menos un artículo.'); return }
    setSaving(true)
    setError(null)
    try {
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

      let position = 0
      for (const e of catalog) {
        const n = parseQty(draft[e.articleSupplierId]?.qty)
        if (n <= 0) continue
        const note = draft[e.articleSupplierId]?.note?.trim() || null
        const eurPorCaja = e.lastPrice !== null ? e.lastPrice * (e.formatQtyInBase ?? 1) : null
        const lineTotal = eurPorCaja !== null ? Math.round(n * eurPorCaja * 100) / 100 : null
        await createPurchaseOrderLine({
          accountId: activeAccountId,
          purchaseOrderId: order.id,
          recipeItemId: e.recipeItemId,
          productName: e.itemName,
          qtyOrdered: n,
          purchaseFormatId: e.purchaseFormatId,
          estUnitPrice: eurPorCaja,
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
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* Cabecera */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
      >
        <ArrowLeft size={16} />
        Pedidos
      </button>

      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Nuevo pedido</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Elige el proveedor y pon cantidades sobre su catálogo.
        </p>
      </div>

      <OperativeLocationBanner op={op} locations={locations} />

      {/* Datos del pedido */}
      <div className="rounded-xl border border-border-default bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
        <div className="p-8 rounded-xl border border-dashed border-border-default text-center">
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
            <div className="p-6 rounded-xl border border-dashed border-border-default text-center">
              <p className="text-sm text-text-secondary">
                Este proveedor aún no tiene artículos en su catálogo. Añádeselos desde
                la ficha de cada ingrediente (sección Compra/Proveedores).
              </p>
            </div>
          )}

          {!loadingCatalog && catalog.length > 0 && (
            <>
              <div className="relative">
                <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar artículo o código"
                  className="w-full pl-8 pr-2 py-2 text-sm border border-border-default rounded-lg bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Lista de artículos: una fila enmarcada por artículo */}
              <div className="space-y-2">
                {visibleCatalog.map((e, index) => {
                  const d = draft[e.articleSupplierId]
                  const qty = parseQty(d?.qty)
                  const hasQty = qty > 0
                  const warn = warningFor(e, qty)
                  const srcLabel = e.suggestionSource ? SOURCE_LABEL[e.suggestionSource] : null
                  const canSuggest = e.suggestedQty != null && e.suggestedQty > 0
                  return (
                    <div
                      key={e.articleSupplierId}
                      className={`rounded-xl border bg-card px-3 py-2.5 transition-base ${
                        hasQty ? 'border-accent/50 ring-1 ring-accent/20' : 'border-border-default'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Nombre + meta (protagonista) */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-medium text-text-primary truncate">{e.itemName}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {e.supplierCode && (
                              <span className="text-[11px] text-text-tertiary">{e.supplierCode}</span>
                            )}
                            {e.isPreferred && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-accent">preferente</span>
                            )}
                          </div>
                        </div>

                        {/* Stock */}
                        <div className="w-16 text-right shrink-0">
                          <div className="text-[10px] text-text-tertiary">Stock</div>
                          <div className="text-[13px] text-text-secondary tabular-nums">
                            {formatStockForOrder(e.stockOnHand, e.formatQtyInBase, e.formatName, e.baseUnitAbbr)}
                          </div>
                        </div>

                        {/* Sugerido: "Pide N" clicable con su fuente */}
                        <div className="w-24 text-center shrink-0">
                          <div className="text-[10px] text-text-tertiary mb-0.5">Sugerido</div>
                          {canSuggest ? (
                            <button
                              type="button"
                              onClick={() => useSuggested(e)}
                              disabled={saving}
                              title={srcLabel ? `Sugerencia ${srcLabel}. Clic para usarla.` : 'Clic para usar la sugerencia.'}
                              className="inline-flex flex-col items-center px-2 py-0.5 rounded-full bg-success-bg text-success hover:opacity-80 transition-base disabled:opacity-50"
                            >
                              <span className="text-[13px] font-medium leading-tight">Pide {e.suggestedQty}</span>
                            </button>
                          ) : (
                            <div className="text-[13px] text-text-tertiary">—</div>
                          )}
                          {srcLabel && canSuggest && (
                            <div className="text-[10px] text-text-tertiary mt-0.5">{srcLabel}</div>
                          )}
                        </div>

                        {/* Cantidad: casilla grande y enmarcada, unidad pegada */}
                        <div className="shrink-0">
                          <div className={`flex items-stretch h-10 rounded-lg overflow-hidden border ${
                            hasQty ? 'border-accent' : 'border-border-default'
                          }`}>
                            <input
                              id={`qty-${index}`}
                              type="text"
                              inputMode="decimal"
                              value={d?.qty ?? ''}
                              onChange={ev => setQty(e.articleSupplierId, ev.target.value)}
                              onKeyDown={ev => onQtyKeyDown(ev, index)}
                              onFocus={ev => ev.currentTarget.select()}
                              disabled={saving}
                              placeholder="0"
                              className="w-14 px-2 text-right text-[17px] font-medium bg-transparent text-text-primary focus:outline-none disabled:opacity-50"
                            />
                            <div className="flex items-center px-2 bg-page border-l border-border-default text-[12px] text-text-secondary whitespace-nowrap">
                              {unitLabel(e)}
                            </div>
                          </div>
                        </div>

                        {/* Nota (icono, despliega campo) */}
                        <button
                          type="button"
                          onClick={() => toggleNote(e.articleSupplierId)}
                          disabled={saving}
                          title="Añadir comentario"
                          className={`shrink-0 p-1.5 rounded-md transition-base ${
                            d?.note ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'
                          }`}
                        >
                          <MessageSquarePlus size={17} />
                        </button>
                      </div>

                      {/* Comentario desplegable */}
                      {(d?.showNote || d?.note) && (
                        <input
                          type="text"
                          value={d?.note ?? ''}
                          onChange={ev => setNote(e.articleSupplierId, ev.target.value)}
                          disabled={saving}
                          placeholder="Comentario…"
                          className="mt-2 w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                        />
                      )}

                      {/* Aviso de incongruencia (ámbar, no bloqueante) */}
                      {warn && (
                        <div className="mt-2 text-[12px] text-warning bg-warning-bg rounded-md px-2 py-1">
                          {warn}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Pie fijo: resumen + guardar */}
              <div className="sticky bottom-0 -mx-1 mt-2 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border-default bg-card px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {filledCount} {filledCount === 1 ? 'artículo' : 'artículos'} · {eur(estTotal)} est.
                  </div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">
                    Escribe la cantidad y pulsa Enter para bajar
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || filledCount === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
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
