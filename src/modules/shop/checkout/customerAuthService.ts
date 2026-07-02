// src/modules/shop/checkout/customerAuthService.ts
//
// Login del comensal en su tienda (código mágico OTP + sesión persistente).
// El comensal NO es auth.users: su sesión es un token propio (customer_session)
// guardado en el dispositivo. Tras el primer acceso, entra directo sin re-pedir
// código hasta logout/caducidad/dispositivo nuevo.
//
// Flujo:
//   requestLoginCode(slug, email)         -> Edge shop-customer-auth (envía OTP)
//   verifyLoginCode(slug, email, code)    -> Edge (valida, crea sesión) -> token
//   getSessionCustomer(slug)              -> RPC customer_session_me por token
//   logoutCustomer(slug)                  -> RPC customer_logout + limpia local

import { supabase } from '@/lib/supabase'

function db() {
  if (!supabase) throw new Error('Supabase no disponible')
  return supabase as any
}

// El token de sesión se guarda por tienda (slug), porque el cliente es por cuenta.
function sessionKey(slug: string): string { return `folvy_shop_session_${slug}` }

export function getStoredSessionToken(slug: string): string | null {
  try { return localStorage.getItem(sessionKey(slug)) } catch { return null }
}
function storeSessionToken(slug: string, token: string) {
  try { localStorage.setItem(sessionKey(slug), token) } catch { /* modo privado: sesión no persiste */ }
}
function clearSessionToken(slug: string) {
  try { localStorage.removeItem(sessionKey(slug)) } catch { /* noop */ }
}

export interface SessionCustomer {
  customerId: string
  name: string | null
  email: string | null
  phone: string | null
  consented: boolean
}

/** Paso 1: pedir el código de acceso (se envía por email). */
export async function requestLoginCode(slug: string, email: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await db().functions.invoke('shop-customer-auth', {
      body: { action: 'request', slug, email },
    })
    if (error) return { ok: false, reason: 'network' }
    return { ok: data?.ok === true, reason: data?.reason }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

/** Paso 2: verificar el código; si es correcto, guarda la sesión persistente. */
export async function verifyLoginCode(slug: string, email: string, code: string): Promise<{ ok: boolean; reason?: string; name?: string | null }> {
  try {
    const { data, error } = await db().functions.invoke('shop-customer-auth', {
      body: { action: 'verify', slug, email, code },
    })
    if (error) return { ok: false, reason: 'network' }
    if (data?.ok !== true || !data?.sessionToken) return { ok: false, reason: data?.reason ?? 'bad_code' }
    storeSessionToken(slug, data.sessionToken)
    return { ok: true, name: data.name ?? null }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

/** Devuelve el cliente logueado en esta tienda, o null si no hay sesión válida. */
export async function getSessionCustomer(slug: string): Promise<SessionCustomer | null> {
  const token = getStoredSessionToken(slug)
  if (!token) return null
  try {
    const { data, error } = await db().rpc('customer_session_me', { p_token: token })
    if (error || !data || data.ok !== true) {
      // Sesión inválida/caducada: limpiamos para no reintentar en bucle.
      if (data && data.ok === false) clearSessionToken(slug)
      return null
    }
    return {
      customerId: data.customerId,
      name: data.name ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      consented: data.consented === true,
    }
  } catch {
    return null
  }
}

/** Cierra la sesión del comensal en esta tienda. */
export async function logoutCustomer(slug: string): Promise<void> {
  const token = getStoredSessionToken(slug)
  clearSessionToken(slug)
  if (!token) return
  try { await db().rpc('customer_logout', { p_token: token }) } catch { /* noop */ }
}

/**
 * Registra (o retira) el consentimiento de marketing EN EL MOMENTO en que el
 * comensal marca/desmarca la casilla del Club, sin esperar al pago. Pública por
 * slug (el comensal no está autenticado). El servidor aplica las reglas legales:
 * sin email válido no hace nada; desmarcar sin cliente previo no crea nada; solo
 * marcar (acción afirmativa) crea el contacto; loguea solo los cambios.
 */
export async function registerShopConsent(args: {
  slug: string
  email: string
  name?: string
  phone?: string
  consent: boolean
}): Promise<{ ok: boolean; consented?: boolean; reason?: string }> {
  try {
    const { data, error } = await db().rpc('register_shop_consent', {
      p_slug: args.slug,
      p_email: args.email,
      p_name: args.name ?? null,
      p_phone: args.phone ?? null,
      p_consent: args.consent,
      p_terms_version: 'shop-privacy-v1',
    })
    if (error) return { ok: false, reason: error.message }
    if (!data || data.ok !== true) return { ok: false, reason: data?.reason ?? 'error' }
    return { ok: true, consented: data.consented === true }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'error' }
  }
}
