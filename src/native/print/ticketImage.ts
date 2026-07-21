// src/native/print/ticketImage.ts
// ---------------------------------------------------------------------------
// FUENTE ÚNICA de render de tickets por IMAGEN (canvas → ráster ESC/POS) para
// la app nativa. PORTADO 1:1 del renderer APROBADO del agente Node
// (C:\folvy-print-agent\ticketImage.js, validado 24/06 · ref "MILANESA HOUSE"):
// mismo layout, mismas fuentes (DejaVuSans), mismo canvasToEscpos. El WebView de
// Capacitor tiene <canvas>, así que rasteriza en el dispositivo — idéntico papel.
//
// NO se rediseña la BOLSA: es el aprobado tal cual. La COCINA (que nunca tuvo
// versión imagen) se construye aquí con el MISMO motor y un layout limpio.
//
// Regla estructural: el worker nativo YA NO tiene un render de TEXTO propio para
// bag/kitchen; usa este módulo. (El agente Node conserva su copia gemela como
// referencia; convergencia a un módulo compartido = deuda futura declarada.)
// ---------------------------------------------------------------------------

import QRCode from 'qrcode'
import dejaVuRegularUrl from './assets/DejaVuSans.ttf?url'
import dejaVuBoldUrl from './assets/DejaVuSans-Bold.ttf?url'
import folvyPieUrl from './assets/folvy_pie.png'

const W = 576            // 80mm @ 203dpi
const PAD = 28
const INK = '#000000'
const MUT = '#444444'

function fnt(size: number, bold?: boolean) { return `${size}px ${bold ? 'FolvyBold' : 'Folvy'}` }
function money(n: any) {
  if (n == null) return ''
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
function fmtDate(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function pickupCode(order: any) {
  const short = (order.pos_short_code ?? '').trim()
  if (short) return short.toUpperCase()
  const real = (order.platform_order_code ?? '').trim()
  if (real) return real
  const tab = order.external_tab_ref ?? order.external_ref ?? ''
  return tab ? '#' + tab.replace(/-/g, '').slice(-5).toUpperCase() : '—'
}
function platformRef(order: any) {
  const real = (order.platform_order_code ?? '').trim()
  if (!real) return null
  const ch = (order.channel ?? '').trim()
  return ch ? `${ch} · ${real}` : real
}
function deliveryLabel(st: any) {
  const t = (st ?? '').toLowerCase()
  if (t.includes('pickup') || t.includes('collection') || t.includes('takeaway')) return 'Recogida'
  if (t.includes('own')) return 'Reparto propio'
  if (t.includes('platform')) return 'Reparto plataforma'
  return st ? st : 'Reparto'
}
function isOwnDelivery(st: any) { return (st ?? '').toLowerCase().includes('own') }
const LOOKS_REMOVE = /^\s*(sin|no|quitar|without|sans)\b/i
function modifierLines(children: any) {
  return (children || []).map((c: any) => {
    const isCombo = c.line_type === 'combo_item'
    if (isCombo) return { text: c.name, tone: 'neutral' as const }
    const remove = LOOKS_REMOVE.test(c.name || '') || c.group_type === 'removal'
    const clean = (c.name || '').replace(/^\s*(sin|no|quitar|without|sans)\s+/i, '')
    return { text: remove ? ('Sin ' + clean) : ('+ ' + c.name), tone: (remove ? 'remove' : 'add') as 'remove' | 'add' }
  })
}

// ── Canvas / fuentes / imágenes (WebView) ────────────────────────────────────

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

let fontsReady: Promise<void> | null = null
/** Carga DejaVuSans/Bold como 'Folvy'/'FolvyBold' (una vez). Si falla, cae a
 *  fuente del sistema — el ticket sale igual, solo cambia la tipografía. */
export function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady
  fontsReady = (async () => {
    try {
      const anyDoc = document as unknown as { fonts?: { add: (f: FontFace) => void } }
      if (!anyDoc.fonts || typeof FontFace === 'undefined') return
      const reg = new FontFace('Folvy', `url(${dejaVuRegularUrl})`)
      const bold = new FontFace('FolvyBold', `url(${dejaVuBoldUrl})`)
      await Promise.all([reg.load(), bold.load()])
      anyDoc.fonts.add(reg); anyDoc.fonts.add(bold)
    } catch { /* fuente del sistema */ }
  })()
  return fontsReady
}

function loadImageSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('img load'))
    img.src = src
  })
}

/** Carga una imagen remota (logo de marca) SIN contaminar el canvas: fetch →
 *  blob → objectURL (mismo origen). Devuelve null si falla (→ cae a texto). */
