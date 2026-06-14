// src/modules/multitenancy/services/accountLogoService.ts
//
// Logo de la empresa por cuenta (autoservicio). El cliente sube su logo desde
// los ajustes de su cuenta; vive en el bucket público `account-logos` y su URL
// se persiste en `accounts.logo_url`. Lo consume el PDF de pedido (cabecera) y
// cualquier pantalla que muestre la marca del cliente.
//
// Patrón calcado de menuPhotoService (compresión en cliente + bucket público),
// con dos diferencias conscientes:
//  1) RASTERIZA A PNG (no JPEG) → conserva transparencia, imprescindible para
//     un logo sobre fondo claro en el PDF.
//  2) Persiste la URL en accounts.logo_url y borra el logo anterior al cambiarlo
//     (no deja huérfanos en el bucket).
//
// RLS del bucket (calcada de menu-photos): SELECT belongs_to_account;
// INSERT/UPDATE/DELETE current_user_is_admin_or_manager_of(accountId). El path
// empieza por {accountId}/ para que la política resuelva la cuenta.

import { supabase } from '@/lib/supabase'

const BUCKET = 'account-logos'
const MAX_PX = 512 // un logo no necesita más para UI + PDF; mantiene el peso mínimo

/** Rasteriza cualquier imagen a PNG (≤ MAX_PX en su lado mayor), conservando
 *  transparencia y proporción. Devuelve un Blob PNG. */
function rasterizeToPng(file: File, maxPx = MAX_PX): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width || maxPx
      let h = img.height || maxPx
      const longest = Math.max(w, h)
      if (longest > maxPx) {
        const k = maxPx / longest
        w = Math.round(w * k)
        h = Math.round(h * k)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No se pudo procesar la imagen (canvas).')); return }
      ctx.clearRect(0, 0, w, h) // fondo transparente
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo convertir el logo a PNG.'))),
        'image/png',
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen.')) }
    img.src = url
  })
}

function pathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/object/public/${BUCKET}/`
  const idx = publicUrl.indexOf(marker)
  return idx === -1 ? null : publicUrl.slice(idx + marker.length)
}

/** Lee la URL del logo actual de la cuenta (o null). */
export async function getAccountLogoUrl(accountId: string): Promise<string | null> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await (supabase as any)
    .from('accounts').select('logo_url').eq('id', accountId).single()
  if (error) throw new Error(`No se pudo leer el logo: ${error.message}`)
  return (data?.logo_url as string | null) ?? null
}

/** Sube un nuevo logo para la cuenta: rasteriza a PNG, sube al bucket, persiste
 *  la URL en accounts.logo_url y borra el logo anterior. Devuelve la URL pública. */
export async function uploadAccountLogo(accountId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')

  // 0) logo anterior (para borrarlo después si todo va bien).
  let previousUrl: string | null = null
  try { previousUrl = await getAccountLogoUrl(accountId) } catch { /* sigue */ }

  // 1) rasterizar y subir.
  const blob = await rasterizeToPng(file)
  const ts = Date.now()
  const path = `${accountId}/logo-${ts}.png`
  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false })
  if (upErr) throw new Error(`Error subiendo el logo: ${upErr.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = pub.publicUrl

  // 2) persistir en accounts.logo_url.
  const { error: updErr } = await (supabase as any)
    .from('accounts').update({ logo_url: publicUrl }).eq('id', accountId)
  if (updErr) {
    // revertir la subida para no dejar basura
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(`No se pudo guardar el logo en la cuenta: ${updErr.message}`)
  }

  // 3) borrar el anterior (best-effort, no bloquea).
  if (previousUrl) {
    const prevPath = pathFromPublicUrl(previousUrl)
    if (prevPath && prevPath !== path) {
      await supabase.storage.from(BUCKET).remove([prevPath]).catch(() => {})
    }
  }

  return publicUrl
}

/** Quita el logo de la cuenta: borra el fichero y limpia accounts.logo_url. */
export async function deleteAccountLogo(accountId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  let current: string | null = null
  try { current = await getAccountLogoUrl(accountId) } catch { /* sigue */ }

  const { error: updErr } = await (supabase as any)
    .from('accounts').update({ logo_url: null }).eq('id', accountId)
  if (updErr) throw new Error(`No se pudo quitar el logo: ${updErr.message}`)

  if (current) {
    const p = pathFromPublicUrl(current)
    if (p) await supabase.storage.from(BUCKET).remove([p]).catch(() => {})
  }
}
