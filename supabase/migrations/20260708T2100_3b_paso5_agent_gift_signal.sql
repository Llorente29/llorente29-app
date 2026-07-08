-- 20260708T2100_3b_paso5_agent_gift_signal.sql
--
-- v3 · 3b · PASO 5 (base de datos):
--  (a) agent_gift_signal: por marca, el plato MÁS BARATO de regalar (coste real =
--      computed_cost + packaging) y el food-cost-ratio (fcr) medio de la marca sobre
--      platos CON coste real. Con eso el agente calcula el mínimo de pedido que mantiene
--      el margen ≥ suelo tras regalar. Donde el coste aún es basura, fcr sale alto/negativo
--      → el agente no crea regalo (se auto-rechaza). Sin inventar nada.
--  (b) retire_stale_agent_shop_offers: la rotación diaria ahora limpia también los
--      regalos (free_item), no solo los item_percent.

create or replace function public.agent_gift_signal(p_account_id uuid)
returns table (
  brand_id     uuid,
  gift_item_id uuid,
  gift_name    text,
  gift_cost    numeric,
  fcr          numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with valid as (
    select mi.brand_id, mi.id, mi.name, mi.price,
           ri.computed_cost + coalesce(mi.packaging_cost, 0) as full_cost
    from menu_item mi
    join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.account_id = p_account_id
      and mi.archived_at is null and mi.is_active is not false and mi.is_available is not false
      and ri.computed_cost is not null and ri.computed_cost > 0 and mi.price > 0
  ),
  fcr as (
    select brand_id, avg(full_cost / nullif(price, 0)) as fcr
    from valid group by brand_id
  ),
  cheapest as (
    select distinct on (brand_id) brand_id, id, name, full_cost
    from valid order by brand_id, full_cost asc
  )
  select c.brand_id, c.id, c.name, round(c.full_cost, 4), round(f.fcr, 4)
  from cheapest c join fcr f on f.brand_id = c.brand_id;
$$;

revoke all on function public.agent_gift_signal(uuid) from public;
grant execute on function public.agent_gift_signal(uuid) to service_role;

-- Rotación diaria: ahora incluye también los regalos (free_item).
create or replace function public.retire_stale_agent_shop_offers(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_n   integer;
begin
  select array_agg(id) into v_ids
  from coupon
  where account_id = p_account_id
    and origin = 'agent'
    and active = false
    and kind in ('item_percent', 'free_item')
    and 'shop' = any(channels)
    and (created_at at time zone 'Europe/Madrid')::date
        < (now() at time zone 'Europe/Madrid')::date;

  if v_ids is null then return 0; end if;

  delete from campaign_scope where coupon_id = any(v_ids);
  delete from coupon         where id = any(v_ids);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
