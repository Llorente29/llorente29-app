-- 20260703T2650_hub_bogo_badge_fix.sql
-- Aplicada: (pendiente)
--
-- FIX BUG A3.3 — _shop_brand_best_offer VIVO era la versión vieja (solo
-- item_percent, sin 'kind' ni rama bogo): el badge del hub no encendía con un 2x1
-- vivo aunque la carta sí (item_rpc OK, hub_rpc NULL). La 2620 no quedó efectiva en
-- la BBDD (no aplicada o pisada por re-aplicar una migración anterior que también
-- define esta función). Regla del playbook: NO se edita la 2620 aplicada -> este fix
-- va en migración NUEVA que re-establece la versión con bogo.
--
-- Verificado en vivo: la campaña bogo (AGUA 50 CL, cuenta 51ad1792) casa TODAS las
-- condiciones del subquery (scope por menu_item->brand incluido); el fallo era solo
-- que el cuerpo vivo no tenía la rama bogo. Las dos marcas 'Bendito Burrito' son
-- RUIDO: están en cuentas distintas (una publicada, otra no), el bogo está en la
-- publicada; no hay cruce.
--
-- Prioridad bogo > item_percent + 'kind'. Reproducción fiel del predicado vivo +
-- rama bogo. Misma firma (CREATE OR REPLACE, sin DROP). No se prueba aquí.

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
