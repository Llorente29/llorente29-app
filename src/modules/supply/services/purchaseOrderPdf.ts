// src/modules/supply/services/purchaseOrderPdf.ts
//
// Generador del PDF del pedido de compra (jsPDF).
// Documento profesional con MARCA: logo del CLIENTE en cabecera (su documento)
// + sello FOLVY en los detalles (paleta azul marino/terracota, tipografía
// Fraunces en titulares, pie clicable "Folvy · folvy.app"). Cada PDF llega a un
// proveedor que es cliente potencial → publicidad gratis bien hecha.
//
// Estructura: cabecera (logo + identidad fiscal del cliente / nº de pedido +
// fechas + estado) · proveedor · Facturar-a / Entregar-en · tabla de líneas
// (artículo + código proveedor + formato legible + cant + precio + IVA + importe)
// · desglose de IVA POR TIPO (motor fiscal versionado, vat_rate_for por la fecha
// del pedido) · total · enviado por · pie Folvy. Multipágina con cabecera de
// tabla repetida y numeración.

import jsPDF from 'jspdf'
import { supabase } from '@/lib/supabase'
import { ensureFraunces } from './folvyPdfFont'

// ── Paleta de marca Folvy (de src/index.css) ──
const NAVY: [number, number, number] = [30, 58, 95]     // #1E3A5F accent
const TERRA: [number, number, number] = [214, 116, 66]  // #D67442 terracota
const INK: [number, number, number] = [31, 36, 33]      // #1F2421
const MUTED: [number, number, number] = [107, 114, 128] // #6B7280
const LINE: [number, number, number] = [227, 230, 226]  // #E3E6E2
const SOFT: [number, number, number] = [237, 236, 230]  // #EDECE6 accent-bg
const TERRA_BG: [number, number, number] = [250, 239, 230] // #FAEFE6
const ZEBRA: [number, number, number] = [250, 251, 250]

const FOLVY_URL = 'https://folvy.app'

// ── Datos que el PDF necesita (los reúne buildPurchaseOrderPdfData) ──
export interface PdfClient {
  legalName: string | null
  cif: string | null
  billingEmail: string | null
  billingPhone: string | null
  billingAddress: string | null
  logoUrl: string | null            // dataURL del logo (cargado en build) o null
}
export interface PdfDelivery {
  locationName: string | null
  address: string | null
  phone: string | null
}
export interface PdfSupplier {
  name: string | null
  customerCode: string | null
}
export interface PdfLine {
  itemName: string
  supplierCode: string | null
  qty: number
  formatLabel: string | null
  unitPrice: number | null
  lineTotal: number | null
  vatRate: number | null
}
export interface PurchaseOrderPdfData {
  code: string | null
  status: string | null
  orderDate: string | null
  expectedDate: string | null
  sentBy: string | null
  notes: string | null
  client: PdfClient
  delivery: PdfDelivery
  supplier: PdfSupplier
  lines: PdfLine[]
}

const STATUS_LABEL: Record<string, string> = {
  borrador: 'Borrador', enviado: 'Enviado', recibido_parcial: 'Recibido parcial',
  recibido: 'Recibido', cerrado: 'Cerrado', cancelado: 'Cancelado',
}

function eur(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
}
function dateEs(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(value))
}

