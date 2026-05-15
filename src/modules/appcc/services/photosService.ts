// src/modules/appcc/services/photosService.ts
// Gestión de fotos de ejecuciones APPCC.
// Upload a Supabase Storage (bucket appcc-photos) + registro en appcc_execution_photos.

import { supabase } from '@/lib/supabase'

const BUCKET = 'appcc-photos'

export interface ExecutionPhoto {
  id: string
  response_id: string
  storage_path: string
  file_name: string
  mime_type: string
  file_size_bytes: number
  caption: string | null
  uploaded_at: string
  uploaded_by: string | null
  /** URL firmada temporal para mostrar la foto */
  url?: string
}

// ============================================================
// COMPRESIÓN CLIENTE
// ============================================================

/**
 * Comprime una imagen en el navegador a ~150KB max (configurable).
 * Usa canvas para redimensionar y recomprimir en JPEG.
 */
export async function compressImage(
  file: File,
  maxWidthPx = 1200,
  quality = 0.7,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height
      if (w > maxWidthPx) {
        h = Math.round(h * (maxWidthPx / w))
        w = maxWidthPx
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No canvas context')); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

// ============================================================
// UPLOAD
// ============================================================

/**
 * Sube una foto al bucket y la registra en appcc_execution_photos.
 * @param responseId  ID de la respuesta (appcc_execution_responses.id)
 * @param file        Archivo original del input
 * @param userId      ID del usuario que sube
 * @param caption     Texto opcional
 * @returns La fila creada en appcc_execution_photos con URL firmada
 */
export async function uploadPhoto(
  responseId: string,
  file: File,
  userId: string,
  caption?: string,
): Promise<ExecutionPhoto> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Comprimir
  const compressed = await compressImage(file)
  const ext = 'jpg' // siempre JPEG tras compresión
  const ts = Date.now()
  const path = `responses/${responseId}/${ts}.${ext}`

  // Subir al bucket
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, {
      contentType: 'image/jpeg',
      upsert: false,
    })
  if (uploadErr) throw uploadErr

  // Registrar en la tabla
  const row = {
    response_id: responseId,
    storage_path: path,
    file_name: file.name,
    mime_type: 'image/jpeg',
    file_size_bytes: compressed.size,
    caption: caption || null,
    uploaded_by: userId,
  }

  const { data, error: dbErr } = await supabase
    .from('appcc_execution_photos')
    .insert(row)
    .select('*')
    .single()
  if (dbErr) throw dbErr

  // Generar URL firmada
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600)

  return {
    ...(data as ExecutionPhoto),
    url: signed?.signedUrl ?? undefined,
  }
}

// ============================================================
// LECTURA
// ============================================================

/**
 * Lista las fotos de una respuesta concreta, con URLs firmadas.
 */
export async function listPhotos(responseId: string): Promise<ExecutionPhoto[]> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_execution_photos')
    .select('*')
    .eq('response_id', responseId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  if (!data || data.length === 0) return []

  // Generar URLs firmadas en batch
  const paths = data.map((d: ExecutionPhoto) => d.storage_path)
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, 3600)

  return data.map((d: ExecutionPhoto, i: number) => ({
    ...d,
    url: signed?.[i]?.signedUrl ?? undefined,
  }))
}

/**
 * Lista TODAS las fotos de una ejecución (todas las respuestas).
 * Útil para la vista completada y el PDF.
 */
export async function listPhotosForExecution(executionId: string): Promise<ExecutionPhoto[]> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Necesitamos un join: photos → responses → execution
  const { data, error } = await supabase
    .from('appcc_execution_photos')
    .select(`
      *,
      appcc_execution_responses!inner(execution_id)
    `)
    .eq('appcc_execution_responses.execution_id', executionId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  if (!data || data.length === 0) return []

  const paths = data.map((d: Record<string, unknown>) => d.storage_path as string)
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, 3600)

  return data.map((d: Record<string, unknown>, i: number) => ({
    id: d.id as string,
    response_id: d.response_id as string,
    storage_path: d.storage_path as string,
    file_name: d.file_name as string,
    mime_type: d.mime_type as string,
    file_size_bytes: d.file_size_bytes as number,
    caption: d.caption as string | null,
    uploaded_at: d.uploaded_at as string,
    uploaded_by: d.uploaded_by as string | null,
    url: signed?.[i]?.signedUrl ?? undefined,
  }))
}

// ============================================================
// BORRADO
// ============================================================

/**
 * Elimina una foto del bucket y de la tabla.
 */
export async function deletePhoto(photo: ExecutionPhoto): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Borrar del bucket
  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .remove([photo.storage_path])
  if (storageErr) console.error('[photosService] storage delete error', storageErr)

  // Borrar de la tabla
  const { error: dbErr } = await supabase
    .from('appcc_execution_photos')
    .delete()
    .eq('id', photo.id)
  if (dbErr) throw dbErr
}
