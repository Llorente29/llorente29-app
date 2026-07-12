// src/modules/ventas/services/qualityService.ts
//
// Área de Calidad: valoraciones, comentarios, etiquetas, tipos de error, platos que
// fallan y reembolsos. Lee la RPC server-side `quality_dashboard`
// (channel_review + channel_incident).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

export interface QualityRatings { n: number; avg: number | null; dist: Record<string, number> }
export interface QualityBrand { brand: string; avg: number | null; n: number; neg: number }
export interface QualityComment { stars: number | null; brand: string | null; txt: string; tags: string | null }
export interface QualityTag { tag: string; n: number }
export interface QualityCount { type?: string; item?: string; n: number }
export interface QualityTimes {
  n: number
  prep_avg: number | null
  delivery_avg: number | null
  total_avg: number | null
  wait_avoidable_total_h: number | null
  completion_pct: number | null
  by_brand: { brand: string; total: number | null; n: number }[]
}
export interface QualityDashboard {
  ratings: QualityRatings
  by_brand: QualityBrand[]
  comments: QualityComment[]
  tags: QualityTag[]
  err_types: { type: string; n: number }[]
  top_fail: { item: string; n: number }[]
  refund: { total: number; own: number }
  incidencias: number
  tiempos: QualityTimes | null
}

export interface QualityFilters {
  accountId: string
  from?: Date | null
  to?: Date | null
  locationId?: string | null
  brandId?: string | null
}

const EMPTY: QualityDashboard = {
  ratings: { n: 0, avg: null, dist: {} }, by_brand: [], comments: [], tags: [],
  err_types: [], top_fail: [], refund: { total: 0, own: 0 }, incidencias: 0, tiempos: null,
}

export async function getQuality(f: QualityFilters): Promise<QualityDashboard> {
  requireSupabase()
  const iso = (d?: Date | null) => (d ? d.toISOString() : null)
  const { data, error } = await (
    supabase!.rpc as unknown as (fn: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { message: string } | null }>
  )('quality_dashboard', {
    p_account: f.accountId, p_from: iso(f.from), p_to: iso(f.to),
    p_location: f.locationId ?? null, p_brand: f.brandId ?? null,
  })
  if (error) throw new Error(`Error cargando calidad: ${error.message}`)
  if (!data) return EMPTY
  const d = data as Partial<QualityDashboard>
  return {
    ratings: d.ratings ?? EMPTY.ratings, by_brand: d.by_brand ?? [], comments: d.comments ?? [],
    tags: d.tags ?? [], err_types: d.err_types ?? [], top_fail: d.top_fail ?? [],
    refund: d.refund ?? { total: 0, own: 0 }, incidencias: d.incidencias ?? 0,
    tiempos: d.tiempos ?? null,
  }
}

// Traducción de etiquetas de Uber a lenguaje llano + signo
const TAG_LABEL: Record<string, string> = {
  restaurant_not_worth_price: 'No compensa el precio', restaurant_missed_request: 'Ignoraron una petición',
  restaurant_not_tasty: 'Poco sabroso', restaurant_too_slow: 'Demasiado lento',
  restaurant_reliable_service: 'Servicio fiable', restaurant_convenient: 'Cómodo',
  restaurant_sustainable_packaging: 'Packaging sostenible', restaurant_great_selection: 'Buena carta',
  restaurant_consistent: 'Consistente', restaurant_store_accommodating: 'Establecimiento atento',
}
const NEG_TAGS = new Set(['restaurant_not_worth_price', 'restaurant_missed_request', 'restaurant_not_tasty', 'restaurant_too_slow'])
export function tagLabel(t: string): string { return TAG_LABEL[t] ?? t }
export function tagIsNegative(t: string): boolean { return NEG_TAGS.has(t) }
