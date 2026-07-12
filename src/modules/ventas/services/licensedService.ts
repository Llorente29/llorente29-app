// src/modules/ventas/services/licensedService.ts
//
// Economía de marcas CEDIDAS (Cloudtown / CTB): el "segundo motor" de ingreso de
// un dark-kitchen. Lee la RPC licensed_economics_dashboard sobre channel_settlement
// (flow_type='licensed', source='ctb_sales_detail'). El ingreso de Llorente en las
// cedidas NO es el gross de plataforma (eso lo cobra CTB), es el revenue share que
// CTB le liquida cada mes. Por eso aquí "ingreso" = net_payout (25% agregador / 35% propio).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

export interface LicensedTotal {
  gross: number | null
  ingreso: number | null
  corte: number | null
  share_pct: number | null
  marcas: number | null
}
export interface LicensedBrand {
  brand: string
  gross: number
  ingreso: number
  share_pct: number | null
}
export interface LicensedChannel {
  channel: string
  slug: string
  gross: number
  ingreso: number
}
export interface LicensedLocation {
  location: string
  gross: number
  ingreso: number
}
export interface LicensedDashboard {
  total: LicensedTotal
  by_brand: LicensedBrand[]
  by_channel: LicensedChannel[]
  by_location: LicensedLocation[]
}

const EMPTY: LicensedDashboard = {
  total: { gross: 0, ingreso: 0, corte: 0, share_pct: null, marcas: 0 },
  by_brand: [], by_channel: [], by_location: [],
}

export interface LicensedFilters {
  accountId: string
  from?: Date | null
  to?: Date | null
  locationId?: string | null
}

export async function getLicensedEconomics(f: LicensedFilters): Promise<LicensedDashboard> {
  requireSupabase()
  const iso = (d?: Date | null) => (d ? d.toISOString() : null)
  const { data, error } = await (
    supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { message: string } | null }>
  )('licensed_economics_dashboard', {
    p_account: f.accountId, p_from: iso(f.from), p_to: iso(f.to), p_location: f.locationId ?? null,
  })
  if (error) throw new Error(`Error cargando cedidas: ${error.message}`)
  if (!data) return EMPTY
  const d = data as Partial<LicensedDashboard>
  return {
    total: d.total ?? EMPTY.total,
    by_brand: d.by_brand ?? [],
    by_channel: d.by_channel ?? [],
    by_location: d.by_location ?? [],
  }
}

// Locations para el selector (mismo patrón que foodCostService.getLocations)
export interface LocationOpt { id: string; name: string }
export async function getLocationsLic(accountId: string): Promise<LocationOpt[]> {
  requireSupabase()
  const { data, error } = await (supabase! as any)
    .from('locations').select('id,name').eq('account_id', accountId).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((l: any) => ({ id: l.id, name: l.name }))
}
