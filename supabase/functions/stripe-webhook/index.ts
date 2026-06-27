// supabase/functions/stripe-webhook/index.ts
//
// Webhook de Stripe para el Folvy Shop. Confirma el pedido SERVER-SIDE cuando
// Stripe certifica el pago, en lugar de fiarse del navegador.
//
//   payment_intent.succeeded      -> mark_shop_order_paid  -> order_status 'new'->'accepted'
//                                     (ese cambio dispara impresión + Catcher)
//   payment_intent.payment_failed -> mark_shop_order_failed (no toca el pedido)
//
// SEGURIDAD: se verifica la FIRMA de Stripe con STRIPE_WEBHOOK_SECRET sobre el
// cuerpo CRUDO (constructEventAsync + cryptoProvider, obligatorio en Deno). Sin
// firma válida se rechaza con 400: nadie puede falsificar un "pago".
//
// Se despliega con --no-verify-jwt (lo llama Stripe, sin sesión); la seguridad
// la da la firma, no el JWT.

import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
})
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const body = await req.text()  // cuerpo CRUDO: la verificación lo necesita sin parsear
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!signature || !secret) {
    return new Response('missing signature/secret', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider)
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 })
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      const { data, error } = await supabase.rpc('mark_shop_order_paid', {
        p_payment_intent_id: pi.id,
        p_amount_cents: pi.amount_received ?? pi.amount ?? null,
      })
      if (error) console.error('mark_shop_order_paid error', error.message)
      else console.log('paid', JSON.stringify(data))
    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent
      const { error } = await supabase.rpc('mark_shop_order_failed', { p_payment_intent_id: pi.id })
      if (error) console.error('mark_shop_order_failed error', error.message)
    }
    // Otros eventos: ignorados (200) para que Stripe no reintente.
  } catch (e) {
    console.error('webhook handler error', String(e))
    // 200 igualmente: el evento se verificó; un fallo interno no debe provocar
    // reintentos infinitos de Stripe. Se observa por logs.
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
