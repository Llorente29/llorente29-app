-- 20260703T2000_customer_coupons.sql
-- Aplicada: (pendiente)
--
-- F4·T2 — RPC customer_coupons(p_token): tarjetero de "Mis bonos". Valida SOLO el
-- token de customer_session (patrón exacto de 20260703T1010). Devuelve:
--   { ok, available[], used[] }
--
-- used[]     — canjes del cliente (coupon_redemption join coupon).
-- available[]— cupones activos de la cuenta, con su estado calculado REPLICANDO la
--              cascada de validación de place_shop_order (20260702T2100), SIN el
--              chequeo de 'min' (aquí no hay carrito/subtotal). Orden de la cascada
--              idéntico al de place_shop_order:
--                needs_consent (bienvenida sin marketing_email) -> not_first ->
--                exhausted -> per_customer.
--              Los 'per_customer' NO se devuelven en available (ya están en used);
--              los demás sí, con su reason (la UI los atenúa).
--
-- NOTA: 'needs_consent' es el equivalente de 'needs_contact' del checkout pero para
-- un comensal ya logueado (siempre tiene email): lo que le falta es el consentimiento
-- de marketing. No se inventan validaciones nuevas: es la MISMA condición
-- (bienvenida AND no consent) de la cascada, nombrada para este contexto.
--
-- No se prueba en la tx que la crea (verificación desde la app, punto 4 del encargo).

begin;

create or replace function public.customer_coupons(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer   uuid;
  v_acc        uuid;
  v_has_consent boolean;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select marketing_email into v_has_consent from customer_consent where customer_id = v_customer;
  v_has_consent := coalesce(v_has_consent, false);

  return jsonb_build_object(
    'ok', true,

    -- ── Usados ──────────────────────────────────────────────────────────
    'used', coalesce((
      select jsonb_agg(jsonb_build_object(
               'couponId',       c.id,
               'name',           c.name,
               'code',           c.code,
               'discountType',   c.discount_type,
               'discountValue',  c.value,
               'discountAmount', cr.discount_amount,
               'ts',             cr.ts)
             order by cr.ts desc)
      from coupon_redemption cr
      join coupon c on c.id = cr.coupon_id
      where cr.customer_id = v_customer
    ), '[]'::jsonb),

    -- ── Disponibles (cascada calcada de place_shop_order, sin 'min') ─────
    'available', coalesce((
      select jsonb_agg(jsonb_build_object(
               'couponId',      c.id,
               'name',          c.name,
               'code',          c.code,
               'discountType',  c.discount_type,
               'discountValue', c.value,
               'minSubtotal',   c.min_subtotal,
               'endsAt',        c.ends_at,
               'autoApply',     c.auto_apply,
               'isWelcome',     (c.first_order_only or c.auto_apply),
               'eligible',      (r.reason is null),
               'reason',        r.reason)
             order by (r.reason is null) desc, c.created_at)
      from coupon c
      cross join lateral (
        select case
          when (c.first_order_only or c.auto_apply) and not v_has_consent
            then 'needs_consent'
          when c.first_order_only and exists (
                 select 1 from sale s
                 where s.customer_id = v_customer and coalesce(s.status,'') <> 'cancelled'
               )
            then 'not_first'
          when c.max_redemptions is not null and (
                 select count(*) from coupon_redemption cr where cr.coupon_id = c.id
               ) >= c.max_redemptions
            then 'exhausted'
          when (
                 select count(*) from coupon_redemption cr
                 where cr.coupon_id = c.id and cr.customer_id = v_customer
               ) >= c.max_per_customer
            then 'per_customer'
          else null
        end as reason
      ) r
      where c.account_id = v_acc and c.active
        and (c.starts_at is null or c.starts_at <= now())
        and (c.ends_at   is null or c.ends_at   >  now())
        and r.reason is distinct from 'per_customer'   -- los usados por tope viven en used[]
    ), '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.customer_coupons(text) to anon, authenticated;

commit;
