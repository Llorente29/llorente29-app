// src/modules/supply/pages/ReceiptScanPanel.tsx
//
// C2.2.a-1 — Escanear albarán: el receptor sube foto(s)/PDF, la IA (visión) lee
// cabecera + líneas + impuestos, y se muestra lo leído con una VALIDACIÓN por
// base imponible (Σlíneas ≈ base). En a-1 termina aquí (a-2 añade "crear recepción").
//
// Captura por dispositivo (useIsMobile):
//   · Móvil/tablet: botón "Hacer foto" abre la CÁMARA directa (capture) + opción
//     "elegir archivo". Visor del albarán = lightbox a pantalla completa.
//   · PC: "elegir foto o PDF". Visor del albarán = panel PARALELO (foto a la
//     izquierda con zoom y navegación de páginas; datos a la derecha) — patrón
//     de verificación side-by-side de los OCR de mercado.
//
// Las imágenes se comprimen en cliente al subir; el bucket es privado, así que
// las fotos se muestran con URL firmada (getReceiptFileUrl). "IA propone, humano
// decide": esto solo LEE, no toca stock ni coste.

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Upload, Camera, Loader2, FileText, Image as ImageIcon, X,
  ScanLine, CheckCircle2, AlertTriangle, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Eye,
} from 'lucide-react'
import { useIsMobile } from '@/shell/useIsMobile'
import { scanReceipt, getReceiptFileUrl, resolveReceiptHeader, type OcrAlbaranResult } from '@/modules/supply/services/goodsReceiptService'
import type { OcrPrefill } from '@/modules/supply/pages/GoodsReceiptForm'

