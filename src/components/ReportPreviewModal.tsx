// src/components/ReportPreviewModal.tsx
// Modal genérico de previsualización de PDFs.
// Muestra cualquier blob de PDF en un <iframe> ocupando casi toda la pantalla,
// con cabecera (título + cerrar) y pie (descargar / imprimir).
//
// Reutilizable desde cualquier módulo (APPCC, Personal, Ventas, etc.).
//
// Uso:
//   const result = await generateXxxPdf(..., { mode: 'preview' })
//   if (result) setPreview(result)  // { blob, url, filename }
//   ...
//   {preview && <ReportPreviewModal preview={preview} onClose={() => setPreview(null)} />}

import { useEffect } from 'react'
import { X, Download, Printer } from 'lucide-react'
import type { PdfPreviewResult } from '@/modules/appcc/services/pdfExportService'

interface Props {
  preview: PdfPreviewResult
  title?: string
  onClose: () => void
}

export default function ReportPreviewModal({ preview, title, onClose }: Props) {
  // Cerrar con ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // Revocar object URL cuando se cierre el modal para liberar memoria
  useEffect(() => {
    return () => {
      try { URL.revokeObjectURL(preview.url) } catch { /* ignore */ }
    }
  }, [preview.url])

  function handleDownload() {
    const a = document.createElement('a')
    a.href = preview.url
    a.download = preview.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function handlePrint() {
    // Abre el PDF en nueva pestaña; el visor del navegador permite imprimir.
    // Más fiable que intentar imprimir un iframe (problemas con CORS y blobs).
    window.open(preview.url, '_blank', 'noopener')
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full h-full sm:w-[min(100%,1100px)] sm:h-[min(100vh-2rem,900px)] sm:rounded-xl shadow-xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ---------- HEADER ---------- */}
        <div className="border-b border-border-default p-3 sm:p-4 flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-text-primary text-base sm:text-lg truncate">
              {title ?? 'Vista previa'}
            </h2>
            <p className="text-xs text-text-secondary truncate">{preview.filename}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 text-text-secondary hover:text-text-primary hover:bg-page rounded-md transition-base"
          >
            <X size={20} />
          </button>
        </div>

        {/* ---------- IFRAME PDF ---------- */}
        <div className="flex-1 bg-page overflow-hidden">
          <iframe
            src={preview.url}
            title={preview.filename}
            className="w-full h-full border-0"
          />
        </div>

        {/* ---------- FOOTER ACTIONS ---------- */}
        <div className="border-t border-border-default p-3 sm:p-4 flex flex-col sm:flex-row gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-card border border-border-default text-text-primary rounded-md text-sm font-medium hover:bg-page transition-base min-h-touch"
          >
            <Printer size={15} /> Imprimir / abrir en pestaña
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base min-h-touch"
          >
            <Download size={15} /> Descargar PDF
          </button>
        </div>
      </div>
    </div>
  )
}
