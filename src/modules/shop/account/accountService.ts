// src/modules/shop/account/accountService.ts
//
// Servicio de "Mi cuenta" del Folvy Shop. Wrappers de las RPCs por TOKEN de sesión
// del comensal (patrón customerAuthService): el token vive en localStorage por slug
// y se pasa a cada RPC SECURITY DEFINER, que valida la sesión server-side. Sin token
// válido las RPCs devuelven { ok:false, reason:'session' }.

import { supabase } from '@/lib/supabase'
import { getStoredSessionToken } from '@/modules/shop/checkout/customerAuthService'
import type { OrderLine } from '@/modules/shop/services/dishConfigService'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface AccountOrderBrand {
  name: string
  logoUrl: string | null
  color: string | null
}

export interface AccountOrderLineMini {
  name: string
  qty: number
  photoUrl: string | null
}

export interface AccountOrder {
  saleId: string
  code: string | null
  date: string                 // ISO
  total: number
  discount: number
  orderStatus: string | null
  mode: 'delivery' | 'pickup' | null
  brands: AccountOrderBrand[]
  lines: AccountOrderLineMini[]
  thumbnailUrl: string | null
}

export interface ReorderPayload {
  locationId: string | null
  mode: 'delivery' | 'pickup'
  lines: OrderLine[]
  // menuItemId -> marca (para poblar el CartPanel tras el reorder).
  brandById: Record<string, { brandId: string | null; brandName: string }>
}

// ── Cupones / bonos ────────────────────────────────────────────────────────

export interface AccountCouponUsed {
  couponId: string
  name: string
  code: string | null
  discountType: 'percent' | 'fixed' | null
  discountValue: number | null
  discountAmount: number
  ts: string                    // ISO
}

export interface AccountCouponAvailable {
  couponId: string
  name: string
  code: string | null
  discountType: 'percent' | 'fixed' | null
  discountValue: number | null
  minSubtotal: number | null
  endsAt: string | null
  autoApply: boolean
  isWelcome: boolean
  eligible: boolean
  reason: string | null         // null (eligible) | not_first | needs_consent | exhausted
}

export interface CustomerCoupons {
  available: AccountCouponAvailable[]
  used: AccountCouponUsed[]
}

export interface CustomerAddress {
  id: string
  label: string | null
  address: string
  detail: string | null
  lat: number | null
  lng: number | null
  isDefault: boolean
}

// ── Histórico ───────────────────────────────────────────────────────────────

export async function getCustomerOrders(slug: string, limit = 20): Promise<AccountOrder[]> {
  const token = getStoredSessionToken(slug)
  if (!token) return []
  try {
    const { data, error } = await db().rpc('customer_orders', { p_token: token, p_limit: limit })
    if (error || !data || data.ok !== true) return []
    return (data.orders ?? []).map((o: any) => ({
      saleId: o.saleId,
      code: o.code ?? null,
      date: o.date,
      total: o.total != null ? Number(o.total) : 0,
      discount: o.discount != null ? Number(o.discount) : 0,
      orderStatus: o.orderStatus ?? null,
      mode: (o.mode ?? null) as 'delivery' | 'pickup' | null,
      brands: (o.brands ?? []).map((b: any) => ({ name: b.name ?? '', logoUrl: b.logoUrl ?? null, color: b.color ?? null })),
      lines: (o.lines ?? []).map((l: any) => ({ name: l.name ?? '', qty: Number(l.qty ?? 1), photoUrl: l.photoUrl ?? null })),
      thumbnailUrl: o.thumbnailUrl ?? null,
    })) as AccountOrder[]
  } catch {
    return []
  }
}

// ── Reorder ──────────────────────────────────────────────────────────────────

