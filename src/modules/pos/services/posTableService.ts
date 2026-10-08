// src/modules/pos/services/posTableService.ts
//
// TPV · Sala (S1, 08/10). Mesas, comensales y envíos a cocina. Todo pasa por
// RPC con la misma guarda que el resto del TPV (_pos_can_operate): ninguna
// escritura de venta desde el cliente. Las de configuración de la sala (zonas
// y mesas, en oficina) van contra las tablas, con RLS de admin/encargado.
//
// Una mesa abierta es UNA venta (la cuenta). Cada «Enviar a cocina» es un
// envío (sale_fire). Lo enviado no se borra ni se reescribe: se anula con
// motivo. El estado de la mesa lo CALCULA el servidor (pos_floor).

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type { PosLinePayload } from '@/modules/pos/services/posSaleService'
import type { TableState } from '@/modules/pos/lib/tableState'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as RpcFn)(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

// ── Sala ────────────────────────────────────────────────────────────────

export type ZoneKind = 'sala' | 'terraza' | 'barra' | 'reservado'

export interface FloorTableSale {
  id: string
  covers: number
  openedAt: string
  total: number
  servedByName: string | null
  state: TableState
  fireCount: number
  lastFireAt: string | null
  pendingCount: number
  billRequestedAt: string | null
  paidAt: string | null
}

export interface FloorTable {
  id: string
  name: string
  seats: number
  gridWidth: number
  sortOrder: number
  sale: FloorTableSale | null
}

export interface FloorZone {
  id: string
  name: string
  kind: ZoneKind
  sortOrder: number
  tables: FloorTable[]
}

export interface Floor {
  warnMinutes: number
  zones: FloorZone[]
}

export async function getFloor(accountId: string, locationId: string): Promise<Floor> {
  const d = await rpc<Floor>('pos_floor', { p_account_id: accountId, p_location_id: locationId })
  return {
    warnMinutes: Number(d?.warnMinutes ?? 90),
    zones: (d?.zones ?? []).map(z => ({
      ...z,
      tables: (z.tables ?? []).map(t => ({
        ...t,
        sale: t.sale ? { ...t.sale, total: Number(t.sale.total ?? 0), covers: Number(t.sale.covers ?? 0) } : null,
      })),
    })),
  }
}

export async function openTable(input: { tableId: string; covers: number; brandId: string; deviceToken: string | null }): Promise<string> {
  const d = await rpc<{ saleId: string }>('pos_table_open', {
    p_table_id: input.tableId, p_covers: input.covers, p_brand_id: input.brandId, p_device_token: input.deviceToken,
  })
  return d.saleId
}

// ── Mesa abierta ────────────────────────────────────────────────────────

export interface TableFire {
  id: string
  number: number
  firedAt: string
  firedByName: string | null
}

export interface TableLine {
  id: string
  name: string
  menuItemId: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
  kitchenNote: string | null
  fireId: string | null
  voidedAt: string | null
  voidReason: string | null
  createdAt: string
  summary: string[]
}

export interface TableDetail {
  saleId: string
  posShortCode: string | null
  brandId: string | null
  tableId: string
  tableName: string
  seats: number
  zoneId: string
  zoneName: string
  zoneKind: ZoneKind
  covers: number
  openedAt: string
  servedByName: string | null
  total: number
  state: TableState
  billRequestedAt: string | null
  paidAt: string | null
  paymentMethod: string | null
  fires: TableFire[]
  lines: TableLine[]
}

export async function getTableDetail(saleId: string): Promise<TableDetail> {
  const d = await rpc<TableDetail>('pos_table_detail', { p_sale_id: saleId })
  return {
    ...d,
    total: Number(d.total ?? 0),
    covers: Number(d.covers ?? 0),
    lines: (d.lines ?? []).map(l => ({
      ...l,
      quantity: Number(l.quantity ?? 0),
      unitPrice: Number(l.unitPrice ?? 0),
      lineTotal: Number(l.lineTotal ?? 0),
      summary: Array.isArray(l.summary) ? l.summary : [],
    })),
  }
}

// Las líneas del TPV viajan con la misma forma que en la venta rápida
// (OrderLine + nota): el servidor reprecia cada una con _shop_reprice_line.
function toServerLines(lines: PosLinePayload[]) {
  return lines.map(l => ({
    menuItemId: l.menuItemId, name: l.name, productType: l.productType, quantity: l.quantity,
    modifiers: l.modifiers, combo: l.combo, kitchenNote: l.kitchenNote,
  }))
}

export async function addPendingLines(saleId: string, lines: PosLinePayload[]): Promise<void> {
  if (lines.length === 0) return
  await rpc('pos_table_add_lines', { p_sale_id: saleId, p_lines: toServerLines(lines) })
}

export async function setPendingQty(lineId: string, quantity: number): Promise<void> {
  await rpc('pos_table_set_pending_qty', { p_line_id: lineId, p_quantity: quantity })
}

export async function removePendingLine(lineId: string): Promise<void> {
  await rpc('pos_table_remove_pending_line', { p_line_id: lineId })
}

export interface FireResult {
  fireId: string
  fireNumber: number
  lineCount: number
  printJobs: number
}

export async function fireToKitchen(saleId: string, newLines: PosLinePayload[], deviceToken: string | null): Promise<FireResult> {
  const d = await rpc<FireResult>('pos_table_fire', {
    p_sale_id: saleId, p_lines: toServerLines(newLines), p_device_token: deviceToken,
  })
  return { ...d, printJobs: Number(d.printJobs ?? 0), lineCount: Number(d.lineCount ?? 0) }
}

export interface VoidReason {
  id: string
  label: string
}

export async function listVoidReasons(accountId: string): Promise<VoidReason[]> {
  return (await rpc<VoidReason[]>('pos_void_reasons', { p_account_id: accountId })) ?? []
}

export async function voidSentLine(input: { lineId: string; reasonId: string; note: string | null; deviceToken: string | null }): Promise<{ printJobs: number }> {
  const d = await rpc<{ printJobs: number }>('pos_table_void_line', {
    p_line_id: input.lineId, p_reason_id: input.reasonId, p_note: input.note, p_device_token: input.deviceToken,
  })
  return { printJobs: Number(d.printJobs ?? 0) }
}

export async function requestBill(saleId: string): Promise<{ printJobs: number; total: number }> {
  const d = await rpc<{ printJobs: number; total: number }>('pos_table_request_bill', { p_sale_id: saleId })
  return { printJobs: Number(d.printJobs ?? 0), total: Number(d.total ?? 0) }
}

export async function chargeTable(saleId: string, paymentMethod: 'cash' | 'card'): Promise<{ total: number }> {
  const d = await rpc<{ total: number }>('pos_table_charge', { p_sale_id: saleId, p_payment_method: paymentMethod })
  return { total: Number(d.total ?? 0) }
}

export async function clearTable(saleId: string): Promise<{ cancelled: boolean }> {
  const d = await rpc<{ cancelled?: boolean }>('pos_table_clear', { p_sale_id: saleId })
  return { cancelled: Boolean(d?.cancelled) }
}

// ── Oficina: zonas y mesas del local ────────────────────────────────────

export interface DiningZoneRow {
  id: string
  name: string
  kind: ZoneKind
  sortOrder: number
}

export interface DiningTableRow {
  id: string
  zoneId: string
  name: string
  seats: number
  sortOrder: number
  gridWidth: number
}

export async function listDiningLayout(accountId: string, locationId: string): Promise<{ zones: DiningZoneRow[]; tables: DiningTableRow[]; warnMinutes: number }> {
  requireSupabase()
  const [z, t, c] = await Promise.all([
    supabase!.from('dining_zone').select('id, name, kind, sort_order')
      .eq('account_id', accountId).eq('location_id', locationId).eq('is_active', true).order('sort_order'),
    supabase!.from('dining_table').select('id, zone_id, name, seats, sort_order, grid_width')
      .eq('account_id', accountId).eq('location_id', locationId).eq('is_active', true).order('sort_order'),
    supabase!.from('dining_config').select('table_warn_minutes').eq('location_id', locationId).maybeSingle(),
  ])
  if (z.error) throw new Error(`Error leyendo las zonas: ${z.error.message}`)
  if (t.error) throw new Error(`Error leyendo las mesas: ${t.error.message}`)
  if (c.error) throw new Error(`Error leyendo la configuración de sala: ${c.error.message}`)
  return {
    zones: (z.data ?? []).map(r => ({ id: r.id, name: r.name, kind: r.kind as ZoneKind, sortOrder: r.sort_order })),
    tables: (t.data ?? []).map(r => ({ id: r.id, zoneId: r.zone_id, name: r.name, seats: r.seats, sortOrder: r.sort_order, gridWidth: r.grid_width })),
    warnMinutes: c.data?.table_warn_minutes ?? 90,
  }
}

export async function createZone(accountId: string, locationId: string, name: string, kind: ZoneKind, sortOrder: number): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('dining_zone').insert({ account_id: accountId, location_id: locationId, name: name.trim(), kind, sort_order: sortOrder })
  if (error) throw new Error(error.message.includes('dining_zone_location_name_uq') ? `Ya hay una zona «${name.trim()}» en este local.` : error.message)
}

