// src/modules/supply/services/purchaseOrderService.ts
//
// Service CRUD de purchase_order (pedido) + purchase_order_line (líneas).
// Scope cuenta. Sigue el patrón canónico de recipeItemService.ts:
// guard requireSupabase, mappers row<->camelCase, errores con throw.
//
// C1 del ciclo de compra (MRP II). El pedido es USABLE POR SÍ SOLO (origin
// 'manual'). Los ganchos MRP (origin 'par'|'mrp', sourceNeedRef) están en el
// modelo pero no se usan todavía: el MRP se enchufará luego como otra fuente.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ── Tipos de dominio (camelCase) ──
export type PurchaseOrderStatus =
  | 'borrador' | 'enviado' | 'recibido_parcial' | 'recibido' | 'cerrado' | 'cancelado'
export type PurchaseOrderOrigin = 'manual' | 'template' | 'par' | 'mrp'

export interface PurchaseOrder {
  id: string
  accountId: string
  locationId: string | null
  supplierId: string | null
  code: string | null
  orderDate: string
  expectedDate: string | null
  status: PurchaseOrderStatus
  origin: PurchaseOrderOrigin
  sourceNeedRef: string | null
  estSubtotal: number | null
  estTotal: number | null
  currency: string
  notes: string | null
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}

export interface PurchaseOrderLine {
  id: string
  accountId: string
  purchaseOrderId: string
  recipeItemId: string | null
  productName: string
  qtyOrdered: number
  purchaseUnitId: string | null
  purchaseFormatId: string | null
  estUnitPrice: number | null
  estLineTotal: number | null
  position: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface PurchaseOrderInsert {
  accountId: string
  locationId?: string | null
  supplierId?: string | null
  code?: string | null
  orderDate?: string
  expectedDate?: string | null
  status?: PurchaseOrderStatus
  origin?: PurchaseOrderOrigin
  sourceNeedRef?: string | null
  estSubtotal?: number | null
  estTotal?: number | null
  currency?: string
  notes?: string | null
  createdBy?: string | null
  createdByName?: string | null
}

export interface PurchaseOrderUpdate {
  locationId?: string | null
  supplierId?: string | null
  code?: string | null
  orderDate?: string
  expectedDate?: string | null
  status?: PurchaseOrderStatus
  origin?: PurchaseOrderOrigin
  sourceNeedRef?: string | null
  estSubtotal?: number | null
  estTotal?: number | null
  currency?: string
  notes?: string | null
  isActive?: boolean
  archivedAt?: string | null
}

export interface PurchaseOrderLineInsert {
  accountId: string
  purchaseOrderId: string
  recipeItemId?: string | null
  productName: string
  qtyOrdered: number
  purchaseUnitId?: string | null
  purchaseFormatId?: string | null
  estUnitPrice?: number | null
  estLineTotal?: number | null
  position?: number
  notes?: string | null
}

// ── Mappers ──
// Las tablas purchase_order/_line aún no están en los tipos autogenerados
// hasta regenerar database.ts; usamos un acceso laxo a la fila para el mapeo.
type Row = Record<string, unknown>

function rowToPurchaseOrder(row: Row): PurchaseOrder {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    locationId: (row.location_id as string | null) ?? null,
    supplierId: (row.supplier_id as string | null) ?? null,
    code: (row.code as string | null) ?? null,
    orderDate: row.order_date as string,
    expectedDate: (row.expected_date as string | null) ?? null,
    status: row.status as PurchaseOrderStatus,
    origin: row.origin as PurchaseOrderOrigin,
    sourceNeedRef: (row.source_need_ref as string | null) ?? null,
    estSubtotal: (row.est_subtotal as number | null) ?? null,
    estTotal: (row.est_total as number | null) ?? null,
    currency: row.currency as string,
    notes: (row.notes as string | null) ?? null,
    isActive: row.is_active as boolean,
    archivedAt: (row.archived_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
  }
}

function rowToPurchaseOrderLine(row: Row): PurchaseOrderLine {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    purchaseOrderId: row.purchase_order_id as string,
    recipeItemId: (row.recipe_item_id as string | null) ?? null,
    productName: row.product_name as string,
    qtyOrdered: Number(row.qty_ordered),
    purchaseUnitId: (row.purchase_unit_id as string | null) ?? null,
    purchaseFormatId: (row.purchase_format_id as string | null) ?? null,
    estUnitPrice: (row.est_unit_price as number | null) ?? null,
    estLineTotal: (row.est_line_total as number | null) ?? null,
    position: (row.position as number) ?? 0,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function poInsertToRow(input: PurchaseOrderInsert): Row {
  return {
    account_id: input.accountId,
    location_id: input.locationId ?? null,
    supplier_id: input.supplierId ?? null,
    code: input.code ?? null,
    order_date: input.orderDate ?? undefined,
    expected_date: input.expectedDate ?? null,
    status: input.status ?? 'borrador',
    origin: input.origin ?? 'manual',
    source_need_ref: input.sourceNeedRef ?? null,
    est_subtotal: input.estSubtotal ?? null,
    est_total: input.estTotal ?? null,
    currency: input.currency ?? 'EUR',
    notes: input.notes ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  }
}

function poUpdateToRow(patch: PurchaseOrderUpdate): Row {
  const row: Row = {}
  if (patch.locationId !== undefined) row.location_id = patch.locationId
  if (patch.supplierId !== undefined) row.supplier_id = patch.supplierId
  if (patch.code !== undefined) row.code = patch.code
  if (patch.orderDate !== undefined) row.order_date = patch.orderDate
  if (patch.expectedDate !== undefined) row.expected_date = patch.expectedDate
  if (patch.status !== undefined) row.status = patch.status
  if (patch.origin !== undefined) row.origin = patch.origin
  if (patch.sourceNeedRef !== undefined) row.source_need_ref = patch.sourceNeedRef
  if (patch.estSubtotal !== undefined) row.est_subtotal = patch.estSubtotal
  if (patch.estTotal !== undefined) row.est_total = patch.estTotal
  if (patch.currency !== undefined) row.currency = patch.currency
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

function lineInsertToRow(input: PurchaseOrderLineInsert): Row {
  return {
    account_id: input.accountId,
    purchase_order_id: input.purchaseOrderId,
    recipe_item_id: input.recipeItemId ?? null,
    product_name: input.productName,
    qty_ordered: input.qtyOrdered,
    purchase_unit_id: input.purchaseUnitId ?? null,
    purchase_format_id: input.purchaseFormatId ?? null,
    est_unit_price: input.estUnitPrice ?? null,
    est_line_total: input.estLineTotal ?? null,
    position: input.position ?? 0,
    notes: input.notes ?? null,
  }
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// Acceso al cliente con tablas aún no tipadas (database.ts se regenera tras la
// migración; mientras tanto, casteamos el nombre de tabla). Patrón acotado,
// igual que los RPC sin tipar de recipeItemService.
function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

// ── Pedidos ──
export interface ListPurchaseOrdersOptions {
  accountId: string
  status?: PurchaseOrderStatus
  includeArchived?: boolean
  search?: string
}

export async function listPurchaseOrders(
  opts: ListPurchaseOrdersOptions
): Promise<PurchaseOrder[]> {
  requireSupabase()
  let query = from('purchase_order')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('order_date', { ascending: false })

  if (opts.status) query = query.eq('status', opts.status)
  if (!opts.includeArchived) query = query.is('archived_at', null)
  if (opts.search && opts.search.trim() !== '') {
    query = query.ilike('code', `%${opts.search.trim()}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`Error listando pedidos: ${error.message}`)
  return ((data as Row[]) ?? []).map(rowToPurchaseOrder)
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
  requireSupabase()
  const { data, error } = await from('purchase_order')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Error obteniendo pedido ${id}: ${error.message}`)
  return data ? rowToPurchaseOrder(data as Row) : null
}

export async function createPurchaseOrder(
  input: PurchaseOrderInsert
): Promise<PurchaseOrder> {
  requireSupabase()
  const { data, error } = await from('purchase_order')
    .insert(poInsertToRow(input))
    .select('*')
    .single()
  if (error) throw new Error(`Error creando pedido: ${error.message}`)
  return rowToPurchaseOrder(data as Row)
}

export async function updatePurchaseOrder(
  id: string,
  patch: PurchaseOrderUpdate
): Promise<PurchaseOrder> {
  requireSupabase()
  const rowPatch = poUpdateToRow(patch)
  if (Object.keys(rowPatch).length === 0) {
    const current = await getPurchaseOrderById(id)
    if (!current) throw new Error(`Pedido ${id} no encontrado.`)
    return current
  }
  const { data, error } = await from('purchase_order')
    .update(rowPatch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`Error actualizando pedido ${id}: ${error.message}`)
  return rowToPurchaseOrder(data as Row)
}

export async function archivePurchaseOrder(id: string): Promise<PurchaseOrder> {
  requireSupabase()
  const { data, error } = await from('purchase_order')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`Error archivando pedido ${id}: ${error.message}`)
  return rowToPurchaseOrder(data as Row)
}

// ── Líneas ──
export async function listPurchaseOrderLines(
  purchaseOrderId: string
): Promise<PurchaseOrderLine[]> {
  requireSupabase()
  const { data, error } = await from('purchase_order_line')
    .select('*')
    .eq('purchase_order_id', purchaseOrderId)
    .order('position', { ascending: true })
  if (error) throw new Error(`Error listando líneas del pedido: ${error.message}`)
  return ((data as Row[]) ?? []).map(rowToPurchaseOrderLine)
}

export async function createPurchaseOrderLine(
  input: PurchaseOrderLineInsert
): Promise<PurchaseOrderLine> {
  requireSupabase()
  const { data, error } = await from('purchase_order_line')
    .insert(lineInsertToRow(input))
    .select('*')
    .single()
  if (error) throw new Error(`Error creando línea de pedido: ${error.message}`)
  return rowToPurchaseOrderLine(data as Row)
}

export async function deletePurchaseOrderLine(id: string): Promise<void> {
  requireSupabase()
  const { error } = await from('purchase_order_line').delete().eq('id', id)
  if (error) throw new Error(`Error borrando línea ${id}: ${error.message}`)
}
