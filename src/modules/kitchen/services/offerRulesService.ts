// src/modules/kitchen/services/offerRulesService.ts
//
// Reglas del agente de ofertas del Shop (v3 · paso 4b): lee/escribe
// offers_agent_config.shop_rules (jsonb). "Automático pero con reglas": el agente
// (offers-agent) ya lee esta estructura; aquí solo se edita. El suelo de margen 45%
// es intocable por encima de cualquier regla (lo garantiza el agente, no esta pantalla).

import { supabase } from '@/lib/supabase'

function db(): any {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase as any
}

export const OFFER_STATES = ['lanzamiento', 'urgente', 'crecimiento', 'mantenimiento'] as const
export type OfferState = typeof OFFER_STATES[number]

export interface DefaultRules {
  bands: Record<OfferState, number[]>
  happy_hour: { enabled: boolean; max_pct: number }
  gift: { enabled: boolean; min_floor: number; min_cap: number }
}

export interface BrandOverride {
  bands?: Partial<Record<OfferState, number[]>>
  happy_hour?: { enabled?: boolean; max_pct?: number }
  gift?: { enabled?: boolean; min_floor?: number; min_cap?: number }
}

export interface ShopRules {
  default: DefaultRules
  brands: Record<string, BrandOverride>
}

export interface BrandBasic { id: string; name: string }

/** Defaults que replican lo que el agente hace hoy hardcodeado (si shop_rules es null). */
export const DEFAULT_RULES: DefaultRules = {
  bands: {
    lanzamiento: [25, 20, 15],
    urgente: [30, 25],
    crecimiento: [25, 20, 15],
    mantenimiento: [20, 15, 10],
  },
  happy_hour: { enabled: true, max_pct: 40 },
  gift: { enabled: true, min_floor: 12, min_cap: 30 },
}

export async function getShopRules(accountId: string): Promise<{ rules: ShopRules; hasRow: boolean }> {
  const { data } = await db()
    .from('offers_agent_config').select('shop_rules').eq('account_id', accountId).maybeSingle()
  const raw = (data?.shop_rules ?? null) as Partial<ShopRules> | null
  const rules: ShopRules = {
    default: {
      bands: { ...DEFAULT_RULES.bands, ...(raw?.default?.bands ?? {}) },
      happy_hour: { ...DEFAULT_RULES.happy_hour, ...(raw?.default?.happy_hour ?? {}) },
      gift: { ...DEFAULT_RULES.gift, ...(raw?.default?.gift ?? {}) },
    },
    brands: (raw?.brands ?? {}) as Record<string, BrandOverride>,
  }
  return { rules, hasRow: !!data }
}

export async function saveShopRules(accountId: string, rules: ShopRules): Promise<void> {
  // Limpia overrides de marca vacíos para no dejar basura en el jsonb.
  const brands: Record<string, BrandOverride> = {}
  for (const [bid, ov] of Object.entries(rules.brands)) {
    const clean: BrandOverride = {}
    if (ov.bands && Object.keys(ov.bands).length > 0) clean.bands = ov.bands
    if (ov.happy_hour && Object.values(ov.happy_hour).some((v) => v !== undefined)) clean.happy_hour = ov.happy_hour
    if (ov.gift && Object.values(ov.gift).some((v) => v !== undefined)) clean.gift = ov.gift
    if (Object.keys(clean).length > 0) brands[bid] = clean
  }
  const payload: ShopRules = { default: rules.default, brands }
  const { error } = await db()
    .from('offers_agent_config').update({ shop_rules: payload, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
  if (error) throw new Error(`No se pudieron guardar las reglas: ${error.message}`)
}

export async function listBrandsBasic(accountId: string): Promise<BrandBasic[]> {
  const { data } = await db()
    .from('brand').select('id, name').eq('account_id', accountId).eq('is_active', true).order('name')
  return (data ?? []) as BrandBasic[]
}

/** "25, 20, 15" → [25,20,15]. Vacío → null (usa default). */
export function parseBand(s: string): number[] | null {
  const arr = s.split(/[,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0)
  return arr.length > 0 ? arr : null
}
