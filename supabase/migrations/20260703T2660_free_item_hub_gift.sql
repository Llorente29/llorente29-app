-- 20260703T2660_free_item_hub_gift.sql
-- Aplicada: (pendiente)
--
-- G2c sub-lote B3 (servidor) — el hub expone el PLATO DE REGALO de la cuenta, para
-- que el carrito pinte la barrita "Te faltan X € para tu [plato] de regalo" (espejo
-- del envío gratis). Requiere 2630 (free_item en el modelo/gestor).
--
--   (1) _shop_account_free_gift(cuenta): clon de _shop_account_free_delivery para
--       kind='free_item'. Devuelve {name, min, value} del regalo activo (auto,
--       ventana/franja/presupuesto) o NULL.
--   (2) shop_hub_by_slug emite 'free_gift' junto a 'free_delivery'. Se regenera
--       desde el texto VIVO (pg_get_functiondef) + replace() anclado, con guarda
--       (aborta si el ancla no aparece) e idempotencia. No transcribo el feed.
--
-- No se prueba en la tx que la crea.

begin;

-- (1) Regalo activo de la cuenta (espejo de _shop_account_free_delivery).
create or replace function public._shop_account_free_gift(p_account uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object('name', mi.name, 'min', c.min_subtotal, 'value', mi.price)
  from coupon c
  join campaign_scope sc on sc.coupon_id = c.id and sc.menu_item_id is not null
  join menu_item mi on mi.id = sc.menu_item_id and mi.account_id = p_account
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
$function$;

grant execute on function public._shop_account_free_gift(uuid) to authenticated;

-- (2) shop_hub_by_slug: emite 'free_gift' junto a 'free_delivery' (regenerado del vivo).
do $mig$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.shop_hub_by_slug(text)'::regprocedure);
  if position('_shop_account_free_gift' in v_def) > 0 then
    raise notice 'B3: free_gift ya presente en shop_hub_by_slug; nada que hacer.';
    return;
  end if;
  v_def := replace(v_def,
    $a$    'free_delivery', public._shop_account_free_delivery(v_account_id),$a$,
    $r$    'free_delivery', public._shop_account_free_delivery(v_account_id),
    'free_gift', public._shop_account_free_gift(v_account_id),$r$);
  if position('_shop_account_free_gift' in v_def) = 0 then
    raise exception 'B3: ancla free_delivery no encontrada en shop_hub_by_slug';
  end if;
  execute v_def;
  raise notice 'B3: free_gift añadido a shop_hub_by_slug.';
end
$mig$;

commit;
