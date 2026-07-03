-- 20260703T2620_hub_bogo_badge.sql
-- Aplicada: (pendiente)
--
-- G2c A3.3 (1) — El badge de marca del HUB debe encender también con campañas
-- BOGO, y el BOGO GANA al % en el texto ("2x1" vende más que "−20%").
--
-- _shop_brand_best_offer pasa a devolver 'kind' + prioridad bogo > item_percent:
--   bogo         -> {kind:'bogo', pct: max(value), multi}
--   item_percent -> {kind:'item_percent', pct: max(value), multi}
--   nada         -> null
-- Mismo predicado ventana/franja/canal/presupuesto/scope que ya tenía (por marca,
-- categoría o plato de la marca). Reproducción fiel + rama bogo. Misma firma
-- (CREATE OR REPLACE, sin DROP). No se prueba en la tx que la crea.

begin;

create or replace function public._shop_brand_best_offer(p_account uuid, p_brand uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    -- BOGO gana (más promocional).
    (select case when count(*) > 0
                 then jsonb_build_object('kind', 'bogo', 'pct', max(c.value), 'multi', count(*) > 1)
                 else null end
     from coupon c
     where c.account_id = p_account and c.active and c.kind = 'bogo' and c.paused_at is null
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
       and exists (
         select 1 from campaign_scope sc
         where sc.coupon_id = c.id
           and (
             sc.brand_id = p_brand
             or sc.menu_category_id in (select mc.id from menu_category mc where mc.brand_id = p_brand and mc.account_id = p_account)
             or sc.menu_item_id     in (select mi.id from menu_item     mi where mi.brand_id = p_brand and mi.account_id = p_account)
           )
       )),
    -- item_percent.
    (select case when count(*) > 0
                 then jsonb_build_object('kind', 'item_percent', 'pct', max(c.value), 'multi', count(*) > 1)
                 else null end
     from coupon c
     where c.account_id = p_account and c.active and c.kind = 'item_percent' and c.paused_at is null
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
       and exists (
         select 1 from campaign_scope sc
         where sc.coupon_id = c.id
           and (
             sc.brand_id = p_brand
             or sc.menu_category_id in (select mc.id from menu_category mc where mc.brand_id = p_brand and mc.account_id = p_account)
             or sc.menu_item_id     in (select mi.id from menu_item     mi where mi.brand_id = p_brand and mi.account_id = p_account)
           )
       ))
  );
$function$;

commit;
