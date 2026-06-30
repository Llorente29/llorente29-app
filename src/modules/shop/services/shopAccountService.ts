// src/modules/shop/services/shopAccountService.ts
//
// Identidad del HUB (cuenta) en la Folvy Shop: el LOGO de la cuenta que se ve
// en la cabecera del hub multimarca. Vive en accounts.shop_logo_url y el fichero
// en el bucket público `brand-logos` (mismo que logos/heros de marca; su RLS por
// cuenta ya vale) bajo {accountId}/hub-logo-*.
//
// A diferencia del hero (foto JPEG a sangre), el logo es IDENTIDAD: se sube tal
// cual (se preserva PNG/transparencia), sin rasterizar a JPEG.

import { supabase } from '@/lib/supabase'

const BUCKET = 'brand-logos'

function extFromFile(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/svg+xml') return 'svg'
  return 'png'
}

function pathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/object/public/${BUCKET}/`
  const idx = publicUrl.indexOf(marker)
  return idx === -1 ? null : publicUrl.slice(idx + marker.length)
}

/** Logo de cuenta actual (o null). */
export async function getAccountLogo(accountId: string): Promise<string | null> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data, error } = await (supabase as any)
    .from('accounts').select('shop_logo_url').eq('id', accountId).single()
  if (error) throw new Error(`No se pudo leer el logo: ${error.message}`)
  return (data?.shop_logo_url as string | null) ?? null
}

/** Sube el logo del hub: lo guarda tal cual (preserva transparencia), persiste
 *  accounts.shop_logo_url y borra el anterior. Devuelve la URL pública. */
export async function uploadAccountLogo(accountId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')

  let previousUrl: string | null = null
  try { previousUrl = await getAccountLogo(accountId) } catch { /* sigue */ }

  const path = `${accountId}/hub-logo-${Date.now()}.${extFromFile(file)}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(path, file, { contentType: file.type || 'image/png', upsert: false })
  if (upErr) throw new Error(`Error subiendo el logo: ${upErr.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = pub.publicUrl

  const { error: updErr } = await (supabase as any)
    .from('accounts').update({ shop_logo_url: publicUrl }).eq('id', accountId)
  if (updErr) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(`No se pudo guardar el logo: ${updErr.message}`)
  }

  if (previousUrl) {
    const prev = pathFromPublicUrl(previousUrl)
    if (prev && prev !== path) await supabase.storage.from(BUCKET).remove([prev]).catch(() => {})
  }
  return publicUrl
}

/** Quita el logo del hub: limpia accounts.shop_logo_url y borra el fichero. */
export async function deleteAccountLogo(accountId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  let current: string | null = null
  try { current = await getAccountLogo(accountId) } catch { /* sigue */ }

  const { error: updErr } = await (supabase as any)
    .from('accounts').update({ shop_logo_url: null }).eq('id', accountId)
  if (updErr) throw new Error(`No se pudo quitar el logo: ${updErr.message}`)

  if (current) {
    const p = pathFromPublicUrl(current)
    if (p) await supabase.storage.from(BUCKET).remove([p]).catch(() => {})
  }
}
