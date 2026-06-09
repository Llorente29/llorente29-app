// src/modules/supply/components/ReceiptPhotoViewer.tsx
//
// Visor de la foto/PDF del albarán para la pantalla de recepción (espejo del
// albarán). Resuelve la URL firmada del bucket receipt-uploads a partir de la
// ruta (rawDocumentUrl) y la muestra AL LADO de las líneas, con ZOOM para leer
// la letra pequeña (lotes, precios). Hueco 2 del frente "Recepción usable".
//
// - Imagen → miniatura clicable + lightbox a tamaño natural (scroll = lupa).
// - PDF → visor embebido.
// - Sin foto → placeholder discreto (no estorba).
//
// Autónomo: no conoce el formulario; recibe solo la ruta.

import { useEffect, useState } from 'react'
import { ZoomIn, X, FileText, ImageOff, Loader2 } from 'lucide-react'
import { getReceiptFileUrl } from '@/modules/supply/services/goodsReceiptService'

interface ReceiptPhotoViewerProps {
  /** Ruta del documento en el bucket (goods_receipt.rawDocumentUrl). Null = sin foto. */
  path: string | null
  className?: string
}

function isPdf(p: string): boolean {
  return /\.pdf($|\?)/i.test(p)
}

export default function ReceiptPhotoViewer({ path, className }: ReceiptPhotoViewerProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!path) { setUrl(null); setFailed(false); return }
    setLoading(true); setFailed(false)
    getReceiptFileUrl(path)
      .then(u => { if (!cancelled) { setUrl(u); setFailed(!u) } })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path])

  // Cerrar el zoom con Escape.
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  // Sin foto: placeholder que no estorba.
  if (!path) {
    return (
      <div className={`rounded-lg border border-dashed border-border-default bg-page p-4 text-center ${className ?? ''}`}>
        <ImageOff size={20} className="mx-auto text-text-tertiary" />
        <p className="mt-1.5 text-xs text-text-tertiary">Sin foto del albarán</p>
      </div>
    )
  }

  const pdf = isPdf(path)

  return (
    <div className={`rounded-lg border border-border-default bg-card overflow-hidden ${className ?? ''}`}>
      <div className="px-3 py-2 border-b border-border-default flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary inline-flex items-center gap-1.5">
          <FileText size={14} /> Albarán
        </span>
        {url && !pdf && (
          <button type="button" onClick={() => setZoom(true)}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-base">
            <ZoomIn size={14} /> Ampliar
          </button>
        )}
      </div>

      <div className="p-2">
        {loading && (
          <div className="flex items-center justify-center h-48 text-text-tertiary">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && failed && (
          <div className="flex items-center justify-center h-48 text-xs text-text-tertiary px-3 text-center">
            No se pudo cargar la foto del albarán.
          </div>
        )}
        {!loading && !failed && url && pdf && (
          <iframe src={url} title="Albarán (PDF)"
            className="w-full h-[60vh] lg:h-[70vh] rounded-md border border-border-default" />
        )}
        {!loading && !failed && url && !pdf && (
          <button type="button" onClick={() => setZoom(true)} className="block w-full" title="Ampliar">
            <img src={url} alt="Albarán escaneado"
              className="w-full rounded-md border border-border-default object-contain max-h-[70vh]" />
          </button>
        )}
      </div>

      {/* Lightbox: imagen a tamaño natural en contenedor con scroll (= lupa para la letra pequeña). */}
      {zoom && url && !pdf && (
        <div role="dialog" aria-modal="true" onClick={() => setZoom(false)}
          className="fixed inset-0 z-[110] bg-black/80 overflow-auto p-4 flex items-start justify-center">
          <button type="button" aria-label="Cerrar"
            onClick={(e) => { e.stopPropagation(); setZoom(false) }}
            className="fixed top-4 right-4 z-[111] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-base">
            <X size={20} />
          </button>
          <img src={url} alt="Albarán escaneado (ampliado)"
            onClick={(e) => e.stopPropagation()}
            className="max-w-none h-auto rounded-md" style={{ minWidth: '100%' }} />
        </div>
      )}
    </div>
  )
}