// fetch de la URL pública del logo → dataURL (para incrustar en el PDF).
async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Reúne todos los datos del PDF desde la BBDD.
// ─────────────────────────────────────────────────────────────────────────
export async function buildPurchaseOrderPdfData(
  accountId: string,
  orderId: string,
): Promise<PurchaseOrderPdfData> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const sb = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

  const { data: order, error: oErr } = await sb.from('purchase_order')
    .select('code, status, order_date, expected_date, notes, supplier_id, location_id')
    .eq('id', orderId).single()
  if (oErr || !order) throw new Error('No se pudo cargar el pedido.')

  const { data: acc } = await sb.from('accounts')
    .select('legal_name, cif, billing_email, billing_phone, billing_address, logo_url')
    .eq('id', accountId).single()

  // Logo → dataURL (no rompe si falta o falla la descarga).
  let logoDataUrl: string | null = null
  if (acc?.logo_url) logoDataUrl = await urlToDataUrl(acc.logo_url as string)

  let delivery: PdfDelivery = { locationName: null, address: null, phone: null }
  if (order.location_id) {
    const { data: loc } = await sb.from('locations')
      .select('name, address, phone').eq('id', order.location_id).single()
    if (loc) delivery = { locationName: loc.name ?? null, address: loc.address ?? null, phone: loc.phone ?? null }
  }

  let supplier: PdfSupplier = { name: null, customerCode: null }
  if (order.supplier_id) {
    const { data: sup } = await sb.from('supplier').select('name').eq('id', order.supplier_id).single()
    if (sup) supplier = { name: sup.name ?? null, customerCode: null }
  }

  const { data: rawLines } = await sb.from('purchase_order_line')
    .select(`
      product_name, qty_ordered, est_unit_price, est_line_total, position,
      recipe_item_id,
      purchase_format:purchase_format_id ( name, qty_in_base ),
      recipe_item:recipe_item_id ( vat_category_id, base_unit_id, kitchen_unit:base_unit_id ( abbreviation ) )
    `)
    .eq('purchase_order_id', orderId)
    .order('position')

  const orderDate = order.order_date ?? new Date().toISOString().slice(0, 10)

  const lines: PdfLine[] = []
  for (const l of (rawLines ?? [])) {
    const fmt = l.purchase_format as { name?: string; qty_in_base?: number } | null
    const item = l.recipe_item as { vat_category_id?: string | null; kitchen_unit?: { abbreviation?: string } | null } | null
    const baseAbbr = item?.kitchen_unit?.abbreviation ?? null

    let vatRate: number | null = null
    if (item?.vat_category_id) {
      const { data: vr } = await sb.rpc('vat_rate_for', { p_category_id: item.vat_category_id, p_date: orderDate })
      if (Array.isArray(vr) && vr.length > 0) vatRate = Number(vr[0].rate)
    }

    lines.push({
      itemName: l.product_name ?? '(sin nombre)',
      supplierCode: null,
      qty: Number(l.qty_ordered) || 0,
      formatLabel: buildFormatLabel(fmt?.name ?? null, fmt?.qty_in_base ?? null, baseAbbr),
      unitPrice: l.est_unit_price !== null ? Number(l.est_unit_price) : null,
      lineTotal: l.est_line_total !== null ? Number(l.est_line_total) : null,
      vatRate,
    })
  }

  return {
    code: order.code ?? null,
    status: (order.status as string | null) ?? null,
    orderDate: order.order_date ?? null,
    expectedDate: order.expected_date ?? null,
    sentBy: extractSentBy(order.notes ?? null),
    notes: null,
    client: {
      legalName: acc?.legal_name ?? null,
      cif: acc?.cif ?? null,
      billingEmail: acc?.billing_email ?? null,
      billingPhone: acc?.billing_phone ?? null,
      billingAddress: formatAddress(acc?.billing_address ?? null),
      logoUrl: logoDataUrl,
    },
    delivery,
    supplier,
    lines,
  }
}

function buildFormatLabel(name: string | null, qtyInBase: number | null, baseAbbr: string | null): string | null {
  if (!name) return null
  if (qtyInBase === null || baseAbbr === null) return name
  let qty = qtyInBase, unit = baseAbbr
  if (baseAbbr === 'g' && qtyInBase >= 1000) { qty = qtyInBase / 1000; unit = 'kg' }
  else if (baseAbbr === 'ml' && qtyInBase >= 1000) { qty = qtyInBase / 1000; unit = 'L' }
  const qs = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(qty)
  return `${name} (${qs} ${unit})`
}
function extractSentBy(notes: string | null): string | null {
  if (!notes) return null
  const m = notes.match(/Enviado por:\s*(.+)/i)
  return m ? m[1].trim() : null
}
function formatAddress(billing: unknown): string | null {
  if (!billing || typeof billing !== 'object') return null
  const b = billing as Record<string, unknown>
  const parts = [b.street, b.city, b.postalCode ?? b.zip, b.province].filter(Boolean).map(String)
  return parts.length ? parts.join(', ') : null
}

