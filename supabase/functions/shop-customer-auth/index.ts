// supabase/functions/shop-customer-auth/index.ts
//
// Login del comensal en su tienda del Folvy Shop por CÓDIGO MÁGICO (OTP).
// Pública (anon-callable, como shop-payment-intent). Usa la service-role SOLO
// dentro de la función; el comensal NUNCA es auth.users (sesión propia por token).
//
// Dos acciones:
//   { action: 'request', slug, email }
//     -> customer_request_login (acuña OTP) -> send-email (plantilla shop_login_code)
//     -> { ok } (nunca revela si el email existe ni el código)
//   { action: 'verify', slug, email, code }
//     -> customer_verify_login (valida OTP, crea sesión) -> { ok, sessionToken, name, email }
//
// El código en claro NO sale nunca al cliente: la RPC lo devuelve a esta función,
// que lo envía por email y descarta. El front solo recibe ok/sessionToken.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const slug = String(body.slug ?? '').trim()
    const email = String(body.email ?? '').trim()

    if (!slug || !email) return json({ ok: false, reason: 'missing' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Solicitar código ────────────────────────────────────────────────
    if (action === 'request') {
      const { data, error } = await supabase.rpc('customer_request_login', {
        p_slug: slug, p_email: email,
      })
      if (error) return json({ ok: false, reason: 'rpc' }, 500)

      // rate_limited / email inválido: devolvemos ok genérico salvo rate limit,
      // para no revelar si el email existe (privacidad). Pero sí cortamos abuso.
      if (!data?.ok) {
        if (data?.reason === 'rate_limited') return json({ ok: false, reason: 'rate_limited' }, 429)
        // email/account inválidos: respondemos ok igualmente (no filtrar).
        return json({ ok: true })
      }

      // Nombre y logo comercial de la tienda para personalizar el correo.
      const { data: acc } = await supabase
        .from('accounts').select('name, logo_url').eq('slug', slug).single()

      // Enviar el código por email (send-email con service-role vía x-internal-key).
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const emailResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'x-internal-key': serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: email,
          template: 'shop_login_code',
          data: {
            code: data.code,
            tienda: acc?.name ?? 'tu tienda',
            logoUrl: acc?.logo_url ?? '',
            nombre: data.name ?? '',
          },
        }),
      })
      if (!emailResp.ok) {
        console.error('[shop-customer-auth] send-email failed', await emailResp.text())
        return json({ ok: false, reason: 'email_failed' }, 502)
      }
      return json({ ok: true })
    }

    // ── Verificar código ────────────────────────────────────────────────
    if (action === 'verify') {
      const code = String(body.code ?? '').trim()
      if (!code) return json({ ok: false, reason: 'missing_code' }, 400)

      const { data, error } = await supabase.rpc('customer_verify_login', {
        p_slug: slug, p_email: email, p_code: code, p_ttl_days: 90,
      })
      if (error) return json({ ok: false, reason: 'rpc' }, 500)
      if (!data?.ok) return json({ ok: false, reason: data?.reason ?? 'bad_code' }, 400)

      return json({
        ok: true,
        sessionToken: data.sessionToken,
        name: data.name ?? null,
        email: data.email,
      })
    }

    return json({ ok: false, reason: 'bad_action' }, 400)
  } catch (e) {
    return json({ ok: false, reason: 'exception', detail: String(e) }, 500)
  }
})
