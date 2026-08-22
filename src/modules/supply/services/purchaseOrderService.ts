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
  /** Local activo (scope global). null/undefined = consolidado = sin filtrar por local. */
  locationId?: string | null
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

  if (opts.locationId) query = query.eq('location_id', opts.locationId)
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

// ─── Panel "Pendiente de recepción" (P1, 10/08) ───────────────────────────
// Lee pending_receptions_report: pedidos 'enviado'/'recibido_parcial' del
// local, con días de retraso y pedido-vs-recibido por línea EN UNIDAD BASE
// (no en el conteo bruto de formato — dos formatos del mismo pedido no se
// comparan en crudo). Solo lectura, no escribe stock ni cambia estados.

export interface PendingReceptionLine {
  recipeItemId: string | null
  productName: string
  unitAbbr: string | null
  qtyOrderedBase: number
  qtyReceivedBase: number
  complete: boolean
}

export interface PendingReceptionOrder {
  orderId: string
  code: string | null
  supplierId: string | null
  supplierName: string | null
  locationId: string | null
  locationName: string | null
  orderDate: string
  expectedDate: string | null
  status: PurchaseOrderStatus
  daysOverdue: number
  lines: PendingReceptionLine[]
}

/**
 * pending_receptions_report no está aún en database.ts (migración pendiente
 * de regenerar tipos). CAST PUNTUAL inline — cast y llamada en la MISMA
 * expresión, nunca `const rpc = supabase.rpc` suelto (pierde el `this` de
 * supabase-js: "Cannot read properties of undefined (reading 'rest')").
 */
export async function getPendingReceptionsReport(
  accountId: string,
  locationId: string,
): Promise<PendingReceptionOrder[]> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'pending_receptions_report', { p_account: accountId, p_location: locationId },
  )
  if (error) throw new Error(`No se pudo leer lo pendiente de recepción: ${error.message}`)
  const obj = (data ?? {}) as { orders?: Row[] }
  return ((obj.orders ?? []) as Row[]).map((o): PendingReceptionOrder => ({
    orderId: String(o.order_id),
    code: (o.code as string | null) ?? null,
    supplierId: (o.supplier_id as string | null) ?? null,
    supplierName: (o.supplier_name as string | null) ?? null,
    locationId: (o.location_id as string | null) ?? null,
    locationName: (o.location_name as string | null) ?? null,
    orderDate: String(o.order_date),
    expectedDate: (o.expected_date as string | null) ?? null,
    status: o.status as PurchaseOrderStatus,
    daysOverdue: Number(o.days_overdue ?? 0),
    lines: ((o.lines ?? []) as Row[]).map((l): PendingReceptionLine => ({
      recipeItemId: (l.recipe_item_id as string | null) ?? null,
      productName: (l.product_name as string) ?? '(sin nombre)',
      unitAbbr: (l.unit_abbr as string | null) ?? null,
      qtyOrderedBase: Number(l.qty_ordered_base ?? 0),
      qtyReceivedBase: Number(l.qty_received_base ?? 0),
      complete: Boolean(l.complete),
    })),
  }))
}

// ─── Cierre corto — "ya no lo van a servir" (P1.b, 10/08) ─────────────────
// Válvula manual DE ÚLTIMO RECURSO para que un pendiente no se pudra otra vez
// 56 días: SIEMPRE con motivo obligatorio + nota con autor y fecha. NUNCA toca
// stock (ni una fila de stock_movement) — solo status + notes de purchase_order,
// vía el mismo update de tabla que ya usan los botones Cancelar/Cerrar
// existentes (RLS ya lo permite; no hace falta RPC nueva).
//
// Destino según SI LLEGÓ ALGO — no según el rótulo del estado:
//   llegó algo  → 'cerrado'    (se cierra con lo que hay; el resto no vendrá)
//   no llegó nada → 'cancelado' (el pedido, de hecho, no ocurrió)
//
// ENCARGO CODE (21/08) — POR QUÉ DEJÓ DE MIRAR SÓLO EL ESTADO. Hasta hoy era
// 'enviado' → 'cancelado' a secas. Con el casado de líneas roto (arreglado el
// 21/08), un pedido cuya mercancía SÍ había llegado se quedaba en 'enviado', y
// al cerrarlo por aquí acababa en 'cancelado'. De los 41 cancelados de Foodint,
// 10 salieron de este botón y OCHO con el motivo «Otro» — entre ellos pedidos
// semanales enteros: PED-00014 (35 líneas), PED-00020 (33), PED-00021 (29).
// «Otro» era donde iba a morir «llegó, pero el sistema no lo cierra».
//
// Cancelado es un pedido que NO se envió; cerrado es uno que llegó incompleto y
// se da por bueno. Confundirlos es lo que ha destrozado la estadística de
// compras de este año, así que la decisión pasa a mirar el HECHO (¿hay algo
// recibido?) y no la etiqueta.
export type ShortCloseReasonCode = 'no_supplied' | 'ordered_elsewhere' | 'mistake' | 'other'

