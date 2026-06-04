// src/modules/supply/services/goodsReceiptService.ts
//
// Service de la RECEPCIÓN de albarán (C2): goods_receipt + goods_receipt_line,
// más las llamadas a los RPC del LIBRO MAYOR (confirm/void) y el ripple de coste.
// Scope cuenta. Sigue el patrón de purchaseOrderService (mappers snake↔camel,
// requireSupabase, from() casteado para tablas; RPC tipado para el ledger).
//
// Modelo (diseño v2 aprobado):
//   · El ledger (stock_movement) es la ÚNICA verdad del stock. Esta capa NO
//     escribe stock a mano: postea SIEMPRE vía confirm_goods_receipt (SECURITY
//     DEFINER), que se ejecuta DESDE LA APP (con sesión).
//   · ANTI-INVENCIÓN: una línea solo entra a stock si tiene recipe_item_id Y
//     qty_in_base resueltos. qty_in_base = qty_received × format.qty_in_base
//     (el formato encierra la conversión a base). Sin formato/conversión → null
//     → confirm la salta y marca el albarán needs_review.
//   · RIPPLE al margen: confirm_goods_receipt actualiza last_price y el trigger
//     recalcula el coste del RAW dentro de la transacción; aquí, tras el RPC,
//     cascadeFromItem propaga RAW→platos (reusa la maquinaria de Kitchen, no la
//     duplica) → menu_item_economics refleja el nuevo margen por marca/canal.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import { cascadeFromItem } from '@/modules/kitchen/services/costCascadeService'

// ── Tipos de dominio (camelCase) ──
export type GoodsReceiptStatus = 'borrador' | 'confirmado' | 'anulado'
export type GoodsReceiptSource = 'manual' | 'ocr'

export interface GoodsReceipt {
  id: string
  accountId: string
  locationId: string
  supplierId: string | null
  purchaseOrderId: string | null
  code: string | null
  supplierDocNumber: string | null
  receiptDate: string
  receivedAt: string | null
  status: GoodsReceiptStatus
  source: GoodsReceiptSource
  rawDocumentUrl: string | null
  aiConfidence: number | null
  needsReview: boolean
  notes: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}