export async function updateZone(id: string, patch: { name?: string; kind?: ZoneKind; sortOrder?: number }): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('dining_zone').update({
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

// Una zona con mesas activas no se retira: primero sus mesas.
export async function retireZone(id: string): Promise<void> {
  requireSupabase()
  const { count, error: e1 } = await supabase!.from('dining_table').select('id', { count: 'exact', head: true }).eq('zone_id', id).eq('is_active', true)
  if (e1) throw new Error(e1.message)
  if ((count ?? 0) > 0) throw new Error(`La zona tiene ${count} mesa(s). Quítalas o muévelas antes.`)
  const { error } = await supabase!.from('dining_zone').update({ is_active: false }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function createTables(accountId: string, locationId: string, zoneId: string, names: string[], seats: number, firstSortOrder: number): Promise<void> {
  requireSupabase()
  if (names.length === 0) return
  const { error } = await supabase!.from('dining_table').insert(names.map((n, i) => ({
    account_id: accountId, location_id: locationId, zone_id: zoneId, name: n.trim(), seats, sort_order: firstSortOrder + i,
  })))
  if (error) throw new Error(error.message.includes('dining_table_location_name_uq') ? 'Alguna de esas mesas ya existe en el local (el nombre de una mesa es único en el local).' : error.message)
}

export async function updateTable(id: string, patch: { name?: string; seats?: number; sortOrder?: number; gridWidth?: number; zoneId?: string }): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('dining_table').update({
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.seats !== undefined ? { seats: patch.seats } : {}),
    ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
    ...(patch.gridWidth !== undefined ? { grid_width: patch.gridWidth } : {}),
    ...(patch.zoneId !== undefined ? { zone_id: patch.zoneId } : {}),
  }).eq('id', id)
  if (error) throw new Error(error.message.includes('dining_table_location_name_uq') ? 'Ya hay otra mesa con ese nombre en el local.' : error.message)
}

// Una mesa con la cuenta abierta no se retira.
export async function retireTable(id: string): Promise<void> {
  requireSupabase()
  const { count, error: e1 } = await supabase!.from('sale').select('id', { count: 'exact', head: true })
    .eq('table_id', id).is('table_cleared_at', null).neq('status', 'cancelled')
  // 42703 = la columna sale.table_id aún no existe: la parte A de la
  // migración (zonas y mesas) va antes que la B (cuentas de mesa). Sin la
  // columna no puede haber ninguna cuenta abierta en esta mesa.
  if (e1 && e1.code !== '42703') throw new Error(e1.message)
  if ((count ?? 0) > 0) throw new Error('La mesa tiene la cuenta abierta. Ciérrala antes de quitarla.')
  const { error } = await supabase!.from('dining_table').update({ is_active: false }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setWarnMinutes(accountId: string, locationId: string, minutes: number): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('dining_config').upsert({ location_id: locationId, account_id: accountId, table_warn_minutes: minutes }, { onConflict: 'location_id' })
  if (error) throw new Error(error.message)
}
