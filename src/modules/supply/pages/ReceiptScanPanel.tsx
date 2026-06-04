// src/modules/supply/pages/ReceiptScanPanel.tsx
//
// C2.2.a-1 — Escanear albarán: el receptor sube foto(s)/PDF, la IA (visión) lee
// cabecera + líneas + impuestos, y se muestra lo leído con una VALIDACIÓN por
// base imponible (Σlíneas ≈ base). En a-1 termina aquí: es para ver qué saca la
// IA de cada albarán y afinar. En a-2 se añadirá "Crear recepción desde esto".
//
// Acepta varias imágenes (multipágina, p. ej. facturas Makro de 2 páginas) y PDF.
// "IA propone, humano decide": nada toca stock ni coste; esto solo lee.

import { useRef, useState } from 'react'
import { ArrowLeft, Upload, Loader2, FileText, Image as ImageIcon, X, ScanLine, CheckCircle2, AlertTriangle } from 'lucide-react'
import { scanReceipt, type OcrAlbaranResult } from '@/modules/supply/services/goodsReceiptService'

interface ReceiptScanPanelProps {
  accountId: string
  onBack: () => void
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReceiptScanPanel({ accountId, onBack }: ReceiptScanPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OcrAlbaranResult | null>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length > 0) {
      setFiles(prev => [...prev, ...picked])
      setError(null)
    }
    if (inputRef.current) inputRef.current.value = ''
  }
  function removeFile(i: number) {
    setFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleScan() {
    if (files.length === 0) { setError('Añade al menos una foto o PDF del albarán.'); return }
    setScanning(true); setError(null); setResult(null)
    try {
      const res = await scanReceipt(accountId, files)
      setResult(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el albarán.')
    } finally {
      setScanning(false)
    }
  }

  function reset() {
    setResult(null); setFiles([]); setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} disabled={scanning}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base disabled:opacity-50">
          <ArrowLeft size={16} />
          Recepciones
        </button>
      </div>

      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Escanear albarán</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Haz una foto (o sube el PDF) del albarán. La IA lo lee y te propone las líneas; tú revisas y confirmas.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {/* Sin resultado aún: zona de subida */}
      {!result && (
        <>
          <div className="rounded-lg border border-dashed border-border-default p-6">
            <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple onChange={onPick} className="hidden" />
            <div className="text-center">
              <ScanLine size={28} className="mx-auto text-text-secondary mb-2" />
              <p className="text-sm text-text-primary font-medium">Añade el albarán</p>
              <p className="text-xs text-text-secondary mt-1">
                Una o varias páginas. Fotos (JPG/PNG) o PDF. Si la factura tiene 2 hojas, añade las dos.
              </p>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={scanning}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
                <Upload size={15} />
                Elegir foto o PDF
              </button>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-text-secondary">{files.length} archivo(s):</p>
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border-default bg-card text-sm">
                    <span className="flex items-center gap-2 min-w-0 text-text-primary">
                      {f.type === 'application/pdf' ? <FileText size={15} className="shrink-0 text-text-secondary" /> : <ImageIcon size={15} className="shrink-0 text-text-secondary" />}
                      <span className="truncate">{f.name}</span>
                    </span>
                    <button type="button" onClick={() => removeFile(i)} disabled={scanning}
                      className="shrink-0 text-text-secondary hover:text-danger transition-base disabled:opacity-50" aria-label="Quitar">
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button type="button" onClick={handleScan} disabled={scanning}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                  {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine size={15} />}
                  {scanning ? 'Leyendo…' : 'Leer albarán'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Resultado: lo que leyó la IA */}
      {result && (
        <div className="space-y-4">
          <ValidationBanner result={result} />

          {/* Cabecera leída */}
          <div className="rounded-lg border border-border-default bg-card p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Proveedor" value={result.document.supplier_name} />
            <Field label="CIF/NIF" value={result.document.supplier_tax_id} />
            <Field label="Nº documento" value={result.document.doc_number} />
            <Field label="Fecha" value={result.document.doc_date} />
            <Field label="Tipo" value={result.document.doc_type} />
            <Field label="Entregar en" value={result.document.ship_to} />
            <Field label="Facturar a" value={result.document.bill_to_name} />
            <Field label="Base imponible" value={fmtMoney(result.document.tax_base_total)} />
            <Field label="Total" value={fmtMoney(result.document.grand_total)} />
          </div>

          {/* Líneas leídas */}
          <div className="rounded-lg border border-border-default overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead className="bg-page text-text-secondary">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Código</th>
                  <th className="text-left font-medium px-3 py-2">Artículo</th>
                  <th className="text-right font-medium px-3 py-2">Cant.</th>
                  <th className="text-left font-medium px-3 py-2">Ud.</th>
                  <th className="text-right font-medium px-3 py-2">€/ud (neto)</th>
                  <th className="text-right font-medium px-3 py-2">Importe</th>
                  <th className="text-left font-medium px-3 py-2">Lote / Cad.</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border-default">
                    <td className="px-3 py-2 text-text-secondary tabular-nums">{l.supplier_code ?? '—'}</td>
                    <td className="px-3 py-2 text-text-primary">
                      {l.raw_text}
                      {l.discount_pct ? <span className="ml-1 text-[10px] text-text-secondary">(-{l.discount_pct}%)</span> : null}
                      {l.note ? <span className="block text-[11px] text-text-tertiary">{l.note}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{l.quantity ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{l.unit ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtMoney(l.unit_price_net)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtMoney(l.line_amount)}</td>
                    <td className="px-3 py-2 text-[11px] text-text-secondary">
                      {l.lot_code ? <span className="block">L: {l.lot_code}</span> : null}
                      {l.expiry_date ? <span className="block">Cad: {l.expiry_date}</span> : null}
                      {!l.lot_code && !l.expiry_date ? '—' : null}
                    </td>
                  </tr>
                ))}
                {result.lines.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-4 text-center text-text-secondary">No se leyeron líneas.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-text-tertiary">
            Confianza de lectura: {Math.round((result.confidence ?? 0) * 100)}%
            {result.aiModel ? ` · ${result.aiModel}` : ''}
            {result.aiLatencyMs ? ` · ${(result.aiLatencyMs / 1000).toFixed(1)}s` : ''}
          </p>

          <div className="flex justify-end">
            <button type="button" onClick={reset}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">
              Escanear otro
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ValidationBanner({ result }: { result: OcrAlbaranResult }) {
  const v = result.validation
  const ok = v.cuadra === true && !v.needs_review
  if (ok) {
    return (
      <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-start gap-2">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>
          Lectura coherente: las líneas suman {fmtMoney(v.lines_sum)} y la base imponible es {fmtMoney(v.base_declared)}.
        </span>
      </div>
    )
  }
  return (
    <div className="p-3 rounded-md bg-warning-bg text-warning border border-warning/20 text-sm flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium text-text-primary">Conviene revisar esta lectura.</p>
        <ul className="mt-1 space-y-0.5 text-text-secondary">
          {v.reasons.map((r, i) => <li key={i}>· {r}</li>)}
        </ul>
        {v.lines_sum !== null && (
          <p className="mt-1 text-text-secondary">
            Líneas: {fmtMoney(v.lines_sum)} · Base: {fmtMoney(v.base_declared)}
            {v.diff_pct !== null ? ` · desvío ${v.diff_pct}%` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-sm text-text-primary truncate">{value || '—'}</p>
    </div>
  )
}
