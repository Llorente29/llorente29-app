// src/modules/shop/services/shopHeroService.ts
//
// Foto de PORTADA (hero) del escaparate de una marca en la Folvy Shop.
// Distinta del logo: el logo es la identidad (PNG transparente, autotrim);
// la portada es una foto apetecible a sangre (JPEG, recorte "cover"). Vive en
// el MISMO bucket público `brand-logos` (su RLS por cuenta ya vale) bajo la
// ruta {accountId}/{brandId}/hero-*.jpg, y su URL se guarda en shop_theme.hero_url.
//
// Reusa el patrón de brandLogoService: proceso en cliente (redimensiona a un
// ancho razonable y comprime a JPEG), sube, persiste la URL y borra la anterior.

import { supabase } from '@/lib/supabase'

const BUCKET = 'brand-logos'
const MAX_W = 1280   // suficiente para una portada nítida sin pesar de más
const QUALITY = 0.82 // compresión JPEG

/** Redimensiona (ancho máx MAX_W, sin agrandar) y comprime a JPEG. */
function rasterizeToJpeg(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width || MAX_W
      let h = img.height || Math.round(MAX_W * 0.5)
      if (w > MAX_W) { const k = MAX_W / w; w = MAX_W; h = Math.round(h * k) }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No se pudo procesar la imagen (canvas).')); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo convertir la portada a JPEG.'))),
        'image/jpeg', QUALITY,
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

/** Sube una portada para la marca: comprime, sube, guarda hero_url en el theme
 *  (por id de fila shop_theme) y borra la anterior. Devuelve la URL pública. */
export async function uploadShopHero(
  accountId: string, brandId: string, themeId: string, file: File,
): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')

  let previousUrl: string | null = null
  try {
    const { data } = await (supabase as any).from('shop_theme').select('hero_url').eq('id', themeId).single()
    previousUrl = (data?.hero_url as string | null) ?? null
  } catch { /* sigue */ }

  const blob = await rasterizeToJpeg(file)
  const path = `${accountId}/${brandId}/hero-${Date.now()}.jpg`
  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(`Error subiendo la portada: ${upErr.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = pub.publicUrl

  const { error: updErr } = await (supabase as any)
    .from('shop_theme').update({ hero_url: publicUrl }).eq('id', themeId)
  if (updErr) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(`No se pudo guardar la portada: ${updErr.message}`)
  }

  if (previousUrl) {
    const prev = pathFromPublicUrl(previousUrl)
    if (prev && prev !== path) await supabase.storage.from(BUCKET).remove([prev]).catch(() => {})
  }
  return publicUrl
}

/** Quita la portada: limpia hero_url y borra el fichero. */
export async function deleteShopHero(themeId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')
  let current: string | null = null
  try {
    const { data } = await (supabase as any).from('shop_theme').select('hero_url').eq('id', themeId).single()
    current = (data?.hero_url as string | null) ?? null
  } catch { /* sigue */ }

  const { error: updErr } = await (supabase as any)
    .from('shop_theme').update({ hero_url: null }).eq('id', themeId)
  if (updErr) throw new Error(`No se pudo quitar la portada: ${updErr.message}`)

  if (current) {
    const p = pathFromPublicUrl(current)
    if (p) await supabase.storage.from(BUCKET).remove([p]).catch(() => {})
  }
}