interface ReceiptScanPanelProps {
  accountId: string
  onBack: () => void
  onCreateReceipt: (ocr: OcrPrefill) => void
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReceiptScanPanel({ accountId, onBack, onCreateReceipt }: ReceiptScanPanelProps) {
  const isMobile = useIsMobile()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<File[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OcrAlbaranResult | null>(null)

  // Visor de la foto del albarán (URLs firmadas + página actual + zoom/lightbox).
  const [pageUrls, setPageUrls] = useState<(string | null)[]>([])
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!result) { setPageUrls([]); return }
    Promise.all(result.filePaths.map(p => getReceiptFileUrl(p)))
      .then(urls => { if (!cancelled) { setPageUrls(urls); setPage(0); setZoom(false) } })
      .catch(() => { if (!cancelled) setPageUrls([]) })
    return () => { cancelled = true }
  }, [result])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length > 0) { setFiles(prev => [...prev, ...picked]); setError(null) }
    if (e.target) e.target.value = ''
  }
  function removeFile(i: number) { setFiles(prev => prev.filter((_, idx) => idx !== i)) }

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

  function reset() { setResult(null); setFiles([]); setError(null); setPageUrls([]); setPage(0); setZoom(false) }

  const [creating, setCreating] = useState(false)
  async function handleCreate() {
    if (!result) return
    setCreating(true); setError(null)
    try {
      const header = await resolveReceiptHeader(accountId, result.document)
      const ocr: OcrPrefill = {
        aiSessionId: result.sessionId,
        supplierId: header.supplierId,
        deliveredBy: header.deliveredBy,
        locationId: header.locationId,
        supplierDocNumber: header.supplierDocNumber,
        receiptDate: header.receiptDate,
        rawDocumentUrl: result.filePaths[0] ?? null,
        unmatchedSupplier: header.unmatchedSupplier,
        unmatchedLocation: header.unmatchedLocation,
        lines: result.lines.map(l => ({
          recipeItemId: null,                 // casado en C2.2.b
          productName: l.raw_text,
          supplierCode: l.supplier_code,
          qty: l.quantity,
          unitCost: l.unit_price_net,
          lotCode: l.lot_code,
          expiryDate: l.expiry_date,
        })),
      }
      onCreateReceipt(ocr)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar la recepción.')
      setCreating(false)
    }
  }

  const curUrl = pageUrls[page] ?? null
  const curIsPdf = (result?.filePaths[page] ?? '').toLowerCase().endsWith('.pdf')
  const pageCount = result?.filePaths.length ?? 0

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

      {/* Inputs ocultos: cámara (capture) y archivo */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple onChange={onPick} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple onChange={onPick} className="hidden" />

      {/* Sin resultado: zona de captura */}
      {!result && (
        <>
          <div className="rounded-lg border border-dashed border-border-default p-6">
            <div className="text-center">
              <ScanLine size={28} className="mx-auto text-text-secondary mb-2" />
              <p className="text-sm text-text-primary font-medium">Añade el albarán</p>
              <p className="text-xs text-text-secondary mt-1">
                Una o varias páginas. {isMobile ? 'Hazle una foto o sube un archivo.' : 'Fotos (JPG/PNG) o PDF. Si la factura tiene 2 hojas, añade las dos.'}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                {isMobile && (
                  <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={scanning}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                    <Camera size={15} />
                    Hacer foto
                  </button>
                )}
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={scanning}
                  className={
                    isMobile
                      ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page disabled:opacity-50 transition-base'
                      : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base'
                  }>
                  <Upload size={15} />
                  {isMobile ? 'Elegir archivo' : 'Elegir foto o PDF'}
                </button>
              </div>
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

      {/* Resultado */}
      {result && (
        <>
          <ValidationBanner result={result} />

          {/* PC: paralelo (foto izquierda + datos derecha). Móvil: solo datos + botón ver. */}
          <div className={isMobile ? 'space-y-4' : 'flex gap-4 items-start'}>
            {/* Foto (solo PC, en paralelo) */}
            {!isMobile && pageCount > 0 && (
              <div className="w-[38%] shrink-0 sticky top-4">
                <PhotoViewer
                  url={curUrl} isPdf={curIsPdf} zoom={zoom} onToggleZoom={() => setZoom(z => !z)}
                  page={page} pageCount={pageCount} onPrev={() => { setPage(p => Math.max(0, p - 1)); setZoom(false) }}
                  onNext={() => { setPage(p => Math.min(pageCount - 1, p + 1)); setZoom(false) }}
                />
              </div>
            )}

            {/* Datos leídos */}
            <div className={isMobile ? 'space-y-4' : 'flex-1 min-w-0 space-y-4'}>
              {isMobile && pageCount > 0 && (
                <button type="button" onClick={() => { setLightbox(true); setZoom(false) }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">
                  <Eye size={15} />
                  Ver albarán {pageCount > 1 ? `(${pageCount} págs.)` : ''}
                </button>
              )}

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

              <div className="rounded-lg border border-border-default overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 680 }}>
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
                {result.aiLatencyMs ? ` · ${(result.aiLatencyMs / 1000).toFixed(1)}s` : ''}
              </p>

              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={reset} disabled={creating}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
                  Escanear otro
                </button>
                <button type="button" onClick={handleCreate} disabled={creating || result.lines.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeft size={15} className="rotate-180" />}
                  Crear recepción desde esto
                </button>
              </div>
            </div>
          </div>

          {/* Lightbox (móvil) */}
          {lightbox && curUrl && (
            <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4" role="dialog" aria-modal="true" onClick={() => setLightbox(false)}>
              <button type="button" onClick={() => setLightbox(false)}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 text-text-primary flex items-center justify-center hover:bg-white transition-colors" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
              {curIsPdf ? (
                <iframe src={curUrl} title="Albarán" className="w-full h-[80vh] rounded-lg bg-white" onClick={e => e.stopPropagation()} />
              ) : (
                <img src={curUrl} alt="Albarán" className="max-w-full max-h-[82vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
              )}
              {pageCount > 1 && (
                <div className="mt-3 flex items-center gap-3 text-white" onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 rounded-full bg-white/15 disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
                  <span className="text-sm tabular-nums">{page + 1} / {pageCount}</span>
                  <button type="button" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page === pageCount - 1} className="p-2 rounded-full bg-white/15 disabled:opacity-30"><ChevronRight className="w-5 h-5" /></button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Visor de foto en PC (paralelo): imagen con zoom toggle + navegación de páginas.
function PhotoViewer({
  url, isPdf, zoom, onToggleZoom, page, pageCount, onPrev, onNext,
}: {
  url: string | null; isPdf: boolean; zoom: boolean; onToggleZoom: () => void
  page: number; pageCount: number; onPrev: () => void; onNext: () => void
}) {
  return (
    <div className="rounded-lg border border-border-default bg-card overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-default bg-page">
        <span className="text-xs text-text-secondary">
          Albarán {pageCount > 1 ? `· ${page + 1}/${pageCount}` : ''}
        </span>
        <div className="flex items-center gap-1">
          {pageCount > 1 && (
            <>
              <button type="button" onClick={onPrev} disabled={page === 0} className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-30" aria-label="Anterior"><ChevronLeft size={16} /></button>
              <button type="button" onClick={onNext} disabled={page === pageCount - 1} className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-30" aria-label="Siguiente"><ChevronRight size={16} /></button>
            </>
          )}
          {!isPdf && url && (
            <button type="button" onClick={onToggleZoom} className="p-1 rounded text-text-secondary hover:text-text-primary" aria-label="Zoom">
              {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            </button>
          )}
        </div>
      </div>
      <div className={`bg-neutral-100 ${zoom ? 'overflow-auto' : 'flex items-center justify-center'}`} style={{ maxHeight: '76vh', minHeight: 240 }}>
        {!url ? (
          <div className="p-8 text-center text-xs text-text-secondary">No se pudo cargar la imagen.</div>
        ) : isPdf ? (
          <iframe src={url} title="Albarán PDF" className="w-full bg-white" style={{ height: '76vh' }} />
        ) : (
          <img
            src={url} alt="Albarán"
            onClick={onToggleZoom}
            className={zoom ? 'max-w-none cursor-zoom-out' : 'max-w-full max-h-[76vh] object-contain cursor-zoom-in'}
            style={zoom ? { width: '180%' } : undefined}
          />
        )}
      </div>
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
        <span>Lectura coherente: las líneas suman {fmtMoney(v.lines_sum)} y la base imponible es {fmtMoney(v.base_declared)}.</span>
      </div>
    )
  }
  // Mensaje afinado: desvío pequeño = probablemente el documento agrupa/redondea;
  // desvío grande = puede faltar o sobrar una línea.
  const small = v.diff_pct !== null && v.diff_pct <= 10
  return (
    <div className="p-3 rounded-md bg-warning-bg text-warning border border-warning/20 text-sm flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium text-text-primary">Conviene revisar esta lectura.</p>
        <ul className="mt-1 space-y-0.5 text-text-secondary">
          {v.reasons.map((r, i) => <li key={i}>· {r}</li>)}
        </ul>
        {v.cuadra === false && (
          <p className="mt-1 text-text-primary">
            {small
              ? 'La suma de líneas no cuadra del todo con la base. Suele pasar cuando el documento agrupa importes por tipo de IVA o por redondeos; revisa que no falte ninguna línea.'
              : 'La suma de líneas se aleja bastante de la base. Puede faltar o sobrar alguna línea: revísalo antes de continuar.'}
          </p>
        )}
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
