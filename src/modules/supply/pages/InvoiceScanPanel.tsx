// src/modules/supply/pages/InvoiceScanPanel.tsx
//
// Folvy Supply C3.2 — Escanear factura del proveedor.
// Reutiliza el OCR de recepción (scanReceipt → Edge Function ocr-albaran, que YA
// detecta facturas) y, al leer, resuelve la cabecera de FACTURA (proveedor + nº +
// fecha + totales + albaranes sin facturar) y abre el alta de factura prerellenada.
// "IA propone, humano decide": solo LEE y prerellena; el humano confirma en el alta.
//
// Compacto a propósito (el visor paralelo completo vive en ReceiptScanPanel); aquí
// basta una vista de lo leído + visor simple, reduciendo superficie de error.

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Upload, Camera, Loader2, FileText, X, ScanLine,
  CheckCircle2, AlertTriangle, Eye,
} from 'lucide-react'
import { useIsMobile } from '@/shell/useIsMobile'
import {
  scanReceipt, getReceiptFileUrl, type OcrAlbaranResult,
} from '@/modules/supply/services/goodsReceiptService'
import {
  resolveInvoiceHeader, findDuplicateInvoice, buildInvoiceOcrPrefill,
  type InvoiceOcrPrefill, type DuplicateInvoiceHit,
} from '@/modules/supply/services/supplierInvoiceService'

