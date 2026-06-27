-- 20260627T2200_shop_payment_status.sql
-- Aplicada: (pendiente)
--
-- Confirmación server-side del pago del Folvy Shop (webhook payment_intent.succeeded).
--   sale.payment_status : 'pending' | 'paid' | 'failed' | 'refunded'
--   sale.paid_at        : sello del pago confirmado por Stripe
--   mark_shop_order_paid(pi_id, amount) : localiza la venta por su PaymentIntent
--     y, si sigue 'new' y sin pagar, la marca pagada y la mueve a 'accepted'
--     (ese cambio de order_status dispara impresión + Catcher por los triggers
--     ya existentes). Idempotente: si ya está paid, no hace nada.
--   mark_shop_order_failed(pi_id) : marca el pago fallido sin tocar el pedido.

alter table public.sale
  add column if not exists payment_status text,
  add column if not exists paid_at timestamptz;

alter table public.sale drop constraint if exists sale_payment_status_valid;
alter table public.sale add constraint sale_payment_status_valid
  check (payment_status is null or payment_status = any (array['pending','paid','failed','refunded']));


create or replace function public.mark_shop_order_paid(p_payment_intent_id text, p_amount_cents bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale sale%rowtype;
begin
  select * into v_sale from sale
  where stripe_payment_intent_id = p_payment_intent_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'sale_not_found');
  end if;

  -- idempotente: ya estaba pagada
  if coalesce(v_sale.payment_status,'') = 'paid' then
    return jsonb_build_object('ok', true, 'already', true, 'saleId', v_sale.id);
  end if;

  update sale
  set payment_status = 'paid',
      paid_at = now(),
      -- mover a 'accepted' SOLO si seguía 'new' (no pisar estados posteriores)
      order_status = case when order_status = 'new' then 'accepted' else order_status end
  where id = v_sale.id;

  return jsonb_build_object('ok', true, 'already', false, 'saleId', v_sale.id);
end;
$$;


create or replace function public.mark_shop_order_failed(p_payment_intent_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale sale%rowtype;
begin
  select * into v_sale from sale
  where stripe_payment_intent_id = p_payment_intent_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'sale_not_found');
  end if;

  -- no tocar un pedido que ya se pagó
  if coalesce(v_sale.payment_status,'') = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'saleId', v_sale.id);
  end if;

  update sale set payment_status = 'failed' where id = v_sale.id;
  return jsonb_build_object('ok', true, 'saleId', v_sale.id);
end;
$$;

revoke all on function public.mark_shop_order_paid(text, bigint) from public, anon, authenticated;
revoke all on function public.mark_shop_order_failed(text) from public, anon, authenticated;