export const SHORT_CLOSE_REASONS: { code: ShortCloseReasonCode; label: string }[] = [
  { code: 'no_supplied', label: 'El proveedor no lo va a servir' },
  { code: 'ordered_elsewhere', label: 'Se pidió por otra vía' },
  { code: 'mistake', label: 'Error al crear el pedido' },
  { code: 'other', label: 'Otro' },
]

export function shortCloseReasonLabel(code: string): string {
  return SHORT_CLOSE_REASONS.find(r => r.code === code)?.label ?? code
}

/**
 * Destino de un cierre corto. null = no aplica (estado terminal o no reconocido).
 *
 * `algoRecibido` decide entre cerrado y cancelado. Se omite (false) sólo cuando
 * el llamador todavía no lo sabe; entonces se comporta como antes. Un
 * 'recibido_parcial' YA implica que llegó algo, así que no necesita el dato.
 */
export function shortCloseTargetStatus(
  current: PurchaseOrderStatus,
  algoRecibido = false,
): PurchaseOrderStatus | null {
  if (current === 'recibido_parcial') return 'cerrado'
  if (current === 'enviado') return algoRecibido ? 'cerrado' : 'cancelado'
  return null
}

export async function closeShortPurchaseOrder(input: {
  order: PurchaseOrder
  reasonCode: ShortCloseReasonCode
  notes: string | null
  actorName: string | null
  /** ¿Ha llegado algo contra este pedido? Decide cerrado vs cancelado. */
  algoRecibido?: boolean
}): Promise<PurchaseOrder> {
  const target = shortCloseTargetStatus(input.order.status, input.algoRecibido ?? false)
  if (!target) {
    throw new Error(`Cierre corto: el pedido ${input.order.code ?? input.order.id} está en estado "${input.order.status}", no se puede cerrar así.`)
  }
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const reasonLabel = shortCloseReasonLabel(input.reasonCode)
  const note = `Cierre corto (${reasonLabel}) por ${input.actorName ?? 'alguien'} el ${now}` +
    (input.notes?.trim() ? `: ${input.notes.trim()}` : '.')
  const combinedNotes = input.order.notes ? `${input.order.notes}\n${note}` : note
  return updatePurchaseOrder(input.order.id, { status: target, notes: combinedNotes })
}

// ═══ QUÉ FALTA DE UN PEDIDO (ENCARGO CODE 21/08) ═══════════════════════════
//
// DEUDA DECLARADA, la misma que en priceGridService y channelRouteService:
// src/types/database.ts se regenera con el CLI de Supabase (npm run gen:types,
// que necesita el CLI global y el proyecto enlazado) y todavía no conoce
// purchase_order_shortfall, purchase_order_progress ni queue_ctb_order_claim:
// las tres migraron hoy. Hasta la próxima regeneración se pasa por el cliente
// sin tipar. Lo único que se afloja es el NOMBRE de la RPC; la forma de las
// filas se sigue declarando a mano (OrderShortfallLine, OrderProgress) y se
// mapea campo a campo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(): any {
  return supabase
}
//
// «Recibido parcial» a secas obliga a abrir para saber si falta un salsero o
// falta media entrega. El sistema SABE qué falta; sólo no lo contaba.
//
// El cálculo vive en la BBDD (purchase_order_shortfall / purchase_order_progress)
// y no aquí: lo consumen la fila de la lista, la ficha y el texto de la
// reclamación, y si cada una lo calculara por su cuenta acabarían discrepando.
// Mismo criterio que recompute_purchase_order_status, a propósito.

