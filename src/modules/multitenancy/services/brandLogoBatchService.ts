// src/modules/multitenancy/services/brandLogoBatchService.ts
//
// LOTE de limpieza de logos de marca ya subidos. Los logos que metió el
// importador de Last no pasaron por el autotrim (recorte de fondo/borde plano)
// que sí aplica el uploader manual. Este servicio recorre las marcas con
// logo_url, descarga cada imagen, le aplica EXACTAMENTE el mismo autotrim que
// brandLogoService (fondo plano -> transparente + recorte del aire sobrante) y
// la vuelve a subir por uploadBrandLogo. Cero lógica de recorte nueva.
//
// Corre en el NAVEGADOR (usa canvas/Image), igual que el uploader. Conservador:
// si un logo no tiene fondo plano uniforme (color que es parte del dibujo,
// foto, degradado), NO lo toca y lo cuenta como "sin cambios".
//
// Uso: botón "Limpiar fondos de logos" en la lista de marcas. El usuario ve el
// progreso y un resumen (limpiados / sin cambios / errores).

import { supabase } from '@/lib/supabase'
import { uploadBrandLogo } from './brandLogoService'

const MAX_PX = 512
const BG_TOLERANCE = 22
const TRIM_PADDING = 2

type RGBA = [number, number, number, number]

function sampleCorner(d: Uint8ClampedArray, w: number, x: number, y: number): RGBA {
  const i = (y * w + x) * 4
  return [d[i], d[i + 1], d[i + 2], d[i + 3]]
}
function closeColor(a: RGBA, b: RGBA, tol: number): boolean {
  if (a[3] < 16) return true
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

/** Vuelve transparente el fondo plano por inundación desde los bordes.
 *  Devuelve true si actuó (había fondo plano); false si no (foto/degradado/ya transparente). */
function removeFlatBackground(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const corners: RGBA[] = [
    sampleCorner(d, w, 0, 0),
    sampleCorner(d, w, w - 1, 0),
    sampleCorner(d, w, 0, h - 1),
    sampleCorner(d, w, w - 1, h - 1),
  ]
  if (corners.every(c => c[3] < 16)) return false
  const ref = corners[0]
  if (!corners.every(c => closeColor(c, ref, BG_TOLERANCE))) return false

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

/** Descarga la imagen (crossOrigin para poder leer el canvas del bucket público). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la imagen del logo.'))
    // cache-bust por si el navegador la tiene cacheada sin CORS
    img.src = url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now()
  })
}

/** Procesa un logo: si tiene fondo plano lo recorta y devuelve un File PNG nuevo.
 *  Si no hay nada que recortar, devuelve null (no tocar). */
async function trimLogoToFile(url: string, brandId: string): Promise<File | null> {
  const img = await loadImage(url)
  let w = img.width || MAX_PX
  let h = img.height || MAX_PX
  const longest = Math.max(w, h)
  if (longest > MAX_PX) { const k = MAX_PX / longest; w = Math.round(w * k); h = Math.round(h * k) }

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen (canvas).')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  const acted = removeFlatBackground(ctx, w, h)
  if (!acted) return null // sin fondo plano -> no se toca

  const finalCanvas = trimTransparent(canvas)
  const blob: Blob = await new Promise((resolve, reject) =>
    finalCanvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo convertir a PNG.'))), 'image/png'),
  )
  return new File([blob], `logo-${brandId}.png`, { type: 'image/png' })
}

export interface BatchLogoResult {
  total: number
  cleaned: number
  unchanged: number
  errors: { brandId: string; name: string; message: string }[]
}

export interface BatchProgress {
  done: number
  total: number
  current: string
}

/** Recorre las marcas de la cuenta con logo_url y limpia el fondo plano de cada
 *  una. onProgress se llama por marca para pintar avance. */
export async function cleanBrandLogos(
  accountId: string,
  onProgress?: (p: BatchProgress) => void,
): Promise<BatchLogoResult> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await (supabase as any)
    .from('brand')
    .select('id, name, logo_url')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .not('logo_url', 'is', null)
    .order('name', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las marcas: ${error.message}`)

  const rows = (data ?? []) as { id: string; name: string; logo_url: string }[]
  const result: BatchLogoResult = { total: rows.length, cleaned: 0, unchanged: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const b = rows[i]
    onProgress?.({ done: i, total: rows.length, current: b.name })
    try {
      const file = await trimLogoToFile(b.logo_url, b.id)
      if (!file) { result.unchanged++; continue }
      // uploadBrandLogo vuelve a rasterizar+autotrim (idempotente) y reemplaza la URL
      await uploadBrandLogo(accountId, b.id, file)
      result.cleaned++
    } catch (e) {
      result.errors.push({ brandId: b.id, name: b.name, message: e instanceof Error ? e.message : 'Error' })
    }
  }
  onProgress?.({ done: rows.length, total: rows.length, current: '' })
  return result
}
