// src/modules/ventas/services/salesDashboardService.ts
//
// Servicio del Dashboard de Ventas (Folvy Sales). Lee los agregados de la RPC
// server-side `sales_dashboard` (cálculo en SQL, una sola verdad, coherente con
// el resto de Folvy: nada se recalcula en cliente).
//
// La RPC recibe filtros opcionales (fechas, local, marca, tipo propia/cedida,
// canal) y devuelve un JSON con todos los bloques del dashboard. El front solo
// pinta lo que la RPC entrega.
//
// Ventas netas = total − refund − discount (igual que R365/Putler; no infla).
// Horas en zona de la cuenta (accounts.timezone), no hardcode: Folvy multi-zona.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ── Tipos de dominio (espejo del JSON que devuelve sales_dashboard) ──────────

export interface DashboardKpis {
  net: number
  orders: number
  aov: number
}

export interface ChannelRow {
  name: string
  net: number
  orders: number
}

export interface BrandRow {
  name: string
  ownership_type: string | null
  net: number
  orders: number
}

export interface OwnershipRow {
  ownership: string
  net: number
  orders: number
}

export interface LocationRow {
  name: string
  net: number
  orders: number
}

export interface HourRow {
  hour: number
  net: number
  orders: number
}

export interface SalesDashboard {
  kpis: DashboardKpis
  by_channel: ChannelRow[]
  by_brand: BrandRow[]
  by_ownership: OwnershipRow[]
  by_location: LocationRow[]
  by_hour: HourRow[]
}

// ── Filtros del dashboard (todos opcionales → null = todos) ──────────────────

export interface SalesDashboardFilters {
  accountId: string
  from?: Date | null
  to?: Date | null
  locationId?: string | null
  brandId?: string | null
  ownership?: 'own' | 'licensed' | null
  channel?: string | null
}

const EMPTY: SalesDashboard = {
  kpis: { net: 0, orders: 0, aov: 0 },
  by_channel: [],
  by_brand: [],
  by_ownership: [],
  by_location: [],
  by_hour: [],
}

// ── Llamada a la RPC ─────────────────────────────────────────────────────────

export async function getSalesDashboard(
  filters: SalesDashboardFilters
): Promise<SalesDashboard> {
  requireSupabase()

  // La RPC aún no está en los tipos autogenerados de Supabase (database.ts);
  // casteamos la llamada. Llamar como member-access de `supabase!` para no
  // perder el `this` del cliente. TODO saneamiento: regenerar tipos.
  const { data, error } = await (
    supabase!.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )('sales_dashboard', {
    p_account_id: filters.accountId,
    p_from: filters.from ? filters.from.toISOString() : null,
    p_to: filters.to ? filters.to.toISOString() : null,
    p_location_id: filters.locationId ?? null,
    p_brand_id: filters.brandId ?? null,
    p_ownership: filters.ownership ?? null,
    p_channel: filters.channel ?? null,
  })

  if (error) {
    throw new Error(`Error cargando el dashboard de ventas: ${error.message}`)
  }
  if (!data) return EMPTY

  const d = data as Partial<SalesDashboard>
  return {
    kpis: d.kpis ?? EMPTY.kpis,
    by_channel: d.by_channel ?? [],
    by_brand: d.by_brand ?? [],
    by_ownership: d.by_ownership ?? [],
    by_location: d.by_location ?? [],
    by_hour: d.by_hour ?? [],
  }
}
