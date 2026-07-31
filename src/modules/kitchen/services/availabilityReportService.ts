// src/modules/kitchen/services/availabilityReportService.ts
//
// DISPONIBILIDAD · C3b — cliente de la RPC availability_report (C3a). Un
// solo viaje trae todo el payload del panel (patrón sales_dashboard).
//
// p_channel_id: se acepta en la firma para no tener que tocarla el día que
// exista, pero HOY es un NO-OP en la RPC (availability_event no lleva canal
// todavía) — por eso este servicio NO expone un filtro de canal en las
// opciones (la pantalla tampoco lo pinta, ver AvailabilityReportsPage).
//
// Cast a any en el rpc(): availability_report/_intervals no están en los
// tipos autogenerados (RPC nueva de esta misma sesión, database.ts no se ha
// regenerado). Mismo patrón que availabilityService.setProductAvailability.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
}

export type AvailabilityScope = 'location' | 'brand' | 'product'
export type AvailabilityOrigin = 'cocina' | 'oficina' | 'plataforma' | 'auto' | 'sistema'

export interface AvailabilityKpis {
  uptime_pct: number | null
  downtime_hours: number
  lost_revenue_est: number
  closures_count: number
  avoidable_pct: number | null
}

export interface AvailabilityKpisWithPrev extends AvailabilityKpis {
  prev: AvailabilityKpis
}

export interface HeatmapCell { dow: number; hour: number; downtime_min: number }
export interface TrendPoint { day: string; lost_revenue_est: number }
export interface RankingRow { scope: AvailabilityScope; target_label: string; lost_revenue_est: number }
export interface OriginRow { origin: AvailabilityOrigin; closures: number; downtime_min: number }
export interface ReasonRow { reason_code: string | null; closures: number; downtime_min: number }

export interface LogRow {
  scope: AvailabilityScope
  target_label: string | null
  origin: AvailabilityOrigin
  reason_code: string | null
  started_at: string
  duration_min: number
  lost_revenue_est: number
  actor: string | null
}

export interface AvailabilityReport {
  kpis: AvailabilityKpisWithPrev
  heatmap: HeatmapCell[]
  trend: TrendPoint[]
  ranking: RankingRow[]
  by_origin: OriginRow[]
  by_reason: ReasonRow[]
  log: LogRow[]
}

export interface AvailabilityReportFilters {
  accountId: string
  from: string   // ISO
  to: string     // ISO
  locationId?: string | null
  brandId?: string | null
  origin?: AvailabilityOrigin | null
  scope?: AvailabilityScope | null
  weeks?: number
}

export async function getAvailabilityReport(f: AvailabilityReportFilters): Promise<AvailabilityReport> {
  requireSupabase()
  const { data, error } = await (supabase as any).rpc('availability_report', {
    p_account_id: f.accountId,
    p_from: f.from,
    p_to: f.to,
    p_location_id: f.locationId ?? null,
    p_brand_id: f.brandId ?? null,
    p_channel_id: null,
    p_origin: f.origin ?? null,
    p_scope: f.scope ?? null,
    p_weeks: f.weeks ?? 8,
  })
  if (error) throw new Error(`Error cargando el informe: ${error.message}`)
  return (data ?? {
    kpis: { uptime_pct: null, downtime_hours: 0, lost_revenue_est: 0, closures_count: 0, avoidable_pct: null,
      prev: { uptime_pct: null, downtime_hours: 0, lost_revenue_est: 0, closures_count: 0, avoidable_pct: null } },
    heatmap: [], trend: [], ranking: [], by_origin: [], by_reason: [], log: [],
  }) as AvailabilityReport
}