async function loadRemoteImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return null
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    const obj = URL.createObjectURL(blob)
    try { return await loadImageSrc(obj) } finally { URL.revokeObjectURL(obj) }
  } catch { return null }
}

async function qrImage(data: string): Promise<HTMLImageElement | null> {
  try {
    const url = data.startsWith('http') ? data : 'https://' + data
    const dataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 })
    return await loadImageSrc(dataUrl)
  } catch { return null }
}

let folvyPie: Promise<HTMLImageElement | null> | null = null
function loadFolvyPie(): Promise<HTMLImageElement | null> {
  if (!folvyPie) folvyPie = loadImageSrc(folvyPieUrl).catch(() => null)
  return folvyPie
}

// Autocrop del margen claro de un logo → {sx,sy,sw,sh} (no deformar).
function autocropBox(img: CanvasImageSource & { width: number; height: number }) {
  const tmp = newCanvas(img.width, img.height)
  const tctx = tmp.getContext('2d')!
  tctx.drawImage(img, 0, 0)
  const data = tctx.getImageData(0, 0, img.width, img.height).data
  let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0, found = false
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a > 30 && (r < 200 || g < 200 || b < 200)) { found = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  if (!found) return { sx: 0, sy: 0, sw: img.width, sh: img.height }
  const pad = 2
  return { sx: Math.max(0, x0 - pad), sy: Math.max(0, y0 - pad), sw: Math.min(img.width, x1 + pad) - Math.max(0, x0 - pad), sh: Math.min(img.height, y1 + pad) - Math.max(0, y0 - pad) }
}

// ── BOLSA (porte 1:1 del aprobado) ───────────────────────────────────────────

/** Bolsa/factura como IMAGEN — idéntica al ticket aprobado (Milanesa House).
 *  Enriquece con logo de marca, pie Folvy y dirección desglosada, como el agente. */
