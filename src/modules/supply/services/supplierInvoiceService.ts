// src/modules/supply/services/supplierInvoiceService.ts
//
// Folvy Supply C3 — Factura de proveedor (three-way match).
// C3.1: modelo + CRUD + alta manual. La factura cierra el ciclo de compra
// (pedido → recepción → FACTURA) y es el documento que confirma el coste.
// NO mueve stock (eso lo hizo la recepción); en C3.4 ajustará coste al aprobar.
//
// Patrón calcado de supplierCatalogService / goodsReceiptService.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

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
    .select('id, supplier_invoice_id, recipe_item_id, raw_text, supplier_code, qty, unit_price, line_amount, vat_pct, vat_category_id, goods_receipt_line_id, match_result, position, recipe_item:recipe_item_id ( name )')
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
