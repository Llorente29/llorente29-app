// src/modules/shop/admin/campaignRulesService.ts
//
// G2d sub-lote 4 — Servicio de las REGLAS del motor de campañas. CRUD directo sobre
// campaign_rule / campaign_rule_firing (protegidas por RLS de miembro). La creación
// de campañas la hace el evaluador (pg_cron); aquí solo se gestionan las reglas y se
// lee/acusa la auditoría (visibilidad).

import { supabase } from '@/lib/supabase'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

export type RuleTrigger = 'hourly_valley' | 'weak_brand' | 'stalled_dish'
export type RuleOfferKind = 'item_percent' | 'bogo'

export interface CampaignRule {
  id: string
  name: string
  triggerType: RuleTrigger
  condition: Record<string, number>
  actionTemplate: { kind: RuleOfferKind; value: number; name?: string }
  brandId: string | null
  locationId: string | null
  menuItemId: string | null
  active: boolean
  budgetMax: number
  cooldownMinutes: number
  maxActive: number
  durationMinutes: number
  lastFiredAt: string | null
}

export interface RuleFiring {
  id: string
  ruleId: string
  couponId: string | null
  couponName: string | null
  firedAt: string
  reason: Record<string, unknown>
  acknowledgedAt: string | null
}

function toRule(r: any): CampaignRule {
  return {
    id: r.id,
    name: r.name ?? '',
    triggerType: (r.trigger_type ?? 'hourly_valley') as RuleTrigger,
    condition: (r.condition ?? {}) as Record<string, number>,
    actionTemplate: {
      kind: (r.action_template?.kind === 'bogo' ? 'bogo' : 'item_percent') as RuleOfferKind,
      value: Number(r.action_template?.value ?? 10),
      name: r.action_template?.name ?? undefined,
    },
    brandId: r.brand_id ?? null,
    locationId: r.location_id ?? null,
    menuItemId: r.menu_item_id ?? null,
    active: r.active !== false,
    budgetMax: Number(r.budget_max ?? 0),
    cooldownMinutes: Number(r.cooldown_minutes ?? 1440),
    maxActive: Number(r.max_active ?? 1),
    durationMinutes: Number(r.duration_minutes ?? 240),
    lastFiredAt: r.last_fired_at ?? null,
  }
}

export async function listRules(accountId: string): Promise<CampaignRule[]> {
  try {
    const { data, error } = await db().from('campaign_rule').select('*').eq('account_id', accountId).order('created_at', { ascending: false })
    if (error || !Array.isArray(data)) return []
    return (data as any[]).map(toRule)
  } catch { return [] }
}

export interface SaveRuleArgs {
  id?: string | null
  name: string
  triggerType: RuleTrigger
  condition: Record<string, number>
  actionTemplate: { kind: RuleOfferKind; value: number; name?: string }
  brandId?: string | null
  locationId?: string | null
  menuItemId?: string | null
  budgetMax: number
  cooldownMinutes: number
  maxActive: number
  durationMinutes: number
}

export async function saveRule(accountId: string, a: SaveRuleArgs): Promise<{ ok: boolean; reason?: string }> {
  const row = {
    account_id: accountId,
    name: a.name,
    trigger_type: a.triggerType,
    condition: a.condition,
    action_template: a.actionTemplate,
    brand_id: a.brandId ?? null,
    location_id: a.locationId ?? null,
    menu_item_id: a.menuItemId ?? null,
    budget_max: a.budgetMax,
    cooldown_minutes: a.cooldownMinutes,
    max_active: a.maxActive,
    duration_minutes: a.durationMinutes,
    updated_at: new Date().toISOString(),
  }
  try {
    if (a.id) {
      const { error } = await db().from('campaign_rule').update(row).eq('id', a.id)
      if (error) return { ok: false, reason: error.message }
    } else {
      const { error } = await db().from('campaign_rule').insert(row)
      if (error) return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (e: any) { return { ok: false, reason: e?.message ?? 'error' } }
}

export async function toggleRule(id: string, active: boolean): Promise<{ ok: boolean }> {
  try {
    const { error } = await db().from('campaign_rule').update({ active, updated_at: new Date().toISOString() }).eq('id', id)
    return { ok: !error }
  } catch { return { ok: false } }
}

export async function deleteRule(id: string): Promise<{ ok: boolean }> {
  try {
    const { error } = await db().from('campaign_rule').delete().eq('id', id)
    return { ok: !error }
  } catch { return { ok: false } }
}

export async function listRuleFirings(accountId: string, limit = 30): Promise<RuleFiring[]> {
  try {
    const { data, error } = await db().from('campaign_rule_firing')
      .select('id,rule_id,coupon_id,fired_at,reason,acknowledged_at, coupon:coupon_id(name)')
      .eq('account_id', accountId).order('fired_at', { ascending: false }).limit(limit)
    if (error || !Array.isArray(data)) return []
    return (data as any[]).map((f) => ({
      id: f.id, ruleId: f.rule_id, couponId: f.coupon_id ?? null,
      couponName: f.coupon?.name ?? null, firedAt: f.fired_at,
      reason: (f.reason ?? {}) as Record<string, unknown>, acknowledgedAt: f.acknowledged_at ?? null,
    }))
  } catch { return [] }
}

// Contador de disparos SIN ver esta semana (para el banner de visibilidad).
export async function countUnackedFirings(accountId: string): Promise<number> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { count, error } = await db().from('campaign_rule_firing')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId).is('acknowledged_at', null).gte('fired_at', weekAgo)
    if (error) return 0
    return count ?? 0
  } catch { return 0 }
}

export async function acknowledgeFirings(accountId: string): Promise<void> {
  try {
    await db().from('campaign_rule_firing')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('account_id', accountId).is('acknowledged_at', null)
  } catch { /* ignore */ }
}
