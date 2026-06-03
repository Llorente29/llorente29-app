// src/modules/supply/services/purchaseOrderPdf.ts
//
// Generador del PDF del pedido de compra (jsPDF, mismo patrón que APPCC).
// Documento profesional estándar (benchmark): cabecera con datos fiscales del
// cliente (facturar-a) + número/fechas, bloque proveedor + entregar-en (local),
// tabla de líneas con formato y precio, DESGLOSE DE IVA POR TIPO (motor fiscal
// versionado), total, y pie con cuña "Folvy · folvy.app" (enlace clicable).
//
// El IVA se resuelve por la FECHA del pedido (vat_rate_for) → correcto aunque
// los tipos cambien. Hueco de LOGO reservado en cabecera (deuda: accounts no
// tiene logo_url todavía; cuando exista, se pinta aquí sin tocar el layout).

import jsPDF from 'jspdf'
import { supabase } from '@/lib/supabase'

// ── Datos que el PDF necesita (los reúne buildPurchaseOrderPdfData) ──
export interface PdfClient {
  legalName: string | null
  cif: string | null
  billingEmail: string | null
  billingPhone: string | null
  billingAddress: string | null   // dirección fiscal ya formateada
  logoUrl: string | null          // hueco logo (hoy null)
}
export interface PdfDelivery {
  locationName: string | null
  address: string | null
  phone: string | null
}
export interface PdfSupplier {
  name: string | null
  customerCode: string | null     // nº de cliente con el proveedor (hoy null)
}
export interface PdfLine {
  itemName: string
  supplierCode: string | null
  qty: number
  formatLabel: string | null      // "Saco (5 kg)"
  unitPrice: number | null
  lineTotal: number | null
  vatRate: number | null          // % vigente en la fecha del pedido
}
export interface PurchaseOrderPdfData {
  code: string | null
  orderDate: string | null
  expectedDate: string | null
  sentBy: string | null
  notes: string | null
  client: PdfClient
  delivery: PdfDelivery
  supplier: PdfSupplier
  lines: PdfLine[]
}

const FOLVY_URL = 'https://folvy.app'

function eur(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
}
function dateEs(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(value))
}

// ─────────────────────────────────────────────────────────────────────────
// Reúne todos los datos del PDF desde la BBDD (cliente, local, proveedor,
// líneas con su formato legible y su IVA vigente en la fecha del pedido).
// ─────────────────────────────────────────────────────────────────────────
export async function buildPurchaseOrderPdfData(
  accountId: string,
  orderId: string,
): Promise<PurchaseOrderPdfData> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const sb = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

  // 1) Pedido + cuenta (datos fiscales) + local (entrega) + proveedor.
  const { data: order, error: oErr } = await sb.from('purchase_order')
    .select('code, order_date, expected_date, notes, supplier_id, location_id')
    .eq('id', orderId).single()
  if (oErr || !order) throw new Error('No se pudo cargar el pedido.')

  const { data: acc } = await sb.from('accounts')
    .select('legal_name, cif, billing_email, billing_phone, billing_address')
    .eq('id', accountId).single()

  let delivery: PdfDelivery = { locationName: null, address: null, phone: null }
  if (order.location_id) {
    const { data: loc } = await sb.from('locations')
      .select('name, address, phone').eq('id', order.location_id).single()
    if (loc) delivery = { locationName: loc.name ?? null, address: loc.address ?? null, phone: loc.phone ?? null }
  }

  let supplier: PdfSupplier = { name: null, customerCode: null }
  if (order.supplier_id) {
    const { data: sup } = await sb.from('supplier')
      .select('name').eq('id', order.supplier_id).single()
    if (sup) supplier = { name: sup.name ?? null, customerCode: null }
  }

  // 2) Líneas + (artículo → formato, código proveedor, categoría fiscal).
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

  // 3) Resolver el IVA vigente de cada línea en la fecha del pedido.
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
      logoUrl: null, // hueco logo (deuda)
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
  const parts = [b.street, b.city, b.zip, b.province].filter(Boolean).map(String)
  return parts.length ? parts.join(', ') : null
}