export interface GoodsReceiptLine {
  id: string
  accountId: string
  goodsReceiptId: string
  purchaseOrderLineId: string | null
  recipeItemId: string | null
  productName: string
  rawText: string | null
  qtyReceived: number
  purchaseUnitId: string | null
  purchaseFormatId: string | null
  qtyInBase: number | null
  unitCost: number | null
  lotCode: string | null
  expiryDate: string | null
  mapSource: string | null
  mapConfidence: number | null
  mapNeedsReview: boolean
  position: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface GoodsReceiptInsert {
  accountId: string
  locationId: string
  supplierId?: string | null
  purchaseOrderId?: string | null
  supplierDocNumber?: string | null
  receiptDate?: string
  receivedAt?: string | null
  status?: GoodsReceiptStatus
  source?: GoodsReceiptSource
  rawDocumentUrl?: string | null
  aiConfidence?: number | null
  needsReview?: boolean
  notes?: string | null
  createdBy?: string | null
  createdByName?: string | null
}

export interface GoodsReceiptUpdate {
  supplierId?: string | null
  supplierDocNumber?: string | null
  receiptDate?: string
  receivedAt?: string | null
  status?: GoodsReceiptStatus
  notes?: string | null
  needsReview?: boolean
  isActive?: boolean
  archivedAt?: string | null
}

export interface GoodsReceiptLineInsert {
  accountId: string
  goodsReceiptId: string
  purchaseOrderLineId?: string | null
  recipeItemId?: string | null
  productName: string
  rawText?: string | null
  qtyReceived: number
  purchaseUnitId?: string | null
  purchaseFormatId?: string | null
  qtyInBase?: number | null
  unitCost?: number | null
  lotCode?: string | null
  expiryDate?: string | null
  mapSource?: string | null
  mapConfidence?: number | null
  mapNeedsReview?: boolean
  position?: number
  notes?: string | null
}

export interface GoodsReceiptLineUpdate {
  recipeItemId?: string | null
  productName?: string
  qtyReceived?: number
  purchaseUnitId?: string | null
  purchaseFormatId?: string | null
  qtyInBase?: number | null
  unitCost?: number | null
  lotCode?: string | null
  expiryDate?: string | null
  mapSource?: string | null
  mapConfidence?: number | null
  mapNeedsReview?: boolean
  position?: number
  notes?: string | null
}

export interface ConfirmReceiptResult {
  postedLines: number       // líneas posteadas al ledger
  skippedLines: number      // líneas saltadas (sin mapear/sin conversión → needs_review)
  recalculatedItems: number // ingredientes cuyo coste se propagó a platos (ripple)
}

// ── Snapshot de stock por (artículo, local) — lectura para feedback/UI ──
export interface LocationStock {
  recipeItemId: string
  locationId: string
  qtyOnHand: number
  avgUnitCost: number | null
  stockValue: number
  updatedAt: string
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

// Acceso a tablas con el mismo patrón acotado de purchaseOrderService.
function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// ── Mappers ──
function rowToReceipt(row: Row): GoodsReceipt {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    locationId: row.location_id as string,
    supplierId: (row.supplier_id as string | null) ?? null,
    purchaseOrderId: (row.purchase_order_id as string | null) ?? null,
    code: (row.code as string | null) ?? null,
    supplierDocNumber: (row.supplier_doc_number as string | null) ?? null,
    receiptDate: row.receipt_date as string,
    receivedAt: (row.received_at as string | null) ?? null,
    status: row.status as GoodsReceiptStatus,
    source: row.source as GoodsReceiptSource,
    rawDocumentUrl: (row.raw_document_url as string | null) ?? null,
    aiConfidence: (row.ai_confidence as number | null) ?? null,
    needsReview: Boolean(row.needs_review),
    notes: (row.notes as string | null) ?? null,
    isActive: Boolean(row.is_active),
    archivedAt: (row.archived_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
  }
}

function rowToReceiptLine(row: Row): GoodsReceiptLine {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    goodsReceiptId: row.goods_receipt_id as string,
    purchaseOrderLineId: (row.purchase_order_line_id as string | null) ?? null,
    recipeItemId: (row.recipe_item_id as string | null) ?? null,
    productName: row.product_name as string,
    rawText: (row.raw_text as string | null) ?? null,
    qtyReceived: Number(row.qty_received),
    purchaseUnitId: (row.purchase_unit_id as string | null) ?? null,
    purchaseFormatId: (row.purchase_format_id as string | null) ?? null,
    qtyInBase: row.qty_in_base === null || row.qty_in_base === undefined ? null : Number(row.qty_in_base),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    lotCode: (row.lot_code as string | null) ?? null,
    expiryDate: (row.expiry_date as string | null) ?? null,
    mapSource: (row.map_source as string | null) ?? null,
    mapConfidence: (row.map_confidence as number | null) ?? null,
    mapNeedsReview: Boolean(row.map_needs_review),
    position: (row.position as number) ?? 0,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function receiptInsertToRow(input: GoodsReceiptInsert): Row {
  return {
    account_id: input.accountId,
    location_id: input.locationId,
    supplier_id: input.supplierId ?? null,
    purchase_order_id: input.purchaseOrderId ?? null,
    supplier_doc_number: input.supplierDocNumber ?? null,
    receipt_date: input.receiptDate ?? undefined,
    received_at: input.receivedAt ?? null,
    status: input.status ?? 'borrador',
    source: input.source ?? 'manual',
    raw_document_url: input.rawDocumentUrl ?? null,
    ai_confidence: input.aiConfidence ?? null,
    needs_review: input.needsReview ?? false,
    notes: input.notes ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function receiptUpdateToRow(patch: GoodsReceiptUpdate): Row {
  const row: Row = {}
  if (patch.supplierId !== undefined) row.supplier_id = patch.supplierId
  if (patch.supplierDocNumber !== undefined) row.supplier_doc_number = patch.supplierDocNumber
  if (patch.receiptDate !== undefined) row.receipt_date = patch.receiptDate
  if (patch.receivedAt !== undefined) row.received_at = patch.receivedAt
  if (patch.status !== undefined) row.status = patch.status
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.needsReview !== undefined) row.needs_review = patch.needsReview
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

function lineInsertToRow(input: GoodsReceiptLineInsert): Row {
  return {
    account_id: input.accountId,
    goods_receipt_id: input.goodsReceiptId,
    purchase_order_line_id: input.purchaseOrderLineId ?? null,
    recipe_item_id: input.recipeItemId ?? null,
    product_name: input.productName,
    raw_text: input.rawText ?? null,
    qty_received: input.qtyReceived,
    purchase_unit_id: input.purchaseUnitId ?? null,
    purchase_format_id: input.purchaseFormatId ?? null,
    qty_in_base: input.qtyInBase ?? null,
    unit_cost: input.unitCost ?? null,
    lot_code: input.lotCode ?? null,
    expiry_date: input.expiryDate ?? null,
    map_source: input.mapSource ?? null,
    map_confidence: input.mapConfidence ?? null,
    map_needs_review: input.mapNeedsReview ?? false,
    position: input.position ?? 0,
    notes: input.notes ?? null,
  }
}

function lineUpdateToRow(patch: GoodsReceiptLineUpdate): Row {
  const row: Row = {}
  if (patch.recipeItemId !== undefined) row.recipe_item_id = patch.recipeItemId
  if (patch.productName !== undefined) row.product_name = patch.productName
  if (patch.qtyReceived !== undefined) row.qty_received = patch.qtyReceived
  if (patch.purchaseUnitId !== undefined) row.purchase_unit_id = patch.purchaseUnitId
  if (patch.purchaseFormatId !== undefined) row.purchase_format_id = patch.purchaseFormatId
  if (patch.qtyInBase !== undefined) row.qty_in_base = patch.qtyInBase
  if (patch.unitCost !== undefined) row.unit_cost = patch.unitCost
  if (patch.lotCode !== undefined) row.lot_code = patch.lotCode
  if (patch.expiryDate !== undefined) row.expiry_date = patch.expiryDate
  if (patch.mapSource !== undefined) row.map_source = patch.mapSource
  if (patch.mapConfidence !== undefined) row.map_confidence = patch.mapConfidence
  if (patch.mapNeedsReview !== undefined) row.map_needs_review = patch.mapNeedsReview
  if (patch.position !== undefined) row.position = patch.position
  if (patch.notes !== undefined) row.notes = patch.notes
  return row
}

/**
 * Cantidad en unidad BASE para un movimiento de stock, a partir de la cantidad
 * recibida (en formato de compra) y la equivalencia del formato a base.
 * "2 Sacos × 5000 g/saco = 10000 g". Devuelve null si no hay equivalencia
 * utilizable → la línea quedará needs_review y NO entrará a stock (anti-invención).
 */
export function qtyInBaseFromFormat(
  qtyReceived: number,
  formatQtyInBase: number | null,
): number | null {
  if (!Number.isFinite(qtyReceived) || qtyReceived <= 0) return null
  if (formatQtyInBase === null || !Number.isFinite(formatQtyInBase) || formatQtyInBase <= 0) return null
  return qtyReceived * formatQtyInBase
}

// ── Recibido acumulado por línea de pedido (para la recepción anti-error) ──
//
// Suma qty_received de las recepciones CONFIRMADAS de un pedido, agrupada por
// purchase_order_line_id. Permite mostrar "Ya recibido" y "Pendiente" como
// REFERENCIA (la celda de recibido nace vacía; nunca se precarga). Mismas
// unidades que qty_ordered (formato de la línea). No cuenta borradores ni
// anuladas. excludeReceiptId descuenta una recepción concreta (al "anular y
// corregir", para no contar la que se va a sustituir).
export interface OrderLineReceived {
  purchaseOrderLineId: string
  receivedConfirmed: number
}

export async function listOrderLineReceived(
  purchaseOrderId: string,
  opts?: { excludeReceiptId?: string },
): Promise<OrderLineReceived[]> {
  requireSupabase()

  // 1) Recepciones CONFIRMADAS de este pedido.
  const { data: receipts, error: rErr } = await from('goods_receipt')
    .select('id')
    .eq('purchase_order_id', purchaseOrderId)
    .eq('status', 'confirmado')
  if (rErr) throw new Error(`Error calculando recibido del pedido: ${rErr.message}`)

  let ids = ((receipts as Row[]) ?? []).map(r => r.id as string)
  if (opts?.excludeReceiptId) ids = ids.filter(id => id !== opts.excludeReceiptId)
  if (ids.length === 0) return []

  // 2) Líneas de esas recepciones, agrupadas por línea de pedido.
  const { data: lines, error: lErr } = await from('goods_receipt_line')
    .select('purchase_order_line_id, qty_received')
    .in('goods_receipt_id', ids)
    .not('purchase_order_line_id', 'is', null)
  if (lErr) throw new Error(`Error calculando recibido del pedido: ${lErr.message}`)

  const acc = new Map<string, number>()
  for (const row of (lines as Row[]) ?? []) {
    const polId = row.purchase_order_line_id as string
    acc.set(polId, (acc.get(polId) ?? 0) + (Number(row.qty_received) || 0))
  }
  return Array.from(acc.entries()).map(([purchaseOrderLineId, receivedConfirmed]) => ({
    purchaseOrderLineId,
    receivedConfirmed,
  }))
}

// ── Recepciones (cabecera) ──
export interface ListGoodsReceiptsOptions {
  accountId: string
  status?: GoodsReceiptStatus
  locationId?: string
  includeArchived?: boolean
}

export async function listGoodsReceipts(
  opts: ListGoodsReceiptsOptions
): Promise<GoodsReceipt[]> {
  requireSupabase()
  let query = from('goods_receipt')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('receipt_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (opts.status) query = query.eq('status', opts.status)
  if (opts.locationId) query = query.eq('location_id', opts.locationId)
  if (!opts.includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) throw new Error(`Error listando recepciones: ${error.message}`)
  return ((data as Row[]) ?? []).map(rowToReceipt)
}

export async function getGoodsReceiptById(id: string): Promise<GoodsReceipt | null> {
  requireSupabase()
  const { data, error } = await from('goods_receipt')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Error obteniendo recepción ${id}: ${error.message}`)
  return data ? rowToReceipt(data as Row) : null
}

export async function createGoodsReceipt(input: GoodsReceiptInsert): Promise<GoodsReceipt> {
  requireSupabase()
  const { data, error } = await from('goods_receipt')
    .insert(receiptInsertToRow(input))
    .select('*')
    .single()
  if (error) throw new Error(`Error creando recepción: ${error.message}`)
  return rowToReceipt(data as Row)
}

export async function updateGoodsReceipt(
  id: string,
  patch: GoodsReceiptUpdate,
): Promise<GoodsReceipt> {
  requireSupabase()
  const rowPatch = receiptUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getGoodsReceiptById(id)
    if (!current) throw new Error(`Recepción ${id} no encontrada.`)
    return current
  }
  const { data, error } = await from('goods_receipt')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`Error actualizando recepción ${id}: ${error.message}`)
  return rowToReceipt(data as Row)
}

export async function archiveGoodsReceipt(id: string): Promise<GoodsReceipt> {
  requireSupabase()
  const { data, error } = await from('goods_receipt')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`Error archivando recepción ${id}: ${error.message}`)
  return rowToReceipt(data as Row)
}

// ── Líneas ──
export async function listGoodsReceiptLines(receiptId: string): Promise<GoodsReceiptLine[]> {
  requireSupabase()
  const { data, error } = await from('goods_receipt_line')
    .select('*')
    .eq('goods_receipt_id', receiptId)
    .order('position', { ascending: true })
  if (error) throw new Error(`Error listando líneas de la recepción: ${error.message}`)
  return ((data as Row[]) ?? []).map(rowToReceiptLine)
}

export async function createGoodsReceiptLine(
  input: GoodsReceiptLineInsert,
): Promise<GoodsReceiptLine> {
  requireSupabase()
  const { data, error } = await from('goods_receipt_line')
    .insert(lineInsertToRow(input))
    .select('*')
    .single()
  if (error) throw new Error(`Error creando línea de recepción: ${error.message}`)
  return rowToReceiptLine(data as Row)
}

export async function updateGoodsReceiptLine(
  id: string,
  patch: GoodsReceiptLineUpdate,
): Promise<GoodsReceiptLine> {
  requireSupabase()
  const rowPatch = lineUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const lines = await from('goods_receipt_line').select('*').eq('id', id).maybeSingle()
    if (lines.error) throw new Error(`Error obteniendo línea ${id}: ${lines.error.message}`)
    return rowToReceiptLine(lines.data as Row)
  }
  const { data, error } = await from('goods_receipt_line')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`Error actualizando línea ${id}: ${error.message}`)
  return rowToReceiptLine(data as Row)
}

export async function deleteGoodsReceiptLine(id: string): Promise<void> {
  requireSupabase()
  const { error } = await from('goods_receipt_line').delete().eq('id', id)
  if (error) throw new Error(`Error borrando línea ${id}: ${error.message}`)
}

// ── Ciclo del ledger (RPC SECURITY DEFINER; se ejecutan DESDE LA APP) ──

/**
 * Confirma la recepción: postea las entradas al ledger (solo líneas con artículo
 * y qty_in_base resueltos — anti-invención), refresca el snapshot y, si la línea
 * trae precio, actualiza last_price. Luego propaga el coste RAW→platos
 * (cascadeFromItem) para que el margen por marca/canal refleje el cambio.
 */
export async function confirmReceipt(receiptId: string): Promise<ConfirmReceiptResult> {
  requireSupabase()

  // 1) Postear al ledger (atómico, server-side).
  const { data, error } = await supabase!.rpc('confirm_goods_receipt', {
    p_receipt_id: receiptId,
  })
  if (error) throw new Error(`Error confirmando la recepción: ${error.message}`)

  const row = (Array.isArray(data) ? data[0] : data) as
    { posted_lines?: number; skipped_lines?: number } | null
  const postedLines = Number(row?.posted_lines ?? 0)
  const skippedLines = Number(row?.skipped_lines ?? 0)

  // 2) Ripple de coste al margen: solo para líneas con artículo y precio.
  //    El RPC ya recalculó el RAW (trigger); aquí propagamos RAW→platos.
  //    Fail-safe: un fallo de cascada NO revierte el posteo (el stock ya entró).
  let recalculatedItems = 0
  try {
    const lines = await listGoodsReceiptLines(receiptId)
    const itemIds = Array.from(
      new Set(
        lines
          .filter(l => l.recipeItemId && l.unitCost !== null && l.purchaseFormatId)
          .map(l => l.recipeItemId as string),
      ),
    )
    for (const itemId of itemIds) {
      try {
        await cascadeFromItem(itemId)
        recalculatedItems++
      } catch (e) {
        console.error(`confirmReceipt: cascada de coste falló para ${itemId}`, e)
      }
    }
  } catch (e) {
    console.error('confirmReceipt: no se pudo propagar el coste tras confirmar', e)
  }

  return { postedLines, skippedLines, recalculatedItems }
}

/**
 * Anula una recepción confirmada: postea el reverso de cada movimiento (mismo
 * coste sellado) y refresca el snapshot. El ledger es append-only: no borra nada.
 * No revierte last_price (el precio observado fue real); por eso no cascadea coste.
 */
export async function voidReceipt(receiptId: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('void_goods_receipt', {
    p_receipt_id: receiptId,
  })
  if (error) throw new Error(`Error anulando la recepción: ${error.message}`)
  return Number(data ?? 0)
}

// ── Snapshot de stock (lectura) ──
export async function listLocationStock(
  accountId: string,
  locationId?: string,
): Promise<LocationStock[]> {
  requireSupabase()
  let query = from('recipe_item_location_stock')
    .select('recipe_item_id, location_id, qty_on_hand, avg_unit_cost, stock_value, updated_at')
    .eq('account_id', accountId)
  if (locationId) query = query.eq('location_id', locationId)

  const { data, error } = await query
  if (error) throw new Error(`Error cargando el stock: ${error.message}`)
  return ((data as Row[]) ?? []).map(r => ({
    recipeItemId: r.recipe_item_id as string,
    locationId: r.location_id as string,
    qtyOnHand: Number(r.qty_on_hand),
    avgUnitCost: r.avg_unit_cost === null || r.avg_unit_cost === undefined ? null : Number(r.avg_unit_cost),
    stockValue: Number(r.stock_value),
    updatedAt: r.updated_at as string,
  }))
}

// ── C2.2 OCR de albarán: subida de fichero(s) + llamada a la Edge Function ──
//
// Flujo a-1: el usuario elige foto(s)/PDF → se suben al bucket privado
// receipt-uploads/{accountId}/{carpeta}/... → se llama a ocr-albaran (visión) →
// devuelve lo leído (cabecera + líneas) + validación por base imponible. NO
// materializa recepción todavía (eso es a-2). La carpeta empieza por accountId
// porque las políticas RLS del bucket lo exigen (foldername[1] = account_id).

export interface OcrLine {
  raw_text: string
  supplier_code: string | null
  quantity: number | null
  unit: string | null
  unit_price_net: number | null
  discount_pct: number | null
  line_amount: number | null
  vat_pct: number | null
  lot_code: string | null
  expiry_date: string | null
  note: string | null
}

export interface OcrDocument {
  supplier_name: string | null
  supplier_tax_id: string | null
  doc_number: string | null
  doc_date: string | null
  doc_type: 'albaran' | 'factura' | 'albaran_factura' | null
  ship_to: string | null
  bill_to_name: string | null
  handwritten: boolean
  tax_base_total: number | null
  tax_total: number | null
  grand_total: number | null
}

export interface OcrValidation {
  base_declared: number | null
  lines_sum: number | null
  diff_pct: number | null
  cuadra: boolean | null
  needs_review: boolean
  reasons: string[]
}

export interface OcrAlbaranResult {
  sessionId: string
  status: string
  document: OcrDocument
  lines: OcrLine[]
  confidence: number
  validation: OcrValidation
  filePaths: string[]
  aiModel: string | null
  aiLatencyMs: number | null
}

const RECEIPT_BUCKET = 'receipt-uploads'

function sanitizeFileName(name: string): string {
  // Quita rutas, acentos y caracteres problemáticos para la clave del objeto.
  const base = name.split(/[\\/]/).pop() ?? 'archivo'
  return base
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120)
}

/**
 * Sube uno o varios ficheros (foto/PDF) del albarán al bucket privado y
 * devuelve sus rutas. Todos van bajo una misma carpeta {accountId}/{uuid}/
 * para que ocr-albaran los trate como un único documento (multipágina).
 */
export async function uploadReceiptFiles(accountId: string, files: File[]): Promise<string[]> {
  requireSupabase()
  if (files.length === 0) return []
  const folder = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
  const paths: string[] = []
  for (const file of files) {
    const path = `${accountId}/${folder}/${sanitizeFileName(file.name)}`
    const { error } = await supabase!.storage
      .from(RECEIPT_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (error) throw new Error(`No se pudo subir ${file.name}: ${error.message}`)
    paths.push(path)
  }
  return paths
}

/**
 * Llama a la Edge Function ocr-albaran con las rutas ya subidas. El JWT del
 * usuario lo adjunta supabase-js automáticamente (la función respeta RLS).
 */
export async function runOcrAlbaran(accountId: string, filePaths: string[]): Promise<OcrAlbaranResult> {
  requireSupabase()
  const { data, error } = await supabase!.functions.invoke('ocr-albaran', {
    body: { account_id: accountId, file_paths: filePaths },
  })
  if (error) throw new Error(`Error leyendo el albarán: ${error.message}`)
  const d = data as {
    session_id: string; status: string
    parsed: { document: OcrDocument; lines: OcrLine[]; confidence: number }
    validation: OcrValidation; ai_model?: string | null; ai_latency_ms?: number | null
  }
  return {
    sessionId: d.session_id,
    status: d.status,
    document: d.parsed.document,
    lines: d.parsed.lines ?? [],
    confidence: d.parsed.confidence,
    validation: d.validation,
    filePaths,
    aiModel: d.ai_model ?? null,
    aiLatencyMs: d.ai_latency_ms ?? null,
  }
}

/**
 * Conveniencia: sube y lee en un paso.
 */
export async function scanReceipt(accountId: string, files: File[]): Promise<OcrAlbaranResult> {
  const paths = await uploadReceiptFiles(accountId, files)
  return runOcrAlbaran(accountId, paths)
}
