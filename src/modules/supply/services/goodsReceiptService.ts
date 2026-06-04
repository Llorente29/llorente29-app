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
  deliveredBy: string | null
  aiSessionId: string | null
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
  deliveredBy?: string | null
  aiSessionId?: string | null
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
  supplierCode?: string | null
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
    deliveredBy: (row.delivered_by as string | null) ?? null,
    aiSessionId: (row.ai_session_id as string | null) ?? null,
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
    delivered_by: input.deliveredBy ?? null,
    ai_session_id: input.aiSessionId ?? null,
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
    supplier_code: input.supplierCode ?? null,
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
const RECEIPT_SIGNED_TTL = 3600

function sanitizeFileName(name: string): string {
  // Quita rutas, acentos y caracteres problemáticos para la clave del objeto.
  const base = name.split(/[\\/]/).pop() ?? 'archivo'
  return base
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120)
}

// Comprime una imagen en el navegador (mismo patrón que recipePhotoService /
// APPCC: 1600px, calidad 0.72). Las fotos de albarán de móvil son densas y
// conviene subirlas comprimidas (más rápido, menos coste de lectura). Para el
// OCR interesa algo más de resolución que en una foto de plato (texto pequeño),
// por eso 1600px en vez de 1200. Los PDF NO se comprimen (se suben tal cual).
function compressImage(file: File, maxWidthPx = 1600, quality = 0.72): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height
      if (w > maxWidthPx) { h = Math.round(h * (maxWidthPx / w)); w = maxWidthPx }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No se pudo procesar la imagen (canvas).')); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.'))),
        'image/jpeg', quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen.')) }
    img.src = url
  })
}

/**
 * Sube uno o varios ficheros (foto/PDF) del albarán al bucket privado y
 * devuelve sus rutas. Todos van bajo una misma carpeta {accountId}/{uuid}/
 * para que ocr-albaran los trate como un único documento (multipágina).
 * Las imágenes se comprimen en cliente; los PDF se suben sin tocar.
 */
export async function uploadReceiptFiles(accountId: string, files: File[]): Promise<string[]> {
  requireSupabase()
  if (files.length === 0) return []
  const folder = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
  const paths: string[] = []
  let i = 0
  for (const file of files) {
    const isPdf = file.type === 'application/pdf'
    let payload: Blob = file
    let nameOut = sanitizeFileName(file.name)
    let contentType = file.type || undefined
    if (!isPdf && file.type.startsWith('image/')) {
      payload = await compressImage(file)
      contentType = 'image/jpeg'
      // Normaliza el nombre a .jpg tras recomprimir (y antepone índice para el orden).
      nameOut = `${String(i).padStart(2, '0')}-${nameOut.replace(/\.[^.]+$/, '')}.jpg`
    } else {
      nameOut = `${String(i).padStart(2, '0')}-${nameOut}`
    }
    const path = `${accountId}/${folder}/${nameOut}`
    const { error } = await supabase!.storage
      .from(RECEIPT_BUCKET)
      .upload(path, payload, { contentType, upsert: false })
    if (error) throw new Error(`No se pudo subir ${file.name}: ${error.message}`)
    paths.push(path)
    i++
  }
  return paths
}

/**
 * URL firmada temporal para mostrar una foto/PDF del albarán (bucket privado).
 * Devuelve null si falla (la UI mostrará un aviso). Clon de getDishPhotoUrl.
 */
export async function getReceiptFileUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  requireSupabase()
  const { data, error } = await supabase!.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, RECEIPT_SIGNED_TTL)
  if (error) {
    console.error('[goodsReceiptService] createSignedUrl error', error)
    return null
  }
  return data?.signedUrl ?? null
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

// ── C2.2.a-2: resolución de cabecera desde lo leído por el OCR ──
//
// Proveedor COMERCIAL ≠ quien entrega. Si bill_to difiere del emisor y parece
// otra empresa (intermediario tipo Joan/Bidfood → Cloudtown), el proveedor es
// bill_to y el emisor se guarda como "entregado por". Casado: por NIF del emisor
// cuando NO hay intermediario (caso normal: Europastry, Makro), si no por nombre.
// (Con intermediario no tenemos el NIF del comercial → casa por nombre; si no
// existe, queda sin casar y se crea en b.)
// Local: por DIRECCIÓN (los nombres del albarán no coinciden con los de Folvy),
// si no por nombre.

export interface ResolvedReceiptHeader {
  supplierId: string            // '' si no casó
  commercialSupplierName: string | null
  deliveredBy: string | null    // emisor cuando difiere del comercial
  locationId: string            // '' si no casó
  supplierDocNumber: string | null
  receiptDate: string           // YYYY-MM-DD (doc_date o hoy)
  unmatchedSupplier: boolean
  unmatchedLocation: boolean
}