/** Una línea del pedido con lo pedido, lo recibido y lo que falta. */
export interface OrderShortfallLine {
  lineId: string
  productName: string
  recipeItemId: string | null
  formatName: string | null
  qtyOrdered: number
  qtyReceived: number
  qtyMissing: number
  position: number
}

/** Resumen para pintar la fila de la lista sin abrir el pedido. */
export interface OrderProgress {
  orderId: string
  lineas: number
  completas: number
  faltan: number
  diasDeRetraso: number | null
}

/**
 * Las líneas del pedido, CON LAS QUE FALTAN PRIMERO — ese orden lo impone el
 * servidor, no la pantalla, para que la ficha y la reclamación enseñen lo mismo.
 */
export async function getOrderShortfall(orderId: string): Promise<OrderShortfallLine[]> {
  requireSupabase()
  const { data, error } = await rpc().rpc('purchase_order_shortfall', { p_order_id: orderId })
  if (error) throw new Error(`Error leyendo lo que falta del pedido: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    lineId: r.line_id as string,
    productName: (r.product_name as string) ?? '',
    recipeItemId: (r.recipe_item_id as string | null) ?? null,
    formatName: (r.format_name as string | null) ?? null,
    qtyOrdered: Number(r.qty_ordered ?? 0),
    qtyReceived: Number(r.qty_received ?? 0),
    qtyMissing: Number(r.qty_missing ?? 0),
    position: Number(r.line_position ?? 0),
  }))
}

/**
 * El resumen de varios pedidos de una tacada: la lista pinta 20 filas con UNA
 * consulta, no con 20. Un fallo aquí NO tumba la lista — se degrada a sin
 * resumen (la etiqueta de estado sigue), que es peor pero no roto.
 */
export async function getOrdersProgress(orderIds: string[]): Promise<Map<string, OrderProgress>> {
  const out = new Map<string, OrderProgress>()
  if (orderIds.length === 0) return out
  requireSupabase()
  const { data, error } = await rpc().rpc('purchase_order_progress', { p_order_ids: orderIds })
  if (error) {
    console.warn('[purchaseOrderService] no se pudo leer el avance de los pedidos', error)
    return out
  }
  for (const r of ((data ?? []) as Record<string, unknown>[])) {
    out.set(r.order_id as string, {
      orderId: r.order_id as string,
      lineas: Number(r.lineas ?? 0),
      completas: Number(r.completas ?? 0),
      faltan: Number(r.faltan ?? 0),
      diasDeRetraso: r.dias_de_retraso == null ? null : Number(r.dias_de_retraso),
    })
  }
  return out
}

/**
 * El texto de la reclamación. Lo compone el sistema, no el usuario: el operario
 * revisa y envía, no redacta. Se enseña TAL CUAL antes de mandarlo — la última
 * pantalla antes de escribir dice qué escribe.
 */
export function buildOrderClaimMessage(args: {
  orderCode: string | null
  supplierName: string | null
  locationName: string | null
  expectedDate: string | null
  faltan: OrderShortfallLine[]
}): string {
  const fecha = args.expectedDate
    ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(new Date(args.expectedDate + 'T00:00:00'))
    : '—'
  const num = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 3 })
  const lineas = args.faltan.map(l => {
    const fmt = l.formatName ? ` ${l.formatName}` : ''
    return `• ${l.productName}: pedidas ${num(l.qtyOrdered)}${fmt}, recibidas ${num(l.qtyReceived)} → faltan ${num(l.qtyMissing)}`
  })
  return [
    'Falta material de un pedido',
    args.supplierName ? `Proveedor: ${args.supplierName}` : null,
    args.locationName ? `Local: ${args.locationName}` : null,
    `Pedido: ${args.orderCode ?? '—'} · entrega prevista ${fecha}`,
    '',
    `Falta${args.faltan.length === 1 ? '' : 'n'} ${args.faltan.length} ${args.faltan.length === 1 ? 'artículo' : 'artículos'}:`,
    ...lineas,
    '',
    'Enviado con Folvy · folvy.app',
  ].filter(Boolean).join('\n')
}

/** Encola la reclamación en la cola de CTB (la misma que ya se usa a diario). */
export async function queueOrderClaim(orderId: string): Promise<string> {
  requireSupabase()
  const { data, error } = await rpc().rpc('queue_ctb_order_claim', { p_order_id: orderId })
  if (error) throw new Error(error.message)
  return data as string
}
