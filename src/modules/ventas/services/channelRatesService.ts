// src/modules/ventas/services/channelRatesService.ts
//
// Servicio de configuración de tarifas de canal (comisiones por canal / marca / local).
// Fuentes: channel_rate (defecto por canal×modo) + brand_channel + brand_channel_rate
// (override por marca, con location_id opcional para override fino por local).
//
// Resolución en cascada (la hace en SQL la función resolve_channel_commission):
//   brand_channel_rate (marca+local) > brand_channel_rate (marca, local NULL) > channel_rate defecto.
//
// Multi-tenant: todo por account_id + RLS. Cada cliente ve y edita solo lo suyo.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

export type ServiceType = 'platform_delivery' | 'pickup' | 'own_delivery'
export const SERVICE_TYPES: ServiceType[] = ['platform_delivery', 'pickup', 'own_delivery']
export const SERVICE_LABEL: Record<ServiceType, string> = {
  platform_delivery: 'Reparto de la plataforma',
  pickup: 'Recogida',
  own_delivery: 'Reparto propio',
}

export interface ChannelRow {
  id: string
  name: string
  slug: string
  channelType: string | null
}
export interface BrandRow { id: string; name: string }
export interface LocationRow { id: string; name: string }

// Defecto por canal×modo (channel_rate)
export interface ChannelDefault {
  id: string | null
  channelId: string
  serviceType: ServiceType
  commissionPct: number | null
  commissionBase: string
  ownCourierCost: number | null
}

// Override por marca (brand_channel_rate + brand_channel). location_id null = toda la marca.
export interface RateOverride {
  id: string
  brandChannelId: string
  channelId: string
  brandId: string
  locationId: string | null
  serviceType: ServiceType
  commissionPct: number | null
  commissionBase: string
  ownCourierCost: number | null
}

export interface TariffsData {
  channels: ChannelRow[]
  brands: BrandRow[]
  locations: LocationRow[]
  defaults: ChannelDefault[]
  overrides: RateOverride[]
}

// ── Carga completa ───────────────────────────────────────────────────────────

export async function loadTariffs(accountId: string): Promise<TariffsData> {
  requireSupabase()
  const sb = supabase!

  const [chRes, brRes, locRes, defRes, ovrRes] = await Promise.all([
    sb.from('sales_channel').select('id,name,slug,channel_type')
      .eq('account_id', accountId).eq('is_active', true).order('name'),
    sb.from('brand').select('id,name')
      .eq('account_id', accountId).order('name'),
    sb.from('locations').select('id,name')
      .eq('account_id', accountId).order('name'),
    sb.from('channel_rate')
      .select('id,sales_channel_id,service_type,commission_pct,commission_base,own_courier_cost')
      .eq('account_id', accountId).eq('is_active', true),
    sb.from('brand_channel_rate')
      .select('id,service_type,commission_pct,commission_base,own_courier_cost,location_id,brand_channel!inner(id,brand_id,channel_id)')
      .eq('account_id', accountId).eq('is_active', true),
  ])

  const firstErr = chRes.error || brRes.error || locRes.error || defRes.error || ovrRes.error
  if (firstErr) throw new Error(`Error cargando tarifas: ${firstErr.message}`)

  const channels: ChannelRow[] = (chRes.data ?? []).map((c: any) => ({
    id: c.id, name: c.name, slug: c.slug, channelType: c.channel_type,
  }))
  const brands: BrandRow[] = (brRes.data ?? []).map((b: any) => ({ id: b.id, name: b.name }))
  const locations: LocationRow[] = (locRes.data ?? []).map((l: any) => ({ id: l.id, name: l.name }))
  const defaults: ChannelDefault[] = (defRes.data ?? []).map((d: any) => ({
    id: d.id, channelId: d.sales_channel_id, serviceType: d.service_type,
    commissionPct: d.commission_pct, commissionBase: d.commission_base ?? 'pvp_con_iva',
    ownCourierCost: d.own_courier_cost,
  }))
  const overrides: RateOverride[] = (ovrRes.data ?? []).map((r: any) => ({
    id: r.id, brandChannelId: r.brand_channel.id, channelId: r.brand_channel.channel_id,
    brandId: r.brand_channel.brand_id, locationId: r.location_id, serviceType: r.service_type,
    commissionPct: r.commission_pct, commissionBase: r.commission_base ?? 'pvp_con_iva',
    ownCourierCost: r.own_courier_cost,
  }))

  return { channels, brands, locations, defaults, overrides }
}

