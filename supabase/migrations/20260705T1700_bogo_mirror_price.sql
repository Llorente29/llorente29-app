-- 20260705T1700_bogo_mirror_price.sql
-- MOTOR DE OFERTAS v2.1 · T1 — CEREBRO DEL 2x1-ESPEJO (05/07/2026).
-- Táctica validada empíricamente por Julio (Meraki: 2x1 permanente a sobreprecio = ventas ×6).
-- La RPC calcula, por plato×canal, el precio del ARTÍCULO ESPEJO que hace rentable un 2x1:
--   · precio_paridad  = el espejo con el que el 2x1 deja los MISMOS € de margen que vender
--                       una unidad normal (N = N1 + FC/(1-k)) — la sugerencia por defecto;
--   · precio_min_suelo = el mínimo que respeta el suelo de margen % (guardarraíl);
--   · precio_sugerido  = greatest(paridad, suelo), redondeado ARRIBA a 0,10;
--   · status: ok / inviable (el sugerido >= 2×PVP: el cliente ya no ahorra) / sin_escandallo.
-- MISMA MECÁNICA que preview_platform_promo_impact (copiada de su definición viva, no
-- reimplementada): precio sin IVA -> PVP con IVA, comisión de channel_rate con
-- commission_base ('pvp_sin_iva' o PVP), regla factura (comisión sobre lo PAGADO),
-- margen sobre ingreso neto. En un 2x1 el cliente paga 1 espejo y se sirven 2 unidades:
--   ingreso neto N = P/(1+iva) · comisión = k·N (k absorbe la base) · coste = 2×food_cost.
-- El espejo además es Ómnibus-correcto por construcción (historial de precio propio).

begin;

create or replace function public.preview_bogo_mirror_price(
  p_account_id uuid,
  p_channel_id uuid,
  p_brand_id uuid,
  p_margin_floor_pct numeric default 45,
  p_menu_item_ids uuid[] default null
)
returns table(
  menu_item_id uuid, item_name text, brand_name text,
  pvp_cliente numeric, food_cost numeric,
  precio_paridad numeric, precio_min_suelo numeric, precio_sugerido numeric,
  margen_2x1 numeric, margen_pct_2x1 numeric, ahorro_cliente_pct numeric,
  units_30d numeric, status text
)
language sql
stable
set search_path to 'public'
as $function$
  with rate as (
    select cr.commission_pct, cr.commission_base
    from channel_rate cr
    where cr.account_id = p_account_id
      and cr.sales_channel_id = p_channel_id
      and cr.is_active
    order by cr.updated_at desc
    limit 1
  ),
  items as (
    select m.id, m.name, b.name as brand_name,
           coalesce(o.price, m.price) as price_sin_iva,
           coalesce(m.vat_rate, 10) as vat,
           ri.computed_cost as food_cost
    from menu_item m
    join brand b on b.id = m.brand_id
    left join menu_item_override o
      on o.menu_item_id = m.id and o.channel_id = p_channel_id and o.price is not null
    left join recipe_item ri on ri.id = m.recipe_item_id
    where m.account_id = p_account_id
      and m.archived_at is null
      and m.brand_id = p_brand_id
      and (p_menu_item_ids is null or m.id = any(p_menu_item_ids))
  ),
  sold as (
    select sl.menu_item_id, sum(sl.quantity) as units
    from sale_line sl
    join sale s on s.id = sl.sale_id
    where s.account_id = p_account_id
      and s.brand_id = p_brand_id
      and s.created_at >= now() - interval '30 days'
    group by sl.menu_item_id
  ),
  calc as (
    select i.*,
      round(i.price_sin_iva * (1 + i.vat/100), 2) as pvp_cli,
      -- k = fracción de comisión sobre el ingreso NETO (absorbe commission_base):
      --   base sin IVA: com = pct% * N            -> k = pct/100
      --   base con IVA: com = pct% * P = pct% * N*(1+iva) -> k = pct/100 * (1+iva)
      case when r.commission_base = 'pvp_sin_iva'
        then r.commission_pct/100.0
        else r.commission_pct/100.0 * (1 + i.vat/100) end as k
    from items i cross join rate r
  ),
  calc2 as (
    select c.*,
      c.pvp_cli / (1 + c.vat/100) as n1,                       -- ingreso neto de 1 ud normal
      -- N de paridad: mismo € de margen que vender 1 ud (N-kN-2FC = N1-kN1-FC)
      case when (1 - c.k) > 0
        then (c.pvp_cli / (1 + c.vat/100)) + c.food_cost / (1 - c.k)
        else null end as n_paridad,
      -- N mínimo que respeta el suelo %: N(1-k-F) >= 2FC
      case when (1 - c.k - p_margin_floor_pct/100.0) > 0
        then (2 * c.food_cost) / (1 - c.k - p_margin_floor_pct/100.0)
        else null end as n_suelo
    from calc c
  ),
  calc3 as (
    select c.*,
      round(c.n_paridad * (1 + c.vat/100), 2) as p_paridad,
      round(c.n_suelo   * (1 + c.vat/100), 2) as p_suelo,
      -- sugerido = el mayor de ambos, redondeado ARRIBA a 0,10 (precio publicable)
      ceil(greatest(c.n_paridad, c.n_suelo) * (1 + c.vat/100) * 10) / 10.0 as p_sug
    from calc2 c
  ),
  calc4 as (
    select c.*,
      c.p_sug / (1 + c.vat/100) as n_sug,
      round((c.p_sug / (1 + c.vat/100)) * (1 - c.k) - 2 * c.food_cost, 2) as margen_2x1_eur
    from calc3 c
  )
  select
    c.id, c.name, c.brand_name,
    c.pvp_cli,
    round(c.food_cost, 2),
    c.p_paridad, c.p_suelo, c.p_sug,
    c.margen_2x1_eur,
    round(100 * c.margen_2x1_eur / nullif(c.n_sug, 0), 1) as margen_pct_2x1,
    round(100 * (1 - c.p_sug / nullif(2 * c.pvp_cli, 0)), 1) as ahorro_cliente_pct,
    coalesce(so.units, 0),
    case
      when c.food_cost is null then 'sin_escandallo'
      when c.p_sug is null or c.p_sug >= 2 * c.pvp_cli then 'inviable'
      else 'ok'
    end as status
  from calc4 c
  left join sold so on so.menu_item_id = c.id
  order by coalesce(so.units, 0) desc;
$function$;

revoke all on function public.preview_bogo_mirror_price(uuid, uuid, uuid, numeric, uuid[]) from public, anon;
grant execute on function public.preview_bogo_mirror_price(uuid, uuid, uuid, numeric, uuid[]) to authenticated, service_role;

commit;
