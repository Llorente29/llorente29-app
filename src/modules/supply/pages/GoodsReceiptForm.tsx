// src/modules/supply/pages/GoodsReceiptForm.tsx
//
// Formulario de RECEPCIÓN de albarán (C2). Un solo componente, TRES modos:
//   · CONTRA PEDIDO (order != null): precarga las líneas del pedido con la
//     cantidad pedida como "recibida" (editable). Comparativa pedido↔recibido.
//   · CORREGIR (prefill != null): precarga las líneas de una recepción para
//     rehacerla cambiando solo lo que falló ("anular y corregir"). Hereda
//     proveedor, local, nº de albarán y purchase_order_id de la original.
//     IMPORTANTE: la original NO se anula al abrir; se anula SOLO al confirmar
//     la corregida (orden seguro: 1º crear+confirmar la nueva, 2º anular la
//     original). Si guardas borrador o sales, la original sigue CONFIRMADA.
//   · CIEGO (order == null && prefill == null): eliges local + proveedor → su
//     catálogo → cantidades. Para entregas sin pedido previo.
//
// qty_in_base = qty_recibida × format.qty_in_base (el formato encierra la
// conversión a base). Sin formato/equivalencia → la línea NO entra a stock
// (anti-invención); se guarda como needs_review.
//
// Tras "Guardar y confirmar", el formulario VUELVE SOLO (onSaved con mensaje);
// el aviso se muestra como toast en la lista. No hay pantalla intermedia.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search, Loader2, Check, Save } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'
import {
  getSupplierCatalog,
  listSupplyLocations,
  type SupplierCatalogEntry,
  type SupplyLocation,
} from '@/modules/supply/services/supplierCatalogService'
import {
  listPurchaseOrderLines,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@/modules/supply/services/purchaseOrderService'
import {
  createGoodsReceipt,
  createGoodsReceiptLine,
  confirmReceipt,
  voidReceipt,
  qtyInBaseFromFormat,
} from '@/modules/supply/services/goodsReceiptService'

// Datos para reabrir una recepción y corregirla.
export interface ReceiptPrefill {
  sourceReceiptId: string            // recepción a anular AL confirmar la corregida
  supplierId: string
  locationId: string
  purchaseOrderId: string | null
  supplierDocNumber: string | null
  lines: ReceiptPrefillLine[]
}
export interface ReceiptPrefillLine {
  recipeItemId: string | null
  productName: string
  purchaseFormatId: string | null
  qtyReceived: number
  unitCost: number | null
  purchaseOrderLineId: string | null
}

interface GoodsReceiptFormProps {
  accountId: string
  order?: PurchaseOrder | null         // si viene → modo CONTRA PEDIDO
  prefill?: ReceiptPrefill | null      // si viene → modo CORREGIR
  onBack: () => void
  onSaved: (message?: string) => void
}

// Línea editable en memoria.
interface DraftLine {
  key: string
  recipeItemId: string | null
  productName: string
  purchaseFormatId: string | null
  formatLabel: string | null
  formatQtyInBase: number | null
  qtyOrdered: number | null   // solo en modo contra pedido (comparativa)
  qty: string                 // recibido (editable)
  unitCost: string            // € por formato (editable)
  poLineId: string | null
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export default function GoodsReceiptForm({ accountId, order, prefill, onBack, onSaved }: GoodsReceiptFormProps) {
  const { userProfile, authUserId } = useApp()
  const againstOrder = !!order
  const correcting = !!prefill
  const fixedHeader = againstOrder || correcting   // proveedor/local fijos (vienen del origen)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [supplierId, setSupplierId] = useState<string>(order?.supplierId ?? prefill?.supplierId ?? '')
  const [locationId, setLocationId] = useState<string>(order?.locationId ?? prefill?.locationId ?? '')
  const [receiptDate, setReceiptDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [supplierDoc, setSupplierDoc] = useState<string>(prefill?.supplierDocNumber ?? '')

  const [draft, setDraft] = useState<DraftLine[]>([])
  const [search, setSearch] = useState('')

  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingLines, setLoadingLines] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El pedido al que se liga el albarán (contra-pedido o heredado al corregir).
  const linkedOrderId = order?.id ?? prefill?.purchaseOrderId ?? null

  // Cargar proveedores + locales (para selectores del modo ciego y nombres).
  useEffect(() => {
    let cancelled = false
    setLoadingMeta(true)
    Promise.all([listSuppliers(accountId), listSupplyLocations(accountId)])
      .then(([sups, locs]) => {
        if (cancelled) return
        setSuppliers(sups)
        setLocations(locs)
        if (!fixedHeader && locs.length === 1) setLocationId(locs[0].id)
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando datos.') })
      .finally(() => { if (!cancelled) setLoadingMeta(false) })
    return () => { cancelled = true }
  }, [accountId, fixedHeader])

  // Construir las líneas del borrador.
  useEffect(() => {
    if (!supplierId) { setDraft([]); return }
    let cancelled = false
    setLoadingLines(true)
    setError(null)

    async function build() {
      const catalog = await getSupplierCatalog(accountId, supplierId)
      const byFormat = new Map<string, SupplierCatalogEntry>()
      const byItem = new Map<string, SupplierCatalogEntry>()
      catalog.forEach(e => {
        if (e.purchaseFormatId) byFormat.set(e.purchaseFormatId, e)
        byItem.set(e.recipeItemId, e)
      })
      const resolveFmt = (formatId: string | null, itemId: string | null) =>
        (formatId && byFormat.get(formatId)) || (itemId ? byItem.get(itemId) : undefined)

      if (correcting && prefill) {
        const lines: DraftLine[] = prefill.lines.map((l, i) => {
          const cat = resolveFmt(l.purchaseFormatId, l.recipeItemId)
          return {
            key: `pf-${i}`,
            recipeItemId: l.recipeItemId,
            productName: l.productName,
            purchaseFormatId: l.purchaseFormatId ?? cat?.purchaseFormatId ?? null,
            formatLabel: cat?.formatLabel ?? cat?.formatName ?? null,
            formatQtyInBase: cat?.formatQtyInBase ?? null,
            qtyOrdered: null,
            qty: String(l.qtyReceived),
            unitCost: l.unitCost != null ? String(l.unitCost) : (cat?.lastPrice != null ? String(cat.lastPrice) : ''),
            poLineId: l.purchaseOrderLineId,
          }
        })
        if (!cancelled) setDraft(lines)
      } else if (againstOrder && order) {
        const poLines: PurchaseOrderLine[] = await listPurchaseOrderLines(order.id)
        const lines: DraftLine[] = poLines.map(l => {
          const cat = resolveFmt(l.purchaseFormatId, l.recipeItemId)
          return {
            key: l.id,
            recipeItemId: l.recipeItemId,
            productName: l.productName,
            purchaseFormatId: l.purchaseFormatId ?? cat?.purchaseFormatId ?? null,
            formatLabel: cat?.formatLabel ?? cat?.formatName ?? null,
            formatQtyInBase: cat?.formatQtyInBase ?? null,
            qtyOrdered: l.qtyOrdered,
            qty: String(l.qtyOrdered),
            unitCost: l.estUnitPrice != null ? String(l.estUnitPrice) : (cat?.lastPrice != null ? String(cat.lastPrice) : ''),
            poLineId: l.id,
          }
        })
        if (!cancelled) setDraft(lines)
      } else {
        const lines: DraftLine[] = catalog.map(e => ({
          key: e.articleSupplierId,
          recipeItemId: e.recipeItemId,
          productName: e.itemName,
          purchaseFormatId: e.purchaseFormatId,
          formatLabel: e.formatLabel ?? e.formatName ?? null,
          formatQtyInBase: e.formatQtyInBase,
          qtyOrdered: null,
          qty: '',
          unitCost: e.lastPrice != null ? String(e.lastPrice) : '',
          poLineId: null,
        }))
        if (!cancelled) setDraft(lines)
      }
    }

    build()
      .catch((err: unknown) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Error cargando líneas.'); setDraft([]) } })
      .finally(() => { if (!cancelled) setLoadingLines(false) })
    return () => { cancelled = true }
  }, [accountId, supplierId, againstOrder, order, correcting, prefill])

  function setQty(key: string, qty: string) {
    setDraft(d => d.map(l => l.key === key ? { ...l, qty } : l))
  }
  function setCost(key: string, unitCost: string) {
    setDraft(d => d.map(l => l.key === key ? { ...l, unitCost } : l))
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return draft
    return draft.filter(l => l.productName.toLowerCase().includes(q))
  }, [draft, search])

  const filled = useMemo(
    () => draft.filter(l => { const n = parseNum(l.qty); return n !== null && n > 0 }),
    [draft],
  )

  const willPost = useMemo(
    () => filled.filter(l => l.recipeItemId && qtyInBaseFromFormat(parseNum(l.qty)!, l.formatQtyInBase) !== null).length,
    [filled],
  )

  const supplierName = useMemo(
    () => suppliers.find(s => s.id === supplierId)?.name ?? '—',
    [suppliers, supplierId],
  )
  const locationName = useMemo(
    () => locations.find(l => l.id === locationId)?.name ?? '—',
    [locations, locationId],
  )

  async function persist(confirm: boolean) {
    if (!supplierId) { setError('Elige un proveedor.'); return }
    if (!locationId) { setError('Elige el local de entrega.'); return }
    if (filled.length === 0) { setError('Pon cantidad recibida en al menos un artículo.'); return }

    setSaving(true); setError(null)
    try {
      const receipt = await createGoodsReceipt({
        accountId,
        locationId,
        supplierId,
        purchaseOrderId: linkedOrderId,
        supplierDocNumber: supplierDoc.trim() || null,
        receiptDate,
        receivedAt: new Date().toISOString(),
        source: 'manual',
        createdBy: authUserId ?? null,
        createdByName: userProfile?.displayName ?? null,
      })

      let position = 0
      for (const l of filled) {
        const qtyReceived = parseNum(l.qty)!
        const unitCost = parseNum(l.unitCost)
        const qtyInBase = qtyInBaseFromFormat(qtyReceived, l.formatQtyInBase)
        const unmapped = !l.recipeItemId || qtyInBase === null
        await createGoodsReceiptLine({
          accountId,
          goodsReceiptId: receipt.id,
          purchaseOrderLineId: l.poLineId,
          recipeItemId: l.recipeItemId,
          productName: l.productName,
          qtyReceived,
          purchaseFormatId: l.purchaseFormatId,
          qtyInBase,
          unitCost,
          mapSource: l.recipeItemId ? 'manual' : 'unmapped',
          mapNeedsReview: unmapped,
          position: position++,
        })
      }

      // Guardar borrador: en modo corregir, la original SIGUE confirmada (no se
      // sustituye nada hasta confirmar la corregida).
      if (!confirm) {
        onSaved(`Recepción ${receipt.code ?? ''} guardada como borrador.`)
        return
      }

      // Confirmar: postea al ledger.
      const res = await confirmReceipt(receipt.id)

      // Anular y corregir: orden seguro → solo tras confirmar OK la corregida,
      // se anula la original. Si esto fallara, ambas quedarían confirmadas un
      // instante (recuperable con un Anular normal); nunca al revés.
      let voidNote = ''
      if (correcting && prefill?.sourceReceiptId) {
        try {
          await voidReceipt(prefill.sourceReceiptId)
          voidNote = ' · anterior anulada'
        } catch (e) {
          console.error('persist: corregida confirmada pero no se pudo anular la original', e)
          voidNote = ' · OJO: anula la anterior a mano'
        }
      }

      const parts = [`${res.postedLines} línea(s) a stock`]
      if (res.skippedLines > 0) parts.push(`${res.skippedLines} sin postear (revisar)`)
      if (res.recalculatedItems > 0) parts.push(`coste actualizado en ${res.recalculatedItems} ingrediente(s)`)
      onSaved(`Recepción ${receipt.code ?? ''} confirmada: ${parts.join(' · ')}${voidNote}.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la recepción.')
      setSaving(false)
    }
  }

  const title = againstOrder
    ? `Recibir pedido ${order?.code ?? ''}`
    : correcting
      ? 'Corregir recepción'
      : 'Nueva recepción'
  const subtitle = againstOrder
    ? 'Ajusta lo que ha llegado de verdad y confirma para que entre a stock.'
    : correcting
      ? 'Corrige lo que falló y confirma. La recepción anterior se anulará solo al confirmar esta.'
      : 'Elige proveedor y local, pon lo recibido y confirma.'

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
        >
          <ArrowLeft size={16} />
          {againstOrder ? 'Pedido' : 'Recepciones'}
        </button>
      </div>

      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">{title}</h2>
        <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
      </div>

      {/* Datos de la recepción */}
      <div className="rounded-lg border border-border-default bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Local (entrada)</label>
          {fixedHeader ? (
            <p className="px-2 py-1.5 text-sm text-text-primary">{locationName}</p>
          ) : (
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              disabled={loadingMeta || saving}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="">— Elige local —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Proveedor</label>
          {fixedHeader ? (
            <p className="px-2 py-1.5 text-sm text-text-primary">{supplierName}</p>
          ) : (
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              disabled={loadingMeta || saving}
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              <option value="">— Elige proveedor —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Fecha de recepción</label>
          <input
            type="date"
            value={receiptDate}
            onChange={e => setReceiptDate(e.target.value)}
            disabled={saving}
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Nº de albarán (proveedor)</label>
          <input
            type="text"
            value={supplierDoc}
            onChange={e => setSupplierDoc(e.target.value)}
            disabled={saving}
            placeholder="Opcional"
            className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {/* Sin proveedor (modo ciego) */}
      {!supplierId && !loadingMeta && (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <p className="text-sm text-text-secondary">Elige un proveedor para ver su catálogo.</p>
        </div>
      )}

      {/* Líneas */}
      {supplierId && (
        <>
          {loadingLines && <p className="text-sm text-text-secondary">Cargando líneas…</p>}

          {!loadingLines && draft.length === 0 && (
            <div className="p-6 rounded-lg border border-dashed border-border-default text-center">
              <p className="text-sm text-text-secondary">
                {againstOrder
                  ? 'Este pedido no tiene líneas.'
                  : correcting
                    ? 'La recepción a corregir no tenía líneas.'
                    : 'Este proveedor aún no tiene artículos en su catálogo.'}
              </p>
            </div>
          )}

          {!loadingLines && draft.length > 0 && (
            <>
              <div className="relative max-w-sm">
                <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar artículo"
                  className="w-full pl-8 pr-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="rounded-lg border border-border-default overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 720 }}>
                  <thead className="bg-page text-text-secondary">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Artículo</th>
                      <th className="text-left font-medium px-3 py-2">Formato</th>
                      {againstOrder && <th className="text-right font-medium px-3 py-2">Pedido</th>}
                      <th className="text-center font-medium px-3 py-2" style={{ width: 110 }}>Recibido</th>
                      <th className="text-right font-medium px-3 py-2" style={{ width: 110 }}>€ / formato</th>
                      <th className="text-left font-medium px-3 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(l => {
                      const qtyN = parseNum(l.qty)
                      const hasQty = qtyN !== null && qtyN > 0
                      const willEnter = hasQty && l.recipeItemId && qtyInBaseFromFormat(qtyN!, l.formatQtyInBase) !== null
                      let cmp: { label: string; cls: string } | null = null
                      if (againstOrder && l.qtyOrdered !== null && hasQty) {
                        if (Math.abs(qtyN! - l.qtyOrdered) < 0.0001) cmp = { label: 'OK', cls: 'bg-success-bg text-success border-success/20' }
                        else if (qtyN! < l.qtyOrdered) cmp = { label: 'Parcial', cls: 'bg-warning-bg text-warning border-warning/20' }
                        else cmp = { label: 'De más', cls: 'bg-accent-bg text-accent border-accent/20' }
                      }
                      return (
                        <tr key={l.key} className="border-t border-border-default">
                          <td className="px-3 py-2 text-text-primary">{l.productName}</td>
                          <td className="px-3 py-2 text-text-primary">{l.formatLabel ?? '—'}</td>
                          {againstOrder && (
                            <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                              {l.qtyOrdered ?? '—'}
                            </td>
                          )}
                          <td className="px-3 py-2 text-center">
                            {/* Celda de cantidad: destacada para que el usuario no dude dónde escribir. */}
                            <input
                              type="text" inputMode="decimal"
                              value={l.qty}
                              onChange={e => setQty(l.key, e.target.value)}
                              disabled={saving}
                              placeholder="0"
                              className={`w-20 px-2 py-1.5 text-sm text-center font-medium rounded-md border bg-page text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 ${hasQty ? 'border-accent/50' : 'border-accent/30 bg-accent-bg/30'}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="text" inputMode="decimal"
                              value={l.unitCost}
                              onChange={e => setCost(l.key, e.target.value)}
                              disabled={saving}
                              placeholder="—"
                              className="w-24 px-2 py-1 text-sm text-right border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-2">
                            {!hasQty ? (
                              <span className="text-xs text-text-tertiary">—</span>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {cmp && (
                                  <span className={`text-[10px] px-1 py-0.5 rounded border ${cmp.cls}`}>{cmp.label}</span>
                                )}
                                {willEnter ? (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-success-bg text-success border border-success/20">a stock</span>
                                ) : (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-warning-bg text-warning border border-warning/20">sin mapear</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-text-secondary">
                  {filled.length} con cantidad · {willPost} entrarán a stock
                  {filled.length - willPost > 0 && ` · ${filled.length - willPost} sin mapear`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => persist(false)}
                    disabled={saving || filled.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={15} />}
                    Guardar borrador
                  </button>
                  <button
                    type="button"
                    onClick={() => persist(true)}
                    disabled={saving || filled.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={15} />}
                    Guardar y confirmar
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
