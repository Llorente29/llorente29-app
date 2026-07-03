// src/modules/shop/admin/campaignService.ts
//
// Servicio del gestor de campañas del Shop (G1). Lee TODAS las campañas de la
// cuenta con su estado derivado + rendimiento real, y crea/edita/pausa cupones
// estándar de CÓDIGO. Todo server-side (list_campaigns / save_campaign /
// toggle_campaign, SECURITY DEFINER con guard de cuenta). El impacto de margen se
// reutiliza de couponAdminService (preview_coupon_impact).

import { supabase } from '@/lib/supabase'
import type { DiscountType } from '@/modules/shop/admin/couponAdminService'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

export type CampaignStatus = 'active' | 'scheduled' | 'expired' | 'paused'

export interface Campaign {
  id: string
  name: string
  code: string | null
  kind: 'standard' | 'frequency'
  discountType: DiscountType
  value: number
  minSubtotal: number | null
  firstOrderOnly: boolean
  autoApply: boolean
  frequencyThreshold: number | null
  startsAt: string | null
  endsAt: string | null
  maxRedemptions: number | null
  maxPerCustomer: number
  active: boolean
  pausedAt: string | null
  origin: string
  status: CampaignStatus
  isSystem: boolean
  redemptions: number         // canjes VIVOS
  discounted: number          // € descontado (vivos)
  avgMarginPct: number | null // margen medio real de los canjes vivos
}

export async function listCampaigns(accountId: string): Promise<Campaign[]> {
  try {
    const { data, error } = await db().rpc('list_campaigns', { p_account: accountId })
    if (error || !Array.isArray(data)) return []
    const num = (v: any) => (v != null ? Number(v) : null)
    return (data as any[]).map((c) => ({
      id: c.id,
      name: c.name ?? '',
      code: c.code ?? null,
      kind: c.kind === 'frequency' ? 'frequency' : 'standard',
      discountType: (c.discountType === 'fixed' ? 'fixed' : 'percent') as DiscountType,
      value: Number(c.value ?? 0),
      minSubtotal: num(c.minSubtotal),
      firstOrderOnly: c.firstOrderOnly === true,
      autoApply: c.autoApply === true,
      frequencyThreshold: num(c.frequencyThreshold),
      startsAt: c.startsAt ?? null,
      endsAt: c.endsAt ?? null,
      maxRedemptions: num(c.maxRedemptions),
      maxPerCustomer: Number(c.maxPerCustomer ?? 1),
      active: c.active !== false,
      pausedAt: c.pausedAt ?? null,
      origin: c.origin ?? 'manual',
      status: (c.status ?? 'active') as CampaignStatus,
      isSystem: c.isSystem === true,
      redemptions: Number(c.redemptions ?? 0),
      discounted: Number(c.discounted ?? 0),
      avgMarginPct: num(c.avgMarginPct),
    })) as Campaign[]
  } catch {
    return []
  }
}

export interface SaveCampaignArgs {
  id?: string | null
  name: string
  code: string
  discountType: DiscountType
  value: number
  minSubtotal?: number | null
  startsAt?: string | null      // ISO
  endsAt?: string | null        // ISO
  maxRedemptions?: number | null
  maxPerCustomer?: number | null
}

export async function saveCampaign(accountId: string, args: SaveCampaignArgs): Promise<{ ok: boolean; id?: string; reason?: string }> {
  try {
    const { data, error } = await db().rpc('save_campaign', {
      p_account: accountId,
      p_id: args.id ?? null,
      p_name: args.name,
      p_code: args.code,
      p_discount_type: args.discountType,
      p_value: args.value,
      p_min_subtotal: args.minSubtotal ?? null,
      p_starts_at: args.startsAt ?? null,
      p_ends_at: args.endsAt ?? null,
      p_max_redemptions: args.maxRedemptions ?? null,
      p_max_per_customer: args.maxPerCustomer ?? null,
    })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, id: data.id ?? undefined }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

export async function toggleCampaign(accountId: string, id: string, active: boolean): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await db().rpc('toggle_campaign', { p_account: accountId, p_id: id, p_active: active })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// Mensaje legible de por qué falló un guardado.
export function saveCampaignError(reason: string | undefined): string {
  switch (reason) {
    case 'name_required': return 'Ponle un nombre a la campaña.'
    case 'code_required': return 'El código es obligatorio.'
    case 'code_taken':    return 'Ese código ya existe en tu tienda.'
    case 'bad_type':      return 'Tipo de descuento no válido.'
    case 'bad_value':     return 'El valor debe ser mayor que 0.'
    case 'bad_percent':   return 'El porcentaje no puede pasar de 100.'
    case 'bad_min':       return 'El mínimo no puede ser negativo.'
    case 'bad_max':       return 'El tope de usos debe ser mayor que 0.'
    case 'bad_max_per':   return 'El tope por cliente debe ser 1 o más.'
    case 'bad_window':    return 'La fecha de fin debe ser posterior a la de inicio.'
    case 'system':        return 'Esta campaña es de sistema: edítala en Diseño de la tienda.'
    case 'not_found':     return 'La campaña ya no existe.'
    default:              return 'No se pudo guardar. Inténtalo de nuevo.'
  }
}
