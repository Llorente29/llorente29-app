// src/modules/multitenancy/services/accountLogoService.ts
//
// Logo de la empresa por cuenta (autoservicio). El cliente sube su logo desde
// los ajustes de su cuenta; vive en el bucket público `account-logos` y su URL
// se persiste en `accounts.logo_url`. Lo consume el PDF de pedido (cabecera) y
// cualquier pantalla que muestre la marca del cliente.
//
// Patrón calcado de menuPhotoService (proceso en cliente + bucket público),
// con tres diferencias conscientes:
//  1) RASTERIZA A PNG (no JPEG) → conserva transparencia.
//  2) AUTOTRIM: si el logo trae un fondo plano (blanco/color uniforme), lo vuelve
//     transparente y recorta el aire sobrante, para que "flote" en el PDF sin
//     marco. Conservador: solo actúa si las 4 esquinas coinciden; nunca toca
//     logos con foto/degradado de fondo (no adivina).
//  3) Persiste la URL en accounts.logo_url y borra el logo anterior al cambiarlo.
//
// RLS del bucket (calcada de menu-photos): SELECT belongs_to_account;
// INSERT/UPDATE/DELETE current_user_is_admin_or_manager_of(accountId). El path
// empieza por {accountId}/ para que la política resuelva la cuenta.

import { supabase } from '@/lib/supabase'

const BUCKET = 'account-logos'
const MAX_PX = 512 // un logo no necesita más para UI + PDF; mantiene el peso mínimo

// ── Autotrim de fondo plano ─────────────────────────────────────────────
const BG_TOLERANCE = 22  // tolerancia de color (0-255) para "mismo fondo"
const TRIM_PADDING = 2   // margen al recortar (px) para no comer el borde del logo

type RGBA = [number, number, number, number]

function sampleCorner(d: Uint8ClampedArray, w: number, x: number, y: number): RGBA {
  const i = (y * w + x) * 4
  return [d[i], d[i + 1], d[i + 2], d[i + 3]]
}
function closeColor(a: RGBA, b: RGBA, tol: number): boolean {
  if (a[3] < 16) return true // ya transparente = fondo
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

/** Si las 4 esquinas coinciden (fondo plano), vuelve transparente ese fondo por
 *  inundación desde los bordes. Devuelve true si actuó; false si no hay fondo
 *  plano claro (foto/degradado) o ya era transparente. */
function removeFlatBackground(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const corners: RGBA[] = [
    sampleCorner(d, w, 0, 0),
    sampleCorner(d, w, w - 1, 0),
    sampleCorner(d, w, 0, h - 1),
    sampleCorner(d, w, w - 1, h - 1),
  ]
  if (corners.every(c => c[3] < 16)) return false // ya transparente
  const ref = corners[0]
  if (!corners.every(c => closeColor(c, ref, BG_TOLERANCE))) return false // foto/degradado → no tocar

  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + (w - 1)) }

  while (stack.length) {
    const p = stack.pop()!
    if (visited[p]) continue
    visited[p] = 1
    const x = p % w, y = (p / w) | 0
    const i = p * 4
    const px: RGBA = [d[i], d[i + 1], d[i + 2], d[i + 3]]
    if (!closeColor(px, ref, BG_TOLERANCE)) continue
    d[i + 3] = 0
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }
  ctx.putImageData(img, 0, 0)
  return true
}

/** Recorta el lienzo a la caja real del contenido (no transparente) + padding. */
function trimTransparent(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d')
  if (!ctx) return src
  const { width: w, height: h } = src
  const d = ctx.getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return src
  minX = Math.max(0, minX - TRIM_PADDING)
  minY = Math.max(0, minY - TRIM_PADDING)
  maxX = Math.min(w - 1, maxX + TRIM_PADDING)
  maxY = Math.min(h - 1, maxY + TRIM_PADDING)
  const nw = maxX - minX + 1, nh = maxY - minY + 1
  if (nw === w && nh === h) return src
  const out = document.createElement('canvas')
  out.width = nw; out.height = nh
  out.getContext('2d')!.drawImage(src, minX, minY, nw, nh, 0, 0, nw, nh)
  return out
}

/** Rasteriza a PNG (≤ MAX_PX lado mayor) con autotrim de fondo plano. */
function rasterizeToPng(file: File, maxPx = MAX_PX): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width || maxPx
      let h = img.height || maxPx
      const longest = Math.max(w, h)
      if (longest > maxPx) { const k = maxPx / longest; w = Math.round(w * k); h = Math.round(h * k) }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No se pudo procesar la imagen (canvas).')); return }
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)

      let finalCanvas: HTMLCanvasElement = canvas
      try {
        if (removeFlatBackground(ctx, w, h)) finalCanvas = trimTransparent(canvas)
      } catch { /* sin autotrim, no rompe */ }

      finalCanvas.toBlob(
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

/** Sube un nuevo logo: rasteriza + autotrim, sube al bucket, persiste la URL en
 *  accounts.logo_url y borra el anterior. Devuelve la URL pública. */
export async function uploadAccountLogo(accountId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')

  let previousUrl: string | null = null
  try { previousUrl = await getAccountLogoUrl(accountId) } catch { /* sigue */ }

  const blob = await rasterizeToPng(file)
  const ts = Date.now()
  const path = `${accountId}/logo-${ts}.png`
  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false })
  if (upErr) throw new Error(`Error subiendo el logo: ${upErr.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = pub.publicUrl

  const { error: updErr } = await (supabase as any)
    .from('accounts').update({ logo_url: publicUrl }).eq('id', accountId)
  if (updErr) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(`No se pudo guardar el logo en la cuenta: ${updErr.message}`)
  }

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
