// src/modules/supply/services/supplierInvoiceService.ts
//
// Folvy Supply C3 — Factura de proveedor (three-way match).
// C3.1: modelo + CRUD + alta manual. La factura cierra el ciclo de compra
// (pedido → recepción → FACTURA) y es el documento que confirma el coste.
// NO mueve stock (eso lo hizo la recepción); en C3.4 ajustará coste al aprobar.
//
// Patrón calcado de supplierCatalogService / goodsReceiptService.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type { OcrDocument, OcrLine } from '@/modules/supply/services/goodsReceiptService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

export type SupplierInvoiceDocKind = 'invoice' | 'credit_note'
export type SupplierInvoiceStatus =
  | 'borrador' | 'en_revision' | 'aprobada' | 'con_discrepancias' | 'pagada' | 'anulada'
export type SupplierInvoiceMatchStatus = 'sin_match' | 'ok' | 'con_diferencias'

export interface SupplierInvoice {
  id: string
  accountId: string
  supplierId: string | null
  supplierName: string | null
  locationId: string | null
  code: string | null
  docKind: SupplierInvoiceDocKind
  invoiceNumber: string | null
  invoiceDate: string | null
  status: SupplierInvoiceStatus
  matchStatus: SupplierInvoiceMatchStatus
  source: 'manual' | 'ocr'
  taxBaseTotal: number | null
  taxTotal: number | null
  grandTotal: number | null
  notes: string | null
  needsReview: boolean
  createdAt: string
}

export interface SupplierInvoiceLineInput {
  recipeItemId?: string | null
  rawText?: string | null
  supplierCode?: string | null
  qty?: number | null
  unitPrice?: number | null
  lineAmount?: number | null
  vatPct?: number | null
  vatCategoryId?: string | null
  goodsReceiptLineId?: string | null
  position?: number | null
}

export interface SupplierInvoiceLine extends SupplierInvoiceLineInput {
  id: string
  supplierInvoiceId: string
  matchResult: string | null
  matchDetail: Record<string, unknown> | null
  itemName?: string | null
}

export interface CreateSupplierInvoiceInput {
  accountId: string
  supplierId: string | null
  locationId: string | null
  docKind: SupplierInvoiceDocKind
  invoiceNumber: string | null
  invoiceDate: string | null
  taxBaseTotal: number | null
  taxTotal: number | null
  grandTotal: number | null
  notes: string | null
  source?: 'manual' | 'ocr'
  aiSessionId?: string | null
  rawDocumentUrl?: string | null
  createdBy?: string | null
  createdByName?: string | null
  lines: SupplierInvoiceLineInput[]
  receiptIds?: string[]        // albaranes que cubre (N:M)
}

function mapInvoice(r: Row): SupplierInvoice {
  const sup = (r.supplier ?? null) as { name?: string } | null
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    supplierId: (r.supplier_id as string | null) ?? null,
    supplierName: sup?.name ?? null,
    locationId: (r.location_id as string | null) ?? null,
    code: (r.code as string | null) ?? null,
    docKind: (r.doc_kind as SupplierInvoiceDocKind) ?? 'invoice',
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    invoiceDate: (r.invoice_date as string | null) ?? null,
    status: (r.status as SupplierInvoiceStatus) ?? 'borrador',
    matchStatus: (r.match_status as SupplierInvoiceMatchStatus) ?? 'sin_match',
    source: (r.source as 'manual' | 'ocr') ?? 'manual',
    taxBaseTotal: (r.tax_base_total as number | null) ?? null,
    taxTotal: (r.tax_total as number | null) ?? null,
    grandTotal: (r.grand_total as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    needsReview: Boolean(r.needs_review),
    createdAt: r.created_at as string,
  }
}

