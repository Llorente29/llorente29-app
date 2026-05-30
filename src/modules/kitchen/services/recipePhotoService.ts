// src/modules/kitchen/services/recipePhotoService.ts
//
// Foto del plato (emplatado) para el editor de escandallos.
//
// Bucket: recipe-uploads (PRIVADO, aislamiento real por cuenta vía RLS).
//   Convención de ruta obligatoria por las policies del bucket:
//   {account_id}/...  → storage.foldername(name)[1] = account_id.
//   Para la foto del plato usamos: {accountId}/dishes/{recipeId}-{ts}.jpg
//   (la subcarpeta 'dishes' separa la foto decorativa de las fichas que G7
//    subirá para visión IA, que irán a {accountId}/recipe-sources/...).
//
// Como el bucket es privado, en recipe_item.kitchen_photo_url guardamos el
// STORAGE PATH (no una URL): las URLs firmadas caducan. La URL firmada se
// genera al vuelo al renderizar, con getDishPhotoUrl().
//
// Compresión en cliente (canvas → JPEG): mismas constantes que el patrón ya
// usado en APPCC (1200px, calidad 0.7), porque las fotos de móvil de cocina
// son pesadas y subirlas sin comprimir es inaceptable.

import { supabase } from '@/lib/supabase'

const BUCKET = 'recipe-uploads'
const SIGNED_URL_TTL_SECONDS = 3600

/**
 * Comprime una imagen en el navegador redimensionando y recomprimiendo a JPEG.
 * Mismo patrón validado en el módulo APPCC (photosService.compressImage).
 */
function compressImage(file: File, maxWidthPx = 1200, quality = 0.7): Promise<Blob> {
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
      if (!ctx) {
        reject(new Error('No se pudo procesar la imagen (canvas).'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo cargar la imagen.'))
    }
    img.src = url
  })
}

/**
 * Sube la foto del plato y devuelve el STORAGE PATH (para guardar en
 * kitchen_photo_url). NO devuelve URL: el bucket es privado.
 *
 * @param accountId  cuenta dueña (primer segmento de la ruta → RLS)
 * @param recipeId   id del recipe_item (para nombrar el fichero)
 * @param file       archivo original del input
 */
export async function uploadDishPhoto(
  accountId: string,
  recipeId: string,
  file: File,
): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Validación de tipo: solo imágenes (la cámara/galería del móvil ya filtra,
  // pero defendemos por si acaso).
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen (JPG, PNG o WEBP).')
  }

  const compressed = await compressImage(file)
  const ts = Date.now()
  const path = `${accountId}/dishes/${recipeId}-${ts}.jpg`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
  if (uploadErr) throw new Error(`Error subiendo la foto: ${uploadErr.message}`)

  return path
}

/**
 * Genera una URL firmada temporal para mostrar la foto. Devuelve null si no
 * hay path o si la firma falla (el editor mostrará el placeholder).
 *
 * Acepta tanto un storage path ({accountId}/dishes/...) como, por
 * compatibilidad, una URL http(s) ya completa (si algún registro antiguo la
 * tuviera): en ese caso la devuelve tal cual.
 */
export async function getDishPhotoUrl(pathOrUrl: string | null | undefined): Promise<string | null> {
  if (!pathOrUrl) return null
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl
  if (!supabase) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pathOrUrl, SIGNED_URL_TTL_SECONDS)
  if (error) {
    console.error('[recipePhotoService] createSignedUrl error', error)
    return null
  }
  return data?.signedUrl ?? null
}

/**
 * Borra una foto del bucket (al cambiarla o al archivar el plato). No es fatal:
 * si falla, se loguea pero no rompe el flujo (mismo criterio que APPCC).
 */
export async function deleteDishPhoto(path: string | null | undefined): Promise<void> {
  if (!supabase || !path) return
  if (path.startsWith('http://') || path.startsWith('https://')) return // URL antigua, no es path del bucket
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.error('[recipePhotoService] remove error', error)
}
