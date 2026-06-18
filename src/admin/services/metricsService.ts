// src/admin/services/metricsService.ts
//
// Service de lectura del panel de métricas de plataforma (Portal de staff).
// Una sola llamada al RPC platform_metrics (todo calculado server-side).

import { supabase } from '../../lib/supabase'

export interface PlanBreakdownRow { plan: string; status: string; count: number }
export interface MonthSignups { month: string; count: number }

export interface PlatformMetrics {
  clientsActive: number
  clientsTotal: number
  accountsByStatus: Record<string, number>
  mrrEur: number
  arrEur: number
  subsActive: number
  subsTrial: number
  subsWithoutPlan: number
  subsByPlan: PlanBreakdownRow[]
  signupsByMonth: MonthSignups[]
  usageActive30d: number
  usageActive7d: number
  clientSalesTotal: number
  clientSales30d: number
  platformAdminsActive: number
  generatedAt: string
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('platform_metrics')
  if (error) throw new Error(error.message)
  const m = (data ?? {}) as Record<string, unknown>
  return {
    clientsActive: Number(m.clients_active ?? 0),
    clientsTotal: Number(m.clients_total ?? 0),
    accountsByStatus: (m.accounts_by_status as Record<string, number>) ?? {},
    mrrEur: Number(m.mrr_eur ?? 0),
    arrEur: Number(m.arr_eur ?? 0),
    subsActive: Number(m.subs_active ?? 0),
    subsTrial: Number(m.subs_trial ?? 0),
    subsWithoutPlan: Number(m.subs_without_plan ?? 0),
    subsByPlan: (m.subs_by_plan as PlanBreakdownRow[]) ?? [],
    signupsByMonth: (m.signups_by_month as MonthSignups[]) ?? [],
    usageActive30d: Number(m.usage_active_30d ?? 0),
    usageActive7d: Number(m.usage_active_7d ?? 0),
    clientSalesTotal: Number(m.client_sales_total ?? 0),
    clientSales30d: Number(m.client_sales_30d ?? 0),
    platformAdminsActive: Number(m.platform_admins_active ?? 0),
    generatedAt: (m.generated_at as string) ?? new Date().toISOString(),
  }
}

/** Formatea € sin decimales para cifras grandes, con separador de miles. */
export function formatEur(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}
