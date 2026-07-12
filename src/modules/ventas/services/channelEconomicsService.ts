// src/modules/ventas/services/channelEconomicsService.ts
//
// Servicio de Economia de Plataforma (Capa B/C). Lee la RPC server-side
// `channel_economics_dashboard` (una sola verdad en SQL, igual que sales_dashboard).
// Fuentes: channel_settlement (liquidaciones) + channel_settlement_order (por pedido).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no esta configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

export interface EcoKpis {
  venta: number
  venta_con_coste: number
  liquidacion: number
  coste_canal: number
  pct_efectivo: number | null
  pedidos: number
}
export interface Salud {
  periodo_desde: string | null
  periodo_hasta: string | null
  n_liquidaciones: number
  canales_con_coste: string[]
  canales_solo_venta: string[]
  pedidos_capa_c: number
  casados_pos: number
  pct_casado_pos: number | null
}
export interface WaterfallRow { concept: string; amount: number }
export interface EcoBrandRow { brand: string; venta: number; liquidacion: number | null; pct_efectivo: number | null; promos: number; es_deuda: boolean }
export interface EcoChannelRow { channel: string; venta: number; liquidacion: number | null; tiene_coste: boolean; pedidos: number }
export interface PerOrderBrandRow { brand: string; pedidos: number; neto_medio: number; pct_efectivo: number | null; con_pos: number }
export interface PerOrder { pedidos: number; con_pos: number; neto_medio: number; by_brand: PerOrderBrandRow[] }

export interface ChannelEconomics {
  kpis: EcoKpis
  salud: Salud | null
  waterfall: WaterfallRow[]
  by_brand: EcoBrandRow[]
  by_channel: EcoChannelRow[]
  per_order: PerOrder | null
}

export interface ChannelEconomicsFilters {
  accountId: string
  from?: Date | null
  to?: Date | null
  channel?: string | null      // import_csv_glovo | import_csv_uber | import_csv_je
  brandId?: string | null
  locationId?: string | null
}

const EMPTY: ChannelEconomics = {
  kpis: { venta: 0, venta_con_coste: 0, liquidacion: 0, coste_canal: 0, pct_efectivo: null, pedidos: 0 },
  salud: null, waterfall: [], by_brand: [], by_channel: [], per_order: null,
}

export async function getChannelEconomics(f: ChannelEconomicsFilters): Promise<ChannelEconomics> {
  requireSupabase()
  const iso = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
  const { data, error } = await (
    supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { message: string } | null }>
  )('channel_economics_dashboard', {
    p_account: f.accountId,
    p_from: iso(f.from),
    p_to: iso(f.to),
    p_channel: f.channel ?? null,
    p_brand: f.brandId ?? null,
    p_location: f.locationId ?? null,
  })
  if (error) throw new Error(`Error cargando economia de plataforma: ${error.message}`)
  if (!data) return EMPTY
  const d = data as Partial<ChannelEconomics>
  return {
    kpis: d.kpis ?? EMPTY.kpis,
    salud: d.salud ?? null,
    waterfall: d.waterfall ?? [],
    by_brand: d.by_brand ?? [],
    by_channel: d.by_channel ?? [],
    per_order: d.per_order ?? null,
  }
}
