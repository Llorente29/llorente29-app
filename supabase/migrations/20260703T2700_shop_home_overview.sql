-- 20260703T2700_shop_home_overview.sql
-- Aplicada: (pendiente)
--
-- G2e.4 — RPC todo-en-una del INICIO del módulo Shop. Ventana espejo: devuelve cada
-- KPI en el periodo actual (Cur) y el ANTERIOR (Prev, misma longitud justo antes),
-- para que el front pinte los Δ%. Solo lectura; no toca motor ni checkout.
--
-- shop_home_overview(cuenta, from, to, location_ids[], brand_ids[], kinds[]):
--   KPIs cur/prev: ventas Shop, pedidos, ticket medio, margen real (+ nº medibles),
--     clientes nuevos (bienvenida), pedidos con oferta.
--   series[]      diario (cur): {day, withOffer, withoutOffer, orders}
--   byKind[]      inversión/canjes/margen por tipo (cur)
--   topCampaigns[] top 5 por ROI (cur)
--   brands[]      ventas y margen por marca (cur; via sale_line->menu_item->brand)
--   topDishes[]   platos más vendidos (cur; uds)
--   Filtros: location_ids[] (sale.location_id), brand_ids[] (sales con línea de esa
--     marca), kinds[] (coupon.kind).
--
-- No se prueba en la tx que la crea (auth.uid() null en editor).

begin;

