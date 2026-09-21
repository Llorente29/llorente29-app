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
//
// ── CÓDIGO DE PASE (26/07, recolocado el 21/09) ─────────────────────────────
// El número que el repartidor CANTA al llegar va en la banda negra, en el sitio
// y al tamaño del diseño aprobado. La regla de qué código es NO vive aquí:
// se importa de src/modules/orders/lib/passCode.ts, la MISMA que usan la tarjeta
// de /orders, la previsualización web y el renderer de texto. La causa raíz del
// bug que esto cierra fue justo tener dos reglas (aquí una, allí otra): a partir
// de ahora hay UNA. El segundo código baja a la línea fina, para incidencias.
//
// ── EL TICKET DE BOLSA VUELVE A SU DISEÑO DEL 24/06 (21/09) ─────────────────
// Julio: «ya tiene un diseño propio y que no se puede cambiar», «en algún
// momento ha sufrido alguna modificación no autorizada». La tenía: el 26/07
// (`7475943`, por el merge `327cbdc`) la banda del código se hizo enorme y se
// subió ENCIMA DEL LOGO, se quitó la banda que iba después de «Factura
// Simplificada», y se añadió un QR del pedido que nadie aprobó.
//
// Aquí se recupera el aprobado --que es `4225053`, el portado 1:1 del agente de
// Node-- con UNA diferencia deliberada y dos arreglos:
//   · el NÚMERO de la banda sale de `passCode`, no de `pos_short_code`. La
//     posición y el tamaño son los del aprobado; sólo cambia de dónde sale la
//     cifra, porque el campo crudo discrepa del que canta el repartidor en
//     2.692 de 3.124 pedidos (medido el 20/09).
//   · el nombre del artículo ENVUELVE POR PALABRAS y el precio tiene columna
//     fija: antes los dos se pintaban sin limitar el ancho y un nombre largo se
//     superponía al precio («…Pita Mixta Gyros31,80 €», Alcalá 20/09).
//   · el QR del pedido se retira. No estaba en el aprobado y estaba APAGADO en
//     los siete locales (`kitchen_time_config.bag_qr = false`), así que no
//     cambia ni un ticket de los que salen hoy.
// ---------------------------------------------------------------------------

import QRCode from 'qrcode'
import { numeroGrande, passCode, type PassCode, type PassCodeInput } from '@/modules/orders/lib/passCode'
import { allergenLabel, isAllergenCode } from '@/modules/kitchen/lib/allergens'
import { direccionParaMostrar } from '@/lib/direccionEntrega'
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
/** Sólo la hora, en Madrid. La base manda UTC (regla 4): aquí se convierte. */
function hhmmMadrid(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
}
/** CÓDIGO DE PASE — regla única compartida (passCode.ts). Nunca duplicar aquí. */
function pass(order: PassCodeInput): PassCode {
  return passCode(order)
}
/** El OTRO código, con etiqueta honesta: el de la plataforma lleva su nombre;
 *  el corto de Folvy no se disfraza de código del canal. null si no hay. */
