// src/modules/pos/services/posSaleService.ts
//
// TPV T1 (venta mostrador/para llevar). Servicio del cliente:
//   - marcas vendibles en este local (brand_location_availability)
//   - carta por marca: REUTILIZA listCategoriesWithProducts (kitchen) — no se
//     reinventa el listado de catálogo.
//   - config de producto (modificadores + slots de combo): pos_item_config,
//     hermano de shop_item_config sin la verja de shop_theme. Misma FORMA de
//     salida → se reutiliza sin cambios dishConfigService.ts (tipos y lógica
//     pura de selección/precio/validación ya construidos y probados en Shop).
//   - guardar/comandar/cobrar/entregar: upsert_pos_sale (un solo RPC,
//     transacción atómica), que a su vez reutiliza _shop_reprice_line para
//     los totales — misma fuente de verdad de precio que Folvy Shop.
//   - cuentas abiertas: sale.raw_tab guarda exactamente {lines: OrderLine[]},
//     así que recuperar una cuenta es leerlo tal cual, sin reconstruir desde
//     sale_line.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { mapDishConfigJson, type DishConfig, type OrderLine } from '@/modules/shop/services/dishConfigService'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

// OrderLine (menuItemId/quantity/modifiers/combo) es lo que _shop_reprice_line/
// _adapt_folvy_pos_order LEEN en el servidor (fuente de precio única, servidor
// recalcula siempre). unitPrice/totalPrice aquí son SOLO para redibujar el
// carrito al recuperar una cuenta guardada sin ir al servidor — el servidor
// las ignora (claves de más en el jsonb) y nunca son la fuente de verdad del
// cobro real.
export interface PosLinePayload extends OrderLine {
  kitchenNote: string | null
  unitPrice: number
  totalPrice: number
  summary: string[]
}

export interface PosBrand {
  id: string
  name: string
  color: string | null
}

export async function listPosBrandsForLocation(accountId: string, locationId: string): Promise<PosBrand[]> {
  requireSupabase()
  const { data: avail, error: availErr } = await supabase!
    .from('brand_location_availability')
    .select('brand_id')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .eq('is_active', true)
  if (availErr) throw new Error(`Error listando marcas del local: ${availErr.message}`)
  const brandIds = [...new Set((avail ?? []).map(r => r.brand_id as string))]
  if (brandIds.length === 0) return []

  const { data: brands, error: brErr } = await supabase!
    .from('brand')
    .select('id, name, color')
    .in('id', brandIds)
    .is('archived_at', null)
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (brErr) throw new Error(`Error listando marcas: ${brErr.message}`)
  return (brands ?? []).map(b => ({ id: b.id as string, name: b.name as string, color: (b.color as string) ?? null }))
}

// ── Config de producto (modificadores + combo) ──────────────────────────

type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

export async function getPosItemConfig(accountId: string, locationId: string, menuItemId: string): Promise<DishConfig | null> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as RpcFn)('pos_item_config', {
    p_account_id: accountId, p_location_id: locationId, p_menu_item_id: menuItemId,
  })
  if (error) throw new Error(`Error cargando el producto: ${error.message}`)
  if (!data) return null
  return mapDishConfigJson(data)
}

// ── Guardar / Comandar / Cobrar / Entregar ──────────────────────────────

export type PosAction = 'save' | 'command' | 'charge' | 'deliver'
export type PosChannelKind = 'counter' | 'takeaway'

export interface PosSaleResult {
  saleId: string
  posShortCode: string | null
  status: string
  orderStatus: string | null
  paymentStatus: string | null
  total: number
  taxableBase: number | null
  tax: number | null
}

export async function upsertPosSale(input: {
  saleId: string | null
  accountId: string
  locationId: string
  brandId: string | null
  channelKind: PosChannelKind
  lines: PosLinePayload[]
  action: PosAction
  paymentMethod?: 'cash' | 'card' | null
}): Promise<PosSaleResult> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as RpcFn)('upsert_pos_sale', {
    p_sale_id: input.saleId,
    p_account_id: input.accountId,
    p_location_id: input.locationId,
    p_brand_id: input.brandId,
    p_channel_kind: input.channelKind,
    p_lines: input.lines,
    p_action: input.action,
    p_payment_method: input.paymentMethod ?? null,
  })
  if (error) throw new Error(`Error en el TPV: ${error.message}`)
  const d = data as Record<string, unknown>
  return {
    saleId: d.saleId as string,
    posShortCode: (d.posShortCode as string) ?? null,
    status: d.status as string,
    orderStatus: (d.orderStatus as string) ?? null,
    paymentStatus: (d.paymentStatus as string) ?? null,
    total: Number(d.total ?? 0),
    taxableBase: d.taxableBase != null ? Number(d.taxableBase) : null,
    tax: d.tax != null ? Number(d.tax) : null,
  }
}

// ── Cuentas abiertas (guardadas/comandadas sin cobrar) ──────────────────

export interface OpenPosTicket {
  id: string
  posShortCode: string | null
  status: string
  orderStatus: string | null
  paymentStatus: string | null
  brandId: string | null
  total: number
  openedAt: string
  lines: PosLinePayload[]
}

function parseRawTabLines(raw: string | null): PosLinePayload[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { lines?: PosLinePayload[] }
    return Array.isArray(parsed.lines) ? parsed.lines : []
  } catch {
    return []
  }
}

export async function listOpenPosTickets(accountId: string, locationId: string): Promise<OpenPosTicket[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sale')
    .select('id, pos_short_code, status, order_status, payment_status, brand_id, total, opened_at, raw_tab')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .eq('source', 'folvy_pos')
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
  if (error) throw new Error(`Error listando cuentas abiertas: ${error.message}`)
  return (data ?? []).map(r => ({
    id: r.id as string,
    posShortCode: (r.pos_short_code as string) ?? null,
    status: r.status as string,
    orderStatus: (r.order_status as string) ?? null,
    paymentStatus: (r.payment_status as string) ?? null,
    brandId: (r.brand_id as string) ?? null,
    total: Number(r.total ?? 0),
    openedAt: r.opened_at as string,
    lines: parseRawTabLines(r.raw_tab as string | null),
  }))
}

// Ventas cobradas ('closed'), pendientes de marcar Entregado (para el botón
// "Entregado" — decisión de Julio 11/08: Comandar/Cobrar topan en 'accepted',
// un paso deliberado aparte cierra a 'completed' y dispara el consumo de stock.
export async function listChargedPendingDeliveryTickets(accountId: string, locationId: string): Promise<OpenPosTicket[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sale')
    .select('id, pos_short_code, status, order_status, payment_status, brand_id, total, opened_at, raw_tab')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .eq('source', 'folvy_pos')
    .eq('status', 'closed')
    .neq('order_status', 'completed')
    .order('opened_at', { ascending: false })
  if (error) throw new Error(`Error listando cuentas cobradas: ${error.message}`)
  return (data ?? []).map(r => ({
    id: r.id as string,
    posShortCode: (r.pos_short_code as string) ?? null,
    status: r.status as string,
    orderStatus: (r.order_status as string) ?? null,
    paymentStatus: (r.payment_status as string) ?? null,
    brandId: (r.brand_id as string) ?? null,
    total: Number(r.total ?? 0),
    openedAt: r.opened_at as string,
    lines: parseRawTabLines(r.raw_tab as string | null),
  }))
}
