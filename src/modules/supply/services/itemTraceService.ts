// src/modules/supply/services/itemTraceService.ts
//
// Trazabilidad de artículo — lectura para las dos pantallas nuevas:
//   listItemMovements → ledger de UN artículo en UN local, con saldo y coste
//                       ACUMULADOS y el origen legible de cada movimiento.
//   getSaleTicket     → el ticket completo que originó un movimiento de venta.
//
// Ambas van contra RPC SECURITY INVOKER (migración 20260815T1500): la RLS se
// aplica con el JWT del que llama, así que no hay forma de ver artículos ni
// tickets de otra cuenta aunque se pase su id a mano.
//
// El acumulado NO se calcula aquí: lo hace la RPC sobre el ledger completo. Si
// se acumulara en cliente sobre la página cargada, la columna "cantidad total"
// mentiría en cuanto se pasara de página — el mismo fallo que ya se corrigió en
// la búsqueda de Movimientos (ver movementsService).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

type Row = Record<string, unknown>

const n = (v: unknown, d = 0): number => (v == null ? d : Number(v))
const s = (v: unknown): string | null => (v == null ? null : String(v))

// ── Pantalla 1 ──────────────────────────────────────────────────────────────

/** Familias del gráfico apilado. Mismas 5 series que pide el encargo. */
export type MovementFamily = 'inventarios' | 'compras' | 'producciones' | 'ventas' | 'otros'

export interface ItemMovementRow {
  id: string
  movementType: string
  sourceType: string
  /** Venta que originó el movimiento (null si no viene de una venta). Abre la Pantalla 2. */
  saleId: string | null
  qtyBase: number
  unitCost: number | null
  costEur: number
  /** Saldo acumulado TRAS este movimiento, sobre el ledger completo. */
  runningQty: number
  runningCost: number
  occurredAt: string
  createdByName: string | null
  reference: string | null
  notes: string | null
}

export interface ItemTraceHeader {
  id: string
  name: string
  unitAbbr: string | null
  qtyOnHand: number
  avgUnitCost: number | null
  stockValue: number
}

export interface SeriesPoint {
  dia: string
  familia: MovementFamily
  qty: number
}

export interface ItemMovementsPage {
  item: ItemTraceHeader | null
  total: number
  series: SeriesPoint[]
  items: ItemMovementRow[]
}

export async function listItemMovements(input: {
  accountId: string
  recipeItemId: string
  locationId: string
  from?: string | null
  to?: string | null
  limit?: number
  offset?: number
}): Promise<ItemMovementsPage> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('list_item_stock_movements', {
    p_account: input.accountId,
    p_item: input.recipeItemId,
    p_location: input.locationId,
    p_from: input.from ?? undefined,
    p_to: input.to ?? undefined,
    p_limit: input.limit ?? 200,
    p_offset: input.offset ?? 0,
  })
  if (error) {
    const falta = /could not find the function|does not exist/i.test(error.message)
    if (falta) {
      throw new Error('Esta pantalla necesita la migración 20260815T1500 aplicada en la BBDD.')
    }
    throw new Error(`No se pudo cargar la trazabilidad: ${error.message}`)
  }

  const obj = (data ?? {}) as { item?: unknown; total?: unknown; series?: unknown; items?: unknown }
  const rawItem = obj.item as Row | null

  return {
    item: rawItem
      ? {
          id: String(rawItem.id),
          name: (rawItem.name as string) ?? '(sin nombre)',
          unitAbbr: s(rawItem.unit_abbr),
          qtyOnHand: n(rawItem.qty_on_hand),
          avgUnitCost: rawItem.avg_unit_cost == null ? null : n(rawItem.avg_unit_cost),
          stockValue: n(rawItem.stock_value),
        }
      : null,
    total: n(obj.total),
    series: ((obj.series ?? []) as Row[]).map(r => ({
      dia: String(r.dia),
      familia: String(r.familia) as MovementFamily,
      qty: n(r.qty),
    })),
    items: ((obj.items ?? []) as Row[]).map(r => ({
      id: String(r.id),
      movementType: String(r.movement_type),
      sourceType: String(r.source_type),
      saleId: s(r.sale_id),
      qtyBase: n(r.qty_base),
      unitCost: r.unit_cost == null ? null : n(r.unit_cost),
      costEur: n(r.cost_eur),
      runningQty: n(r.running_qty),
      runningCost: n(r.running_cost),
      occurredAt: String(r.occurred_at),
      createdByName: s(r.created_by_name),
      reference: s(r.reference),
      notes: s(r.notes),
    })),
  }
}

