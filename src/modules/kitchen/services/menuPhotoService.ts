import { supabase } from '@/lib/supabase'

const BUCKET = 'menu-photos'

/** Comprime una imagen a JPEG ≤1200px ancho, calidad 0.7 */
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

/** Sube una foto de producto al bucket público menu-photos.
 *  Devuelve la URL pública definitiva (no requiere firma). */
export async function uploadMenuPhoto(
  accountId: string,
  menuItemId: string,
  file: File,
): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible') // guard null (supabase es nullable)
  const blob = await compressImage(file)
  const ts = Date.now()
  const path = `${accountId}/${menuItemId}-${ts}.jpg`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    })

  if (error) throw new Error(`Error subiendo foto: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Borra una foto del bucket por su URL pública */
export async function deleteMenuPhoto(publicUrl: string): Promise<void> {
  if (!supabase) return // guard null (supabase es nullable)
  // Extraer el path del URL público: .../object/public/menu-photos/ACCOUNT/FILE.jpg
  const marker = `/object/public/${BUCKET}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return

  const path = publicUrl.slice(idx + marker.length)
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.error('Error borrando foto de menú:', error.message)
}
