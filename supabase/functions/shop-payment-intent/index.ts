// supabase/functions/shop-payment-intent/index.ts
//
// Crea el cobro de un pedido del Folvy Shop con Stripe Connect (DIRECT CHARGE):
// el PaymentIntent se crea SOBRE la cuenta conectada del restaurante (cabecera
// Stripe-Account), por lo que el dinero aterriza en su cuenta; Folvy se lleva su
// comisión vía application_fee_amount. El comensal pagará con el Payment Element
// (tarjeta + Bizum) usando el client_secret que devuelve esta función.
//
// Seguridad: la clave secreta de la PLATAFORMA vive en el secret STRIPE_SECRET_KEY
// y nunca sale de aquí. El importe se toma del total YA REPRECIADO de la venta
// (no del cliente). La confirmación del pedido (new -> recibido) la hace el
// webhook payment_intent.succeeded, no el front.
//
// Llamada (desde el front, con la anon key de Supabase):
//   POST { saleId }
//   -> { ok, clientSecret, connectedAccountId, amount, currency, paymentIntentId }

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
    const { saleId } = await req.json().catch(() => ({}))
    if (!saleId) return json({ ok: false, reason: 'missing_sale' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Venta (importe = total ya repreciado en servidor)
    const { data: sale, error: saleErr } = await supabase
      .from('sale')
      .select('id, account_id, total, status, order_status, platform_order_code, stripe_payment_intent_id')
      .eq('id', saleId)
      .single()
    if (saleErr || !sale) return json({ ok: false, reason: 'sale_not_found' }, 404)

    // Cuenta conectada del restaurante + comisión configurada
    const { data: account } = await supabase
      .from('accounts')
      .select('id, stripe_account_id, shop_fee_bps')
      .eq('id', sale.account_id)
      .single()
    if (!account?.stripe_account_id) {
      return json({ ok: false, reason: 'account_not_connected' }, 400)
    }

    const amountCents = Math.round(Number(sale.total) * 100)
    if (!(amountCents > 0)) return json({ ok: false, reason: 'invalid_amount' }, 400)

    const feeBps = Number(account.shop_fee_bps ?? 0)
    const feeCents = feeBps > 0 ? Math.floor((amountCents * feeBps) / 10000) : 0

    const secret = Deno.env.get('STRIPE_SECRET_KEY')
    if (!secret) return json({ ok: false, reason: 'stripe_not_configured' }, 500)

    // PaymentIntent — DIRECT CHARGE (cabecera Stripe-Account = cuenta conectada)
    const form = new URLSearchParams()
    form.set('amount', String(amountCents))
    form.set('currency', 'eur')
    form.set('automatic_payment_methods[enabled]', 'true')  // tarjeta + Bizum salen solos
    form.set('metadata[sale_id]', sale.id)
    if (sale.platform_order_code) form.set('metadata[order_code]', sale.platform_order_code)
    // application_fee debe ser > 0 y < importe del cargo
    if (feeCents > 0 && feeCents < amountCents) {
      form.set('application_fee_amount', String(feeCents))
    }

    const resp = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Account': account.stripe_account_id,
      },
      body: form.toString(),
    })
    const pi = await resp.json()
    if (!resp.ok) {
      return json({ ok: false, reason: 'stripe_error', detail: pi?.error?.message ?? null }, 400)
    }

    // Marca la venta como pendiente de pago por Stripe (guarda el PI)
    await supabase
      .from('sale')
      .update({ payment_method: 'stripe', stripe_payment_intent_id: pi.id })
      .eq('id', sale.id)

    return json({
      ok: true,
      clientSecret: pi.client_secret,
      connectedAccountId: account.stripe_account_id,
      amount: amountCents,
      currency: 'eur',
      paymentIntentId: pi.id,
    })
  } catch (e) {
    return json({ ok: false, reason: 'exception', detail: String(e) }, 500)
  }
})