function normText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function normNif(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
// Firma de dirección: dígitos (nº/CP) + tokens de calle, para casar "Cañaveral 75"
// del albarán con la dirección del local aunque el nombre no coincida.
function addrSignature(s: string | null | undefined): string {
  return normText(s).replace(/\b(calle|c|cl|avda|avenida|paseo|po|local|piso|bajo|nº|num|numero)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

export async function resolveReceiptHeader(
  accountId: string,
  doc: OcrDocument,
): Promise<ResolvedReceiptHeader> {
  requireSupabase()

  // DECISIÓN (04/06): el proveedor es quien EMITE el albarán (Makro, Europastry,
  // Joan…), casado por NIF → nombre. NO se adivina el intermediario desde bill_to
  // (heurística frágil: confundía al cliente con un intermediario y descartaba el
  // NIF). El caso Cloudtown (Joan entrega EN NOMBRE DE Cloudtown) se APRENDE en b:
  // la 1ª vez se propone el emisor, el humano lo corrige a Cloudtown + "entregado
  // por Joan", y se recuerda (memoria de intermediario por emisor → comercial).
  // bill_to queda guardado en la sesión IA para esa memoria.
  const commercialName = doc.supplier_name ?? null
  const commercialNif = doc.supplier_tax_id ?? null
  const deliveredBy: string | null = null   // lo rellena la memoria de intermediario (b)

  const { data: sups } = await from('supplier')
    .select('id, name, tax_id')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const suppliers = (sups as Row[] | null) ?? []

  let supplierId = ''
  if (commercialNif) {
    const nif = normNif(commercialNif)
    if (nif.length > 0) {
      const hit = suppliers.find(s => normNif(s.tax_id as string | null) === nif)
      if (hit) supplierId = hit.id as string
    }
  }
  if (!supplierId && commercialName) {
    const n = normText(commercialName)
    const hit = suppliers.find(s => {
      const sn = normText(s.name as string)
      return sn === n || (sn.length > 3 && (sn.includes(n) || n.includes(sn)))
    })
    if (hit) supplierId = hit.id as string
  }

  // Local por dirección, luego por nombre.
  const { data: locs } = await from('locations')
    .select('id, name, address')
    .eq('account_id', accountId)
  const locations = (locs as Row[] | null) ?? []

  let locationId = ''
  const shipSig = addrSignature(doc.ship_to)
  if (shipSig) {
    const hit = locations.find(l => {
      const ls = addrSignature(l.address as string | null)
      return ls.length > 2 && (shipSig.includes(ls) || ls.includes(shipSig))
    })
    if (hit) locationId = hit.id as string
  }
  if (!locationId && doc.ship_to) {
    const n = normText(doc.ship_to)
    const hit = locations.find(l => {
      const ln = normText(l.name as string)
      return ln.length > 3 && (n.includes(ln) || ln.includes(n))
    })
    if (hit) locationId = hit.id as string
  }

  return {
    supplierId,
    commercialSupplierName: commercialName,
    deliveredBy,
    locationId,
    supplierDocNumber: doc.doc_number ?? null,
    receiptDate: doc.doc_date ?? new Date().toISOString().slice(0, 10),
    unmatchedSupplier: supplierId === '',
    unmatchedLocation: locationId === '',
  }
}

// ── C2.2.b.1: casado de línea de albarán con la memoria (run_mapping) ──
//
// Reutiliza la RPC run_mapping (cascada: código de proveedor → nombre exacto →
// normalizado → difuso), filtrada a artículos (type='raw'). Devuelve candidatos
// con confianza y semáforo. IA propone; el humano valida al confirmar.

export interface LineMatchCandidate {
  recipeItemId: string
  name: string
  folvyCode: string | null
  confidence: number
  matchType: 'code' | 'name_exact' | 'name_normalized' | 'fuzzy' | string
  semaphore: 'green' | 'yellow'
}

export async function matchReceiptLine(
  accountId: string,
  rawText: string,
  supplierCode: string | null,
  limit = 5,
): Promise<LineMatchCandidate[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('run_mapping', {
    p_account_id: accountId,
    p_text: rawText,
    p_code: supplierCode && supplierCode.trim() !== '' ? supplierCode.trim() : undefined,
    p_limit: limit,
    p_target_types: ['raw'],
  })
  if (error) throw new Error(`Error casando "${rawText}": ${error.message}`)
  const rows = (data as Row[] | null) ?? []
  return rows.map(r => ({
    recipeItemId: r.recipe_item_id as string,
    name: r.name as string,
    folvyCode: (r.folvy_code as string | null) ?? null,
    confidence: Number(r.confidence ?? 0),
    matchType: (r.match_type as string) ?? 'fuzzy',
    semaphore: (r.semaphore as 'green' | 'yellow') ?? 'yellow',
  }))
}

// Etiqueta legible del tipo de casado, para la UI.
export function matchTypeLabel(mt: string): string {
  switch (mt) {
    case 'code': return 'por código'
    case 'name_exact': return 'por nombre'
    case 'name_normalized': return 'por nombre'
    case 'fuzzy': return 'parecido'
    default: return mt
  }
}

// ── C2.2.b.3: aprendizaje al confirmar ──
// Tras confirmar una recepción, graba la memoria por proveedor (article_supplier:
// código + denominación + precio + formato). Devuelve cuántas relaciones aprendió.
// SECURITY DEFINER server-side; se llama desde la app (tiene sesión).
export async function learnFromReceipt(receiptId: string): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('learn_from_receipt', { p_receipt_id: receiptId })
  if (error) throw new Error(`Error guardando la memoria del proveedor: ${error.message}`)
  return (data as number) ?? 0
}