// ── Pantalla 2 ──────────────────────────────────────────────────────────────

export interface SaleTicketHeader {
  id: string
  soldAt: string | null
  brand: string | null
  channel: string | null
  location: string | null
  orderStatus: string | null
  status: string | null
  source: string | null
  ticketCode: string | null
  total: number
  taxableBase: number | null
  tax: number | null
  discountAmount: number | null
  serviceType: string | null
  cost: number
  /** Nº de líneas product sin computed_cost: el coste (y el margen) están incompletos. */
  linesWithoutCost: number
  costComplete: boolean
  marginEur: number
  marginPct: number | null
}

export interface SaleTicketLine {
  id: string
  productName: string
  rawName: string | null
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
  unitCost: number | null
  computedCost: number | null
  contribution: number | null
  marginPct: number | null
  lineType: string
  parentId: string | null
  discountLabel: string | null
  originalUnitPrice: number | null
  needsReview: boolean
  unmappedReason: string | null
  ignored: boolean
  /** El modelo no guarda zona de almacén ni lote por línea de venta: hueco preparado. */
  warehouse: string | null
  lots: string | null
}

export interface SaleTicket {
  sale: SaleTicketHeader | null
  lines: SaleTicketLine[]
}

export async function getSaleTicket(saleId: string): Promise<SaleTicket> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('get_sale_ticket', { p_sale_id: saleId })
  if (error) {
    const falta = /could not find the function|does not exist/i.test(error.message)
    if (falta) {
      throw new Error('Esta pantalla necesita la migración 20260815T1500 aplicada en la BBDD.')
    }
    throw new Error(`No se pudo cargar el ticket: ${error.message}`)
  }

  const obj = (data ?? {}) as { sale?: unknown; lines?: unknown }
  const h = obj.sale as Row | null

  return {
    sale: h
      ? {
          id: String(h.id),
          soldAt: s(h.sold_at),
          brand: s(h.brand),
          channel: s(h.channel),
          location: s(h.location),
          orderStatus: s(h.order_status),
          status: s(h.status),
          source: s(h.source),
          ticketCode: s(h.ticket_code),
          total: n(h.total),
          taxableBase: h.taxable_base == null ? null : n(h.taxable_base),
          tax: h.tax == null ? null : n(h.tax),
          discountAmount: h.discount_amount == null ? null : n(h.discount_amount),
          serviceType: s(h.service_type),
          cost: n(h.cost),
          linesWithoutCost: n(h.lines_without_cost),
          costComplete: h.cost_complete === true,
          marginEur: n(h.margin_eur),
          marginPct: h.margin_pct == null ? null : n(h.margin_pct),
        }
      : null,
    lines: ((obj.lines ?? []) as Row[]).map(r => ({
      id: String(r.id),
      productName: (r.product_name as string) ?? '(sin nombre)',
      rawName: s(r.raw_name),
      quantity: n(r.quantity),
      unitPrice: r.unit_price == null ? null : n(r.unit_price),
      lineTotal: r.line_total == null ? null : n(r.line_total),
      unitCost: r.unit_cost == null ? null : n(r.unit_cost),
      computedCost: r.computed_cost == null ? null : n(r.computed_cost),
      contribution: r.contribution == null ? null : n(r.contribution),
      marginPct: r.margin_pct == null ? null : n(r.margin_pct),
      lineType: String(r.line_type ?? 'product'),
      parentId: s(r.parent_id),
      discountLabel: s(r.discount_label),
      originalUnitPrice: r.original_unit_price == null ? null : n(r.original_unit_price),
      needsReview: r.needs_review === true,
      unmappedReason: s(r.unmapped_reason),
      ignored: r.ignored === true,
      warehouse: s(r.warehouse),
      lots: s(r.lots),
    })),
  }
}