function secondaryField(order: PassCodeInput, pc: PassCode): { label: string; value: string } | null {
  if (!pc.secondary) return null
  const ch = (order.channel ?? '').trim()
  // De la plataforma = su nº largo (Glovo, para reclamar) o su código corto.
  // Cuál de los dos es lo decide passCode.ts; aquí sólo se etiqueta.
  const isPlatform = pc.secondarySource !== 'short'
  return {
    label: (isPlatform && ch) ? `Código ${ch}:` : 'Código interno:',
    value: pc.secondary,
  }
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

/** Parte en líneas POR PALABRAS. No parte palabras nunca: si una sola no cabe,
 *  se devuelve igual y sobresale — preferible a cortarla por la mitad, que es
 *  exactamente el fallo que se ve en papel cuando envuelve la impresora.
 *  Vive aquí y la importa `labelImage`: una regla, un sitio. */
export function enLineas(ctx: CanvasRenderingContext2D, texto: string, anchoMax: number): string[] {
  const palabras = (texto || '').split(/\s+/).filter(Boolean)
  const out: string[] = []
  let linea = ''
  for (const p of palabras) {
    const prueba = linea ? linea + ' ' + p : p
    if (ctx.measureText(prueba).width <= anchoMax) linea = prueba
    else { if (linea) out.push(linea); linea = p }
  }
  if (linea) out.push(linea)
  return out.length ? out : ['']
}

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

/** QR de una URL (QR de marca): normaliza a https:// si viene sin esquema. */
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

// ── BOLSA (porte 1:1 del aprobado + código de pase arriba) ───────────────────

/** Bolsa/factura como IMAGEN — idéntica al ticket aprobado (Milanesa House).
 *  Enriquece con logo de marca, pie Folvy y dirección desglosada, como el agente.
 *  `opts.bagQr` (flag de BBDD) añade el QR con el sale_id. */
export async function renderBagImage(order: any, fiscal?: any): Promise<HTMLCanvasElement> {
  await ensureFonts()
  const logoImg = await loadRemoteImage(order.brand_logo_url)
  const folvyImg = await loadFolvyPie()
  const pc = pass(order)
  const dd = order.delivery_detail || {}
  // Etiquetas en castellano al imprimir la bolsa. `delivery_detail` y
  // `delivery_address` se leen tal cual y se traducen SOLO para pintarlas: la
  // fila de la venta no se toca.
  const addr = {
    address: direccionParaMostrar(dd.address || order.delivery_address || null),
    details: direccionParaMostrar(dd.details || null),
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
  // ── UNA LÍNEA DE ARTÍCULO ──────────────────────────────────────────────
  // El precio RESERVA su columna a la derecha y el nombre usa lo que queda,
  // partiendo por palabras. Antes los dos se pintaban con `fillText` sin
  // limitar ancho y un nombre largo se metía DEBAJO del precio: en papel salía
  // «2x The Mixed Master: Pita Mixta Gyros31,80 €» (Alcalá, 20/09).
  const filaArticulo = (
    etiqueta: string, precio: string, size: number,
    o: { boldPrecio?: boolean; fillPrecio?: string; tachar?: boolean; sangria?: number } = {},
  ) => {
    const { boldPrecio = false, fillPrecio = INK, tachar = false, sangria = 0 } = o
    ctx.font = fnt(size, boldPrecio)
    const pw = ctx.measureText(precio).width
    const x0 = PAD + sangria
    const anchoNombre = (W - PAD - pw - 12) - x0

    // El precio va en la PRIMERA línea, en su columna.
    text(precio, fnt(size, boldPrecio), { align: 'right', fill: fillPrecio })
    if (tachar) {
      ctx.strokeStyle = fillPrecio; ctx.lineWidth = 2; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(W - PAD - pw, y + 13); ctx.lineTo(W - PAD, y + 13); ctx.stroke()
    }

    ctx.font = fnt(size, false)
    const lineas = enLineas(ctx, etiqueta, anchoNombre)
    lineas.forEach((ln, i) => {
      text(ln, fnt(size, false), { x: i === 0 ? x0 : x0 + 22 })
      y += lineH(size)
    })
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

  // Código (banda) — EN SU SITIO Y A SU TAMAÑO, los del diseño aprobado. Lo
  // único que cambia respecto al 24/06 es de dónde sale la cifra: `passCode`
  // en vez de `pos_short_code` a secas.
  band(pc.full, 46)

  // Datos del pedido — el OTRO código en la línea fina (para incidencias).
  const sec = secondaryField(order, pc)
  if (sec) field(sec.label, sec.value)
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
      filaArticulo(label, money(line.original_unit_price * line.qty), 23,
                   { fillPrecio: '#888888', tachar: true })
      filaArticulo(line.discount_label || 'Descuento', money(line.line_total), 22,
                   { boldPrecio: true, sangria: 24 })
    } else {
      filaArticulo(label, money(line.line_total), 23)
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
  lr((order.payment_method || (order.channel ?? '').trim() || 'Pago') + ':', money(total), 22)
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
  const pc = pass(order)
  const H = 4000
  const canvas = newCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = INK; ctx.textBaseline = 'top'
  let y = PAD + 30   // más aire arriba (antes del código)

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

  // ── CABECERA · EL NÚMERO DEL DÍA MANDA (20/09, maqueta «El ticket de cocina»)
  //
  // Antes aquí iba el CÓDIGO DE PASE en banda negra a 92 px. Ahora arriba va el
  // NÚMERO DEL DÍA, que es lo que enlaza este papel con la pegatina de la caja
  // y con el botón «Listo · 41» de la tablet, y el código de pase baja al pie.
  // Principio 1 de la maqueta: una sola cosa grande por superficie. Tener el
  // número y el código los dos enormes sería no tener ninguno.
  //
  // El código NO se pierde —eso sería esconderlo, que es la regla 7—: va abajo,
  // monoespaciado y al mayor escalón que entra, que es donde manda (la entrega).
  // El número grande sale del CÓDIGO DE PASE (20/09, 13:10), no de un contador:
  // es lo que el repartidor pide. Y de `passCode`, nunca de `pos_short_code` a
  // secas — los dos campos discrepan en 1.887 de 1.887 pedidos de Glovo por Last.
  const numeroDelDia = numeroGrande(pc)
  let numSize = 132
  ctx.font = fnt(numSize, true)
  while (numSize > 60 && ctx.measureText(numeroDelDia).width > W * 0.52) {
    numSize -= 4; ctx.font = fnt(numSize, true)
  }
  const yCab = y
  ctx.fillStyle = INK; ctx.textAlign = 'left'
  ctx.fillText(numeroDelDia, PAD, yCab - Math.round(numSize * 0.12))
  ctx.textAlign = 'right'
  ctx.font = fnt(24, true)
  ctx.fillText((order.channel ?? deliveryLabel(order.service_type) ?? '').toString(), W - PAD, yCab + 6)
  ctx.font = fnt(22, false); ctx.fillStyle = MUT
  ctx.fillText(hhmmMadrid(order.entro_at), W - PAD, yCab + 38)
  ctx.textAlign = 'left'; ctx.fillStyle = INK
  y = yCab + Math.round(numSize * 0.80) + 10

  wrapLeft((order.brand ?? '').toString(), 26, true)
  y += 2
  // Alineadas a la IZQUIERDA con la marca y el número: un ticket con tres
  // ejes distintos obliga a buscar cada dato. La maqueta tiene un solo margen.
  wrapLeft(deliveryLabel(order.service_type), 24, true)
  if (order.customer_name) wrapLeft((order.customer_name || '').split(' ')[0], 24, true)
  if (order.expected_time) wrapLeft('Recogida ' + fmtDate(order.expected_time), 22, false, PAD, MUT)
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
    // 🔴 EN CASTELLANO (20/09). La base guarda el código estable en inglés
    // («gluten», «milk») y hasta hoy el ticket imprimía ESE código: la cocina
    // de Alcalá leía «eggs · milk · sulphites». La etiqueta visible sale de
    // allergens.ts, que es la fuente única — aquí no se traduce a mano.
    const al = (line.allergens || []) as string[]
    if (al.length) {
      const enCastellano = al.map(c => (isAllergenCode(c) ? allergenLabel(c, 'es') : c))
      wrapLeft('! ' + enCastellano.join(' · '), 24, true, PAD + 20)
    }
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

  // ── PIE · el número otra vez y el código de pase, como en la maqueta ──────
  //
  // El número se repite abajo a propósito: el ticket sale del rollo y lo
  // primero que asoma por la boca de la impresora es el final. Repetirlo
  // cuesta 8 mm de papel y ahorra darle la vuelta a la comanda.
  rule()
  const yPie = y
  ctx.fillStyle = INK; ctx.textAlign = 'left'
  ctx.font = fnt(56, true)
  ctx.fillText(numeroDelDia, PAD, yPie)
  let codSize = 40
  const codigoPase = pc.full || '—'
  ctx.font = `${codSize}px "DejaVu Sans Mono", "Roboto Mono", monospace`
  while (codSize > 16 && ctx.measureText(codigoPase).width > W * 0.52) {
    codSize -= 2
    ctx.font = `${codSize}px "DejaVu Sans Mono", "Roboto Mono", monospace`
  }
  ctx.textAlign = 'right'
  ctx.fillText(codigoPase, W - PAD, yPie + 4)
  const secPie = secondaryField(order, pc)
  if (secPie) {
    ctx.font = fnt(18, false); ctx.fillStyle = MUT
    ctx.fillText(secPie.label.replace(/:$/, '') + ' ' + secPie.value, W - PAD, yPie + 4 + codSize + 6)
  }
  ctx.textAlign = 'left'; ctx.fillStyle = INK
  y = yPie + Math.max(60, codSize + 30)

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