// ─────────────────────────────────────────────────────────────────────────
// Genera el PDF y lo devuelve como Blob (para previsualizar) y lo guarda.
// ─────────────────────────────────────────────────────────────────────────
export function generatePurchaseOrderPdf(data: PurchaseOrderPdfData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const margin = 18
  const pageW = doc.internal.pageSize.getWidth()
  const contentW = pageW - margin * 2
  let y = margin

  // ── Cabecera: cliente (izq) + PEDIDO/número (der) ──
  // Hueco de logo reservado (deuda): si data.client.logoUrl existe, iría aquí.
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text(data.client.legalName ?? 'Cliente', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let cy = y + 6
  if (data.client.cif)            { doc.text(`CIF: ${data.client.cif}`, margin, cy); cy += 4.5 }
  if (data.client.billingAddress) { doc.text(data.client.billingAddress, margin, cy); cy += 4.5 }
  const contactBits = [data.client.billingEmail, data.client.billingPhone].filter(Boolean).join(' · ')
  if (contactBits)                { doc.text(contactBits, margin, cy); cy += 4.5 }

  // Bloque número/fechas a la derecha.
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text('PEDIDO', pageW - margin, y, { align: 'right' })
  doc.setFontSize(12)
  doc.setTextColor(24, 95, 165)
  doc.text(data.code ?? '—', pageW - margin, y + 6, { align: 'right' })
  doc.setTextColor(60, 60, 60)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Fecha: ${dateEs(data.orderDate)}`, pageW - margin, y + 12, { align: 'right' })
  doc.text(`Entrega: ${dateEs(data.expectedDate)}`, pageW - margin, y + 16.5, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  y = Math.max(cy, y + 20) + 4
  doc.setDrawColor(40, 40, 40)
  doc.setLineWidth(0.4)
  doc.line(margin, y, pageW - margin, y)
  y += 8

  // ── Proveedor (izq) + Entregar en (der) ──
  const colW = contentW / 2 - 4
  doc.setFontSize(8)
  doc.setTextColor(95, 95, 90)
  doc.text('PROVEEDOR', margin, y)
  doc.text('ENTREGAR EN', margin + colW + 8, y)
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(data.supplier.name ?? '—', margin, y + 5)
  doc.text(data.delivery.locationName ?? '—', margin + colW + 8, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let ly = y + 10
  if (data.supplier.customerCode) doc.text(`Nº cliente: ${data.supplier.customerCode}`, margin, ly)
  let ry = y + 10
  if (data.delivery.address) { doc.text(data.delivery.address, margin + colW + 8, ry, { maxWidth: colW }); ry += 4.5 }
  if (data.delivery.phone)   { doc.text(`Tel: ${data.delivery.phone}`, margin + colW + 8, ry) }
  y = Math.max(ly, ry) + 8

  // ── Tabla de líneas ──
  const cols = {
    art: margin,
    qty: margin + 78,
    fmt: margin + 95,
    iva: margin + 138,
    tot: pageW - margin,
  }
  doc.setFontSize(8)
  doc.setTextColor(95, 95, 90)
  doc.text('ARTÍCULO', cols.art, y)
  doc.text('CANT.', cols.qty, y, { align: 'right' })
  doc.text('FORMATO', cols.fmt, y)
  doc.text('IVA', cols.iva, y, { align: 'right' })
  doc.text('TOTAL', cols.tot, y, { align: 'right' })
  doc.setTextColor(0, 0, 0)
  y += 2
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageW - margin, y)
  y += 5

  doc.setFontSize(9)
  let subtotal = 0
  const vatBuckets = new Map<number, number>() // rate → base imponible acumulada
  for (const l of data.lines) {
    const base = l.lineTotal ?? 0
    subtotal += base
    if (l.vatRate !== null) vatBuckets.set(l.vatRate, (vatBuckets.get(l.vatRate) ?? 0) + base)

    doc.text(l.itemName, cols.art, y, { maxWidth: 74 })
    doc.text(String(l.qty), cols.qty, y, { align: 'right' })
    doc.text(l.formatLabel ?? '—', cols.fmt, y, { maxWidth: 40 })
    doc.text(l.vatRate !== null ? `${l.vatRate}%` : '—', cols.iva, y, { align: 'right' })
    doc.text(eur(l.lineTotal), cols.tot, y, { align: 'right' })
    y += 6
    if (y > 260) { doc.addPage(); y = margin }
  }

  // ── Desglose de IVA por tipo + totales ──
  y += 2
  doc.setLineWidth(0.3)
  doc.line(margin + 100, y, pageW - margin, y)
  y += 6
  doc.setFontSize(9)
  const labelX = margin + 105
  const valX = pageW - margin
  doc.text('Base imponible', labelX, y)
  doc.text(eur(subtotal), valX, y, { align: 'right' })
  y += 5.5

  let totalVat = 0
  const sortedRates = Array.from(vatBuckets.keys()).sort((a, b) => a - b)
  for (const rate of sortedRates) {
    const base = vatBuckets.get(rate) ?? 0
    const cuota = Math.round(base * rate) / 100
    totalVat += cuota
    doc.text(`IVA ${rate}% (sobre ${eur(base)})`, labelX, y)
    doc.text(eur(cuota), valX, y, { align: 'right' })
    y += 5.5
  }

  doc.setLineWidth(0.4)
  doc.line(labelX, y, valX, y)
  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('TOTAL', labelX, y)
  doc.text(eur(subtotal + totalVat), valX, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  y += 12

  // ── Enviado por ──
  if (data.sentBy) {
    doc.setFontSize(8.5)
    doc.setTextColor(95, 95, 90)
    doc.text(`Enviado por: ${data.sentBy}`, margin, y)
    doc.setTextColor(0, 0, 0)
  }

  // ── Pie: cuña Folvy (enlace clicable) ──
  const footerY = doc.internal.pageSize.getHeight() - 12
  doc.setFontSize(8)
  doc.setTextColor(140, 135, 128)
  const pre = 'Generado con '
  doc.text(pre, pageW / 2, footerY, { align: 'center' })
  const preW = doc.getTextWidth(pre)
  doc.setTextColor(24, 95, 165)
  const linkText = 'Folvy · folvy.app'
  doc.textWithLink(linkText, pageW / 2 + preW / 2, footerY, { url: FOLVY_URL })
  doc.setTextColor(0, 0, 0)

  const filename = `pedido-${data.code ?? 'borrador'}.pdf`
  return { blob: doc.output('blob'), filename }
}
