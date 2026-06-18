// src/admin/services/pricingService.ts
//
// Service del catálogo de precios (Portal de staff → Planes y precios).
// Lee/escribe vía RPCs (list_pricing, set_plan_pricing, set_submodule_price).

import { supabase } from '../../lib/supabase'

export interface PlanPricing {
  id: string
  code: string
  name: string
  basePriceEur: number
  perLocationPrice: number
  maxLocations: number   // 0 = ilimitado
  billingCycle: string
}

export interface AddonPricing {
  id: string
  code: string
  name: string
  module: string
  priceEur: number
}

export type MutationResult = { ok: true } | { ok: false; error: string }

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function listPricing(): Promise<{ plans: PlanPricing[]; addons: AddonPricing[] }> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('list_pricing')
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as { plans?: unknown[]; addons?: unknown[] }
  const plans = ((d.plans ?? []) as Array<Record<string, unknown>>).map(p => ({
    id: p.id as string,
    code: p.code as string,
    name: p.name as string,
    basePriceEur: Number(p.base_price_eur ?? 0),
    perLocationPrice: Number(p.per_location_price ?? 0),
    maxLocations: Number(p.max_locations ?? 0),
    billingCycle: (p.billing_cycle as string) ?? 'monthly',
  }))
  const addons = ((d.addons ?? []) as Array<Record<string, unknown>>).map(a => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    module: (a.module as string) ?? '',
    priceEur: Number(a.price_eur ?? 0),
  }))
  return { plans, addons }
}

export async function setPlanPricing(
  planId: string, basePriceEur: number, perLocationPrice: number, maxLocations: number,
): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('set_plan_pricing', {
      p_plan_id: planId,
      p_base_price_eur: basePriceEur,
      p_per_location_price: perLocationPrice,
      p_max_locations: maxLocations,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setSubmodulePrice(submoduleId: string, priceEur: number): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('set_submodule_price', { p_submodule_id: submoduleId, p_price_eur: priceEur })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Descuentos por cliente (capa de precios P-C) ───────────────────────────

export interface AccountDiscount {
  id: string
  discountType: 'percent' | 'fixed'
  value: number
  note: string | null
  validUntil: string | null   // ISO o null (sin caducidad)
  active: boolean
  createdAt: string
}

export async function getAccountDiscount(accountId: string): Promise<AccountDiscount | null> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('get_account_discount', { p_account_id: accountId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    id: d.id as string,
    discountType: d.discount_type as 'percent' | 'fixed',
    value: Number(d.value ?? 0),
    note: (d.note as string) ?? null,
    validUntil: (d.valid_until as string) ?? null,
    active: Boolean(d.active),
    createdAt: d.created_at as string,
  }
}

export async function setAccountDiscount(
  accountId: string,
  discountType: 'percent' | 'fixed',
  value: number,
  note: string | null,
  validUntil: string | null,
): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('set_account_discount', {
      p_account_id: accountId,
      p_discount_type: discountType,
      p_value: value,
      p_note: note ?? undefined,
      p_valid_until: validUntil ?? undefined,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function clearAccountDiscount(accountId: string): Promise<MutationResult> {
  try {
    const sb = requireSupabase()
    const { error } = await sb.rpc('clear_account_discount', { p_account_id: accountId })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
