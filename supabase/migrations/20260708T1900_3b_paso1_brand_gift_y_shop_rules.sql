-- 20260708T1900_3b_paso1_brand_gift_y_shop_rules.sql
--
-- v3 · 3b · PASO 1 (aditivo, no toca nada vivo):
--  (a) _shop_brand_free_gift(cuenta, marca): el plato de regalo de UNA marca, para que
--      el display por marca lo muestre. Espejo de _shop_account_free_gift + filtro de marca
--      (el campaign_scope del regalo apunta a un menu_item, que tiene brand_id).
--  (b) offers_agent_config.shop_rules jsonb: ancla de las REGLAS por marca/tipo que editará
--      el formulario "automático pero con reglas" (rangos de %, tope Happy Hour, on/off del
--      regalo, mínimos, etc.). Se lee opcionalmente; null = comportamiento por defecto.
--
-- Ninguno de los dos cambia el cobro ni el storefront todavía (eso es el paso 2 y 3).

-- (a) Regalo por marca (solo lectura, para el display).
create or replace function public._shop_brand_free_gift(p_account uuid, p_brand uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', mi.name, 'min', c.min_subtotal, 'value', mi.price)
  from coupon c
  join campaign_scope sc on sc.coupon_id = c.id and sc.menu_item_id is not null
  join menu_item mi on mi.id = sc.menu_item_id and mi.account_id = p_account
    and mi.brand_id = p_brand
    and mi.archived_at is null and mi.is_active is not false and mi.is_available is not false
  where c.account_id = p_account and c.active and c.kind = 'free_item'
    and c.auto_apply and c.paused_at is null
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at   is null or c.ends_at   >  now())
    and 'shop' = any(c.channels)
    and (c.weekdays  is null or extract(isodow from (now() at time zone 'Europe/Madrid'))::smallint = any(c.weekdays))
    and (c.time_from is null or (now() at time zone 'Europe/Madrid')::time >= c.time_from)
    and (c.time_to   is null or (now() at time zone 'Europe/Madrid')::time <= c.time_to)
    and (c.budget_max is null or (
          select coalesce(sum(cr.discount_amount), 0) from coupon_redemption cr
          join sale s on s.id = cr.sale_id
          where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
        ) < c.budget_max)
  order by c.created_at desc
  limit 1;
$$;

revoke all on function public._shop_brand_free_gift(uuid, uuid) from public;
grant execute on function public._shop_brand_free_gift(uuid, uuid) to anon, authenticated, service_role;

-- (b) Reglas del Shop por cuenta (para el formulario). jsonb libre; el agente lo lee opcional.
alter table public.offers_agent_config
  add column if not exists shop_rules jsonb;