/** Lista de facturas de la cuenta (cabecera + nombre de proveedor). */
export async function listSupplierInvoices(accountId: string): Promise<SupplierInvoice[]> {
  requireSupabase()
  const { data, error } = await from('supplier_invoice')
    .select('id, account_id, supplier_id, location_id, code, doc_kind, invoice_number, invoice_date, status, match_status, source, tax_base_total, tax_total, grand_total, notes, needs_review, created_at, supplier:supplier_id ( name )')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Error cargando facturas: ${error.message}`)
  return ((data as Row[]) ?? []).map(mapInvoice)
}

/** Una factura con sus líneas y los albaranes que cubre. */
export async function getSupplierInvoiceById(id: string): Promise<{
  invoice: SupplierInvoice
  lines: SupplierInvoiceLine[]
  receiptIds: string[]
} | null> {
  requireSupabase()
  const { data: head, error: e1 } = await from('supplier_invoice')
    .select('id, account_id, supplier_id, location_id, code, doc_kind, invoice_number, invoice_date, status, match_status, source, tax_base_total, tax_total, grand_total, notes, needs_review, created_at, supplier:supplier_id ( name )')
    .eq('id', id)
    .maybeSingle()
  if (e1) throw new Error(`Error cargando la factura: ${e1.message}`)
  if (!head) return null

  const { data: lineRows, error: e2 } = await from('supplier_invoice_line')
    .select('id, supplier_invoice_id, recipe_item_id, raw_text, supplier_code, qty, unit_price, line_amount, vat_pct, vat_category_id, goods_receipt_line_id, match_result, match_detail, position, recipe_item:recipe_item_id ( name )')
    .eq('supplier_invoice_id', id)
    .order('position', { ascending: true })
  if (e2) throw new Error(`Error cargando líneas: ${e2.message}`)

  const { data: recRows, error: e3 } = await from('supplier_invoice_receipt')
    .select('goods_receipt_id')
    .eq('supplier_invoice_id', id)
  if (e3) throw new Error(`Error cargando albaranes: ${e3.message}`)

  const lines: SupplierInvoiceLine[] = ((lineRows as Row[]) ?? []).map(r => {
    const item = (r.recipe_item ?? null) as { name?: string } | null
    return {
      id: r.id as string,
      supplierInvoiceId: r.supplier_invoice_id as string,
      recipeItemId: (r.recipe_item_id as string | null) ?? null,
      rawText: (r.raw_text as string | null) ?? null,
      supplierCode: (r.supplier_code as string | null) ?? null,
      qty: (r.qty as number | null) ?? null,
      unitPrice: (r.unit_price as number | null) ?? null,
      lineAmount: (r.line_amount as number | null) ?? null,
      vatPct: (r.vat_pct as number | null) ?? null,
      vatCategoryId: (r.vat_category_id as string | null) ?? null,
      goodsReceiptLineId: (r.goods_receipt_line_id as string | null) ?? null,
      position: (r.position as number | null) ?? null,
      matchResult: (r.match_result as string | null) ?? null,
      matchDetail: (r.match_detail as Record<string, unknown> | null) ?? null,
      itemName: item?.name ?? null,
    }
  })

  return {
    invoice: mapInvoice(head as Row),
    lines,
    receiptIds: ((recRows as Row[]) ?? []).map(r => r.goods_receipt_id as string),
  }
}

/** Crea una factura con sus líneas y enlaces a albaranes. */
export async function createSupplierInvoice(input: CreateSupplierInvoiceInput): Promise<string> {
  requireSupabase()
  const { data: head, error: e1 } = await from('supplier_invoice')
    .insert({
      account_id: input.accountId,
      supplier_id: input.supplierId,
      location_id: input.locationId,
      doc_kind: input.docKind,
      invoice_number: input.invoiceNumber,
      invoice_date: input.invoiceDate,
      status: 'borrador',
      source: input.source ?? 'manual',
      ai_session_id: input.aiSessionId ?? null,
      raw_document_url: input.rawDocumentUrl ?? null,
      tax_base_total: input.taxBaseTotal,
      tax_total: input.taxTotal,
      grand_total: input.grandTotal,
      notes: input.notes,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    })
    .select('id')
    .single()
  if (e1 || !head) throw new Error(`No se pudo crear la factura: ${e1?.message ?? 'desconocido'}`)
  const invoiceId = (head as Row).id as string

  const lines = input.lines.filter(l => (l.qty ?? 0) !== 0 || (l.lineAmount ?? 0) !== 0 || l.rawText)
  if (lines.length > 0) {
    const { error: e2 } = await from('supplier_invoice_line').insert(
      lines.map((l, i) => ({
        supplier_invoice_id: invoiceId,
        recipe_item_id: l.recipeItemId ?? null,
        raw_text: l.rawText ?? null,
        supplier_code: l.supplierCode ?? null,
        qty: l.qty ?? null,
        unit_price: l.unitPrice ?? null,
        line_amount: l.lineAmount ?? null,
        vat_pct: l.vatPct ?? null,
        vat_category_id: l.vatCategoryId ?? null,
        goods_receipt_line_id: l.goodsReceiptLineId ?? null,
        position: l.position ?? i,
      }))
    )
    if (e2) throw new Error(`No se pudieron guardar las líneas: ${e2.message}`)
  }

  if (input.receiptIds && input.receiptIds.length > 0) {
    const { error: e3 } = await from('supplier_invoice_receipt').insert(
      input.receiptIds.map(rid => ({ supplier_invoice_id: invoiceId, goods_receipt_id: rid }))
    )
    if (e3) throw new Error(`No se pudieron enlazar los albaranes: ${e3.message}`)
  }

  return invoiceId
}

/** Anula una factura (no borra; deja rastro). */
export async function voidSupplierInvoice(id: string): Promise<void> {
  requireSupabase()
  const { error } = await from('supplier_invoice')
    .update({ status: 'anulada', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`No se pudo anular la factura: ${error.message}`)
}

// ════════════════════════════════════════════════════════════════════════════
// C3.2 — OCR de factura: resolver cabecera + sugerir albaranes + anti-duplicado.
// Reutiliza el OCR de recepción (scanReceipt/ocr-albaran, que ya lee facturas).
// ════════════════════════════════════════════════════════════════════════════


function normNifLocal(v: string | null): string {
  if (!v) return ''
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
function normTextLocal(v: string | null): string {
  if (!v) return ''
  return v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface ResolvedInvoiceHeader {
  supplierId: string            // '' si no casó
  proposedSupplierName: string | null
  proposedSupplierNif: string | null
  locationId: string            // '' si no casó
  invoiceNumber: string | null
  invoiceDate: string           // YYYY-MM-DD (doc_date o hoy)
  docKind: SupplierInvoiceDocKind
  taxBaseTotal: number | null
  taxTotal: number | null
  grandTotal: number | null
  unmatchedSupplier: boolean
  suggestedReceiptIds: string[] // albaranes confirmados del proveedor SIN facturar
}

/** Albarán de un proveedor sin factura (no enlazado en supplier_invoice_receipt). */
export interface UninvoicedReceipt {
  id: string
  code: string | null
  receiptDate: string | null
}

/** Lista de albaranes confirmados de un proveedor que aún no están en ninguna factura. */
export async function listUninvoicedReceipts(
  accountId: string, supplierId: string,
): Promise<UninvoicedReceipt[]> {
  requireSupabase()
  // Albaranes confirmados del proveedor.
  const { data: recs, error: e1 } = await from('goods_receipt')
    .select('id, code, receipt_date, status')
    .eq('account_id', accountId)
    .eq('supplier_id', supplierId)
    .eq('status', 'confirmado')
    .order('receipt_date', { ascending: false })
  if (e1) { console.error('[supplierInvoiceService] listUninvoicedReceipts', e1); return [] }
  const all = (recs as Row[] | null) ?? []
  if (all.length === 0) return []
  // Los ya enlazados a alguna factura.
  const { data: linked } = await from('supplier_invoice_receipt')
    .select('goods_receipt_id')
    .in('goods_receipt_id', all.map(r => r.id as string))
  const linkedSet = new Set(((linked as Row[] | null) ?? []).map(r => r.goods_receipt_id as string))
  return all
    .filter(r => !linkedSet.has(r.id as string))
    .map(r => ({ id: r.id as string, code: (r.code as string | null) ?? null, receiptDate: (r.receipt_date as string | null) ?? null }))
}

/** Resuelve la cabecera de la factura desde el documento OCR (proveedor por NIF/nombre + albaranes sin facturar). */
export async function resolveInvoiceHeader(
  accountId: string, doc: OcrDocument,
): Promise<ResolvedInvoiceHeader> {
  requireSupabase()
  const commercialName = doc.supplier_name ?? null
  const commercialNif = doc.supplier_tax_id ?? null

  // Proveedor por NIF, luego por nombre normalizado (mismo criterio que recepción).
  const { data: sups } = await from('supplier')
    .select('id, name, tax_id')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const suppliers = (sups as Row[] | null) ?? []
  let supplierId = ''
  const nif = normNifLocal(commercialNif)
  if (nif.length > 0) {
    const hit = suppliers.find(s => normNifLocal(s.tax_id as string | null) === nif)
    if (hit) supplierId = hit.id as string
  }
  if (!supplierId && commercialName) {
    const n = normTextLocal(commercialName)
    const hit = suppliers.find(s => normTextLocal(s.name as string | null) === n)
    if (hit) supplierId = hit.id as string
  }

  // Tipo de documento: si el OCR detecta nota de crédito/abono lo marca; por defecto factura.
  const docKind: SupplierInvoiceDocKind = 'invoice'

  // Albaranes sin facturar del proveedor (sugeridos para enlazar).
  let suggestedReceiptIds: string[] = []
  if (supplierId) {
    const uninvoiced = await listUninvoicedReceipts(accountId, supplierId)
    suggestedReceiptIds = uninvoiced.map(r => r.id)
  }

  return {
    supplierId,
    proposedSupplierName: commercialName,
    proposedSupplierNif: commercialNif,
    locationId: '',
    invoiceNumber: doc.doc_number ?? null,
    invoiceDate: doc.doc_date ?? new Date().toISOString().slice(0, 10),
    docKind,
    taxBaseTotal: doc.tax_base_total ?? null,
    taxTotal: doc.tax_total ?? null,
    grandTotal: doc.grand_total ?? null,
    unmatchedSupplier: !supplierId,
    suggestedReceiptIds,
  }
}

/** ¿Ya existe una factura del mismo proveedor con el mismo nº (no anulada)? (anti-duplicado) */
export interface DuplicateInvoiceHit { id: string; code: string | null; status: SupplierInvoiceStatus }
export async function findDuplicateInvoice(
  accountId: string, supplierId: string | null, invoiceNumber: string | null,
): Promise<DuplicateInvoiceHit | null> {
  if (!supplierId || !invoiceNumber || invoiceNumber.trim() === '') return null
  requireSupabase()
  const { data, error } = await from('supplier_invoice')
    .select('id, code, status')
    .eq('account_id', accountId)
    .eq('supplier_id', supplierId)
    .eq('invoice_number', invoiceNumber.trim())
    .neq('status', 'anulada')
    .limit(1)
  if (error) { console.error('[supplierInvoiceService] findDuplicateInvoice', error); return null }
  const rows = (data as Row[] | null) ?? []
  if (rows.length === 0) return null
  return { id: rows[0].id as string, code: (rows[0].code as string | null) ?? null, status: rows[0].status as SupplierInvoiceStatus }
}

/** Prefill OCR para el alta de factura (lo consume SupplierInvoicesPage). */
export interface InvoiceOcrPrefill {
  aiSessionId: string
  supplierId: string
  proposedSupplierName: string | null
  proposedSupplierNif: string | null
  unmatchedSupplier: boolean
  invoiceNumber: string | null
  invoiceDate: string
  docKind: SupplierInvoiceDocKind
  taxBaseTotal: number | null
  taxTotal: number | null
  grandTotal: number | null
  rawDocumentUrl: string | null
  suggestedReceiptIds: string[]
  lines: {
    rawText: string
    supplierCode: string | null
    qty: number | null
    unitPrice: number | null
    lineAmount: number | null
    vatPct: number | null
  }[]
}

/** Construye el prefill de factura a partir del resultado OCR + cabecera resuelta. */
export function buildInvoiceOcrPrefill(
  sessionId: string,
  filePath: string | null,
  header: ResolvedInvoiceHeader,
  lines: OcrLine[],
): InvoiceOcrPrefill {
  return {
    aiSessionId: sessionId,
    supplierId: header.supplierId,
    proposedSupplierName: header.proposedSupplierName,
    proposedSupplierNif: header.proposedSupplierNif,
    unmatchedSupplier: header.unmatchedSupplier,
    invoiceNumber: header.invoiceNumber,
    invoiceDate: header.invoiceDate,
    docKind: header.docKind,
    taxBaseTotal: header.taxBaseTotal,
    taxTotal: header.taxTotal,
    grandTotal: header.grandTotal,
    rawDocumentUrl: filePath,
    suggestedReceiptIds: header.suggestedReceiptIds,
    lines: lines.map(l => ({
      rawText: l.raw_text,
      supplierCode: l.supplier_code,
      qty: l.quantity,
      unitPrice: l.unit_price_net,
      lineAmount: l.line_amount,
      vatPct: l.vat_pct,
    })),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// C3.3 — Three-way match: ejecutar el motor, aprobar, marcar discrepancia.
// ════════════════════════════════════════════════════════════════════════════

export interface InvoiceMatchSummary {
  matchStatus: SupplierInvoiceMatchStatus
  total: number
  ok: number
  diffPrice: number
  diffQty: number
  notReceived: number
  vatBad: number
  unmatched: number
}

/** Ejecuta el motor three-way (run_invoice_match). Escribe veredictos por línea + cabecera. */
export async function runInvoiceMatch(invoiceId: string): Promise<InvoiceMatchSummary> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('run_invoice_match', { p_invoice_id: invoiceId })
  if (error) throw new Error(`Error al cuadrar la factura: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Row | null
  return {
    matchStatus: (r?.match_status as SupplierInvoiceMatchStatus) ?? 'sin_match',
    total: Number(r?.lines_total ?? 0),
    ok: Number(r?.lines_ok ?? 0),
    diffPrice: Number(r?.lines_diff_price ?? 0),
    diffQty: Number(r?.lines_diff_qty ?? 0),
    notReceived: Number(r?.lines_not_received ?? 0),
    vatBad: Number(r?.lines_vat_bad ?? 0),
    unmatched: Number(r?.lines_unmatched ?? 0),
  }
}

