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

export type CampaignKind = 'standard' | 'frequency' | 'item_percent' | 'free_delivery' | 'bogo' | 'free_item'

export interface Campaign {
  id: string
  name: string
  code: string | null
  kind: CampaignKind
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
  budgetMax: number | null
  weekdays: number[] | null
  timeFrom: string | null      // 'HH:MM:SS'
  timeTo: string | null
  status: CampaignStatus
  isSystem: boolean
  redemptions: number         // canjes VIVOS
  discounted: number          // € descontado (vivos)
  avgMarginPct: number | null // margen medio real de los canjes vivos
  roi: number | null          // margen conocido / descuento (null si no hay margen)
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
      kind: (c.kind ?? 'standard') as CampaignKind,
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
      budgetMax: num(c.budgetMax),
      weekdays: Array.isArray(c.weekdays) ? c.weekdays.map((n: any) => Number(n)) : null,
      timeFrom: c.timeFrom ?? null,
      timeTo: c.timeTo ?? null,
      status: (c.status ?? 'active') as CampaignStatus,
      isSystem: c.isSystem === true,
      redemptions: Number(c.redemptions ?? 0),
      discounted: Number(c.discounted ?? 0),
      avgMarginPct: num(c.avgMarginPct),
      roi: num(c.roi),
    })) as Campaign[]
  } catch {
    return []
  }
}

// Alcance de un item_percent: cada elemento apunta a marca, categoría o plato.
export interface ScopeRef { type: 'brand' | 'category' | 'item'; id: string }

export interface SaveCampaignArgs {
  id?: string | null
  kind: CampaignKind
  name: string
  code?: string | null
  discountType?: DiscountType
  value?: number
  minSubtotal?: number | null
  startsAt?: string | null      // ISO
  endsAt?: string | null        // ISO
  maxRedemptions?: number | null
  maxPerCustomer?: number | null
  weekdays?: number[] | null    // 1=lun..7=dom; null=todos
  timeFrom?: string | null      // 'HH:MM'
  timeTo?: string | null
  budgetMax?: number | null
  scope?: ScopeRef[]            // solo item_percent
}

