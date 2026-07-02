-- 20260702T2200_welcome_offer_config.sql
-- Aplicada: (pendiente)
--
-- F3 sub-paso 5 — Configuración de la oferta de BIENVENIDA por cuenta, con
-- IMPACTO DE MARGEN REAL al decidir (golpe nº1 de Folvy: el margen delante).
--
-- (1) preview_coupon_impact(account, discount_type, value): read-only. Devuelve,
--     sobre la carta vendible de la cuenta, el margen medio ANTES y DESPUÉS de la
--     bienvenida, cuántos platos caen bajo el suelo, cuántos no tienen escandallo,
--     y el DESCUENTO EFECTIVO que el valor supone sobre el PEDIDO MEDIO real del
--     Shop (clave para comparar "20% vs 4€": un fijo de 4€ sobre un ticket medio
--     de 30€ ≈ 13%). Modelo unificado por una fracción efectiva f:
--        percent -> f = value/100
--        fixed   -> f = min(value, pedido_medio) / pedido_medio
--     Margen por plato = (precio − coste)/precio, BRUTO, idéntico al guardarraíl
--     que aplica place_shop_order (no netea IVA) para que el preview no mienta.
--
-- (2) save_welcome_offer(account, active, discount_type, value, floor_pct):
--     upsert del cupón de bienvenida canónico (auto_apply + first_order_only) +
--     fija el suelo de margen en accounts. Atómico, respeta el índice único de
--     "un solo auto activo por cuenta".
--
-- SECURITY DEFINER con guard por pertenencia (current_user_account_ids). Como en
-- SQL Editor auth.uid() es null, NO probar aquí: verificar desde la app (sesión).

create or replace function public.preview_coupon_impact(
  p_account uuid, p_discount_type text, p_value numeric
) returns table(
  sellable_items int, costed_items int, uncosted_items int,
  floor_pct numeric, avg_order numeric, effective_pct numeric,
  avg_margin_now_pct numeric, avg_margin_after_pct numeric,
  min_margin_after_pct numeric, items_below_floor_after int
)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_floor     numeric;
  v_avg_order numeric;
  v_f         numeric;  -- fracción efectiva de descuento (0..1)
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;

  select shop_coupon_margin_floor_pct into v_floor from accounts where id = p_account;

  -- Pedido medio real del Shop; si no hay pedidos aún, aprox = precio medio de
  -- platos costeados × 3 (un ticket típico de tres artículos).
  select avg(total) into v_avg_order
  from sale
  where account_id = p_account and source = 'folvy_shop'
    and coalesce(status,'') <> 'cancelled' and total is not null;

  if v_avg_order is null or v_avg_order <= 0 then
    select avg(mi.price) * 3 into v_avg_order
    from menu_item mi join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.account_id = p_account and coalesce(mi.is_active,true) and mi.archived_at is null
      and mi.price > 0 and ri.computed_cost is not null;
  end if;

  if p_discount_type = 'percent' then
    v_f := greatest(0, least(1, coalesce(p_value,0) / 100.0));
  elsif p_discount_type = 'fixed' and v_avg_order is not null and v_avg_order > 0 then
    v_f := greatest(0, least(1, coalesce(p_value,0) / v_avg_order));
  else
    v_f := null;  -- fijo sin pedido medio: no estimable
  end if;

  return query
  with items as (
    select mi.price::numeric as price,
           (coalesce(ri.computed_cost,0) + coalesce(mi.packaging_cost,0))::numeric as cost,
           (mi.recipe_item_id is not null and ri.computed_cost is not null) as costed
    from menu_item mi
    left join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.account_id = p_account
      and coalesce(mi.is_active,true) and mi.archived_at is null
  ),
  costed as (
    select price, cost,
           (price - cost)/nullif(price,0) as m_now,
           case when v_f is null then null
                else (price*(1-v_f) - cost)/nullif(price*(1-v_f),0) end as m_after
    from items where costed and price > 0
  )
  select
    (select count(*)::int from items),
    (select count(*)::int from items where costed),
    (select count(*)::int from items where not costed),
    v_floor,
    round(v_avg_order,2),
    case when v_f is null then null else round(v_f*100,1) end,
    round((select avg(m_now)   from costed)*100, 1),
    case when v_f is null then null else round((select avg(m_after) from costed)*100, 1) end,
    case when v_f is null then null else round((select min(m_after) from costed)*100, 1) end,
    case when v_f is null or v_floor is null then null
         else (select count(*) from costed where m_after*100 < v_floor)::int end;
end;
$$;

grant execute on function public.preview_coupon_impact(uuid, text, numeric) to authenticated;


create or replace function public.save_welcome_offer(
  p_account uuid, p_active boolean, p_discount_type text, p_value numeric, p_floor_pct numeric
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;
  if p_discount_type not in ('percent','fixed') then raise exception 'bad_type'; end if;
  if p_value is null or p_value <= 0 then raise exception 'bad_value'; end if;
  if p_discount_type = 'percent' and p_value > 100 then raise exception 'bad_percent'; end if;
  if p_floor_pct is not null and (p_floor_pct < 0 or p_floor_pct > 100) then raise exception 'bad_floor'; end if;

  -- Cupón de bienvenida canónico de la cuenta: auto_apply + first_order_only.
  select id into v_id from coupon
  where account_id = p_account and auto_apply and first_order_only
  limit 1;

  if v_id is null then
    insert into coupon (account_id, name, code, discount_type, value, applies_to,
                        auto_apply, first_order_only, max_per_customer, min_subtotal, active, created_by)
    values (p_account, 'Bienvenida', null, p_discount_type, p_value, 'subtotal',
            true, true, 1, null, coalesce(p_active,true), auth.uid())
    returning id into v_id;
  else
    update coupon set discount_type = p_discount_type, value = p_value,
                      active = coalesce(p_active,true), updated_at = now()
    where id = v_id;
  end if;

  update accounts set shop_coupon_margin_floor_pct = p_floor_pct where id = p_account;

  return jsonb_build_object('ok', true, 'couponId', v_id);
end;
$$;

grant execute on function public.save_welcome_offer(uuid, boolean, text, numeric, numeric) to authenticated;