create or replace function public.shop_home_overview(
  p_account uuid, p_from timestamptz, p_to timestamptz,
  p_location_ids uuid[], p_brand_ids uuid[], p_kinds text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_to         timestamptz := coalesce(p_to, now());
  v_from       timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_has_prev   boolean     := (p_from is not null);
  v_prev_from  timestamptz := case when p_from is not null then p_from - (v_to - p_from) else null end;
  v_span_start timestamptz := coalesce(v_prev_from, v_from);
  v_result     jsonb;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  with sales as (
    select s.id, s.total,
      case when s.sold_at >= v_from then 'cur' when v_has_prev and s.sold_at >= v_prev_from then 'prev' end as period,
      to_char((s.sold_at at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD') as day
    from sale s
    where s.account_id = p_account and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
      and s.sold_at >= v_span_start and s.sold_at < v_to
      and (p_location_ids is null or s.location_id = any(p_location_ids))
      and (p_brand_ids is null or exists (
        select 1 from sale_line sl join menu_item mi on mi.id = sl.menu_item_id
        where sl.sale_id = s.id and mi.brand_id = any(p_brand_ids)))
  ),
  red as (
    select cr.margin_after, cr.customer_id, sa.period, sa.id as sale_id, sa.total as sale_total, sa.day,
      c.kind, c.id as coupon_id, c.name,
      (c.kind = 'standard' and (c.auto_apply or c.first_order_only)) as is_welcome,
      case when c.kind = 'free_item' then coalesce((
        select round(ri.computed_cost + coalesce(mi.packaging_cost, 0), 2)
        from campaign_scope sc join menu_item mi on mi.id = sc.menu_item_id join recipe_item ri on ri.id = mi.recipe_item_id
        where sc.coupon_id = c.id and sc.menu_item_id is not null and ri.computed_cost is not null limit 1
      ), cr.discount_amount) else cr.discount_amount end as invested
    from coupon_redemption cr
    join sales sa on sa.id = cr.sale_id and sa.period is not null
    join coupon c on c.id = cr.coupon_id and c.account_id = p_account
    where cr.account_id = p_account and (p_kinds is null or c.kind = any(p_kinds))
  ),
  offer_ids as (select distinct sale_id, period from red),
  lines as (
    select sl.line_total, sl.computed_cost, sl.quantity, sl.menu_item_id, mi.brand_id, mi.name as item_name, b.name as brand_name
    from sale_line sl
    join sales sa on sa.id = sl.sale_id and sa.period = 'cur'
    join menu_item mi on mi.id = sl.menu_item_id
    left join brand b on b.id = mi.brand_id
    where coalesce(sl.line_type, 'product') = 'product'
  ),
  series as (
    select sa.day, count(*) as orders,
      round(sum(case when sa.id in (select sale_id from offer_ids where period = 'cur') then sa.total else 0 end), 2) as with_offer,
      round(sum(case when sa.id in (select sale_id from offer_ids where period = 'cur') then 0 else sa.total end), 2) as without_offer
    from sales sa where sa.period = 'cur' group by sa.day order by sa.day
  ),
  bk as (
    select kind, count(*) as redemptions, round(sum(invested), 2) as invested,
      sum(margin_after) filter (where margin_after is not null) as margin_real
    from red where period = 'cur' group by kind
  ),
  bc as (
    select coupon_id, name, kind, count(*) as redemptions, round(sum(invested), 2) as invested,
      sum(margin_after) filter (where margin_after is not null) as margin_real, count(margin_after) as margin_known
    from red where period = 'cur' group by coupon_id, name, kind
  ),
  br as (
    select coalesce(brand_name, '(sin marca)') as name, round(sum(line_total), 2) as ventas,
      round(sum((line_total - computed_cost)) filter (where computed_cost is not null), 2) as margin
    from lines group by brand_name
  ),
  td as (
    select item_name as name, round(sum(quantity), 0) as units
    from lines group by item_name order by sum(quantity) desc limit 8
  )
  select jsonb_build_object(
    'ok', true, 'hasPrev', v_has_prev,
    'ventasCur',  (select coalesce(round(sum(total) filter (where period='cur'),2),0) from sales),
    'ventasPrev', (select coalesce(round(sum(total) filter (where period='prev'),2),0) from sales),
    'pedidosCur',  (select count(*) filter (where period='cur') from sales),
    'pedidosPrev', (select count(*) filter (where period='prev') from sales),
    'ticketCur',  (select round(avg(total) filter (where period='cur'),2) from sales),
    'ticketPrev', (select round(avg(total) filter (where period='prev'),2) from sales),
    'marginCur',  (select round(sum(margin_after) filter (where period='cur' and margin_after is not null),2) from red),
    'marginPrev', (select round(sum(margin_after) filter (where period='prev' and margin_after is not null),2) from red),
    'marginKnownCur', (select count(*) filter (where period='cur' and margin_after is not null) from red),
    'marginRedCur',   (select count(*) filter (where period='cur') from red),
    'newCur',  (select count(distinct customer_id) filter (where period='cur' and is_welcome and customer_id is not null) from red),
    'newPrev', (select count(distinct customer_id) filter (where period='prev' and is_welcome and customer_id is not null) from red),
    'offerOrdersCur',  (select count(*) filter (where period='cur') from offer_ids),
    'offerOrdersPrev', (select count(*) filter (where period='prev') from offer_ids),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'withOffer', with_offer, 'withoutOffer', without_offer, 'orders', orders)) from series), '[]'::jsonb),
    'byKind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'redemptions', redemptions, 'invested', invested, 'marginReal', round(margin_real,2)) order by invested desc nulls last) from bk), '[]'::jsonb),
    'topCampaigns', coalesce((select jsonb_agg(t) from (
        select jsonb_build_object('id', coupon_id, 'name', name, 'kind', kind, 'redemptions', redemptions, 'invested', invested,
          'roi', case when margin_known > 0 and invested > 0 then round(margin_real/invested, 2) else null end) as t
        from bc order by (case when margin_known > 0 and invested > 0 then margin_real/invested else null end) desc nulls last, redemptions desc limit 5) x), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'ventas', ventas, 'margin', margin) order by ventas desc) from br), '[]'::jsonb),
    'topDishes', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'units', units)) from td), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

grant execute on function public.shop_home_overview(uuid, timestamptz, timestamptz, uuid[], uuid[], text[]) to authenticated;

commit;
