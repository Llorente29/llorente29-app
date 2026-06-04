// src/modules/supply/pages/SupplierInvoicesPage.tsx
//
// Folvy Supply C3.1 — Facturas de proveedor: lista + alta manual.
// El three-way match, el OCR y el eslabón coste llegan en C3.2–C3.4.
// Por ahora: registrar una factura (cabecera + líneas + albaranes que cubre)
// y verla en la lista. Patrón calcado de GoodsReceiptsPage.

import { useEffect, useMemo, useState } from 'react'
import { Plus, FileText, Loader2, Trash2, X, ScanLine, ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import {
  listSupplierInvoices,
  createSupplierInvoice,
  voidSupplierInvoice,
  getSupplierInvoiceById,
  runInvoiceMatch,
  approveInvoice,
  markInvoiceDiscrepancy,
  matchResultLabel,
  type SupplierInvoice,
  type SupplierInvoiceStatus,
  type SupplierInvoiceDocKind,
  type SupplierInvoiceLineInput,
  type SupplierInvoiceLine,
  type InvoiceMatchSummary,
  type InvoiceOcrPrefill,
} from '@/modules/supply/services/supplierInvoiceService'
import InvoiceScanPanel from '@/modules/supply/pages/InvoiceScanPanel'
import { listSuppliers } from '@/modules/kitchen/services/purchaseFormatService'
import { listSupplyLocations, type SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import { listGoodsReceipts, type GoodsReceipt } from '@/modules/supply/services/goodsReceiptService'
import type { Supplier } from '@/types/kitchen'

const STATUS_LABEL: Record<SupplierInvoiceStatus, string> = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  con_discrepancias: 'Con discrepancias',
  pagada: 'Pagada',
  anulada: 'Anulada',
}
const STATUS_CLS: Record<SupplierInvoiceStatus, string> = {
  borrador: 'bg-page text-text-secondary border-border-default',
  en_revision: 'bg-warning-bg text-warning border-warning/20',
  aprobada: 'bg-success-bg text-success border-success/20',
  con_discrepancias: 'bg-warning-bg text-warning border-warning/20',
  pagada: 'bg-accent-bg text-accent border-accent/20',
  anulada: 'bg-page text-text-tertiary border-border-default line-through',
}

function fmtMoney(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-ES')
}

interface DraftLine extends SupplierInvoiceLineInput { key: string }

export default function SupplierInvoicesPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { userProfile, authUserId } = useApp()

  const [invoices, setInvoices] = useState<SupplierInvoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Alta manual
  const [view, setView] = useState<'list' | 'scan' | 'detail'>('list')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailLines, setDetailLines] = useState<SupplierInvoiceLine[]>([])
  const [detailHead, setDetailHead] = useState<SupplierInvoice | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [matchSummary, setMatchSummary] = useState<InvoiceMatchSummary | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [ocrSessionId, setOcrSessionId] = useState<string | null>(null)
  const [ocrRawUrl, setOcrRawUrl] = useState<string | null>(null)
  const [ocrSource, setOcrSource] = useState<'manual' | 'ocr'>('manual')
  const [saving, setSaving] = useState(false)
  const [docKind, setDocKind] = useState<SupplierInvoiceDocKind>('invoice')
  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [taxBase, setTaxBase] = useState('')
  const [taxTotal, setTaxTotal] = useState('')
  const [grandTotal, setGrandTotal] = useState('')
  const [notes, setNotes] = useState('')
  const [receiptIds, setReceiptIds] = useState<string[]>([])
  const [lines, setLines] = useState<DraftLine[]>([{ key: 'l0' }])

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) { setLoading(false); return }
    setLoading(true); setError(null)
    Promise.all([
      listSupplierInvoices(activeAccountId),
      listSuppliers(activeAccountId),
      listSupplyLocations(activeAccountId),
      listGoodsReceipts({ accountId: activeAccountId }),
    ])
      .then(([inv, sup, loc, rec]) => {
        setInvoices(inv); setSuppliers(sup); setLocations(loc)
        setReceipts(rec.filter(r => r.status === 'confirmado'))
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando facturas.'))
      .finally(() => setLoading(false))
  }, [activeAccountId, accountsLoading, reloadTick])

  // Albaranes del proveedor seleccionado (para enlazar).
  const supplierReceipts = useMemo(
    () => receipts.filter(r => !supplierId || r.supplierId === supplierId),
    [receipts, supplierId],
  )

  function applyOcrPrefill(ocr: InvoiceOcrPrefill) {
    setDocKind(ocr.docKind)
    setSupplierId(ocr.supplierId || '')
    setInvoiceNumber(ocr.invoiceNumber ?? '')
    setInvoiceDate(ocr.invoiceDate ?? '')
    setTaxBase(ocr.taxBaseTotal != null ? String(ocr.taxBaseTotal) : '')
    setTaxTotal(ocr.taxTotal != null ? String(ocr.taxTotal) : '')
    setGrandTotal(ocr.grandTotal != null ? String(ocr.grandTotal) : '')
    setReceiptIds(ocr.suggestedReceiptIds ?? [])
    setLines(ocr.lines.length > 0
      ? ocr.lines.map((l, i) => ({ key: `ocr${i}`, rawText: l.rawText, supplierCode: l.supplierCode, qty: l.qty, unitPrice: l.unitPrice, lineAmount: l.lineAmount, vatPct: l.vatPct }))
      : [{ key: 'l0' }])
    setOcrSessionId(ocr.aiSessionId)
    setOcrRawUrl(ocr.rawDocumentUrl)
    setOcrSource('ocr')
    setView('list')
    setFormOpen(true)
  }

  function resetForm() {
    setDocKind('invoice'); setSupplierId(''); setLocationId(''); setInvoiceNumber('')
    setInvoiceDate(''); setTaxBase(''); setTaxTotal(''); setGrandTotal(''); setNotes('')
    setReceiptIds([]); setLines([{ key: 'l0' }])
    setOcrSessionId(null); setOcrRawUrl(null); setOcrSource('manual')
  }

  function num(s: string): number | null {
    const v = s.trim().replace(',', '.')
    if (v === '') return null
    const n = Number(v)
    return isNaN(n) ? null : n
  }

  async function handleCreate() {
    if (!activeAccountId) return
    setSaving(true); setError(null)
    try {
      const payloadLines: SupplierInvoiceLineInput[] = lines
        .map(l => ({
          rawText: l.rawText ?? null,
          supplierCode: l.supplierCode ?? null,
          qty: l.qty ?? null,
          unitPrice: l.unitPrice ?? null,
          lineAmount: l.lineAmount ?? null,
          vatPct: l.vatPct ?? null,
        }))
        .filter(l => l.rawText || l.qty !== null || l.lineAmount !== null)
      await createSupplierInvoice({
        accountId: activeAccountId,
        supplierId: supplierId || null,
        locationId: locationId || null,
        docKind,
        invoiceNumber: invoiceNumber || null,
        invoiceDate: invoiceDate || null,
        taxBaseTotal: num(taxBase),
        taxTotal: num(taxTotal),
        grandTotal: num(grandTotal),
        notes: notes || null,
        source: ocrSource,
        aiSessionId: ocrSessionId,
        rawDocumentUrl: ocrRawUrl,
        lines: payloadLines,
        receiptIds,
      })
      setFormOpen(false); resetForm()
      setFlash('Factura registrada.')
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la factura.')
    } finally {
      setSaving(false)
    }
  }

  async function handleVoid(id: string) {
    setBusyId(id); setError(null)
    try {
      await voidSupplierInvoice(id)
      setFlash('Factura anulada.')
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular.')
    } finally {
      setBusyId(null)
    }
  }

  async function openDetail(id: string) {
    setDetailId(id); setView('detail'); setDetailLoading(true); setMatchSummary(null); setError(null)
    try {
      const res = await getSupplierInvoiceById(id)
      if (res) { setDetailHead(res.invoice); setDetailLines(res.lines) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la factura.')
    } finally {
      setDetailLoading(false)
    }
  }
  async function refreshDetail() {
    if (!detailId) return
    const res = await getSupplierInvoiceById(detailId)
    if (res) { setDetailHead(res.invoice); setDetailLines(res.lines) }
  }
  async function handleRunMatch() {
    if (!detailId) return
    setDetailBusy(true); setError(null)
    try {
      const sum = await runInvoiceMatch(detailId)
      setMatchSummary(sum)
      await refreshDetail()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cuadrar la factura.')
    } finally {
      setDetailBusy(false)
    }
  }
  async function handleApprove() {
    if (!detailId) return
    setDetailBusy(true); setError(null)
    try {
      await approveInvoice(detailId, authUserId ?? null, userProfile?.displayName ?? null)
      setFlash('Factura aprobada.')
      await refreshDetail()
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar.')
    } finally {
      setDetailBusy(false)
    }
  }
  async function handleMarkDiscrepancy() {
    if (!detailId) return
    setDetailBusy(true); setError(null)
    try {
      await markInvoiceDiscrepancy(detailId)
      setFlash('Factura marcada con discrepancias.')
      await refreshDetail()
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar.')
    } finally {
      setDetailBusy(false)
    }
  }

  if (view === 'detail' && detailId) {
    return (
      <InvoiceDetail
        head={detailHead}
        lines={detailLines}
        loading={detailLoading}
        busy={detailBusy}
        summary={matchSummary}
        error={error}
        onBack={() => { setView('list'); setDetailId(null); setDetailHead(null); setDetailLines([]); setMatchSummary(null) }}
        onRunMatch={handleRunMatch}
        onApprove={handleApprove}
        onMarkDiscrepancy={handleMarkDiscrepancy}
      />
    )
  }

  if (view === 'scan' && activeAccountId) {
    return (
      <InvoiceScanPanel
        accountId={activeAccountId}
        onBack={() => setView('list')}
        onCreateInvoice={applyOcrPrefill}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">Facturas</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Registra la factura del proveedor. Cuadra contra lo recibido y confirma el coste.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('scan')}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base"
          >
            <ScanLine size={16} />
            Escanear factura
          </button>
          <button
            type="button"
            onClick={() => { resetForm(); setFormOpen(true) }}
            disabled={!activeAccountId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
          >
            <Plus size={16} />
            Nueva factura
          </button>
        </div>
      </div>

      {flash && <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm">{flash}</div>}
      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">
          <FileText size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Aún no hay facturas. Registra la primera.</p>
        </div>
      ) : (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-page text-text-secondary">
              <tr>
                <th className="text-left font-medium px-3 py-2">Código</th>
                <th className="text-left font-medium px-3 py-2">Tipo</th>
                <th className="text-left font-medium px-3 py-2">Nº factura</th>
                <th className="text-left font-medium px-3 py-2">Proveedor</th>
                <th className="text-left font-medium px-3 py-2">Fecha</th>
                <th className="text-right font-medium px-3 py-2">Total</th>
                <th className="text-left font-medium px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t border-border-default hover:bg-page cursor-pointer" onClick={() => openDetail(inv.id)}>
                  <td className="px-3 py-2 font-medium text-text-primary">{inv.code ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{inv.docKind === 'credit_note' ? 'Abono' : 'Factura'}</td>
                  <td className="px-3 py-2 text-text-secondary">{inv.invoiceNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-text-primary">{inv.supplierName ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{fmtDate(inv.invoiceDate)}</td>
                  <td className="px-3 py-2 text-right text-text-primary">{fmtMoney(inv.grandTotal)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_CLS[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {inv.status !== 'anulada' && inv.status !== 'pagada' && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleVoid(inv.id) }} disabled={busyId === inv.id}
                        title="Anular" className="text-text-tertiary hover:text-danger disabled:opacity-50">
                        {busyId === inv.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Alta manual */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-2xl my-8">
            <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
              <h3 className="text-base font-medium text-text-primary">Nueva factura</h3>
              <button type="button" onClick={() => setFormOpen(false)} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Tipo</span>
                  <select value={docKind} onChange={e => setDocKind(e.target.value as SupplierInvoiceDocKind)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
                    <option value="invoice">Factura</option>
                    <option value="credit_note">Abono / nota de crédito</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Proveedor</span>
                  <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
                    <option value="">— Selecciona —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Nº de factura</span>
                  <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Fecha</span>
                  <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Local</span>
                  <select value={locationId} onChange={e => setLocationId(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
                    <option value="">— Sin local —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              </div>

              {/* Albaranes que cubre */}
              {supplierReceipts.length > 0 && (
                <div>
                  <span className="text-[11px] text-text-secondary">Albaranes que cubre (opcional)</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {supplierReceipts.map(r => {
                      const on = receiptIds.includes(r.id)
                      return (
                        <button key={r.id} type="button"
                          onClick={() => setReceiptIds(ids => on ? ids.filter(x => x !== r.id) : [...ids, r.id])}
                          className={`text-[11px] px-2 py-1 rounded border transition-base ${on ? 'bg-accent text-text-on-accent border-accent' : 'bg-card text-text-secondary border-border-default hover:bg-page'}`}>
                          {r.code ?? r.id.slice(0, 6)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Totales */}
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Base imponible</span>
                  <input type="text" inputMode="decimal" value={taxBase} onChange={e => setTaxBase(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">IVA</span>
                  <input type="text" inputMode="decimal" value={taxTotal} onChange={e => setTaxTotal(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-text-secondary">Total</span>
                  <input type="text" inputMode="decimal" value={grandTotal} onChange={e => setGrandTotal(e.target.value)}
                    className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                </label>
              </div>

              {/* Líneas (manual simple; el casado/three-way llega en C3.2-3) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-text-secondary">Líneas</span>
                  <button type="button" onClick={() => setLines(ls => [...ls, { key: `l${Date.now()}` }])}
                    className="text-[11px] text-accent hover:underline">+ Añadir línea</button>
                </div>
                <div className="space-y-1.5">
                  {lines.map((l, i) => (
                    <div key={l.key} className="flex gap-1.5 items-center">
                      <input type="text" placeholder="Concepto" value={l.rawText ?? ''} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, rawText: e.target.value } : x))}
                        className="flex-1 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                      <input type="text" inputMode="decimal" placeholder="Cant." value={l.qty ?? ''} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: num(e.target.value) } : x))}
                        className="w-16 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                      <input type="text" inputMode="decimal" placeholder="Importe" value={l.lineAmount ?? ''} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, lineAmount: num(e.target.value) } : x))}
                        className="w-20 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary" />
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-text-tertiary hover:text-danger"><X size={14} /></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-[11px] text-text-secondary">Notas</span>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
              </label>
            </div>
            <div className="px-5 py-3 border-t border-border-default flex items-center justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} disabled={saving}
                className="px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">Cancelar</button>
              <button type="button" onClick={handleCreate} disabled={saving || !supplierId}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                {saving && <Loader2 size={14} className="animate-spin" />} Registrar factura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── C3.3 — Pantalla de revisión / three-way match ──
function fmtN(n: unknown): string {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  return isNaN(num) ? String(n) : num.toLocaleString('es-ES', { maximumFractionDigits: 4 })
}

function MatchDetailText({ result, detail }: { result: string | null; detail: Record<string, unknown> | null }) {
  if (!detail || !result) return null
  if (result === 'diferencia_precio') {
    return <span className="text-xs text-text-secondary">Facturado {fmtN(detail.invoiced_price)} € · albarán {fmtN(detail.receipt_cost)} € ({fmtN(detail.pct)}%)</span>
  }
  if (result === 'diferencia_cantidad') {
    return <span className="text-xs text-text-secondary">Facturado {fmtN(detail.invoiced_qty)} · recibido {fmtN(detail.received_qty)}</span>
  }
  if (result === 'no_recibido') {
    return <span className="text-xs text-text-secondary">Facturado {fmtN(detail.invoiced_qty)} · sin recepción</span>
  }
  if (result === 'iva_no_cuadra') {
    return <span className="text-xs text-text-secondary">IVA factura {fmtN(detail.invoiced_vat)}% · esperado {fmtN(detail.expected_vat)}%</span>
  }
  return null
}

function InvoiceDetail({
  head, lines, loading, busy, summary, error, onBack, onRunMatch, onApprove, onMarkDiscrepancy,
}: {
  head: SupplierInvoice | null
  lines: SupplierInvoiceLine[]
  loading: boolean
  busy: boolean
  summary: InvoiceMatchSummary | null
  error: string | null
  onBack: () => void
  onRunMatch: () => void
  onApprove: () => void
  onMarkDiscrepancy: () => void
}) {
  const hasDiscrepancies = summary
    ? (summary.diffPrice + summary.diffQty + summary.notReceived + summary.vatBad + summary.unmatched) > 0
    : (head?.matchStatus === 'con_diferencias')
  const approved = head?.status === 'aprobada'

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-text-secondary hover:text-text-primary inline-flex items-center gap-1 text-sm">
        <ArrowLeft size={16} /> Volver a facturas
      </button>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
      ) : !head ? (
        <p className="text-sm text-text-secondary">No se encontró la factura.</p>
      ) : (
        <>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-display font-medium text-text-primary">
                {head.code ?? 'Factura'} {head.docKind === 'credit_note' ? '· Abono' : ''}
              </h2>
              <p className="text-sm text-text-secondary mt-0.5">
                {head.supplierName ?? '—'} · nº {head.invoiceNumber ?? '—'} · {head.invoiceDate ?? '—'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onRunMatch} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Cuadrar (revisar)
              </button>
              {!approved && (
                <>
                  <button type="button" onClick={onMarkDiscrepancy} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-warning/40 text-warning bg-warning-bg hover:opacity-90 disabled:opacity-50 transition-base">
                    <AlertTriangle size={15} /> Marcar discrepancia
                  </button>
                  <button type="button" onClick={onApprove} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                    <CheckCircle2 size={15} /> Aprobar
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Resumen del match */}
          {summary && (
            <div className={`p-3 rounded-md border text-sm ${hasDiscrepancies ? 'bg-warning-bg text-warning border-warning/20' : 'bg-success-bg text-success border-success/20'}`}>
              <div className="flex items-center gap-1.5 font-medium">
                {hasDiscrepancies ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                {hasDiscrepancies ? 'Hay diferencias que revisar' : 'Todo cuadra'}
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {summary.ok} OK
                {summary.diffPrice > 0 ? ` · ${summary.diffPrice} de precio` : ''}
                {summary.diffQty > 0 ? ` · ${summary.diffQty} de cantidad` : ''}
                {summary.notReceived > 0 ? ` · ${summary.notReceived} no recibido` : ''}
                {summary.vatBad > 0 ? ` · ${summary.vatBad} de IVA` : ''}
                {summary.unmatched > 0 ? ` · ${summary.unmatched} sin casar` : ''}
              </p>
            </div>
          )}
          {approved && (
            <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-center gap-1.5">
              <CheckCircle2 size={16} /> Aprobada{head.matchStatus === 'con_diferencias' ? ' (con diferencias registradas)' : ''}.
            </div>
          )}

          {/* Líneas con veredicto */}
          <div className="border border-border-default rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-page text-text-secondary">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Concepto</th>
                  <th className="text-right font-medium px-3 py-2">Cant.</th>
                  <th className="text-right font-medium px-3 py-2">Precio</th>
                  <th className="text-right font-medium px-3 py-2">IVA</th>
                  <th className="text-left font-medium px-3 py-2">Veredicto</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const verdict = matchResultLabel(l.matchResult)
                  return (
                    <tr key={l.id} className="border-t border-border-default align-top">
                      <td className="px-3 py-2 text-text-primary">
                        {l.itemName ?? l.rawText ?? '—'}
                        {l.supplierCode ? <span className="text-text-tertiary text-xs"> · {l.supplierCode}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right text-text-secondary">{fmtN(l.qty)}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{fmtN(l.unitPrice)}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{l.vatPct ?? '—'}%</td>
                      <td className="px-3 py-2">
                        {verdict ? (
                          <div className="space-y-0.5">
                            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${verdict.cls}`}>{verdict.label}</span>
                            <div><MatchDetailText result={l.matchResult} detail={l.matchDetail} /></div>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">— sin revisar —</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
