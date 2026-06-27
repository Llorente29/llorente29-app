// src/admin/services/stripeConnectService.ts
//
// Servicio del panel admin para conectar la cuenta Stripe de un restaurante y
// fijar su comisión del Shop. Autocontenido: NO toca el CRUD genérico de cuentas.
//
//   getStripeState(accountId)        → estado actual (conectada, opera, fee).
//   startStripeOnboarding(accountId) → Edge crea/continúa onboarding; abre la URL.
//   refreshStripeState(accountId)    → Edge recupera el estado real desde Stripe.
//   setShopFeeBps(accountId, bps)    → guarda la comisión (puntos básicos).
//
// El onboarding y el refresh pasan por la Edge stripe-connect-onboard (valida
// platform_admin). El fee se escribe directo (RLS de accounts permite a admin).

import { supabase } from '@/lib/supabase'

function db() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export interface StripeState {
  /** Tiene cuenta conectada de Stripe (acct_…). */
  connected: boolean
  /** La cuenta conectada ya puede cobrar (onboarding verificado). */
  chargesEnabled: boolean
  /** El restaurante completó el formulario (puede faltar verificación de Stripe). */
  detailsSubmitted: boolean
  /** id acct_… (informativo). */
  stripeAccountId: string | null
  /** Comisión del Shop en puntos básicos (500 = 5%). */
  feeBps: number
}

/** Lee el estado de Stripe Connect de la cuenta (lectura directa; RLS admin). */
export async function getStripeState(accountId: string): Promise<StripeState> {
  const { data, error } = await db()
    .from('accounts')
    .select('stripe_account_id, stripe_charges_enabled, stripe_details_submitted, shop_fee_bps')
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el estado de Stripe: ${error.message}`)
  const row = (data ?? {}) as Record<string, unknown>
  return {
    connected: !!row.stripe_account_id,
    chargesEnabled: row.stripe_charges_enabled === true,
    detailsSubmitted: row.stripe_details_submitted === true,
    stripeAccountId: (row.stripe_account_id as string | null) ?? null,
    feeBps: Number(row.shop_fee_bps ?? 0),
  }
}

export interface OnboardingResult { ok: boolean; url?: string; error?: string }

/**
 * Inicia (o continúa) el onboarding de Stripe del restaurante. La Edge crea la
 * cuenta conectada si no existe y devuelve la URL del onboarding hospedado.
 */
export async function startStripeOnboarding(accountId: string): Promise<OnboardingResult> {
  const { data, error } = await db().functions.invoke('stripe-connect-onboard', {
    body: { action: 'create_link', accountId },
  })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') { const p = await ctx.json(); msg = p?.error ?? msg }
    } catch { /* ignore */ }
    return { ok: false, error: msg }
  }
  if (!data || data.ok !== true || !data.url) return { ok: false, error: data?.error ?? 'Sin URL de onboarding.' }
  return { ok: true, url: data.url as string }
}

export interface RefreshResult { ok: boolean; chargesEnabled?: boolean; detailsSubmitted?: boolean; error?: string }

/** Recupera el estado real desde Stripe y lo persiste (charges_enabled, etc.). */
export async function refreshStripeState(accountId: string): Promise<RefreshResult> {
  const { data, error } = await db().functions.invoke('stripe-connect-onboard', {
    body: { action: 'refresh_status', accountId },
  })
  if (error) return { ok: false, error: error.message }
  if (!data || data.ok !== true) return { ok: false, error: data?.error ?? 'error' }
  return { ok: true, chargesEnabled: data.chargesEnabled === true, detailsSubmitted: data.detailsSubmitted === true }
}

/** Fija la comisión del Shop (puntos básicos). Escritura directa (RLS admin). */
export async function setShopFeeBps(accountId: string, feeBps: number): Promise<void> {
  const clamped = Math.max(0, Math.min(10000, Math.round(feeBps)))
  const { error } = await db().from('accounts').update({ shop_fee_bps: clamped }).eq('id', accountId)
  if (error) throw new Error(`No se pudo guardar la comisión: ${error.message}`)
}

// ── Métodos de pago del Shop (configurables por cuenta) ─────────────────

export interface ShopPaymentMethods {
  /** Acepta pago online (tarjeta/Bizum vía Stripe). */
  online: boolean
  /** Acepta efectivo al recoger (pickup). */
  cashPickup: boolean
  /** Acepta efectivo contra entrega (delivery). */
  cashDelivery: boolean
}

/** Lee qué métodos de pago acepta el Shop de la cuenta (lectura directa, RLS admin). */
export async function getShopPaymentMethods(accountId: string): Promise<ShopPaymentMethods> {
  const { data, error } = await db()
    .from('accounts')
    .select('shop_pay_online, shop_pay_cash_pickup, shop_pay_cash_delivery')
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw new Error(`No se pudieron leer los métodos de pago: ${error.message}`)
  const row = (data ?? {}) as Record<string, unknown>
  return {
    online: row.shop_pay_online !== false,
    cashPickup: row.shop_pay_cash_pickup === true,
    cashDelivery: row.shop_pay_cash_delivery === true,
  }
}

/** Guarda los métodos de pago del Shop. Escritura directa (RLS admin). */
export async function setShopPaymentMethods(accountId: string, m: ShopPaymentMethods): Promise<void> {
  const { error } = await db().from('accounts').update({
    shop_pay_online: m.online,
    shop_pay_cash_pickup: m.cashPickup,
    shop_pay_cash_delivery: m.cashDelivery,
  }).eq('id', accountId)
  if (error) throw new Error(`No se pudieron guardar los métodos de pago: ${error.message}`)
}