export async function saveCampaign(accountId: string, args: SaveCampaignArgs): Promise<{ ok: boolean; id?: string; reason?: string }> {
  try {
    const { data, error } = await db().rpc('save_campaign', {
      p_account: accountId,
      p_id: args.id ?? null,
      p_kind: args.kind,
      p_name: args.name,
      p_code: args.code ?? null,
      p_discount_type: args.discountType ?? 'percent',
      p_value: args.value ?? 0,
      p_min_subtotal: args.minSubtotal ?? null,
      p_starts_at: args.startsAt ?? null,
      p_ends_at: args.endsAt ?? null,
      p_max_redemptions: args.maxRedemptions ?? null,
      p_max_per_customer: args.maxPerCustomer ?? null,
      p_weekdays: args.weekdays ?? null,
      p_time_from: args.timeFrom ?? null,
      p_time_to: args.timeTo ?? null,
      p_budget_max: args.budgetMax ?? null,
      p_scope: args.scope ? (args.scope as unknown as object) : null,
    })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, id: data.id ?? undefined }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Árbol de carta para el picker de alcance + impacto de margen ────────────

export interface TreeItem { id: string; name: string; price: number; cost: number | null; costed: boolean; refPrice: number | null }
export interface TreeCategory { id: string; name: string; items: TreeItem[] }
export interface TreeBrand { id: string; name: string; categories: TreeCategory[] }
export interface CampaignMenuTree { floorPct: number | null; brands: TreeBrand[] }

export async function getCampaignMenuTree(accountId: string): Promise<CampaignMenuTree> {
  try {
    const { data, error } = await db().rpc('campaign_menu_tree', { p_account: accountId })
    if (error || !data) return { floorPct: null, brands: [] }
    const num = (v: any) => (v != null ? Number(v) : null)
    return {
      floorPct: num(data.floorPct),
      brands: (data.brands ?? []).map((b: any) => ({
        id: b.id, name: b.name ?? '',
        categories: (b.categories ?? []).map((c: any) => ({
          id: c.id, name: c.name ?? '',
          items: (c.items ?? []).map((i: any) => ({
            id: i.id, name: i.name ?? '', price: Number(i.price ?? 0),
            cost: num(i.cost), costed: i.costed === true, refPrice: num(i.refPrice),
          })),
        })),
      })),
    }
  } catch {
    return { floorPct: null, brands: [] }
  }
}

// Alcance actual de un item_percent (lectura directa por RLS de miembros).
export async function getCampaignScope(couponId: string): Promise<ScopeRef[]> {
  try {
    const { data, error } = await db().from('campaign_scope')
      .select('brand_id,menu_category_id,menu_item_id').eq('coupon_id', couponId)
    if (error || !Array.isArray(data)) return []
    return (data as any[]).map((r) =>
      r.menu_item_id ? { type: 'item' as const, id: r.menu_item_id }
      : r.menu_category_id ? { type: 'category' as const, id: r.menu_category_id }
      : { type: 'brand' as const, id: r.brand_id }
    )
  } catch {
    return []
  }
}

export async function createMirrorItem(accountId: string, itemId: string): Promise<{ ok: boolean; id?: string; reason?: string }> {
  try {
    const { data, error } = await db().rpc('create_mirror_item', { p_account: accountId, p_item: itemId })
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

// Eliminar una campaña de código/oferta. El servidor rechaza sistema y, si tiene
// canjes, devuelve reason 'has_redemptions' (el histórico es dato: solo se pausa).
export async function deleteCampaign(accountId: string, id: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await db().rpc('delete_campaign', { p_account: accountId, p_id: id })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// Mensaje legible de por qué NO se pudo eliminar.
export function deleteCampaignError(reason: string | undefined): string {
  switch (reason) {
    case 'has_redemptions': return 'Esta campaña tiene canjes: su rendimiento es historial y no se borra. Puedes pausarla.'
    case 'system':          return 'Las campañas de sistema no se eliminan: se configuran en Diseño de la tienda.'
    case 'not_found':       return 'La campaña ya no existe.'
    case 'forbidden':       return 'No tienes permiso sobre esta campaña.'
    default:                return 'No se pudo eliminar. Inténtalo de nuevo.'
  }
}

// ── Rendimiento de una campaña (G2e) ────────────────────────────────────────
export interface PerfSeriesPoint { day: string; redemptions: number; discounted: number; salesEur: number }
export interface CampaignPerformance {
  kind: CampaignKind
  redemptions: number
  discounted: number
  salesCount: number
  salesEur: number
  ticketWith: number | null
  ticketWithout: number | null
  marginReal: number | null      // sum margin_after conocido; null si ningún canje lo tiene
  marginKnown: number            // canjes con margen
  marginMissing: number          // canjes sin margen (deuda de escandallo)
  giftCosted: boolean            // free_item: el regalo tiene escandallo
  cost: number                   // descuentos (o coste real del regalo en free_item)
  roi: number | null             // margen / coste
  series: PerfSeriesPoint[]
}

export async function getCampaignPerformance(
  accountId: string, couponId: string, from: string | null, to: string | null,
): Promise<CampaignPerformance | null> {
  try {
    const { data, error } = await db().rpc('campaign_performance', {
      p_account: accountId, p_coupon: couponId, p_from: from, p_to: to,
    })
    if (error || !data || data.ok !== true) return null
    const num = (v: any) => (v != null ? Number(v) : null)
    return {
      kind: (data.kind ?? 'standard') as CampaignKind,
      redemptions: Number(data.redemptions ?? 0),
      discounted: Number(data.discounted ?? 0),
      salesCount: Number(data.salesCount ?? 0),
      salesEur: Number(data.salesEur ?? 0),
      ticketWith: num(data.ticketWith),
      ticketWithout: num(data.ticketWithout),
      marginReal: num(data.marginReal),
      marginKnown: Number(data.marginKnown ?? 0),
      marginMissing: Number(data.marginMissing ?? 0),
      giftCosted: data.giftCosted === true,
      cost: Number(data.cost ?? 0),
      roi: num(data.roi),
      series: Array.isArray(data.series) ? data.series.map((p: any) => ({
        day: p.day, redemptions: Number(p.redemptions ?? 0),
        discounted: Number(p.discounted ?? 0), salesEur: Number(p.salesEur ?? 0),
      })) : [],
    }
  } catch {
    return null
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
    case 'bad_budget':    return 'El presupuesto debe ser mayor que 0.'
    case 'bad_kind':      return 'Tipo de campaña no válido.'
    case 'scope_required': return 'Elige a qué platos se aplica (marca, categoría o platos).'
    case 'min_required':    return 'Pon el mínimo del pedido para el regalo (“desde X €”).'
    case 'gift_item_required': return 'Elige exactamente un plato de regalo.'
    case 'free_delivery_exists': return 'Ya tienes un envío gratis automático. Edítalo en lugar de crear otro.'
    case 'free_item_exists': return 'Ya tienes un plato de regalo automático. Edítalo en lugar de crear otro.'
    case 'system':        return 'Esta campaña es de sistema: edítala en Diseño de la tienda.'
    case 'not_found':     return 'La campaña ya no existe.'
    default:              return 'No se pudo guardar. Inténtalo de nuevo.'
  }
}
