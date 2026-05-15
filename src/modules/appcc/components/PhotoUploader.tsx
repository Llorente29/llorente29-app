// src/modules/appcc/components/PhotoUploader.tsx
// Componente de captura y gestión de fotos para items APPCC.
// Permite tomar foto con cámara, seleccionar de galería, ver thumbs y borrar.

import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2, X, Loader2 } from 'lucide-react'
import * as photosService from '@/modules/appcc/services/photosService'
import type { ExecutionPhoto } from '@/modules/appcc/services/photosService'

interface PhotoUploaderProps {
  /** ID de la respuesta (appcc_execution_responses.id). Null si aún no se ha guardado la primera respuesta. */
  responseId: string | null
  /** ID del usuario actual */
  userId: string
  /** Deshabilitar (ej: checklist completado) */
  disabled?: boolean
}

export default function PhotoUploader({ responseId, userId, disabled = false }: PhotoUploaderProps) {
  const [photos, setPhotos] = useState<ExecutionPhoto[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  // Cargar fotos existentes cuando tenemos responseId
  useEffect(() => {
    if (!responseId) { setPhotos([]); return }
    let cancel = false
    setLoading(true)
    photosService.listPhotos(responseId)
      .then(list => { if (!cancel) setPhotos(list) })
      .catch(() => { if (!cancel) setPhotos([]) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [responseId])

  async function handleFile(file: File) {
    if (!responseId) {
      setError('Responde primero al campo para poder adjuntar fotos.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const photo = await photosService.uploadPhoto(responseId, file, userId)
      setPhotos(prev => [...prev, photo])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo foto')
    } finally {
      setUploading(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = '' // reset para permitir repetir
  }

  async function handleDelete(photo: ExecutionPhoto) {
    try {
      await photosService.deletePhoto(photo)
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
    } catch {
      setError('Error borrando foto')
    }
  }

  return (
    <div className="space-y-3">
      {/* Botones de captura */}
      {!disabled && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={uploading || !responseId}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border border-border-default bg-card text-text-primary hover:border-accent hover:bg-accent-bg transition-base disabled:opacity-40 min-h-[44px]"
          >
            <Camera size={16} /> Cámara
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={uploading || !responseId}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border border-border-default bg-card text-text-primary hover:border-accent hover:bg-accent-bg transition-base disabled:opacity-40 min-h-[44px]"
          >
            <ImagePlus size={16} /> Galería
          </button>
          {uploading && (
            <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
              <Loader2 size={14} className="animate-spin" /> Subiendo...
            </span>
          )}

          {/* Inputs ocultos */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={onFileChange}
            className="hidden"
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Mensaje si no hay responseId */}
      {!responseId && !disabled && (
        <p className="text-xs text-text-secondary italic">
          Responde al campo para poder adjuntar fotos.
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-danger">{error}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={14} className="animate-spin" /> Cargando fotos...
        </div>
      )}

      {/* Thumbnails */}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map(photo => (
            <div key={photo.id} className="relative group">
              <button
                type="button"
                onClick={() => setLightbox(photo.url ?? null)}
                className="block w-20 h-20 rounded-lg overflow-hidden border border-border-default bg-page hover:ring-2 hover:ring-accent transition-base"
              >
                {photo.url ? (
                  <img
                    src={photo.url}
                    alt={photo.file_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-secondary">
                    <Camera size={20} />
                  </div>
                )}
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(photo)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-text-on-accent flex items-center justify-center opacity-0 group-hover:opacity-100 transition-base shadow-sm"
                  title="Eliminar foto"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-card/90 text-text-primary flex items-center justify-center hover:bg-card transition-base"
          >
            <X size={24} />
          </button>
          <img
            src={lightbox}
            alt="Foto ampliada"
            className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