export async function renderBagImage(order: any, fiscal?: any): Promise<HTMLCanvasElement> {
  await ensureFonts()
  const logoImg = await loadRemoteImage(order.brand_logo_url)
  const folvyImg = await loadFolvyPie()
  const dd = order.delivery_detail || {}
  const addr = {
    address: dd.address || order.delivery_address || null,
    details: dd.details || null,
    postalCode: dd.postalCode || dd.post_code || null,
  }

  const H = 4000
  const canvas = newCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = INK; ctx.textBaseline = 'top'
  let y = PAD

  const text = (t: string, font: string, opts: { align?: string; fill?: string; x?: number } = {}) => {
    const { align = 'left', fill = INK, x = PAD } = opts
    ctx.font = font; ctx.fillStyle = fill
    let xx = x
    if (align === 'center') { ctx.textAlign = 'center'; xx = W / 2 }
    else if (align === 'right') { ctx.textAlign = 'right'; xx = W - PAD }
    else ctx.textAlign = 'left'
    ctx.fillText(t || '', xx, y)
    ctx.textAlign = 'left'
  }
  const lineH = (size: number) => size + 8
  const center = (t: string, size: number, bold?: boolean, extra = 0, fill = INK) => { text(t, fnt(size, bold), { align: 'center', fill }); y += lineH(size) + extra }
  const left = (t: string, size: number, bold?: boolean, fill = INK, x = PAD) => { text(t, fnt(size, bold), { fill, x }); y += lineH(size) }
  const lr = (l: string, r: string, size: number, boldR = false, fill = INK) => {
    text(l, fnt(size, false), { fill })
    text(r, fnt(size, boldR), { align: 'right', fill })
    y += lineH(size)
  }
  const rule = (dashed = false) => {
    y += 6; ctx.strokeStyle = INK; ctx.lineWidth = 2
    ctx.setLineDash(dashed ? [6, 6] : [])
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); ctx.setLineDash([])
    y += 16
  }
  const band = (t: string, size: number) => {
    const h = size + 20
    ctx.fillStyle = INK; ctx.fillRect(PAD - 6, y - 2, (W - PAD + 6) - (PAD - 6), h + 2)
    ctx.fillStyle = '#ffffff'; ctx.font = fnt(size, true); ctx.textAlign = 'center'
    ctx.fillText(t, W / 2, y + 8); ctx.textAlign = 'left'; ctx.fillStyle = INK
    y += h + 14
  }
  const field = (label: string, val: string, size = 22) => {
    ctx.font = fnt(size, true); const lw = ctx.measureText(label + ' ').width
    ctx.font = fnt(size, false)
    if (lw + ctx.measureText(val).width <= W - 2 * PAD) {
      text(label, fnt(size, true)); text(' ' + val, fnt(size, false), { x: PAD + lw })
      y += lineH(size)
    } else {
      left(label, size, true)
      const words = (val || '').split(' '); let line = ''
      ctx.font = fnt(size, false)
      for (const wd of words) {
        const t = (line + ' ' + wd).trim()
        if (ctx.measureText(t).width <= W - 2 * PAD - 24) line = t
        else { left(line, size, false, INK, PAD + 24); line = wd }
      }
      if (line) left(line, size, false, INK, PAD + 24)
    }
  }

  // LOGO (protagonista, sin deformar)
  let logoDrawn = false
  if (logoImg) {
    try {
      const box = autocropBox(logoImg as HTMLImageElement)
      const maxW = Math.round(W * 0.80)
      const maxH = 190
      let dw = maxW, dh = Math.round(box.sh * dw / box.sw)
      if (dh > maxH) { dh = maxH; dw = Math.round(box.sw * dh / box.sh) }
      const dx = Math.round((W - dw) / 2)
      ctx.drawImage(logoImg, box.sx, box.sy, box.sw, box.sh, dx, y, dw, dh)
      y += dh + 18; logoDrawn = true
    } catch { /* cae a texto */ }
  }
  if (!logoDrawn) center(order.brand || 'Folvy', 46, true, 8)

  // Fiscal
  if (fiscal?.legalName) center(fiscal.legalName, 24, true)
  if (fiscal?.taxId) center(fiscal.taxId, 22, false)
  if (fiscal?.address) center(fiscal.address, 22, false)
  y += 8
  center(fmtDate(order.entro_at), 22, false, 4)
  lr('Factura Simplificada', fiscal?.ticketNumber ?? (order.external_tab_ref ?? '—'), 24)
  y += 10

  // Código (banda)
  band(pickupCode(order), 46)

  // Datos del pedido
  const ch = (order.channel ?? '').trim()
  const realCode = (order.platform_order_code ?? '').trim()
  if (ch && realCode) field('Código ' + ch + ':', realCode)
  field('Método:', deliveryLabel(order.service_type))
  if (order.expected_time) field('Hora programada:', fmtDate(order.expected_time))
  else field('Hora programada:', 'Lo antes posible')
  if (order.customer_name) field('Nombre del cliente:', order.customer_name)
  if (isOwnDelivery(order.service_type)) {
    if (addr.address) field('Dirección:', addr.address)
    if (addr.details) field('Detalles de dirección:', addr.details)
    if (addr.postalCode) field('Código postal:', addr.postalCode)
    if (order.customer_phone) field('Número de teléfono:', order.customer_phone)
  }
  y += 12

  // Productos
  band('Productos', 28)
  for (const line of order.lineas || []) {
    const label = `${line.qty}x  ${line.name}`
    if (line.original_unit_price != null) {
      text(label, fnt(23, false))
      const orig = money(line.original_unit_price * line.qty)
      ctx.font = fnt(23, false); const ow = ctx.measureText(orig).width
      text(orig, fnt(23, false), { align: 'right', fill: '#888888' })
      ctx.strokeStyle = '#888888'; ctx.lineWidth = 2; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(W - PAD - ow, y + 13); ctx.lineTo(W - PAD, y + 13); ctx.stroke()
      y += lineH(23)
      lr('   ' + (line.discount_label || 'Descuento'), money(line.line_total), 22, true)
    } else {
      lr(label, money(line.line_total), 23)
    }
    for (const m of modifierLines(line.children)) left('      ' + m.text, 21, false, MUT)
  }
  y += 14; rule()
  if (order.delivery_cost) lr('Gastos de envío:', money(order.delivery_cost), 23)
  if (order.discount_amount) lr('Descuento:', '-' + money(order.discount_amount), 23)
  y += 10; rule()

  // IVA (10% hostelería)
  const total = Number(order.total ?? 0)
  const base = total / 1.10, iva = total - base
  const colR = (t: string, xr: number, font: string, fill = INK) => { ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = 'right'; ctx.fillText(t, xr, y); ctx.textAlign = 'left' }
  const xSub = 300, xIva = 410, xTot = W - PAD
  colR('Subtotal', xSub, fnt(19, false)); colR('IVA', xIva, fnt(19, false)); colR('Total', xTot, fnt(19, false))
  y += 19 + 6
  text('IVA (10%)', fnt(22, false))
  colR(money(base), xSub, fnt(22, false)); colR(money(iva), xIva, fnt(22, false)); colR(money(total), xTot, fnt(22, true))
  y += 22 + 24

  // Total
  lr('Total:', money(total), 40, true)
  y += 12
  left('Pagos', 22, true)
  lr((order.payment_method || ch || 'Pago') + ':', money(total), 22)
  y += 24

  // QR de la marca
  if (order.brand_shop_url) {
    rule()
    const qrImg = await qrImage(order.brand_shop_url)
    if (qrImg) {
      const qs = 180; ctx.drawImage(qrImg, (W - qs) / 2, y, qs, qs); y += qs + 6
      if (order.brand_qr_caption) center(order.brand_qr_caption, 22, true)
      y += 14
    }
  }

  // Pie Folvy
  rule()
  if (folvyImg) {
    const fw = 190, fh = Math.round(folvyImg.height * fw / folvyImg.width)
    ctx.drawImage(folvyImg, (W - fw) / 2, y, fw, fh); y += fh + 4
  }
  center('Hecho con Folvy  ·  folvy.app', 19, false)
  y += 24

  // Recortar a la altura usada.
  const out = newCanvas(W, y)
  out.getContext('2d')!.drawImage(canvas, 0, 0)
  return out
}