interface InvoiceScanPanelProps {
  accountId: string
  onBack: () => void
  onCreateInvoice: (ocr: InvoiceOcrPrefill) => void
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function InvoiceScanPanel({ accountId, onBack, onCreateInvoice }: InvoiceScanPanelProps) {
  const isMobile = useIsMobile()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<File[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OcrAlbaranResult | null>(null)
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState(false)

  const [creating, setCreating] = useState(false)
  const [dupHit, setDupHit] = useState<DuplicateInvoiceHit | null>(null)
  const [pendingOcr, setPendingOcr] = useState<InvoiceOcrPrefill | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!result || result.filePaths.length === 0) { setPageUrl(null); return }
    getReceiptFileUrl(result.filePaths[0])
      .then(u => { if (!cancelled) setPageUrl(u) })
      .catch(() => { if (!cancelled) setPageUrl(null) })
    return () => { cancelled = true }
  }, [result])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length > 0) { setFiles(prev => [...prev, ...picked]); setError(null) }
    if (e.target) e.target.value = ''
  }
  function removeFile(i: number) { setFiles(prev => prev.filter((_, idx) => idx !== i)) }

  async function handleScan() {
    if (files.length === 0) { setError('Añade al menos una foto o PDF de la factura.'); return }
    setScanning(true); setError(null); setResult(null)
    try {
      const res = await scanReceipt(accountId, files)
      setResult(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la factura.')
    } finally {
      setScanning(false)
    }
  }

  function reset() { setResult(null); setFiles([]); setError(null); setPageUrl(null) }

  async function handleCreate() {
    if (!result) return
    setCreating(true); setError(null)
    try {
      const header = await resolveInvoiceHeader(accountId, result.document)
      const ocr = buildInvoiceOcrPrefill(result.sessionId, result.filePaths[0] ?? null, header, result.lines)
      const dup = await findDuplicateInvoice(accountId, header.supplierId || null, header.invoiceNumber)
      if (dup) { setPendingOcr(ocr); setDupHit(dup); setCreating(false); return }
      onCreateInvoice(ocr)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar la factura.')
      setCreating(false)
    }
  }

  const v = result?.validation

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-text-secondary hover:text-text-primary inline-flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Volver
        </button>
      </div>
      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Escanear factura</h2>
        <p className="text-sm text-text-secondary mt-0.5">Sube una foto o PDF de la factura. La leemos y la preparamos para que la revises.</p>
      </div>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {!result && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {isMobile && (
              <>
                <button type="button" onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base">
                  <Camera size={16} /> Hacer foto
                </button>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
              </>
            )}
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">
              <Upload size={16} /> {isMobile ? 'Elegir archivo' : 'Elegir foto o PDF'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={onPick} />
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-text-secondary border border-border-default rounded-md px-3 py-2 bg-card">
                  {f.type === 'application/pdf' ? <FileText size={15} /> : <Eye size={15} />}
                  <span className="flex-1 truncate">{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} className="text-text-tertiary hover:text-danger"><X size={15} /></button>
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={handleScan} disabled={scanning || files.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            {scanning ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
            {scanning ? 'Leyendo…' : 'Leer factura'}
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Validación por base imponible */}
          {v && (
            <div className={`p-3 rounded-md border text-sm ${v.needs_review ? 'bg-warning-bg text-warning border-warning/20' : 'bg-success-bg text-success border-success/20'}`}>
              <div className="flex items-center gap-1.5 font-medium">
                {v.needs_review ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                {v.needs_review ? 'Revisa antes de crear' : 'Lectura coherente'}
              </div>
              {v.reasons && v.reasons.length > 0 && (
                <ul className="mt-1 text-xs list-disc list-inside text-text-secondary">{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              )}
              {v.lines_sum !== null && (
                <p className="mt-1 text-text-secondary text-xs">Líneas: {fmtMoney(v.lines_sum)} · Base: {fmtMoney(v.base_declared)}{v.diff_pct !== null ? ` · desvío ${v.diff_pct}%` : ''}</p>
              )}
            </div>
          )}

          {/* Cabecera leída */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="border border-border-default rounded-md p-3 bg-card text-sm space-y-1">
              <p><span className="text-text-secondary">Proveedor:</span> <span className="text-text-primary">{result.document.supplier_name ?? '—'}</span></p>
              <p><span className="text-text-secondary">NIF:</span> <span className="text-text-primary">{result.document.supplier_tax_id ?? '—'}</span></p>
              <p><span className="text-text-secondary">Nº factura:</span> <span className="text-text-primary">{result.document.doc_number ?? '—'}</span></p>
              <p><span className="text-text-secondary">Fecha:</span> <span className="text-text-primary">{result.document.doc_date ?? '—'}</span></p>
              <p><span className="text-text-secondary">Total:</span> <span className="text-text-primary">{fmtMoney(result.document.grand_total)} €</span></p>
            </div>
            {pageUrl && (
              <button type="button" onClick={() => setLightbox(true)} className="border border-border-default rounded-md overflow-hidden bg-page">
                <img src={pageUrl} alt="Factura" className="w-full h-40 object-cover" />
              </button>
            )}
          </div>

          {/* Líneas leídas */}
          <div className="border border-border-default rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-page text-text-secondary">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Concepto</th>
                  <th className="text-right font-medium px-3 py-2">Cant.</th>
                  <th className="text-right font-medium px-3 py-2">Precio</th>
                  <th className="text-right font-medium px-3 py-2">Importe</th>
                  <th className="text-right font-medium px-3 py-2">IVA</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border-default">
                    <td className="px-3 py-2 text-text-primary">{l.raw_text}{l.supplier_code ? <span className="text-text-tertiary text-xs"> · {l.supplier_code}</span> : null}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{l.quantity ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{fmtMoney(l.unit_price_net)}</td>
                    <td className="px-3 py-2 text-right text-text-primary">{fmtMoney(l.line_amount)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{l.vat_pct ?? '—'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">Escanear otra</button>
            <button type="button" onClick={handleCreate} disabled={creating}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
              {creating && <Loader2 size={14} className="animate-spin" />} Crear factura desde esto
            </button>
          </div>
        </div>
      )}

      {/* Lightbox simple */}
      {lightbox && pageUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <img src={pageUrl} alt="Factura" className="max-w-full max-h-full object-contain" />
          <button type="button" onClick={() => setLightbox(false)} className="absolute top-4 right-4 text-white"><X size={24} /></button>
        </div>
      )}

      {/* Anti-duplicado */}
      {dupHit && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-md p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />
              <div>
                <h3 className="text-base font-medium text-text-primary">Puede que ya hayas registrado esta factura</h3>
                <p className="text-sm text-text-secondary mt-1">
                  Ya existe una factura {dupHit.code ? <strong>{dupHit.code}</strong> : null} de este proveedor con el nº <strong>{result?.document.doc_number}</strong> ({dupHit.status}). Si la creas otra vez, quedará duplicada.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setDupHit(null); setPendingOcr(null) }}
                className="px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">Cancelar</button>
              <button type="button" onClick={() => { if (pendingOcr) onCreateInvoice(pendingOcr); setDupHit(null); setPendingOcr(null) }}
                className="px-3 py-2 rounded-md text-sm font-medium bg-warning text-text-on-accent hover:opacity-90 transition-base">Crear de todos modos</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
