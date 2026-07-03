// src/modules/shop/admin/couponAdminService.ts
//
// Config de la oferta de BIENVENIDA por cuenta (F3 sub-paso 5). Lee el cupón de
// bienvenida canónico (auto_apply + first_order_only), previsualiza el impacto de
// margen real de un valor hipotético, y guarda. El impacto y el guardado son
// 100% server-side (preview_coupon_impact / save_welcome_offer): el front nunca
// calcula margen ni escribe el cupón a mano.

import { supabase } from '@/lib/supabase'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

export type DiscountType = 'percent' | 'fixed'

export interface WelcomeOffer {
  exists: boolean
  active: boolean
  discountType: DiscountType
  value: number
}

/** Lee la oferta de bienvenida actual de la cuenta (o defaults si no existe). */
export async function getWelcomeOffer(accountId: string): Promise<WelcomeOffer> {
  try {
    const { data, error } = await db()
      .from('coupon')
      .select('discount_type,value,active')
      .eq('account_id', accountId)
      .eq('auto_apply', true)
      .eq('first_order_only', true)
      .limit(1)
      .maybeSingle()
    if (error || !data) return { exists: false, active: true, discountType: 'percent', value: 10 }
    return {
      exists: true,
      active: data.active !== false,
      discountType: (data.discount_type === 'fixed' ? 'fixed' : 'percent'),
      value: Number(data.value ?? 10),
    }
  } catch {
    return { exists: false, active: true, discountType: 'percent', value: 10 }
  }
}

export interface CouponImpact {
  sellableItems: number
  costedItems: number
  uncostedItems: number         // platos sin escandallo (no computan)
  floorPct: number | null       // suelo de margen de la cuenta
  avgOrder: number | null       // pedido medio real (o estimado)
  effectivePct: number | null   // descuento efectivo sobre el pedido medio
  avgMarginNowPct: number | null
  avgMarginAfterPct: number | null
  minMarginAfterPct: number | null
  itemsBelowFloorAfter: number | null
}

/** Previsualiza el impacto de margen de una bienvenida hipotética (read-only). */
export async function previewCouponImpact(
  accountId: string, discountType: DiscountType, value: number,
): Promise<CouponImpact | null> {
  const { data, error } = await db().rpc('preview_coupon_impact', {
    p_account: accountId, p_discount_type: discountType, p_value: value,
  })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  const num = (x: any) => (x == null ? null : Number(x))
  return {
    sellableItems: Number(row.sellable_items ?? 0),
    costedItems: Number(row.costed_items ?? 0),
    uncostedItems: Number(row.uncosted_items ?? 0),
    floorPct: num(row.floor_pct),
    avgOrder: num(row.avg_order),
    effectivePct: num(row.effective_pct),
    avgMarginNowPct: num(row.avg_margin_now_pct),
    avgMarginAfterPct: num(row.avg_margin_after_pct),
    minMarginAfterPct: num(row.min_margin_after_pct),
    itemsBelowFloorAfter: num(row.items_below_floor_after),
  }
}

/** Guarda la oferta de bienvenida + el suelo de margen de la cuenta. */
export async function saveWelcomeOffer(args: {
  accountId: string
  active: boolean
  discountType: DiscountType
  value: number
  floorPct: number | null
}): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await db().rpc('save_welcome_offer', {
    p_account: args.accountId,
    p_active: args.active,
    p_discount_type: args.discountType,
    p_value: args.value,
    p_floor_pct: args.floorPct,
  })
  if (error) return { ok: false, reason: error.message }
  if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
  return { ok: true }
}

// ── Motor de recompensa por FRECUENCIA (F4·T3) ──────────────────────────────

export interface FrequencyReward {
  exists: boolean
  active: boolean
  threshold: number
  discountType: DiscountType
  value: number
}

/** Lee el motor de frecuencia actual de la cuenta (o defaults si no existe). */
export async function getFrequencyReward(accountId: string): Promise<FrequencyReward> {
  try {
    const { data, error } = await db()
      .from('coupon')
      .select('discount_type,value,active,frequency_threshold')
      .eq('account_id', accountId)
      .eq('kind', 'frequency')
      .limit(1)
      .maybeSingle()
    if (error || !data) return { exists: false, active: true, threshold: 5, discountType: 'percent', value: 10 }
    return {
      exists: true,
      active: data.active !== false,
      threshold: Number(data.frequency_threshold ?? 5),
      discountType: (data.discount_type === 'fixed' ? 'fixed' : 'percent'),
      value: Number(data.value ?? 10),
    }
  } catch {
    return { exists: false, active: true, threshold: 5, discountType: 'percent', value: 10 }
  }
}

/** Guarda el motor de frecuencia (upsert atómico server-side). */
export async function saveFrequencyReward(args: {
  accountId: string
  active: boolean
  threshold: number
  discountType: DiscountType
  value: number
}): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await db().rpc('save_frequency_reward', {
    p_account: args.accountId,
    p_active: args.active,
    p_threshold: args.threshold,
    p_discount_type: args.discountType,
    p_value: args.value,
  })
  if (error) return { ok: false, reason: error.message }
  if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
  return { ok: true }
}
