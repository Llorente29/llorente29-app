// supabase/functions/stripe-connect-onboard/index.ts
//
// Onboarding de Stripe Connect para un restaurante (cuenta cliente de Folvy).
// Lo dispara un platform_admin desde la ficha de cliente del panel.
//
// Acciones (body.action):
//   'create_link'    -> si la cuenta no tiene stripe_account_id, crea la cuenta
//                       conectada Standard por API y la guarda; genera un Account
//                       Link (onboarding hospedado de Stripe) y devuelve su URL.
//   'refresh_status' -> recupera la cuenta de Stripe y guarda charges_enabled /
//                       details_submitted en accounts (estado real del onboarding).
//
// GUARD: exige JWT de platform_admin (claim folvy.is_platform_admin), idéntico a
// create-account/map-products/etc. Se despliega SIN --no-verify-jwt (lo llama un
// admin autenticado; el gateway exige JWT y aquí validamos que sea admin).
//
// La cuenta conectada se crea con la clave de la PLATAFORMA (STRIPE_SECRET_KEY),
// garantizando que cuelga de nuestra plataforma (no de un sandbox del panel).

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

interface FolvyClaims { is_platform_admin?: boolean }

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Base de la app para los retornos del onboarding. En live debe ser HTTPS.
const APP_BASE_URL = 'https://app.folvy.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // 1. Guard platform_admin
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(401, { error: 'Missing Authorization header' })
  const folvy = decodeFolvyClaims(authHeader.replace('Bearer ', ''))
  if (!folvy || folvy.is_platform_admin !== true) {
    return json(403, { error: 'Solo platform admins pueden gestionar Stripe Connect' })
  }

  // 2. Payload
  let body: { action?: string; accountId?: string; returnPath?: string }
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }
  const action = body.action
  const accountId = body.accountId
  if (!accountId) return json(400, { error: 'accountId requerido' })
  if (action !== 'create_link' && action !== 'refresh_status') {
    return json(400, { error: 'action debe ser create_link o refresh_status' })
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE)

  // 3. Cargar la cuenta
  const { data: acc, error: accErr } = await sb
    .from('accounts')
    .select('id, name, slug, billing_email, country, stripe_account_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accErr) return json(500, { error: `DB: ${accErr.message}` })
  if (!acc) return json(404, { error: 'Cuenta no encontrada' })

  try {
    if (action === 'refresh_status') {
      if (!acc.stripe_account_id) {
        return json(200, { ok: true, connected: false, chargesEnabled: false, detailsSubmitted: false })
      }
      const sa = await stripeGet(`/v1/accounts/${acc.stripe_account_id}`)
      const chargesEnabled = sa.charges_enabled === true
      const detailsSubmitted = sa.details_submitted === true
      await sb.from('accounts').update({
        stripe_charges_enabled: chargesEnabled,
        stripe_details_submitted: detailsSubmitted,
      }).eq('id', accountId)
      return json(200, {
        ok: true, connected: true,
        chargesEnabled, detailsSubmitted,
        accountId: acc.stripe_account_id,
      })
    }

    // action === 'create_link'
    let connectedId = acc.stripe_account_id as string | null

    if (!connectedId) {
      // Crear la cuenta conectada Standard con la clave de la plataforma.
      const created = await stripePost('/v1/accounts', {
        type: 'standard',
        country: (acc.country as string) || 'ES',
        email: (acc.billing_email as string) || '',
        'business_profile[name]': acc.name as string,
      })
      connectedId = created.id
      await sb.from('accounts').update({ stripe_account_id: connectedId }).eq('id', accountId)
    }

    // Account Link de onboarding (URL temporal de un solo uso).
    const base = `${APP_BASE_URL}/_admin/cuentas/${accountId}`
    const link = await stripePost('/v1/account_links', {
      account: connectedId!,
      refresh_url: `${base}?stripe=refresh`,
      return_url: `${base}?stripe=return`,
      type: 'account_onboarding',
    })

    return json(200, { ok: true, url: link.url, accountId: connectedId })
  } catch (e) {
    return json(502, { error: `Stripe: ${(e as Error).message}` })
  }
})

// ── Stripe REST (fetch, sin SDK) ────────────────────────────────────────

async function stripePost(path: string, fields: Record<string, string>): Promise<any> {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.set(k, v)
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
  return data
}

async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
  return data
}

// ── Helpers ─────────────────────────────────────────────────────────────

function decodeFolvyClaims(jwt: string): FolvyClaims | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(payloadB64))
    return payload.folvy ?? null
  } catch {
    return null
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