// ─────────────────────────────────────────────────────────────────────────
// Render del PDF.
// ─────────────────────────────────────────────────────────────────────────
export function generatePurchaseOrderPdf(data: PurchaseOrderPdfData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  ensureFraunces(doc)

  const margin = 16
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - margin * 2
  const fontList = doc.getFontList() as Record<string, unknown>
  const hasFraunces = Object.prototype.hasOwnProperty.call(fontList, 'Fraunces')

  // Helpers de estilo.
  const display = (style: 'normal' | 'bold' = 'normal') =>
    doc.setFont(hasFraunces ? 'Fraunces' : 'helvetica', style)
  const sans = (style: 'normal' | 'bold' = 'normal') => doc.setFont('helvetica', style)
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])

  let y = margin

  // ── CABECERA ──
  const logoBoxW = 22, logoBoxH = 18
  let identX = margin
  if (data.client.logoUrl) {
    try {
      const props = doc.getImageProperties(data.client.logoUrl)
      const ratio = props.width / props.height
      let w = logoBoxW, h = w / ratio
      if (h > logoBoxH) { h = logoBoxH; w = h * ratio }
      doc.addImage(data.client.logoUrl, 'PNG', margin, y, w, h, undefined, 'FAST')
      identX = margin + Math.max(w, 14) + 5
    } catch {
      identX = margin
    }
  }

  // Identidad fiscal del cliente.
  display('bold'); doc.setFontSize(16); ink(INK)
  doc.text(data.client.legalName ?? 'Cliente', identX, y + 5)
  sans('normal'); doc.setFontSize(8.5); ink(MUTED)
  let cy = y + 10
  if (data.client.cif) { doc.text(`CIF ${data.client.cif}`, identX, cy); cy += 4 }
  if (data.client.billingAddress) { doc.text(data.client.billingAddress, identX, cy, { maxWidth: 95 }); cy += 4 }
  const contactBits = [data.client.billingEmail, data.client.billingPhone].filter(Boolean).join(' · ')
  if (contactBits) { doc.text(contactBits, identX, cy); cy += 4 }

  // Bloque documento (derecha).
  ink(NAVY); sans('bold'); doc.setFontSize(9)
  doc.text('PEDIDO DE COMPRA', pageW - margin, y + 2, { align: 'right' })
  display('bold'); doc.setFontSize(20); ink(TERRA)
  doc.text(data.code ?? '—', pageW - margin, y + 9.5, { align: 'right' })
  sans('normal'); doc.setFontSize(8.5); ink(MUTED)
  doc.text(`Fecha: ${dateEs(data.orderDate)}`, pageW - margin, y + 15, { align: 'right' })
  doc.text(`Entrega prevista: ${dateEs(data.expectedDate)}`, pageW - margin, y + 19, { align: 'right' })
  // Chip de estado.
  if (data.status) {
    const label = STATUS_LABEL[data.status] ?? data.status
    sans('bold'); doc.setFontSize(7.5)
    const tw = doc.getTextWidth(label.toUpperCase())
    const chipW = tw + 8, chipX = pageW - margin - chipW, chipY = y + 22.5
    fill(SOFT); stroke(LINE); doc.setLineWidth(0.2)
    doc.roundedRect(chipX, chipY, chipW, 5, 2.5, 2.5, 'FD')
    ink(NAVY); doc.text(label.toUpperCase(), chipX + chipW / 2, chipY + 3.4, { align: 'center' })
  }

  y = Math.max(cy, y + 24) + 3

  // Regla de marca navy→terracota.
  fill(NAVY); doc.rect(margin, y, contentW * 0.4, 1.1, 'F')
  fill(TERRA); doc.rect(margin + contentW * 0.4, y, contentW * 0.12, 1.1, 'F')
  fill(LINE); doc.rect(margin + contentW * 0.52, y, contentW * 0.48, 1.1, 'F')
  y += 8

  // ── PROVEEDOR (tarjeta ancha) ──
  const cardPad = 4
  fill(TERRA_BG); stroke(LINE); doc.setLineWidth(0.2)
  doc.roundedRect(margin, y, contentW, 16, 2, 2, 'FD')
  sans('bold'); doc.setFontSize(7); ink(MUTED)
  doc.text('PROVEEDOR', margin + cardPad, y + 4.5)
  display('bold'); doc.setFontSize(12); ink(INK)
  doc.text(data.supplier.name ?? '—', margin + cardPad, y + 10, { maxWidth: contentW - cardPad * 2 })
  if (data.supplier.customerCode) {
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    doc.text(`Nº de cliente: ${data.supplier.customerCode}`, margin + cardPad, y + 13.5)
  }
  y += 20

  // ── FACTURAR A / ENTREGAR EN (dos tarjetas) ──
  const colW = (contentW - 6) / 2
  const cardH = 22
  const drawParty = (x: number, title: string, big: string, lines: string[]) => {
    fill([255, 255, 255]); stroke(LINE); doc.setLineWidth(0.2)
    doc.roundedRect(x, y, colW, cardH, 2, 2, 'FD')
    sans('bold'); doc.setFontSize(7); ink(MUTED)
    doc.text(title, x + cardPad, y + 4.5)
    display('bold'); doc.setFontSize(10.5); ink(INK)
    doc.text(big || '—', x + cardPad, y + 9.5, { maxWidth: colW - cardPad * 2 })
    sans('normal'); doc.setFontSize(8.5); ink([74, 81, 74])
    let ly = y + 14
    for (const ln of lines) {
      if (!ln) continue
      doc.text(ln, x + cardPad, ly, { maxWidth: colW - cardPad * 2 }); ly += 4
    }
  }
  drawParty(margin, 'FACTURAR A', data.client.legalName ?? '—',
    [data.client.cif ? `CIF ${data.client.cif}` : '', data.client.billingAddress ?? ''])
  drawParty(margin + colW + 6, 'ENTREGAR EN', data.delivery.locationName ?? '—',
    [data.delivery.address ?? '', data.delivery.phone ? `Tel: ${data.delivery.phone}` : ''])
  y += cardH + 8

  // ── TABLA DE LÍNEAS ──
  const cols = {
    art: margin + 2,
    fmt: margin + 86,
    qty: margin + 122,
    price: margin + 145,
    iva: margin + 162,
    tot: pageW - margin - 2,
  }
  const drawTableHeader = () => {
    fill(NAVY); doc.rect(margin, y, contentW, 7, 'F')
    sans('bold'); doc.setFontSize(7.5); ink([255, 255, 255])
    doc.text('ARTÍCULO', cols.art, y + 4.7)
    doc.text('FORMATO', cols.fmt, y + 4.7)
    doc.text('CANT.', cols.qty, y + 4.7, { align: 'right' })
    doc.text('PRECIO', cols.price, y + 4.7, { align: 'right' })
    doc.text('IVA', cols.iva, y + 4.7, { align: 'right' })
    doc.text('IMPORTE', cols.tot, y + 4.7, { align: 'right' })
    y += 7
  }
  drawTableHeader()

  let subtotal = 0
  const vatBuckets = new Map<number, number>()
  let zebra = false
  const rowH = 8

  for (const l of data.lines) {
    if (y + rowH > pageH - 22) { doc.addPage(); y = margin; drawTableHeader() }

    const base = l.lineTotal ?? 0
    subtotal += base
    if (l.vatRate !== null) vatBuckets.set(l.vatRate, (vatBuckets.get(l.vatRate) ?? 0) + base)

    if (zebra) { fill(ZEBRA); doc.rect(margin, y, contentW, rowH, 'F') }
    zebra = !zebra

    sans('bold'); doc.setFontSize(9); ink(INK)
    doc.text(l.itemName, cols.art, y + 4, { maxWidth: cols.fmt - cols.art - 3 })
    if (l.supplierCode) {
      sans('normal'); doc.setFontSize(7); ink(MUTED)
      doc.text(`cód. ${l.supplierCode}`, cols.art, y + 7)
    }
    sans('normal'); doc.setFontSize(8.5); ink([74, 81, 74])
    doc.text(l.formatLabel ?? '—', cols.fmt, y + 4, { maxWidth: cols.qty - cols.fmt - 3 })
    ink(INK); doc.setFontSize(9)
    doc.text(new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(l.qty), cols.qty, y + 4, { align: 'right' })
    doc.text(eur(l.unitPrice), cols.price, y + 4, { align: 'right' })
    doc.text(l.vatRate !== null ? `${l.vatRate}%` : '—', cols.iva, y + 4, { align: 'right' })
    sans('bold'); doc.text(eur(l.lineTotal), cols.tot, y + 4, { align: 'right' })

    stroke(LINE); doc.setLineWidth(0.15); doc.line(margin, y + rowH, pageW - margin, y + rowH)
    y += rowH
  }
  y += 4

  // ── TOTALES (caja derecha) ──
  const totalsW = contentW * 0.5
  const totalsX = pageW - margin - totalsW
  const labelX = totalsX + 2
  const valX = pageW - margin - 2

  // Salto si no caben los totales.
  const totalsHeight = 12 + vatBuckets.size * 5.5 + 14
  if (y + totalsHeight > pageH - 18) { doc.addPage(); y = margin }

  sans('normal'); doc.setFontSize(9); ink([65, 72, 63])
  doc.text('Base imponible', labelX, y)
  doc.text(eur(subtotal), valX, y, { align: 'right' })
  y += 6

  let totalVat = 0
  const rates = Array.from(vatBuckets.keys()).sort((a, b) => a - b)
  ink(MUTED); doc.setFontSize(8.5)
  for (const rate of rates) {
    const b = vatBuckets.get(rate) ?? 0
    const cuota = Math.round(b * rate) / 100
    totalVat += cuota
    doc.text(`IVA ${rate}% (sobre ${eur(b)})`, labelX, y)
    doc.text(eur(cuota), valX, y, { align: 'right' })
    y += 5.5
  }
  y += 1

  // Caja TOTAL navy.
  fill(NAVY); doc.roundedRect(totalsX, y, totalsW, 10, 2, 2, 'F')
  display('bold'); doc.setFontSize(11); ink([255, 255, 255])
  doc.text('TOTAL', labelX, y + 6.6)
  doc.setFontSize(14)
  doc.text(eur(subtotal + totalVat), valX, y + 6.8, { align: 'right' })
  y += 16

  // ── Enviado por ──
  if (data.sentBy) {
    sans('normal'); doc.setFontSize(8.5); ink(MUTED)
    doc.text(`Enviado por: ${data.sentBy}`, margin, y)
  }

  // ── Pie + numeración en todas las páginas ──
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = pageH - 10
    sans('normal'); doc.setFontSize(8); ink([154, 162, 154])
    const pre = 'Generado con '
    const link = 'Folvy · folvy.app'
    const preW = doc.getTextWidth(pre)
    const linkW = doc.getTextWidth(link)
    const startX = (pageW - (preW + linkW)) / 2
    doc.text(pre, startX, fy)
    ink(TERRA)
    doc.textWithLink(link, startX + preW, fy, { url: FOLVY_URL })
    ink([179, 185, 178])
    doc.text(`Página ${p} de ${pages}`, pageW - margin, fy, { align: 'right' })
  }

  const filename = `pedido-${data.code ?? 'borrador'}.pdf`
  return { blob: doc.output('blob'), filename }
}