export async function getReorderPayload(slug: string, saleId: string): Promise<{ ok: boolean; reason?: string; payload?: ReorderPayload }> {
  const token = getStoredSessionToken(slug)
  if (!token) return { ok: false, reason: 'session' }
  try {
    const { data, error } = await db().rpc('customer_reorder_payload', { p_token: token, p_sale_id: saleId })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    const p = data.payload ?? {}
    return {
      ok: true,
      payload: {
        locationId: p.locationId ?? null,
        mode: (p.mode === 'pickup' ? 'pickup' : 'delivery') as 'delivery' | 'pickup',
        lines: (p.lines ?? []) as OrderLine[],
        brandById: (p.brandById ?? {}) as Record<string, { brandId: string | null; brandName: string }>,
      },
    }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Consentimiento (RGPD 7.3) ─────────────────────────────────────────────────

export async function setAccountConsent(slug: string, consent: boolean): Promise<{ ok: boolean; consented?: boolean; reason?: string }> {
  const token = getStoredSessionToken(slug)
  if (!token) return { ok: false, reason: 'session' }
  try {
    const { data, error } = await db().rpc('customer_set_consent', { p_token: token, p_consent: consent })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, consented: data.consented === true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Perfil ────────────────────────────────────────────────────────────────────

export async function updateProfile(slug: string, name: string, phone: string): Promise<{ ok: boolean; reason?: string }> {
  const token = getStoredSessionToken(slug)
  if (!token) return { ok: false, reason: 'session' }
  try {
    const { data, error } = await db().rpc('customer_update_profile', { p_token: token, p_name: name, p_phone: phone })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Direcciones ───────────────────────────────────────────────────────────────

export async function getAddresses(slug: string): Promise<CustomerAddress[]> {
  const token = getStoredSessionToken(slug)
  if (!token) return []
  try {
    const { data, error } = await db().rpc('customer_addresses', { p_token: token })
    if (error || !data || data.ok !== true) return []
    return (data.addresses ?? []).map((a: any) => ({
      id: a.id,
      label: a.label ?? null,
      address: a.address ?? '',
      detail: a.detail ?? null,
      lat: a.lat != null ? Number(a.lat) : null,
      lng: a.lng != null ? Number(a.lng) : null,
      isDefault: a.isDefault === true,
    })) as CustomerAddress[]
  } catch {
    return []
  }
}

export async function saveAddress(slug: string, args: {
  id?: string | null
  label?: string | null
  address: string
  detail?: string | null
  lat?: number | null
  lng?: number | null
  isDefault?: boolean
}): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const token = getStoredSessionToken(slug)
  if (!token) return { ok: false, reason: 'session' }
  try {
    const { data, error } = await db().rpc('customer_save_address', {
      p_token: token,
      p_id: args.id ?? null,
      p_label: args.label ?? null,
      p_address: args.address,
      p_detail: args.detail ?? null,
      p_lat: args.lat ?? null,
      p_lng: args.lng ?? null,
      p_is_default: args.isDefault ?? false,
    })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, id: data.id ?? undefined }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

export async function deleteAddress(slug: string, id: string): Promise<{ ok: boolean; reason?: string }> {
  const token = getStoredSessionToken(slug)
  if (!token) return { ok: false, reason: 'session' }
  try {
    const { data, error } = await db().rpc('customer_delete_address', { p_token: token, p_id: id })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}

// ── Cupones / bonos ────────────────────────────────────────────────────────

export async function getCustomerCoupons(slug: string): Promise<CustomerCoupons> {
  const token = getStoredSessionToken(slug)
  if (!token) return { available: [], used: [] }
  try {
    const { data, error } = await db().rpc('customer_coupons', { p_token: token })
    if (error || !data || data.ok !== true) return { available: [], used: [] }
    const num = (v: any) => (v != null ? Number(v) : null)
    return {
      available: (data.available ?? []).map((c: any) => ({
        couponId: c.couponId,
        name: c.name ?? '',
        code: c.code ?? null,
        discountType: (c.discountType ?? null) as 'percent' | 'fixed' | null,
        discountValue: num(c.discountValue),
        minSubtotal: num(c.minSubtotal),
        endsAt: c.endsAt ?? null,
        autoApply: c.autoApply === true,
        isWelcome: c.isWelcome === true,
        eligible: c.eligible === true,
        reason: c.reason ?? null,
      })) as AccountCouponAvailable[],
      used: (data.used ?? []).map((c: any) => ({
        couponId: c.couponId,
        name: c.name ?? '',
        code: c.code ?? null,
        discountType: (c.discountType ?? null) as 'percent' | 'fixed' | null,
        discountValue: num(c.discountValue),
        discountAmount: c.discountAmount != null ? Number(c.discountAmount) : 0,
        ts: c.ts,
      })) as AccountCouponUsed[],
    }
  } catch {
    return { available: [], used: [] }
  }
}