// ── COCINA (nueva, mismo motor imagen; layout limpio) ────────────────────────

/** Ticket de cocina como IMAGEN, legible: código grande, sin cabecera "Otros"
 *  cuando el plato no tiene familia, nombre a tamaño legible (no gigante),
 *  combo desglosado, alérgenos y nota del cliente resaltados. */
export async function renderKitchenImage(order: any): Promise<HTMLCanvasElement> {
  await ensureFonts()
  const H = 4000
  const canvas = newCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = INK; ctx.textBaseline = 'top'
  let y = PAD + 30   // más aire arriba (antes del código)

  const centerT = (t: string, size: number, bold?: boolean, fill = INK) => {
    ctx.font = fnt(size, bold); ctx.fillStyle = fill; ctx.textAlign = 'center'
    ctx.fillText(t || '', W / 2, y); ctx.textAlign = 'left'; y += size + 8
  }
  const rule = () => { y += 6; ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); y += 16 }
  // Separador fino entre platos (que no se amontonen).
  const thinRule = () => { y += 6; ctx.strokeStyle = '#bbbbbb'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); y += 14 }
  const band = (t: string, size: number) => {
    const h = size + 18
    ctx.fillStyle = INK; ctx.fillRect(PAD - 6, y - 2, (W - PAD + 6) - (PAD - 6), h + 2)
    ctx.fillStyle = '#ffffff'; ctx.font = fnt(size, true); ctx.textAlign = 'center'
    ctx.fillText(t, W / 2, y + 6); ctx.textAlign = 'left'; ctx.fillStyle = INK
    y += h + 12
  }
  // Texto con ajuste de línea (nombre de plato legible, sin partir en trozos).
  const wrapLeft = (t: string, size: number, bold: boolean, x = PAD, fill = INK) => {
    ctx.font = fnt(size, bold); ctx.fillStyle = fill; ctx.textAlign = 'left'
    const maxW = W - PAD - x
    const words = (t || '').split(' '); let line = ''
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd
      if (ctx.measureText(test).width <= maxW) line = test
      else { if (line) { ctx.fillText(line, x, y); y += size + 6 } line = wd }
    }
    if (line) { ctx.fillText(line, x, y); y += size + 6 }
  }
  // Nota del cliente destacada en caja.
  const noteBox = (t: string) => {
    ctx.font = fnt(24, true); ctx.textAlign = 'left'
    const maxW = W - 2 * PAD - 20
    const words = ('> ' + t).split(' '); const lines: string[] = []; let line = ''
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd
      if (ctx.measureText(test).width <= maxW) line = test
      else { if (line) lines.push(line); line = wd }
    }
    if (line) lines.push(line)
    const boxH = lines.length * 30 + 16
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(PAD, y, W - 2 * PAD, boxH)
    let yy = y + 8
    for (const l of lines) { ctx.fillStyle = INK; ctx.font = fnt(24, true); ctx.fillText(l, PAD + 10, yy); yy += 30 }
    y += boxH + 10
  }
  // Plato PROTAGONISTA: cantidad en CAJA NEGRA + nombre grande al lado.
  const dishWithQty = (qty: any, name: string) => {
    const qtyText = `${qty}×`
    const qFont = fnt(30, true)
    ctx.font = qFont
    const qtW = ctx.measureText(qtyText).width
    const boxW = Math.round(qtW + 26)
    const boxH = 48
    const boxY = y
    const r = 8
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.moveTo(PAD + r, boxY)
    ctx.arcTo(PAD + boxW, boxY, PAD + boxW, boxY + boxH, r)
    ctx.arcTo(PAD + boxW, boxY + boxH, PAD, boxY + boxH, r)
    ctx.arcTo(PAD, boxY + boxH, PAD, boxY, r)
    ctx.arcTo(PAD, boxY, PAD + boxW, boxY, r)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#ffffff'; ctx.font = qFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(qtyText, PAD + boxW / 2, boxY + boxH / 2 + 1)
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = INK
    // Nombre grande a la derecha; envuelve alineado bajo sí mismo.
    const nameX = PAD + boxW + 16
    wrapLeft(name, 42, true, nameX)
    if (y < boxY + boxH + 4) y = boxY + boxH + 4
  }
  // Quita un código de marca al final del nombre (p.ej. " (BB)"): 2-4 mayúsculas.
  const cleanName = (n: string) => (n || '').replace(/\s*\([A-ZÑ]{2,4}\)\s*$/, '').trim()

  // Cabecera (reducida a su papel; el código de recogida sigue grande).
  band(pickupCode(order), 46)
  centerT((order.brand ?? '').toUpperCase(), 26, true)
  const kref = platformRef(order)
  if (kref) centerT(kref, 20, false, MUT)
  centerT(fmtDate(order.entro_at), 20, false, MUT)
  y += 4
  centerT(deliveryLabel(order.service_type), 24, true)
  if (order.customer_name) centerT((order.customer_name || '').split(' ')[0], 24, true)
  if (order.expected_time) centerT('Recogida ' + fmtDate(order.expected_time), 22, false, MUT)
  rule()

  // Agrupar por familia; los platos SIN familia van al final SIN cabecera "Otros".
  const groups = new Map<string, any[]>()
  const nofam: any[] = []
  for (const line of order.lineas || []) {
    if (line.family) {
      if (!groups.has(line.family)) groups.set(line.family, [])
      groups.get(line.family)!.push(line)
    } else {
      nofam.push(line)
    }
  }
  let firstLine = true
  const drawLine = (line: any) => {
    if (!firstLine) thinRule()
    firstLine = false
    dishWithQty(line.qty, cleanName(line.name))
    for (const m of modifierLines(line.children)) {
      const rem = m.tone === 'remove'
      wrapLeft(m.text, rem ? 26 : 24, rem, PAD + 20, rem ? INK : MUT)
    }
    const al = (line.allergens || [])
    if (al.length) wrapLeft('! ' + al.join(' · '), 24, true, PAD + 20)
    if (line.customer_note) noteBox(line.customer_note)
    y += 14
  }
  const famKeys = [...groups.keys()].sort((a, z) => a.localeCompare(z, 'es'))
  for (const key of famKeys) {
    band(key, 26)
    firstLine = true
    for (const line of groups.get(key)!) drawLine(line)
  }
  // Sin familia: sin cabecera, directo.
  if (famKeys.length && nofam.length) firstLine = true
  for (const line of nofam) drawLine(line)

  const out = newCanvas(W, y + 48)   // más aire abajo (antes del corte)
  out.getContext('2d')!.drawImage(canvas, 0, 0)
  return out
}

// ── Canvas → ESC/POS ráster (porte 1:1 del canvasToEscpos aprobado) ──────────

/** Rasteriza un canvas a bytes ESC/POS (GS v 0 en tiras de 128 filas, umbral de
 *  luminancia <160). Añade avance + corte al final. Idéntico al agente. */
export function canvasToEscpos(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  const data = ctx.getImageData(0, 0, w, h).data
  const widthBytes = Math.ceil(w / 8)
  const out: number[] = [0x1b, 0x40]
  const STRIP = 128
  for (let y0 = 0; y0 < h; y0 += STRIP) {
    const hh = Math.min(STRIP, h - y0)
    const packed = new Uint8Array(widthBytes * hh)
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * w + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        if (a > 30 && lum < 160) packed[y * widthBytes + (x >> 3)] |= (0x80 >> (x & 7))
      }
    }
    out.push(0x1d, 0x76, 0x30, 0, widthBytes & 0xff, (widthBytes >> 8) & 0xff, hh & 0xff, (hh >> 8) & 0xff)
    for (const byte of packed) out.push(byte)
  }
  out.push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 1)
  return Uint8Array.from(out)
}
