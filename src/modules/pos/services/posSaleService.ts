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
  // T1.c (11/08): token crudo del dispositivo (kds_device_token en
  // localStorage, mismo que /estacion y printWorker) — el servidor resuelve
  // el device_id por kds_resolve_device(), el cliente nunca manda un uuid
  // propio. null si esta tablet no está pareada (p.ej. TPV abierto desde el
  // ordenador de oficina): la venta se registra igual, sin bloquear.
  deviceToken?: string | null
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
    p_device_token: input.deviceToken ?? null,
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
  // T1.f (11/08): chips de la tarjeta de cuenta (nº de líneas, quién la
  // abrió) — el RPC ya los devuelve desde T1.d, solo faltaba tipar el campo.
  lineCount: number | null
  createdByName: string | null
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

// T1.d (11/08): antes, estas dos funciones consultaban `sale` DIRECTO desde
// el cliente (.from('sale')...), sin pasar por _pos_can_operate — el único
// sitio del TPV que rompía ese patrón (upsert_pos_sale y pos_item_config sí
// lo usan). La RLS de sale ('sale_read') es de CUENTA, no de LOCAL: un
// empleado con acceso a un solo local podía, en teoría, leer cuentas de
// OTRO local de la misma cuenta sin que el servidor lo impidiera (el filtro
// por location_id era solo un .eq() del cliente). pos_open_sales/
// pos_pending_delivery_sales cierran ese hueco: mismo guard que el resto.
function mapOpenTicket(r: Record<string, unknown>): OpenPosTicket {
  return {
    id: r.id as string,
    posShortCode: (r.posShortCode as string) ?? null,
    status: r.status as string,
    orderStatus: (r.orderStatus as string) ?? null,
    paymentStatus: (r.paymentStatus as string) ?? null,
    brandId: (r.brandId as string) ?? null,
    total: Number(r.total ?? 0),
    openedAt: r.openedAt as string,
    lines: parseRawTabLines(r.rawTab as string | null),
    lineCount: r.lineCount != null ? Number(r.lineCount) : null,
    createdByName: (r.createdByName as string) ?? null,
  }
}

export async function listOpenPosTickets(accountId: string, locationId: string): Promise<OpenPosTicket[]> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as RpcFn)('pos_open_sales', {
    p_account_id: accountId, p_location_id: locationId,
  })
  if (error) throw new Error(`Error listando cuentas abiertas: ${error.message}`)
  return ((data as Record<string, unknown>[]) ?? []).map(mapOpenTicket)
}

// Ventas cobradas ('closed'), pendientes de marcar Entregado (para el botón
// "Entregado" — decisión de Julio 11/08: Comandar/Cobrar topan en 'accepted',
// un paso deliberado aparte cierra a 'completed' y dispara el consumo de stock.
export async function listChargedPendingDeliveryTickets(accountId: string, locationId: string): Promise<OpenPosTicket[]> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as RpcFn)('pos_pending_delivery_sales', {
    p_account_id: accountId, p_location_id: locationId,
  })
  if (error) throw new Error(`Error listando cuentas cobradas: ${error.message}`)
  return ((data as Record<string, unknown>[]) ?? []).map(mapOpenTicket)
}
