-- 20260718T1900_fix_iva_bogo_mirror_price.sql
-- Corrige 3 cosas en preview_bogo_mirror_price (RECON Julio 18/07):
--
-- FIX 1 (BUG IVA — importante): la función trataba menu_item.price como precio SIN IVA y le
--   sumaba el IVA (pvp_cli = price*(1+iva)). Pero en Folvy el precio YA lleva IVA (bruto).
--   Efecto del bug: pvp_cliente inflado ~10%, ahorro y paridad falseados, y platos viables
--   marcados 'inviable' (p.ej. La Smash). FIX: price se toma como bruto (con IVA).
--     pvp_cli = price_gross ; neto n1 = price_gross/(1+iva).
--
-- FIX 2 (POLÍTICA precio_sugerido): antes = greatest(paridad, suelo). El criterio "paridad"
--   (mantener el mismo margen en euros que vender 1 ud suelta) dispara el sticker en platos
--   caros (Milanesa 21 €, etc.). Nueva política:
--     precio_sugerido = max(precio_actual, suelo p_margin_floor_pct%).
--   -> En margen gordo (pitas): queda el precio actual (sin subir => sin reversión), 50% ahorro.
--   -> En food cost alto (milanesas/burgers): sube al suelo 45% (subida mínima que protege margen).
--   Minimiza el sticker visual y la carga de reversión. precio_paridad se sigue devolviendo como
--   referencia informativa.
--
-- FIX 3 (COMISIÓN): la selección de channel_rate pasa a la comisión ACTIVA más baja del canal
--   (own-delivery / Catcher), determinista, en vez de "la última actualizada" (que era ambigua
--   cuando hay varias tarifas por canal, p.ej. Glovo 15% own vs 30% courier).

CREATE OR REPLACE FUNCTION public.preview_bogo_mirror_price(
  p_account_id uuid, p_channel_id uuid, p_brand_id uuid,
  p_margin_floor_pct numeric DEFAULT 45, p_menu_item_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(menu_item_id uuid, item_name text, brand_name text, pvp_cliente numeric,
   food_cost numeric, precio_paridad numeric, precio_min_suelo numeric, precio_sugerido numeric,
   margen_2x1 numeric, margen_pct_2x1 numeric, ahorro_cliente_pct numeric, units_30d numeric, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with rate as (
    select cr.commission_pct, cr.commission_base
    from channel_rate cr
    where cr.account_id = p_account_id
      and cr.sales_channel_id = p_channel_id
      and cr.is_active
    order by cr.commission_pct asc          -- FIX 3: own-delivery (comisión más baja), determinista
    limit 1
  ),
  items as (
    select m.id, m.name, b.name as brand_name,
           coalesce(o.price, m.price) as pvp_gross,     -- FIX 1: precio YA con IVA (bruto)
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
      i.pvp_gross as pvp_cli,                           -- FIX 1: pvp cliente = bruto
      case when r.commission_base = 'pvp_sin_iva'
        then r.commission_pct/100.0
        else r.commission_pct/100.0 * (1 + i.vat/100) end as k
    from items i cross join rate r
  ),
  calc2 as (
    select c.*,
      c.pvp_gross / (1 + c.vat/100) as n1,              -- FIX 1: neto de 1 ud
      case when (1 - c.k) > 0
        then (c.pvp_gross / (1 + c.vat/100)) + c.food_cost / (1 - c.k)
        else null end as n_paridad,
      case when (1 - c.k - p_margin_floor_pct/100.0) > 0
        then (2 * c.food_cost) / (1 - c.k - p_margin_floor_pct/100.0)
        else null end as n_suelo
    from calc c
  ),
  calc3 as (
    select c.*,
      round(c.n_paridad * (1 + c.vat/100), 2) as p_paridad,
      round(c.n_suelo   * (1 + c.vat/100), 2) as p_suelo,
      ceil(greatest(c.n_suelo, c.n1) * (1 + c.vat/100) * 10) / 10.0 as p_sug   -- FIX 2: max(actual, suelo)
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