/** Aprueba la factura (registra quién/cuándo — audit). El eslabón coste es C3.4. */
export async function approveInvoice(
  invoiceId: string, approvedBy: string | null, approvedByName: string | null,
): Promise<void> {
  requireSupabase()
  const { error } = await from('supplier_invoice')
    .update({
      status: 'aprobada',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      approved_by_name: approvedByName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
  if (error) throw new Error(`No se pudo aprobar: ${error.message}`)
}

/** Marca la factura como con discrepancias (pendiente de reclamar al proveedor). */
export async function markInvoiceDiscrepancy(invoiceId: string): Promise<void> {
  requireSupabase()
  const { error } = await from('supplier_invoice')
    .update({ status: 'con_discrepancias', updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) throw new Error(`No se pudo marcar: ${error.message}`)
}

/** Etiqueta legible para un veredicto de línea. */
export function matchResultLabel(r: string | null): { label: string; cls: string } | null {
  switch (r) {
    case 'ok': return { label: 'OK', cls: 'bg-success-bg text-success border-success/20' }
    case 'diferencia_precio': return { label: 'Precio', cls: 'bg-warning-bg text-warning border-warning/20' }
    case 'diferencia_cantidad': return { label: 'Cantidad', cls: 'bg-warning-bg text-warning border-warning/20' }
    case 'no_recibido': return { label: 'No recibido', cls: 'bg-danger-bg text-danger border-danger/20' }
    case 'iva_no_cuadra': return { label: 'IVA', cls: 'bg-warning-bg text-warning border-warning/20' }
    case 'sin_casar': return { label: 'Sin casar', cls: 'bg-page text-text-tertiary border-border-default' }
    default: return null
  }
}
