// src/modules/kitchen/services/channelRateService.ts
//
// Comisiones por DEFECTO de canal (tabla channel_rate). Es el valor que siembra
// todas las marcas de un canal (ej. Glovo 15%). Los overrides por marca×canal
// viven en brand_channel_rate (sub-paso siguiente).
//
// menu_item_economics resuelve por especificidad: override marca×canal > defecto
// de canal (este servicio) > NULL. El defecto no es invención: lo configura el
// gestor una vez.
//
// Patrón del proyecto: supabase directo, mappers row->domain, requireSupabase().

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

// ─── IVA de servicios ───────────────────────────────────────────────────────
// Comisión de plataforma, transporte, broker = tipo general (21% desde 2012).
// Si el gobierno lo cambiase, mover a modelo versionado como vat_rate/vat_category.
export const SERVICE_VAT_PCT = 21

/** De bruto (IVA incl.) a base imponible. */
export function baseFromGross(gross: number | null, vatPct: number = SERVICE_VAT_PCT): number | null {
  if (gross === null || gross === undefined) return null
  return Math.round((gross / (1 + vatPct / 100)) * 100) / 100
}

/** Cuota de IVA contenida en un importe bruto. */
export function vatFromGross(gross: number | null, vatPct: number = SERVICE_VAT_PCT): number | null {
  if (gross === null || gross === undefined) return null
  const base = baseFromGross(gross, vatPct)!
  return Math.round((gross - base) * 100) / 100
}

export type ServiceType = 'platform_delivery' | 'own_delivery' | 'pickup'
export type CommissionBase = 'pvp_con_iva' | 'pvp_sin_iva'

export interface SalesChannel {
  id: string
  name: string
  slug: string | null
  channelType: string | null
  color: string | null
}

export interface ChannelRate {
  id: string
  accountId: string
  salesChannelId: string
  serviceType: ServiceType
  commissionPct: number | null
  commissionFixed: number | null
  commissionBase: CommissionBase
  ownCustomerFee: number | null
  ownCustomerFeeVatPct: number
  ownCourierCost: number | null
  isActive: boolean
}

export interface ChannelRateUpsert {
  accountId: string
  salesChannelId: string
  serviceType: ServiceType
  commissionPct: number | null
  commissionFixed: number | null
  commissionBase: CommissionBase
  ownCustomerFee: number | null
  ownCustomerFeeVatPct: number
  ownCourierCost: number | null
}

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

function rowToChannelRate(r: Record<string, unknown>): ChannelRate {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    salesChannelId: r.sales_channel_id as string,
    serviceType: r.service_type as ServiceType,
    commissionPct: r.commission_pct === null ? null : Number(r.commission_pct),
    commissionFixed: r.commission_fixed === null ? null : Number(r.commission_fixed),
    commissionBase: (r.commission_base as CommissionBase) ?? 'pvp_con_iva',
    ownCustomerFee: r.own_customer_fee === null ? null : Number(r.own_customer_fee),
    ownCustomerFeeVatPct: Number(r.own_customer_fee_vat_pct ?? 10),
    ownCourierCost: r.own_courier_cost === null ? null : Number(r.own_courier_cost),
    isActive: r.is_active !== false,
  }
}

// Canales de venta activos de la cuenta.
export async function listSalesChannels(accountId: string): Promise<SalesChannel[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('sales_channel')
    .select('id, name, slug, channel_type, color')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error listando canales: ${error.message}`)
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    slug: (c.slug as string) ?? null,
    channelType: (c.channel_type as string) ?? null,
    color: (c.color as string) ?? null,
  }))
}

// Defectos de comisión por canal de la cuenta (filas vivas).
export async function listChannelRates(accountId: string): Promise<ChannelRate[]> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('channel_rate')
    .select('*')
    .eq('account_id', accountId)
    .is('archived_at', null)
  if (error) throw new Error(`Error listando comisiones de canal: ${error.message}`)
  return (data ?? []).map(rowToChannelRate)
}

// Crea o actualiza el defecto de un canal+service_type (upsert por scope vivo).
// El índice único uq_channel_rate_scope garantiza un defecto por (cuenta, canal,
// service_type) entre filas no archivadas, así que buscamos primero la viva.
export async function upsertChannelRate(input: ChannelRateUpsert): Promise<ChannelRate> {
  requireSupabase()

  const { data: existing, error: findErr } = await supabase!
    .from('channel_rate')
    .select('id')
    .eq('account_id', input.accountId)
    .eq('sales_channel_id', input.salesChannelId)
    .eq('service_type', input.serviceType)
    .is('archived_at', null)
    .maybeSingle()
  if (findErr) throw new Error(`Error buscando comisión existente: ${findErr.message}`)

  const payload = {
    account_id: input.accountId,
    sales_channel_id: input.salesChannelId,
    service_type: input.serviceType,
    commission_pct: input.commissionPct,
    commission_fixed: input.commissionFixed,
    commission_base: input.commissionBase,
    own_customer_fee: input.ownCustomerFee,
    own_customer_fee_vat_pct: input.ownCustomerFeeVatPct,
    own_courier_cost: input.ownCourierCost,
  }

  if (existing) {
    const { data, error } = await supabase!
      .from('channel_rate')
      .update(payload)
      .eq('id', existing.id as string)
      .select('*')
      .single()
    if (error) throw new Error(`Error actualizando comisión: ${error.message}`)
    return rowToChannelRate(data)
  } else {
    const { data, error } = await supabase!
      .from('channel_rate')
      .insert(payload)
      .select('*')
      .single()
    if (error) throw new Error(`Error creando comisión: ${error.message}`)
    return rowToChannelRate(data)
  }
}
