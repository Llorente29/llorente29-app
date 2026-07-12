// src/modules/ventas/services/trendService.ts
//
// Evolución mensual por canal (venta, comisión, promo, pago, efectivo). Lee la RPC
// `channel_trend_monthly` sobre channel_settlement_order (Capa C).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

export interface TrendMonth {
  mes: string
  pedidos: number
  venta: number
  comision: number
  comision_pct: number | null
  promo: number
  promo_pct: number | null
  pago: number
  efect_pct: number | null
}
export interface ChannelOpt { id: string; name: string; slug: string }

export async function getChannels(accountId: string): Promise<ChannelOpt[]> {
  requireSupabase()
  const { data, error } = await (supabase! as any)
    .from('sales_channel').select('id,name,slug')
    .eq('account_id', accountId).eq('is_active', true).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug }))
}

export async function getTrend(accountId: string, channelId: string | null): Promise<TrendMonth[]> {
  requireSupabase()
  const { data, error } = await (
    supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { message: string } | null }>
  )('channel_trend_monthly', { p_account: accountId, p_channel: channelId, p_brand: null, p_location: null })
  if (error) throw new Error(`Error cargando tendencia: ${error.message}`)
  const d = (data ?? {}) as { months?: TrendMonth[] }
  return d.months ?? []
}