// ── Guardar defecto de canal ─────────────────────────────────────────────────

export async function saveChannelDefault(
  accountId: string, channelId: string, serviceType: ServiceType,
  commissionPct: number, ownCourierCost: number | null,
): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('channel_rate')
    .upsert({
      account_id: accountId, sales_channel_id: channelId, service_type: serviceType,
      commission_pct: commissionPct, commission_base: 'pvp_con_iva',
      own_courier_cost: ownCourierCost, is_active: true,
    }, { onConflict: 'account_id,sales_channel_id,service_type' })
  if (error) throw new Error(`Error guardando defecto: ${error.message}`)
}

// ── Guardar / borrar override por marca (y opcional local) ────────────────────

// Devuelve el brand_channel_id (lo crea si no existe).
async function ensureBrandChannel(accountId: string, brandId: string, channelId: string): Promise<string> {
  const sb = supabase!
  const found = await sb.from('brand_channel').select('id')
    .eq('account_id', accountId).eq('brand_id', brandId).eq('channel_id', channelId).maybeSingle()
  if (found.error) throw new Error(found.error.message)
  if (found.data?.id) return found.data.id as string

  const created = await sb.from('brand_channel')
    .insert({ account_id: accountId, brand_id: brandId, channel_id: channelId, is_active: true })
    .select('id').single()
  if (created.error) throw new Error(created.error.message)
  return created.data.id as string
}

export async function saveOverride(params: {
  accountId: string; brandId: string; channelId: string;
  locationId: string | null; serviceType: ServiceType;
  commissionPct: number; ownCourierCost: number | null;
}): Promise<void> {
  requireSupabase()
  const brandChannelId = await ensureBrandChannel(params.accountId, params.brandId, params.channelId)
  const { error } = await supabase!
    .from('brand_channel_rate')
    .upsert({
      account_id: params.accountId, brand_channel_id: brandChannelId,
      service_type: params.serviceType, location_id: params.locationId,
      commission_pct: params.commissionPct, commission_base: 'pvp_con_iva',
      own_courier_cost: params.ownCourierCost, is_active: true,
    }, { onConflict: 'brand_channel_id,service_type,location_id' })
  if (error) throw new Error(`Error guardando override: ${error.message}`)
}

export async function deleteOverride(overrideId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!.from('brand_channel_rate').delete().eq('id', overrideId)
  if (error) throw new Error(`Error borrando override: ${error.message}`)
}

// ── Resolución en cliente (espejo de resolve_channel_commission, para previsualizar) ──

export function resolveCommission(
  data: TariffsData, channelId: string, brandId: string,
  locationId: string | null, serviceType: ServiceType,
): { pct: number | null; source: 'local' | 'marca' | 'defecto' | 'sin_tarifa' } {
  const ovs = data.overrides.filter(
    o => o.channelId === channelId && o.brandId === brandId && o.serviceType === serviceType,
  )
  const local = locationId ? ovs.find(o => o.locationId === locationId) : undefined
  if (local?.commissionPct != null) return { pct: local.commissionPct, source: 'local' }
  const brand = ovs.find(o => o.locationId == null)
  if (brand?.commissionPct != null) return { pct: brand.commissionPct, source: 'marca' }
  const def = data.defaults.find(d => d.channelId === channelId && d.serviceType === serviceType)
  if (def?.commissionPct != null) return { pct: def.commissionPct, source: 'defecto' }
  return { pct: null, source: 'sin_tarifa' }
}
