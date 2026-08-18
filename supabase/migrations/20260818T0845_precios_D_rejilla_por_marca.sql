-- ============================================================================
-- ENCARGO CODE "Rejilla de precios" (18/08/2026) - lado servidor
-- ============================================================================
-- ADITIVO. NO toca ninguna funcion de economia: menu_item_channel_economics se
-- LLAMA, no se modifica. Su md5 sigue siendo a3600331debb4402709f2f05e43ac173.
-- NO se divide entre 1,21 ninguna comision.
--
-- POR QUE EXISTE: el criterio 1 del encargo pide la marca entera en UNA sola
-- llamada y por debajo de 1,5 s. menu_item_channel_economics es POR PRODUCTO;
-- llamarla 27-43 veces desde el navegador son decenas de idas y vueltas. Esto es
-- el mismo lateral join, medido en ~570 ms para una marca entera.
--
-- LO QUE APORTA ADEMAS (y es lo importante del encargo, su §3): marca cada fila
-- con policy_allowed. menu_item_channel_economics devuelve las 11 combinaciones
-- de canal x modalidad que existen en channel_rate, pero varias NO PUEDEN
-- ocurrir. La peor es uber/own_delivery: sale al 12 % sin coste de rider y sin
-- fijo, asi que da el MEJOR margen de la pantalla (66,4 % en un producto real)
-- y es imposible -- channel_delivery_policy dice "Uber Eats reparte SIEMPRE
-- Uber, tambien en marcas propias". Si la rejilla la pintara, la columna mas
-- atractiva de la pantalla seria una que no existe.
--
-- LA REGLA, exacta: para canales de REPARTO (channel_type='delivery') y
-- modalidades de reparto (own_delivery / platform_delivery), solo vale la
-- modalidad que channel_delivery_policy declara para el ownership_type de la
-- marca. La recogida (pickup) y el mostrador NO dependen de esa politica: no los
-- reparte nadie. Si un canal de reparto no tiene politica declarada, sus filas
-- salen con policy_allowed=false y su motivo, para que la pantalla lo DIGA en
-- vez de adivinar.

create or replace function public.brand_price_grid(
  p_brand_id    uuid,
  p_location_id uuid  default null,
  p_overrides   jsonb default null   -- { "<menu_item_id>": { "<channel_id>": precio } }
)
returns table (
  menu_item_id     uuid,
  menu_item_name   text,
  category_id      uuid,
  category_name    text,
  product_type     text,
  base_price       numeric,
  channel_id       uuid,
  channel_name     text,
  channel_type     text,
  service_type     text,
  price            numeric,
  price_source     text,
  is_location_override boolean,
  is_available     boolean,
  vat_rate         numeric,
  cost_available   boolean,
  net_margin       numeric,
  net_margin_pct   numeric,
  contribution_margin_pct numeric,
  orders_30d       integer,
  policy_allowed   boolean,
  policy_reason    text
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with marca as (
    select b.id, b.account_id, coalesce(b.ownership_type, 'own') as ownership_type
    from brand b where b.id = p_brand_id
  ),
  productos as (
    select mi.id, mi.name, mi.menu_category_id, mi.product_type, mi.price
    from menu_item mi, marca m
    where mi.brand_id = m.id
      and mi.account_id = m.account_id
      and mi.is_active is not false
  )
  select
    p.id, p.name, p.menu_category_id, mc.name, p.product_type, p.price,
    e.channel_id, e.channel_name, e.channel_type, e.service_type,
    e.price, e.price_source, e.is_location_override, e.is_available, e.vat_rate,
    e.cost_available, e.net_margin, e.net_margin_pct, e.contribution_margin_pct,
    e.orders_30d,
    -- ── policy_allowed ───
    case
      when e.channel_type <> 'delivery' then true
      when e.service_type is null or e.service_type = 'pickup' then true
      else exists (
        select 1
        from channel_delivery_policy pol
        join sales_channel sc
          on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id
          and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type
          and pol.service_type = e.service_type)
    end,
    case
      when e.channel_type <> 'delivery' then null
      when e.service_type is null or e.service_type = 'pickup' then null
      when exists (
        select 1 from channel_delivery_policy pol
        join sales_channel sc on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type and pol.service_type = e.service_type)
        then null
      when exists (
        select 1 from channel_delivery_policy pol
        join sales_channel sc on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type)
        then 'La politica de reparto de este canal dice otra modalidad para marcas '
             || m.ownership_type || '.'
      else 'Sin politica de reparto declarada para este canal y tipo de marca. No se adivina.'
    end
  from productos p
  cross join marca m
  left join menu_category mc on mc.id = p.menu_category_id
  cross join lateral menu_item_channel_economics(
    p.id,
    case when p_overrides is null then null else p_overrides -> (p.id::text) end,
    p_location_id) e;
$$;

comment on function public.brand_price_grid(uuid, uuid, jsonb) is
  'Rejilla de precios de una marca en UNA llamada. Envuelve menu_item_channel_economics (no la modifica) y marca con policy_allowed las combinaciones canal x modalidad que channel_delivery_policy no permite -- p.ej. uber/own_delivery, que da el mejor margen de la pantalla y es imposible.';

revoke all on function public.brand_price_grid(uuid, uuid, jsonb) from anon;
grant execute on function public.brand_price_grid(uuid, uuid, jsonb) to authenticated;
