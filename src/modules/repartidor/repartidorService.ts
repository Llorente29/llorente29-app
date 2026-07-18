// src/modules/repartidor/repartidorService.ts
// Servicio de la PWA del repartidor: llamadas a las RPC por token (T3a/T3b.2).
import { supabase, isSupabaseEnabled } from '../../lib/supabase'

function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return (supabase.rpc as unknown as (f: string, a: Record<string, unknown>)
    => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args)
    .then(({ data, error }) => { if (error) throw new Error(error.message); return data as T })
}

export interface CourierSession {
  courier_id: string; name: string; phone: string | null
  kind: string; transport_type: string | null
  on_shift: boolean; account_id: string; assigned_locations: string[]
}
export interface CourierJob {
  assignment_id: string; state: string; mine: boolean
  sale_id: string; order_code: string
  brand: string | null; brand_logo: string | null
  customer_name: string | null; customer_phone: string | null
  total: number | null; items_count: number
  delivery_address: string | null; delivery_details: string | null
  delivery_lat: number | null; delivery_lng: number | null
  pickup_name: string | null; pickup_address: string | null
  pickup_lat: number | null; pickup_lng: number | null
  distance_km: number | null; payout: number | null
  offered_at: string | null
}

export const courierSession = (t: string) =>
  rpc<CourierSession>('courier_session_by_token', { p_token: t })
export const courierSetShift = (t: string, on: boolean) =>
  rpc<{ on_shift: boolean }>('courier_set_shift_by_token', { p_token: t, p_on: on })
export const courierFeed = (t: string) =>
  rpc<CourierJob[]>('courier_feed_by_token', { p_token: t })
export const courierClaim = (t: string, id: string) =>
  rpc<{ assignment_id: string; state: string }>('courier_claim_by_token', { p_token: t, p_assignment_id: id })
export const courierDecline = (t: string, id: string) =>
  rpc<{ ok: boolean }>('courier_decline_by_token', { p_token: t, p_assignment_id: id })
export const courierAdvance = (t: string, id: string, state: string, note?: string, proofUrl?: string) =>
  rpc<{ assignment_id: string; state: string }>('courier_advance_by_token',
    { p_token: t, p_assignment_id: id, p_state: state, p_note: note ?? null, p_proof_url: proofUrl ?? null })
export const courierPing = (t: string, lat: number, lng: number) =>
  rpc<{ ok: boolean }>('courier_ping_by_token', { p_token: t, p_lat: lat, p_lng: lng })